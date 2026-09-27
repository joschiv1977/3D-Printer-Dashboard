/**
 * The live camera the way Bambu Studio shows it: every frame drawn the
 * moment it arrives (docs/superpowers/plans/2026-09-26-kamera-wie-studio.md).
 *
 * /api/camera/live sends H.264 in one long answer, fetched like every other
 * request of the page (apiCall): a config message, the pictures since the
 * last keyframe, then everything live, each behind its 4-byte length. WebCodecs decodes
 * in hardware, and each decoded frame is drawn on a canvas at once. The
 * canvas's own stream (captureStream, one frame per requestFrame) feeds an
 * ordinary <video> -- so fullscreen, picture-in-picture and the second
 * preview in the control window work exactly as before, and nothing
 * schedules frames by the printer's timestamps, which is what made WebRTC
 * players stutter on the X2D.
 *
 *   const live = new KameraLive({ onErstesBild, onAufgegeben });
 *   video.srcObject = live.start();
 *   live.stop();
 */
(function () {
    'use strict';

    const KONFIG = 0x01;
    const BILD = 0x02;
    // Behind by this many frames in the decoder: skip ahead to the next
    // keyframe (the X2D sends one about every second) instead of lagging.
    const RUECKSTAU_MAX = 8;
    const NEU_VERBINDEN_MS = [1000, 2000, 5000];
    const AUFGEBEN_NACH = 5;

    function base64Bytes(text) {
        const roh = atob(text);
        const aus = new Uint8Array(roh.length);
        for (let i = 0; i < roh.length; i++) aus[i] = roh.charCodeAt(i);
        return aus;
    }

    /** The avcC box WebCodecs takes as `description` for AVCC input. */
    function avcC(sps, pps) {
        const box = new Uint8Array(11 + sps.length + pps.length);
        box.set([1, sps[1], sps[2], sps[3], 0xFF, 0xE1, sps.length >> 8, sps.length & 0xFF], 0);
        box.set(sps, 8);
        const nachSps = 8 + sps.length;
        box.set([1, pps.length >> 8, pps.length & 0xFF], nachSps);
        box.set(pps, nachSps + 3);
        return box;
    }

    class KameraLive {
        static moeglich() {
            return typeof window.VideoDecoder === 'function'
                && typeof window.EncodedVideoChunk === 'function'
                && typeof HTMLCanvasElement.prototype.captureStream === 'function';
        }

        constructor(optionen = {}) {
            this.onErstesBild = optionen.onErstesBild || null;
            this.onAufgegeben = optionen.onAufgegeben || null;
            this.laeuft = false;
        }

        start() {
            this.laeuft = true;
            this.fehlversuche = 0;
            this.erstesBild = false;
            this.canvas = document.createElement('canvas');
            this.canvas.width = 1920;
            this.canvas.height = 1080;
            this.ctx = this.canvas.getContext('2d');
            this.stream = this.canvas.captureStream(0);
            this.spur = this.stream.getVideoTracks()[0];
            this._verbinden();
            return this.stream;
        }

        stop() {
            this.laeuft = false;
            clearTimeout(this.wiederTimer);
            if (this.abbruch) {
                this.abbruch.abort();
                this.abbruch = null;
            }
            this._decoderWeg();
            if (this.spur) this.spur.stop();
        }

        _verbinden() {
            // The page's own signed-in call (apiCall: its cookie, renewed on
            // a 401); in the PiP window a plain fetch with the cookie.
            const abbruch = new AbortController();
            this.abbruch = abbruch;
            const optionen = { noDedup: true, signal: abbruch.signal };
            const holen = window.apiCall
                ? window.apiCall('/api/camera/live', optionen)
                : fetch('/api/camera/live', { credentials: 'include', signal: abbruch.signal });
            let bekam = false;
            holen
                .then(async (antwort) => {
                    if (!antwort.ok || !antwort.body) throw new Error('HTTP ' + antwort.status);
                    const leser = antwort.body.getReader();
                    let rest = new Uint8Array(0);
                    for (;;) {
                        const { value, done } = await leser.read();
                        if (done) return;
                        const daten = new Uint8Array(rest.length + value.length);
                        daten.set(rest, 0);
                        daten.set(value, rest.length);
                        const ansicht = new DataView(daten.buffer);
                        let pos = 0;
                        // Each message behind its length; 0 is a sign of life.
                        while (daten.length - pos >= 4) {
                            const laenge = ansicht.getUint32(pos);
                            if (daten.length - pos - 4 < laenge) break;
                            if (laenge > 0) {
                                bekam = true;
                                this._nachricht(daten.subarray(pos + 4, pos + 4 + laenge));
                            }
                            pos += 4 + laenge;
                        }
                        rest = daten.subarray(pos);
                    }
                })
                .catch((e) => {
                    if (!abbruch.signal.aborted) console.warn('📹 Live camera:', e && e.message);
                })
                .finally(() => {
                    if (abbruch.signal.aborted || abbruch !== this.abbruch) return;
                    this._verloren(bekam);
                });
        }

        /** The stream ended (or never came): again after 1, 2, 5 s, given
         *  up after five tries that delivered nothing. */
        _verloren(bekam) {
            if (!this.laeuft) return;
            // A stream that delivered starts counting afresh.
            this.fehlversuche = bekam ? 0 : this.fehlversuche + 1;
            if (this.fehlversuche >= AUFGEBEN_NACH) {
                console.warn('📹 Live camera: no connection after', AUFGEBEN_NACH, 'tries');
                this.laeuft = false;
                if (this.onAufgegeben) this.onAufgegeben();
                return;
            }
            const warten = NEU_VERBINDEN_MS[Math.min(this.fehlversuche, NEU_VERBINDEN_MS.length - 1)];
            this.wiederTimer = setTimeout(() => { if (this.laeuft) this._verbinden(); }, warten);
        }

        _nachricht(daten) {
            if (daten[0] === KONFIG) {
                this._konfig(JSON.parse(new TextDecoder().decode(daten.subarray(1))));
            } else if (daten[0] === BILD) {
                this._bild(daten);
            }
        }

        _konfig(k) {
            this.konfig = k;
            this._decoderWeg();
            if (k.width && k.height && (this.canvas.width !== k.width || this.canvas.height !== k.height)) {
                this.canvas.width = k.width;
                this.canvas.height = k.height;
            }
            this.decoder = new VideoDecoder({
                output: (frame) => this._zeichne(frame),
                error: (e) => {
                    // A broken decoder is closed for good: build a new one
                    // from the same config and start at the next keyframe.
                    console.warn('📹 Live camera decoder:', e && e.message);
                    if (this.laeuft && this.konfig) this._konfig(this.konfig);
                },
            });
            this.decoder.configure({
                codec: k.codec,
                description: avcC(base64Bytes(k.sps), base64Bytes(k.pps)),
                optimizeForLatency: true,
                hardwareAcceleration: 'prefer-hardware',
            });
            this.wartetAufKey = true;
        }

        _bild(daten) {
            if (!this.decoder || this.decoder.state !== 'configured') return;
            const key = (daten[1] & 0x01) !== 0;
            if (!key && (this.wartetAufKey || this.decoder.decodeQueueSize > RUECKSTAU_MAX)) {
                this.wartetAufKey = true;
                return;
            }
            this.wartetAufKey = false;
            const ankunft = Number(new DataView(daten.buffer, daten.byteOffset + 2, 8).getBigUint64(0));
            this.decoder.decode(new EncodedVideoChunk({
                type: key ? 'key' : 'delta',
                timestamp: ankunft,
                data: daten.subarray(10),
            }));
        }

        _zeichne(frame) {
            try {
                this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
            } finally {
                frame.close();
            }
            if (this.spur && this.spur.requestFrame) this.spur.requestFrame();
            if (!this.erstesBild) {
                this.erstesBild = true;
                if (this.onErstesBild) this.onErstesBild();
            }
        }

        _decoderWeg() {
            if (this.decoder && this.decoder.state !== 'closed') {
                try { this.decoder.close(); } catch (_) { /* already closed */ }
            }
            this.decoder = null;
        }
    }

    window.KameraLive = KameraLive;
})();
