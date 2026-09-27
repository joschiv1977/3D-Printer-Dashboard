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

        // Show the nozzle selector when the printer profile reports two
        // nozzles. Uses the document-wide cached /api/config fetch (the same
        // one as tab-bar-manager), so no extra request.
        document.addEventListener('DOMContentLoaded', () => {
            window.__directCfgPromise = window.__directCfgPromise ||
                fetch('/api/config', { credentials: 'same-origin' })
                    .then(r => r.json()).catch(() => ({}));
            // Initial state from the config -- same list as in the status, just
            // without live state. The status overwrites it once it arrives.
            // The mapping happens in ONE place, server-side.
            window.__directCfgPromise.then(cfg => {
                const prof = (cfg && cfg.printer_profile) || {};
                this._caps = prof.capabilities || {};
                this.applyNozzleSelector(this._caps);
                this.applyDeviceTab(this._caps, this.lastState || {});
            }).catch(() => {});
        });

        // Live status: keep the device tab in sync.
        document.addEventListener('DOMContentLoaded', () => {
            const attach = () => {
                if (!window.socket || !window.socket.on) { setTimeout(attach, 500); return; }
                window.socket.on('printer_state', () => {
                    const st = (window.activePrinter && window.activePrinter.state) || {};
                    this.lastState = st;
                    // The status brings its own capabilities -- it knows more
                    // than the config, because the device itself reported them.
                    if (st.capabilities) this._caps = st.capabilities;
                    this.applyNozzleSelector(this._caps || {});
                    this.applyDeviceTab(this._caps || {}, st);
                    this.updateDeviceTab(st);
                    this.sperreTabsWennAus();
                    if (window.refreshMovementMap) window.refreshMovementMap();
                });
            };
            attach();
        });
    }


    // ========================================
    // Device tab (X2D/H2D & co.)
    // ========================================
    //
    // Everything here shows or hides itself. Two sources:
    //   Status   what the PRINTER reports (nozzles, airduct modes, door)
    //   Profile  what the MODEL has per datasheet (buzzer, 2nd aux fan)
    // Nothing is guessed by model where the device itself reports it.

    /** Shows the tab and blocks that match the printer.
     *
     * Queries EXCLUSIVELY the capability list. The server merges it
     * from the profile and live state (services/printer_capabilities.py)
     * -- the UI used to check both separately here and had to be
     * kept in sync with every new feature.
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
        // The new blocks don't depend on the profile but on whether the
        // printer reports it at all -- it's all in device_report.
        const rep = st.device_report || {};

        // Extra lights: the device's lights_report is the source of truth --
        // the X2D e.g. reports NO chamber_light2 (only the H2D has that) and
        // silently ignores the switch command. Only when there is (still) no
        // report does the profile apply.
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

        // Fan button in Bambu mode too -- /api/fans exists there now,
        // the window is the same as with Klipper-Direct.
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
        // Same objects and names as the fan window (/api/fans):
        // split left/right for two aux fans, otherwise one.
        const fans = [['part', texts.fan_part || 'Bauteillüfter']];
        if (caps && caps.secondary_aux_fan) {
            fans.push(['aux_l', texts.fan_aux_left || 'Hilfslüfter links']);
            fans.push(['aux_r', texts.fan_aux_right || 'Hilfslüfter rechts']);
        } else {
            fans.push(['aux', texts.fan_aux || 'Hilfslüfter']);
        }
        fans.push(['chamber', texts.fan_chamber || 'Kammerlüfter']);
        // Only rebuild when the fan set changes -- the panels used to be
        // built with empty capabilities and then stayed wrong forever
        // (single aux instead of left/right).
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

    /** Fill the device-tab sliders with the actual values from /api/fans --
     *  the same source as the fan window, so both show identically
     *  (including left/right aux fans from the airduct parts). */
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
                    // Don't pull the slider out from under the user's finger
                    if (slider && document.activeElement !== slider) slider.value = pct;
                    if (slider) slider.disabled = f.controllable === false;
                    // In heating mode the AUX paths are recirculation for the
                    // chamber heater -- a note instead of a bare percentage.
                    if (wert) wert.textContent = f.note
                        ? pct + '% · ' + (texts[f.note] || f.note)
                        : pct + '%';
                });
            })
            .catch(() => {})
            .finally(() => { this._devFansBusy = false; });
    }

    /** Keep the live values in the device tab in sync. */
    /** Flatten /api/status into the shape the device tab reads.
     *
     * The response is organized by topic (temperatures, ams, ...), the
     * tab expects flat values. Instead of handling both shapes in the
     * tab, it's converted once here.
     */
    applyStatusPayload(data) {
        if (!data) return;
        // The central filament state rides along with the status. Every
        // renderer below asks window.filamentState instead of judging the
        // slots for itself.
        if (window.filamentState) window.filamentState.update(data.filament_state);
        // What may be done right now -- same path, same moment.
        if (window.aktionen) window.aktionen.update(data.actions);
        const flach = Object.assign({}, data, data.temperatures || {}, {
            ams_units: (data.ams && data.ams.units) || data.ams_units || [],
            device_report: data.device_report || {},
            capabilities: data.capabilities || this._caps || {},
        });
        this.lastState = flach;
        if (flach.capabilities) this._caps = flach.capabilities;
        this.applyDeviceTab(this._caps || {}, flach);
        this.updateDeviceTab(flach);
        this.sperreTabsWennAus();
        // The bed map reads lastState. It has to hear about a new one, or the
        // homing lock stays on screen after a home.
        if (window.refreshMovementMap) window.refreshMovementMap();
        // The calibration progress used to hang off exactly two calls until
        // 28aug26: tab switch and 1.5s after start. After that the card stood
        // still -- for a 49-minute calibration that's most of the time.
        this.zeichneKalibrierLauf();
        // The overview (modal) and the main-page zones live off the same
        // cadence; updateOverviewTab writes both ID sets in one pass.
        this.updateOverviewTab();
        this.renderMaterialZone();
        this.updateExtruderTab();
        this.renderFilamentSlots();
        this.refreshDeviceFans();
        this.sperreDruckTabs();
    }

    /** Lock the axis and extruder tabs while the printer is busy --
     *  while printing (RUNNING/PREPARE) and during a filament
     *  process.
     *
     *  The process used to be visible only in the filament tab. In the
     *  others everything stayed operable: the printer accepts the commands
     *  but only executes them afterwards -- on the device it looked like
     *  nothing happened (reported 26aug26: temperature set during loading,
     *  executed only minutes later).
     *
     *  The server guard remains the second safety net. */
    sperreDruckTabs() {
        // No rule of its own any more: the server says per group what may be
        // done (services/action_guards.py, block `actions`). The axes tab
        // follows `move`, the extruder tab `extruder`.
        const gate = window.aktionen;
        const achsenFrei = gate.erlaubt('move');
        const extruderFrei = gate.erlaubt('extruder');
        [['movement-tab', achsenFrei], ['extruder-tab', extruderFrei]].forEach(([id, frei]) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('ctrl-gesperrt', !frei);
        });

        // And say WHY it's locked -- a grey surface without a reason
        // looks broken. The reason comes with the block.
        const hinweis = document.getElementById('ctrl-busy-hinweis');
        if (hinweis) {
            const grund = gate.text('move') || gate.text('extruder');
            hinweis.style.display = grund ? '' : 'none';
            hinweis.textContent = grund;
        }
    }

    updateDeviceTab(status) {
        const st = status || {};
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        const texts = window.texts || {};

        // Nozzles: Bambu counts 1 = left, 0 = right.
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

        // Titles of the new blocks
        set('dev-spools-title', texts.dev_spools || 'Externe Spulen');
        set('dev-storage-title', texts.dev_storage || 'Speicher');
        set('dev-plate-title', texts.dev_plate || 'Druckplatte');
        set('dev-plate-label', texts.dev_plate_detected || 'Erkannt');
        set('dev-vent-title', texts.dev_vent || 'Filterbox');
        set('dev-vent-state-label', texts.dev_vent_state || 'Zustand');
        set('dev-vent-speed-label', texts.dev_vent_speed || 'Drehzahl');

        // Chamber
        set('dev-chamber-temp', st.chamber_temp != null ? Math.round(st.chamber_temp) + '°C' : '--°C');
        set('dev-chamber-target', st.chamber_target != null ? Math.round(st.chamber_target) : '--');

        // Door + tool
        set('dev-door-value', st.door_open ? (texts.door_open || 'offen') : (texts.door_closed || 'geschlossen'));
        const toolRow = document.getElementById('dev-tool-row');
        if (toolRow) {
            const tool = st.tool_module;
            toolRow.style.display = (tool && tool !== 'none') ? '' : 'none';
            set('dev-tool-value', tool || '--');
        }

        this.renderAms(st.ams_units);
        this.renderDeviceReport(st.device_report || {}, st);

        // Airduct: sync the current mode
        const sel = document.getElementById('dev-airduct');
        if (sel && st.airduct_mode != null && sel.value !== String(st.airduct_mode)) {
            sel.value = String(st.airduct_mode);
        }
    }

    /** Everything else the printer reports (device_report).
     *
     * Built with the same building blocks as the rest of the device tab:
     * dev-row for value pairs, ctrl-tip-box for notes.
     */
    renderDeviceReport(rep, st) {
        const texts = window.texts || {};
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        const esc = (t) => String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // --- External spools. 254 left, 255 right; single-nozzle devices only 255.
        const liste = document.getElementById('dev-spools-list');
        if (liste) {
            const seiten = { 254: texts.spool_left || 'Links', 255: texts.spool_right || 'Rechts' };
            const einzeln = (rep.spools || []).length < 2;
            // Roll, content and the nozzle it feeds: the filament state's word.
            const fs = window.filamentState;
            liste.innerHTML = (rep.spools || []).map(sp => {
                const name = einzeln ? (texts.spool_external || 'Externe Spule')
                                     : (seiten[sp.id] || String(sp.id));
                const key = fs.externalKey(parseInt(sp.id, 10));
                // R11: an AMS takes this spool's nozzle inlet -- as on the material card.
                const sperre = fs.blockedBy(key);
                if (sperre) {
                    return `<div class="dev-row"><span>${esc(name)}</span>` +
                           `<strong>${esc((texts.fs_place_blocked || 'Belegt durch {unit}')
                               .replace('{unit}', sperre.model || 'AMS'))}</strong></div>`;
                }
                if (!fs.hasRoll(key)) {
                    return `<div class="dev-row"><span>${esc(name)}</span>` +
                           `<strong>${esc(fs.isEmpty(key) ? (texts.ams_empty || 'leer') : '?')}</strong></div>`;
                }
                const inhalt = (fs.place(key) || {}).content || {};
                const teile = [];
                if (inhalt.temp_min && inhalt.temp_max) teile.push(`${esc(inhalt.temp_min)}–${esc(inhalt.temp_max)}°C`);
                if (sp.diameter) teile.push(`${esc(sp.diameter)} mm`);
                if (fs.feeding(key) != null) {
                    teile.push(`${esc(texts.spool_feeds || 'speist Düse')} ${fs.feeding(key)}`);
                }
                return `<div class="dev-row"><span>${esc(name)}</span>` +
                       `<strong>${esc(inhalt.material || '?')}</strong></div>` +
                       (teile.length ? `<div class="dev-row"><span></span>` +
                                       `<span>${teile.join(' · ')}</span></div>` : '');
            }).join('');
        }

        // --- Storage. The stick carries timelapse and camera recordings and
        // fills up first -- hence a warning from 90 percent on.
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

        // --- Build plate: base = slicer BedType enum (Studio PrintConfig.hpp),
        //     measured on the X2D (Textured => base 4). Raw QR ID only as fallback.
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
     * Set the chamber target -- and check whether the printer accepted it.
     *
     * The X2D silently discards `set_ctt` when the target is above what
     * the loaded filament can tolerate (its display says: "Filament may
     * soften above 50 degrees"). No error comes back, the target simply
     * stays put. Until 21aug26 the UI still reported "Chamber target set"
     * regardless -- you'd set 65, read the confirmation, and wonder why
     * it stayed at 40.
     *
     * Hence: send, wait briefly, compare the reported target.
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

    /** After a few seconds, check whether the target really took effect. */
    _pruefeKammerZiel(gewuenscht) {
        const texts = window.texts || {};
        const hole = () => (window.apiCall ? apiCall('/api/status')
                                           : fetch('/api/status', { credentials: 'same-origin' }))
            .then(r => r.json());
        // Two attempts: the printer doesn't report the new target immediately.
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
    // One card per unit. What a unit can do, it reports itself:
    // can_dry is only set for AMS 2 Pro and AMS HT, and the AMS HT has
    // exactly ONE slot instead of four.
    renderAms(units) {
        const box = document.getElementById('dev-ams-list');
        const panel = document.getElementById('dev-ams-panel');
        if (!box || !panel) return;
        const list = units || [];
        panel.style.display = list.length ? '' : 'none';
        if (!list.length) { box.innerHTML = ''; return; }

        const texts = window.texts || {};
        // Only rebuild when the structure changes -- otherwise input
        // fields would be empty again on every status update.
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

        // Drying now runs through the 014 dialog (type + degrees + hours) --
        // the old number inputs (degrees/minutes) are gone.
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
        // Humidity/temperature carry a symbol, so they need innerHTML --
        // set() writes text and would render the SVG as a literal string.
        const setzeMarkup = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };
        const parts = [];
        if (u.humidity != null) parts.push(window.skIcon('tropfen', 'hd-ic--xs') + ' ' + u.humidity + '%');
        if (u.temperature != null) parts.push(window.skIcon('thermo', 'hd-ic--xs') + ' ' + Math.round(u.temperature) + '°C');
        setzeMarkup('ams-' + u.id + '-env', parts.join('&nbsp; '));

        // Roll and content per slot: the filament state's word, not the raw
        // tray (which keeps its type while a roll is pulled or dries).
        const fs = window.filamentState;
        (u.trays || []).forEach(t => {
            const schluessel = fs.slotKey(u.id, t.id || 0);
            const drin = fs.hasRoll(schluessel);
            const inhalt = drin ? ((fs.place(schluessel) || {}).content || {}) : {};
            const dot = document.getElementById('ams-' + u.id + '-dot-' + t.id);
            if (dot) {
                const c = (inhalt.color || '').slice(0, 6);
                dot.style.background = c ? ('#' + c) : 'transparent';
                dot.style.borderStyle = c ? 'solid' : 'dashed';
            }
            set('ams-' + u.id + '-type-' + t.id,
                fs.isEmpty(schluessel) ? (texts.ams_empty || 'leer') : (inhalt.material || '?'));
            // remain = -1 means unknown (only filled with Bambu RFID).
            set('ams-' + u.id + '-remain-' + t.id,
                (inhalt.remain != null && inhalt.remain >= 0) ? inhalt.remain + '%' : '');
        });

        if (u.can_dry) {
            const mins = u.dry_time || 0;
            set('ams-' + u.id + '-drystate', mins > 0
                ? (texts.ams_drying || 'Trocknet') + ' — ' +
                  Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min'
                : (texts.ams_dry_idle || 'Trocknung aus'));
        }
    }

    /** Opens or closes the filament editor for a slot. */
    amsEditTray(amsId, trayId) {
        // Unified editor for all callers (material zone, filament tab,
        // device tab) -- the old inline box only existed in the device tab,
        // everywhere else a click simply did nothing.
        this.openTrayEditor(amsId, trayId);
    }

    /** Filament editor like on the display: full profile list + color. */
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

        // Layout 1:1 from the display (wiki screen-operation/015.png):
        // filament row = TWO dropdowns (brand + type), color row =
        // color square, nozzle temperature row = min/max display from the
        // profile, cancel | confirm (green) at the bottom.
        let overlay = document.getElementById('tray-edit-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'tray-edit-overlay';
        overlay.className = 'tray-edit-overlay';
        // Base list + custom profiles (id "P..."), synced onto the
        // printer by Studio -- visible in the currently loaded
        // slots/spools (e.g. "Extrudr DuraPro ABS"). The display shows
        // those too, so we include them in the selection.
        // Profile list comes from the server (/api/filament/db): Bambu's base
        // profiles plus the custom profiles from the sliced 3MFs. The base
        // list used to sit here as a JS constant -- unreachable for iOS and
        // Android, which is why those couldn't set the slot type at all.
        // Server list first, then the custom profiles. The other way round,
        // `db` already had an entry after the first loaded slot, the check
        // below no longer applied -- and the editor showed exactly one brand:
        // that of the loaded filament.
        if (!(this._filamentDb || []).length) {
            if (!this._filamentDbLaeuft) {
                this._filamentDbLaeuft = true;
                (window.apiCall ? apiCall('/api/filament/db') : fetch('/api/filament/db', { credentials: 'same-origin' }))
                    .then(r => r.json())
                    .then(d => {
                        this._filamentDb = ((d && d.profiles) || []).map(p =>
                            [p.idx, p.name, p.type || '?',
                             parseInt(p.min, 10) || 190, parseInt(p.max, 10) || 240]);
                        // Drying presets come from the same response.
                        // The table in filament-db.js remains as a fallback
                        // in case the server sends nothing (yet) --
                        // from now on it's filled from there.
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
        // Profiles that only show up in loaded slots/spools --
        // the display shows those too.
        (st.ams_units || []).forEach(u => (u.trays || []).forEach(t =>
            fuegeCustom(t.info_idx, t.name, t.type, t.nozzle_temp_min, t.nozzle_temp_max)));
        (((st.device_report || {}).spools) || []).forEach(sp =>
            fuegeCustom(sp.info_idx, sp.name, sp.type, sp.temp_min, sp.temp_max));
        const marke = (name) => name.split(' ')[0];
        const sorte = (name) => name.split(' ').slice(1).join(' ');
        const marken = [];
        db.forEach(f => { if (!marken.includes(marke(f[1]))) marken.push(marke(f[1])); });

        // Default selection: the reported profile. External spools often
        // report none, but do report the type ("PLA") -- then the first
        // profile of that type; otherwise the right spool's editor showed
        // the left spool's filament.
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
              // Adopt from Spoolman: type, color and temperatures then
              // come from there, and the slot gets a fixed mapping.
              // After that, nothing needs to be guessed via profile names anymore.
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label">' + (texts.spoolman || 'Spoolman') + '</span>' +
                '<div class="tray-edit-felder">' +
                  // Looks like the selection fields above it, because it's the
                  // same decision -- just from the other source.
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
        // Reset like on the display: empty the slot -> shows "?" again afterward.
        overlay.querySelector('#tray-edit-reset').addEventListener('click', () => {
            // Confirm first: the button sits next to "Cancel" and looked
            // identical until 22aug26. A misclick emptied the slot, and
            // the printer no longer knew afterward what was loaded.
            //
            // Via the UI's own modal, NOT via window.confirm:
            // the native dialog comes in system style and doesn't match
            // the rest of the design at all.
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
        // Spool from Spoolman: fills the fields and remembers the id.
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
                // The profile comes from the server -- the same choice an
                // assignment makes (remembered, by name, Generic). Guessed
                // here until 16sep26: Overture TPU became "Bambu TPU 95A".
                // Generic is only preselected, with a hint; Confirm decides.
                window.apiCall('/api/filament/spools/' + spule.id + '/profile')
                    .then(r => r.json()).then(d => {
                        const p = d && d.success ? d.profile : null;
                        const treffer = p ? db.find(x => x[0] === p.idx) : null;
                        if (treffer) {
                            gewaehlt = treffer[0];
                            aktMarke = marke(treffer[1]);
                            selMarke.value = aktMarke;
                            maleSorten();
                        }
                        if (d && d.hint) skToast(d.hint, 'warning');
                        else if (!treffer) skToast((d && d.error) || texts.connection_error, 'warning');
                    }).catch(() => skToast(texts.connection_error, 'error'));
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
                        // If exactly THIS slot is currently feeding the nozzle,
                        // the spool is also the active one. For any other slot
                        // that would be wrong -- a click on slot 3 would then
                        // displace the spool that's actually being printed.
                        const fs = window.filamentState;
                        const schluessel = amsId >= 254 ? fs.externalKey(amsId) : fs.slotKey(amsId, trayId);
                        if (fs.feeding(schluessel) != null && window.activateSpool) {
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

    /** Extra lights (second chamber light, heated bed). */
    setExtraLight(node, on) {
        const texts = window.texts || {};
        window.printerAdapter.setLight(on, node).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    /** Drying dialog like on the display (wiki screen-operation/014.png):
     *  humidity display, type dropdown, degrees + hours fields, green start.
     *  Type choice fills degrees/hours with Studio's recommendation. */
    /**
     * Drying is running: show instead of start.
     *
     * Same frame as the start form, but without input fields -- what's
     * set is already fixed. Only stop and close.
     */
    _amsDryLaeuft(unit) {
        const texts = window.texts || {};
        const rest = Math.floor((unit.dry_time || 0) / 60) + ':' +
            String((unit.dry_time || 0) % 60).padStart(2, '0');
        // Same as for the slots in the card: the printer delivers the
        // color as hex with alpha, of which we need the first six digits.
        const farbe = (hex) => {
            const h = String(hex || '').replace('#', '');
            return h ? '#' + h.slice(0, 6) : 'transparent';
        };
        // Is a roll in this slot? The central filament state answers it. The
        // old rule (a type is there) went blind exactly here: drying WITH the
        // roll turning needs the filament out of the feeder, and the printer
        // then reports the slot as empty -- type and colour gone. The slots
        // vanished from this card in the middle of the run (measured
        // 15sep26, 21:37). Without a block the old rule still applies.
        const drin = (t) => window.filamentState.hasRoll(window.filamentState.slotKey(unit.id, t.id || 0));
        const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const fertig = new Date(Date.now() + (unit.dry_time || 0) * 60000);
        const fertigUm = String(fertig.getHours()).padStart(2, '0') + ':' +
            String(fertig.getMinutes()).padStart(2, '0');

        let overlay = document.getElementById('dry-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'dry-overlay';
        overlay.className = 'tray-edit-overlay';

        // Same measurement columns as in the material card (.mz-mess):
        // icon and abbreviation small on top, value below. Plain label/value
        // rows used to be here -- those looked out of place next to the card.
        const mess = (zeichen, kuerzel, wert) =>
            '<div class="mz-mess"><div class="mz-mess-kopf">'
            + window.skIcon(zeichen, 'hd-ic--xs') + ' ' + kuerzel
            + '</div><div class="mz-mess-wert">' + wert + '</div></div>';

        overlay.innerHTML =
            '<div class="tray-edit-box">' +
              '<h4>' + (texts.ams_drying || 'Trocknet') + '</h4>' +
              // Values on the left, AMS image on the right. There used to be
              // nothing on the right -- the image fills the space and shows
              // which device this is. Same image as in the print card
              // (socket-manager.js picks it the same way).
              '<div class="dry-inhalt">' +
                '<div class="dry-werte">' +
                  // Only show the program if it does NOT match what's
                  // sitting in the slots. Otherwise the same info showed up
                  // twice in a row -- once as program, once as slot -- and
                  // nothing said what the difference was (27aug26).
                  (unit.dry_filament && !(unit.trays || []).some(t =>
                      String(t.type || '').toUpperCase() ===
                      String(unit.dry_filament).toUpperCase())
                    ? '<div class="dry-chip"><span class="dry-chip-head">'
                      + (texts.ams_dry_program || 'Programm') + '</span>'
                      + unit.dry_filament + '</div>' : '') +
                  // The spool that dries -- named at the start, or the one
                  // known in the slot (dry_spool, services/drying_spool).
                  (unit.dry_spool
                    ? '<div class="dry-chip"><span class="dry-chip-head">'
                      + (texts.spool || 'Spule') + '</span>'
                      + (unit.dry_spool.color
                        ? '<span class="mz-slot-col" style="background:'
                          + farbe(unit.dry_spool.color) + '"></span>' : '')
                      + esc(this.drySpoolText(unit.dry_spool)) + '</div>' : '') +
                  '<div class="dry-mess">' +
                    (unit.humidity != null
                      ? mess('wasser', 'RH', unit.humidity + ' %') : '') +
                    (unit.temperature != null
                      ? mess('thermo', texts.mz_temp || 'Temp',
                          Math.round(unit.temperature) +
                          (unit.dry_temp ? ' / ' + unit.dry_temp : '') + ' °C') : '') +
                    mess('sanduhr', texts.mz_remaining || 'noch', rest + ' h') +
                    // When it's done -- the clock time says more than the
                    // remaining duration if you're planning your evening. The
                    // printer only reports remaining minutes; we compute the time.
                    mess('uhr', texts.ams_dry_done_at || 'fertig um', fertigUm) +
                  '</div>' +
                  // What's in this unit. During drying that's exactly the
                  // question: which spools are currently loaded in there.
                  ((unit.trays || []).some(drin)
                    ? '<div class="dry-faecher-titel">'
                        + (texts.ams_dry_slots || 'Faecher') + '</div>'
                      + '<div class="dry-faecher">' +
                        (unit.trays || []).filter(drin).map(t =>
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
                  // NOT texts.cancel: "Cancel" would read here like
                  // "cancel drying" -- the button only closes the
                  // window. settings_close exists in every language.
                  (texts.settings_close || 'Schliessen') + '</button>' +
                // tray-edit-danger, NOT tray-edit-save: stop cancels something.
                // The save class is green and would promise the
                // opposite.
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

    /**
     * A drying spool in one line: vendor, material, name -- the material
     * only when the name does not already carry it ("Bambu Lab PETG Black",
     * "Bambulab PLA Matte black"). Android and iOS write it the same way.
     */
    drySpoolText(spool) {
        const s = spool || {};
        const name = String(s.name || '');
        const material = String(s.material || '');
        const parts = [s.vendor,
            material && !name.toLowerCase().includes(material.toLowerCase()) ? material : '',
            name].filter(Boolean);
        return parts.length ? parts.join(' ') : '#' + s.id;
    }

    amsDryStart(amsId) {
        const texts = window.texts || {};
        const unit = ((this.lastState || {}).ams_units || []).find(u => u.id === amsId) || {};

        // If a drying run is already active, NO start form belongs here.
        // Until 27aug26 it appeared anyway: you'd tap the AMS and got the
        // start dialog, even though the device was already drying.
        if (unit.can_dry && (unit.dry_time || 0) > 0) {
            this._amsDryLaeuft(unit);
            return;
        }

        const presets = window.BAMBU_DRY_PRESETS || {};
        const typen = Object.keys(presets);

        // The program the server suggests for this unit: from the roll KNOWN
        // to be in it (RFID, assigned by hand, parked while drying) -- not
        // from the raw tray, which reads empty in exactly those cases
        // (services/filament_db.trocken_vorschlag). Android and iOS take the
        // same field.
        const typ = unit.dry_suggestion;
        // The spool that dries: the server names the one it knows in the
        // unit. It can be chosen in Spoolman and goes with the start -- only
        // for this run, never assigned to the slot: a roll that lies in the
        // unit to turn is not fed, and the printer takes no setting for it
        // (services/drying_spool).
        let spool = unit.dry_spool || null;

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
              // The current value above doesn't answer whether drying is
              // needed -- only the history does that. Loaded afterward.
              '<div class="fk-block" id="dry-gedaechtnis"></div>' +
              '<div class="tray-edit-zeile">' +
                '<span class="tray-edit-label">' + (texts.spool || 'Spule') + '</span>' +
                '<div class="tray-edit-felder">' +
                  '<button type="button" class="tray-edit-spoolknopf" id="dry-spool">' +
                    '<span class="tray-edit-spoolpunkt" id="dry-spool-dot"></span>' +
                    '<span class="tray-edit-spoolname" id="dry-spool-name"></span>' +
                  '</button>' +
                '</div>' +
              '</div>' +
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
              // Rotate while drying -- the same checkbox as on the
              // AMS display. The field used to always go out as false.
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
        // While printing, the lower on_print values apply (ABS 75 instead of 80).
        const druckt = ['RUNNING', 'PREPARE', 'PAUSE']
            .includes(String((window.lastPrintData || {}).gcode_state || '').toUpperCase());
        const fuelle = () => {
            const p = (presets[selTyp.value] || [[55, 8], [55, 8]])[druckt ? 1 : 0];
            inTemp.value = p[0];
            inStd.value = p[1];
        };
        selTyp.addEventListener('change', fuelle);
        fuelle();

        const showSpool = () => {
            const dot = overlay.querySelector('#dry-spool-dot');
            const hex = String((spool || {}).color || '').replace('#', '').slice(0, 6);
            dot.style.background = hex.length === 6 ? '#' + hex : '';
            dot.style.display = hex.length === 6 ? 'inline-block' : '';
            overlay.querySelector('#dry-spool-name').textContent = spool
                ? (this.drySpoolText(spool))
                : (texts.ams_edit_from_spoolman || 'Rolle wählen');
        };
        showSpool();
        overlay.querySelector('#dry-spool').addEventListener('click', () => {
            if (!window.openSpoolPicker) return;
            window.openSpoolPicker({
                gewaehlt: spool ? spool.id : null,
                onWahl: (s) => {
                    if (!s) return;
                    const fil = s.filament || {};
                    spool = { id: s.id, vendor: (fil.vendor || {}).name || '',
                              name: fil.name || '', material: fil.material || '',
                              color: fil.color_hex || '', program: s.dry_program || null };
                    showSpool();
                    // The program follows the spool's material -- the server
                    // says which (dry_program), nothing is worked out here.
                    if (spool.program && presets[spool.program]) {
                        selTyp.value = spool.program;
                        fuelle();
                    }
                },
                // "No spool": dry without naming one.
                onKeine: () => { spool = null; showSpool(); },
            });
        });

        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
        overlay.querySelector('#dry-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#dry-start').addEventListener('click', () => {
            const temp = parseInt(inTemp.value, 10) || 0;
            const std = parseInt(inStd.value, 10) || 0;
            const drehen = !!(overlay.querySelector('#dry-rotate') || {}).checked;
            window.printerAdapter.amsDryStart(amsId, temp, std * 60,
                                              selTyp.value, drehen,
                                              spool ? spool.id : null).then(r => {
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
     * Remember a fixed slot -> Spoolman spool mapping.
     *
     * After that, the server no longer needs to guess by profile names and
     * colors -- with two identical spools from the same manufacturer that
     * never worked out anyway.
     */
    /**
     * Mark slots without a Spoolman mapping in the material card.
     *
     * Since 01sep26 the server no longer maps on a guess -- if the color
     * doesn't match, it stays unassigned. That's correct, but it also has to
     * be visible: without a mapping there's no humidity history for the
     * slot, and before that nobody noticed. Done here instead of in the
     * spool picker, because you look at the home page anyway.
     *
     * Added afterward, not part of the initial build: the humidity data
     * comes from its own request, and the card shouldn't wait on it.
     */
    /**
     * The open questions of the filament state: "which spool is in AMS HT
     * slot 1?" -- as a row under the slots, plus an orange edge on the place
     * itself. Deliberately not a window that opens by itself: that lands in
     * the middle of a print, and nothing about the question is urgent.
     *
     * A contradiction (spool PETG in an ASA slot, R8) is shown the same way.
     * Once it has been accepted on purpose it keeps no question -- it stays
     * visible, and asks nothing any more.
     */
    _zeigeFragen(wrap) {
        const fs = window.filamentState;
        if (!fs || !wrap || !fs.block()) return;
        // Same reason as the card itself: this runs once a second, and the
        // questions change a few times a day. The signature covers what the
        // rows show; renderMaterialZone clears it when it rebuilds wrap,
        // because the rows go with it.
        const sig = JSON.stringify([fs.questions(), fs.conflicts()]);
        if (this._mzFragenSig === sig) return;
        this._mzFragenSig = sig;
        const texts = window.texts || {};
        const esc = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const konfliktText = (k) => (texts.fs_conflict
            || 'Der Drucker meldet {printer}, die Spule ist {spool}.')
            .replace('{printer}', k.printer).replace('{spool}', k.spool);

        wrap.querySelectorAll('.mz-fragen').forEach(e => e.remove());
        const zeilen = [];
        // The rows are the quiet view; the question card in the middle of the
        // page is where a new question announces itself (frage-karte.js).
        fs.questions().forEach(f => {
            // The place itself carries the mark, so the row and the slot
            // point at the same thing.
            const ams = /^ams:(\d+)\/(\d+)$/.exec(f.place);
            const aussen = /^ext:(\d+)$/.exec(f.place);
            const wahl = ams ? '[data-ams="' + ams[1] + '"][data-slot="' + ams[2] + '"]'
                : (aussen ? '[data-ams="' + aussen[1] + '"][data-slot="0"]' : null);
            const feld = wahl ? document.querySelector('.mz-slot' + wahl) : null;
            const konflikt = fs.conflictFor(f.place);
            // R13: after unloading -- reset the external spool, or keep it.
            const abgenommen = f.kind === 'spool_removed';
            // R14: set the proposed profile, or not.
            const vorschlag = f.kind === 'confirm_profile';
            const profilName = f.profile_name || f.profile || '';
            const text = abgenommen
                ? (texts.fs_removed_question || 'Filament ist draußen. {place} zurücksetzen?')
                    .replace('{place}', fs.placeLabel(f.place))
                : vorschlag
                ? (texts.fs_proposal_question || 'Kein eigenes Profil für diese Spule – {name} einstellen?')
                    .replace('{name}', profilName)
                : konflikt ? konfliktText(konflikt)
                // R15: a roll with a chip that no free Spoolman spool fits
                : f.reason === 'not_in_spoolman'
                ? (texts.fs_question_new_spool || 'Neue Spule in {place} erkannt – noch keiner Spoolman-Spule zugewiesen')
                    .replace('{place}', fs.placeLabel(f.place))
                : (texts.fs_question || 'Welche Spule liegt in {place}?')
                    .replace('{place}', fs.placeLabel(f.place));
            if (feld) {
                feld.classList.add('mz-slot--offen');
                feld.title = text;
            }
            const knopf = (aufruf, beschriftung) => '<button type="button" class="mz-frage-knopf" '
                + 'onclick="window.printerControlManager.' + aufruf + '">' + esc(beschriftung) + '</button>';
            const ort = esc(f.place);
            zeilen.push('<div class="mz-frage"><span class="mz-frage-text">' + esc(text) + '</span>'
                + (abgenommen
                    ? knopf('abgenommenAntworten(\'' + ort + '\', true)',
                            texts.spool_prompt_reset || 'Zurücksetzen')
                      + knopf('abgenommenAntworten(\'' + ort + '\', false)',
                              texts.spool_prompt_keep || 'Behalten')
                    : vorschlag
                    ? knopf('vorschlagAntworten(\'' + ort + '\', true)',
                            (texts.fs_proposal_set_button || '{name} einstellen').replace('{name}', profilName))
                      + knopf('vorschlagAntworten(\'' + ort + '\', false)',
                              texts.fs_proposal_skip || 'Nicht einstellen')
                    : knopf('frageBeantworten(\'' + ort + '\')', texts.fs_assign || 'Spule zuordnen'))
                + '</div>');

        });
        fs.conflicts().filter(k => !fs.questionFor(k.place)).forEach(k => {
            zeilen.push('<div class="mz-frage"><span class="mz-frage-text">'
                + esc(konfliktText(k)) + '</span></div>');
        });
        if (zeilen.length) {
            wrap.insertAdjacentHTML('beforeend',
                '<div class="mz-fragen">' + zeilen.join('') + '</div>');
        }
    }

    /**
     * R13: "was the spool taken off?" -- true resets the external spool at
     * the printer (the server waits for its confirmation), false keeps it.
     */
    abgenommenAntworten(schluessel, ja) {
        const texts = window.texts || {};
        window.apiCall('/api/filament/places/' + schluessel + '/removed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ removed: !!ja }),
        }).then(r => r.json()).then(d => {
            if (!d || !d.success) {
                skToast((d && d.error) || texts.connection_error, 'error');
                return;
            }
            if (window.filamentState) window.filamentState.update(d.filament_state);
            this.renderMaterialZone();
            skToast(d.message, 'success');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    /** R14: yes or no to the profile proposed for a place. */
    vorschlagAntworten(schluessel, ja) {
        const texts = window.texts || {};
        window.apiCall('/api/filament/places/' + schluessel + '/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accept: !!ja }),
        }).then(r => r.json()).then(d => {
            if (!d || !d.success) {
                skToast((d && d.error) || texts.connection_error, 'error');
                return;
            }
            if (window.filamentState) window.filamentState.update(d.filament_state);
            this.renderMaterialZone();
            skToast(d.message, 'success');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    /** Answer it: pick a spool from the candidates, or "none of them". */
    frageBeantworten(schluessel) {
        const fs = window.filamentState;
        if (!fs || !window.openSpoolPicker) return;
        const frage = fs.questionFor(schluessel);
        const ort = fs.place(schluessel);
        window.openSpoolPicker({
            // The candidates the server found for this roll (material and
            // colour) are marked in the window.
            treffer: (frage && frage.candidates) || [],
            gewaehlt: (ort && ort.spool) ? ort.spool.id : null,
            onWahl: (spule) => this._antwortSenden(schluessel, spule ? spule.id : null),
            onKeine: () => this._antwortSenden(schluessel, null),
        });
    }

    /** The answer goes to the server; it sends the new state back. */
    _antwortSenden(schluessel, spule) {
        const texts = window.texts || {};
        window.apiCall('/api/filament/places/' + schluessel + '/spool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spool_id: spule }),
        }).then(r => r.json()).then(d => {
            if (!d || !d.success) {
                skToast((d && d.error) || texts.connection_error, 'error');
                return;
            }
            if (window.filamentState) window.filamentState.update(d.filament_state);
            this.renderMaterialZone();
            // What happened at the printer, in the server's words (part 3):
            // set, already matching, chip, or only assigned and why.
            const detail = [d.printer_text, d.hint].filter(Boolean).join(' · ');
            skToast(texts.fs_answer_saved || 'Zuordnung gespeichert', 'success',
                    detail ? { detail } : undefined);
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    /**
     * Report once, not on every status round.
     *
     * Status arrives every few seconds; without a guard the notice would
     * sit in the banner constantly. The guard hangs off the slot and holds
     * as long as the page stays open -- after a reload it's fine for it to
     * show up again, since it was probably missed.
     */
    _meldeOhneZuordnung(amsId, slot, text) {
        this._gemeldeteFaecher = this._gemeldeteFaecher || new Set();
        const schluessel = amsId + ':' + slot;
        if (this._gemeldeteFaecher.has(schluessel)) return;
        this._gemeldeteFaecher.add(schluessel);
        if (window.skToast) window.skToast(text, 'info');
    }

    _merkeSpoolZuordnung(amsId, trayId, spoolId, typ, farbe, name) {
        // Type, color and name go along so the server can still open the
        // dwell time even when the printer reports the slot empty -- the
        // spool is sitting in there but not fed in. In that case, these
        // three values wouldn't be retrievable from the slot.
        window.apiCall('/api/filament/humidity/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ams_id: amsId, slot: trayId, spool_id: spoolId,
                type: typ || '', color: farbe || '', name: name || '',
            }),
        }).then(() => { if (window.amsHumidity) window.amsHumidity.vergiss(); })
          .catch(() => {});
    }

    /**
     * Load humidity history into an already-open AMS dialog.
     *
     * Loaded afterward, not built in from the start: the dialog should be up
     * immediately. If the request fails, the spot just stays empty -- the
     * dialog keeps working without the history.
     *
     * And loaded again while the dialog stands open. A measurement lands
     * every five minutes; the window used to show the state of the moment it
     * was opened and nothing after it -- ten minutes of readings missing on
     * screen while the database had them all (reported 17sep26).
     */
    _feuchteGedaechtnis(overlay, unit) {
        const ziel = overlay.querySelector('#dry-gedaechtnis');
        if (!ziel || !window.amsHumidity) return;
        clearInterval(this._feuchteTakt);
        this._feuchteTakt = setInterval(() => {
            if (!overlay.isConnected) { clearInterval(this._feuchteTakt); return; }
            // The module holds an answer for a minute; without this the
            // refresh would redraw the same points.
            window.amsHumidity.vergiss();
            this._feuchteGedaechtnisZeichnen(overlay, unit);
        }, 60000);
        this._feuchteGedaechtnisZeichnen(overlay, unit);
    }

    /** One drawing pass of the humidity history (see _feuchteGedaechtnis). */
    _feuchteGedaechtnisZeichnen(overlay, unit) {
        const ziel = overlay.querySelector('#dry-gedaechtnis');
        if (!ziel || !window.amsHumidity) return;
        const texts = window.texts || {};
        const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        // Same conversion as in the slot tiles: Bambu delivers the
        // color value as an eight-digit hex WITHOUT a hash mark.
        const farbe = (hex) => {
            const h = String(hex || '').replace('#', '');
            return h ? '#' + h.slice(0, 6) : 'transparent';
        };
        const uhrzeit = (roh) => {
            const d = new Date(String(roh).replace(' ', 'T'));
            return isNaN(d) ? '' : d.toLocaleString(undefined,
                { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        };

        window.amsHumidity.hole(14).then(daten => {
            if (!daten || !overlay.isConnected) return;
            const e = window.amsHumidity.einheit(daten, unit.id);
            const kurve = e ? window.amsHumidity.kurve(e.history, daten.threshold) : '';
            // Which slots hold a roll -- from the state, not from the type.
            // While drying with the roll turning the printer reports the slot
            // empty, and the history of exactly that roll would disappear.
            const steckt = (t) => window.filamentState.hasRoll(window.filamentState.slotKey(unit.id, t.id || 0));
            const faecher = (unit.trays || []).filter(steckt).map(t => {
                const spule = window.amsHumidity.fuerFach(daten, unit.id, t.id);
                if (!spule) return '';
                return '<div class="fk-fach">'
                     + '<span class="mz-slot-col" style="background:'
                     + farbe(t.color) + '"></span>'
                     + '<span class="fk-fach-name">' + esc(t.type || '?') + '</span>'
                     + window.amsHumidity.merkzeile(spule, daten.threshold)
                     + '</div>';
            }).join('');
            const zeit = window.amsHumidity.spanne(e && e.history);
            // Less than half an hour of readings isn't a history, it's just
            // a straight line. Better to say honestly that the recording just
            // started than to fake a curve.
            const frisch = !kurve || zeit.ms < 1800000;
            if (frisch && !faecher) {
                if (!(e && e.history && e.history.length)) return;
                ziel.innerHTML =
                    '<div class="fk-kopf">' + esc(texts.humidity_title || 'Feuchte')
                    + '<span class="fk-schwelle-text">' + esc(
                        (texts.humidity_threshold || 'Grenze {s} %').replace('{s}', daten.threshold))
                    + '</span></div>'
                    + '<div class="fk-frisch">' + esc(
                        (texts.humidity_fresh || 'Aufzeichnung läuft seit {zeit}')
                            .replace('{zeit}', uhrzeit(e.history[0].time))) + '</div>';
                return;
            }
            const letzte = window.amsHumidity.letzteZeit(e && e.history);
            ziel.innerHTML =
                '<div class="fk-kopf">' + esc(texts.humidity_title || 'Feuchte')
                + (zeit.text ? '<span class="fk-spanne">' + esc(zeit.text) + '</span>' : '')
                + (letzte ? '<span class="fk-spanne">' + esc(letzte) + '</span>' : '')
                + '<span class="fk-schwelle-text">' + esc(
                    (texts.humidity_threshold || 'Grenze {s} %').replace('{s}', daten.threshold))
                + '</span></div>' + kurve + faecher;
        }).catch(() => {});
    }

    /**
     * The calibration steps as checkboxes -- the same ones as in Studio's dialog.
     *
     * ONE command with a bitmask (DeviceManager.cpp,
     * command_start_calibration), not one command per step. The server
     * knows the bits; only the names go out here.
     */
    zeichneKalibrierung(caps) {
        const texts = window.texts || {};
        const ziel = document.getElementById('cali-schritte');
        if (!ziel) return;
        const c = caps || {};
        // Order and default selection like in Studio.
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
        if (titel) titel.textContent = texts.cali_steps_title || 'Schritte';
        const reiter = document.getElementById('ctrl-tab-cali-label');
        if (reiter) reiter.textContent = texts.cali_title || 'Kalibrierung';
        const hinweis = document.getElementById('cali-hinweis');
        if (hinweis) hinweis.textContent = texts.cali_hint
            || 'Dauert je nach Auswahl mehrere Minuten. Währenddessen ist kein Druck möglich.';
        this.zeichneKalibrierLaeufe(c);
    }

    /**
     * The calibrations that run as their own firmware G-code.
     *
     * Not part of the bitmask: the printer executes one G-code file each
     * and reports it like a print (stages, progress, FINISH). Which
     * file, the server knows (services/calibration_runs.py) -- only the
     * names go out here.
     */
    zeichneKalibrierLaeufe(caps) {
        const texts = window.texts || {};
        const ziel = document.getElementById('cali-laeufe');
        if (!ziel) return;
        const c = caps || {};
        const titel = document.getElementById('cali-laeufe-titel');
        if (titel) titel.textContent = texts.cali_runs_title || 'Einzelne Läufe';
        const hinweis = document.getElementById('cali-lauf-hinweis');
        if (hinweis) hinweis.textContent = texts.cali_run_hint || '';

        // An offset between two nozzles is a non-issue with a single nozzle.
        const laeufe = [
            ['nozzle_offset_precise', texts.cali_run_nozzle_offset_precise
                || 'Hochpräziser Düsenversatz', !!c.dual_nozzle],
            ['motion_precision', texts.cali_run_motion_precision
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

    /** Start a single run -- with a confirm prompt, since the head moves. */
    startCalibrationRun(name) {
        const texts = window.texts || {};
        if (!name) return;
        const frage = texts.cali_run_confirm || texts.cali_confirm
            || 'Diesen Lauf jetzt starten? Der Drucker fährt dabei und heizt.';
        const los = () => {
            window.printerAdapter.action('start_calibration_run', { name })
                .then(r => {
                    if (r.ok) {
                        skToast(texts.cali_started || 'Kalibrierung gestartet', 'info');
                        setTimeout(() => this.zeichneKalibrierLauf(), 1500);
                    } else {
                        // The server names the reason as a key -- e.g.
                        // guard_needs_pla when no PLA is loaded.
                        skToast(this.fehlerText(r.error, texts.connection_error), 'error');
                    }
                })
                .catch(() => skToast(texts.connection_error, 'error'));
        };
        if (window.showConfirmDialog) window.showConfirmDialog(frage, los);
        else if (window.skConfirm) window.skConfirm(frage).then(ja => { if (ja) los(); });
    }

    /**
     * The running pass: stage, progress, remaining time.
     *
     * A calibration reports itself like a print -- RUNNING, stage changes,
     * FINISH at the end. `systemlauf.py` keeps it out of the history,
     * but it may still be shown, and this is where it belongs.
     */
    zeichneKalibrierLauf() {
        const texts = window.texts || {};
        const ziel = document.getElementById('cali-lauf');
        if (!ziel) return;
        const titel = document.getElementById('cali-lauf-titel');
        if (titel) titel.textContent = texts.cali_run_title || 'Ablauf';

        // Two sources, same field names: the socket (`lastPrintData`)
        // updates faster during a print, /api/status (`lastState`)
        // on the other hand ALWAYS runs -- even for a printer-native job,
        // since half the reporting path is deliberately left out for that
        // (printer_progress_mixin_v2: no push, no FCM). That's why the
        // status wins here whenever it has something to say.
        const pd = Object.assign({}, window.lastPrintData || {}, this.lastState || {});
        const zustand = String(pd.gcode_state || '').toUpperCase();
        const laeuft = ['RUNNING', 'PREPARE'].includes(zustand);
        // Only a SYSTEM run is a calibration; a real print is not.
        const system = pd.is_system_run === true
            || String(pd.print_type || '').toLowerCase() === 'system';

        // Lock the start button while the printer is moving -- whether
        // calibration or a real print. The server rejects exactly the same
        // three states (action_guards `_KALIBRIEREN`); a button that only
        // produces an error message shouldn't be offered. The
        // checkboxes stay usable: preparing the selection for the next
        // pass is fine to do in the meantime.
        const gesperrt = !window.aktionen.erlaubt('calibrate');
        const warum = window.aktionen.text('calibrate');
        document.querySelectorAll('.cali-lauf-btn').forEach(b => {
            b.disabled = gesperrt;
            if (gesperrt) b.title = warum; else b.removeAttribute('title');
        });
        const knopf = document.getElementById('cali-start');
        if (knopf) {
            knopf.disabled = gesperrt;
            if (gesperrt) knopf.title = warum; else knopf.removeAttribute('title');
            knopf.textContent = gesperrt && system
                ? (texts.cali_running || 'Kalibrierung läuft')
                : (texts.cali_start || 'Kalibrierung starten');
        }

        if (!laeuft || !system) {
            ziel.innerHTML = `<div class="ext-sub">${
                (texts.cali_no_run || 'Gerade läuft keine Kalibrierung.')}</div>`;
            return;
        }
        const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g,
            ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        const anteil = Math.max(0, Math.min(100, Math.round(pd.progress || 0)));
        const rest = pd.remaining_time > 0
            ? (texts.cali_rest || 'noch {n} min').replace('{n}', Math.round(pd.remaining_time))
            : '';
        // Which step is currently running -- three sources, in this order:
        //
        //   stage_description  Bambu. The server already translates the stage
        //                      number (stg_cur) itself, ui_handler puts it in
        //                      the print data. ONLY this one knows "Auto Bed
        //                      Leveling" or "calibrate nozzle offset".
        //   stage_code         Klipper. There are no stage numbers there,
        //                      only keys that the client translates.
        //   status_text        Fallback. Just says "Preparing" -- that
        //                      used to sit here through the entire
        //                      calibration until 28aug26, because stage_code
        //                      is empty on Bambu and the first source was missing.
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

    /** Collect the selection, confirm, send it off. */
    startCalibration() {
        const texts = window.texts || {};
        const gewaehlt = Array.from(document.querySelectorAll('.cali-box:checked'))
            .map(b => b.value);
        if (!gewaehlt.length) {
            skToast(texts.cali_no_choice || 'Kein Schritt gewählt', 'warning');
            return;
        }
        // The head moves and the bed heats -- ask before doing that.
        const frage = texts.cali_confirm
            || 'Kalibrierung jetzt starten? Der Drucker fährt dabei und heizt.';
        const los = () => {
            window.printerAdapter.action('start_calibration', { schritte: gewaehlt })
                .then(r => {
                    if (r.ok) {
                        skToast(texts.cali_started || 'Kalibrierung gestartet', 'info');
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
            else if (window.amsHumidity) window.amsHumidity.vergiss();
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

        // Set the two extruder side labels from the translations right away.
        // Their text lives in the template as "Links ✓" / "Rechts (Aux)" and
        // was only ever replaced by extSelectSide() -- which runs on a CLICK.
        // Anyone who just looked at the tab saw German, in every language
        // (01sep26, seen on the English test system).
        try { this.extSelectSide(this._extSide === 0 ? 0 : 1); } catch (e) {}

        // Pull a fresh status immediately instead of waiting for the 8s
        // cadence -- otherwise the device tab often opens half-empty
        // (panels depend on capabilities + device_report) and had to be reopened.
        window.apiCall('/api/status')
            .then(r => r.json())
            .then(d => this.applyStatusPayload(d))
            .catch(() => {});

        // Jump straight to the requested tab (e.g. movement card -> axes).
        // Without one: Bambu starts on overview, Klipper on movement.
        if (tab) {
            this.switchControlTab(tab);
            this.updateOverviewTab();
        } else if (document.body.dataset.activePrinter !== 'klipper') {
            this.switchControlTab('ctrlov');
            this.updateOverviewTab();
        } else {
            // Klipper opens on movement. That used to happen through the
            // markup alone, so switchControlTab never ran and the map was
            // never drawn -- say it out loud instead.
            this.switchControlTab('movement');
        }

        // Safari (and the home-screen app): the modal fills the screen
        if (window.isSafari) {
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

        // Homing check removed - X/Y homing happens automatically in the backend on filament load/unload
        this.modalHomingDone = true;
        this.enableAllControlButtons();

        // Camera source setup
        const savedSource = localStorage.getItem('controlCameraSource') || 'p1s';
        this.currentControlCameraSource = savedSource;

        // Set the camera source -- Klipper uses the Klipper cams already
        // cached in the main image (proxy URL), Bambu/uStreamer as before.
        const img = document.getElementById('control-camera');
        const sourceBtn = document.getElementById('control-camera-source');
        if (img) {
            // Preview per contract: camera-manager decides
            // (WebRTC second sink, 1-fps snapshots, or Klipper cam).
            if (window.cameraManager && window.cameraManager.attachControlPreview) {
                window.cameraManager.attachControlPreview();
                if (sourceBtn && window.isKlipperMode && window.isKlipperMode()) {
                    const s = ((window.cameraManager._klipperSources || [])[window.cameraManager._klipperSourceIdx || 0]) || {};
                    sourceBtn.innerHTML = window.skIcon('kamera', 'hd-ic--xs') + ' <span></span>';
            sourceBtn.querySelector('span').textContent = s.label || s.id || '';
                }
            }
        }

        // Camera refresh interval + live temperature refresh (Klipper state
        // lands in window.activePrinter.state every ~2s, we read from there)
        if (this.controlCameraInterval) {
            clearInterval(this.controlCameraInterval);
        }

        const self = this;
        this.controlCameraInterval = setInterval(function() {
            // The Klipper cam is a continuous stream, the Bambu preview polls
            // itself -- the old mode-blind 2s refresh kept the MJPEG pipeline awake.
            if (window.isKlipperMode && window.isKlipperMode()) {
                self.updateExtruderTemp();
            }
        }, 2000);

        // Klipper-Direct: fill the three tabs with Mainsail control
        // (axes/extruder/machine -- parity with the Android app). Bambu
        // stays with the existing D-pad layout from the HTML.
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
        // Insert the warning into every tab
        const tabs = ['movement-tab', 'extruder-tab', 'filament-tab'];
        tabs.forEach(tabId => {
            const tab = document.getElementById(tabId);
            if (tab) {
                // Remove old warning if present
                const oldWarning = tab.querySelector('.homing-warning');
                if (oldWarning) oldWarning.remove();

                // New compact warning with two buttons
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

        // Disable buttons
        this.disableAllControlButtons();
    }

    // ========================================
    // skipHoming
    // ========================================
    skipHoming() {
        const texts = window.texts || {};
        // Until 21aug26 there was a second branch here for `window.isIOSApp`
        // that drew its own message at the bottom center. Nobody sets that
        // flag -- and messages go through skToast anyway.
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

        // End the modal preview (stop snapshot polling / release the second sink)
        if (window.cameraManager && window.cameraManager.detachControlPreview) {
            window.cameraManager.detachControlPreview();
        }
        // Stop the camera refresh
        if (this.controlCameraInterval) {
            clearInterval(this.controlCameraInterval);
            this.controlCameraInterval = null;
        }
        if (this.klipperPollInterval) {
            clearInterval(this.klipperPollInterval);
            this.klipperPollInterval = null;
        }
    }

    // DEPRECATED: homing check removed entirely
    // X/Y homing now happens automatically in the backend on filament load/unload (G28 X Y)
    // The functions checkHomingStatus(), performControlHoming() and skipControlHoming() were removed.

    // ========================================
    // updateOverviewTab — fill the display overview cards
    // ========================================
    updateOverviewTab() {
        const texts = window.texts || {};
        const st = this.lastState || {};
        const pd = window.lastPrintData || {};
        // Two variants of the same cards: 'ov-*' in the control window,
        // 'mz-*' in the printer zone of the main page.
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

        // Labels (set writes both ov-* AND mz-*)
        set('ctrl-tab-overview-label', texts.ov_tab || 'Übersicht');
        const direkt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        direkt('mz-title', texts.mz_printer_zone || 'Drucker');
        direkt('mz-mat-title', texts.mz_material_zone || 'Material');
        // "Stand" as the zone's only label was NOT in this list and
        // therefore stayed German in every language (01sep26).
        direkt('mz-nozzle-label', texts.mz_nozzle_zone || 'Düse & Extruder');
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

        // Airduct: 0 cooling, 1 heating -- named the same as on the display
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
        // Bed from the status state -- lastPrintData only fills Klipper.
        set('ov-bed-value', grad(st.bed_temp != null ? st.bed_temp : pd.bed_temp,
                                 st.bed_target != null ? st.bed_target : pd.bed_target));

        // The light buttons (overview + camera image) are set by the adapter
        // from the printer_state event -- /api/status carries no light_on.
    }

    // ========================================
    // renderMaterialZone — AMS/HT + external spools on the main page
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
        // K value (pressure advance) of the loaded filament. The printer
        // reports it per slot; it belongs to the filament, not the device --
        // that's why it's shown on the active slot and nowhere else.
        // From `hardware`, no longer from `filament`: that block has been
        // gone since 30aug26. It mirrored Bambu's `vt_tray`, and the X2D
        // never sends that — so it only ever delivered default values,
        // among them k_factor = 0. Because 0 is not null, the fallback
        // to here never took effect anyway.
        const kRoh = st.hardware && st.hardware.k_factor;
        const kZahl = parseFloat(kRoh);
        const kWert = (isFinite(kZahl) && kZahl > 0) ? kZahl.toFixed(3) : '';

        // One slot of the card -- everything from the filament state: whether
        // a roll is in, what it holds, whether a nozzle pulls from it, whether
        // it is parked or blocked. `spoolman` names the active spool's name
        // and fill level where Spoolman knows them better than the printer.
        const fs = window.filamentState;
        const slot = (schluessel, onclick, seite, kennung, spoolman) => {
            const ort = fs.place(schluessel) || {};
            const inhalt = fs.hasRoll(schluessel) ? (ort.content || {}) : {};
            const leer = !fs.hasRoll(schluessel);
            const aktiv = fs.feeding(schluessel) != null;
            // Parked (R10): the slot reports empty while its unit dries with
            // the roll turning. The roll is in there -- and says why.
            const geparkt = fs.isParked(schluessel);
            // R11: an AMS takes this external spool's nozzle inlet -- nothing
            // can feed from it, so it says so and cannot be edited.
            const sperre = fs.blockedBy(schluessel);
            const nameSpule = (aktiv && spoolman && spoolman.name) || inhalt.name;
            const restZahl = (aktiv && spoolman && spoolman.remain) ? spoolman.remain : inhalt.remain;
            const rest = (!leer && restZahl != null && restZahl > 0) ? restZahl + '%' : '';
            const name = sperre
                ? (seite ? seite + ' · ' : '') + (texts.fs_place_blocked || 'Belegt durch {unit}')
                    .replace('{unit}', sperre.model || 'AMS')
                : leer
                ? (seite ? seite + ' · ' : '') + (fs.isEmpty(schluessel) ? (texts.ams_empty || 'leer') : '?')
                : [seite, inhalt.material || '?', geparkt ? (texts.fs_parked || 'trocknet') : nameSpule]
                    .filter(Boolean).join(' · ');
            const k = (aktiv && kWert && !leer)
                ? '<span class="mz-slot-k" title="' + (texts.k_factor_hint || 'Pressure Advance') + '">K ' + kWert + '</span>'
                : '';
            const kenn = kennung
                ? ' data-ams="' + kennung.ams + '" data-slot="' + kennung.slot + '"'
                : '';
            return '<div class="mz-slot' + (aktiv && !sperre ? ' mz-active-slot' : '')
                + (leer ? ' mz-slot--leer' : '')
                + (sperre ? ' mz-slot--gesperrt' : '')
                + (fs.isLastSeen() ? ' mz-slot--gesehen' : '') + '"' + kenn +
                (onclick && !sperre ? ' onclick="' + onclick + '"' : '') + '>' +
                '<span class="mz-slot-col" style="background:'
                + (leer || sperre ? 'transparent' : farbe(inhalt.color)) + '"></span>' +
                '<span class="mz-slot-name">' + name + '</span>' + (sperre ? '' : k) +
                '<span class="mz-slot-pct">' + (sperre ? '' : rest) + '</span></div>';
        };

        // AMS units (incl. AMS HT).
        const units = st.ams_units || [];
        // Model name into the card heading. With EXACTLY one unit,
        // "AMS HT" is better placed there than at the start of every header
        // row -- it doesn't repeat and makes room in the row that the
        // drying info needs. Multiple units keep their
        // name in the row, otherwise it wouldn't be clear which one is meant.
        const matTitel = document.getElementById('mz-mat-title');
        const einzeln = units.length === 1 && units[0].model;
        if (matTitel) {
            if (!matTitel.dataset.standard) matTitel.dataset.standard = matTitel.textContent;
            // "Material (AMS HT)" -- the model name SUPPLEMENTS the heading,
            // it doesn't replace it. Otherwise a quick glance no longer
            // shows that this is the material card.
            matTitel.textContent = einzeln
                ? matTitel.dataset.standard + ' (' + units[0].model + ')'
                : matTitel.dataset.standard;
        }

        let html = '';
        units.forEach(u => {
            const kopf = einzeln ? [] : [u.model || 'AMS'];
            const trocknetJetzt = u.can_dry && (u.dry_time || 0) > 0;
            // Two measurement columns just like on the AMS display itself:
            // icon and abbreviation on top, the value below.
            //
            //     💧 RH        🌡 Temp
            //     19 %         81 °C
            //
            // Everything used to be on one line ("21% humidity · 81°"); the
            // word got wedged between two numbers and stuck to the wrong
            // one -- it read as "humidity 81" (27aug26).
            const mess = (zeichen, kuerzel, wert) =>
                '<div class="mz-mess"><div class="mz-mess-kopf">'
                + window.skIcon(zeichen, 'hd-ic--xs') + ' ' + kuerzel
                + '</div><div class="mz-mess-wert">' + wert + '</div></div>';
            if (u.humidity != null) {
                kopf.push(mess('wasser', 'RH', u.humidity + ' %'));
            }
            if (u.temperature != null) {
                // During drying, actual/target like everywhere else in the
                // app (nozzle 140°/140°, bed 110°/110°). Only side by side
                // can you see whether the program has reached its target --
                // as its own row the number was just clutter.
                const ist = Math.round(u.temperature);
                kopf.push(mess('thermo', texts.mz_temp || 'Temp',
                    (trocknetJetzt && u.dry_temp)
                        ? ist + ' / ' + u.dry_temp + ' °C'
                        : ist + ' °C'));
            }
            // If drying is running (dry_time = remaining minutes), the zone
            // shows program + remaining time and a stop button instead of "dry".
            //
            // The drying info gets its OWN row under the header. In a
            // shared row, two temperature values collided --
            // "AMS HT · 32% humidity · 68°" and next to it "Drying ASA 80° ·
            // 7:58 h". When wrapped, that read as "humidity 68" (27aug26).
            const trocknet = u.can_dry && (u.dry_time || 0) > 0;
            let trockenZeile = '';
            let restZeile = '';
            if (trocknet) {
                const rest = Math.floor(u.dry_time / 60) + ':' + String(u.dry_time % 60).padStart(2, '0');
                // Program and target in one row, remaining time in its
                // own row underneath -- otherwise the stop button pushed
                // itself into a row of its own and left half the card empty.
                // No filament name: that already shows in the slot below. No
                // target: that now shows as the target value next to the
                // actual value. What's left is what's stated nowhere else --
                // that drying is happening and for how much longer.
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
            // If the unit is drying, the stop button moves along into the
            // drying row -- it belongs there, not in the header.
            // No more standalone thermometer icon: now that every number
            // carries its own label, the icon explains nothing and just
            // stood in the way.
            // The measurement columns have their own spacing -- no dot
            // between them. Only when the model name comes first (multiple
            // units), it stays set off by a dot.
            const kopfHtml = einzeln
                ? kopf.join('')
                : kopf[0] + ' · ' + kopf.slice(1).join('');
            // Button in its own column on the right, centered across BOTH
            // text rows. When it sat in the drying row, it stuck to its
            // baseline and looked misaligned.
            html += '<div class="mz-unit"><div class="mz-unit-top">' +
                '<div class="mz-unit-links">' +
                '<div class="mz-unit-head">' + kopfHtml + '</div>' +
                (trocknet ? '<div class="mz-unit-dry">' + trockenZeile + '</div>' : '') +
                '</div>' + dryBtn + '</div>';
            (u.trays || []).forEach(t => {
                html += slot(fs.slotKey(u.id, t.id || 0), "amsEditTray(" + u.id + "," + (t.id || 0) + ")",
                             null, { ams: u.id, slot: t.id || 0 });
            });
            html += '</div>';
        });
        // Not live: say since when. Without this the card showed the last
        // values of a printer that had been off for hours as if they were
        // current -- nothing on this page said otherwise.
        if (fs.isLastSeen()) {
            const zeit = fs.seenAt();
            const text = (texts.fs_last_seen || 'Zuletzt gesehen {time}').replace(
                '{time}', zeit ? zeit.toLocaleTimeString(undefined,
                    { hour: '2-digit', minute: '2-digit' }) : '');
            html = '<div class="mz-gesehen">' + window.skIcon('uhr', 'hd-ic--xs')
                + '<span>' + String(text).replace(/</g, '&lt;') + '</span></div>' + html;
        }

        // Only write when it really differs.
        //
        // This runs on every status push -- once a second while a print is
        // going (measured 17sep26: 0.9 pushes a second). Slots and spools
        // stand still for minutes at a time, but rebuilding the HTML tore
        // down and rebuilt the card's DOM every single time, and the window
        // plus the GPU process spent about 9 % of a core on redrawing it.
        // The string is built either way -- that is cheap; what costs is
        // layout, paint and composite.
        if (this._mzHtml !== html) {
            this._mzHtml = html;
            wrap.innerHTML = html;
            // The question rows live inside wrap and went with it.
            this._mzFragenSig = null;
        }

        // External spools: 254 left, 255 right. Active = a nozzle pulls from it.
        const spools = rep.spools || [];
        const zeile = document.getElementById('mz-spools');
        const titel = document.getElementById('mz-spools-title');
        // Name + fill level of the ACTIVE spool come from Spoolman -- the
        // printer knows neither the name nor the remaining amount for third-party spools.
        const smName = (document.getElementById('spool-name') || {}).textContent || '';
        const smPct = ((document.getElementById('spool-percent') || {}).textContent || '').trim();
        if (zeile) {
            const spoolHtml = spools.map(sp => {
                const id = parseInt(sp.id, 10);
                // Click = filament editor, same as for the AMS slots.
                return slot(fs.externalKey(id), 'amsEditTray(' + id + ',0)', id === 254 ? 'L' : 'R',
                            { ams: id, slot: 0 },
                            { name: smName, remain: smPct ? parseInt(smPct, 10) : null });
            }).join('');
            if (this._mzSpoolsHtml !== spoolHtml) {
                this._mzSpoolsHtml = spoolHtml;
                zeile.innerHTML = spoolHtml;
            }
            if (titel) {
                titel.style.display = spools.length ? '' : 'none';
                titel.textContent = texts.dev_spools || 'Externe Spulen';
            }
        }

        // The open questions of the state, below everything it asks about.
        this._zeigeFragen(wrap);

        // System bar: light/MQTT state as ring/color
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

    /** Tabs that need a printer answering, locked while none is.
     *
     *  Axes, extruder, filament and calibration all end in a command to the
     *  machine. With the printer off they offer something that cannot happen,
     *  and the failure only shows up as a toast after the click. Overview and
     *  device stay open -- they show what is known, they do not act.
     *
     *  The state comes from `window.druckerDa`, the one place that already
     *  weighs socket against live connection. Where it says nothing -- no
     *  socket configured, nothing heard yet -- nothing is locked: unreachable
     *  is not the same as off, and locking on a hunch takes the machine away
     *  from someone who can still reach it.
     */
    sperreTabsWennAus() {
        if (typeof window.druckerDa !== 'boolean') return;
        const aus = window.druckerDa === false;
        const betroffen = ['movement', 'extruder', 'filament', 'cali'];
        const texts = window.texts || {};
        let aktivGesperrt = false;

        betroffen.forEach(name => {
            const knopf = document.querySelector(`.ctrl-tab[data-tab="${name}"]`);
            if (!knopf) return;
            knopf.disabled = aus;
            knopf.classList.toggle('ctrl-tab--aus', aus);
            if (aus) knopf.title = texts.tab_needs_printer || 'Drucker ist aus';
            else knopf.removeAttribute('title');
            if (aus && knopf.classList.contains('active')) aktivGesperrt = true;
        });

        // Standing in a tab that just got locked would leave dead controls on
        // screen. Move to one that still has something to say.
        if (aktivGesperrt) {
            const uebersicht = document.querySelector('.ctrl-tab[data-tab="ctrlov"]');
            const sichtbar = uebersicht && uebersicht.offsetParent !== null;
            this.switchControlTab(sichtbar ? 'ctrlov' : 'device');
        }
    }

    // ========================================
    // switchControlTab
    // ========================================
    switchControlTab(tab) {
        // The lock above only greys the button out. This is the bolt behind
        // it -- switchControlTab is global and reachable without the button.
        const knopf = document.querySelector(`.ctrl-tab[data-tab="${tab}"]`);
        if (knopf && knopf.disabled) return;

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

        // Fill freshly shown tabs from lastState right away -- the renderers
        // bail out on invisible tabs (offsetParent guard); without this
        // call the content would only arrive with the next 8s status cycle.
        if (tab === 'device') this.refreshDeviceFans();
        if (tab === 'cali') {
            this.zeichneKalibrierung((this.lastState || {}).capabilities);
            this.zeichneKalibrierLauf();
        }
        if (tab === 'filament') this.renderFilamentSlots();
        if (tab === 'extruder') this.updateExtruderTab();
        if (tab === 'ctrlov') this.updateOverviewTab();
        // The map is the default view of this tab, and it has to be DRAWN --
        // the markup only makes its container visible. This also fetches the
        // bed size and puts the homing lock on screen before the first click
        // can happen.
        if (tab === 'movement' && window.setMovementView) window.setMovementView('map');
    }

    // ========================================
    // jogAxis — wheel/column with fixed steps (display style)
    // ========================================
    jogAxis(axis, distance) {
        const texts = window.texts || {};
        if (!window.aktionen.erlaubt('move')) {
            skToast(window.aktionen.text('move'), 'warning');
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
    // Extruder tab: side selection + display
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
        // Sync the loading side for filament actions: 1=left→254, 0=right→255
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

        // "Off" is the only translatable text in the quick setting --
        // PLA, PETG and ABS are named the same everywhere.
        const ausKnopf = document.getElementById('ext-temp-off');
        if (ausKnopf) ausKnopf.textContent = (window.texts || {}).temp_off || 'Aus';

        // Activate the nozzle (select_extruder) -- dual nozzle only. If the
        // selected side is already active, the button just shows that.
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

    /** Activate the selected nozzle on the printer (select_extruder;
     *  0 = right, 1 = left — Bambu's counting). */
    /** Target temperature of the SELECTED side, starting point for stepping. */
    _extSollTemp() {
        const st = this.lastState || {};
        const seite = this._extSide != null ? this._extSide : 0;
        const ziele = st.nozzle_targets || {};
        const wert = ziele[seite];
        return (wert != null && !isNaN(wert)) ? Math.round(wert) : 0;
    }

    /** Adjust by `delta`. Debounces briefly so not every click sends a request. */
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

    /** Set the target temperature — for the side selected above.
     *
     * The server activates the nozzle first: otherwise the printer
     * silently discards the command, and in front of the inactive nozzle
     * sits the mechanical drip guard, which you don't want to heat along with it.
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
        // A nozzle switch is a movement of the tool head, and it belongs to
        // the extruder group in the server's table.
        if (!window.aktionen.erlaubt('extruder')) {
            skToast(window.aktionen.text('extruder'), 'warning');
            return;
        }
        const seite = this._extSide != null ? this._extSide : 0;
        window.printerAdapter.selectExtruder(seite).then(r => {
            if (!r.ok) skToast(this.fehlerText(r.error, texts.connection_error), 'error');
            else skToast(texts.toast_nozzle_switching || 'Düse wird gewechselt…', 'info');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    // ========================================
    // Filament tab: slots — click selects the target side
    // ========================================
    renderFilamentSlots() {
        const wrap = document.getElementById('fil-slots');
        if (!wrap || wrap.offsetParent === null) return;
        const texts = window.texts || {};
        const st = this.lastState || {};
        const rep = st.device_report || {};
        const spools = rep.spools || [];
        const gewaehlt = (document.getElementById('ctrl-nozzle') || {}).value || '254';
        // The default side (left) may be the one an AMS blocks (R11): then
        // the first usable external spool is the target.
        const fsZiel = window.filamentState;
        if (!this._filZiel && fsZiel && fsZiel.blockedBy
                && fsZiel.blockedBy(fsZiel.externalKey(parseInt(gewaehlt, 10)))) {
            const frei = spools.map(s => parseInt(s.id, 10))
                .find(i => !fsZiel.blockedBy(fsZiel.externalKey(i)));
            if (frei != null) this._filZiel = { ams: frei, slot: 0 };
        }

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
                // Click = target selection for load/unload (editing is on
                // the main page) -- loading used to ALWAYS go out as an
                // external spool and the printer demanded manual intervention.
                const aktiv = ziel.ams === u.id && ziel.slot === (t.id || 0);
                const schluessel = window.filamentState.slotKey(u.id, t.id || 0);
                const inhalt = window.filamentState.hasRoll(schluessel)
                    ? ((window.filamentState.place(schluessel) || {}).content || {}) : {};
                const bezeichnung = window.filamentState.isEmpty(schluessel)
                    ? (texts.ams_empty || 'leer')
                    : [inhalt.material || '?', inhalt.name].filter(Boolean).join(' · ');
                html += '<div class="mz-slot' + (aktiv ? ' mz-ziel-slot' : '') + '"' +
                    ' onclick="filSelectTray(' + u.id + ',' + (t.id || 0) + ')">' +
                    '<span class="mz-slot-col" style="background:' + farbe(inhalt.color) + '"></span>' +
                    '<span class="mz-slot-name">' + bezeichnung + '</span>' +
                    (aktiv ? '<span class="mz-ziel-check">✓</span>' : '') +
                    '<button class="mz-edit-btn" title="Filament" ' +
                        'onclick="event.stopPropagation();amsEditTray(' + u.id + ',' + (t.id || 0) + ')">✎</button>' +
                    '</div>';
            });
        });
        if (spools.length) {
            html += '<div class="mz-sec">' + (texts.dev_spools || 'Externe Spulen') + '</div><div class="mz-spool-row">';
            const fs = window.filamentState;
            html += spools.map(sp => {
                const id = parseInt(sp.id, 10);
                const seite = id === 254 ? 'L' : 'R';
                // R11: an AMS takes this spool's nozzle inlet -- nothing to
                // load, unload or edit there, as in the material card.
                const sperre = fs.blockedBy(fs.externalKey(id));
                // Selected only when no AMS slot is the target.
                const aktiv = !sperre && (ziel.ams != null
                    ? (ziel.ams === id)
                    : String(id) === String(gewaehlt));
                if (sperre) {
                    return '<div class="mz-slot mz-slot--gesperrt">' +
                        '<span class="mz-slot-col" style="background:transparent"></span>' +
                        '<span class="mz-slot-name">' + seite + ' · ' + (texts.fs_place_blocked || 'Belegt durch {unit}')
                            .replace('{unit}', sperre.model || 'AMS') + '</span></div>';
                }
                const schluessel = fs.externalKey(id);
                const inhalt = fs.hasRoll(schluessel) ? ((fs.place(schluessel) || {}).content || {}) : {};
                return '<div class="mz-slot' + (aktiv ? ' mz-ziel-slot' : '') + '" onclick="filSelectSpool(' + id + ')">' +
                    '<span class="mz-slot-col" style="background:' + farbe(inhalt.color) + '"></span>' +
                    '<span class="mz-slot-name">' + seite + ' · ' + (fs.isEmpty(schluessel)
                        ? (texts.ams_empty || 'leer') : (inhalt.material || '?')) + '</span>' +
                    (aktiv ? '<span class="mz-ziel-check">✓</span>' : '') +
                    '<button class="mz-edit-btn" title="Filament" ' +
                        'onclick="event.stopPropagation();amsEditTray(' + id + ',0)">✎</button>' +
                    '</div>';
            }).join('');
            html += '</div>';
        }
        // Same as the material card: only write when it differs. The tab is
        // redrawn on every status push while it stands open.
        if (this._filHtml !== html) {
            this._filHtml = html;
            wrap.innerHTML = html;
        }
        const hint = document.getElementById('fil-hint');
        if (hint) hint.textContent = texts.fil_pick_hint || 'Fach antippen = Zielseite für Laden/Entladen';

        // The routine running on a nozzle, from the filament state: its step
        // and whether it loads or unloads.
        const laufend = window.filamentState.routine();

        // Load, unload and purge follow the server's table -- it knows the
        // print, the running routine and the calibration, and it refuses the
        // same call if a button is pressed anyway.
        const gesperrt = !window.aktionen.erlaubt('filament');
        const warumFil = window.aktionen.text('filament');
        document.querySelectorAll('.fil-abtn').forEach(b => {
            b.disabled = gesperrt;
            if (gesperrt) b.title = warumFil; else b.removeAttribute('title');
        });

        // The load button says what's currently happening -- the same
        // thing the printer shows on its screen. As long as nothing is
        // running, it says "Load" again. The step belongs on the button the
        // user pressed (during unload it otherwise said "Load", 25aug26); a
        // routine started at the printer or in Studio names its side itself.
        let seite = this._filLaufAktion;
        if (!seite && laufend) seite = laufend.action;
        if (!laufend) this._filLaufAktion = null;

        const namen = texts.fil_steps || {};
        [['control-load', 'load', texts.load],
         ['control-unload', 'unload', texts.unload]].forEach(([id, welche, standard]) => {
            const el = document.getElementById(id);
            if (!el) return;
            const aktiv = !!laufend && seite === welche;
            el.textContent = aktiv ? (namen[laufend.step] || standard) : standard;
            // The button is locked in the meantime -- but greyed out it
            // would be hardest to read exactly when it says the most.
            // Hence its own state: not clickable, but clearly visible.
            const knopf = el.closest('button');
            if (knopf) knopf.classList.toggle('fil-abtn--laeuft', aktiv);
        });

        // The printer's confirm prompt: "did filament come out?" It reports
        // it as print_error in the MQTT report. The filament step doesn't
        // work as a trigger -- during the prompt it showed step 6
        // (GRAB_NEW_FILAMENT), not 8. The server passes it through as
        // `filament_dialog`, complete with the printer's own text.
        //
        // Don't compose the text ourselves: the printer even names the
        // buttons in it ("Done" / "Try again").
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

    // AMS slot as target -- loading then goes out as an AMS process
    // (target = unit/tray as in Studio), not as an external spool.
    filSelectTray(amsId, slotId) {
        this._filZiel = { ams: amsId, slot: slotId };
        this.renderFilamentSlots();
    }

    // ========================================
    // moveAxis
    // ========================================
    moveAxis(axis, distance) {
        const texts = window.texts || {};
        // The window is reachable during a print too (since the overview tab
        // exists), so the axes have to be locked -- the server says when.
        if (!window.aktionen.erlaubt('move')) {
            skToast(window.aktionen.text('move'), 'warning');
            return;
        }
        // NEW: safety check
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

        // Pre-check: Klipper needs homing for relative moves. If the
        // axis isn't in homed_axes, we skip the backend call
        // and say directly "home first". (Bambu doesn't report homed_axes,
        // the check doesn't apply there -- Bambu allows moves without homing.)
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
                    const warning = document.getElementById('homing-warning');
                    if (warning) warning.style.display = 'none';
                    skToast(texts.toast_homing_completed, 'success');
                }, 3000);
            } else {
                skToast(this.fehlerText(r.error, texts.error), 'error');
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
        // The old Bambu id no longer exists in the new extruder tab --
        // the /api/status cycle updates the display via updateExtruderTab.
        const alt = document.getElementById('extruder-target');
        if (alt) alt.textContent = temp + '°C';
        // Dual nozzle: address the side selected in the extruder tab,
        // not the currently active one (native set_nozzle_temp in the backend).
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
        // Klipper: current temperature comes directly from the live state
        // (the printer_state event has nozzle_temp/nozzle_target). Bambu uses
        // the HA sensor endpoint, since Bambu's MQTT fields are mirrored via HA.
        if (window.isKlipperMode && window.isKlipperMode()) {
            // Klipper control builds the extruder tab with its own IDs (kctrl-*);
            // the old Bambu IDs don't exist here → set null-safely.
            const s = window.activePrinter && window.activePrinter.state;
            if (s) {
                const cur = document.getElementById('kctrl-etemp');
                const tgt = document.getElementById('kctrl-etarget');
                if (cur && s.nozzle_temp != null) cur.textContent = Math.round(s.nozzle_temp) + '°C';
                if (tgt && s.nozzle_target != null) tgt.textContent = Math.round(s.nozzle_target) + '°C';
            }
            return;
        }

        // Bambu -- the new extruder tab (ext-bigtemp & co.) reads from
        // lastState; the /api/status cycle keeps it current. The old
        // HA sensor lookup wrote into IDs that no longer exist
        // (extruder-temp-display) and crashed with null.textContent.
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
    // Nozzle selection
    // ========================================
    //
    // Dual-nozzle devices have TWO external spools. They're addressed
    // via ams_id: 254 = left (main) nozzle, 255 = right. Single-nozzle
    // devices only know 255.
    //
    // null means "nothing to select" -- then the parameter isn't even
    // sent. Klipper knows neither AMS nor two nozzles and doesn't
    // accept it.
    selectedAmsId() {
        // Since the display redesign, side selection runs through the slots
        // in the filament tab (and the side selector in the extruder tab) --
        // the select is now only the invisible value store. Visibility must
        // therefore NO LONGER be a criterion, or load/unload goes out without a side.
        if (!this._dualNozzle) return null;
        const sel = document.getElementById('ctrl-nozzle');
        const v = sel ? parseInt(sel.value, 10) : NaN;
        return Number.isFinite(v) ? v : null;
    }

    /** Now only remembers whether there are two nozzles — the raw selection stays hidden. */
    applyNozzleSelector(caps) {
        this._dualNozzle = !!(caps && caps.dual_nozzle);
    }

    // ========================================
    // loadFilament
    // ========================================
    /** Translate server guard keys (guard_*) into plain text. */
    fehlerText(fehler, sonst) {
        const texts = window.texts || {};
        return texts[fehler] || fehler || sonst;
    }

    /** Is there any filament in a nozzle at all? (for unload/purge) */
    filamentGeladen() {
        return window.filamentState.nozzleLoaded();
    }

    /** Is the selected target (slot/spool) without a roll? */
    zielLeer(ziel) {
        if (ziel.ams == null) return false;
        const fs = window.filamentState;
        return !fs.hasRoll(ziel.ams >= 254 ? fs.externalKey(ziel.ams)
                                           : fs.slotKey(ziel.ams, ziel.slot || 0));
    }

    loadFilament() {
        const texts = window.texts || {};
        const btn = event.target.closest('button');
        this.showButtonFeedback(btn);
        const reset = () => this.resetButtonFeedback(btn);
        // The selected AMS slot takes priority; otherwise the external spool
        // from the (invisible) side select.
        const ziel = this._filZiel || { ams: this.selectedAmsId(), slot: 0 };
        // Bambu with the filament state: the server loads (part 3, task 6).
        // An external spool without a spool asks which one goes in first --
        // its profile is set at the printer before the load. Without a type
        // entered it is not "empty": something is about to be put in.
        const fs = window.filamentState;
        if (fs && fs.block() && ziel.ams != null) {
            const schluessel = ziel.ams >= 254 ? fs.externalKey(ziel.ams)
                                               : fs.slotKey(ziel.ams, ziel.slot || 0);
            const ort = fs.place(schluessel);
            reset();
            if (ziel.ams >= 254 && !(ort && ort.spool && ort.spool.id != null) && window.openSpoolPicker) {
                window.openSpoolPicker({
                    treffer: [],
                    gewaehlt: null,
                    onWahl: (spule) => this._laden(schluessel, spule ? spule.id : null),
                    onKeine: () => this._laden(schluessel, null),
                });
                return;
            }
            this._laden(schluessel, null);
            return;
        }
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
     * Load a place through the server, with the spool that goes in (or null).
     * Only a Generic profile known for that spool: the answer asks, and the
     * toast's button is the yes (`profil`).
     */
    _laden(schluessel, spule, profil) {
        const texts = window.texts || {};
        this._filLaufAktion = 'load';
        const daten = { spool_id: spule };
        if (profil) daten.profile = profil;
        return window.apiCall('/api/filament/places/' + schluessel + '/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(daten),
        }).then(r => r.json()).then(d => {
            if (d && d.success) {
                if (d.filament_state && window.filamentState) window.filamentState.update(d.filament_state);
                this.renderMaterialZone();
                skToast(d.message || texts.toast_loading_filament, 'info');
                return;
            }
            const p = (d && d.error_params) || {};
            if (d && d.error_key === 'load_confirm_profile' && p.profile) {
                skToast(d.error, 'warning', {
                    aktion: {
                        text: (texts.fs_proposal_set_button || '{name} einstellen').replace('{name}', p.name || p.profile),
                        onClick: () => this._laden(schluessel, spule, p.profile),
                    },
                    dauer: 15000,
                });
                return;
            }
            skToast((d && d.error) || texts.toast_load_failed, 'error');
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    /**
     * Answer to the printer's confirm prompt after loading.
     * `resume` feeds again, `done` finishes it off. Without either of the
     * two, the process stays stuck at step 8 -- until now this could only
     * be answered in Bambu Studio.
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
    // KLIPPER-DIRECT CONTROL (parity with the Android app)
    // ========================================

    /** i18n helper with a German fallback. */
    kt(key, fallback) {
        const t = window.i18nManager && window.i18nManager.getText(key, '');
        return t || (window.texts && window.texts[key]) || fallback;
    }

    /** Fire arbitrary G-code through the Direct adapter. */
    kgcode(script) {
        return window.printerAdapter.gcode(script);
    }

    /** Number without unnecessary zeros: 100→"100", 0.1→"0.1". */
    kfmt(v) {
        return String(Math.abs(v)).replace(/\.?0+$/, '') || '0';
    }

    /** Rebuilds the three tabs (axes / extruder / machine). */
    buildKlipperControl() {
        // Tab labels: the third tab becomes "Machine".
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
        // Jog row per axis: -100 -10 -1  [axis=Home]  +1 +10 +100 (Z: 25/1/0.1)
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

    // ---- Actions (all via G-code through the adapter) ----
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
    // Emergency stop + restarts go through the dedicated Moonraker RPC actions
    // in the adapter (printer.emergency_stop / printer.firmware_restart) -- as
    // G-code they didn't work.
    kFirmwareRestart() { skToast(this.kt('control_fw_restart', 'Firmware-Neustart') + ' …'); window.printerAdapter.action('firmware_restart'); }
    kRestart() { skToast(this.kt('control_klipper_restart', 'Klipper-Neustart') + ' …'); window.printerAdapter.action('host_restart'); }
    kEmergencyStop() {
        showConfirmDialog({ text: this.kt('control_emergency_confirm', 'Drucker sofort stoppen?'),
            knopf: this.kt('confirm_stop', 'Stop'), gefaehrlich: true }, () => {
            skToast(this.kt('control_emergency_stop', 'NOT-AUS'), 'error');
            window.printerAdapter.action('emergency_stop');
        });
    }
    kRunMacro(name) { skToast(name + ' …'); this.kgcode(name); }

    /** Poll live state (position, Z offset, temp, flow, can_extrude). */
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
        // QGL only makes sense once Z is homed.
        const qgl = document.getElementById('kctrl-qgl');
        if (qgl) qgl.disabled = !homed.includes('z');
        // Only sync the flow slider when the user isn't dragging it right now.
        const flow = document.getElementById('kctrl-flow');
        if (flow && document.activeElement !== flow && s.flow_percent) {
            flow.value = s.flow_percent;
            const fv = document.getElementById('kctrl-flowval');
            if (fv) fv.textContent = s.flow_percent + '%';
        }
        // can_extrude → lock extrude/retract + show a hint.
        const cold = !s.can_extrude;
        ['kctrl-extrude', 'kctrl-retract'].forEach(id => {
            const b = document.getElementById(id);
            if (b) { b.disabled = cold; b.style.opacity = cold ? '0.5' : ''; }
        });
        const tc = document.getElementById('kctrl-toocold');
        if (tc) tc.style.display = cold ? 'block' : 'none';
    }

    /** Load and render the macro list + Mainsail groups. */
    loadKlipperMacros() {
        const box = document.getElementById('kctrl-macros');
        fetch('/api/klipper/macros', { credentials: 'same-origin' })
            .then(r => r.json()).then(data => {
                if (!box) return;
                const groups = (data && data.groups) || [];
                const macros = (data && data.macros) || [];
                // Names and colours come from printer.cfg: escaped, a colour
                // only as hex, and the macro handed over through a data attribute.
                const esc = (v) => String(v == null ? '' : v)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const hex = (c) => /^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? c : '';
                const chip = (name, color) =>
                    `<button class="kctrl-macro" style="${hex(color) ? `background:${hex(color)};border-color:${hex(color)};color:#fff;` : ''}" data-macro="${esc(name)}" onclick="window.printerControlManager.kRunMacro(this.dataset.macro)">${esc(name)}</button>`;
                let html = '';
                if (groups.length) {
                    const grouped = new Set();
                    groups.forEach(g => {
                        g.macros.forEach(m => grouped.add(m.name.toUpperCase()));
                        const gruppenFarbe = /^#[0-9a-fA-F]{6}$/.test(String(g.color || '')) ? g.color : '';
                        html += `<div class="kctrl-macro-group"${gruppenFarbe ? ` style="border-color:${gruppenFarbe}99;"` : ''}>
                            <div class="kctrl-macro-group-title"${gruppenFarbe ? ` style="color:${gruppenFarbe};"` : ''}>${esc(g.name)}</div>
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
