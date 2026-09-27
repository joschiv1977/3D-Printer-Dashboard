/**
 * Camera Manager
 * Handles all camera streaming modes (live H.264 via camera-live.js, MJPEG,
 * snapshot polling),
 * PiP, fullscreen, source toggling, and page visibility
 */
// Icons for the play/pause button over the image — same style as the
// markup (24-unit grid, stroke in currentColor), so the switch doesn't
// jump from SVG to a Unicode character.
const KAMERA_PAUSE = '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
const KAMERA_START = '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l12 8-12 8z"/></svg>';

class CameraManager {
    constructor() {
        const texts = window.texts || {};

        // Camera mode globals: 'live' | 'mjpeg' | 'off'
        window._cameraMode = 'mjpeg'; // default
        window._liveKamera = null;
        window._cameraOff = false;
        window._snapshotPolling = null;

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

    // Play/pause toggle (like Android): manually pauses/resumes the live stream.
    toggleCameraPlayPause() {
        const texts = window.texts || {};
        const icon = document.getElementById('camera-playpause-icon');
        const txt = document.getElementById('camera-playpause-text');
        this._manualPaused = !this._manualPaused;
        if (this._manualPaused) {
            // Pausing: stop all stream variants.
            window._cameraPaused = true;
            this._stopKlipperPoll();
            this.stopSnapshotPolling();
            this.stopLiveStream();
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
            // Resuming.
            window._cameraPaused = false;
            if (icon) icon.innerHTML = KAMERA_PAUSE;
            if (txt) txt.textContent = texts.camera_pause || 'Pause';
            this._initCamera();
        }
    }

    // ============= Live camera (H.264, every frame drawn on arrival) / MJPEG =============

    /**
     * Periodically write out a small still image.
     *
     * It survives a page change (sessionStorage), but not closing the
     * window — same rule as in Android: the bridge holds for this
     * session, not forever.
     *
     * 320 pixels wide, JPEG at 0.6 — about ten kilobytes. One every ten
     * seconds is enough: it's meant to show what was last visible, not
     * replace the stream.
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
                // Nothing drawn yet, or storage is full — then just
                // try again next time.
            }
        };
        // The first one, as soon as something has actually been drawn.
        if (video.requestVideoFrameCallback) {
            video.requestVideoFrameCallback(schreibe);
        } else {
            setTimeout(schreibe, 2000);
        }
        window._bildMerker = setInterval(schreibe, 10000);
    }

    /**
     * The live picture (camera-live.js): H.264 from /api/camera/live, each
     * frame drawn the moment it arrives, shown in the same <video> as
     * before -- fullscreen, PiP and the control preview use it unchanged.
     */
    startLiveStream() {
        this.stopLiveStream();
        if (!window.KameraLive || !window.KameraLive.moeglich()) {
            // No WebCodecs in this browser: single pictures instead.
            console.log('📹 No WebCodecs here -- snapshot polling instead');
            window._cameraMode = 'mjpeg';
            this.startSnapshotPolling();
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

        // The last picture of this session stands in until the stream
        // draws (poster goes away by itself). Not /api/camera/snapshot:
        // that would start the ffmpeg pipeline on the server for 45 s.
        try {
            const gemerkt = sessionStorage.getItem('kamera_letztes_bild');
            if (gemerkt) el.poster = gemerkt;
        } catch (_) {}

        const t0 = performance.now();
        const live = new window.KameraLive({
            onErstesBild: () => {
                console.log(`📹 Live camera: first frame after ${Math.round(performance.now() - t0)} ms`);
                const ph = document.getElementById('camera-placeholder');
                if (ph) ph.style.display = 'none';
                el.style.display = 'block';
                this.merkeBilderVon(el);
            },
            onAufgegeben: () => {
                // No connection after several tries: ask again what there
                // is (the printer may have gone off).
                if (window._liveKamera === live) window._liveKamera = null;
                this.planeNachfrage();
            },
        });
        window._liveKamera = live;
        el.srcObject = live.start();
        el.play().catch(function() {});
    }

    stopLiveStream() {
        if (window._liveKamera) {
            window._liveKamera.stop();
            window._liveKamera = null;
        }
        // The frame keeper goes with the stream. It did nothing without a
        // picture (it checks videoWidth), but it stayed behind on every stop
        // and woke the window every ten seconds for nothing (17sep26).
        if (window._bildMerker) {
            clearInterval(window._bildMerker);
            window._bildMerker = null;
        }
        const el = document.getElementById('camera-stream');
        if (el && el.tagName === 'VIDEO' && el.srcObject) {
            el.srcObject = null;
        }
    }

    // Snapshot-Polling for MJPEG via Cloudflare (multipart/x-mixed-replace gets buffered)
    startSnapshotPolling() {
        if (window._snapshotPolling) return;
        // Klipper mode has no /api/camera/snapshot — the stream is direct
        // mjpeg via our Klipper proxy (see _initKlipperCamera).
        // Callers like recheckCameraMode or tab-visible recovery could end
        // up here — we switch cleanly to the Klipper init instead.
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
                        txt.textContent = (window.texts || {}).camera_no_signal
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

    /** After the MJPEG fallback, check once whether the live picture has
     *  since become available -- if so, switch over. */
    _scheduleLiveRecheck() {
        if (this._liveRecheck) return;
        this._liveRecheck = true;
        setTimeout(async () => {
            this._liveRecheck = false;
            if (window._cameraMode !== 'mjpeg') return;
            try {
                const r = await apiCall('/api/camera/mode?live=1');
                const d = await r.json();
                if (d.type === 'live' && window.KameraLive && window.KameraLive.moeglich()) {
                    console.log('📹 Live camera available now -- switching from MJPEG');
                    this.stopSnapshotPolling();
                    window._cameraMode = 'live';
                    this.startLiveStream();
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

            // Multi-printer phase 3: wait until the printer adapter is loaded
            // AND `loadPrinterInfo()` has finished. Otherwise Klipper mode
            // would be detected wrong (default is 'bambu') and the
            // CameraManager would ping /api/camera (the Bambu path) -> error spam.
            //
            // The operating mode is already known server-side via the body
            // attribute (data-active-printer) though — so the mode lookup
            // doesn't need the adapter. Hence in parallel: request
            // /api/camera/mode immediately while waiting for the adapter.
            // Doing these sequentially cost up to a second of dead time.
            const modusVorab = (window.isKlipperMode && window.isKlipperMode())
                ? null
                : apiCall('/api/camera/mode?live=1').then(r => r.json()).catch(() => null);
            for (let i = 0; i < 40 && !window.printerAdapter; i++) {
                await new Promise(r => setTimeout(r, 25));
            }
            if (window.printerAdapter && window.printerAdapter.ready) {
                try { await window.printerAdapter.ready; } catch (_) {}
            }
            if (window.isKlipperMode && window.isKlipperMode()) {
                return this._initKlipperCamera();
            }

            // Use the pre-fetched request (already running since the adapter wait);
            // only ask again if it failed.
            const data = (await modusVorab)
                || await apiCall('/api/camera/mode?live=1').then(r => r.json());
            console.log('Camera mode response:', data);

            if (data.type === 'off') {
                window._cameraOff = true;
                window._cameraMode = 'off';
                const img = document.getElementById('camera-stream');
                if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
                const ph = document.getElementById('camera-placeholder');
                if (ph) ph.style.display = 'flex';
                this.zeigeAus(data.reason);
                console.log('Camera off:', data.reason || 'off');
                // Loaded while the printer boots: the socket already says
                // "on", so no switch change will come to ask again -- ask
                // on our own until the camera is there.
                this.planeNachfrage();
                return;
            }

            if (data.type === 'live') {
                window._cameraMode = 'live';
                console.log('Camera mode: live (H.264, every frame on arrival)');
                this.startLiveStream();
                return;
            }

            // MJPEG fallback (snapshot polling) -- the printer has no RTSP
            // camera yet (still booting) or none at all. Check once later
            // whether the live picture is there by now, otherwise the client
            // stays stuck polling and keeps the server's ffmpeg pipeline alive.
            window._cameraMode = 'mjpeg';
            console.log('Camera mode: MJPEG (snapshot polling)');
            this.startSnapshotPolling();
            this._scheduleLiveRecheck();
        } catch (e) {
            console.log('Camera mode detection failed, using snapshot polling:', e);
            window._cameraMode = 'mjpeg';
            this.startSnapshotPolling();
        }
    }

    // ============= Klipper camera =============
    // Multi-printer phase 3: Klipper cams are direct mjpeg URLs, the
    // browser can handle that without a proxy/polling. With multiple cams
    // the existing camera-source-toggle-btn cycles through all of them.
    async _initKlipperCamera() {
        if (this._manualPaused) return;   // manually paused -> don't auto-restart
        this._stopKlipperPoll();   // stop old polling (re-init/reconnect)
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
                    (window.texts || {}).camera_no_klipper_camera || 'Keine Klipper-Kamera gefunden';
                window._cameraMode = 'off';
                return;
            }

            window._cameraMode = 'mjpeg';
            window._cameraOff = false;
            this._setKlipperCamera(0);

            // Show the toggle button when there's >1 cam — initCameraSourceButton
            // only does that for uStreamer. Trigger it separately here.
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

        // Image orientation from Moonraker (server.webcams.list rotation/flip) as
        // a CSS transform — e.g. the eMeet C960 is mounted at 180° (rotation:180).
        const tf = [];
        if (s.rotation) tf.push('rotate(' + s.rotation + 'deg)');
        if (s.flip_horizontal) tf.push('scaleX(-1)');
        if (s.flip_vertical) tf.push('scaleY(-1)');
        const transform = tf.join(' ');
        // Remember baseTransform -> zoom combines it with scale() instead of
        // overwriting it (otherwise the image flips upside down on zoom/reset).
        if (img) { img.style.display = 'block'; img.style.transform = transform; img.dataset.baseTransform = transform; }
        if (controlImg) { controlImg.style.transform = transform; controlImg.dataset.baseTransform = transform; }
        if (ph) ph.style.display = 'none';

        // Update the source label — the same span Bambu uses.
        const lbl = document.getElementById('camera-source-text');
        if (lbl) lbl.textContent = s.label || s.id;
        const ctrlLbl = document.getElementById('control-camera-source');
        if (ctrlLbl) ctrlLbl.innerHTML = window.skIcon('kamera', 'hd-ic--xs') + ' ' + (s.label || s.id);

        // Continuous MJPEG (?action=stream) via the adapter proxy — like
        // Android locally: one open stream, the browser decodes the frames ->
        // smooth (instead of choppy snapshot polling). The proxy cuts off stalls
        // after 15s, the reconnect below then connects again.
        this._startKlipperMjpeg(s);
    }

    // Stops running polling/MJPEG (before a source switch / camera off).
    _stopKlipperPoll() {
        const p = this._klipperPoll;
        if (!p) return;
        if (p.timer) clearTimeout(p.timer);
        if (p.loader) { p.loader.onload = null; p.loader.onerror = null; }
        // MJPEG: detach onerror + close the stream (clear src), otherwise the
        // connection keeps running and an onerror would incorrectly reconnect.
        if (p.imgs) p.imgs.forEach((el) => { el.onerror = null; try { el.removeAttribute('src'); } catch (_) {} });
        this._klipperPoll = null;
    }

    // Continuous MJPEG (the port's counterpart to Android's processMJPEGStream): one
    // open stream per <img> to the proxy stream URL. On a stall/error (the proxy
    // cuts it off after 15s) onerror fires -> reconnect with a cache-buster.
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

    // Reacts to the printer connection (Socket.IO mqtt_status). Klipper direct:
    // printer OFF -> stop snapshot polling (otherwise the image loader fires
    // endless 404s against the unreachable camera) and show the placeholder;
    // printer ON -> reinitialize the camera (only if no poll is already running).
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
            if (txt) txt.textContent = (window.texts || {}).camera_off || 'Kamera aus (Drucker aus)';
        }
    }

    _cycleKlipperCamera() {
        const sources = this._klipperSources || [];
        if (sources.length < 2) return;
        this._klipperSourceIdx = (this._klipperSourceIdx + 1) % sources.length;
        this._setKlipperCamera(this._klipperSourceIdx);
    }

    // Re-check camera mode (e.g., after MQTT reconnect when printer turns on)
    /** Why there is no picture: the printer boots ("Drucker startet…"),
     *  or it is off. */
    zeigeAus(grund) {
        const txt = document.getElementById('camera-loading-text');
        if (!txt) return;
        const texts = window.texts || {};
        txt.textContent = grund === 'booting'
            ? (texts.status_booting || 'Drucker startet…')
            : (texts.camera_off || 'Kamera aus (Drucker aus)');
    }

    /** "off" is no final answer: the server means "ask again in three
     *  seconds" (routes/camera.py). One question pending at a time, whoever
     *  plans it -- the page load, the socket's switch change, a live stream
     *  that gave up. */
    planeNachfrage() {
        clearTimeout(this._nachfrageTimer);
        this._nachfrageTimer = setTimeout(() => {
            this._nachfrageTimer = null;
            this.recheckCameraMode();
        }, 3000);
    }

    async recheckCameraMode() {
        // In Klipper mode we have no `/api/camera/mode` detection (a Bambu-
        // specific endpoint that can throw errors without a Bambu stack).
        // Repeat the Klipper init instead — it pulls sources again
        // and sets the `<img>` to the right cam.
        if (window.isKlipperMode && window.isKlipperMode()) {
            return this._initKlipperCamera();
        }
        try {
            const response = await apiCall('/api/camera/mode?live=1');
            const data = await response.json();
            console.log('Camera mode recheck:', data);

            if (data.type === 'off') {
                this.zeigeAus(data.reason);
                this.planeNachfrage();
                return;
            }

            window._cameraOff = false;
            console.log('Camera back online, mode:', data.type);
            // Until the first frame hides the placeholder it says what is
            // happening now, not "off".
            const txt = document.getElementById('camera-loading-text');
            if (txt) txt.textContent = (window.texts || {}).camera_loading || 'Kamera wird geladen...';

            if (data.type === 'live') {
                window._cameraMode = 'live';
                this.startLiveStream();
            } else {
                // MJPEG fallback — snapshot polling
                window._cameraMode = 'mjpeg';
                this.startSnapshotPolling();
            }
        } catch (e) {
            console.log('Camera recheck failed:', e);
        }
    }

    // ============= PAGE VISIBILITY - pause the stream when the tab/app is in the background =============
    // Like iOS/Catalyst: manage the stream lifecycle independently of the socket
    _setupPageVisibility() {
        let streamWasActive = false;
        let controlStreamWasActive = false;
        const self = this;

        document.addEventListener('visibilitychange', function() {
            const cameraEl = document.getElementById('camera-stream');
            const controlImg = document.getElementById('control-camera');

            // Live mode: close the stream in the background, open it again
            // in front. The server keeps its session 45 s and hands the
            // pictures since the last keyframe over at once -- back in a
            // blink, and no data flows for a hidden tab.
            if (window._cameraMode === 'live') {
                if (document.hidden) {
                    if (!(document.pictureInPictureElement && document.pictureInPictureElement === cameraEl)) {
                        self.stopLiveStream();
                        console.log('📹 Live camera paused (tab hidden)');
                    }
                } else if (!window._liveKamera) {
                    self.startLiveStream();
                    console.log('📹 Live camera resumed');
                }
                return;
            }

            // MJPEG mode: pause the stream/polling in the background, resume in the foreground.
            if (window._cameraMode === 'mjpeg') {
                if (document.hidden) {
                    self.stopSnapshotPolling();
                    self._stopKlipperPoll();   // close the persistent Klipper MJPEG connection
                    console.log('⏸️ Camera paused (tab in the background)');
                } else {
                    self.startSnapshotPolling();   // Klipper mode: redirects to _initKlipperCamera
                    console.log('▶️ Camera resumed');
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
                    console.log('⏸️ Control camera paused (tab in the background)');
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
                // Tab/app is back in the foreground -> resume streams IMMEDIATELY
                if (streamWasActive) {
                    if (cameraEl && window._cameraMode === 'mjpeg' && cameraEl.dataset.originalSrc) {
                        const baseSrc = cameraEl.dataset.originalSrc;
                        cameraEl.src = baseSrc + '?t=' + Date.now();
                        streamWasActive = false;
                        console.log('▶️ Camera stream resumed');

                        // Error handler with retry
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
                    // PiP was closed while the window was minimized -> resume now
                    cameraEl.src = cameraEl.dataset.pipPaused + '?t=' + Date.now();
                    delete cameraEl.dataset.pipPaused;
                    console.log('▶️ Camera stream resumed (PiP was closed while minimised)');
                }
                if (controlStreamWasActive && controlImg && controlImg.dataset.originalSrc
                        && window._cameraMode !== 'off' && !window._cameraOff) {
                    const baseSrc = controlImg.dataset.originalSrc;
                    controlImg.src = baseSrc + '?t=' + Date.now();
                    controlStreamWasActive = false;
                    console.log('▶️ Control camera resumed');
                }
            }
        });
    }

    // ============= Camera Source Toggle (Control Tab) =============
    toggleControlCameraSource() {
        // Klipper: cycle like the main image cycler. We set the cams on
        // both <img> elements (control-camera + camera-stream) at the same time.
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
        }
    }

    // ============= Camera UI Functions =============
    toggleCameraSource() {
        // Only Klipper has several cams to cycle through; the button shows
        // only there. A Bambu printer has one.
        if (window.isKlipperMode && window.isKlipperMode()) {
            this._cycleKlipperCamera();
        }
    }

    /** Camera preview in the control modal (#control-camera) — per the
     *  contract: for the live picture the same MediaStream as a second sink, for
     *  MJPEG snapshot polling at 1 fps, for off nothing. */
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

        if (window._cameraMode === 'live' && window._liveKamera) {
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

        // MJPEG: 1 fps snapshots — enough for the small preview, and the
        // pipeline dies on its own 45s after closing.
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
        // Live mode: native video PiP
        if (window._cameraMode === 'live') {
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
            // iOS can't do PiP for img elements, only for video
            // As a workaround: open the stream in a new window
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
            console.log('Camera element not found');
            return;
        }

        // Live mode: native video fullscreen
        if (window._cameraMode === 'live' && elem.tagName === 'VIDEO') {
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

        // Create the container for fullscreen
        const fullscreenContainer = document.createElement('div');
        fullscreenContainer.id = 'fullscreen-container';

        if (isIOS) {
            // iOS: fixed positioning without the Fullscreen API
            fullscreenContainer.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; z-index:99999; background:#000; display:flex; align-items:center; justify-content:center;';
        } else {
            // Browser: normal, with the Fullscreen API
            fullscreenContainer.style.cssText = 'position:relative; width:100%; height:100%; background:#000; display:flex; align-items:center; justify-content:center;';
        }

        // Clone the image for fullscreen
        const fullscreenImg = elem.cloneNode(true);
        fullscreenImg.id = 'fullscreen-camera-stream';
        fullscreenImg.style.cssText = 'max-width:100%; max-height:100%; transition:transform 0.3s ease; transform-origin:center;';
        // Preserve the camera rotation/flip — the cssText assignment above dropped
        // the transform; otherwise fullscreen would be upside down and the fullscreen zoom would lose it.
        const fsBase = elem.dataset.baseTransform || elem.style.transform || '';
        fullscreenImg.dataset.baseTransform = fsBase;
        if (fsBase) fullscreenImg.style.transform = fsBase;

        // Zoom controls for fullscreen
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

        // Only for browsers do we attempt real fullscreen
        if (!isIOS) {
            if (fullscreenContainer.requestFullscreen) {
                fullscreenContainer.requestFullscreen();
            } else if (fullscreenContainer.webkitRequestFullscreen) {
                fullscreenContainer.webkitRequestFullscreen();
            }
        }

        // Mouse-wheel zoom
        fullscreenImg.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            fullscreenZoomAtPosition(delta, e.clientX, e.clientY);
        });
    }

    pauseMainStreamForPiP() {
        // Live: the main stream keeps running, there's no img src to park.
        if (window._cameraMode === 'live') return;
        // Klipper direct: STOP the snapshot polling — otherwise the main stream
        // keeps running in parallel with PiP (two streams against the camera). Just
        // clearing the img src isn't enough, the poll sets it right back.
        if (window.isKlipperMode && window.isKlipperMode()) {
            this._stopKlipperPoll();
            const mainImg = document.getElementById('camera-stream');
            if (mainImg) { mainImg.dataset.pipPaused = '1'; mainImg.style.display = 'none'; mainImg.removeAttribute('src'); }
            // Note on the main image: the camera now runs in the PiP window (otherwise just black).
            const ph = document.getElementById('camera-placeholder');
            if (ph) {
                ph.style.display = 'flex';
                ph.dataset.pip = '1';
                const txt = ph.querySelector('#camera-loading-text');
                if (txt) txt.textContent = (window.texts || {}).camera_in_pip || 'Kamera läuft im PiP-Fenster';
            }
            console.log('⏸️ Klipper snapshot polling paused (PiP active)');
            return;
        }
        const mainImg = document.getElementById('camera-stream');
        if (mainImg && mainImg.src && mainImg.src.indexOf('/api/') !== -1) {
            mainImg.dataset.pipPaused = mainImg.src.split('?')[0];
            mainImg.src = '';
            mainImg.onerror = null; // Disable the error handler so the stream doesn't auto-restart
            console.log('⏸️ Camera stream paused (PiP active)');
        }
    }

    // Restores the main stream when PiP is closed
    resumeMainStreamFromPiP() {
        // Klipper direct: restart snapshot polling (source + transform).
        if (window.isKlipperMode && window.isKlipperMode()) {
            const mainImg = document.getElementById('camera-stream');
            if (mainImg) delete mainImg.dataset.pipPaused;
            const ph = document.getElementById('camera-placeholder');
            if (ph && ph.dataset.pip) { ph.style.display = 'none'; delete ph.dataset.pip; }
            if (this._klipperSources && this._klipperSources.length) this._setKlipperCamera(this._klipperSourceIdx || 0);
            else this._initKlipperCamera();
            console.log('▶️ Klipper snapshot polling resumed (PiP closed)');
            return;
        }
        const img = document.getElementById('camera-stream');
        if (img && img.dataset.pipPaused) {
            img.src = img.dataset.pipPaused + '?t=' + Date.now();
            delete img.dataset.pipPaused;
            console.log('▶️ Camera stream resumed (PiP closed)');
        }
    }

    openWindowPiP() {
        // ===== ELECTRON: native frameless PiP window (like the Chrome PiP extension) =====
        if (window.electronAPI && window.electronAPI.pip) {
            const cameraUrl = window.location.origin + '/api/camera';
            window.electronAPI.pip.open(cameraUrl).then(result => {
                if (result.opened) {
                    window.electronPipActive = true;
                    this.pauseMainStreamForPiP();
                } else {
                    // Toggle: PiP was closed
                    window.electronPipActive = false;
                    this.resumeMainStreamFromPiP();
                }
            });
            return;
        }

        // ===== BROWSER: fallback with window.open =====
        if (window.pipWindow && !window.pipWindow.closed) {
            window.pipWindow.close();
            window.pipWindow = null;
            this.resumeMainStreamFromPiP();
        } else {
            // /pip negotiates on its own (live if possible, otherwise snapshots)
            window.pipWindow = window.open('/pip', 'PiP_Camera', 'width=320,height=180,resizable=yes');
            if (window.pipWindow) {
                this.pauseMainStreamForPiP();

                // When the PiP window closes -> restart the stream
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
window.startLiveStream = () => window.cameraManager.startLiveStream();
window.stopLiveStream = () => window.cameraManager.stopLiveStream();
window.startSnapshotPolling = () => window.cameraManager.startSnapshotPolling();
window.stopSnapshotPolling = () => window.cameraManager.stopSnapshotPolling();
window.recheckCameraMode = () => window.cameraManager.recheckCameraMode();
window.toggleCameraSource = () => window.cameraManager.toggleCameraSource();
window.toggleControlCameraSource = () => window.cameraManager.toggleControlCameraSource();
window.togglePiP = () => window.cameraManager.togglePiP();
window.toggleCameraPlayPause = () => window.cameraManager.toggleCameraPlayPause();
window.toggleFullscreen = () => window.cameraManager.toggleFullscreen();
window.pauseMainStreamForPiP = () => window.cameraManager.pauseMainStreamForPiP();
window.resumeMainStreamFromPiP = () => window.cameraManager.resumeMainStreamFromPiP();
window.openWindowPiP = () => window.cameraManager.openWindowPiP();
