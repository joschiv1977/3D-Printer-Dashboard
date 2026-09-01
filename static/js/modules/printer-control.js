/**
 * Printer Control Manager
 * Handles printer control modal: axis movement, homing, extruder temperature,
 * filament load/unload/change/purge, camera preview, and timelapse fullscreen.
 */
class PrinterControlManager {
    constructor() {
        this.controlCameraInterval = null;
        this.modalHomingDone = false;

        // Start temperature update interval
        setInterval(() => {
            if (document.getElementById('printerControlModal').style.display !== 'none') {
                this.updateExtruderTemp();
            }
        }, 8000);

        // Duesenauswahl einblenden, wenn das Drucker-Profil zwei Duesen
        // meldet. Nutzt den dokumentweit gecachten /api/config-Abruf (denselben
        // wie tab-bar-manager), also keine zusaetzliche Anfrage.
        document.addEventListener('DOMContentLoaded', () => {
            window.__directCfgPromise = window.__directCfgPromise ||
                fetch('/api/config', { credentials: 'same-origin' })
                    .then(r => r.json()).catch(() => ({}));
            // Erststand aus der Config — dieselbe Liste wie im Status, nur
            // ohne Live-Zustand. Der Status ueberschreibt sie, sobald er da
            // ist. Die Zuordnung passiert an EINER Stelle, serverseitig.
            window.__directCfgPromise.then(cfg => {
                const prof = (cfg && cfg.printer_profile) || {};
                this._caps = prof.capabilities || {};
                this.applyNozzleSelector(this._caps);
                this.applyDeviceTab(this._caps, this.lastState || {});
            }).catch(() => {});
        });

        // Live-Status: Geraet-Tab nachziehen.
        document.addEventListener('DOMContentLoaded', () => {
            const attach = () => {
                if (!window.socket || !window.socket.on) { setTimeout(attach, 500); return; }
                window.socket.on('printer_state', () => {
                    const st = (window.activePrinter && window.activePrinter.state) || {};
                    this.lastState = st;
                    // Der Status bringt die Faehigkeiten mit — er weiss mehr
                    // als die Config, weil das Geraet selbst gemeldet hat.
                    if (st.capabilities) this._caps = st.capabilities;
                    this.applyNozzleSelector(this._caps || {});
                    this.applyDeviceTab(this._caps || {}, st);
                    this.updateDeviceTab(st);
                });
            };
            attach();
        });
    }


    // ========================================
    // Geraet-Tab (X2D/H2D & Co.)
    // ========================================
    //
    // Alles hier blendet sich selbst ein oder aus. Zwei Quellen:
    //   Status   was der DRUCKER meldet (Duesen, Luftfuehrungs-Modi, Tuer)
    //   Profil   was das MODELL laut Datenblatt hat (Summer, 2. Hilfslueftern)
    // Nichts wird nach Modell geraten, wo das Geraet selbst Auskunft gibt.

    /** Blendet Tab und Bloecke passend zum Drucker ein.
     *
     * Fragt AUSSCHLIESSLICH die Faehigkeitsliste ab. Die fuehrt der Server
     * aus Profil und Live-Zustand zusammen (services/printer_capabilities.py)
     * — frueher pruefte die Oberflaeche hier beides einzeln und musste bei
     * jeder neuen Funktion mitgepflegt werden.
     */
    applyDeviceTab(caps, status) {
        const c = caps || {};
        const st = status || {};
        const show = (id, on) => {
            const e = document.getElementById(id);
            if (e) e.style.display = on ? '' : 'none';
        };

        show('dev-nozzles-panel', !!c.dual_nozzle);
        show('dev-chamber-panel', !!c.chamber_heater);
        show('dev-airduct-panel', !!c.airduct);
        show('dev-fans-panel', true);
        show('dev-misc-panel', true);
        show('dev-buzzer-panel', !!c.buzzer);
        this.zeichneKalibrierung(c);
        // Die neuen Bloecke haengen nicht am Profil, sondern daran, ob der
        // Drucker die Sache ueberhaupt meldet — steht alles im device_report.
        const rep = st.device_report || {};

        // Zusatzlichter: der lights_report des Geraets ist die Wahrheit —
        // der X2D meldet z.B. KEIN chamber_light2 (das hat der H2D) und
        // ignoriert den Schaltbefehl stumm. Nur wenn (noch) kein Report da
        // ist, gilt das Profil.
        const lampen = rep.lights || {};
        const gemeldet = Object.keys(lampen).length > 0;
        const licht2 = gemeldet ? ('chamber_light2' in lampen) : !!c.chamber_light2;
        const bettlicht = gemeldet ? ('heatbed_light' in lampen) : !!c.heatbed_light;
        show('dev-light2-row', licht2);
        show('dev-bedlight-row', bettlicht);
        show('dev-lights-panel', !!(licht2 || bettlicht));
        show('dev-spools-panel', !!(rep.spools || []).length);
        show('dev-storage-panel', !!Object.keys(rep.storage || {}).length);
        show('dev-plate-panel', !!(rep.build_plate || {}).id);
        show('dev-vent-panel', !!(rep.ventobox || {}).available);

        show('ctrl-tab-device', !!(c.dual_nozzle || c.chamber_heater || c.airduct ||
                                   c.buzzer || c.ams || c.chamber_light2 ||
                                   (rep.spools || []).length ||
                                   Object.keys(rep.storage || {}).length));

        if (c.airduct) this.buildAirductOptions(c.airduct_modes, st.airduct_mode);
        this.buildFanRows(c);

        // Luefter-Knopf auch im Bambu-Betrieb — /api/fans existiert dort
        // jetzt, das Fenster ist dasselbe wie bei Klipper-Direct.
        show('fan-btn-mobile', true);
        show('fan-btn-desktop', true);
    }

    buildAirductOptions(modes, current) {
        const sel = document.getElementById('dev-airduct');
        if (!sel) return;
        const texts = window.texts || {};
        const names = {
            0: texts.airduct_cooling || 'Kühlen',
            1: texts.airduct_heating || 'Heizen',
            2: texts.airduct_laser || 'Laser',
        };
        sel.innerHTML = '';
        modes.forEach(m => {
            const o = document.createElement('option');
            o.value = String(m);
            o.textContent = names[m] || String(m);
            if (m === current) o.selected = true;
            sel.appendChild(o);
        });
    }

    buildFanRows(caps) {
        const box = document.getElementById('dev-fans-list');
        if (!box) return;
        const texts = window.texts || {};
        // Gleiche Objekte und Namen wie das Luefter-Fenster (/api/fans):
        // bei zwei Hilfslueftern links/rechts getrennt, sonst einer.
        const fans = [['part', texts.fan_part || 'Bauteillüfter']];
        if (caps && caps.secondary_aux_fan) {
            fans.push(['aux_l', texts.fan_aux_left || 'Hilfslüfter links']);
            fans.push(['aux_r', texts.fan_aux_right || 'Hilfslüfter rechts']);
        } else {
            fans.push(['aux', texts.fan_aux || 'Hilfslüfter']);
        }
        fans.push(['chamber', texts.fan_chamber || 'Kammerlüfter']);
        // Nur neu bauen, wenn sich der Luefter-Satz aendert — die Panels
        // wurden frueher mit leeren capabilities gebaut und blieben dann
        // fuer immer falsch (einzelner Aux statt links/rechts).
        const signatur = fans.map(f => f[0]).join(',');
        if (box.dataset.built === signatur) return;
        box.dataset.built = signatur;
        box.innerHTML = '';
        fans.forEach(([key, label]) => {
            const row = document.createElement('div');
            row.className = 'dev-fan-row';
            row.innerHTML =
                '<span class="dev-fan-label">' + label + '</span>' +
                '<input type="range" min="0" max="100" step="10" value="0" ' +
                'id="dev-fan-' + key + '" class="dev-fan-slider">' +
                '<span class="dev-fan-value" id="dev-fan-' + key + '-val">0%</span>';
            box.appendChild(row);
            const slider = row.querySelector('input');
            const out = row.querySelector('.dev-fan-value');
            slider.addEventListener('input', () => { out.textContent = slider.value + '%'; });
            slider.addEventListener('change', () => this.setFan(key, parseInt(slider.value, 10)));
        });
    }

    /** Geraet-Tab-Slider mit den Ist-Werten aus /api/fans fuellen —
     *  dieselbe Quelle wie das Luefter-Fenster, damit beide identisch
     *  zeigen (inkl. Hilfsluefter links/rechts aus den Airduct-Teilen). */
    refreshDeviceFans() {
        const tab = document.getElementById('device-tab');
        if (!tab || tab.style.display === 'none') return;
        if (this._devFansBusy) return;
        this._devFansBusy = true;
        window.apiCall('/api/fans')
            .then(r => r.json())
            .then(d => {
                const texts = window.texts || {};
                (d.fans || []).forEach(f => {
                    const slider = document.getElementById('dev-fan-' + f.object);
                    const wert = document.getElementById('dev-fan-' + f.object + '-val');
                    const pct = f.speed_percent != null ? f.speed_percent : 0;
                    // Nicht unterm Finger wegziehen
                    if (slider && document.activeElement !== slider) slider.value = pct;
                    if (slider) slider.disabled = f.controllable === false;
                    // Im Heiz-Modus sind die AUX-Pfade Umluft der Kammer-
                    // heizung — Hinweis statt nacktem Prozentwert.
                    if (wert) wert.textContent = f.note
                        ? pct + '% · ' + (texts[f.note] || f.note)
                        : pct + '%';
                });
            })
            .catch(() => {})
            .finally(() => { this._devFansBusy = false; });
    }

    /** Live-Werte im Geraet-Tab nachziehen. */
    /** /api/status in die flache Form bringen, die der Geraet-Tab liest.
     *
     * Die Antwort ist nach Themen gegliedert (temperatures, ams, ...), der
     * Tab erwartet die Werte flach. Statt beide Formen im Tab zu behandeln,
     * wird hier einmal umgelegt.
     */
    applyStatusPayload(data) {
        if (!data) return;
        const flach = Object.assign({}, data, data.temperatures || {}, {
            ams_units: (data.ams && data.ams.units) || data.ams_units || [],
            device_report: data.device_report || {},
            capabilities: data.capabilities || this._caps || {},
        });
        this.lastState = flach;
        if (flach.capabilities) this._caps = flach.capabilities;
        this.applyDeviceTab(this._caps || {}, flach);
        this.updateDeviceTab(flach);
        // Der Kalibrier-Ablauf hing bis 28aug26 an genau zwei Aufrufen:
        // Reiterwechsel und 1,5 s nach dem Start. Danach stand die Karte
        // still — bei einer 49-Minuten-Kalibrierung also fast durchgehend.
        this.zeichneKalibrierLauf();
        // Uebersicht (Modal) und Hauptseiten-Zonen leben vom selben Takt;
        // updateOverviewTab schreibt beide ID-Saetze in einem Lauf.
        this.updateOverviewTab();
        this.renderMaterialZone();
        this.updateExtruderTab();
        this.renderFilamentSlots();
        this.refreshDeviceFans();
        this.sperreDruckTabs();
    }

    /** Achsen- und Extruder-Tab sperren, solange der Drucker beschaeftigt
     *  ist — beim Drucken (RUNNING/PREPARE) und waehrend eines
     *  Filament-Ablaufs.
     *
     *  Der Ablauf war bisher nur im Filament-Tab zu sehen. In den anderen
     *  liess sich weiter alles bedienen: der Drucker nimmt die Befehle an,
     *  fuehrt sie aber erst hinterher aus — am Geraet sah es aus, als
     *  passiere nichts (26aug26 gemeldet: Temperatur waehrend des Ladens
     *  gesetzt, ausgefuehrt wurde sie Minuten spaeter).
     *
     *  Der Server-Guard bleibt das zweite Netz. */
    sperreDruckTabs() {
        const zustand = String((window.lastPrintData || {}).gcode_state || '').toUpperCase();
        const druckt = zustand === 'RUNNING' || zustand === 'PREPARE';
        const rep = (this.lastState || {});
        const schritt = e => (e && (e.filament_step != null
            ? e.filament_step : ((e.stat || 0) & 0xFF))) || 0;
        const filLaeuft = (rep.extruders || []).some(e => schritt(e) !== 0);
        const beschaeftigt = druckt || filLaeuft;

        ['movement-tab', 'extruder-tab'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('ctrl-gesperrt', beschaeftigt);
        });

        // Und sagen, WARUM gesperrt ist — eine graue Flaeche ohne Begruendung
        // sieht nach kaputt aus.
        const texts = window.texts || {};
        // Das Element steht im Bauplan neben der Kamera — hier nur fuellen.
        const hinweis = document.getElementById('ctrl-busy-hinweis');
        if (hinweis) {
            hinweis.style.display = beschaeftigt ? '' : 'none';
            hinweis.textContent = filLaeuft
                ? (texts.guard_ams_busy || 'Filament-Vorgang läuft noch – bitte warten.')
                : (texts.guard_printing || 'Während des Drucks nicht möglich.');
        }
    }

    updateDeviceTab(status) {
        const st = status || {};
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        const texts = window.texts || {};

        // Duesen: Bambu zaehlt 1 = links, 0 = rechts.
        const temps = st.nozzle_temps || {};
        const targets = st.nozzle_targets || {};
        const hw = {};
        (st.nozzles || []).forEach(n => { if (n && n.id != null) hw[n.id] = n; });
        [['left', 1], ['right', 0]].forEach(([side, id]) => {
            set('dev-nozzle-' + side + '-temp', temps[id] != null ? Math.round(temps[id]) : '--');
            set('dev-nozzle-' + side + '-target', targets[id] != null ? Math.round(targets[id]) : '--');
            const h = hw[id];
            set('dev-nozzle-' + side + '-hw',
                h ? [h.diameter ? h.diameter + ' mm' : null, h.type || null].filter(Boolean).join(' · ') : '');
            const dot = document.getElementById('dev-nozzle-' + side + '-active');
            if (dot) dot.style.visibility = (st.active_nozzle === id) ? 'visible' : 'hidden';
        });
        set('dev-nozzle-left-name', texts.nozzle_left || 'Düse 1 (links)');
        set('dev-nozzle-right-name', texts.nozzle_right || 'Düse 2 (rechts)');

        // Titel der neuen Bloecke
        set('dev-spools-title', texts.dev_spools || 'Externe Spulen');
        set('dev-storage-title', texts.dev_storage || 'Speicher');
        set('dev-plate-title', texts.dev_plate || 'Druckplatte');
        set('dev-plate-label', texts.dev_plate_detected || 'Erkannt');
        set('dev-vent-title', texts.dev_vent || 'Filterbox');
        set('dev-vent-state-label', texts.dev_vent_state || 'Zustand');
        set('dev-vent-speed-label', texts.dev_vent_speed || 'Drehzahl');

        // Kammer
        set('dev-chamber-temp', st.chamber_temp != null ? Math.round(st.chamber_temp) + '°C' : '--°C');
        set('dev-chamber-target', st.chamber_target != null ? Math.round(st.chamber_target) : '--');

        // Tuer + Werkzeug
        set('dev-door-value', st.door_open ? (texts.door_open || 'offen') : (texts.door_closed || 'geschlossen'));
        const toolRow = document.getElementById('dev-tool-row');
        if (toolRow) {
            const tool = st.tool_module;
            toolRow.style.display = (tool && tool !== 'none') ? '' : 'none';
            set('dev-tool-value', tool || '--');
        }

        this.renderAms(st.ams_units);
        this.renderDeviceReport(st.device_report || {}, st);

        // Luftfuehrung: aktuellen Modus nachziehen
        const sel = document.getElementById('dev-airduct');
        if (sel && st.airduct_mode != null && sel.value !== String(st.airduct_mode)) {
            sel.value = String(st.airduct_mode);
        }
    }

    /** Alles, was der Drucker sonst noch meldet (device_report).
     *
     * Baut mit denselben Bausteinen wie der Rest des Geraet-Tabs: dev-row
     * fuer Wertepaare, ctrl-tip-box fuer Hinweise.
     */
    renderDeviceReport(rep, st) {
        const texts = window.texts || {};
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        const esc = (t) => String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // --- Externe Spulen. 254 links, 255 rechts; Einduesen-Geraete nur 255.
        const liste = document.getElementById('dev-spools-list');
        if (liste) {
            const seiten = { 254: texts.spool_left || 'Links', 255: texts.spool_right || 'Rechts' };
            const einzeln = (rep.spools || []).length < 2;
            // Welche Spule welche Duese speist, sagt der Drucker selbst.
            const quelle = {};
            (rep.extruders || []).forEach(e => {
                if (e && e.source != null) quelle[e.source] = e.id;
            });
            liste.innerHTML = (rep.spools || []).map(sp => {
                const name = einzeln ? (texts.spool_external || 'Externe Spule')
                                     : (seiten[sp.id] || String(sp.id));
                if (sp.empty) {
                    return `<div class="dev-row"><span>${esc(name)}</span>` +
                           `<strong>${esc(texts.ams_empty || 'leer')}</strong></div>`;
                }
                const teile = [];
                if (sp.temp_min && sp.temp_max) teile.push(`${esc(sp.temp_min)}–${esc(sp.temp_max)}°C`);
                if (sp.diameter) teile.push(`${esc(sp.diameter)} mm`);
                if (quelle[sp.id] != null) {
                    teile.push(`${esc(texts.spool_feeds || 'speist Düse')} ${quelle[sp.id]}`);
                }
                return `<div class="dev-row"><span>${esc(name)}</span>` +
                       `<strong>${esc(sp.type)}</strong></div>` +
                       (teile.length ? `<div class="dev-row"><span></span>` +
                                       `<span>${teile.join(' · ')}</span></div>` : '');
            }).join('');
        }

        // --- Speicher. Der Stick traegt Timelapse und Kameraaufnahmen und
        // laeuft als erstes voll — deshalb ab 90 Prozent ein Hinweis.
        const sp = rep.storage || {};
        const spListe = document.getElementById('dev-storage-list');
        if (spListe) {
            const zeile = (label, frei, gesamt, prozent) => {
                if (!gesamt) return '';
                const gb = (kb) => (kb / 1048576).toFixed(1);
                return `<div class="dev-row"><span>${esc(label)}</span>` +
                       `<strong>${gb(gesamt - frei)} / ${gb(gesamt)} GB` +
                       (prozent != null ? ` (${prozent}%)` : '') + `</strong></div>`;
            };
            spListe.innerHTML =
                zeile(texts.storage_external || 'USB-Stick', sp.external_free_kb,
                      sp.external_total_kb, sp.external_used_percent) +
                zeile(texts.storage_internal || 'Intern', sp.internal_free_kb,
                      sp.internal_total_kb, sp.internal_used_percent);
            const hinweis = document.getElementById('dev-storage-hint');
            if (hinweis) {
                const voll = (sp.external_used_percent || 0) >= 90;
                hinweis.style.display = voll ? '' : 'none';
                hinweis.textContent = texts.storage_full_hint ||
                    'Wenig Platz — der Drucker bricht sonst beim Speichern der Timelapse ab.';
            }
        }

        // --- Druckplatte: base = Slicer-BedType-Enum (Studio PrintConfig.hpp),
        //     gemessen am X2D (Textured => base 4). Rohe QR-ID nur als Fallback.
        const PLATTEN = { 1: 'Cool Plate', 2: 'Engineering Plate', 3: 'Smooth PEI Plate',
                          4: 'Textured PEI Plate', 5: 'Cool Plate SuperTack' };
        const bp = rep.build_plate || {};
        set('dev-plate-value', PLATTEN[bp.base] || bp.id || '--');

        // --- Monitoring moved out: the detections are settings of the
        //     printer, not controls, and live in Einstellungen → Am Drucker
        //     (static/settings.html) since 28aug26.
        // --- Filterbox
        const vent = rep.ventobox || {};
        set('dev-vent-state', vent.enabled ? (texts.state_on || 'An') : (texts.state_off || 'Aus'));
        set('dev-vent-speed', vent.speed != null ? vent.speed + '%' : '--');
    }

    setFan(fan, percent) {
        const texts = window.texts || {};
        window.printerAdapter.setFan(fan, percent).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }





    /**
     * Kammer-Ziel setzen — und nachsehen, ob der Drucker es genommen hat.
     *
     * Der X2D verwirft `set_ctt` stillschweigend, wenn das Ziel ueber dem
     * liegt, was das geladene Filament vertraegt (sein Display sagt dazu:
     * "Filament kann weich werden bei ueber 50 Grad"). Es kommt kein
     * Fehler zurueck, der Sollwert bleibt einfach stehen. Bis 21aug26
     * meldete die Oberflaeche trotzdem "Kammer-Ziel gesetzt" — man stellte
     * 65 ein, las die Bestaetigung und wunderte sich, dass 40 stehen blieb.
     *
     * Deshalb: senden, kurz warten, den gemeldeten Sollwert vergleichen.
     */
    setChamberTemp() {
        const texts = window.texts || {};
        const input = document.getElementById('dev-chamber-input');
        const v = input ? parseInt(input.value, 10) : NaN;
        if (!Number.isFinite(v)) return;
        window.printerAdapter.setTemp('chamber', v).then(r => {
            if (!r.ok) {
                skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                return;
            }
            skToast(texts.toast_chamber_set || 'Kammer-Ziel gesetzt', 'info');
            this._pruefeKammerZiel(v);
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    /** Nach ein paar Sekunden nachsehen, ob der Sollwert wirklich steht. */
    _pruefeKammerZiel(gewuenscht) {
        const texts = window.texts || {};
        const hole = () => (window.apiCall ? apiCall('/api/status')
                                           : fetch('/api/status', { credentials: 'same-origin' }))
            .then(r => r.json());
        // Zwei Versuche: der Drucker meldet den neuen Sollwert nicht sofort.
        setTimeout(() => {
            hole().then(st1 => {
                if (parseInt(st1.chamber_target, 10) === gewuenscht) return;
                setTimeout(() => {
                    hole().then(st2 => {
                        const ist = parseInt(st2.chamber_target, 10);
                        if (ist === gewuenscht) return;
                        skToast(
                            (texts.chamber_refused
                                || 'Der Drucker hat {soll} °C nicht übernommen — über 50 °C lehnt er ab, '
                                 + 'solange Filament geladen ist. Es bleibt bei {ist} °C.')
                                .replace('{soll}', gewuenscht).replace('{ist}', isFinite(ist) ? ist : '?'),
                            'warning', { dauer: 9000 });
                    }).catch(() => {});
                }, 4000);
            }).catch(() => {});
        }, 2500);
    }

    setAirductMode(mode) {
        const texts = window.texts || {};
        window.printerAdapter.setAirduct(parseInt(mode, 10)).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    setBuzzer(mode) {
        const texts = window.texts || {};
        window.printerAdapter.buzzer(mode).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }


    // ========================================
    // AMS
    // ========================================
    //
    //
    // Eine Karte je Einheit. Was eine Einheit kann, sagt sie selbst:
    // can_dry ist nur bei AMS 2 Pro und AMS HT gesetzt, und das AMS HT hat
    // genau EIN Fach statt vier.
    renderAms(units) {
        const box = document.getElementById('dev-ams-list');
        const panel = document.getElementById('dev-ams-panel');
        if (!box || !panel) return;
        const list = units || [];
        panel.style.display = list.length ? '' : 'none';
        if (!list.length) { box.innerHTML = ''; return; }

        const texts = window.texts || {};
        // Nur neu bauen, wenn sich die Struktur aendert — sonst waeren
        // Eingabefelder bei jedem Status-Update wieder leer.
        const sig = list.map(u => u.id + ':' + (u.trays || []).length + ':' + u.model).join('|');
        if (box.dataset.sig !== sig) {
            box.dataset.sig = sig;
            box.innerHTML = list.map(u => this.amsCardHtml(u, texts)).join('');
        }
        list.forEach(u => this.amsCardUpdate(u, texts));
    }

    amsCardHtml(u, texts) {
        const trays = (u.trays || []).map(t =>
            '<div class="ams-tray" id="ams-' + u.id + '-tray-' + t.id + '">' +
              '<span class="ams-tray-dot" id="ams-' + u.id + '-dot-' + t.id + '"></span>' +
              '<span class="ams-tray-type" id="ams-' + u.id + '-type-' + t.id + '"></span>' +
              '<span class="ams-tray-remain" id="ams-' + u.id + '-remain-' + t.id + '"></span>' +
              '<button class="ams-rfid-btn" title="RFID" ' +
                'onclick="amsReadRfid(' + u.id + ',' + t.id + ')">↻</button>' +
              '<button class="ams-rfid-btn" title="Filament" ' +
                'onclick="amsEditTray(' + u.id + ',' + t.id + ')">✎</button>' +
            '</div>').join('');

        // Trocknen laeuft ueber den 014-Dialog (Typ + Grad + Stunden) —
        // die alten Zahleninputs (Grad/Minuten) sind raus.
        const dry = u.can_dry ? (
            '<div class="ams-dry">' +
              '<div class="ams-dry-state" id="ams-' + u.id + '-drystate"></div>' +
              '<div class="ams-dry-controls">' +
                '<button class="ams-dry-start" onclick="amsDryStart(' + u.id + ')">' +
                    (texts.ams_dry_start || 'Trocknen') + '</button>' +
                '<button class="ams-dry-stop" onclick="amsDryStop(' + u.id + ')">' +
                    (texts.ams_dry_stop || 'Stopp') + '</button>' +
              '</div>' +
            '</div>') : '';

        return '<div class="ams-card">' +
            '<div class="ams-head">' +
              '<strong>' + (u.model || 'AMS') + ' #' + u.id + '</strong>' +
              '<span class="ams-env" id="ams-' + u.id + '-env"></span>' +
            '</div>' +
            '<div class="ams-trays">' + trays + '</div>' + dry +
          '</div>';
    }

    amsCardUpdate(u, texts) {
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        // Feuchte/Temperatur tragen ein Symbol, brauchen also innerHTML —
        // set() schreibt Text und wuerde das SVG als Zeichen ausgeben.
        const setzeMarkup = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };
        const parts = [];
        if (u.humidity != null) parts.push(window.skIcon('tropfen', 'hd-ic--xs') + ' ' + u.humidity + '%');
        if (u.temperature != null) parts.push(window.skIcon('thermo', 'hd-ic--xs') + ' ' + Math.round(u.temperature) + '°C');
        setzeMarkup('ams-' + u.id + '-env', parts.join('&nbsp; '));

        (u.trays || []).forEach(t => {
            const dot = document.getElementById('ams-' + u.id + '-dot-' + t.id);
            if (dot) {
                // tray_color ist RRGGBBAA; der Alpha-Teil interessiert nicht.
                const c = (t.color || '').slice(0, 6);
                dot.style.background = c ? ('#' + c) : 'transparent';
                dot.style.borderStyle = c ? 'solid' : 'dashed';
            }
            set('ams-' + u.id + '-type-' + t.id, t.type || (texts.ams_empty || 'leer'));
            // remain = -1 heisst unbekannt (nur mit Bambu-RFID gefuellt).
            set('ams-' + u.id + '-remain-' + t.id,
                (t.remain != null && t.remain >= 0) ? t.remain + '%' : '');
        });

        if (u.can_dry) {
            const mins = u.dry_time || 0;
            set('ams-' + u.id + '-drystate', mins > 0
                ? (texts.ams_drying || 'Trocknet') + ' — ' +
                  Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min'
                : (texts.ams_dry_idle || 'Trocknung aus'));
        }
    }

    /** Klappt den Filament-Editor eines Fachs auf oder zu. */
    amsEditTray(amsId, trayId) {
        // Einheitlicher Editor fuer alle Aufrufer (Material-Zone, Filament-
        // Tab, Geraet-Tab) — die alte Inline-Box existierte nur im Geraet-Tab,
        // ueberall sonst passierte beim Klick schlicht nichts.
        this.openTrayEditor(amsId, trayId);
    }

    /** Filament-Editor wie am Display: volle Profilliste + Farbe. */
    openTrayEditor(amsId, trayId) {
        const texts = window.texts || {};
        const st = this.lastState || {};
        const extern = amsId >= 254;
        let aktuell = {};
        if (extern) {
            aktuell = (((st.device_report || {}).spools) || [])
                .find(s => parseInt(s.id, 10) === amsId) || {};
        } else {
            const unit = (st.ams_units || []).find(u => u.id === amsId) || {};
            aktuell = (unit.trays || []).find(t => (t.id || 0) === trayId) || {};
        }

        // Aufbau 1:1 nach dem Display (wiki screen-operation/015.png):
        // Zeile Filament = ZWEI Dropdowns (Marke + Sorte), Zeile Farbe =
        // Farbquadrat, Zeile Duesentemperatur = Min/Max-Anzeige aus dem
        // Profil, unten Abbrechen | Bestaetigen (gruen).
        let overlay = document.getElementById('tray-edit-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'tray-edit-overlay';
        overlay.className = 'tray-edit-overlay';
        // Basisliste + Custom-Profile (Kennung "P..."), die Studio auf den
        // Drucker gesynct hat — sichtbar in den aktuell bestueckten
        // Faechern/Spulen (z.B. "Extrudr DuraPro ABS"). Das Display zeigt
        // die auch, also nehmen wir sie in die Auswahl auf.
        // Profilliste kommt vom Server (/api/filament/db): Bambus Basisprofile
        // plus die Custom-Profile aus den gesliceten 3MFs. Frueher lag die
        // Basisliste als JS-Konstante hier — fuer iOS und Android unerreichbar,
        // weshalb die den Fachtyp gar nicht setzen konnten.
        // Erst die Serverliste, dann die Custom-Profile. Andersherum stand
        // schon nach dem ersten bestueckten Fach etwas in `db`, die Pruefung
        // unten griff nicht mehr — und im Editor gab es genau eine Marke:
        // die des geladenen Filaments.
        if (!(this._filamentDb || []).length) {
            if (!this._filamentDbLaeuft) {
                this._filamentDbLaeuft = true;
                (window.apiCall ? apiCall('/api/filament/db') : fetch('/api/filament/db', { credentials: 'same-origin' }))
                    .then(r => r.json())
                    .then(d => {
                        this._filamentDb = ((d && d.profiles) || []).map(p =>
                            [p.idx, p.name, p.typ || '?',
                             parseInt(p.min, 10) || 190, parseInt(p.max, 10) || 240]);
                        // Trocknungs-Vorgaben kommen aus derselben Antwort.
                        // Die Tabelle in filament-db.js bleibt als Rueckfall
                        // stehen, falls der Server (noch) nichts schickt —
                        // gefuellt wird sie ab jetzt von dort.
                        if (d && d.dry_presets) uebernehmeTrocknung(d.dry_presets);
                        this._filamentDbLaeuft = false;
                        this.openTrayEditor(amsId, trayId);
                    })
                    .catch(() => { this._filamentDbLaeuft = false; });
            }
            return;
        }

        const db = this._filamentDb.slice();
        const bekannt = new Set(db.map(f => f[0]));
        const fuegeCustom = (idx, name, typ, lo, hi) => {
            if (!idx || bekannt.has(idx) || !name) return;
            bekannt.add(idx);
            db.push([idx, name, typ || '?',
                     parseInt(lo, 10) || 190, parseInt(hi, 10) || 240]);
        };
        // Profile, die nur in den bestueckten Faechern/Spulen auftauchen —
        // das Display zeigt die auch.
        (st.ams_units || []).forEach(u => (u.trays || []).forEach(t =>
            fuegeCustom(t.info_idx, t.name, t.type, t.nozzle_temp_min, t.nozzle_temp_max)));
        (((st.device_report || {}).spools) || []).forEach(sp =>
            fuegeCustom(sp.info_idx, sp.name, sp.type, sp.temp_min, sp.temp_max));
        const marke = (name) => name.split(' ')[0];
        const sorte = (name) => name.split(' ').slice(1).join(' ');
        const marken = [];
        db.forEach(f => { if (!marken.includes(marke(f[1]))) marken.push(marke(f[1])); });

        // Vorauswahl: das gemeldete Profil. Externe Spulen melden oft keins,
        // wohl aber die Sorte ("PLA") — dann das erste Profil dieser Sorte,
        // sonst stand im Editor der rechten Spule das Filament der linken.
        let gewaehlt = '';
        if (aktuell.info_idx && db.some(f => f[0] === aktuell.info_idx)) {
            gewaehlt = aktuell.info_idx;
        } else if (aktuell.type) {
            const passend = db.find(f => String(f[2]).toUpperCase() === String(aktuell.type).toUpperCase());
            gewaehlt = passend ? passend[0] : '';
        }
        if (!gewaehlt) gewaehlt = db[0] ? db[0][0] : '';
        let aktMarke = marke((db.find(f => f[0] === gewaehlt) || db[0])[1]);
        let farbe = String(aktuell.color || 'FFFFFF').replace('#', '').slice(0, 6).toUpperCase();
        const PALETTE = ['000000', 'FFFFFF', '8E9089', 'F72323', 'FF6A13', 'F7D959',
                         '35B54A', '0A2CA5', '46A8F9', '9425B5', 'F55A74', '8B4513'];

        overlay.innerHTML =
            '<div class="tray-edit-box">' +
              '<h4>' + (texts.ams_edit_title || 'Filament einstellen') + '</h4>' +
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label">' + (texts.ams_edit_filament || 'Filament') + '</span>' +
                '<div class="tray-edit-felder">' +
                  '<select class="tray-edit-select" id="tray-edit-marke"></select>' +
                  '<select class="tray-edit-select" id="tray-edit-sorte"></select>' +
                '</div>' +
              '</div>' +
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label">' + (texts.ams_edit_color || 'Farbe') + '</span>' +
                '<div class="tray-edit-felder tray-edit-felder--farbe">' +
                  '<label class="tray-edit-swatch" id="tray-edit-swatch">' +
                    '<input type="color" id="tray-edit-custom" value="#' + farbe + '">' +
                  '</label>' +
                  '<div class="tray-edit-palette" id="tray-edit-palette"></div>' +
                '</div>' +
              '</div>' +
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label">' + (texts.ams_edit_nozzle_temp || 'Düsentemperatur') + '</span>' +
                '<div class="tray-edit-felder tray-edit-temps-zeile">' +
                  '<span class="tray-edit-tdim">' + (texts.ams_edit_min || 'Minimum') + '</span>' +
                  '<span class="tray-edit-twert" id="tray-edit-tmin">--</span>' +
                  '<span class="tray-edit-tdim">' + (texts.ams_edit_max || 'Maximum') + '</span>' +
                  '<span class="tray-edit-twert" id="tray-edit-tmax">--</span>' +
                '</div>' +
              '</div>' +
              // Aus Spoolman uebernehmen: Sorte, Farbe und Temperaturen kommen
              // dann von dort, und das Fach bekommt eine feste Zuordnung.
              // Danach muss nichts mehr ueber Profilnamen erraten werden.
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label">' + (texts.spoolman || 'Spoolman') + '</span>' +
                '<div class="tray-edit-felder">' +
                  // Sieht aus wie die Auswahlfelder darueber, weil es dieselbe
                  // Entscheidung ist — nur aus der anderen Quelle.
                  '<button type="button" class="tray-edit-spoolknopf" id="tray-edit-spoolman">' +
                    '<span class="tray-edit-spoolpunkt" id="tray-edit-spoolpunkt"></span>' +
                    '<span class="tray-edit-spoolname" id="tray-edit-spoolname">' +
                      (texts.ams_edit_from_spoolman || 'Rolle wählen') + '</span>' +
                  '</button>' +
                '</div>' +
              '</div>' +
              '<div class="tray-edit-actions">' +
                '<button class="tray-edit-danger" id="tray-edit-reset">' +
                    (texts.ams_edit_reset || 'Zurücksetzen') + '</button>' +
                '<button class="tray-edit-cancel" id="tray-edit-cancel">' +
                    (texts.cancel || 'Abbrechen') + '</button>' +
                '<button class="tray-edit-save" id="tray-edit-save">' +
                    (texts.ams_edit_save || 'Bestätigen') + '</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        const selMarke = overlay.querySelector('#tray-edit-marke');
        const selSorte = overlay.querySelector('#tray-edit-sorte');
        const swatch = overlay.querySelector('#tray-edit-swatch');
        const palette = overlay.querySelector('#tray-edit-palette');
        const custom = overlay.querySelector('#tray-edit-custom');

        const zeigeTemps = () => {
            const f = db.find(e => e[0] === gewaehlt);
            overlay.querySelector('#tray-edit-tmin').textContent = f ? f[3] + ' °C' : '--';
            overlay.querySelector('#tray-edit-tmax').textContent = f ? f[4] + ' °C' : '--';
        };
        const maleSorten = () => {
            selSorte.innerHTML = db.filter(f => marke(f[1]) === aktMarke).map(f =>
                '<option value="' + f[0] + '"' + (f[0] === gewaehlt ? ' selected' : '') + '>' +
                sorte(f[1]) + '</option>').join('');
            if (!db.some(f => f[0] === gewaehlt && marke(f[1]) === aktMarke)) {
                gewaehlt = selSorte.value;
            }
            zeigeTemps();
        };
        selMarke.innerHTML = marken.map(m =>
            '<option' + (m === aktMarke ? ' selected' : '') + '>' + m + '</option>').join('');
        selMarke.addEventListener('change', () => { aktMarke = selMarke.value; maleSorten(); });
        selSorte.addEventListener('change', () => { gewaehlt = selSorte.value; zeigeTemps(); });

        const maleFarbe = () => {
            swatch.style.background = '#' + farbe;
            palette.innerHTML = PALETTE.map(c =>
                '<span class="tray-farbe' + (c === farbe ? ' tray-farbe--on' : '') + '"' +
                ' data-c="' + c + '" style="background:#' + c + '"></span>').join('');
            palette.querySelectorAll('.tray-farbe').forEach(p =>
                p.addEventListener('click', () => { farbe = p.dataset.c; maleFarbe(); }));
        };
        custom.addEventListener('input', () => {
            farbe = custom.value.replace('#', '').toUpperCase();
            maleFarbe();
        });

        maleSorten(); maleFarbe();

        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
        overlay.querySelector('#tray-edit-cancel').addEventListener('click', () => overlay.remove());
        // Reset wie am Display: Fach leeren -> zeigt danach wieder "?".
        overlay.querySelector('#tray-edit-reset').addEventListener('click', () => {
            // Nachfragen: der Knopf steht neben "Abbrechen" und sah bis
            // 22aug26 genauso aus. Ein Fehlgriff hat das Fach geleert, und
            // der Drucker wusste danach nicht mehr, was geladen ist.
            //
            // Ueber das Modal der Oberflaeche, NICHT ueber window.confirm:
            // das native Fenster kommt im Systemstil daher und passt in
            // keiner Zeile zum Rest.
            const frage = texts.ams_reset_confirm ||
                'Fach wirklich leeren? Der Drucker weiss danach nicht mehr, was geladen ist.';
            const leeren = () => {
            window.printerAdapter.amsSetFilament(amsId, trayId, '', '', '', 0, 0).then(r => {
                if (r.ok) {
                    skToast(texts.ams_filament_saved || 'Filament gesetzt', 'success');
                    overlay.remove();
                } else {
                    skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                }
            }).catch(() => skToast(texts.connection_error, 'error'));
            };
            if (window.showConfirmDialog) window.showConfirmDialog(frage, leeren);
            else if (window.skConfirm) window.skConfirm(frage, { danger: true })
                .then(ja => { if (ja) leeren(); });
        });
        // Rolle aus Spoolman: fuellt die Felder und merkt sich die Nummer.
        let spoolWahl = null;
        const spoolName = overlay.querySelector('#tray-edit-spoolname');
        overlay.querySelector('#tray-edit-spoolman').addEventListener('click', () => {
            if (!window.openSpoolPicker) return;
            window.openSpoolPicker({ onWahl: (spule) => {
                if (!spule) return;
                const fil = spule.filament || {};
                spoolWahl = spule.id;
                const hex = String(fil.color_hex || '').replace('#', '').slice(0, 6).toUpperCase();
                if (hex.length === 6) {
                    farbe = hex;
                    custom.value = '#' + hex;
                    maleFarbe();
                }
                // Passendes Profil vorwaehlen, damit der Drucker eine
                // Kennung bekommt — ohne die uebernimmt er nichts. Erst den
                // Hersteller versuchen, sonst irgendeins der Sorte.
                const mat = String(fil.material || '').toUpperCase();
                const marken_name = String((fil.vendor || {}).name || '').toLowerCase();
                const passend = db.filter(x => String(x[2]).toUpperCase() === mat);
                const treffer = passend.find(x => marken_name
                        && String(x[1]).toLowerCase().startsWith(marken_name.split(' ')[0]))
                    || passend[0];
                if (treffer) {
                    gewaehlt = treffer[0];
                    aktMarke = marke(treffer[1]);
                    selMarke.value = aktMarke;
                    maleSorten();
                }
                spoolName.textContent = [((fil.vendor || {}).name || ''), fil.name || '']
                    .filter(Boolean).join(' ');
                const punkt = overlay.querySelector('#tray-edit-spoolpunkt');
                if (punkt && hex.length === 6) {
                    punkt.style.background = '#' + hex;
                    punkt.style.display = '';
                }
            }});
        });

        overlay.querySelector('#tray-edit-save').addEventListener('click', () => {
            const f = db.find(e => e[0] === gewaehlt);
            if (!f) return;
            window.printerAdapter.amsSetFilament(amsId, trayId, f[0], f[2], farbe + 'FF', f[3], f[4]).then(r => {
                if (r.ok) {
                    skToast(texts.ams_filament_saved || 'Filament gesetzt', 'success');
                    if (spoolWahl != null) {
                        this._merkeSpoolZuordnung(
                            amsId, trayId, spoolWahl,
                            f[2], farbe, (spoolName.textContent || '').trim());
                        // Fuehrt genau DIESES Fach gerade zur Duese, ist die
                        // Rolle auch die aktive. Bei einem anderen Fach waere
                        // das falsch — dann verdraengte ein Klick auf Fach 3
                        // die Rolle, die wirklich gedruckt wird.
                        if (this._istAktivesFach(amsId, trayId) && window.activateSpool) {
                            window.activateSpool(spoolWahl);
                        }
                    }
                    overlay.remove();
                } else {
                    skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                }
            }).catch(() => skToast(texts.connection_error, 'error'));
        });
    }

    /** Zusatzlichter (zweites Kammerlicht, Heizbett). */
    setExtraLight(node, on) {
        const texts = window.texts || {};
        window.printerAdapter.setLight(on, node).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    /** Trocknungs-Dialog wie am Display (wiki screen-operation/014.png):
     *  Feuchte-Anzeige, Typ-Dropdown, Felder Grad + Stunden, gruener Start.
     *  Typwahl fuellt Grad/Stunden mit der Studio-Empfehlung. */
    /**
     * Trocknung laeuft: zeigen statt starten.
     *
     * Derselbe Rahmen wie das Startformular, aber ohne Eingabefelder — was
     * eingestellt ist, steht ja schon fest. Nur Stopp und Schliessen.
     */
    _amsDryLaeuft(unit) {
        const texts = window.texts || {};
        const rest = Math.floor((unit.dry_time || 0) / 60) + ':' +
            String((unit.dry_time || 0) % 60).padStart(2, '0');
        // Wie an den Faechern in der Karte: der Drucker liefert die Farbe
        // als Hex mit Alpha, davon brauchen wir die ersten sechs Stellen.
        const farbe = (hex) => {
            const h = String(hex || '').replace('#', '');
            return h ? '#' + h.slice(0, 6) : 'transparent';
        };
        const fertig = new Date(Date.now() + (unit.dry_time || 0) * 60000);
        const fertigUm = String(fertig.getHours()).padStart(2, '0') + ':' +
            String(fertig.getMinutes()).padStart(2, '0');

        let overlay = document.getElementById('dry-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'dry-overlay';
        overlay.className = 'tray-edit-overlay';

        // Dieselben Messspalten wie in der Materialkarte (.mz-mess):
        // Zeichen und Kuerzel klein oben, Wert darunter. Vorher standen hier
        // schlichte Label/Wert-Zeilen — die fielen neben der Karte ab.
        const mess = (zeichen, kuerzel, wert) =>
            '<div class="mz-mess"><div class="mz-mess-kopf">'
            + window.skIcon(zeichen, 'hd-ic--xs') + ' ' + kuerzel
            + '</div><div class="mz-mess-wert">' + wert + '</div></div>';

        overlay.innerHTML =
            '<div class="tray-edit-box">' +
              '<h4>' + (texts.ams_drying || 'Trocknet') + '</h4>' +
              // Werte links, AMS-Bild rechts. Rechts stand bisher nichts —
              // das Bild fuellt den Platz und zeigt, um welches Geraet es
              // geht. Dasselbe Bild wie in der Druckkarte
              // (socket-manager.js waehlt es genauso aus).
              '<div class="dry-inhalt">' +
                '<div class="dry-werte">' +
                  // Das Programm nur zeigen, wenn es NICHT dem entspricht, was
                  // in den Faechern liegt. Sonst stand dieselbe Angabe zweimal
                  // untereinander — einmal als Programm, einmal als Fach — und
                  // nichts sagte, was der Unterschied ist (27aug26).
                  (unit.dry_filament && !(unit.trays || []).some(t =>
                      String(t.type || '').toUpperCase() ===
                      String(unit.dry_filament).toUpperCase())
                    ? '<div class="dry-chip"><span class="dry-chip-kopf">'
                      + (texts.ams_dry_program || 'Programm') + '</span>'
                      + unit.dry_filament + '</div>' : '') +
                  '<div class="dry-mess">' +
                    (unit.humidity != null
                      ? mess('wasser', 'RH', unit.humidity + ' %') : '') +
                    (unit.temperature != null
                      ? mess('thermo', texts.mz_temp || 'Temp',
                          Math.round(unit.temperature) +
                          (unit.dry_temp ? ' / ' + unit.dry_temp : '') + ' °C') : '') +
                    mess('sanduhr', texts.mz_remaining || 'noch', rest + ' h') +
                    // Wann es fertig ist — die Uhrzeit sagt mehr als die
                    // Restdauer, wenn man den Abend planen will. Der Drucker
                    // meldet nur die Restminuten, die Uhrzeit rechnen wir.
                    mess('uhr', texts.ams_dry_done_at || 'fertig um', fertigUm) +
                  '</div>' +
                  // Was in dieser Einheit steckt. Beim Trocknen ist genau das
                  // die Frage: welche Spulen haengen da gerade drin.
                  ((unit.trays || []).some(t => t.type)
                    ? '<div class="dry-faecher-titel">'
                        + (texts.ams_dry_slots || 'Faecher') + '</div>'
                      + '<div class="dry-faecher">' +
                        (unit.trays || []).filter(t => t.type).map(t =>
                          '<span class="dry-fach">'
                          + '<span class="mz-slot-col" style="background:' + farbe(t.color) + '"></span>'
                          + (t.type || '?') + '</span>').join('') +
                      '</div>'
                    : '') +
                  '<div class="fk-block" id="dry-gedaechtnis"></div>' +
                '</div>' +
                '<img class="dry-ams" alt="' + (unit.model || 'AMS') + '" src="/static/img/ams/'
                  + (String(unit.model || '').toUpperCase().includes('HT') ? 'ams_ht.png' : 'ams.png')
                  + '">' +
              '</div>' +
              '<div class="tray-edit-actions">' +
                '<button class="tray-edit-cancel" id="dry-close">' +
                  // NICHT texts.cancel: "Abbrechen" laese sich hier wie
                  // "Trocknung abbrechen" — der Knopf schliesst nur das
                  // Fenster. settings_close gibt es in allen Sprachen.
                  (texts.settings_close || 'Schliessen') + '</button>' +
                // tray-edit-danger, NICHT tray-edit-save: Stopp bricht etwas
                // ab. Die Speichern-Klasse ist gruen und versprach das
                // Gegenteil.
                '<button class="tray-edit-danger" id="dry-stop">' +
                  (texts.ams_dry_stop || 'Stopp') + '</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        this._feuchteGedaechtnis(overlay, unit);

        const zu = () => overlay.remove();
        overlay.querySelector('#dry-close').onclick = zu;
        overlay.querySelector('#dry-stop').onclick = () => { zu(); amsDryStop(unit.id); };
        overlay.onclick = (e) => { if (e.target === overlay) zu(); };
    }

    amsDryStart(amsId) {
        const texts = window.texts || {};
        const unit = ((this.lastState || {}).ams_units || []).find(u => u.id === amsId) || {};

        // Laeuft schon eine Trocknung, gehoert hier KEIN Startformular hin.
        // Bis 27aug26 kam es trotzdem: man tippte auf das AMS und bekam die
        // Maske zum Starten, obwohl das Geraet gerade trocknete.
        if (unit.can_dry && (unit.dry_time || 0) > 0) {
            this._amsDryLaeuft(unit);
            return;
        }

        const presets = window.BAMBU_DRY_PRESETS || {};
        const typen = Object.keys(presets);

        // Vorauswahl: Typ des ersten belegten Fachs (Basistyp), sonst PLA.
        const fachTyp = ((unit.trays || []).map(t => (t.type || '').toUpperCase())
            .find(t => t) || 'PLA');
        let typ = typen.find(t => fachTyp.startsWith(t)) || 'PLA';

        let overlay = document.getElementById('dry-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'dry-overlay';
        overlay.className = 'tray-edit-overlay';
        overlay.innerHTML =
            '<div class="tray-edit-box">' +
              '<h4>' + (texts.ams_dry_title || 'Trocknung & Feuchtigkeit') + '</h4>' +
              '<div class="dry-feuchte">' + window.skIcon('tropfen', 'hd-ic--xs') + ' ' +
                (unit.humidity != null ? unit.humidity + ' %' : '--') +
                (unit.temperature != null ? ' · ' + Math.round(unit.temperature) + ' °C' : '') +
              '</div>' +
              // Der Momentwert oben beantwortet nicht, ob getrocknet werden
              // muss — das tut erst die Vorgeschichte. Wird nachgeladen.
              '<div class="fk-block" id="dry-gedaechtnis"></div>' +
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label">' + (texts.ams_dry_setting || 'Trocknungseinstellung') + '</span>' +
                '<div class="tray-edit-felder">' +
                  '<select class="tray-edit-select" id="dry-typ">' +
                    typen.map(t => '<option' + (t === typ ? ' selected' : '') + '>' + t + '</option>').join('') +
                  '</select>' +
                '</div>' +
              '</div>' +
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label"></span>' +
                '<div class="tray-edit-felder">' +
                  '<span class="dry-feld"><input type="number" id="dry-temp" min="35" max="85">' +
                    '<span class="dry-einheit">°C</span></span>' +
                  '<span class="dry-feld"><input type="number" id="dry-std" min="1" max="48">' +
                    '<span class="dry-einheit">h</span></span>' +
                '</div>' +
              '</div>' +
              // Drehen waehrend des Trocknens — dieselbe Ankreuzung wie am
              // AMS-Display. Das Feld ging vorher fest als False raus.
              '<label class="dry-drehen">' +
                '<input type="checkbox" id="dry-rotate">' +
                '<span>' + (texts.ams_dry_rotate || 'Spule drehen') + '</span>' +
              '</label>' +
              '<div class="tray-edit-actions">' +
                '<button class="tray-edit-cancel" id="dry-cancel">' + (texts.cancel || 'Abbrechen') + '</button>' +
                '<button class="tray-edit-save" id="dry-start">' + (texts.ams_dry_run || 'Start') + '</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        this._feuchteGedaechtnis(overlay, unit);

        const selTyp = overlay.querySelector('#dry-typ');
        const inTemp = overlay.querySelector('#dry-temp');
        const inStd = overlay.querySelector('#dry-std');
        // Im Druck gelten die niedrigeren on_print-Werte (ABS 75 statt 80).
        const druckt = ['RUNNING', 'PREPARE', 'PAUSE']
            .includes(String((window.lastPrintData || {}).gcode_state || '').toUpperCase());
        const fuelle = () => {
            const p = (presets[selTyp.value] || [[55, 8], [55, 8]])[druckt ? 1 : 0];
            inTemp.value = p[0];
            inStd.value = p[1];
        };
        selTyp.addEventListener('change', fuelle);
        fuelle();

        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
        overlay.querySelector('#dry-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#dry-start').addEventListener('click', () => {
            const temp = parseInt(inTemp.value, 10) || 0;
            const std = parseInt(inStd.value, 10) || 0;
            const drehen = !!(overlay.querySelector('#dry-rotate') || {}).checked;
            window.printerAdapter.amsDryStart(amsId, temp, std * 60,
                                              selTyp.value, drehen).then(r => {
                if (r.ok) {
                    skToast(texts.ams_dry_started || 'Trocknung gestartet', 'info');
                    overlay.remove();
                } else {
                    skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                }
            }).catch(() => skToast(texts.connection_error, 'error'));
        });
    }

    /**
     * Die globale Quellennummer eines Fachs — vom Server.
     *
     * Sie steht seit 28aug26 als `global_id` an jedem Fach
     * (services/printer_state.parse_ams_units). Vorher rechnete das jede
     * Oberflaeche selbst: hier an zwei Stellen, auf Android an einer, auf
     * iOS gar nicht — und der HT-Sonderfall (ab 128 addieren statt
     * multiplizieren) fehlte erst und musste nachgereicht werden.
     *
     * Die Rechnung bleibt als Rueckfall stehen, solange ein Server ohne
     * `global_id` antworten kann.
     */
    _globaleFachnummer(amsId, trayId) {
        const einheit = ((this.lastState || {}).ams || {}).units
            || (this.lastState || {}).ams_units || [];
        for (const u of einheit) {
            if (u.id !== amsId) continue;
            for (const t of (u.trays || [])) {
                if (t.id === trayId && t.global_id != null) return t.global_id;
            }
        }
        return amsId >= 128 ? amsId + trayId : amsId * 4 + trayId;
    }

    /**
     * Ist dieses Fach gerade die Quelle?
     *
     * Der Drucker meldet die laufende Quelle als GLOBALE Nummer: 0-3 fuer
     * AMS 0, 4-7 fuer AMS 1, ab 128 die HT-Einheiten, 254/255 die externen
     * Spulen. Dieselbe Rechnung wie im Server (`_spulen_ids`), die gegen
     * print_filaments.ams_tray_id geprueft ist.
     */
    _istAktivesFach(amsId, trayId) {
        const st = this.lastState || {};
        const jetzt = parseInt((st.ams && st.ams.tray_current) || st.tray_current || '255', 10);
        const global = this._globaleFachnummer(amsId, trayId);
        if (jetzt === global) return true;
        // Solange NICHT gedruckt wird, gibt es nichts zu verdraengen: der
        // Drucker meldet dann meist 255 ("keine Quelle"), und die Sperre
        // haette die Zuordnung nie durchgelassen. Schuetzen muss sie nur den
        // laufenden Druck.
        const zustand = String((window.lastPrintData || {}).gcode_state || '').toUpperCase();
        return !['RUNNING', 'PREPARE', 'PAUSE'].includes(zustand);
    }

    /**
     * Feste Zuordnung Fach -> Spoolman-Rolle merken.
     *
     * Danach muss der Server nichts mehr ueber Profilnamen und Farben
     * erraten — bei zwei gleichen Rollen desselben Herstellers ging das
     * ohnehin nicht auf.
     */
    _merkeSpoolZuordnung(amsId, trayId, spoolId, typ, farbe, name) {
        // Typ, Farbe und Name gehen mit, damit der Server die Liegezeit auch
        // dann eroeffnen kann, wenn der Drucker das Fach leer meldet — die
        // Rolle liegt dann drin, ist aber nicht eingezogen. Aus dem Fach
        // waeren die drei Angaben in dem Fall nicht zu holen.
        window.apiCall('/api/filament/feuchte/zuordnung', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ams_id: amsId, slot: trayId, spool_id: spoolId,
                typ: typ || '', farbe: farbe || '', name: name || '',
            }),
        }).then(() => { if (window.amsFeuchte) window.amsFeuchte.vergiss(); })
          .catch(() => {});
    }

    /**
     * Feuchte-Gedaechtnis in einen offenen AMS-Dialog nachladen.
     *
     * Nachgeladen und nicht mitgebaut: der Dialog soll sofort stehen. Faellt
     * die Abfrage aus, bleibt der Platz einfach leer — der Dialog funktioniert
     * ohne die Vorgeschichte weiter.
     */
    _feuchteGedaechtnis(overlay, unit) {
        const ziel = overlay.querySelector('#dry-gedaechtnis');
        if (!ziel || !window.amsFeuchte) return;
        const texts = window.texts || {};
        const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        // Gleiche Umrechnung wie in den Fach-Kacheln: Bambu liefert den
        // Farbwert als achtstelliges Hex OHNE Raute.
        const farbe = (hex) => {
            const h = String(hex || '').replace('#', '');
            return h ? '#' + h.slice(0, 6) : 'transparent';
        };
        const uhrzeit = (roh) => {
            const d = new Date(String(roh).replace(' ', 'T'));
            return isNaN(d) ? '' : d.toLocaleString(undefined,
                { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        };

        window.amsFeuchte.hole(14).then(daten => {
            if (!daten || !overlay.isConnected) return;
            const e = window.amsFeuchte.einheit(daten, unit.id);
            const kurve = e ? window.amsFeuchte.kurve(e.verlauf, daten.schwelle) : '';
            const faecher = (unit.trays || []).filter(t => t.type).map(t => {
                const spule = window.amsFeuchte.fuerFach(daten, unit.id, t.id);
                if (!spule) return '';
                return '<div class="fk-fach">'
                     + '<span class="mz-slot-col" style="background:'
                     + farbe(t.color) + '"></span>'
                     + '<span class="fk-fach-name">' + esc(t.type || '?') + '</span>'
                     + window.amsFeuchte.merkzeile(spule, daten.schwelle)
                     + '</div>';
            }).join('');
            const zeit = window.amsFeuchte.spanne(e && e.verlauf);
            // Weniger als eine halbe Stunde Messreihe ist keine Vorgeschichte,
            // sondern eine gerade Linie. Dann lieber ehrlich sagen, dass die
            // Aufzeichnung gerade erst laeuft, als eine Kurve vortaeuschen.
            const frisch = !kurve || zeit.ms < 1800000;
            if (frisch && !faecher) {
                if (!(e && e.verlauf && e.verlauf.length)) return;
                ziel.innerHTML =
                    '<div class="fk-kopf">' + esc(texts.feuchte_titel || 'Feuchte')
                    + '<span class="fk-schwelle-text">' + esc(
                        (texts.feuchte_schwelle || 'Grenze {s} %').replace('{s}', daten.schwelle))
                    + '</span></div>'
                    + '<div class="fk-frisch">' + esc(
                        (texts.feuchte_frisch || 'Aufzeichnung läuft seit {zeit}')
                            .replace('{zeit}', uhrzeit(e.verlauf[0].zeit))) + '</div>';
                return;
            }
            ziel.innerHTML =
                '<div class="fk-kopf">' + esc(texts.feuchte_titel || 'Feuchte')
                + (zeit.text ? '<span class="fk-spanne">' + esc(zeit.text) + '</span>' : '')
                + '<span class="fk-schwelle-text">' + esc(
                    (texts.feuchte_schwelle || 'Grenze {s} %').replace('{s}', daten.schwelle))
                + '</span></div>' + kurve + faecher;
        }).catch(() => {});
    }

    /**
     * Die Kalibrierschritte als Haekchen — dieselben wie in Studios Dialog.
     *
     * EIN Befehl mit einer Bitmaske (DeviceManager.cpp,
     * command_start_calibration), nicht ein Befehl je Schritt. Die Bits
     * kennt der Server; hier gehen nur die Namen raus.
     */
    zeichneKalibrierung(caps) {
        const texts = window.texts || {};
        const ziel = document.getElementById('cali-schritte');
        if (!ziel) return;
        const c = caps || {};
        // Reihenfolge und Vorauswahl wie in Studio.
        const schritte = [
            ['bed_leveling', texts.cali_bed_leveling || 'Auto Bed Leveling', true, true],
            ['vibration', texts.cali_vibration || 'Vibrationskompensation', true, true],
            ['motor_noise', texts.cali_motor_noise || 'Motorgeräusch-Unterdrückung', true, true],
            ['nozzle', texts.cali_nozzle || 'Düsenversatz', true, !!c.dual_nozzle],
            ['bed_high', texts.cali_bed_high || 'Nivellierung bei hoher Betttemperatur', false, true],
        ];
        const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g,
            ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        ziel.innerHTML = schritte.filter(s => s[3]).map(([name, label, an]) =>
            `<label class="cali-schritt">
                <input type="checkbox" class="cali-box" value="${name}"${an ? ' checked' : ''}>
                <span>${esc(label)}</span>
            </label>`).join('');
        const knopf = document.getElementById('cali-start');
        if (knopf) knopf.textContent = texts.cali_start || 'Kalibrierung starten';
        const titel = document.getElementById('dev-cali-title');
        if (titel) titel.textContent = texts.cali_schritte_titel || 'Schritte';
        const reiter = document.getElementById('ctrl-tab-cali-label');
        if (reiter) reiter.textContent = texts.cali_title || 'Kalibrierung';
        const hinweis = document.getElementById('cali-hinweis');
        if (hinweis) hinweis.textContent = texts.cali_hinweis
            || 'Dauert je nach Auswahl mehrere Minuten. Währenddessen ist kein Druck möglich.';
        this.zeichneKalibrierLaeufe(c);
    }

    /**
     * Die Kalibrierungen, die als eigener Firmware-Gcode laufen.
     *
     * Nicht Teil der Bitmaske: der Drucker fuehrt je eine Gcode-Datei aus
     * und meldet sie wie einen Druck (Stufen, Fortschritt, FINISH). Welche
     * Datei, weiss der Server (services/kalibrier_laeufe.py) — hier gehen
     * nur die Namen raus.
     */
    zeichneKalibrierLaeufe(caps) {
        const texts = window.texts || {};
        const ziel = document.getElementById('cali-laeufe');
        if (!ziel) return;
        const c = caps || {};
        const titel = document.getElementById('cali-laeufe-titel');
        if (titel) titel.textContent = texts.cali_laeufe_titel || 'Einzelne Läufe';
        const hinweis = document.getElementById('cali-lauf-hinweis');
        if (hinweis) hinweis.textContent = texts.cali_lauf_hinweis || '';

        // Ein Versatz zwischen zwei Duesen ist bei einer Duese kein Thema.
        const laeufe = [
            ['nozzle_offset_precise', texts.cali_lauf_nozzle_offset_precise
                || 'Hochpräziser Düsenversatz', !!c.dual_nozzle],
            ['motion_precision', texts.cali_lauf_motion_precision
                || 'Bewegungsgenauigkeit (Vision Encoder)', true],
        ];
        const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g,
            ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        ziel.innerHTML = laeufe.filter(l => l[2]).map(([name, label]) =>
            `<button type="button" class="jog-abtn cali-lauf-btn" data-lauf="${name}">` +
            `${esc(label)}</button>`).join('');
        ziel.querySelectorAll('.cali-lauf-btn').forEach(b =>
            b.addEventListener('click', () => this.startCalibrationRun(b.dataset.lauf)));
    }

    /** Einen einzelnen Lauf starten — mit Rueckfrage, der Kopf faehrt. */
    startCalibrationRun(name) {
        const texts = window.texts || {};
        if (!name) return;
        const frage = texts.cali_lauf_confirm || texts.cali_confirm
            || 'Diesen Lauf jetzt starten? Der Drucker fährt dabei und heizt.';
        const los = () => {
            window.printerAdapter.action('start_calibration_run', { name })
                .then(r => {
                    if (r.ok) {
                        skToast(texts.cali_gestartet || 'Kalibrierung gestartet', 'info');
                        setTimeout(() => this.zeichneKalibrierLauf(), 1500);
                    } else {
                        // Der Server nennt den Grund als Schluessel — etwa
                        // guard_braucht_pla, wenn kein PLA geladen ist.
                        skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                    }
                })
                .catch(() => skToast(texts.connection_error, 'error'));
        };
        if (window.showConfirmDialog) window.showConfirmDialog(frage, los);
        else if (window.skConfirm) window.skConfirm(frage).then(ja => { if (ja) los(); });
    }

    /**
     * Der laufende Durchgang: Stufe, Fortschritt, Restzeit.
     *
     * Eine Kalibrierung meldet sich wie ein Druck — RUNNING, Stufenwechsel,
     * am Ende FINISH. `systemlauf.py` haelt sie aus der Historie heraus,
     * angezeigt werden darf sie trotzdem, und hier gehoert sie hin.
     */
    zeichneKalibrierLauf() {
        const texts = window.texts || {};
        const ziel = document.getElementById('cali-lauf');
        if (!ziel) return;
        const titel = document.getElementById('cali-lauf-titel');
        if (titel) titel.textContent = texts.cali_lauf_titel || 'Ablauf';

        // Zwei Quellen, dieselben Feldnamen: der Socket (`lastPrintData`)
        // taktet waehrend eines Drucks schneller, /api/status (`lastState`)
        // laeuft dagegen IMMER — auch bei einem drucker-eigenen Job, denn
        // fuer den bleibt der halbe Meldeweg bewusst aus
        // (printer_progress_mixin_v2: kein Push, kein FCM). Deshalb gewinnt
        // hier der Status, wo er etwas zu sagen hat.
        const pd = Object.assign({}, window.lastPrintData || {}, this.lastState || {});
        const zustand = String(pd.gcode_state || '').toUpperCase();
        const laeuft = ['RUNNING', 'PREPARE'].includes(zustand);
        // Nur ein SYSTEMlauf ist eine Kalibrierung; ein echter Druck nicht.
        const system = pd.is_system_run === true
            || String(pd.print_type || '').toLowerCase() === 'system';

        // Startknopf sperren, solange der Drucker faehrt — egal ob eine
        // Kalibrierung oder ein echter Druck. Genau dieselben drei Zustaende
        // weist der Server ab (action_guards `_KALIBRIEREN`); ein Knopf, der
        // nur eine Fehlermeldung erzeugt, gehoert nicht angeboten. Die
        // Haken bleiben bedienbar: die Auswahl fuer den naechsten Durchgang
        // darf man waehrenddessen schon vorbereiten.
        const gesperrt = ['RUNNING', 'PREPARE', 'PAUSE'].includes(zustand);
        document.querySelectorAll('.cali-lauf-btn').forEach(b => { b.disabled = gesperrt; });
        const knopf = document.getElementById('cali-start');
        if (knopf) {
            knopf.disabled = gesperrt;
            knopf.textContent = gesperrt && system
                ? (texts.cali_laeuft || 'Kalibrierung läuft')
                : (texts.cali_start || 'Kalibrierung starten');
        }

        if (!laeuft || !system) {
            ziel.innerHTML = `<div class="ext-sub">${
                (texts.cali_kein_lauf || 'Gerade läuft keine Kalibrierung.')}</div>`;
            return;
        }
        const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g,
            ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        const anteil = Math.max(0, Math.min(100, Math.round(pd.progress || 0)));
        const rest = pd.remaining_time > 0
            ? (texts.cali_rest || 'noch {n} min').replace('{n}', Math.round(pd.remaining_time))
            : '';
        // Welcher Schritt gerade laeuft — drei Quellen, in dieser Folge:
        //
        //   stage_description  Bambu. Der Server uebersetzt die Stufennummer
        //                      (stg_cur) schon selbst, ui_handler legt sie in
        //                      die Druckdaten. NUR die kennt "Auto Bed
        //                      Leveling" oder "Duesen-Offset kalibrieren".
        //   stage_code         Klipper. Dort gibt es keine Stufennummern,
        //                      sondern Schluessel, die der Klient uebersetzt.
        //   status_text        Rueckfall. Sagt bloss "Vorbereitung" — das
        //                      stand bis 28aug26 hier waehrend der ganzen
        //                      Kalibrierung, weil stage_code auf Bambu leer
        //                      ist und die erste Quelle fehlte.
        const sm = window.socketManager;
        const stufe = (pd.stage_description || '').trim()
            || (sm && typeof sm.stageLabel === 'function' ? sm.stageLabel(pd) : '')
            || (sm && typeof sm.translateStatusKey === 'function'
                ? sm.translateStatusKey(pd.status_text) : '')
            || pd.status_text || '';
        ziel.innerHTML =
            `<div class="cali-stufe">${esc(stufe)}</div>` +
            `<div class="cali-balken"><span style="width:${anteil}%"></span></div>` +
            `<div class="cali-zahlen"><span>${anteil} %</span><span>${esc(rest)}</span></div>`;
    }

    /** Auswahl einsammeln, nachfragen, losschicken. */
    startCalibration() {
        const texts = window.texts || {};
        const gewaehlt = Array.from(document.querySelectorAll('.cali-box:checked'))
            .map(b => b.value);
        if (!gewaehlt.length) {
            skToast(texts.cali_keine_wahl || 'Kein Schritt gewählt', 'warning');
            return;
        }
        // Der Kopf faehrt und das Bett heizt — das fragt man vorher.
        const frage = texts.cali_confirm
            || 'Kalibrierung jetzt starten? Der Drucker fährt dabei und heizt.';
        const los = () => {
            window.printerAdapter.action('start_calibration', { schritte: gewaehlt })
                .then(r => {
                    if (r.ok) {
                        skToast(texts.cali_gestartet || 'Kalibrierung gestartet', 'info');
                        setTimeout(() => this.zeichneKalibrierLauf(), 1500);
                    }
                    else skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                })
                .catch(() => skToast(texts.connection_error, 'error'));
        };
        if (window.showConfirmDialog) window.showConfirmDialog(frage, los);
        else if (window.skConfirm) window.skConfirm(frage).then(ja => { if (ja) los(); });
    }

    amsDryStop(amsId) {
        const texts = window.texts || {};
        window.printerAdapter.amsDryStop(amsId).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
            else if (window.amsFeuchte) window.amsFeuchte.vergiss();
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    amsReadRfid(amsId, slotId) {
        const texts = window.texts || {};
        window.printerAdapter.amsReadRfid(amsId, slotId).then(r => {
            if (r.ok) skToast(texts.ams_rfid_sent || 'RFID wird gelesen', 'info');
            else skToast(this.fehlerText(r.error, texts.connection_error), 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    // ========================================
    // openSettings — navigate to settings page
    // ========================================
    openSettings() {
        // Navigate to new settings page
        window.location.href = '/static/settings.html';
    }

    // ========================================
    // openPrinterControl — show control modal
    // ========================================
    openPrinterControl(tab) {
        const modal = document.getElementById('printerControlModal');
        modal.style.display = 'block';

        // Sofort frischen Status ziehen statt auf den 8s-Takt zu warten —
        // sonst oeffnet sich der Geraet-Tab oft halb leer (Panels haengen
        // an capabilities + device_report) und man musste neu oeffnen.
        window.apiCall('/api/status')
            .then(r => r.json())
            .then(d => this.applyStatusPayload(d))
            .catch(() => {});

        // Wunsch-Tab direkt anspringen (z.B. Bewegung-Karte -> Achsen).
        // Ohne Angabe: Bambu startet auf der Uebersicht, Klipper auf Bewegung.
        if (tab) {
            this.switchControlTab(tab);
            this.updateOverviewTab();
        } else if (document.body.dataset.activePrinter !== 'klipper') {
            this.switchControlTab('ctrlov');
            this.updateOverviewTab();
        }

        // iOS App Fullscreen - wenn wir IDs haben
        if (window.isIOSApp || window.isSafari) {
            const modalContent = document.getElementById('printerControlModalContent');
            if (modalContent) {
                modalContent.style.position = 'fixed';
                modalContent.style.width = '100vw';
                modalContent.style.height = '100vh';
                modalContent.style.maxWidth = 'none';
                modalContent.style.maxHeight = 'none';
                modalContent.style.top = '0';
                modalContent.style.left = '0';
                modalContent.style.transform = 'none';
                modalContent.style.borderRadius = '0';
            }
        }

        // Homing-Check entfernt - X/Y Homing passiert automatisch im Backend bei Filament load/unload
        this.modalHomingDone = true;
        this.enableAllControlButtons();

        // Kamera Source Setup
        const savedSource = localStorage.getItem('controlCameraSource') || 'p1s';
        this.currentControlCameraSource = savedSource;

        // Kamera-Quelle setzen — Klipper nutzt die schon im Hauptbild
        // gecachten Klipper-Cams (Proxy-URL), Bambu/uStreamer wie bisher.
        const img = document.getElementById('control-camera');
        const sourceBtn = document.getElementById('control-camera-source');
        if (img) {
            // Vorschau laut Kontrakt: camera-manager entscheidet
            // (WebRTC-Zweitsenke, 1-fps-Snapshots oder Klipper-Cam).
            if (window.cameraManager && window.cameraManager.attachControlPreview) {
                window.cameraManager.attachControlPreview();
                if (sourceBtn && window.isKlipperMode && window.isKlipperMode()) {
                    const s = ((window.cameraManager._klipperSources || [])[window.cameraManager._klipperSourceIdx || 0]) || {};
                    sourceBtn.innerHTML = window.skIcon('kamera', 'hd-ic--xs') + ' <span></span>';
            sourceBtn.querySelector('span').textContent = s.label || s.id || '';
                }
            }
        }

        // Kamera Refresh Interval + Live-Temperatur-Refresh (Klipper-State
        // landet alle ~2s im window.activePrinter.state, wir lesen von dort)
        if (this.controlCameraInterval) {
            clearInterval(this.controlCameraInterval);
        }

        const self = this;
        this.controlCameraInterval = setInterval(function() {
            // Klipper-Cam ist ein Dauerstream, Bambu-Vorschau pollt selbst —
            // der alte modus-blinde 2s-Refresh hielt die MJPEG-Pipeline wach.
            if (window.isKlipperMode && window.isKlipperMode()) {
                self.updateExtruderTemp();
            }
        }, 2000);

        // Klipper-Direct: die drei Tabs mit der Mainsail-Steuerung füllen
        // (Achsen/Extruder/Maschine — Parität zur Android-App). Bambu bleibt
        // beim bestehenden D-Pad-Layout aus dem HTML.
        if (window.isKlipperMode && window.isKlipperMode()) {
            this.buildKlipperControl();
            this.startKlipperPoll();
            this.loadKlipperMacros();
        }
    }

    // ========================================
    // disableAllControlButtons
    // ========================================
    disableAllControlButtons() {
        // All control buttons in the modal
        document.querySelectorAll('.ctrl-move-btn, .ctrl-quick-btn, .ctrl-extrude-btn, .ctrl-filament-btn, .ctrl-preset-btn, .ctrl-custom-temp-set').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });
    }

    // ========================================
    // enableAllControlButtons
    // ========================================
    enableAllControlButtons() {
        document.querySelectorAll('.ctrl-move-btn, .ctrl-quick-btn, .ctrl-extrude-btn, .ctrl-filament-btn, .ctrl-preset-btn, .ctrl-custom-temp-set').forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor = '';
        });
    }

    // ========================================
    // removeHomingWarnings
    // ========================================
    removeHomingWarnings() {
        document.querySelectorAll('.homing-warning').forEach(warning => {
            warning.style.animation = 'fadeOut 0.5s';
            setTimeout(() => warning.remove(), 500);
        });
    }

    // ========================================
    // showHomingRequiredWarning
    // ========================================
    showHomingRequiredWarning() {
        const texts = window.texts || {};
        // Warnung in alle Tabs einfügen
        const tabs = ['movement-tab', 'extruder-tab', 'filament-tab'];
        tabs.forEach(tabId => {
            const tab = document.getElementById(tabId);
            if (tab) {
                // Entferne alte Warnung falls vorhanden
                const oldWarning = tab.querySelector('.homing-warning');
                if (oldWarning) oldWarning.remove();

                // Neue kompakte Warnung mit zwei Buttons
                const warning = document.createElement('div');
                warning.className = 'homing-warning';
                warning.style.cssText = `
                    background: rgba(255,152,0,0.08);
                    border: 1px solid rgba(255,152,0,0.3);
                    border-radius: 6px;
                    padding: 10px 12px;
                    margin-bottom: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                `;

                warning.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: var(--accent-orange); display:flex;">${window.skIcon('warnung')}</span>
                        <span style="color: var(--text-secondary); font-size: 13px;">
                            ${texts.homing_required_hint || 'Homing erforderlich für Achsenbewegungen'}
                        </span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="skip-homing-btn" onclick="skipHoming()" style="
                            background: var(--bg-secondary);
                            color: var(--text-secondary);
                            border: 1px solid var(--border-color);
                            padding: 6px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                            white-space: nowrap;
                        ">${window.skIcon('weiter', 'hd-ic--xs')} ${texts.homing_skip || 'Überspringen'}</button>
                        <button class="do-homing-btn" onclick="doManualHoming()" style="
                            background: var(--accent-orange);
                            color: white;
                            border: none;
                            padding: 6px 16px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: 500;
                            font-size: 12px;
                            white-space: nowrap;
                        ">${window.skIcon('haus', 'hd-ic--xs')} ${texts.homing_start || 'Homing starten'}</button>
                    </div>
                `;

                tab.insertBefore(warning, tab.firstChild);
            }
        });

        // Buttons deaktivieren
        this.disableAllControlButtons();
    }

    // ========================================
    // skipHoming
    // ========================================
    skipHoming() {
        const texts = window.texts || {};
        // Bis 21aug26 hing hier ein zweiter Zweig fuer `window.isIOSApp`, der
        // eine eigene Meldung unten in der Mitte zeichnete. Das Flag setzt
        // niemand — und Meldungen laufen ohnehin ueber skToast.
        showConfirmDialog(texts.confirm_skip_homing_warning, () => {
            this.modalHomingDone = true;
            this.enableAllControlButtons();
            this.removeHomingWarnings();
            skToast(texts.toast_homing_skipped_risk, 'warning');
        });
    }

    // ========================================
    // closePrinterControl
    // ========================================
    closePrinterControl() {
        document.getElementById('printerControlModal').style.display = 'none';

        // Modal-Vorschau beenden (Snapshot-Polling stoppen / Zweitsenke loesen)
        if (window.cameraManager && window.cameraManager.detachControlPreview) {
            window.cameraManager.detachControlPreview();
        }
        // Stoppe Kamera-Refresh
        if (this.controlCameraInterval) {
            clearInterval(this.controlCameraInterval);
            this.controlCameraInterval = null;
        }
        if (this.klipperPollInterval) {
            clearInterval(this.klipperPollInterval);
            this.klipperPollInterval = null;
        }
    }

    // DEPRECATED: Homing-Check komplett entfernt
    // X/Y Homing passiert jetzt automatisch im Backend bei Filament load/unload (G28 X Y)
    // Die Funktionen checkHomingStatus(), performControlHoming() und skipControlHoming() wurden entfernt.

    // ========================================
    // updateOverviewTab — Karten der Display-Uebersicht fuellen
    // ========================================
    updateOverviewTab() {
        const texts = window.texts || {};
        const st = this.lastState || {};
        const pd = window.lastPrintData || {};
        // Zwei Auspraegungen derselben Karten: 'ov-*' im Steuerungs-Fenster,
        // 'mz-*' in der Drucker-Zone der Hauptseite.
        const set = (id, v) => ['ov', 'mz'].forEach(p => {
            const e = document.getElementById(id.replace(/^ov/, p));
            if (e) e.textContent = v;
        });
        const grad = (ist, soll) => {
            if (ist == null) return '--';
            let t = Math.round(ist) + '°';
            if (soll != null && soll > 0) t += ' / ' + Math.round(soll) + '°';
            return t;
        };

        // Beschriftungen (set schreibt ov-* UND mz-*)
        set('ctrl-tab-overview-label', texts.ov_tab || 'Übersicht');
        const direkt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        direkt('mz-title', texts.mz_printer_zone || 'Drucker');
        direkt('mz-mat-title', texts.mz_material_zone || 'Material');
        direkt('mz-sys-power-label', texts.printer || 'Drucker');
        direkt('mz-sys-light-label', texts.light || 'Licht');
        direkt('mz-sys-charts-label', texts.charts || 'Verlauf');
        direkt('mz-sys-sd-label', texts.sd_card || 'SD');
        direkt('mz-sys-sched-label', texts.scheduled_prints_short || texts.scheduled_prints || 'Geplant');
        direkt('mz-sys-control-label', texts.printer_control || 'Steuerung');
        set('ov-air-label', texts.ov_air || 'Luftmanagement');
        set('ov-speed-label', texts.ov_speed || 'Geschwindigkeit');
        set('ov-move-label', texts.ov_move || 'Bewegung');
        set('ov-nozzle-label', texts.ov_nozzle || 'Düse & Extruder');
        set('ov-chamber-label', texts.temp_chamber || 'Kammer');
        set('ov-bed-label', texts.ov_bed || 'Heizbett');
        set('ov-light-label', texts.light || 'Licht');

        // Luftfuehrung: 0 kuehlen, 1 heizen — wie am Display benannt
        const mode = st.airduct_mode;
        set('ov-air-value', mode === 1
            ? (texts.airduct_heating || 'Heizen')
            : (texts.ov_air_cooling || 'Starke Kühlung'));

        const sp = st.speed || {};
        const speedName = (
            (sp && sp.speed_level_text)
            || (pd && pd.speed_level_text)
            || 'Standard'
        );
        const speedPercent = Number(
            (sp && sp.speed_percent != null) ? sp.speed_percent
                : ((pd && pd.speed_percent != null) ? pd.speed_percent : 100)
        );
        set('ov-speed-value', `${speedName} (${Number.isFinite(speedPercent) ? speedPercent : 100}%)`);

        const temps = st.nozzle_temps || {};
        const ziele = st.nozzle_targets || {};
        const holen = (o, k) => (o[k] != null ? o[k] : o[String(k)]);
        if (holen(temps, 0) != null || holen(temps, 1) != null) {
            set('ov-nozzle-l', 'L ' + grad(holen(temps, 1), holen(ziele, 1)));
            set('ov-nozzle-r', 'R ' + grad(holen(temps, 0), holen(ziele, 0)));
        } else {
            set('ov-nozzle-l', grad(pd.nozzle_temp, pd.nozzle_target));
            set('ov-nozzle-r', '');
        }

        set('ov-chamber-value', grad(st.chamber_temp != null ? st.chamber_temp : pd.chamber_temp,
                                     st.chamber_target != null ? st.chamber_target : pd.chamber_target));
        // Bett aus dem Status-Zustand — lastPrintData fuellt nur Klipper.
        set('ov-bed-value', grad(st.bed_temp != null ? st.bed_temp : pd.bed_temp,
                                 st.bed_target != null ? st.bed_target : pd.bed_target));

        // Die Lichtknoepfe (Uebersicht + Kamerabild) setzt der Adapter aus dem
        // printer_state-Ereignis — /api/status fuehrt kein light_on.
    }

    // ========================================
    // renderMaterialZone — AMS/HT + externe Spulen auf der Hauptseite
    // ========================================
    renderMaterialZone() {
        const wrap = document.getElementById('mz-ams-list');
        if (!wrap) return;
        const texts = window.texts || {};
        const st = this.lastState || {};
        const rep = st.device_report || {};

        const farbe = (hex) => {
            const h = String(hex || '').replace('#', '');
            return h ? '#' + h.slice(0, 6) : 'transparent';
        };
        // K-Wert (Pressure Advance) des geladenen Filaments. Der Drucker
        // meldet ihn je Fach; er gehoert zum Filament, nicht zum Geraet —
        // deshalb steht er am aktiven Fach und nirgends sonst.
        // From `hardware`, no longer from `filament`: that block has been
        // gone since 30aug26. It mirrored Bambu's `vt_tray`, and the X2D
        // never sends that — so it only ever delivered default values,
        // among them k_factor = 0. Because 0 is not null, the fallback
        // to here never took effect anyway.
        const kRoh = st.hardware && st.hardware.k_factor;
        const kZahl = parseFloat(kRoh);
        const kWert = (isFinite(kZahl) && kZahl > 0) ? kZahl.toFixed(3) : '';

        const slot = (t, aktiv, onclick, seite) => {
            const rest = (t.remain != null && t.remain > 0) ? t.remain + '%' : '';
            const name = [seite, t.type || '?', t.name].filter(Boolean).join(' · ');
            const k = (aktiv && kWert)
                ? '<span class="mz-slot-k" title="' + (texts.k_factor_hint || 'Pressure Advance') + '">K ' + kWert + '</span>'
                : '';
            return '<div class="mz-slot' + (aktiv ? ' mz-active-slot' : '') + '"' +
                (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
                '<span class="mz-slot-col" style="background:' + farbe(t.color) + '"></span>' +
                '<span class="mz-slot-name">' + name + '</span>' + k +
                '<span class="mz-slot-pct">' + rest + '</span></div>';
        };

        // AMS-Einheiten (inkl. AMS HT). Aktives Fach: globale Tray-Nummer.
        const units = st.ams_units || [];
        const aktivTray = parseInt((st.ams && st.ams.tray_current) || st.tray_current || '255', 10);
        // Modellname in die Kartenueberschrift. Bei GENAU einer Einheit ist
        // "AMS HT" dort besser aufgehoben als am Anfang jeder Kopfzeile —
        // es wiederholt sich nicht und macht in der Zeile Platz, den die
        // Trocknungsangaben brauchen. Mehrere Einheiten behalten ihren
        // Namen in der Zeile, sonst waere nicht klar, welche gemeint ist.
        const matTitel = document.getElementById('mz-mat-title');
        const einzeln = units.length === 1 && units[0].model;
        if (matTitel) {
            if (!matTitel.dataset.standard) matTitel.dataset.standard = matTitel.textContent;
            // "Material (AMS HT)" — der Modellname ERGAENZT die Ueberschrift,
            // er ersetzt sie nicht. Sonst weiss man beim Ueberfliegen nicht
            // mehr, dass das die Materialkarte ist.
            matTitel.textContent = einzeln
                ? matTitel.dataset.standard + ' (' + units[0].model + ')'
                : matTitel.dataset.standard;
        }

        let html = '';
        units.forEach(u => {
            const kopf = einzeln ? [] : [u.model || 'AMS'];
            const trocknetJetzt = u.can_dry && (u.dry_time || 0) > 0;
            // Zwei Messspalten wie am AMS-Display selbst: oben Zeichen und
            // Kuerzel, darunter der Wert.
            //
            //     💧 RH        🌡 Temp
            //     19 %         81 °C
            //
            // Vorher stand alles in einer Zeile ("21% Feuchte · 81°"); das
            // Wort klemmte zwischen zwei Zahlen und klebte an der falschen —
            // gelesen wurde "Feuchte 81" (27aug26).
            const mess = (zeichen, kuerzel, wert) =>
                '<div class="mz-mess"><div class="mz-mess-kopf">'
                + window.skIcon(zeichen, 'hd-ic--xs') + ' ' + kuerzel
                + '</div><div class="mz-mess-wert">' + wert + '</div></div>';
            if (u.humidity != null) {
                kopf.push(mess('wasser', 'RH', u.humidity + ' %'));
            }
            if (u.temperature != null) {
                // Waehrend der Trocknung Ist/Soll wie ueberall sonst in der
                // App (Duese 140°/140°, Bett 110°/110°). Erst im Vergleich
                // sieht man, ob das Programm sein Ziel erreicht hat — als
                // eigene Zeile war die Zahl nur Ballast.
                const ist = Math.round(u.temperature);
                kopf.push(mess('thermo', texts.mz_temp || 'Temp',
                    (trocknetJetzt && u.dry_temp)
                        ? ist + ' / ' + u.dry_temp + ' °C'
                        : ist + ' °C'));
            }
            // Laeuft eine Trocknung (dry_time = Restminuten), zeigt die Zone
            // Programm + Restzeit und einen Stopp-Knopf statt Trocknen.
            //
            // Die Trocknung steht in einer EIGENEN Zeile unter dem Kopf. In
            // einer gemeinsamen Zeile stiessen zwei Gradzahlen aneinander —
            // "AMS HT · 32% Feuchte · 68°" und daneben "Trocknet ASA 80° ·
            // 7:58 h". Beim Umbrechen las sich das wie "Feuchte 68" (27aug26).
            const trocknet = u.can_dry && (u.dry_time || 0) > 0;
            let trockenZeile = '';
            let restZeile = '';
            if (trocknet) {
                const rest = Math.floor(u.dry_time / 60) + ':' + String(u.dry_time % 60).padStart(2, '0');
                // Programm und Ziel in die eine Zeile, die Restzeit in eine
                // eigene darunter — sonst schob der Stopp-Knopf sich in eine
                // Zeile fuer sich und liess eine halbe Karte leer stehen.
                // Kein Filamentname: der steht schon im Fach darunter. Kein
                // Ziel: das steht jetzt als Soll-Wert neben dem Ist-Wert.
                // Uebrig bleibt, was sonst nirgends steht — dass getrocknet
                // wird und wie lange noch.
                trockenZeile = (texts.ams_drying || 'Trocknet') +
                    ' · ' + (texts.mz_remaining || 'noch') + ' ' + rest + ' h';
                restZeile = '';
            }
            const dryBtn = !u.can_dry ? '' : (trocknet
                ? '<button class="mz-dry-btn" onclick="amsDryStop(' + u.id + ')">'
                  + '<svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> '
                  + (texts.ams_dry_stop || 'Stopp') + '</button>'
                : '<button class="mz-dry-btn" onclick="amsDryStart(' + u.id + ')">'
                  + '<svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4.5 4.5 0 1 0 4 0z"/></svg> '
                  + (texts.mz_dry || 'Trocknen') + '</button>');
            // Trocknet die Einheit, wandert der Stopp-Knopf mit in die
            // Trocknungszeile — er gehoert zu ihr, nicht zum Kopf.
            // Kein freistehendes Thermometer mehr: seit jede Zahl ihre
            // Beschriftung traegt, erklaert das Zeichen nichts und stand
            // nur im Weg.
            // Die Messspalten haben ihren eigenen Abstand — kein Mittelpunkt
            // dazwischen. Nur wenn der Modellname vorn steht (mehrere
            // Einheiten), bleibt er per Mittelpunkt abgesetzt.
            const kopfHtml = einzeln
                ? kopf.join('')
                : kopf[0] + ' · ' + kopf.slice(1).join('');
            // Knopf in einer eigenen Spalte rechts, ueber BEIDE Textzeilen
            // mittig. Lag er in der Trocknungszeile, klebte er an deren
            // Grundlinie und wirkte verrutscht.
            html += '<div class="mz-unit"><div class="mz-unit-top">' +
                '<div class="mz-unit-links">' +
                '<div class="mz-unit-head">' + kopfHtml + '</div>' +
                (trocknet ? '<div class="mz-unit-dry">' + trockenZeile + '</div>' : '') +
                '</div>' + dryBtn + '</div>';
            (u.trays || []).forEach(t => {
                // Globale Quellennummer — kommt vom Server (`global_id`),
                // siehe _globaleFachnummer.
                const global = t.global_id != null ? t.global_id
                    : (u.id >= 128 ? u.id + (t.id || 0) : u.id * 4 + (t.id || 0));
                const aktiv = aktivTray === global;
                html += slot(t, aktiv, "amsEditTray(" + u.id + "," + (t.id || 0) + ")", null);
            });
            html += '</div>';
        });
        wrap.innerHTML = html;

        // Externe Spulen: 254 links, 255 rechts. Aktiv = Quelle einer Duese.
        const spools = rep.spools || [];
        const quellen = (rep.extruders || []).map(e => e && e.source).filter(v => v != null);
        const zeile = document.getElementById('mz-spools');
        const titel = document.getElementById('mz-spools-title');
        // Name + Fuellstand der AKTIVEN Spule kommen aus Spoolman — der
        // Drucker kennt bei Fremdspulen weder Name noch Restmenge.
        const smName = (document.getElementById('spool-name') || {}).textContent || '';
        const smPct = ((document.getElementById('spool-percent') || {}).textContent || '').trim();
        if (zeile) {
            zeile.innerHTML = spools.map(sp => {
                const id = parseInt(sp.id, 10);
                const seite = id === 254 ? 'L' : 'R';
                // Ring nur, wenn die Spule als Quelle eingestellt UND bestueckt
                // ist. Der Drucker behaelt die Quelle vom letzten Druck bei —
                // sonst trug die leere linke Spule den Ring, waehrend die
                // volle rechte inaktiv aussah.
                const aktiv = quellen.includes(id) && !sp.empty;
                // Klick = Filament-Editor, wie bei den AMS-Faechern.
                return slot({ type: sp.type, color: (sp.cols && sp.cols[0]) || sp.color,
                              name: aktiv ? smName : sp.name,
                              remain: (aktiv && smPct) ? parseInt(smPct, 10) : sp.remain },
                            aktiv, 'amsEditTray(' + id + ',0)', seite);
            }).join('');
            if (titel) {
                titel.style.display = spools.length ? '' : 'none';
                titel.textContent = texts.dev_spools || 'Externe Spulen';
            }
        }

        // Systemleiste: Licht/MQTT-Zustand als Ring/Farbe
        const licht = document.getElementById('mz-sys-light');
        if (licht) licht.classList.toggle('mz-on', st.light === 'on' || st.light_on === true);
        const mqtt = document.getElementById('mz-sys-mqtt');
        if (mqtt) mqtt.classList.toggle('mz-ok', st.mqtt === true || st.mqtt === 'connected');
        const power = document.getElementById('mz-sys-power');
        if (power) {
            // No socket, no power lamp. `st.switch !== 'on'` used to be true
            // for null as well, so a setup without a socket showed the lamp
            // permanently on "off" -- a statement nobody could make.
            if (st.power_mode === 'none') {
                power.style.display = 'none';
            } else {
                power.style.display = '';
                power.classList.toggle('mz-pwr-on', st.switch === 'on');
                power.classList.toggle('mz-pwr-off', st.switch !== 'on');
            }
        }
    }

    // ========================================
    // switchControlTab
    // ========================================
    switchControlTab(tab) {
        // Hide all tabs
        document.querySelectorAll('.control-tab-content').forEach(content => {
            content.style.display = 'none';
        });

        // Remove active class from all tabs
        document.querySelectorAll('.ctrl-tab').forEach(btn => {
            btn.classList.remove('active');
        });

        // Show selected tab
        document.getElementById(tab + '-tab').style.display = 'block';

        // Mark tab as active
        const activeTab = document.querySelector(`.ctrl-tab[data-tab="${tab}"]`);
        if (activeTab) activeTab.classList.add('active');

        // Frisch angezeigte Tabs sofort aus lastState fuellen — die Renderer
        // brechen bei unsichtbaren Tabs ab (offsetParent-Guard), ohne diesen
        // Aufruf kaeme der Inhalt erst mit dem naechsten 8s-Status-Takt.
        if (tab === 'device') this.refreshDeviceFans();
        if (tab === 'cali') {
            this.zeichneKalibrierung((this.lastState || {}).capabilities);
            this.zeichneKalibrierLauf();
        }
        if (tab === 'filament') this.renderFilamentSlots();
        if (tab === 'extruder') this.updateExtruderTab();
        if (tab === 'ctrlov') this.updateOverviewTab();
    }

    // ========================================
    // jogAxis — Rad/Spalte mit festen Schritten (Display-Stil)
    // ========================================
    jogAxis(axis, distance) {
        const texts = window.texts || {};
        const zustand = (window.lastPrintData || {}).gcode_state;
        if (zustand === 'RUNNING' || zustand === 'PREPARE') {
            skToast(texts.toast_no_move_printing || 'Während des Drucks nicht verfahrbar', 'warning');
            return;
        }
        if (!this.modalHomingDone) {
            skToast(texts.toast_wait_homing, 'warning');
            return;
        }
        window.printerAdapter.move(axis, distance).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.toast_movement_failed || texts.connection_error), 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    // ========================================
    // Extruder-Tab: Seitenwahl + Anzeige
    // ========================================
    extSelectSide(seite) {
        this._extSide = seite;
        const l = document.getElementById('ext-seg-l');
        const r = document.getElementById('ext-seg-r');
        const texts = window.texts || {};
        if (l) { l.classList.toggle('ext-seg-btn--on', seite === 1);
                 l.textContent = (texts.temp_nozzle_left || 'Links') + (seite === 1 ? ' ✓' : ''); }
        if (r) { r.classList.toggle('ext-seg-btn--on', seite === 0);
                 r.textContent = (texts.temp_nozzle_right || 'Rechts') + ' (Aux)' + (seite === 0 ? ' ✓' : ''); }
        // Ladeseite fuer Filament-Aktionen mitziehen: 1=links→254, 0=rechts→255
        const sel = document.getElementById('ctrl-nozzle');
        if (sel) sel.value = seite === 1 ? '254' : '255';
        this.updateExtruderTab();
    }

    updateExtruderTab() {
        const st = this.lastState || {};
        const temps = st.nozzle_temps || {};
        const ziele = st.nozzle_targets || {};
        const holen = (o, k) => (o[k] != null ? o[k] : o[String(k)]);
        const dual = [holen(temps, 0), holen(temps, 1)].filter(v => v != null).length > 1;
        const seg = document.getElementById('ext-seg');
        if (seg) seg.style.display = dual ? '' : 'none';
        if (this._extSide == null) this._extSide = dual ? 1 : 0;

        const big = document.getElementById('ext-bigtemp');
        if (big) {
            let ist, soll;
            if (dual) { ist = holen(temps, this._extSide); soll = holen(ziele, this._extSide); }
            else { const pd = window.lastPrintData || {}; ist = st.nozzle_temp != null ? st.nozzle_temp : pd.nozzle_temp; soll = st.nozzle_target != null ? st.nozzle_target : pd.nozzle_target; }
            big.textContent = (ist != null ? Math.round(ist) : '--') + ' / ' + (soll != null ? Math.round(soll) : '--') + '°';
        }
        const hw = document.getElementById('ext-hw');
        if (hw) {
            const info = (st.nozzles || []).find(n => n && n.id === (this._extSide != null ? this._extSide : 0));
            hw.textContent = info
                ? [info.type || null, info.diameter ? info.diameter + ' mm' : null].filter(Boolean).join(' · ')
                : '';
        }

        // „Aus" ist der einzige uebersetzbare Text an der Schnelleinstellung —
        // PLA, PETG und ABS heissen ueberall gleich.
        const ausKnopf = document.getElementById('ext-temp-off');
        if (ausKnopf) ausKnopf.textContent = (window.texts || {}).temp_off || 'Aus';

        // Duese aktivieren (select_extruder) — nur Doppelduese. Ist die
        // gewaehlte Seite schon aktiv, zeigt der Knopf das nur an.
        const aktBtn = document.getElementById('ext-activate-btn');
        if (aktBtn) {
            const texts = window.texts || {};
            aktBtn.style.display = dual ? '' : 'none';
            if (dual) {
                const aktiv = st.active_nozzle === this._extSide;
                aktBtn.disabled = aktiv;
                const lbl = document.getElementById('ext-activate-label');
                if (lbl) lbl.textContent = aktiv
                    ? (texts.ext_nozzle_active || 'Düse aktiv ✓')
                    : (texts.ext_activate_nozzle || 'Düse aktivieren');
            }
        }
    }

    /** Gewaehlte Duese am Drucker aktivieren (select_extruder;
     *  0 = rechts, 1 = links — Bambu-Zaehlweise). */
    /** Zieltemperatur der GEWAEHLTEN Seite, Ausgangspunkt fuers Schrittweise. */
    _extSollTemp() {
        const st = this.lastState || {};
        const seite = this._extSide != null ? this._extSide : 0;
        const ziele = st.nozzle_targets || {};
        const wert = ziele[seite];
        return (wert != null && !isNaN(wert)) ? Math.round(wert) : 0;
    }

    /** Um `delta` verstellen. Sammelt kurz, damit nicht jeder Klick sendet. */
    extTempStep(delta) {
        const aktuell = (this._extTempOffen != null) ? this._extTempOffen : this._extSollTemp();
        const neu = Math.max(0, Math.min(320, aktuell + delta));
        this._extTempOffen = neu;
        const anzeige = document.getElementById('ext-bigtemp');
        if (anzeige) anzeige.textContent = anzeige.textContent.replace(/\/\s*\d+/, '/ ' + neu);
        if (this._extTempTimer) clearTimeout(this._extTempTimer);
        this._extTempTimer = setTimeout(() => {
            const wert = this._extTempOffen;
            this._extTempOffen = null;
            this.extTempSet(wert);
        }, 700);
    }

    /** Zieltemperatur setzen — fuer die oben gewaehlte Seite.
     *
     * Der Server schaltet die Duese vorher aktiv: der Drucker verwirft den
     * Befehl sonst wortlos, und vor der inaktiven Duese steht der
     * mechanische Tropfschutz, den man nicht mitheizen will.
     */
    extTempSet(wert) {
        const texts = window.texts || {};
        this._extTempOffen = null;
        if (this._extTempTimer) { clearTimeout(this._extTempTimer); this._extTempTimer = null; }
        const seite = this._extSide != null ? this._extSide : 0;
        window.printerAdapter.setTemp('extruder', Math.max(0, Math.round(wert)), seite)
            .then(r => {
                if (r && r.ok === false) {
                    skToast(this.fehlerText(r.error, texts.temp_apply_error), 'error');
                } else {
                    skToast((texts.toast_setting_extruder_temp
                        || 'Extruder auf {temp}°C setzen...').replace('{temp}', Math.round(wert)), 'info');
                }
            })
            .catch(() => skToast(texts.temp_apply_error || texts.connection_error, 'error'));
    }

    extActivateSide() {
        const texts = window.texts || {};
        const zustand = (window.lastPrintData || {}).gcode_state;
        if (zustand === 'RUNNING' || zustand === 'PREPARE') {
            skToast(texts.toast_no_nozzle_switch_printing || 'Während des Drucks keinen Düsenwechsel auslösen', 'warning');
            return;
        }
        const seite = this._extSide != null ? this._extSide : 0;
        window.printerAdapter.selectExtruder(seite).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
            else skToast(texts.toast_nozzle_switching || 'Düse wird gewechselt…', 'info');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    // ========================================
    // Filament-Tab: Faecher — Klick waehlt die Zielseite
    // ========================================
    renderFilamentSlots() {
        const wrap = document.getElementById('fil-slots');
        if (!wrap || wrap.offsetParent === null) return;
        const texts = window.texts || {};
        const st = this.lastState || {};
        const rep = st.device_report || {};
        const spools = rep.spools || [];
        const gewaehlt = (document.getElementById('ctrl-nozzle') || {}).value || '254';

        const farbe = (hex) => {
            const h = String(hex || '').replace('#', '');
            return h ? '#' + h.slice(0, 6) : 'transparent';
        };
        let html = '';
        const units = st.ams_units || [];
        const ziel = this._filZiel || {};
        units.forEach(u => {
            html += '<div class="mz-sec">' + (u.model || 'AMS') +
                (u.humidity != null ? ' · ' + u.humidity + '% ' + (texts.mz_humidity || 'Feuchte') : '') + '</div>';
            (u.trays || []).forEach(t => {
                // Klick = Zielwahl fuers Laden/Entladen (Editieren gibt's auf
                // der Hauptseite) — vorher ging Laden IMMER als externe Spule
                // raus und der Drucker verlangte Handanlegen.
                const aktiv = ziel.ams === u.id && ziel.slot === (t.id || 0);
                html += '<div class="mz-slot' + (aktiv ? ' mz-ziel-slot' : '') + '"' +
                    ' onclick="filSelectTray(' + u.id + ',' + (t.id || 0) + ')">' +
                    '<span class="mz-slot-col" style="background:' + farbe(t.color) + '"></span>' +
                    '<span class="mz-slot-name">' + [t.type || '?', t.name].filter(Boolean).join(' · ') + '</span>' +
                    (aktiv ? '<span class="mz-ziel-check">✓</span>' : '') +
                    '<button class="mz-edit-btn" title="Filament" ' +
                        'onclick="event.stopPropagation();amsEditTray(' + u.id + ',' + (t.id || 0) + ')">✎</button>' +
                    '</div>';
            });
        });
        if (spools.length) {
            html += '<div class="mz-sec">' + (texts.dev_spools || 'Externe Spulen') + '</div><div class="mz-spool-row">';
            html += spools.map(sp => {
                const id = parseInt(sp.id, 10);
                const seite = id === 254 ? 'L' : 'R';
                // Gewaehlt nur, wenn kein AMS-Fach das Ziel ist.
                const aktiv = ziel.ams != null
                    ? (ziel.ams === id)
                    : String(id) === String(gewaehlt);
                return '<div class="mz-slot' + (aktiv ? ' mz-ziel-slot' : '') + '" onclick="filSelectSpool(' + id + ')">' +
                    '<span class="mz-slot-col" style="background:' + farbe((sp.cols && sp.cols[0]) || sp.color) + '"></span>' +
                    '<span class="mz-slot-name">' + seite + ' · ' + (sp.type || '?') + '</span>' +
                    (aktiv ? '<span class="mz-ziel-check">✓</span>' : '') +
                    '<button class="mz-edit-btn" title="Filament" ' +
                        'onclick="event.stopPropagation();amsEditTray(' + id + ',0)">✎</button>' +
                    '</div>';
            }).join('');
            html += '</div>';
        }
        wrap.innerHTML = html;
        const hint = document.getElementById('fil-hint');
        if (hint) hint.textContent = texts.fil_pick_hint || 'Fach antippen = Zielseite für Laden/Entladen';

        // Der Ablaufschritt steht in den UNTEREN 8 Bit von `stat`; die oberen
        // tragen anderes. Vorher wurde `stat !== 0` geprueft — 768 sieht damit
        // nach „laeuft" aus, ist aber Schritt 0, also nichts. Der Server
        // liefert den Schritt jetzt fertig als `filament_step`.
        const schritt = e => (e && (e.filament_step != null
            ? e.filament_step : ((e.stat || 0) & 0xFF))) || 0;

        // Laden/Entladen/Spuelen ausgrauen, solange gedruckt wird oder schon
        // ein Filament-Ablauf laeuft — der Server-Guard blockt zwar auch,
        // aber die Knoepfe sollen es gar nicht erst anbieten.
        const zustand = String((window.lastPrintData || {}).gcode_state || '').toUpperCase();
        const gesperrt = zustand === 'RUNNING' || zustand === 'PREPARE' ||
            ((rep.extruders || []).some(e => schritt(e) !== 0));
        document.querySelectorAll('.fil-abtn').forEach(b => { b.disabled = gesperrt; });

        // Der Ladeknopf sagt, was gerade passiert — dasselbe, was der
        // Drucker auf seinem Bildschirm zeigt. Solange nichts laeuft, steht
        // wieder „Laden" drauf.
        const laufend = (rep.extruders || []).map(schritt).find(x => x > 0) || 0;
        // Der Schritt gehoert auf den Knopf, den der Benutzer gedrueckt hat —
        // beim Entladen stand er sonst auf „Laden" (25aug26 gemeldet).
        //
        // Wurde der Ablauf woanders angestossen (Bambu Studio, Druckerdisplay),
        // wissen wir das nicht; dann entscheidet der Schritt selbst:
        // 4 = altes Filament ziehen -> entladen, 5/6 = neues schieben/greifen
        // -> laden. Bei den gemeinsamen Schritten (erhitzen, schneiden) bleibt
        // es beim Laden.
        let seite = this._filLaufAktion;
        if (!seite) seite = (laufend === 4) ? 'unload' : 'load';
        if (!laufend) this._filLaufAktion = null;

        const namen = texts.fil_steps || {};
        [['control-load', 'load', texts.load],
         ['control-unload', 'unload', texts.unload]].forEach(([id, welche, standard]) => {
            const el = document.getElementById(id);
            if (!el) return;
            const aktiv = !!laufend && seite === welche;
            el.textContent = aktiv ? (namen[laufend] || standard) : standard;
            // Der Knopf ist waehrenddessen gesperrt — aber ausgegraut waere er
            // gerade dann am schlechtesten zu lesen, wenn er am meisten sagt.
            // Deshalb ein eigener Zustand: nicht klickbar, aber deutlich.
            const knopf = el.closest('button');
            if (knopf) knopf.classList.toggle('fil-abtn--laeuft', aktiv);
        });

        // Rueckfrage des Druckers: „ist Filament ausgetreten?" Er meldet sie
        // als print_error im MQTT-Bericht. Der Filament-Schritt taugt nicht
        // als Ausloeser — waehrend der Rueckfrage stand dort Schritt 6
        // (GRAB_NEW_FILAMENT), nicht 8. Der Server reicht sie als
        // `filament_dialog` durch, mitsamt dem Text des Druckers.
        //
        // Den Text nicht selbst formulieren: der Drucker benennt darin sogar
        // die Knoepfe („Fertig" / „Erneut versuchen").
        const frage = rep.filament_dialog || {};
        const kasten = document.getElementById('fil-confirm');
        if (kasten) {
            const wartet = !!(frage.text || frage.code);
            kasten.style.display = wartet ? '' : 'none';
            if (wartet) {
                const t = document.getElementById('fil-confirm-text');
                if (t) t.textContent = frage.text || texts.fil_confirm_hint || '';
            }
        }
    }

    filSelectSpool(id) {
        const sel = document.getElementById('ctrl-nozzle');
        if (sel) sel.value = String(id);
        this._extSide = id === 254 ? 1 : 0;
        this._filZiel = { ams: id, slot: 0 };
        this.renderFilamentSlots();
    }

    // AMS-Fach als Ziel — Laden geht dann als AMS-Ablauf raus (target =
    // Einheit/Tray wie im Studio), nicht als externe Spule.
    filSelectTray(amsId, slotId) {
        this._filZiel = { ams: amsId, slot: slotId };
        this.renderFilamentSlots();
    }

    // ========================================
    // moveAxis
    // ========================================
    moveAxis(axis, distance) {
        const texts = window.texts || {};
        // Kein Verfahren waehrend eines laufenden Drucks — das Fenster ist
        // seit dem Uebersicht-Tab auch beim Drucken erreichbar.
        const zustand = (window.lastPrintData || {}).gcode_state;
        if (zustand === 'RUNNING' || zustand === 'PREPARE') {
            skToast(texts.toast_no_move_printing || 'Während des Drucks nicht verfahrbar', 'warning');
            return;
        }
        // NEU: Sicherheitscheck
        if (!this.modalHomingDone) {
            skToast(texts.toast_wait_homing, 'warning');
            return;
        }

        let stepSize = distance;
        if (axis === 'X' || axis === 'Y') {
            stepSize = parseFloat(document.getElementById('xy-step-size').value);
        } else if (axis === 'Z') {
            stepSize = parseFloat(document.getElementById('z-step-size').value);
        }

        const actualDistance = distance > 0 ? stepSize : -stepSize;

        // Pre-Check: Klipper braucht Homing fuer relative Moves. Wenn die
        // Achse nicht in homed_axes ist, sparen wir uns den Backend-Call
        // und sagen direkt "erst homen". (Bambu meldet homed_axes nicht,
        // dort greift der Check nicht — Bambu erlaubt Moves ohne Home.)
        const ap = window.activePrinter || {};
        const homed = ap.state && ap.state.homed_axes;
        if (homed != null && !homed.toLowerCase().includes(axis.toLowerCase())) {
            skToast(texts.toast_must_home_first
                || 'Bitte erst Homing ausführen', 'info');
            return;
        }

        window.printerAdapter.move(axis, actualDistance).then(r => {
            if (!r.ok) {
                skToast(this.fehlerText(r.error, texts.toast_movement_failed), 'error');
            }
        });
    }

    // ========================================
    // homeAll
    // ========================================
    homeAll() {
        const texts = window.texts || {};
        window.printerAdapter.home(null).then(r => {
            if (r.ok) {
                skToast(texts.toast_homing_started + '...', 'info');
                setTimeout(() => {
                    homingDone = true;
                    const warning = document.getElementById('homing-warning');
                    if (warning) warning.style.display = 'none';
                    skToast(texts.toast_homing_completed, 'success');
                }, 3000);
            } else {
                skToast(this.fehlerText(r.error, texts.error), 'error');
            }
        });
        return;  // alter Pfad unten unreachable, bleibt als no-op
        // legacy fallback path:
        apiCall('/api/mqtt/home', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({axis: 'all'})
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                skToast(texts.toast_homing_started + '...', 'info');

                // Warte 3 Sekunden bis Homing fertig ist
                setTimeout(() => {
                    homingDone = true;

                    // Warning verstecken
                    const warning = document.getElementById('homing-warning');
                    if (warning) {
                        warning.style.display = 'none';
                    }

                    skToast(texts.toast_homing_completed, 'success');
                }, 3000);
            }
        });
    }

    // ========================================
    /** Cut power to the motors so head and bed can be pushed by hand.
     *  The printer's screen calls this "Free Move"; the command behind it
     *  is set_motor_power {power_on:false} (captured on 28aug26, while the
     *  user moved the axes out of the way for a cold pull).
     *
     *  Release only, no counterpart to hold them again: the next move
     *  command does that by itself, and a second button next to this one
     *  would be a control for something that happens anyway. */
    motorenFreigeben() {
        const texts = window.texts || {};
        window.printerAdapter.action('set_motor_power', { on: false }).then(r => {
            if (!r.ok) {
                skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                return;
            }
            skToast(texts.control_free_move_done || 'Achsen sind frei — der nächste Fahrbefehl hält sie wieder', 'info');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    // homeAxis
    // ========================================
    homeAxis(axis) {
        const texts = window.texts || {};
        window.printerAdapter.home(axis);
        skToast(texts.toast_homing_axis.replace('{axis}', axis), 'info');
    }

    // ========================================
    // parkHead
    // ========================================
    parkHead() {
        const texts = window.texts || {};
        window.printerAdapter.park();
        skToast(texts.toast_parking_head, 'info');
    }

    // ========================================
    // centerHead
    // ========================================
    centerHead() {
        const texts = window.texts || {};
        window.printerAdapter.center();
        skToast(texts.toast_centering_head, 'info');
    }

    // ========================================
    // setExtruderTemp
    // ========================================
    setExtruderTemp(temp) {
        const texts = window.texts || {};
        const ct = document.getElementById('custom-temp');
        if (ct) ct.value = temp;
        // Alte Bambu-ID existiert im neuen Extruder-Tab nicht mehr —
        // die Anzeige zieht der /api/status-Takt ueber updateExtruderTab nach.
        const alt = document.getElementById('extruder-target');
        if (alt) alt.textContent = temp + '°C';
        // Doppelduese: die im Extruder-Tab gewaehlte Seite ansteuern,
        // nicht die gerade aktive (natives set_nozzle_temp im Backend).
        window.printerAdapter.setTemp('extruder', temp,
            this._dualNozzle ? this._extSide : null);
        skToast(texts.toast_setting_extruder_temp.replace('{temp}', temp), 'info');
        setTimeout(() => this.updateExtruderTemp(), 2000);
    }

    // ========================================
    // setCustomTemp
    // ========================================
    setCustomTemp() {
        const temp = document.getElementById('custom-temp').value;
        this.setExtruderTemp(temp);
    }

    // ========================================
    // updateExtruderTemp
    // ========================================
    updateExtruderTemp() {
        // Klipper: aktuelle Temperatur kommt direkt aus dem Live-State
        // (printer_state-Event hat nozzle_temp/nozzle_target). Bambu nutzt
        // den HA-Sensor-Endpoint, weil's Bambu-MQTT-Felder via HA gespiegelt.
        if (window.isKlipperMode && window.isKlipperMode()) {
            // Klipper-Steuerung baut den Extruder-Tab mit eigenen IDs (kctrl-*);
            // die alten Bambu-IDs existieren hier nicht → null-sicher setzen.
            const s = window.activePrinter && window.activePrinter.state;
            if (s) {
                const cur = document.getElementById('kctrl-etemp');
                const tgt = document.getElementById('kctrl-etarget');
                if (cur && s.nozzle_temp != null) cur.textContent = Math.round(s.nozzle_temp) + '°C';
                if (tgt && s.nozzle_target != null) tgt.textContent = Math.round(s.nozzle_target) + '°C';
            }
            return;
        }

        // Bambu — der neue Extruder-Tab (ext-bigtemp & Co.) liest aus
        // lastState; der /api/status-Takt haelt den aktuell. Der alte
        // HA-Sensor-Lookup schrieb in IDs, die es nicht mehr gibt
        // (extruder-temp-display) und crashte mit null.textContent.
        this.updateExtruderTab();
    }

    // ========================================
    // extrudeFilament
    // ========================================
    extrudeFilament(length) {
        const texts = window.texts || {};
        const actualLength = length > 0 ?
            parseFloat(document.getElementById('extrude-length').value) :
            -parseFloat(document.getElementById('extrude-length').value);
        window.printerAdapter.extrude(actualLength);
        skToast(actualLength > 0 ? (texts.toast_extruding) : (texts.toast_retracting), 'info');
    }

    // ========================================
    // Duesenwahl
    // ========================================
    //
    // Doppelduesen-Geraete haben ZWEI externe Spulen. Adressiert werden sie
    // ueber ams_id: 254 = linke (Haupt-)Duese, 255 = rechte. Einduesen-
    // Geraete kennen nur die 255.
    //
    // null heisst "nichts auszuwaehlen" — dann geht der Parameter gar nicht
    // erst mit. Klipper kennt weder AMS noch zwei Duesen und nimmt ihn nicht
    // entgegen.
    selectedAmsId() {
        // Die Seitenwahl laeuft seit dem Display-Umbau ueber die Faecher im
        // Filament-Tab (und die Seitenwahl im Extruder-Tab) — das select ist
        // nur noch der unsichtbare Wertspeicher. Sichtbarkeit darf deshalb
        // KEIN Kriterium mehr sein, sonst geht Laden/Entladen ohne Seite raus.
        if (!this._dualNozzle) return null;
        const sel = document.getElementById('ctrl-nozzle');
        const v = sel ? parseInt(sel.value, 10) : NaN;
        return Number.isFinite(v) ? v : null;
    }

    /** Merkt sich nur noch, ob es zwei Duesen gibt — die rohe Auswahl bleibt versteckt. */
    applyNozzleSelector(caps) {
        this._dualNozzle = !!(caps && caps.dual_nozzle);
    }

    // ========================================
    // loadFilament
    // ========================================
    /** Server-Guard-Schluessel (guard_*) in Klartext uebersetzen. */
    fehlerText(fehler, sonst) {
        const texts = window.texts || {};
        return texts[fehler] || fehler || sonst;
    }

    /** Ist ueberhaupt Filament in einer Duese? (fuer Entladen/Spuelen) */
    filamentGeladen() {
        const rep = (this.lastState || {}).device_report || {};
        return (rep.extruders || []).some(e => e && e.has_filament);
    }

    /** Ist das gewaehlte Ziel (Fach/Spule) leer? */
    zielLeer(ziel) {
        const st = this.lastState || {};
        if (ziel.ams == null) return false;
        if (ziel.ams >= 254) {
            const sp = (((st.device_report || {}).spools) || [])
                .find(s => parseInt(s.id, 10) === ziel.ams);
            return !!sp && !(sp.type || '').trim();
        }
        const unit = (st.ams_units || []).find(u => u.id === ziel.ams);
        const tray = ((unit || {}).trays || []).find(t => (t.id || 0) === (ziel.slot || 0));
        return !!tray && !(tray.type || '').trim();
    }

    loadFilament() {
        const texts = window.texts || {};
        const btn = event.target.closest('button');
        this.showButtonFeedback(btn);
        const reset = () => this.resetButtonFeedback(btn);
        // Gewaehltes AMS-Fach hat Vorrang; sonst die externe Spule aus dem
        // (unsichtbaren) Seiten-Select.
        const ziel = this._filZiel || { ams: this.selectedAmsId(), slot: 0 };
        if (this.zielLeer(ziel)) {
            skToast(texts.guard_slot_empty || 'Gewähltes Fach ist leer.', 'warning');
            reset();
            return;
        }
        this._filLaufAktion = 'load';
        window.printerAdapter.filamentLoad(ziel.ams, ziel.slot).then(r => {
            if (r.ok) skToast(texts.toast_loading_filament, 'info');
            else skToast(this.fehlerText(r.error, texts.toast_load_failed), 'error');
            reset();
        }).catch(() => { skToast(texts.connection_error, 'error'); reset(); });
    }

    /**
     * Antwort auf die Rueckfrage des Druckers nach dem Laden.
     * `resume` laedt nochmal nach, `done` schliesst ab. Ohne eine der beiden
     * bleibt der Ablauf bei Schritt 8 stehen — bisher liess sich das nur in
     * Bambu Studio beantworten.
     */
    amsControl(param) {
        const texts = window.texts || {};
        const btn = event && event.target ? event.target.closest('button') : null;
        this.showButtonFeedback(btn);
        const reset = () => this.resetButtonFeedback(btn);
        window.printerAdapter.action('ams_control', { param }).then(r => {
            if (r.ok) {
                skToast(param === 'done'
                    ? (texts.toast_ams_done || 'Abgeschlossen')
                    : (texts.toast_ams_resume || 'Wird nachgeladen'), 'info');
            } else {
                skToast(this.fehlerText(r.error, texts.connection_error), 'error');
            }
            reset();
        }).catch(() => { skToast(texts.connection_error, 'error'); reset(); });
    }

    // ========================================
    // unloadFilament
    // ========================================
    unloadFilament() {
        const texts = window.texts || {};
        const btn = event.target.closest('button');
        this.showButtonFeedback(btn);
        const reset = () => this.resetButtonFeedback(btn);
        if (!this.filamentGeladen()) {
            skToast(texts.guard_nothing_loaded || 'Kein Filament geladen.', 'warning');
            reset();
            return;
        }
        const ziel = this._filZiel || { ams: this.selectedAmsId() };
        this._filLaufAktion = 'unload';
        window.printerAdapter.filamentUnload(ziel.ams).then(r => {
            if (r.ok) skToast(texts.toast_unloading_filament, 'info');
            else skToast(this.fehlerText(r.error, texts.toast_unload_failed), 'error');
            reset();
        }).catch(() => { skToast(texts.connection_error, 'error'); reset(); });
    }

    // ========================================
    // changeFilament
    // ========================================
    changeFilament() {
        const texts = window.texts || {};
        const btn = event.target.closest('button');
        this.showButtonFeedback(btn);
        const reset = () => this.resetButtonFeedback(btn);
        window.printerAdapter.action('filament_change').then(r => {
            if (r.ok) skToast(texts.toast_filament_change_started, 'info');
            else skToast(this.fehlerText(r.error, texts.toast_change_failed), 'error');
            reset();
        }).catch(() => { skToast(texts.connection_error, 'error'); reset(); });
    }

    // ========================================
    // purgeFilament
    // ========================================
    purgeFilament() {
        const texts = window.texts || {};
        const btn = event.target.closest('button');
        this.showButtonFeedback(btn);
        const reset = () => this.resetButtonFeedback(btn);
        window.printerAdapter.action('filament_purge').then(r => {
            if (r.ok) skToast(texts.toast_purging_filament, 'info');
            else skToast(this.fehlerText(r.error, texts.toast_purge_failed), 'error');
            reset();
        }).catch(() => { skToast(texts.connection_error, 'error'); reset(); });
    }

    // ========================================
    // showButtonFeedback
    // ========================================
    showButtonFeedback(btn) {
        if (!btn) return;
        btn.style.transform = 'scale(0.95)';
        btn.style.opacity = '0.7';
        btn.disabled = true;
        btn.style.cursor = 'wait';
    }

    // ========================================
    // resetButtonFeedback
    // ========================================
    resetButtonFeedback(btn) {
        if (!btn) return;
        setTimeout(() => {
            btn.style.transform = '';
            btn.style.opacity = '';
            btn.disabled = false;
            btn.style.cursor = '';
        }, 500);
    }

    // ========================================
    // KLIPPER-DIRECT STEUERUNG (Parität zur Android-App)
    // ========================================

    /** i18n-Helper mit deutschem Fallback. */
    kt(key, fallback) {
        const t = window.i18nManager && window.i18nManager.getText(key, '');
        return t || (window.texts && window.texts[key]) || fallback;
    }

    /** Beliebigen G-Code über den Direct-Adapter feuern. */
    kgcode(script) {
        return window.printerAdapter.gcode(script);
    }

    /** Zahl ohne unnötige Nullen: 100→"100", 0.1→"0.1". */
    kfmt(v) {
        return String(Math.abs(v)).replace(/\.?0+$/, '') || '0';
    }

    /** Baut die drei Tabs neu auf (Achsen / Extruder / Maschine). */
    buildKlipperControl() {
        // Tab-Labels: dritter Tab wird „Maschine".
        const tabFilament = document.getElementById('control-tab-filament');
        if (tabFilament) tabFilament.textContent = this.kt('control_tab_machine', 'Maschine');

        this.renderKlipperMovement();
        this.renderKlipperExtruder();
        this.renderKlipperMachine();
    }

    renderKlipperMovement() {
        const tab = document.getElementById('movement-tab');
        if (!tab) return;
        const kt = (k, f) => this.kt(k, f);
        // Jog-Reihe pro Achse: -100 -10 -1  [Achse=Home]  +1 +10 +100 (Z: 25/1/0.1)
        const jogRow = (axis, steps) => {
            const neg = steps.map(s => `<button class="kctrl-step" onclick="window.printerControlManager.kJog('${axis}',${-s})">-${this.kfmt(s)}</button>`).join('');
            const pos = steps.slice().reverse().map(s => `<button class="kctrl-step" onclick="window.printerControlManager.kJog('${axis}',${s})">+${this.kfmt(s)}</button>`).join('');
            return `<div class="kctrl-jog-row">${neg}
                <button class="kctrl-axis" onclick="window.printerControlManager.kHome('${axis}')">${axis}</button>${pos}</div>`;
        };
        tab.innerHTML = `
            <div class="ctrl-panel">
                <div class="kctrl-pos-row">
                    <div class="kctrl-pos"><span class="kctrl-pos-label">X</span><span id="kctrl-x">–</span></div>
                    <div class="kctrl-pos"><span class="kctrl-pos-label">Y</span><span id="kctrl-y">–</span></div>
                    <div class="kctrl-pos"><span class="kctrl-pos-label">Z</span><span id="kctrl-z">–</span></div>
                </div>
                <div class="kctrl-btn-row">
                    <button class="kctrl-btn" onclick="window.printerControlManager.kHome('')">${window.skIcon('haus', 'hd-ic--xs')} ${kt('control_home_all','Alle homen')}</button>
                    <button class="kctrl-btn" id="kctrl-qgl" onclick="window.printerControlManager.kQGL()">QGL</button>
                    <button class="kctrl-btn kctrl-btn--outline" onclick="window.printerControlManager.kMotorsOff()">${kt('control_motors_off','Motoren aus')}</button>
                </div>
            </div>
            <div class="ctrl-panel">
                <h4 class="ctrl-panel-title">${kt('control_jog','Bewegen')}</h4>
                ${jogRow('X',[100,10,1])}
                ${jogRow('Y',[100,10,1])}
                ${jogRow('Z',[25,1,0.1])}
            </div>
            <div class="ctrl-panel">
                <h4 class="ctrl-panel-title">${kt('control_z_offset','Z-Offset')} <span id="kctrl-zoffset">0.000</span></h4>
                <div class="kctrl-jog-row">
                    ${[-0.05,-0.025,-0.01,-0.005].map(d=>`<button class="kctrl-step" onclick="window.printerControlManager.kBabystep(${d})">${this.kfmt(d) === '0.005' ? '-0.005' : '-'+this.kfmt(d)}</button>`).join('')}
                    ${[0.005,0.01,0.025,0.05].map(d=>`<button class="kctrl-step" onclick="window.printerControlManager.kBabystep(${d})">+${this.kfmt(d)}</button>`).join('')}
                </div>
            </div>`;
    }

    renderKlipperExtruder() {
        const tab = document.getElementById('extruder-tab');
        if (!tab) return;
        const kt = (k, f) => this.kt(k, f);
        tab.innerHTML = `
            <div class="ctrl-panel">
                <div class="ctrl-temp-display">
                    <span class="ctrl-temp-current" id="kctrl-etemp">--°C</span>
                    <span class="ctrl-temp-target">→ <span id="kctrl-etarget">--°C</span></span>
                </div>
                <div class="kctrl-preset-row">
                    ${[0,200,220,240,250].map(t=>`<button class="kctrl-step" onclick="window.printerControlManager.kSetTemp(${t})">${t===0?(window.skIcon('schnee','hd-ic--xs')+' '+kt('control_off_btn','Aus')):t+'°'}</button>`).join('')}
                </div>
                <div class="ctrl-custom-temp">
                    <input type="number" id="kctrl-customtemp" class="ctrl-custom-temp-input" min="0" max="350" value="200">
                    <span class="ctrl-custom-temp-unit">°C</span>
                    <button class="ctrl-custom-temp-set" onclick="window.printerControlManager.kSetCustomTemp()">${kt('set_btn','Setzen')}</button>
                </div>
            </div>
            <div class="ctrl-panel">
                <h4 class="ctrl-panel-title">${kt('control_flow','Flow')} <span id="kctrl-flowval">100%</span></h4>
                <input type="range" id="kctrl-flow" class="kctrl-slider" min="50" max="200" value="100"
                    oninput="document.getElementById('kctrl-flowval').textContent=this.value+'%'"
                    onchange="window.printerControlManager.kSetFlow(this.value)">
            </div>
            <div class="ctrl-panel">
                <label class="ctrl-step-label">${kt('control_length_mm','Länge (mm)')}</label>
                <div class="kctrl-preset-row" id="kctrl-len-row">
                    ${[1,5,10,25,50].map(l=>`<button class="kctrl-step${l===10?' kctrl-step--sel':''}" data-len="${l}" onclick="window.printerControlManager.kSelLen(${l})">${l}</button>`).join('')}
                </div>
                <label class="ctrl-step-label">${kt('control_speed_mms','Geschwindigkeit (mm/s)')}</label>
                <div class="kctrl-preset-row" id="kctrl-spd-row">
                    ${[1,2,5,10].map(s=>`<button class="kctrl-step${s===5?' kctrl-step--sel':''}" data-spd="${s}" onclick="window.printerControlManager.kSelSpd(${s})">${s}</button>`).join('')}
                </div>
                <div class="kctrl-btn-row" style="margin-top:10px;">
                    <button class="kctrl-btn" id="kctrl-extrude" onclick="window.printerControlManager.kExtrude(1)">${window.skIcon('hoch', 'hd-ic--xs')} ${kt('control_extrude','Extrudieren')}</button>
                    <button class="kctrl-btn kctrl-btn--outline" id="kctrl-retract" onclick="window.printerControlManager.kExtrude(-1)">${window.skIcon('runter', 'hd-ic--xs')} ${kt('control_retract','Zurückziehen')}</button>
                </div>
                <div id="kctrl-toocold" class="kctrl-toocold" style="display:none;">${kt('control_too_cold','Düse zu kalt zum Extrudieren')}</div>
            </div>
            <button class="kctrl-btn" style="width:auto;" onclick="window.printerControlManager.kBedMesh()">${window.skIcon('karte', 'hd-ic--xs')} ${kt('control_bed_mesh','Bed-Mesh kalibrieren')}</button>`;
        this._kLen = 10;
        this._kSpd = 5;
    }

    renderKlipperMachine() {
        const tab = document.getElementById('filament-tab');
        if (!tab) return;
        const kt = (k, f) => this.kt(k, f);
        tab.innerHTML = `
            <div class="ctrl-panel">
                <h4 class="ctrl-panel-title">${kt('control_tab_machine','Maschine')}</h4>
                <div class="kctrl-btn-row">
                    <button class="kctrl-btn kctrl-btn--outline" onclick="window.printerControlManager.kFirmwareRestart()">${kt('control_fw_restart','Firmware-Neustart')}</button>
                    <button class="kctrl-btn kctrl-btn--outline" onclick="window.printerControlManager.kRestart()">${kt('control_klipper_restart','Klipper-Neustart')}</button>
                </div>
                <button class="kctrl-btn kctrl-btn--danger" onclick="window.printerControlManager.kEmergencyStop()">${window.skIcon('notaus', 'hd-ic--xs')} ${kt('control_emergency_stop','NOT-AUS')}</button>
            </div>
            <h4 class="ctrl-panel-title" style="padding:0 4px;">${kt('control_macros','Makros')}</h4>
            <div id="kctrl-macros"><div class="kctrl-macro-empty">…</div></div>`;
    }

    // ---- Aktionen (alle via G-Code über den Adapter) ----
    kHome(axis) { this.kgcode(axis ? `G28 ${axis}` : 'G28'); }
    kMotorsOff() { this.kgcode('M84'); }
    kQGL() { skToast('QGL …'); this.kgcode('QUAD_GANTRY_LEVEL'); }
    kJog(axis, delta) {
        const feed = (axis === 'Z') ? 600 : 3000;
        this.kgcode(`G91\nG1 ${axis}${delta.toFixed(3)} F${feed}\nG90`);
    }
    kBabystep(delta) { this.kgcode(`SET_GCODE_OFFSET Z_ADJUST=${delta.toFixed(3)} MOVE=1`); }
    kSetTemp(t) { this.kgcode(`M104 S${Math.max(0, Math.min(350, t))}`); }
    kSetCustomTemp() {
        const v = parseInt(document.getElementById('kctrl-customtemp').value, 10);
        if (!isNaN(v)) this.kSetTemp(v);
    }
    kSetFlow(percent) { this.kgcode(`M221 S${Math.max(50, Math.min(200, parseInt(percent, 10) || 100))}`); }
    kSelLen(l) { this._kLen = l; this._markSel('kctrl-len-row', 'len', l); }
    kSelSpd(s) { this._kSpd = s; this._markSel('kctrl-spd-row', 'spd', s); }
    _markSel(rowId, attr, val) {
        const row = document.getElementById(rowId);
        if (!row) return;
        row.querySelectorAll('.kctrl-step').forEach(b => {
            b.classList.toggle('kctrl-step--sel', parseFloat(b.dataset[attr]) === val);
        });
    }
    kExtrude(sign) {
        const mm = (this._kLen || 10) * sign;
        const feed = (this._kSpd || 5) * 60;
        this.kgcode(`M83\nG1 E${mm.toFixed(1)} F${feed}`);
    }
    kBedMesh() { skToast('Bed-Mesh …'); this.kgcode('BED_MESH_CALIBRATE'); }
    // Not-Aus + Neustarts über die dedizierten Moonraker-RPC-Actions im Adapter
    // (printer.emergency_stop / printer.firmware_restart) — als Gcode liefen sie nicht.
    kFirmwareRestart() { skToast(this.kt('control_fw_restart', 'Firmware-Neustart') + ' …'); window.printerAdapter.action('firmware_restart'); }
    kRestart() { skToast(this.kt('control_klipper_restart', 'Klipper-Neustart') + ' …'); window.printerAdapter.action('host_restart'); }
    kEmergencyStop() {
        showConfirmDialog(this.kt('control_emergency_confirm', 'Drucker sofort stoppen?'), () => {
            skToast(this.kt('control_emergency_stop', 'NOT-AUS'), 'error');
            window.printerAdapter.action('emergency_stop');
        });
    }
    kRunMacro(name) { skToast(name + ' …'); this.kgcode(name); }

    /** Live-State pollen (Position, Z-Offset, Temp, Flow, can_extrude). */
    startKlipperPoll() {
        const self = this;
        const poll = () => {
            fetch('/api/klipper/control-state', { credentials: 'same-origin' })
                .then(r => r.json()).then(s => { if (s && s.available) self.applyKlipperState(s); })
                .catch(() => {});
        };
        poll();
        if (this.klipperPollInterval) clearInterval(this.klipperPollInterval);
        this.klipperPollInterval = setInterval(poll, 2000);
    }

    applyKlipperState(s) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const homed = s.homed_axes || '';
        set('kctrl-x', s.x != null && homed.includes('x') ? s.x.toFixed(2) : '–');
        set('kctrl-y', s.y != null && homed.includes('y') ? s.y.toFixed(2) : '–');
        set('kctrl-z', s.z != null && homed.includes('z') ? s.z.toFixed(3) : '–');
        set('kctrl-zoffset', (s.z_offset || 0).toFixed(3));
        if (s.extruder_temp != null) set('kctrl-etemp', Math.round(s.extruder_temp) + '°C');
        if (s.extruder_target != null) set('kctrl-etarget', Math.round(s.extruder_target) + '°C');
        // QGL nur sinnvoll wenn Z gehomed.
        const qgl = document.getElementById('kctrl-qgl');
        if (qgl) qgl.disabled = !homed.includes('z');
        // Flow-Slider nur angleichen wenn der User gerade nicht zieht.
        const flow = document.getElementById('kctrl-flow');
        if (flow && document.activeElement !== flow && s.flow_percent) {
            flow.value = s.flow_percent;
            const fv = document.getElementById('kctrl-flowval');
            if (fv) fv.textContent = s.flow_percent + '%';
        }
        // can_extrude → Extrudieren/Zurückziehen sperren + Hinweis.
        const cold = !s.can_extrude;
        ['kctrl-extrude', 'kctrl-retract'].forEach(id => {
            const b = document.getElementById(id);
            if (b) { b.disabled = cold; b.style.opacity = cold ? '0.5' : ''; }
        });
        const tc = document.getElementById('kctrl-toocold');
        if (tc) tc.style.display = cold ? 'block' : 'none';
    }

    /** Makro-Liste + Mainsail-Gruppen laden und rendern. */
    loadKlipperMacros() {
        const box = document.getElementById('kctrl-macros');
        fetch('/api/klipper/macros', { credentials: 'same-origin' })
            .then(r => r.json()).then(data => {
                if (!box) return;
                const groups = (data && data.groups) || [];
                const macros = (data && data.macros) || [];
                const esc = (n) => n.replace(/'/g, "\\'");
                const chip = (name, color) =>
                    `<button class="kctrl-macro" style="${color ? `background:${color};border-color:${color};color:#fff;` : ''}" onclick="window.printerControlManager.kRunMacro('${esc(name)}')">${name}</button>`;
                let html = '';
                if (groups.length) {
                    const grouped = new Set();
                    groups.forEach(g => {
                        g.macros.forEach(m => grouped.add(m.name.toUpperCase()));
                        html += `<div class="kctrl-macro-group" style="border-color:${g.color}99;">
                            <div class="kctrl-macro-group-title" style="color:${g.color};">${g.name}</div>
                            <div class="kctrl-macro-wrap">${g.macros.map(m => chip(m.name, m.color)).join('')}</div></div>`;
                    });
                    const other = macros.filter(m => !grouped.has(m.toUpperCase()));
                    if (other.length) {
                        html += `<div class="kctrl-macro-group"><div class="kctrl-macro-group-title">${this.kt('control_macros_other', 'Weitere')}</div>
                            <div class="kctrl-macro-wrap">${other.map(m => chip(m, null)).join('')}</div></div>`;
                    }
                } else if (macros.length) {
                    html = `<div class="kctrl-macro-wrap">${macros.map(m => chip(m, null)).join('')}</div>`;
                } else {
                    html = '<div class="kctrl-macro-empty">–</div>';
                }
                box.innerHTML = html;
            }).catch(() => { if (box) box.innerHTML = '<div class="kctrl-macro-empty">–</div>'; });
    }
}

// Instantiate singleton
window.printerControlManager = new PrinterControlManager();

// ========================================
// Global wrappers for HTML onclick handlers
// ========================================
function openSettings() { window.printerControlManager.openSettings(); }
function openPrinterControl(tab) { window.printerControlManager.openPrinterControl(tab); }
function closePrinterControl() { window.printerControlManager.closePrinterControl(); }
function disableAllControlButtons() { window.printerControlManager.disableAllControlButtons(); }
function enableAllControlButtons() { window.printerControlManager.enableAllControlButtons(); }
function removeHomingWarnings() { window.printerControlManager.removeHomingWarnings(); }
function showHomingRequiredWarning() { window.printerControlManager.showHomingRequiredWarning(); }
function skipHoming() { window.printerControlManager.skipHoming(); }
function doManualHoming() { window.printerControlManager.homeAll(); }
function switchControlTab(tab) { window.printerControlManager.switchControlTab(tab); }
function moveAxis(axis, distance) { window.printerControlManager.moveAxis(axis, distance); }
function homeAll() { window.printerControlManager.homeAll(); }
function homeAxis(axis) { window.printerControlManager.homeAxis(axis); }
function motorenFreigeben() { window.printerControlManager.motorenFreigeben(); }
function parkHead() { window.printerControlManager.parkHead(); }
function centerHead() { window.printerControlManager.centerHead(); }
function setExtruderTemp(temp) { window.printerControlManager.setExtruderTemp(temp); }
function setCustomTemp() { window.printerControlManager.setCustomTemp(); }
function updateExtruderTemp() { window.printerControlManager.updateExtruderTemp(); }
function extrudeFilament(length) { window.printerControlManager.extrudeFilament(length); }
function amsEditTray(a, t) { window.printerControlManager.amsEditTray(a, t); }
function setExtraLight(n, on) { window.printerControlManager.setExtraLight(n, on); }
function amsDryStart(id) { window.printerControlManager.amsDryStart(id); }
function startCalibration() { window.printerControlManager.startCalibration(); }
function amsDryStop(id) { window.printerControlManager.amsDryStop(id); }
function amsReadRfid(a, s) { window.printerControlManager.amsReadRfid(a, s); }
function setChamberTemp() { window.printerControlManager.setChamberTemp(); }
function setAirductMode(m) { window.printerControlManager.setAirductMode(m); }
function setBuzzer(m) { window.printerControlManager.setBuzzer(m); }
function loadFilament() { window.printerControlManager.loadFilament(); }
function unloadFilament() { window.printerControlManager.unloadFilament(); }
function amsControl(p) { window.printerControlManager.amsControl(p); }
function changeFilament() { window.printerControlManager.changeFilament(); }
function purgeFilament() { window.printerControlManager.purgeFilament(); }
function showButtonFeedback(btn) { window.printerControlManager.showButtonFeedback(btn); }
function resetButtonFeedback(btn) { window.printerControlManager.resetButtonFeedback(btn); }
function jogAxis(axis, dist) { window.printerControlManager.jogAxis(axis, dist); }
function extSelectSide(seite) { window.printerControlManager.extSelectSide(seite); }
function extActivateSide() { window.printerControlManager.extActivateSide(); }
function extTempStep(delta) { window.printerControlManager.extTempStep(delta); }
function extTempSet(wert) { window.printerControlManager.extTempSet(wert); }

function filSelectSpool(id) { window.printerControlManager.filSelectSpool(id); }
function filSelectTray(a, s) { window.printerControlManager.filSelectTray(a, s); }
