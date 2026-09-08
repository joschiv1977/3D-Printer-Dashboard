/**
 * Status Manager
 * Handles printer status loading, display updates, and control toggles
 * (power switch, light, MQTT, developer mode).
 */
// Reports a button state ONLY when it changed.
//
// The visibility logic runs on every incoming status packet. In the
// Electron console, "print running - hide dangerous buttons" showed up
// about 150 times in a row on 27aug26; real messages get buried
// in the noise.
let _letzterKnopfzustand = null;
function _melde_knopfzustand(lage, text) {
    if (_letzterKnopfzustand === lage) return;
    _letzterKnopfzustand = lage;
    console.log(text);
}


class StatusManager {
    constructor() {
        this.mqttCountdownInterval = null;
        this.mqttCountdownSeconds = 16;
    }

    // ========================================
    // updateBothButtons — update desktop + mobile button pair
    // ========================================
    /** Button content from an icon name and label — saves duplicating this
     *  markup across roughly thirty call sites and keeps the icons in one
     *  place (icons.js). */
    knopfInhalt(symbol, text) {
        const ic = (typeof window.skIcon === 'function') ? window.skIcon(symbol) : '';
        return ic + '<span>' + text + '</span>';
    }

    /** Keeps every light button in sync: the two legacy ones
     *  (.control-btn, Klipper cards), the one in the control window
     *  overview, and the one on the camera view, which is reachable from
     *  every tab. The label names the action: when the light is on, it
     *  reads "turn off". */
    setzeLichtKnoepfe(an) {
        const texts = window.texts || {};
        const label = an ? (texts.light_off || 'Licht aus')
                         : (texts.light_on || 'Licht an');
        this.updateBothButtons('light-btn', an ? 'control-btn warning' : 'control-btn',
                               this.knopfInhalt('licht', label));
        const uebersicht = document.getElementById('ov-light-btn');
        if (uebersicht) {
            uebersicht.classList.toggle('ov-on', an);
            const l = document.getElementById('ov-light-label');
            if (l) l.textContent = label;
        }
        const amBild = document.getElementById('ctrl-camera-light');
        if (amBild) {
            amBild.classList.toggle('ctrl-licht-an', an);
            const l = document.getElementById('ctrl-camera-light-label');
            if (l) l.textContent = label;
        }
    }

    updateBothButtons(baseId, className, innerHTML) {
        // IMPORTANT: only write className/innerHTML when they actually
        // changed. Otherwise polling during a mouse interaction replaces
        // the button's child nodes, which swallows the click
        // (e.g. light button: the click only registered after moving the mouse away).
        const desktopBtn = document.getElementById(baseId);
        const mobileBtn = document.getElementById(baseId + '-mobile');

        if (desktopBtn) {
            if (desktopBtn.className !== className) desktopBtn.className = className;
            if (desktopBtn.innerHTML !== innerHTML) desktopBtn.innerHTML = innerHTML;
        }
        if (mobileBtn) {
            if (mobileBtn.className !== className) mobileBtn.className = className;
            if (mobileBtn.innerHTML !== innerHTML) mobileBtn.innerHTML = innerHTML;
        }
    }

    // ========================================
    // loadStatus — fetches /api/status and applies it
    // ========================================
    loadStatus() {
        const texts = window.texts || {};
        return apiCall('/api/status')
            .then(response => response.json())
            .then(data => this.applyStatus(data))
            .catch(error => console.error(texts.console_status_load_failed + ':', error));
    }

    // ========================================
    // applyStatus — the ONE place that applies a status to the UI
    // ========================================
    /**
     * This used to live in loadStatus()'s then-block and only ran when
     * /api/status was fetched. When the 8-second poll was dropped, the
     * light button (among other things) stopped following along: the
     * server had the new state within ~1.3s, but nothing wrote it into
     * the button anymore.
     *
     * The socket push has carried the same 95 keys as /api/status since
     * 20aug26, so it can feed directly into this — exactly like the
     * Klipper path in printer-adapter.js already does.
     */
    /**
     * History chip in the zone bar. It previously had no visibility
     * logic at all and stayed shown even with the printer off.
     */
    _zeigeVerlaufChip(zeigen) {
        const chip = document.getElementById('mz-sys-charts');
        if (chip) chip.style.display = zeigen ? '' : 'none';
    }

    applyStatus(data) {
        // Remember capabilities. They arrive both via /api/status and
        // via the socket push, whereas window.lastPrintData only arrives
        // via the push — dialogs opened before the first push otherwise had
        // nothing to go on (the drying flag was missing while the printer was off).
        if (data && data.capabilities) window.lastCapabilities = data.capabilities;

        // Same order as previously in loadStatus's then-block.
        this._zeigeKopf(data);
        this._zeigeHmsBanner(data);
        this._zeigeAktualisierungUndKnoepfe(data);
    }

    /** Buttons, device tab, and printer name */
    _zeigeKopf(data) {
        const texts = window.texts || {};
        this.updateStatusDisplay(data);

        // Also feed the device tab. Bambu has no
        // printer_state event (that's the Klipper path) — there,
        // /api/status is the only source for nozzles, spools, storage,
        // and the rest of the device_report.
        if (window.printerControlManager && typeof window.printerControlManager.applyStatusPayload === 'function') {
            try { window.printerControlManager.applyStatusPayload(data); }
            catch (e) { console.error('Device tab not updated:', e); }
        }

        // Set the printer name (once only)
        if (data.printer_name && !window.printerNameSet) {
            // The name shows in the browser tab; there hasn't been a dedicated
            // field for it since the app header was removed.
            document.title = data.printer_name;
            window.printerNameSet = true;
        }
    }

    /** Keep the HMS banner in sync.
     *
     *  Up until 21aug26, this held eight methods (_zeigeDruckDetails,
     *  _zeigeFilament, _zeigeLuefter, _zeigeKammer, _zeigeBeleuchtung,
     *  _zeigeAms, _zeigeSystem, _zeigeWarteschlange) totaling around 250
     *  lines, all writing into elements that don't exist in the markup —
     *  leftovers from the old detail panel. Their content now lives in
     *  the print, material, and zone cards. What's left is the one call
     *  that still does anything.
     */
    _zeigeHmsBanner(data) {
        if (window.socketManager && typeof window.socketManager.applyHmsBanner === 'function') {
            window.socketManager.applyHmsBanner(data);
        }
    }

    _zeigeAktualisierungUndKnoepfe(data) {
        this._pflegeAutoConnect(data);
        this._pflegeKamera(data);
        this._zeigeKnoepfe(data);
    }

    /** Kick off MQTT reconnection when the printer is on */
    _pflegeAutoConnect(data) {
        const texts = window.texts || {};
        // Start the auto-connect timer when the printer is on and MQTT is not connected
        if (data.switch === 'on' && !data.mqtt && !window.mqttManuallyDisconnected) {
            if (!window.autoConnectTimer) {

            }
        } else if (window.autoConnectTimer) {
            clearInterval(window.autoConnectTimer);
            window.autoConnectTimer = null;
        }
    }

    /** Align the camera with the socket state */
    _pflegeKamera(data) {
        const texts = window.texts || {};
        // Without a socket there is no switch to follow, and the live
        // connection is the only evidence the printer is there at all.
        // Before 01sep26 this block simply never ran in that case -- `switch`
        // stayed null and the outer guard skipped everything -- so the camera
        // was never told to stop and polled snapshots for hours against a
        // printer that was not answering.
        const ohneDose = data.power_mode === 'none';
        const beleg = ohneDose ? (data.mqtt ? 'on' : 'weg') : data.switch;
        if (beleg !== null && beleg !== undefined && beleg !== window._lastSwitchState) {
            window._lastSwitchState = beleg;
            if (beleg === 'on' && window._cameraOff) {
                setTimeout(function() { recheckCameraMode(); }, 3000);
            } else if (beleg !== 'on' && !window._cameraOff) {
                window._cameraOff = true;
                window._cameraMode = 'off';
                stopWebRTCStream();
                stopSnapshotPolling();
                const camEl = document.getElementById('camera-stream');
                if (camEl) {
                    camEl.style.display = 'none';
                }
                const ph = document.getElementById('camera-placeholder');
                if (ph) {
                    ph.style.display = 'flex';
                    const txt = ph.querySelector('#camera-loading-text');
                    // With a socket we know it is off. Without one we only
                    // know nobody is answering -- and that is not the same
                    // thing, so do not claim it is.
                    const schluessel = ohneDose ? 'camera_no_signal' : 'camera_off';
                    const ersatz = ohneDose ? 'Kein Bild — Drucker antwortet nicht'
                                            : 'Kamera aus (Drucker aus)';
                    if (txt) txt.textContent = (window.t && window.t(schluessel)) || ersatz;
                }
            }
        }
    }

    /** Control buttons based on power and printer state */
    _zeigeKnoepfe(data) {
        const texts = window.texts || {};
        // No socket set up means there IS no power state -- and no state is
        // not "off". Until 01sep26 this line read `data.switch || 'off'`,
        // which turned a missing socket into a permanently switched-off
        // printer: the button offered "turn on" for a socket that does not
        // exist, and the history button never appeared at all. The setup
        // wizard has offered "none" the whole time; only the code never knew
        // the case. The server now states the mode outright.
        const ohneDose = data.power_mode === 'none';
        const switchState = data.switch || 'off';        // only for the power button
        // Is the printer there? With a socket that is the socket's answer;
        // without one it is the live connection -- the only evidence left.
        const druckerDa = ohneDose ? !!data.mqtt : (switchState === 'on');
        // Boot phase: the button reads "printer starting…" (set by
        // updateStatusDisplay) — don't overwrite it with on/off here.
        if (!window.printerBooting && data.status_text !== 'status.booting') {
            const switchBtns = ['switch-btn', 'switch-btn-mobile'];
            if (ohneDose) {
                // Nothing to switch. A dead button is worse than none.
                switchBtns.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
            } else {
                const btnClass = switchState === 'on' ? 'control-btn success' : 'control-btn';
                const btnText = switchState === 'on' ? texts.power_off : texts.power_on;
                switchBtns.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.style.display = '';
                        btn.className = btnClass;
                        btn.innerHTML = this.knopfInhalt('strom', btnText);
                        btn.style.visibility = 'visible';
                        btn.style.animation = 'fadeIn 0.5s ease-in';
                        btn.disabled = false;
                    }
                });
            }

            // Only show the history + SD card buttons when the printer is ON.
            // The SD card is NOT tied to printer power: the server keeps
            // a complete file mirror, and
            // /api/mqtt/sdcard?cache_only=true returns the list without any
            // printer connection. On the always-on host (host_mode=external)
            // the G-code files live on the host anyway. So the button stays
            // visible at all times; only the actions that actually need the
            // printer are locked (sd-card-manager.js).
            //
            // It used to live in two lists that contradicted each other: this
            // block showed it on the external host, while the live-status path
            // further down immediately hid it again — what you saw depended on
            // whichever ran last.
            const externalHost = data.host_mode === 'external';
            // Remember it globally: the tab bar needs it for the
            // Mainsail tab, which would otherwise gray out while the
            // printer is off — even though Mainsail runs on the always-on
            // host and stays reachable.
            window.lastHostMode = data.host_mode || null;
            const printerOnlyBtns = ['verlauf-btn', 'verlauf-btn-mobile'];
            // SD card: always usable, regardless of whether the printer is on.
            ['sd-btn-desktop', 'sd-btn-mobile'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.style.display = '';
                    btn.style.visibility = 'visible';
                    btn.disabled = false;
                }
            });
            document.querySelectorAll('button[onclick*="showSDFiles"]').forEach(btn => {
                btn.style.display = '';
            });

            if (druckerDa) {
                printerOnlyBtns.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.style.visibility = 'visible';
                        btn.style.animation = 'fadeIn 0.5s ease-in';
                        btn.disabled = false;
                    }
                });

                // Only show developer cards when the printer is ON and developer mode is active
                this.checkDeveloperMode();
            } else {
                // Printer OFF. On the external host, history + SD card stay
                // usable (files live on the host); otherwise hide them.
                printerOnlyBtns.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.style.visibility = externalHost ? 'visible' : 'hidden';
                        btn.disabled = !externalHost;
                    }
                });

                // Completely hide developer cards when the printer is OFF
                const devCardMobile = document.getElementById('dev-control-card-mobile');
                const devCardDesktop = document.getElementById('dev-control-card-desktop');
                if (devCardMobile) devCardMobile.style.display = 'none';
                if (devCardDesktop) devCardDesktop.style.display = 'none';
            }

            // Light status
            if (data.light !== null && !window.lightToggleInProgress) {
                if (data.light === 'on') {
                    this.setzeLichtKnoepfe(true);
                } else {
                    this.setzeLichtKnoepfe(false);
                }
            }

            // MQTT status
            if (data.mqtt !== undefined) {
                if (data.mqtt) {
                    this.updateBothButtons('mqtt-btn', 'control-btn active', this.knopfInhalt('funk', texts.mqtt_button_connected));
                } else {
                    this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', texts.mqtt_button));
                }
            }

            // History button - only when the printer is there
            if (druckerDa) {
                this.updateBothButtons('verlauf-btn', 'control-btn', this.knopfInhalt('balken', texts.charts));
            }
        }
    }



    // ========================================
    // updateStatusDisplay — update control buttons from status data
    // ========================================
    updateStatusDisplay(status) {
        const texts = window.texts || {};
            // Preconditioning: has its own state banner, its own file.
            try {
                if (window.preconditioning) window.preconditioning.aktualisiere(status);
            } catch (_) {}
            // Store the last known switch state
            if (status.switch !== null && status.switch !== undefined) {
                window.lastKnownSwitchState = status.switch;
            }

            // Store the MQTT status
            if (status.mqtt !== null && status.mqtt !== undefined) {
                window.lastMqttStatus = status.mqtt;
            }

            // "Is the printer there?" -- answered ONCE, here, for everybody.
            //
            // Four places used to work it out on their own, all with the same
            // line: switchState === 'on' && mqtt. Without a socket that is
            // false forever, and each of those places quietly withheld
            // something: the power button, the history button, the camera,
            // and the filament drying card (01sep26, all four found one after
            // the other). A fifth would have followed.
            if (status.power_mode) window.lastPowerMode = status.power_mode;
            window.druckerDa = (window.lastPowerMode === 'none')
                ? (window.lastMqttStatus === true)
                : (window.lastKnownSwitchState === 'on' && window.lastMqttStatus === true);

            // Update cards that depend on printer status
            if (typeof updatePrinterDependentCards === 'function') {
                updatePrinterDependentCards();
            }

            // Use the last known status when the current one is null
            const effectiveSwitchState = status.switch !== null ? status.switch : window.lastKnownSwitchState;

            // "Printer starting…" (post-power-on boot watchdog, Android
            // PrinterBootingCard): button stays locked until Moonraker is connected.
            const isBooting = status.state === 'booting' || status.status_text === 'status.booting';
            window.printerBooting = isBooting;
            if (isBooting) {
                ['switch-btn', 'switch-btn-mobile'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.className = 'control-btn warning';
                        btn.innerHTML = this.knopfInhalt('zahnrad', texts.status_booting || 'Drucker startet…');
                        btn.disabled = true;
                        btn.style.background = '';
                        btn.style.visibility = 'visible';
                    }
                });
                return;
            }

            // Update control buttons
            if (status.switch !== null) {
                const switchBtns = ['switch-btn', 'switch-btn-mobile'];
                if (status.switch === 'on') {
                    // Check whether the power-off timer is running
                    if (window.powerOffTimerActive) {
                        return;
                    }
                    this.updateBothButtons('switch-btn', 'control-btn success', this.knopfInhalt('strom', texts.power_turn_off || 'Ausschalten'));
                    switchBtns.forEach(id => {
                        const btn = document.getElementById(id);
                        if (btn) {
                            btn.style.background = '';
                            btn.style.visibility = 'visible';
                            btn.disabled = false;
                        }
                    });
                } else {
                    // Printer OFF
                    // Only show "HA unavailable" when HA is enabled in the config
                    if (status.ha_enabled && status.ha_available === false) {
                        switchBtns.forEach(id => {
                            const btn = document.getElementById(id);
                            if (btn) {
                                btn.className = 'control-btn warning';
                                btn.innerHTML = this.knopfInhalt('warnung', texts.power_ha_unavailable || 'HA nicht verfügbar');
                                btn.disabled = true;
                                btn.style.background = '';
                                btn.style.cursor = 'not-allowed';
                                btn.style.visibility = 'visible';
                            }
                        });
                    } else {
                        this.updateBothButtons('switch-btn', 'control-btn success', this.knopfInhalt('strom', texts.power_turn_on || 'Einschalten'));
                        switchBtns.forEach(id => {
                            const btn = document.getElementById(id);
                            if (btn) {
                                btn.style.background = '';
                                btn.style.visibility = 'visible';
                                btn.disabled = false;
                                btn.style.cursor = 'pointer';
                            }
                        });
                    }
                }
            }

            // MQTT button - Bambu mode ONLY (Klipper has no MQTT). In
            // Klipper mode, CSS [data-bambu-only] already hides the button,
            // but we don't want to actively force visibility:visible over
            // it either — otherwise it looks like a race.
            if (!(window.isKlipperMode && window.isKlipperMode())) {
                const mqttBtns = ['mqtt-btn', 'mqtt-btn-mobile'];
                mqttBtns.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        if (effectiveSwitchState === 'on') {
                            btn.style.visibility = 'visible';
                            btn.disabled = false;
                        } else {
                            btn.style.visibility = 'hidden';
                            btn.disabled = true;
                        }
                    }
                });

                // Update MQTT status when visible
                if (effectiveSwitchState === 'on' && status.mqtt !== undefined) {
                    if (status.mqtt) {
                        this.updateBothButtons('mqtt-btn', 'control-btn active', this.knopfInhalt('funk', texts.mqtt_button_connected || 'MQTT'));
                    } else {
                        this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));
                    }
                }
            }

            // MQTT status
            if (status.mqtt !== undefined) {
                if (status.mqtt) {
                    this.updateBothButtons('mqtt-btn', 'control-btn active', this.knopfInhalt('funk', texts.mqtt_button_connected || 'MQTT'));
                } else {
                    this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));
                }
            }

            // Buttons visible when: printer was/is ON OR MQTT connected
            const shouldShowButtons = effectiveSwitchState === 'on' || status.mqtt === true;

            // Light button
            const lightBtns = ['light-btn', 'light-btn-mobile'];
            lightBtns.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    if (shouldShowButtons) {
                        btn.style.visibility = 'visible';
                        btn.style.animation = 'fadeIn 0.5s ease-in';
                        btn.disabled = false;
                    } else {
                        btn.style.visibility = 'hidden';
                        btn.disabled = true;
                    }
                }
            });

            // Light status
            if (shouldShowButtons && !window.lightToggleInProgress) {
                if (status.light === 'on') {
                    this.setzeLichtKnoepfe(true);
                } else {
                    this.setzeLichtKnoepfe(false);
                }
            }

            // History buttons. Besides the printer state, it also matters
            // whether there's anything to show at all: if the printer hasn't
            // run in the last hour, the history is empty and the button leads
            // to blank axes. has_sensor_history tells us that (status_builder).
            const hatVerlauf = status.has_sensor_history !== false;
            this._zeigeVerlaufChip(shouldShowButtons && hatVerlauf);

            const verlaufBtns = ['verlauf-btn', 'verlauf-btn-mobile'];
            verlaufBtns.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    if (shouldShowButtons && hatVerlauf) {
                        btn.style.visibility = 'visible';
                        btn.style.animation = 'fadeIn 0.5s ease-in';
                        btn.disabled = false;
                        this.updateBothButtons('verlauf-btn', 'control-btn', this.knopfInhalt('balken', texts.charts));
                    } else {
                        btn.style.visibility = 'hidden';
                        btn.disabled = true;
                    }
                }
            });

            // SD card: always usable. The list comes from the server's file
            // mirror and doesn't need the printer — only printing and
            // deleting are locked (sd-card-manager.js). This branch used to
            // hide the button again as soon as the printer was off, undoing
            // the exception made in the loadStatus path.
            ['sd-btn-desktop', 'sd-btn-mobile'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.style.display = '';
                    btn.style.visibility = 'visible';
                    btn.disabled = false;
                }
            });

            // Update filament card visibility based on printer status
            if (typeof updateFilamentCardVisibility === 'function') {
                updateFilamentCardVisibility();
            }
        }

    // ========================================
    // toggleSwitch — power on/off
    // ========================================
    async toggleSwitch() {
        const texts = window.texts || {};
        try {
            // Reset the MQTT manual-disconnect flag when the printer is switched off/on
            window.mqttManuallyDisconnected = false;

            // Powering off takes a moment (the bridge's Meross cloud login) →
            // immediate feedback on the button: "Turning off…" + disabled.
            // Source: lastKnownSwitchState (lastPrintData has NO switch field).
            const wasOn = window.lastKnownSwitchState === 'on';
            if (wasOn) {
                ['switch-btn', 'switch-btn-mobile'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.disabled = true;
                        btn.innerHTML = this.knopfInhalt('strom', texts.power_shutting_down || 'Schalte aus…');
                    }
                });
            }

            const response = await apiCall('/api/switch', { method: 'POST' });
            const data = await response.json();

            // HA unavailable
            if (data.ha_unavailable) {
                window.skToast(texts.alert_ha_unavailable, 'warning');
                return;
            }

            if (data.needs_confirmation) {
                showConfirmDialog({ text: texts.confirm_printer_printing_poweroff,
                    knopf: texts.confirm_power_off, gefaehrlich: true }, async () => {
                    await apiCall('/api/switch?force=true', { method: 'POST' });
                    setTimeout(() => loadStatus(), 2000);
                });
                return;
            }

            setTimeout(() => loadStatus(), 2000);
        } catch (error) {
            window.skToast(texts.alert_connection_error);
            // Restore the button state from the actual status.
            try { loadStatus(); } catch (_) {}
        }
    }

    // ========================================
    // toggleLight — light on/off with optimistic UI
    // ========================================
    async toggleLight() {
        const texts = window.texts || {};
        // === OPTIMISTIC UI ===
        // 3s lock so state polling doesn't overwrite the optimistically set
        // state while the backend call is in flight.
        window.lightToggleInProgress = true;
        if (window._lightPollingLockTimer) clearTimeout(window._lightPollingLockTimer);
        window._lightPollingLockTimer = setTimeout(() => {
            window.lightToggleInProgress = false;
        }, 3000);

        const lightBtn = document.getElementById('light-btn') || document.getElementById('light-btn-mobile');
        const wasOn = lightBtn ? lightBtn.classList.contains('warning') : false;
        const newOn = !wasOn;

        // Optimistic flip
        if (newOn) {
            this.setzeLichtKnoepfe(true);
        } else {
            this.setzeLichtKnoepfe(false);
        }

        // Unified action — the backend dispatches to the right controller.
        try {
            const r = await window.printerAdapter.setLight(newOn);
            if (!r.ok) {
                // Revert
                this.setzeLichtKnoepfe(!!wasOn);
                skToast(r.error || texts.light_error, 'error');
            }
        } catch (error) {
            console.error('light toggle error', error);
            if (wasOn) {
                this.setzeLichtKnoepfe(true);
            } else {
                this.setzeLichtKnoepfe(false);
            }
            skToast(texts.connection_error, 'error');
        }
    }

    // ========================================
    // toggleMQTT — connect/disconnect MQTT
    // ========================================
    async toggleMQTT() {
        const texts = window.texts || {};
        try {
            // Stop any auto-connect timer that might be running
            if (this.mqttCountdownInterval) {
                clearInterval(this.mqttCountdownInterval);
                this.mqttCountdownInterval = null;
            }

            // Check the current status via the API
            const statusResponse = await apiCall('/api/status');
            const statusData = await statusResponse.json();

            if (statusData.mqtt) {
                // MQTT is connected -> disconnect
                window.mqttManuallyDisconnected = true;  // Set flag!
                this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));

                const response = await apiCall('/api/mqtt/connect', { method: 'POST' });
                const data = await response.json();

                if (data.success && !data.connected) {
                    this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));
                    skToast(texts.mqtt_disconnected_msg, 'info');

                    // Completely hide developer cards on MQTT disconnect
                    const devCardMobile = document.getElementById('dev-control-card-mobile');
                    const devCardDesktop = document.getElementById('dev-control-card-desktop');
                    if (devCardMobile) devCardMobile.style.display = 'none';
                    if (devCardDesktop) devCardDesktop.style.display = 'none';
                }
            } else {
                // MQTT is disconnected -> connect
                window.mqttManuallyDisconnected = false;  // Reset flag!
                this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', `${texts.mqtt_button_connecting} <span class="hourglass-spinning">⏳</span>`));

                const response = await apiCall('/api/mqtt/connect', { method: 'POST' });
                const data = await response.json();

                if (data.success && data.connected) {
                    this.updateBothButtons('mqtt-btn', 'control-btn active', this.knopfInhalt('funk', texts.mqtt_button_connected || 'MQTT'));
                    skToast(texts.mqtt_connected_msg, 'success');

                    // Check developer mode AFTER a successful MQTT connection
                    this.checkDeveloperMode();
                }
            }

            setTimeout(() => loadStatus(), 3000);
        } catch (error) {
            if (this.mqttCountdownInterval) {
                clearInterval(this.mqttCountdownInterval);
                this.mqttCountdownInterval = null;
            }
            this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));
            window.skToast(texts.alert_mqtt_error);
        }
    }

    // ========================================
    // startMQTTCountdown — show connecting animation
    // ========================================
    startMQTTCountdown() {
        const texts = window.texts || {};
        // Check whether it was manually disconnected (no countdown on manual disconnect)
        if (window.mqttManuallyDisconnected) {
            return;
        }

        // Check whether it's already running
        if (this.mqttCountdownInterval) {
            return;
        }

        // Show the animated hourglass
        this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', `${texts.mqtt_button_connecting} <span class="hourglass-spinning">⏳</span>`));
    }

    // ========================================
    // checkDeveloperMode — show/hide developer cards
    // ========================================
    checkDeveloperMode() {
        const texts = window.texts || {};
        const devCardMobile = document.getElementById('dev-control-card-mobile');
        const devCardDesktop = document.getElementById('dev-control-card-desktop');

        // Helper: hide card + buttons together
        function hideDevCards() {
            if (devCardMobile) devCardMobile.style.display = 'none';
            if (devCardDesktop) devCardDesktop.style.display = 'none';
        }

        // Helper: show card + buttons together
        function showDevCards() {
            if (devCardMobile) devCardMobile.style.display = '';
            if (devCardDesktop) devCardDesktop.style.display = '';
            // Reset opacity/transform (in case there was a fade-out before)
            [devCardMobile, devCardDesktop].forEach(card => {
                if (!card) return;
                const grid = card.querySelector('.control-grid');
                if (grid) {
                    grid.style.opacity = '1';
                    grid.style.transform = 'scale(1)';
                }
            });
        }

        // Klipper mode: the dev card has universal controls (Pause/Resume/
        // Stop/Home/Move/Speed/Temp) — all via printerAdapter. Visible ONLY
        // when the printer is online (Moonraker reachable → switch='on' &&
        // mqtt=true, both mapped from connected by the direct adapter). Printer
        // off → hide it (otherwise the card flickers on every status poll and
        // shows controls for a dead printer).
        if (window.isKlipperMode && window.isKlipperMode()) {
            // Without a configured socket, the connection decides -- the
            // answer lives in status-manager.js, here it's only read.
            const printerOnline = (typeof window.druckerDa === 'boolean') ? window.druckerDa
            : (window.lastKnownSwitchState === 'on' && window.lastMqttStatus === true);
            if (window.isFilamentDrying || !printerOnline) {
                hideDevCards();
                return;
            }
            showDevCards();
            return;
        }

        // Read from the socket state instead of fetching it.
        //
        // This function needs exactly three values: gcode_state, mqtt, and
        // developer_mode. The first two are in the push (window.lastPrintData
        // has carried all 95 keys since 20aug26), the third is static
        // configuration and never changes at runtime.
        //
        // It used to fetch both fresh on every call — and the drying tile
        // calls through here every 10 seconds (FilamentDryingManager.updateStatus
        // → _applyControlsVisibility → here). That was a steady 6 requests per
        // minute at 6.7 KB each, just to decide whether a few buttons
        // are visible.
        const ausSocket = (window.lastPrintData && window.lastPrintData.gcode_state !== undefined)
            ? window.lastPrintData : null;
        const statusHolen = ausSocket
            ? Promise.resolve(ausSocket)
            : apiCall('/api/status').then(r => r.json());
        const configHolen = window.__devModeConfig
            ? Promise.resolve(window.__devModeConfig)
            : apiCall('/api/config').then(r => r.json()).then(c => (window.__devModeConfig = c));

        Promise.all([statusHolen, configHolen]).then(([data, config]) => {
            const isPrinting = data.gcode_state === 'RUNNING';
            const isPaused = data.gcode_state === 'PAUSE' || data.paused === true;
            document.querySelectorAll('.sd-print-action').forEach(btn => {
                const active = ['RUNNING', 'PAUSE', 'PREPARE'].includes(String(data.gcode_state || '').toUpperCase());
                btn.disabled = active;
                btn.setAttribute('aria-disabled', String(active));
                btn.title = active
                    ? (texts.print_blocked_active || 'Bei aktivem Druck kein Start möglich')
                    : (texts.print_now || texts.print || 'Drucken');
            });

            // Check whether filament drying is active
            if (window.isFilamentDrying) {
                console.log(texts.console_drying_active_cards_hidden);
                hideDevCards();
                return;
            }

            // MQTT not connected or developer mode not active -> hide
            if (data.mqtt !== true || config.mqtt.developer_mode !== true) {
                hideDevCards();
                return;
            }

            // Developer mode active + MQTT connected -> show card AND buttons immediately
            showDevCards();

            // Parts: same function as in the socket path,
            // so the two paths don't drift apart.
            if (window.skTeileKnopfZeigen) window.skTeileKnopfZeigen(data);

            if (isPrinting) {
                // Homing stays locked during printing; SD card and
                // control stay visible.
                _melde_knopfzustand('druck', texts.console_print_running_hide_buttons);
                ['homing-btn-mobile', 'homing-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
                // Control stays visible: since the overview tab, the window
                // has also been useful during printing (temperatures,
                // fan, light). Movement is locked by moveAxis itself.
                document.querySelectorAll('button[onclick*="openPrinterControl"]').forEach(btn => {
                    btn.style.display = '';
                });
            } else if (isPaused) {
                // PAUSE: homing stays locked, SD card and control stay visible.
                _melde_knopfzustand('pause',
                    'Druck pausiert - Steuerung bleibt sichtbar für Filament-Wechsel');
                ['homing-btn-mobile', 'homing-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
                document.querySelectorAll('button[onclick*="openPrinterControl"]').forEach(btn => {
                    btn.style.display = '';
                });
            } else {
                // IDLE: show all buttons
                document.querySelectorAll('button[onclick*="showSDFiles"]').forEach(btn => {
                    btn.style.display = '';
                });
                ['homing-btn-mobile', 'homing-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = '';
                });
                document.querySelectorAll('button[onclick*="openPrinterControl"]').forEach(btn => {
                    btn.style.display = '';
                });
            }
        }).catch(err => {
            console.warn('checkDeveloperMode error:', err);
            hideDevCards();
        });
    }
}

// ========================================
// Instantiate global singleton
// ========================================
window.statusManager = new StatusManager();

// ========================================
// Global wrappers for HTML onclick handlers
// ========================================
function updateBothButtons(baseId, className, innerHTML) {
    window.statusManager.updateBothButtons(baseId, className, innerHTML);
}
function loadStatus() {
    window.statusManager.loadStatus();
}
function updateStatusDisplay(status) {
    window.statusManager.updateStatusDisplay(status);
}
function toggleSwitch() {
    window.statusManager.toggleSwitch();
}
function toggleLight() {
    window.statusManager.toggleLight();
}
function toggleMQTT() {
    window.statusManager.toggleMQTT();
}
function startMQTTCountdown() {
    window.statusManager.startMQTTCountdown();
}
function checkDeveloperMode() {
    window.statusManager.checkDeveloperMode();
}
