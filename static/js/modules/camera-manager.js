/**
 * Camera Manager
 * Handles all camera streaming modes (WebRTC, MJPEG, Snapshot Polling),
 * PiP, fullscreen, HQ mode, source toggling, and page visibility
 */
// Symbole fuer den Play/Pause-Knopf ueber dem Bild — gleiche Machart wie im
// Markup (24er-Raster, Strich in currentColor), damit der Wechsel nicht von
// SVG auf ein Unicode-Zeichen springt.
const KAMERA_PAUSE = '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
const KAMERA_START = '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l12 8-12 8z"/></svg>';

class CameraManager {
    constructor() {
        const texts = window.texts || {};

        this.streamRetryTimeout = null;
        this.isHQMode = false;

        // WebRTC/MJPEG Camera Mode globals
        window._cameraMode = 'mjpeg'; // default
        window._webrtcPC = null;
        window._cameraOff = false;
        window._snapshotPolling = null;

        // Set up camera-stream error listener
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                const img = document.getElementById('camera-stream');
                if (img) {
                    img.addEventListener('error', () => this.handleCameraError());
                }
            });
        } else {
            const img = document.getElementById('camera-stream');
            if (img) {
                img.addEventListener('error', () => this.handleCameraError());
            }
        }

        // Set up page visibility handler
        this._setupPageVisibility();

        // Set up Electron PiP closed listener
        if (window.electronAPI && window.electronAPI.pip) {
            window.electronAPI.pip.onClosed(() => {
                console.log('🖼️ [Electron-PiP] window was closed');
                window.electronPipActive = false;
                if (!document.hidden) {
                    this.resumeMainStreamFromPiP();
                }
            });
        }

        // Init camera (async IIFE)
        this._initCamera();
    }

    // Play/Pause-Toggle (wie Android): pausiert/startet den Live-Stream manuell.
    toggleCameraPlayPause() {
        const texts = window.texts || {};
        const icon = document.getElementById('camera-playpause-icon');
        const txt = document.getElementById('camera-playpause-text');
        this._manualPaused = !this._manualPaused;
        if (this._manualPaused) {
            // Pausieren: alle Stream-Varianten stoppen.
            window._cameraPaused = true;
            this._stopKlipperPoll();
            this.stopSnapshotPolling();
            if (window._webrtcPC) { try { window._webrtcPC.close(); } catch (_) {} window._webrtcPC = null; }
            const img = document.getElementById('camera-stream');
            if (img) img.onerror = null;
            const ph = document.getElementById('camera-placeholder');
            if (ph) {
                ph.style.display = 'flex';
                const t = ph.querySelector('#camera-loading-text');
                if (t) t.textContent = texts.camera_paused || 'Kamera pausiert';
            }
            if (icon) icon.innerHTML = KAMERA_START;
            if (txt) txt.textContent = texts.camera_resume || 'Start';
        } else {
            // Fortsetzen.
            window._cameraPaused = false;
            if (icon) icon.innerHTML = KAMERA_PAUSE;
            if (txt) txt.textContent = texts.camera_pause || 'Pause';
            this._initCamera();
        }
    }

    handleCameraError() {
        // Don't retry when camera is intentionally off
        if (window._cameraOff) return;
        // Klipper-Mode: der MJPEG-Reconnect in _startKlipperMjpeg kümmert sich
        // selbst — NICHT auf den Bambu-Endpoint /api/camera umbiegen.
        if (window.isKlipperMode && window.isKlipperMode()) return;

        console.log('❌ Camera stream error');
        if (this.streamRetryTimeout) return;

        // Nur fuer den direkten MJPEG-Stream-Modus — im WebRTC- oder
        // Snapshot-Betrieb wuerde der Retry die ffmpeg-Pipeline grundlos
        // wiederbeleben.
        if (window._cameraMode === 'webrtc' || window._cameraOff || window._snapshotPolling) return;
        const img = document.getElementById('camera-stream');
        if (!img) return;
        // Nicht restarten wenn PiP aktiv ist oder Tab im Hintergrund
        if (img.dataset.pipPaused || document.hidden) return;

        this.streamRetryTimeout = setTimeout(() => {
            const newSrc = '/api/camera?t=' + Date.now();
            img.src = newSrc;
            console.log('🔄 Versuche Stream neu zu laden...');
            this.streamRetryTimeout = null;
        }, 2000);
    }

    // ============= WebRTC/MJPEG Camera Mode (macOS H.264 VideoToolbox via go2rtc) =============

    /**
     * Regelmaessig ein kleines Standbild wegschreiben.
     *
     * Es ueberlebt den Seitenwechsel (sessionStorage), aber nicht das
     * Schliessen des Fensters — dieselbe Regel wie in Android: die Bruecke
     * gilt fuer diese Sitzung, nicht fuer die Ewigkeit.
     *
     * 320 Bildpunkte breit, JPEG bei 0,6 — rund zehn Kilobyte. Alle zehn
     * Sekunden eins reicht: es soll zeigen, was zuletzt zu sehen war, nicht
     * den Strom ersetzen.
     */
    merkeBilderVon(video) {
        if (window._bildMerker) clearInterval(window._bildMerker);
        const schreibe = function () {
            if (!video.videoWidth || video.paused) return;
            try {
                const c = document.createElement('canvas');
                c.width = 320;
                c.height = Math.round(320 * video.videoHeight / video.videoWidth) || 180;
                c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
                sessionStorage.setItem('kamera_letztes_bild',
                                       c.toDataURL('image/jpeg', 0.6));
            } catch (_) {
                // Noch nichts gezeichnet, oder der Speicher ist voll — dann
                // eben beim naechsten Mal.
            }
        };
        // Das erste, sobald wirklich etwas gezeichnet wurde.
        if (video.requestVideoFrameCallback) {
            video.requestVideoFrameCallback(schreibe);
        } else {
            setTimeout(schreibe, 2000);
        }
        window._bildMerker = setInterval(schreibe, 10000);
    }

    async startWebRTCStream() {
        // Cleanup previous connection
        if (window._webrtcPC) {
            window._webrtcPC.close();
            window._webrtcPC = null;
        }

        // Retry-Counter auf window, damit er Reload-persistent in der
        // Session bleibt. Nach N Fehlversuchen stoppt der Player
        // automatisch — sonst bombardiert der Browser den Server alle
        // 3s mit /api/camera/webrtc bis der Tab zu ist, auch wenn der
        // Drucker offline ist und kein go2rtc laeuft.
        window._webrtcFailCount = window._webrtcFailCount || 0;
        const MAX_WEBRTC_RETRIES = 5;
        if (window._webrtcFailCount >= MAX_WEBRTC_RETRIES) {
            console.warn('WebRTC: max retries reached, stopping auto-reconnect');
            const ph = document.getElementById('camera-placeholder');
            if (ph) ph.style.display = 'block';
            return;
        }

        let el = document.getElementById('camera-stream');
        if (!el) return;

        // Replace <img> with <video> if needed
        if (el.tagName === 'IMG') {
            const video = document.createElement('video');
            video.id = 'camera-stream';
            video.className = el.className;
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.style.cssText = 'transition: transform 0.3s ease; transform-origin: center; display: none;';
            el.parentNode.replaceChild(video, el);
            el = video;
        }

        // Die Bruecke gegen die schwarze Flaeche: das zuletzt gesehene Bild
        // steht, bis der Strom wirklich zeichnet.
        //
        // Gemessen am 31aug26: vom Start bis zum ersten gezeichneten Bild
        // 1,27 s im Web, 1,9 s in Android. Der groesste Teil davon ist
        // unvermeidlich — WebRTC kann erst zeichnen, wenn ein Keyframe
        // angekommen ist (hier 843 ms nach „verbunden"), und das schickt die
        // Kamera nur alle paar Sekunden.
        //
        // `poster` ist genau dafuer gemacht: das Bild steht, bis das Video
        // etwas zu zeigen hat, und geht dann von selbst. Kein zweites
        // Element, kein Umschalten.
        //
        // Bewusst NICHT ueber /api/camera/snapshot: der startet die
        // ffmpeg-Pipeline auf dem Server, und die laeuft danach 45 s bei
        // einem halben Kern weiter. Fuer ein Ueberbrueckungsbild zu teuer.
        try {
            const gemerkt = sessionStorage.getItem('kamera_letztes_bild');
            if (gemerkt) el.poster = gemerkt;
        } catch (_) {}

        const pc = new RTCPeerConnection({iceServers: []});
        window._webrtcPC = pc;

        pc.ontrack = (event) => {
            el.srcObject = event.streams[0];
            el.play().catch(function() {});
            const ph = document.getElementById('camera-placeholder');
            if (ph) ph.style.display = 'none';
            el.style.display = 'block';
            this.merkeBilderVon(el);
        };

        pc.onconnectionstatechange = function() {
            if (pc !== window._webrtcPC) return;
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                console.log('WebRTC connection lost, reconnecting...');
                setTimeout(function() {
                    if (window._cameraMode === 'webrtc' && !window._cameraOff) {
                        window.cameraManager.startWebRTCStream();
                    }
                }, 2000);
            }
        };

        pc.addTransceiver('video', {direction: 'recvonly'});

        const t0 = performance.now();
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Auf die ICE-Kandidaten warten.
            //
            // Ohne STUN/TURN (iceServers: []) entstehen nur lokale Kandidaten,
            // die in wenigen Millisekunden da sind. Trotzdem stand hier eine
            // Rueckfallfrist von 2 Sekunden — und genau die lief regelmaessig
            // ab, weil Chromium den Zustand "complete" verzoegert meldet. Das
            // waren 2 der 3 Sekunden, die das Kamerabild auf sich warten liess
            // (gemessen 20aug26).
            //
            // Jetzt: fertig, sobald der erste Kandidat da ist (plus kurze
            // Nachfrist fuer weitere), spaetestens nach 600 ms.
            await new Promise(function(resolve) {
                if (pc.iceGatheringState === 'complete') return resolve();
                let fertig = false;
                const ende = function () { if (!fertig) { fertig = true; resolve(); } };
                pc.onicegatheringstatechange = function() {
                    if (pc.iceGatheringState === 'complete') ende();
                };
                pc.onicecandidate = function (e) {
                    // null = Gathering beendet; sonst nach kurzer Nachfrist los.
                    if (!e.candidate) ende();
                    else setTimeout(ende, 120);
                };
                setTimeout(ende, 600);
            });
            console.log(`WebRTC: ICE candidates after ${Math.round(performance.now() - t0)} ms`);

            const resp = await apiCall('/api/camera/webrtc', {
                method: 'POST',
                body: pc.localDescription.sdp,
                headers: {'Content-Type': 'application/sdp'}
            });

            // 425 „Too Early" = der Drucker faehrt noch hoch. Das ist kein
            // Fehlschlag: wuerde er unten mitgezaehlt, verdoppelte sich die
            // Wartezeit mit jedem Versuch, und das Bild kaeme Sekunden nach
            // dem Drucker statt mit ihm — nach fuenf Versuchen gaebe der
            // Player sogar ganz auf. Also in festem Takt weiter warten.
            if (resp.status === 425) {
                pc.close();
                if (pc === window._webrtcPC) window._webrtcPC = null;
                setTimeout(function () {
                    if (window._cameraMode === 'webrtc' && !window._cameraOff) {
                        window.cameraManager.startWebRTCStream();
                    }
                }, 3000);
                return;
            }

            if (!resp.ok) throw new Error('Signaling failed: ' + resp.status);

            const answerSDP = await resp.text();
            await pc.setRemoteDescription({type: 'answer', sdp: answerSDP});
            console.log(`WebRTC stream connected (${Math.round(performance.now() - t0)} ms)`);
            // Connection steht -> Counter zuruecksetzen fuer naechsten Disconnect
            window._webrtcFailCount = 0;
        } catch (e) {
            console.error('WebRTC setup failed:', e);
            pc.close();
            if (pc === window._webrtcPC) window._webrtcPC = null;
            window._webrtcFailCount = (window._webrtcFailCount || 0) + 1;
            // Retry mit exponentiellem Backoff, aber nur solange Max nicht
            // erreicht (Check passiert oben am Anfang der Funktion).
            const backoffMs = Math.min(3000 * Math.pow(2, window._webrtcFailCount - 1), 30000);
            setTimeout(function() {
                if (window._cameraMode === 'webrtc' && !window._cameraOff) {
                    window.cameraManager.startWebRTCStream();
                }
            }, backoffMs);
        }
    }

    /** Externer Reset-Hook, z.B. wenn der Drucker wieder an geht. */
    resetWebRTCRetries() {
        window._webrtcFailCount = 0;
    }

    stopWebRTCStream() {
        if (window._webrtcPC) {
            window._webrtcPC.close();
            window._webrtcPC = null;
        }
        const el = document.getElementById('camera-stream');
        if (el && el.tagName === 'VIDEO' && el.srcObject) {
            el.srcObject = null;
        }
    }

    // Snapshot-Polling for MJPEG via Cloudflare (multipart/x-mixed-replace gets buffered)
    startSnapshotPolling() {
        if (window._snapshotPolling) return;
        // Klipper-Mode hat kein /api/camera/snapshot — Stream ist direktes
        // mjpeg ueber unseren Klipper-Proxy (siehe _initKlipperCamera).
        // Aufrufer wie recheckCameraMode oder Tab-Visible-Recovery koennten
        // hier rein — wir wechseln stattdessen sauber zum Klipper-Init.
        if (window.isKlipperMode && window.isKlipperMode()) {
            this._initKlipperCamera();
            return;
        }
        const img = document.getElementById('camera-stream');
        if (!img || img.tagName !== 'IMG') return;
        console.log('Starting snapshot polling for MJPEG');
        const ph = document.getElementById('camera-placeholder');
        // Waiting times after consecutive failures, in milliseconds.
        const WARTESTUFEN = [1000, 2000, 4000, 8000, 15000, 30000];
        let fehlschlaege = 0;
        function poll() {
            if (window._cameraMode !== 'mjpeg' || window._cameraOff) {
                window._snapshotPolling = null;
                return;
            }
            const ts = Date.now();
            const newImg = new Image();
            newImg.onload = function() {
                fehlschlaege = 0;
                img.src = newImg.src;
                img.style.display = 'block';
                if (ph) ph.style.display = 'none';
                window._snapshotPolling = setTimeout(poll, 0);
            };
            newImg.onerror = function() {
                // No picture. Do not keep hammering once a second: against a
                // printer that does not answer this ran for hours at one
                // request per second, each one a 503 in the console (seen on
                // the Pi, 01sep26).
                //
                // Retrying does continue, just further and further apart --
                // when the printer comes back the picture returns by itself.
                // So no "is the printer reachable" check in front of it; the
                // retry IS the check.
                fehlschlaege++;
                if (fehlschlaege === 3 && ph) {
                    // Three in a row is no longer a hiccup. Say so, instead
                    // of leaving the last frame frozen on screen.
                    img.style.display = 'none';
                    ph.style.display = 'flex';
                    const txt = ph.querySelector('#camera-loading-text');
                    if (txt) {
                        txt.textContent = (window.t && window.t('camera_no_signal'))
                            || 'Kein Bild — Drucker antwortet nicht';
                    }
                }
                const warten = WARTESTUFEN[Math.min(fehlschlaege - 1, WARTESTUFEN.length - 1)];
                window._snapshotPolling = setTimeout(poll, warten);
            };
            newImg.src = '/api/camera/snapshot?t=' + ts;
        }
        poll();
    }

    stopSnapshotPolling() {
        if (window._snapshotPolling) {
            clearTimeout(window._snapshotPolling);
            window._snapshotPolling = null;
        }
    }

    /** Nach MJPEG-Fallback einmal nachfragen, ob WebRTC inzwischen
     *  bereitsteht (go2rtc-Kaltstart) — wenn ja, umschalten. */
    _scheduleWebrtcRecheck() {
        if (this._webrtcRecheck) return;
        this._webrtcRecheck = true;
        setTimeout(async () => {
            this._webrtcRecheck = false;
            if (window._cameraMode !== 'mjpeg') return;
            try {
                const r = await apiCall('/api/camera/mode');
                const d = await r.json();
                if (d.type === 'webrtc') {
                    console.log('WebRTC inzwischen verfügbar — wechsle von MJPEG');
                    this.stopSnapshotPolling();
                    window._cameraMode = 'webrtc';
                    await this.startWebRTCStream();
                }
            } catch (_) {}
        }, 8000);
    }

    async _initCamera() {
        try {
            // Wait for apiCall to be available
            while (typeof window.apiCall === 'undefined') {
                await new Promise(r => setTimeout(r, 100));
            }

            // Multi-Printer Phase 3: warten bis der printer-adapter geladen
            // UND `loadPrinterInfo()` durchgelaufen ist. Sonst wuerde der
            // Klipper-Mode falsch erkannt (Default ist 'bambu') und der
            // CameraManager pingt /api/camera (Bambu-Pfad) → ERROR-Spam.
            //
            // Die Betriebsart steht aber schon serverseitig im body-Attribut
            // (data-active-printer) — der Modus-Abruf braucht den Adapter also
            // nicht. Deshalb parallel: /api/camera/mode sofort anfragen und
            // waehrenddessen auf den Adapter warten. Vorher lagen beide
            // hintereinander und kosteten bis zu einer Sekunde Blindzeit.
            const modusVorab = (window.isKlipperMode && window.isKlipperMode())
                ? null
                : apiCall('/api/camera/mode').then(r => r.json()).catch(() => null);
            for (let i = 0; i < 40 && !window.printerAdapter; i++) {
                await new Promise(r => setTimeout(r, 25));
            }
            if (window.printerAdapter && window.printerAdapter.ready) {
                try { await window.printerAdapter.ready; } catch (_) {}
            }
            if (window.isKlipperMode && window.isKlipperMode()) {
                return this._initKlipperCamera();
            }

            // Vorab-Anfrage nutzen (laeuft schon seit dem Adapter-Warten);
            // nur wenn sie fehlschlug, nochmal fragen.
            const data = (await modusVorab)
                || await apiCall('/api/camera/mode').then(r => r.json());
            console.log('Camera mode response:', data);

            if (data.type === 'off') {
                window._cameraOff = true;
                window._cameraMode = 'off';
                const img = document.getElementById('camera-stream');
                if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
                const ph = document.getElementById('camera-placeholder');
                if (ph) {
                    ph.style.display = 'flex';
                    const txt = ph.querySelector('#camera-loading-text');
                    if (txt) txt.textContent = (window.t && window.t('camera_off')) || 'Kamera aus (Drucker aus)';
                }
                console.log('Camera off (printer off)');
                return;
            }

            if (data.type === 'webrtc') {
                window._cameraMode = 'webrtc';
                console.log('Camera mode: WebRTC (H.264 VideoToolbox via go2rtc)');
                await this.startWebRTCStream();
                return;
            }

            // MJPEG-Fallback (Snapshot-Polling) — z.B. wenn go2rtc beim
            // App-Kaltstart noch nicht wach war. Danach einmal nachpruefen,
            // ob WebRTC inzwischen geht, sonst haengt der Client dauerhaft
            // im Polling und haelt serverseitig die ffmpeg-Pipeline wach.
            window._cameraMode = 'mjpeg';
            console.log('Camera mode: MJPEG (snapshot polling)');
            this.startSnapshotPolling();
            this._scheduleWebrtcRecheck();
        } catch (e) {
            console.log('Camera mode detection failed, using snapshot polling:', e);
            window._cameraMode = 'mjpeg';
            this.startSnapshotPolling();
        }
    }

    // ============= Klipper-Camera =============
    // Multi-Printer Phase 3: Klipper-Cams sind direkte mjpeg-URLs, der
    // Browser kann das ohne Proxy/Polling. Bei mehreren Cams cyclet der
    // existierende camera-source-toggle-btn durch alle.
    async _initKlipperCamera() {
        if (this._manualPaused) return;   // manuell pausiert → nicht automatisch neu starten
        this._stopKlipperPoll();   // altes Polling stoppen (Re-Init/Reconnect)
        try {
            const r = await apiCall('/api/camera/sources');
            const data = await r.json();
            const sources = (data && data.sources) || [];
            this._klipperSources = sources;
            this._klipperSourceIdx = 0;

            const img = document.getElementById('camera-stream');
            const ph = document.getElementById('camera-placeholder');
            const phText = ph ? ph.querySelector('#camera-loading-text') : null;

            if (!sources.length) {
                if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
                if (ph) ph.style.display = 'flex';
                if (phText) phText.textContent =
                    (window.t && window.t('camera_off')) || 'Keine Klipper-Kamera gefunden';
                window._cameraMode = 'off';
                return;
            }

            window._cameraMode = 'mjpeg';
            window._cameraOff = false;
            this._setKlipperCamera(0);

            // Toggle-Button anzeigen wenn >1 Cam — der initCameraSourceButton
            // macht das nur fuer uStreamer. Hier separat triggern.
            if (sources.length > 1) {
                const dashboardBtn = document.getElementById('camera-source-toggle-btn');
                if (dashboardBtn) dashboardBtn.style.display = 'flex';
                const controlBtn = document.getElementById('control-camera-source-toggle-btn');
                if (controlBtn) controlBtn.style.display = 'block';
            }
        } catch (e) {
            console.warn('Klipper camera init failed:', e);
            window._cameraMode = 'off';
        }
    }

    _setKlipperCamera(idx) {
        const sources = this._klipperSources || [];
        if (!sources.length) return;
        const s = sources[idx % sources.length];
        const img = document.getElementById('camera-stream');
        const controlImg = document.getElementById('control-camera');
        const ph = document.getElementById('camera-placeholder');

        // Bild-Ausrichtung aus Moonraker (server.webcams.list rotation/flip) als
        // CSS-Transform — z.B. eMeet C960 ist 180° montiert (rotation:180).
        const tf = [];
        if (s.rotation) tf.push('rotate(' + s.rotation + 'deg)');
        if (s.flip_horizontal) tf.push('scaleX(-1)');
        if (s.flip_vertical) tf.push('scaleY(-1)');
        const transform = tf.join(' ');
        // baseTransform merken → der Zoom kombiniert sie mit scale() statt sie zu
        // überschreiben (sonst kippt das Bild beim Zoom/Reset auf den Kopf).
        if (img) { img.style.display = 'block'; img.style.transform = transform; img.dataset.baseTransform = transform; }
        if (controlImg) { controlImg.style.transform = transform; controlImg.dataset.baseTransform = transform; }
        if (ph) ph.style.display = 'none';

        // Source-Label aktualisieren — derselbe Span den Bambu nutzt.
        const lbl = document.getElementById('camera-source-text');
        if (lbl) lbl.textContent = s.label || s.id;
        const ctrlLbl = document.getElementById('control-camera-source');
        if (ctrlLbl) ctrlLbl.innerHTML = window.skIcon('kamera', 'hd-ic--xs') + ' ' + (s.label || s.id);

        // Kontinuierliches MJPEG (?action=stream) über den Adapter-Proxy — wie
        // Android lokal: ein offener Stream, der Browser dekodiert die Frames →
        // flüssig (statt ruckeligem Snapshot-Polling). Der Proxy kappt Stalls nach
        // 15s, der Reconnect unten verbindet dann neu.
        this._startKlipperMjpeg(s);
    }

    // Stoppt laufendes Polling/MJPEG (vor Source-Wechsel / Kamera aus).
    _stopKlipperPoll() {
        const p = this._klipperPoll;
        if (!p) return;
        if (p.timer) clearTimeout(p.timer);
        if (p.loader) { p.loader.onload = null; p.loader.onerror = null; }
        // MJPEG: onerror lösen + Stream schließen (src leeren), sonst läuft die
        // Verbindung weiter und ein onerror würde fälschlich reconnecten.
        if (p.imgs) p.imgs.forEach((el) => { el.onerror = null; try { el.removeAttribute('src'); } catch (_) {} });
        this._klipperPoll = null;
    }

    // Kontinuierliches MJPEG (Port-Pendant zu Androids processMJPEGStream): ein
    // offener Stream pro <img> auf die Proxy-Stream-URL. Bei Stall/Fehler (Proxy
    // kappt nach 15s) feuert onerror → Reconnect mit Cache-Bust.
    _startKlipperMjpeg(source) {
        this._stopKlipperPoll();
        const url = source.url;            // /api/camera/klipper/<id> → ?action=stream
        if (!url) return;
        const im = document.getElementById('camera-stream');
        const cim = document.getElementById('control-camera');
        const imgs = [im, cim].filter(Boolean);
        const p = (this._klipperPoll = { mjpeg: true, url, timer: null, imgs });
        const self = this;
        const current = () => self._klipperPoll === p;
        const connect = () => {
            if (!current()) return;
            p.timer = null;
            const src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
            imgs.forEach((el) => {
                el.onerror = () => { if (current() && !p.timer) p.timer = setTimeout(connect, 1500); };
                el.src = src;
                el.style.display = 'block';
            });
        };
        connect();
    }

    // Reagiert auf die Drucker-Verbindung (Socket.IO mqtt_status). Klipper-Direct:
    // Drucker AUS → Snapshot-Polling stoppen (sonst feuert der Image-Loader endlos
    // 404s gegen die nicht erreichbare Kamera) und Platzhalter zeigen; Drucker AN →
    // Kamera neu initialisieren (nur falls noch kein Poll läuft).
    onPrinterConnectionChange(connected) {
        if (!(window.isKlipperMode && window.isKlipperMode())) return;
        if (connected) {
            if (!this._klipperPoll) this._initKlipperCamera();
            return;
        }
        this._stopKlipperPoll();
        const img = document.getElementById('camera-stream');
        if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
        const cimg = document.getElementById('control-camera');
        if (cimg) cimg.removeAttribute('src');
        const ph = document.getElementById('camera-placeholder');
        if (ph) {
            ph.style.display = 'flex';
            const txt = ph.querySelector('#camera-loading-text');
            if (txt) txt.textContent = (window.t && window.t('camera_off')) || 'Kamera aus (Drucker aus)';
        }
    }

    _cycleKlipperCamera() {
        const sources = this._klipperSources || [];
        if (sources.length < 2) return;
        this._klipperSourceIdx = (this._klipperSourceIdx + 1) % sources.length;
        this._setKlipperCamera(this._klipperSourceIdx);
    }

    // Re-check camera mode (e.g., after MQTT reconnect when printer turns on)
    async recheckCameraMode() {
        // Im Klipper-Mode haben wir keinen `/api/camera/mode`-Detect (Bambu-
        // spezifischer Endpoint, kann ERRORs erzeugen wenn kein Bambu-Stack).
        // Stattdessen den Klipper-Init wiederholen — der zieht sources neu
        // und setzt das `<img>` auf die richtige Cam.
        if (window.isKlipperMode && window.isKlipperMode()) {
            return this._initKlipperCamera();
        }
        try {
            const response = await apiCall('/api/camera/mode');
            const data = await response.json();
            console.log('Camera mode recheck:', data);

            if (data.type === 'off') {
                setTimeout(() => this.recheckCameraMode(), 3000);
                return;
            }

            window._cameraOff = false;
            console.log('Camera back online, mode:', data.type);

            // Der Drucker ist wieder da — die Fehlversuche von vorhin zaehlen
            // nicht mehr. Ohne das schleppte sich der Zaehler aus dem letzten
            // Aus-Zyklus mit, und nach ein paar Ein/Aus-Runden war das
            // Maximum erreicht, ohne dass je wirklich etwas kaputt war.
            // (`resetWebRTCRetries` gab es schon, gerufen hat es niemand.)
            this.resetWebRTCRetries();

            if (data.type === 'webrtc') {
                window._cameraMode = 'webrtc';
                await this.startWebRTCStream();
            } else {
                // MJPEG fallback — Snapshot-Polling
                window._cameraMode = 'mjpeg';
                this.startSnapshotPolling();
            }
        } catch (e) {
            console.log('Camera recheck failed:', e);
        }
    }

    // ============= PAGE VISIBILITY - Stream pausieren wenn Tab/App im Hintergrund =============
    // Wie iOS/Catalyst: Stream-Lifecycle unabhängig vom Socket verwalten
    _setupPageVisibility() {
        let streamWasActive = false;
        let controlStreamWasActive = false;
        const self = this;

        document.addEventListener('visibilitychange', function() {
            const cameraEl = document.getElementById('camera-stream');
            const controlImg = document.getElementById('control-camera');

            // WebRTC mode: pause/resume or reconnect
            if (window._cameraMode === 'webrtc' && cameraEl && cameraEl.tagName === 'VIDEO') {
                if (document.hidden) {
                    cameraEl.pause();
                    console.log('WebRTC paused (tab hidden)');
                } else {
                    if (cameraEl.srcObject) {
                        cameraEl.play().catch(function() {});
                    } else {
                        self.startWebRTCStream();
                    }
                    console.log('WebRTC resumed');
                }
                return;
            }

            // MJPEG mode: im Hintergrund Stream/Polling pausieren, vorne fortsetzen.
            if (window._cameraMode === 'mjpeg') {
                if (document.hidden) {
                    self.stopSnapshotPolling();
                    self._stopKlipperPoll();   // Klipper-Dauer-MJPEG-Verbindung schließen
                    console.log('⏸️ Kamera pausiert (Tab im Hintergrund)');
                } else {
                    self.startSnapshotPolling();   // Klipper-Mode: leitet auf _initKlipperCamera um
                    console.log('▶️ Kamera fortgesetzt');
                }
            }

            // Control camera + legacy behavior
            if (document.hidden) {
                if (cameraEl && cameraEl.src && cameraEl.src.indexOf('/api/') !== -1 && window._cameraMode !== 'mjpeg') {
                    streamWasActive = true;
                    cameraEl.dataset.originalSrc = cameraEl.src.split('?')[0];
                    cameraEl.src = '';
                    cameraEl.onerror = null;
                }
                if (controlImg && controlImg.src && controlImg.src.indexOf('/api/') !== -1) {
                    controlStreamWasActive = true;
                    controlImg.dataset.originalSrc = controlImg.src.split('?')[0];
                    controlImg.src = '';
                    controlImg.onerror = null;
                    console.log('⏸️ Control-Kamera pausiert (Tab im Hintergrund)');
                }
                if (self.streamRetryTimeout) {
                    clearTimeout(self.streamRetryTimeout);
                    self.streamRetryTimeout = null;
                }
                if (window.cameraRefreshInterval) {
                    clearInterval(window.cameraRefreshInterval);
                    window.cameraRefreshInterval = null;
                }
            } else {
                // Tab/App ist wieder im Vordergrund → Streams SOFORT fortsetzen
                if (streamWasActive) {
                    if (cameraEl && window._cameraMode === 'mjpeg' && cameraEl.dataset.originalSrc) {
                        const baseSrc = cameraEl.dataset.originalSrc;
                        cameraEl.src = baseSrc + '?t=' + Date.now();
                        streamWasActive = false;
                        console.log('▶️ Kamera-Stream fortgesetzt');

                        // Error-Handler mit Retry
                        let retryCount = 0;
                        cameraEl.onerror = function() {
                            if (retryCount < 3) {
                                retryCount++;
                                setTimeout(() => {
                                    cameraEl.src = baseSrc + '?t=' + Date.now();
                                }, 1000 * retryCount);
                            } else {
                                cameraEl.onerror = null;
                            }
                        };
                    }
                } else if (cameraEl && cameraEl.dataset.pipPaused &&
                           (!window.pipWindow || window.pipWindow.closed) &&
                           !window.electronPipActive) {
                    // PiP wurde geschlossen während Fenster minimiert war → jetzt fortsetzen
                    cameraEl.src = cameraEl.dataset.pipPaused + '?t=' + Date.now();
                    delete cameraEl.dataset.pipPaused;
                    console.log('▶️ Camera stream resumed (PiP was closed while minimised)');
                }
                if (controlStreamWasActive && controlImg && controlImg.dataset.originalSrc
                        && window._cameraMode !== 'off' && !window._cameraOff) {
                    const baseSrc = controlImg.dataset.originalSrc;
                    controlImg.src = baseSrc + '?t=' + Date.now();
                    controlStreamWasActive = false;
                    console.log('▶️ Control-Kamera fortgesetzt');
                }
            }
        });
    }

    // ============= Safari Stream Fix =============
    setupSafariStreamFix() {
        const texts = window.texts || {};
        if (window._cameraMode === 'webrtc') return; // WebRTC handles its own recovery
        if (window._snapshotPolling) return; // Snapshot polling handles its own recovery
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (!window.isSafari) return;

        let reloadAttempts = 0;
        const maxReloads = 3;

        // Kamera Reload mit Timeout
        function checkCameraLoad() {
            const img = document.getElementById('camera-stream');
            const placeholder = document.getElementById('camera-placeholder');

            if (!img) return;

            // Nach 2 Sekunden prüfen ob Kamera sichtbar ist
            setTimeout(() => {
                // Wenn Kamera nicht sichtbar ist (noch Placeholder)
                if (placeholder && placeholder.style.display !== 'none') {
                    reloadAttempts++;
                    console.log(texts.console_camera_not_loaded_attempt + ' ' + reloadAttempts);

                    if (window._cameraMode !== 'mjpeg' || window._cameraOff) return;
                    if (reloadAttempts <= maxReloads && !img.dataset.pipPaused) {
                        // Neuer Versuch (nicht wenn PiP aktiv)
                        const newSrc = '/api/camera?t=' + Date.now();
                        img.src = newSrc;

                        // Nächsten Check planen
                        checkCameraLoad();
                    } else {
                        console.log(texts.console_camera_could_not_load);
                    }
                } else {
                    // Kamera erfolgreich geladen
                    reloadAttempts = 0;
                    console.log(texts.console_camera_loaded);
                }
            }, 2000);
        }

        // Initial Check starten
        checkCameraLoad();

        // Periodischer Refresh alle 5 Minuten (nicht wenn PiP aktiv)
        setInterval(() => {
            if (window._cameraMode !== 'mjpeg' || window._cameraOff || window._snapshotPolling) return;
            const img = document.getElementById('camera-stream');
            if (img && img.style.display !== 'none' && !img.dataset.pipPaused) {
                const newSrc = img.src.split('?')[0] + '?t=' + Date.now();
                img.src = newSrc;
                console.log(texts.console_safari_preventive_refresh);
            }
        }, 300000);
    }

    // ============= Camera Source Toggle (Control Tab) =============
    async toggleControlCameraSource() {
        // Klipper: cycle wie der Hauptbild-Cycler. Wir setzen die Cams in
        // beide <img> (control-camera + camera-stream) gleichzeitig.
        if (window.isKlipperMode && window.isKlipperMode()) {
            this._cycleKlipperCamera();
            const sources = this._klipperSources || [];
            const s = sources[this._klipperSourceIdx || 0];
            if (s && s.url) {
                const ctrl = document.getElementById('control-camera');
                if (ctrl) {
                    ctrl.src = s.url + (s.url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
                    const tf = [];
                    if (s.rotation) tf.push('rotate(' + s.rotation + 'deg)');
                    if (s.flip_horizontal) tf.push('scaleX(-1)');
                    if (s.flip_vertical) tf.push('scaleY(-1)');
                    ctrl.style.transform = tf.join(' ');
                }
                const ctrlLbl = document.getElementById('control-camera-source');
                if (ctrlLbl) ctrlLbl.innerHTML = window.skIcon('kamera', 'hd-ic--xs') + ' ' + (s.label || s.id);
            }
            return;
        }
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/camera/source', { method: 'POST' });
            const data = await response.json();

            if (data.success) {
                // Update beide Kameras
                const controlImg = document.getElementById('control-camera');
                const mainImg = document.getElementById('camera-stream');

                // CPU-optimierter Camera-Stream
                const timestamp = Math.floor(Date.now() / 5000) * 5000; // Nur alle 5s neue URL
                const newSrc = `/api/camera?v=${timestamp}&quality=medium`; // Niedrigere Qualität

                // Image Loading mit Performance-Check
                const tempImg = new Image();
                tempImg.onload = function() {
                    if (controlImg) controlImg.src = newSrc;
                    if (mainImg) mainImg.src = newSrc;
                    console.log(texts.console_camera_stream_updated);
                };
                tempImg.onerror = function() {
                    console.error(texts.console_camera_stream_error);
                };
                tempImg.src = newSrc;

                if (controlImg) controlImg.src = newSrc;
                if (mainImg) mainImg.src = newSrc;

                // Update beide Buttons
                const texte = window.texts || {};
        const sourceText = data.source === 'external'
            ? (texte.camera_external || 'Externe Kamera')
            : (texte.camera_builtin || 'P1S Kamera');

                document.getElementById('control-camera-source').textContent = sourceText;
                document.getElementById('camera-source-text').textContent =
                    data.source === 'external' ? 'P1S Kamera' : 'Externe Kamera';

                // Zeige Info wenn P1S Kamera automatisch neugestartet wurde
                if (data.auto_restarted) {
                    skToast(`P1S Kamera neugestartet: ${data.restart_reason}`, 'info');
                }
            }
        } catch (error) {
            console.error(texts.console_camera_toggle_error + ':', error);
        }
    }

    // ============= Camera UI Functions =============
    async toggleCameraSource() {
        // Klipper-Mode: nicht den /api/camera/source-Bambu-Toggle anrufen,
        // sondern durch die Klipper-Cams cyclen.
        if (window.isKlipperMode && window.isKlipperMode()) {
            this._cycleKlipperCamera();
            return;
        }

        // Bambu: eine Quelle — Kick fuer eine eingefrorene Pipeline,
        // danach Modus neu verhandeln (docs/kamera-architektur.md).
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/camera/source', { method: 'POST' });
            const data = await response.json();
            if (data.success && data.auto_restarted) {
                skToast((texts.camera_restarted || 'Kamera neu gestartet') + ': ' + data.restart_reason, 'info');
            }
            this._initCamera();
        } catch (error) {
            window.skToast(texts.alert_camera_toggle_error);
        }
    }

    /** Kamera-Vorschau im Steuerungs-Modal (#control-camera) — laut
     *  Kontrakt: bei WebRTC denselben MediaStream als zweite Senke, bei
     *  MJPEG Snapshot-Polling mit 1 fps, bei aus nichts. */
    attachControlPreview() {
        this.detachControlPreview();
        let el = document.getElementById('control-camera');
        if (!el) return;

        if (window.isKlipperMode && window.isKlipperMode()) {
            const s = (this._klipperSources || [])[this._klipperSourceIdx || 0];
            if (s && s.url) el.src = s.url + (s.url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
            return;
        }
        if (window._cameraMode === 'off' || window._cameraOff) return;

        if (window._cameraMode === 'webrtc' && window._webrtcPC) {
            const haupt = document.getElementById('camera-stream');
            if (haupt && haupt.tagName === 'VIDEO' && haupt.srcObject) {
                const video = document.createElement('video');
                video.id = 'control-camera';
                video.className = el.className;
                video.autoplay = true; video.muted = true; video.playsInline = true;
                video.srcObject = haupt.srcObject;
                el.parentNode.replaceChild(video, el);
                video.play().catch(() => {});
                return;
            }
        }

        // MJPEG: 1-fps-Snapshots — genug fuer die kleine Vorschau, und die
        // Pipeline stirbt 45 s nach dem Schliessen von selbst.
        if (el.tagName === 'VIDEO') {
            const img = document.createElement('img');
            img.id = 'control-camera';
            img.className = el.className;
            el.parentNode.replaceChild(img, el);
            el = img;
        }
        const poll = () => {
            const ziel = document.getElementById('control-camera');
            if (!ziel || ziel.tagName !== 'IMG') return;
            const tmp = new Image();
            tmp.onload = () => { ziel.src = tmp.src; this._ctrlPreviewTimer = setTimeout(poll, 1000); };
            tmp.onerror = () => { this._ctrlPreviewTimer = setTimeout(poll, 2000); };
            tmp.src = '/api/camera/snapshot?t=' + Date.now();
        };
        poll();
    }

    detachControlPreview() {
        if (this._ctrlPreviewTimer) {
            clearTimeout(this._ctrlPreviewTimer);
            this._ctrlPreviewTimer = null;
        }
        const el = document.getElementById('control-camera');
        if (!el) return;
        if (el.tagName === 'VIDEO') {
            el.srcObject = null;
            const img = document.createElement('img');
            img.id = 'control-camera';
            img.className = el.className;
            el.parentNode.replaceChild(img, el);
        } else {
            el.removeAttribute('src');
        }
    }

    togglePiP() {
        const texts = window.texts || {};
        // WebRTC mode: native video PiP
        if (window._cameraMode === 'webrtc') {
            const video = document.getElementById('camera-stream');
            if (video && video.tagName === 'VIDEO') {
                if (document.pictureInPictureElement === video) {
                    document.exitPictureInPicture().catch(function() {});
                } else {
                    video.requestPictureInPicture().catch(function(e) {
                        console.error('PiP error:', e);
                        // Fallback to window PiP
                        window.cameraManager.openWindowPiP();
                    });
                }
                return;
            }
        }

        // iOS Detection
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      window.location.search.includes('app=ios');

        if (isIOS) {
            // iOS kann kein PiP für img-Elemente, nur für video
            // Als Workaround: Öffne Stream in neuem Fenster
            const cameraImg = document.getElementById('camera-stream');
            if (cameraImg) {
                const pipWindow = window.open('/pip', 'PiP_Camera', 'width=320,height=180');
                if (!pipWindow) {
                    window.skToast(texts.alert_popup_blocked);
                }
            }
        } else {
            // Browser Fallback
            this.openWindowPiP();
        }
    }

    toggleFullscreen() {
        const texts = window.texts || {};
        const elem = document.getElementById('camera-stream');
        if (!elem) {
            console.log(texts.console_camera_element_not_found);
            return;
        }

        // WebRTC mode: native video fullscreen
        if (window._cameraMode === 'webrtc' && elem.tagName === 'VIDEO') {
            if (document.fullscreenElement === elem) {
                document.exitFullscreen().catch(function() {});
            } else if (elem.requestFullscreen) {
                elem.requestFullscreen().catch(function() {});
            } else if (elem.webkitEnterFullscreen) {
                elem.webkitEnterFullscreen(); // Safari/iOS
            }
            return;
        }

        // iOS Detection
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      window.location.search.includes('app=ios');

        // Check if already in fullscreen
        const existingContainer = document.getElementById('fullscreen-container');
        if (existingContainer) {
            existingContainer.remove();
            return;
        }

        // Container für Vollbild erstellen
        const fullscreenContainer = document.createElement('div');
        fullscreenContainer.id = 'fullscreen-container';

        if (isIOS) {
            // iOS: Fixed positioning ohne Fullscreen API
            fullscreenContainer.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999; background:#000; display:flex; align-items:center; justify-content:center;';
        } else {
            // Browser: Normal mit Fullscreen API
            fullscreenContainer.style.cssText = 'position:relative; width:100%; height:100%; background:#000; display:flex; align-items:center; justify-content:center;';
        }

        // Bild klonen für Vollbild
        const fullscreenImg = elem.cloneNode(true);
        fullscreenImg.id = 'fullscreen-camera-stream';
        fullscreenImg.style.cssText = 'max-width:100%; max-height:100%; transition:transform 0.3s ease; transform-origin:center;';
        // Kamera-Rotation/Flip erhalten — die cssText-Zuweisung oben hat die Transform
        // gedroppt; sonst wäre das Vollbild auf dem Kopf und der Fullscreen-Zoom verlöre sie.
        const fsBase = elem.dataset.baseTransform || elem.style.transform || '';
        fullscreenImg.dataset.baseTransform = fsBase;
        if (fsBase) fullscreenImg.style.transform = fsBase;

        // Zoom-Controls für Vollbild
        const zoomControls = document.createElement('div');
        zoomControls.innerHTML = `
            <div style="position:absolute; bottom:20px; left:20px; display:flex; gap:8px; z-index:1000;">
                <button onclick="fullscreenZoomOut()" style="background:rgba(0,0,0,0.7); color:white; border:none; width:40px; height:40px; border-radius:50%; font-size:20px; backdrop-filter:blur(10px); cursor:pointer;">−</button>
                <button onclick="fullscreenZoomReset()" style="background:rgba(0,0,0,0.7); color:white; border:none; padding:0 15px; height:40px; border-radius:20px; font-size:12px; backdrop-filter:blur(10px); cursor:pointer;">${texts.zoom_reset}</button>
                <button onclick="fullscreenZoomIn()" style="background:rgba(0,0,0,0.7); color:white; border:none; width:40px; height:40px; border-radius:50%; font-size:20px; backdrop-filter:blur(10px); cursor:pointer;">+</button>
            </div>
            <button onclick="exitFullscreen()" style="position:absolute; top:20px; right:20px; background:rgba(0,0,0,0.7); color:white; border:none; padding:10px 20px; border-radius:8px; font-size:14px; backdrop-filter:blur(10px); cursor:pointer;">✕ ${texts.exit_fullscreen}</button>
        `;

        fullscreenContainer.appendChild(fullscreenImg);
        fullscreenContainer.appendChild(zoomControls);
        document.body.appendChild(fullscreenContainer);

        // Nur für Browser versuchen wir echtes Fullscreen
        if (!isIOS) {
            if (fullscreenContainer.requestFullscreen) {
                fullscreenContainer.requestFullscreen();
            } else if (fullscreenContainer.webkitRequestFullscreen) {
                fullscreenContainer.webkitRequestFullscreen();
            }
        }

        // Mausrad-Zoom
        fullscreenImg.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            fullscreenZoomAtPosition(delta, e.clientX, e.clientY);
        });
    }

    // HQ Status beim Laden abrufen
    async initHQStatus() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/camera/quality');
            const data = await response.json();

            if (data.enabled && data.quality === 'hq') {
                this.isHQMode = true;
                const hqBtn = document.getElementById('hq-button');
                const hqText = document.getElementById('hq-text');
                if (hqBtn && hqText) {
                    hqText.textContent = 'HD';
                    hqBtn.style.background = 'rgba(255, 107, 0, 0.2)';
                    hqBtn.style.borderColor = '#ff6b00';
                }
            }
        } catch (error) {
            console.log(texts.console_hq_status_load_failed);
        }
    }

    initCameraSourceButton() {
        // Config aus Backend (via JINJA_CONFIG)
        const ustreamerEnabled = window.JINJA_CONFIG.ustreamerEnabled;

        // Buttons nur anzeigen, wenn µStreamer aktiviert ist
        if (ustreamerEnabled) {
            const dashboardBtn = document.getElementById('camera-source-toggle-btn');
            const controlBtn = document.getElementById('control-camera-source-toggle-btn');

            if (dashboardBtn) {
                dashboardBtn.style.display = 'flex';
            }
            if (controlBtn) {
                controlBtn.style.display = 'block';
            }
        }
    }

    async toggleHQMode() {
        if (window._cameraMode === 'off' || window._cameraOff) return;
        const texts = window.texts || {};
        const hqBtn = document.getElementById('hq-button');
        const hqText = document.getElementById('hq-text');
        const overlay = document.getElementById('camera-loading-overlay');
        const img = document.getElementById('camera-stream');

        if (!hqBtn || !hqText || !overlay || !img) return;

        try {
            // Loading-Zustand anzeigen
            hqBtn.disabled = true;
            hqText.innerHTML = window.skIcon('sanduhr', 'hd-ic--xs');
            overlay.style.display = 'flex';

            const oldSrc = img.src;

            const response = await apiCall('/api/camera/quality', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    quality: this.isHQMode ? 'normal' : 'hq'
                })
            });

            const data = await response.json();

            if (data.success) {
                this.isHQMode = !this.isHQMode;

                // Button-Stil aktualisieren
                if (this.isHQMode) {
                    hqText.textContent = 'HD';
                    hqBtn.classList.add('active');
                } else {
                    hqText.textContent = 'SD';
                    hqBtn.classList.remove('active');
                }

                if (window._cameraMode === 'webrtc') {
                    // WebRTC: quality change not supported at runtime, just hide overlay
                    overlay.style.display = 'none';
                } else {
                    setTimeout(() => {
                        img.src = oldSrc.split('?')[0] + '?t=' + Date.now();
                        setTimeout(() => { overlay.style.display = 'none'; }, 500);
                    }, 2000);
                }

            } else {
                window.skToast(texts.alert_quality_switch_failed + ': ' + (data.error || texts.toast_unknown_error));
                overlay.style.display = 'none';
            }
        } catch (error) {
            console.error(texts.console_hq_toggle_error + ':', error);
            window.skToast(texts.alert_connection_error_switch);
            overlay.style.display = 'none';
        } finally {
            setTimeout(() => {
                 hqBtn.disabled = false;
            }, 4000);
        }
    }

    // ============= PiP Stream Management =============

    // Pausiert den Hauptstream und setzt pipPaused Flag
    pauseMainStreamForPiP() {
        // WebRTC: Passthrough kostet nichts — Hauptstream laeuft weiter,
        // es gibt keine img-src zum Parken.
        if (window._cameraMode === 'webrtc') return;
        // Klipper-Direct: das Snapshot-Polling STOPPEN — sonst läuft der Hauptstream
        // parallel zum PiP weiter (zwei Streams gegen die Kamera). Nur die img-src zu
        // leeren reicht nicht, der Poll setzt sie sofort wieder.
        if (window.isKlipperMode && window.isKlipperMode()) {
            this._stopKlipperPoll();
            const mainImg = document.getElementById('camera-stream');
            if (mainImg) { mainImg.dataset.pipPaused = '1'; mainImg.style.display = 'none'; mainImg.removeAttribute('src'); }
            // Hinweis im Hauptbild: Kamera läuft jetzt im PiP-Fenster (sonst nur schwarz).
            const ph = document.getElementById('camera-placeholder');
            if (ph) {
                ph.style.display = 'flex';
                ph.dataset.pip = '1';
                const txt = ph.querySelector('#camera-loading-text');
                if (txt) txt.textContent = (window.t && window.t('camera_in_pip')) || 'Kamera läuft im PiP-Fenster';
            }
            console.log('⏸️ Klipper-Snapshot-Polling pausiert (PiP aktiv)');
            return;
        }
        const mainImg = document.getElementById('camera-stream');
        if (mainImg && mainImg.src && mainImg.src.indexOf('/api/') !== -1) {
            mainImg.dataset.pipPaused = mainImg.src.split('?')[0];
            mainImg.src = '';
            mainImg.onerror = null; // Error-Handler deaktivieren damit Stream nicht auto-restartet
            console.log('⏸️ Kamera-Stream pausiert (PiP aktiv)');
        }
    }

    // Stellt den Hauptstream wieder her wenn PiP geschlossen wird
    resumeMainStreamFromPiP() {
        // Klipper-Direct: Snapshot-Polling wieder starten (Source + Transform).
        if (window.isKlipperMode && window.isKlipperMode()) {
            const mainImg = document.getElementById('camera-stream');
            if (mainImg) delete mainImg.dataset.pipPaused;
            const ph = document.getElementById('camera-placeholder');
            if (ph && ph.dataset.pip) { ph.style.display = 'none'; delete ph.dataset.pip; }
            if (this._klipperSources && this._klipperSources.length) this._setKlipperCamera(this._klipperSourceIdx || 0);
            else this._initKlipperCamera();
            console.log('▶️ Klipper-Snapshot-Polling fortgesetzt (PiP geschlossen)');
            return;
        }
        const img = document.getElementById('camera-stream');
        if (img && img.dataset.pipPaused) {
            img.src = img.dataset.pipPaused + '?t=' + Date.now();
            delete img.dataset.pipPaused;
            console.log('▶️ Kamera-Stream fortgesetzt (PiP geschlossen)');
        }
    }

    openWindowPiP() {
        // ===== ELECTRON: Natives frameless PiP-Fenster (wie Chrome PiP Extension) =====
        if (window.electronAPI && window.electronAPI.pip) {
            const cameraUrl = window.location.origin + '/api/camera';
            window.electronAPI.pip.open(cameraUrl).then(result => {
                if (result.opened) {
                    window.electronPipActive = true;
                    this.pauseMainStreamForPiP();
                } else {
                    // Toggle: PiP wurde geschlossen
                    window.electronPipActive = false;
                    this.resumeMainStreamFromPiP();
                }
            });
            return;
        }

        // ===== BROWSER: Fallback mit window.open =====
        if (window.pipWindow && !window.pipWindow.closed) {
            window.pipWindow.close();
            window.pipWindow = null;
            this.resumeMainStreamFromPiP();
        } else {
            // /pip verhandelt selbst (WebRTC wenn moeglich, sonst Snapshots)
            window.pipWindow = window.open('/pip', 'PiP_Camera', 'width=320,height=180,resizable=yes');
            if (window.pipWindow) {
                this.pauseMainStreamForPiP();

                // Wenn PiP-Fenster geschlossen wird → Stream wieder starten
                const self = this;
                const checkPipClosed = setInterval(() => {
                    if (!window.pipWindow || window.pipWindow.closed) {
                        clearInterval(checkPipClosed);
                        window.pipWindow = null;
                        if (!document.hidden) {
                            self.resumeMainStreamFromPiP();
                        }
                    }
                }, 500);
            }
        }
    }
}

window.cameraManager = new CameraManager();

// Backwards compatibility - all functions called from HTML onclick handlers:
window.handleCameraError = () => window.cameraManager.handleCameraError();
window.startWebRTCStream = () => window.cameraManager.startWebRTCStream();
window.stopWebRTCStream = () => window.cameraManager.stopWebRTCStream();
window.startSnapshotPolling = () => window.cameraManager.startSnapshotPolling();
window.stopSnapshotPolling = () => window.cameraManager.stopSnapshotPolling();
window.recheckCameraMode = () => window.cameraManager.recheckCameraMode();
window.toggleCameraSource = () => window.cameraManager.toggleCameraSource();
window.toggleControlCameraSource = () => window.cameraManager.toggleControlCameraSource();
window.togglePiP = () => window.cameraManager.togglePiP();
window.toggleCameraPlayPause = () => window.cameraManager.toggleCameraPlayPause();
window.toggleFullscreen = () => window.cameraManager.toggleFullscreen();
window.toggleHQMode = () => window.cameraManager.toggleHQMode();
window.initHQStatus = () => window.cameraManager.initHQStatus();
window.initCameraSourceButton = () => window.cameraManager.initCameraSourceButton();
window.pauseMainStreamForPiP = () => window.cameraManager.pauseMainStreamForPiP();
window.resumeMainStreamFromPiP = () => window.cameraManager.resumeMainStreamFromPiP();
window.openWindowPiP = () => window.cameraManager.openWindowPiP();
window.setupSafariStreamFix = () => window.cameraManager.setupSafariStreamFix();
