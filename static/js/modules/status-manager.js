/**
 * Status Manager
 * Handles printer status loading, display updates, and control toggles
 * (power switch, light, MQTT, developer mode).
 */
// Meldet einen Knopf-Zustand NUR, wenn er sich geaendert hat.
//
// Die Sichtbarkeits-Logik laeuft an jedem Statuspaket. In der
// Electron-Konsole stand „Druck laeuft - verstecke gefaehrliche Buttons"
// am 27aug26 rund 150-mal hintereinander; echte Meldungen gehen darin
// unter.
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
    /** Knopfinhalt aus Symbolname und Beschriftung — spart das Markup an
     *  jeder der rund dreissig Aufrufstellen und haelt die Symbole an einer
     *  Stelle (icons.js). Frueher stand hier ueberall ein Emoji im String. */
    knopfInhalt(symbol, text) {
        const ic = (typeof window.skIcon === 'function') ? window.skIcon(symbol) : '';
        return ic + '<span>' + text + '</span>';
    }

    /** Alle Lichtknoepfe auf denselben Stand: die beiden alten
     *  (.control-btn, Klipper-Karten), der in der Uebersicht des
     *  Steuerungs-Fensters und der am Kamerabild, der in jedem Reiter
     *  erreichbar ist. Beschriftung ist die Handlung: leuchtet es,
     *  steht "Licht aus" drauf. */
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
        // WICHTIG: className/innerHTML nur schreiben wenn sie sich tatsächlich
        // geändert haben. Andernfalls ersetzt das Polling während einer
        // Mausinteraktion die Kind-Nodes des Buttons, was den Klick verschluckt
        // (z.B. Licht-Button: Klick ging erst nach Maus-wegbewegen durch).
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
    // loadStatus — holt /api/status und wendet ihn an
    // ========================================
    loadStatus() {
        const texts = window.texts || {};
        return apiCall('/api/status')
            .then(response => response.json())
            .then(data => this.applyStatus(data))
            .catch(error => console.error(texts.console_status_load_failed + ':', error));
    }

    // ========================================
    // applyStatus — EINE Stelle, die einen Status auf die Oberflaeche legt
    // ========================================
    /**
     * Frueher stand das im then-Block von loadStatus() und lief damit nur,
     * wenn /api/status geholt wurde. Als der 8-Sekunden-Poll wegfiel, hoerte
     * unter anderem der Licht-Knopf auf, sich nachzufuehren: der Server hatte
     * den neuen Stand binnen ~1,3 s, aber niemand trug ihn mehr in den Knopf.
     *
     * Der Socket-Push traegt seit 20aug26 dieselben 95 Schluessel wie
     * /api/status, deshalb kann er hier direkt hinein — genau so, wie es der
     * Klipper-Pfad in printer-adapter.js schon macht.
     */
    /**
     * Verlauf-Chip in der Zonen-Leiste. Der hatte bisher gar keine
     * Sichtbarkeitslogik und stand auch bei ausgeschaltetem Drucker da.
     */
    _zeigeVerlaufChip(zeigen) {
        const chip = document.getElementById('mz-sys-charts');
        if (chip) chip.style.display = zeigen ? '' : 'none';
    }

    applyStatus(data) {
        // Faehigkeiten merken. Sie kommen sowohl ueber /api/status als auch
        // ueber den Socket-Push, window.lastPrintData dagegen NUR ueber den
        // Push — Dialoge, die vor dem ersten Push aufgehen, standen sonst
        // ohne da (der Trocknungs-Haken fehlte bei ausgeschaltetem Drucker).
        if (data && data.capabilities) window.lastCapabilities = data.capabilities;

        // Reihenfolge wie frueher im then-Block von loadStatus.
        this._zeigeKopf(data);
        this._zeigeHmsBanner(data);
        this._zeigeAktualisierungUndKnoepfe(data);
    }

    /** Knoepfe, Geraete-Tab und Druckername */
    _zeigeKopf(data) {
        const texts = window.texts || {};
        this.updateStatusDisplay(data);

        // Geraet-Tab mitversorgen. Auf Bambu gibt es kein
        // printer_state-Ereignis (das ist der Klipper-Weg) — dort ist
        // /api/status die einzige Quelle fuer Duesen, Spulen, Speicher
        // und den Rest des device_report.
        if (window.printerControlManager && typeof window.printerControlManager.applyStatusPayload === 'function') {
            try { window.printerControlManager.applyStatusPayload(data); }
            catch (e) { console.error('Device tab not updated:', e); }
        }

        // Drucker-Name setzen (nur einmal)
        if (data.printer_name && !window.printerNameSet) {
            // Der Name steht im Browser-Tab; ein Feld dafuer gibt es seit
            // dem Entfernen des App-Headers nicht mehr.
            document.title = data.printer_name;
            window.printerNameSet = true;
        }
    }

    /** NEUE ERWEITERTE MQTT-DATEN ANZEIGEN */
    /** HMS-Banner nachziehen.
     *
     *  Hier standen bis 21aug26 acht Methoden (_zeigeDruckDetails,
     *  _zeigeFilament, _zeigeLuefter, _zeigeKammer, _zeigeBeleuchtung,
     *  _zeigeAms, _zeigeSystem, _zeigeWarteschlange) mit zusammen rund 250
     *  Zeilen, die ausnahmslos in Elemente schrieben, die es im Markup nicht
     *  gibt — Reste der alten Detailtafel. Ihre Inhalte stehen heute in der
     *  Druck-, Material- und Zonen-Karte. Uebrig bleibt der einzige Aufruf
     *  mit Wirkung.
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

    /** MQTT-Wiederverbindung anstossen, wenn der Drucker an ist */
    _pflegeAutoConnect(data) {
        const texts = window.texts || {};
        // Auto-Connect Timer starten wenn Drucker an und MQTT nicht verbunden
        if (data.switch === 'on' && !data.mqtt && !window.mqttManuallyDisconnected) {
            if (!window.autoConnectTimer) {

            }
        } else if (window.autoConnectTimer) {
            clearInterval(window.autoConnectTimer);
            window.autoConnectTimer = null;
        }
    }

    /** Kamera an der Steckdose ausrichten */
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

    /** Steuerungs-Knoepfe nach Strom- und Druckerzustand */
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
        // Boot-Phase: Button zeigt „Drucker startet…" (setzt
        // updateStatusDisplay) — hier nicht mit Ein/Aus überschreiben.
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

            // Verlauf + SD-Card Buttons nur anzeigen wenn Drucker AN ist.
            // Die SD-Karte haengt NICHT am Druckerstrom: der Server haelt
            // einen vollstaendigen Dateispiegel, und
            // /api/mqtt/sdcard?cache_only=true liefert die Liste ohne jede
            // Druckerverbindung. Am always-on-Host (host_mode=external)
            // liegen die G-Codes ohnehin auf dem Host. Der Knopf bleibt
            // deshalb immer sichtbar; gesperrt werden nur die Aktionen, die
            // den Drucker wirklich brauchen (sd-card-manager.js).
            //
            // Vorher stand er in zwei Listen, die sich widersprachen: dieser
            // Block blendete ihn am externen Host ein, der Live-Status-Pfad
            // weiter unten gleich wieder aus — was man sah, hing davon ab,
            // welcher zuletzt lief.
            const externalHost = data.host_mode === 'external';
            // Global merken: die Tab-Bar braucht es fuer den
            // Mainsail-Tab, der sonst bei ausgeschaltetem Drucker
            // ausgegraut wird — obwohl Mainsail auf dem always-on-Host
            // laeuft und erreichbar bleibt.
            window.lastHostMode = data.host_mode || null;
            const printerOnlyBtns = ['verlauf-btn', 'verlauf-btn-mobile'];
            // SD-Karte: immer bedienbar, egal ob der Drucker an ist.
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

                // Developer Cards nur anzeigen wenn Drucker AN UND Developer Mode aktiv
                this.checkDeveloperMode();
            } else {
                // Drucker AUS. Am externen Host bleiben Verlauf + SD-Karte
                // bedienbar (Dateien liegen auf dem Host), sonst verstecken.
                printerOnlyBtns.forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        btn.style.visibility = externalHost ? 'visible' : 'hidden';
                        btn.disabled = !externalHost;
                    }
                });

                // Developer Cards komplett ausblenden bei Drucker AUS
                const devCardMobile = document.getElementById('dev-control-card-mobile');
                const devCardDesktop = document.getElementById('dev-control-card-desktop');
                if (devCardMobile) devCardMobile.style.display = 'none';
                if (devCardDesktop) devCardDesktop.style.display = 'none';
            }

            // Licht Status
            if (data.light !== null && !window.lightToggleInProgress) {
                if (data.light === 'on') {
                    this.setzeLichtKnoepfe(true);
                } else {
                    this.setzeLichtKnoepfe(false);
                }
            }

            // MQTT Status
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
            // Vorkonditionierung: eigenes Zustandsbanner, eigene Datei.
            try {
                if (window.vorkonditionierung) window.vorkonditionierung.aktualisiere(status);
            } catch (_) {}
            // Speichere letzten bekannten Switch-Status
            if (status.switch !== null && status.switch !== undefined) {
                window.lastKnownSwitchState = status.switch;
            }

            // Speichere MQTT Status
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

            // Cards aktualisieren die vom Drucker-Status abhängen
            if (typeof updatePrinterDependentCards === 'function') {
                updatePrinterDependentCards();
            }

            // Verwende letzten bekannten Status wenn aktueller null ist
            const effectiveSwitchState = status.switch !== null ? status.switch : window.lastKnownSwitchState;

            // „Drucker startet…" (Boot-Watchdog nach dem Einschalten, Android
            // PrinterBootingCard): Button gesperrt, bis Moonraker verbunden ist.
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
                    // NEU: Prüfe ob Power-Off Timer läuft
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
                    // Drucker AUS
                    // Nur "HA nicht verfügbar" anzeigen wenn HA in Config aktiviert ist
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

            // MQTT Button - NUR Bambu-Mode (Klipper hat kein MQTT). Im
            // Klipper-Mode versteckt CSS [data-bambu-only] den Button schon,
            // aber wir wollen auch nicht aktiv visibility:visible drueber-
            // setzen — sonst sieht's wie ein Race aus.
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

                // MQTT Status updaten wenn sichtbar
                if (effectiveSwitchState === 'on' && status.mqtt !== undefined) {
                    if (status.mqtt) {
                        this.updateBothButtons('mqtt-btn', 'control-btn active', this.knopfInhalt('funk', texts.mqtt_button_connected || 'MQTT'));
                    } else {
                        this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));
                    }
                }
            }

            // MQTT Status
            if (status.mqtt !== undefined) {
                if (status.mqtt) {
                    this.updateBothButtons('mqtt-btn', 'control-btn active', this.knopfInhalt('funk', texts.mqtt_button_connected || 'MQTT'));
                } else {
                    this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));
                }
            }

            // Buttons sichtbar wenn: Drucker war/ist AN ODER MQTT verbunden
            const shouldShowButtons = effectiveSwitchState === 'on' || status.mqtt === true;

            // Licht Button
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

            // Licht Status
            if (shouldShowButtons && !window.lightToggleInProgress) {
                if (status.light === 'on') {
                    this.setzeLichtKnoepfe(true);
                } else {
                    this.setzeLichtKnoepfe(false);
                }
            }

            // Verlauf-Knoepfe. Zusaetzlich zum Drucker-Zustand zaehlt, ob es
            // ueberhaupt etwas zu zeigen gibt: lief der Drucker in der letzten
            // Stunde nicht, ist die Historie leer und der Knopf fuehrt auf
            // leere Achsen. has_sensor_history sagt es (status_builder).
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

            // SD-Karte: immer bedienbar. Die Liste kommt aus dem Dateispiegel
            // des Servers und braucht den Drucker nicht — gesperrt werden nur
            // Drucken und Loeschen (sd-card-manager.js). Dieser Zweig hat den
            // Knopf frueher wieder versteckt, sobald der Drucker aus war, und
            // damit die Ausnahme im loadStatus-Pfad ausgehebelt.
            ['sd-btn-desktop', 'sd-btn-mobile'].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.style.display = '';
                    btn.style.visibility = 'visible';
                    btn.disabled = false;
                }
            });

            // Update Filament Card Sichtbarkeit basierend auf Drucker-Status
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
            // Reset MQTT manual disconnect flag wenn Drucker aus/an geschaltet wird
            window.mqttManuallyDisconnected = false;

            // Ausschalten braucht einen Moment (Meross-Cloud-Login der Bridge) →
            // sofortiges Feedback auf dem Button: „Schalte aus…" + disabled.
            // Quelle: lastKnownSwitchState (lastPrintData hat KEIN switch-Feld).
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

            // HA nicht verfügbar
            if (data.ha_unavailable) {
                window.skToast(texts.alert_ha_unavailable, 'warning');
                return;
            }

            if (data.needs_confirmation) {
                showConfirmDialog(texts.confirm_printer_printing_poweroff, async () => {
                    await apiCall('/api/switch?force=true', { method: 'POST' });
                    setTimeout(() => loadStatus(), 2000);
                });
                return;
            }

            setTimeout(() => loadStatus(), 2000);
        } catch (error) {
            window.skToast(texts.alert_connection_error);
            // Button-Zustand aus dem echten Status wiederherstellen.
            try { loadStatus(); } catch (_) {}
        }
    }

    // ========================================
    // toggleLight — light on/off with optimistic UI
    // ========================================
    async toggleLight() {
        const texts = window.texts || {};
        // === OPTIMISTIC UI ===
        // 3s-Lock damit das State-Polling den optimistisch gesetzten Zustand
        // nicht ueberschreibt waehrend der Backend-Call laeuft.
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

        // Unified action — Backend dispatcht zum richtigen Controller.
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
            // Stoppe eventuell laufenden Auto-Connect Timer
            if (this.mqttCountdownInterval) {
                clearInterval(this.mqttCountdownInterval);
                this.mqttCountdownInterval = null;
            }

            // Prüfe aktuellen Status über API
            const statusResponse = await apiCall('/api/status');
            const statusData = await statusResponse.json();

            if (statusData.mqtt) {
                // MQTT ist verbunden -> Trennen
                window.mqttManuallyDisconnected = true;  // Flag setzen!
                this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));

                const response = await apiCall('/api/mqtt/connect', { method: 'POST' });
                const data = await response.json();

                if (data.success && !data.connected) {
                    this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', 'MQTT'));
                    skToast(texts.mqtt_disconnected_msg, 'info');

                    // Developer Cards komplett ausblenden bei MQTT Disconnect
                    const devCardMobile = document.getElementById('dev-control-card-mobile');
                    const devCardDesktop = document.getElementById('dev-control-card-desktop');
                    if (devCardMobile) devCardMobile.style.display = 'none';
                    if (devCardDesktop) devCardDesktop.style.display = 'none';
                }
            } else {
                // MQTT ist getrennt -> Verbinden
                window.mqttManuallyDisconnected = false;  // Flag zurücksetzen!
                this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', `${texts.mqtt_button_connecting} <span class="hourglass-spinning">⏳</span>`));

                const response = await apiCall('/api/mqtt/connect', { method: 'POST' });
                const data = await response.json();

                if (data.success && data.connected) {
                    this.updateBothButtons('mqtt-btn', 'control-btn active', this.knopfInhalt('funk', texts.mqtt_button_connected || 'MQTT'));
                    skToast(texts.mqtt_connected_msg, 'success');

                    // Developer Mode prüfen NACH erfolgreicher MQTT Verbindung
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
        // Prüfe ob manuell getrennt wurde (kein Countdown bei manuellem Trennen)
        if (window.mqttManuallyDisconnected) {
            return;
        }

        // Prüfe ob bereits läuft
        if (this.mqttCountdownInterval) {
            return;
        }

        // Animierte Sanduhr anzeigen
        this.updateBothButtons('mqtt-btn', 'control-btn', this.knopfInhalt('funk', `${texts.mqtt_button_connecting} <span class="hourglass-spinning">⏳</span>`));
    }

    // ========================================
    // checkDeveloperMode — show/hide developer cards
    // ========================================
    checkDeveloperMode() {
        const texts = window.texts || {};
        const devCardMobile = document.getElementById('dev-control-card-mobile');
        const devCardDesktop = document.getElementById('dev-control-card-desktop');

        // Helper: Card + Buttons zusammen verstecken
        function hideDevCards() {
            if (devCardMobile) devCardMobile.style.display = 'none';
            if (devCardDesktop) devCardDesktop.style.display = 'none';
        }

        // Helper: Card + Buttons zusammen anzeigen
        function showDevCards() {
            if (devCardMobile) devCardMobile.style.display = '';
            if (devCardDesktop) devCardDesktop.style.display = '';
            // Opacity/Transform zurücksetzen (falls vorher fade-out war)
            [devCardMobile, devCardDesktop].forEach(card => {
                if (!card) return;
                const grid = card.querySelector('.control-grid');
                if (grid) {
                    grid.style.opacity = '1';
                    grid.style.transform = 'scale(1)';
                }
            });
        }

        // Klipper-Mode: Dev-Card hat universelle Steuerung (Pause/Resume/
        // Stop/Home/Move/Speed/Temp) — alles via printerAdapter. Sichtbar NUR
        // wenn der Drucker online ist (Moonraker erreichbar → switch='on' &&
        // mqtt=true, beide vom Direct-Adapter aus connected gemappt). Drucker
        // aus → ausblenden (sonst flackert die Karte mit jedem Status-Poll und
        // zeigt Steuerung für einen toten Drucker).
        if (window.isKlipperMode && window.isKlipperMode()) {
            // Ohne eingerichtete Steckdose entscheidet die Verbindung -- die
            // Antwort steht in status-manager.js, hier wird sie nur gelesen.
            const printerOnline = (typeof window.druckerDa === 'boolean') ? window.druckerDa
            : (window.lastKnownSwitchState === 'on' && window.lastMqttStatus === true);
            if (window.isFilamentDrying || !printerOnline) {
                hideDevCards();
                return;
            }
            showDevCards();
            return;
        }

        // Aus dem Socket-Stand lesen statt zu holen.
        //
        // Diese Funktion braucht genau drei Werte: gcode_state, mqtt und
        // developer_mode. Die ersten beiden stehen im Push (window.lastPrintData
        // traegt seit 20aug26 alle 95 Schluessel), der dritte ist statische
        // Konfiguration und aendert sich zur Laufzeit nie.
        //
        // Vorher holte jeder Aufruf beides frisch — und die Trocknungs-Kachel
        // ruft alle 10 Sekunden hierher durch (FilamentDryingManager.updateStatus
        // → _applyControlsVisibility → hier). Das waren dauerhaft 6 Anfragen pro
        // Minute mit je 6,7 KB, nur um zu entscheiden, ob ein paar Knoepfe
        // sichtbar sind.
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

            // Prüfe ob Filament-Trocknung aktiv ist
            if (window.isFilamentDrying) {
                console.log(texts.console_drying_active_cards_hidden);
                hideDevCards();
                return;
            }

            // MQTT nicht verbunden oder Developer Mode nicht aktiv -> verstecken
            if (data.mqtt !== true || config.mqtt.developer_mode !== true) {
                hideDevCards();
                return;
            }

            // Developer Mode aktiv + MQTT verbunden -> Card UND Buttons sofort anzeigen
            showDevCards();

            // Teile ueberspringen: dieselbe Funktion wie im Socket-Weg,
            // damit die beiden Wege nicht auseinanderlaufen.
            if (window.skTeileKnopfZeigen) window.skTeileKnopfZeigen(data);

            if (isPrinting) {
                // Homing bleibt während des Drucks gesperrt; SD-Karte und
                // Steuerung bleiben sichtbar.
                _melde_knopfzustand('druck', texts.console_print_running_hide_buttons);
                ['homing-btn-mobile', 'homing-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
                // Steuerung bleibt sichtbar: seit dem Uebersicht-Tab ist das
                // Fenster auch waehrend des Drucks nuetzlich (Temperaturen,
                // Luefter, Licht). Bewegen sperrt moveAxis selbst.
                document.querySelectorAll('button[onclick*="openPrinterControl"]').forEach(btn => {
                    btn.style.display = '';
                });
            } else if (isPaused) {
                // PAUSE: Homing bleibt gesperrt, SD-Karte und Steuerung bleiben sichtbar.
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
                // IDLE: Alle Buttons anzeigen
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
