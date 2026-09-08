/**
 * Temperature Modal Manager
 * Nozzle and bed temperature control with presets
 */
class TemperatureModalManager {
    constructor() {
        this.lastNozzleTemp = 0;
        this.lastBedTemp = 0;
        this.lastNozzleTarget = 0;
        this.lastBedTarget = 0;
        this.lastChamberTarget = 0;
    }

    open(zone) {
        const texts = window.texts || {};
        document.getElementById('tempModal').style.display = 'block';

        // Bambu: the display style of the fan window (dfx stage), with a
        // renderer of its own that sends straight away. Klipper keeps the
        // slider plus apply.
        if (!(window.isKlipperMode && window.isKlipperMode())
                && document.getElementById('dt-stage')) {
            this._zone = zone || null;
            document.getElementById('temp-modal-title').textContent =
                texts.temp_control_title || 'Temperaturen';
            // And the filament labels. The block of text further down sets
            // them too -- only it is never reached here, because this branch
            // returns first. The result was a German "Laden/Entladen" in the
            // middle of an English interface.
            const filLabel = document.getElementById('temp-filament-label');
            if (filLabel) filLabel.textContent = texts.mz_filament_shortcut || 'Laden/Entladen';
            this._pending = {};   // {schluessel: {wert, timer}}
            this._sig = null;     // Stage frisch bauen (Zonen-Aufklapp-Zustand)
            this.renderBambu();
            if (this._tick) clearInterval(this._tick);
            this._tick = setInterval(() => this.renderBambu(), 2000);
            return;
        }
        // Remember which zone was asked for -- the visibility is applied
        // below, AFTER the capability check (chamber and dual nozzle depend on
        // the capabilities and would otherwise be switched back).
        this._zone = zone || null;

        // Texte setzen
        document.getElementById('temp-modal-title').textContent = texts.temp_control_title || 'Temperatur-Einstellung';
        document.getElementById('temp-nozzle-label').textContent = texts.temp_nozzle || 'Düse';
        document.getElementById('temp-bed-label').textContent = texts.temp_bed || 'Bett';
        document.getElementById('temp-nozzle-current-label').textContent = texts.temp_current || 'Aktuell';
        document.getElementById('temp-bed-current-label').textContent = texts.temp_current || 'Aktuell';
        document.getElementById('temp-cancel-btn').textContent = texts.cancel || 'Abbrechen';
        document.getElementById('temp-apply-btn').textContent = texts.apply || 'Anwenden';
        const filKnopf = document.getElementById('temp-filament-label');
        if (filKnopf) {
            filKnopf.textContent = texts.mz_filament_shortcut || 'Laden/Entladen';
        }
        document.getElementById('temp-off-btn-nozzle').textContent = texts.temp_off || 'Aus';
        document.getElementById('temp-off-btn-bed').textContent = texts.temp_off || 'Aus';
        document.getElementById('temp-off-btn-chamber').textContent = texts.temp_off || 'Aus';
        document.getElementById('temp-chamber-label').textContent = texts.temp_chamber || 'Kammer';
        document.getElementById('temp-chamber-current-label').textContent = texts.temp_current || 'Aktuell';
        document.getElementById('temp-nozzles-label').textContent = texts.temp_nozzles || 'Düsen';
        document.getElementById('temp-nozzle-left-label').textContent = texts.temp_nozzle_left || 'Links';
        document.getElementById('temp-nozzle-right-label').textContent = texts.temp_nozzle_right || 'Rechts';

        // Take the current temperatures from lastPrintData
        if (window.lastPrintData) {
            this.lastNozzleTemp = window.lastPrintData.nozzle_temp || 0;
            this.lastBedTemp = window.lastPrintData.bed_temp || 0;
            this.lastNozzleTarget = window.lastPrintData.nozzle_target || 0;
            this.lastBedTarget = window.lastPrintData.bed_target || 0;
        }

        // The chamber and the second nozzle depend on what the printer
        // reports, not on the model name. capabilities comes from the server
        // (see services/printer_capabilities.py).
        // The same state as the device tab (printer-control.js):
        // window.activePrinter.state carries the capabilities and the device
        // block. Klipper fills window.activePrinter.state over the socket. In
        // Bambu mode it stays empty -- there printerControl keeps the
        // /api/status state (flat, capabilities included). Without this
        // fallback the chamber and the dual nozzle stayed invisible on the X2D.
        const status = (window.activePrinter && window.activePrinter.state)
            || (window.printerControlManager && window.printerControlManager.lastState) || {};
        const caps = status.capabilities || {};
        // Bambu delivers the values flat, Klipper under .device.
        const device = status.device || status;

        const chamberZone = document.getElementById('temp-zone-chamber');
        if (caps.chamber_heater) {
            chamberZone.style.display = '';
            this.lastChamberTarget = Math.round(device.chamber_target || 0);
            document.getElementById('temp-chamber-current').textContent =
                Math.round(status.chamber_temp || (window.lastPrintData || {}).chamber_temp || 0);
            document.getElementById('temp-chamber-slider').value = this.lastChamberTarget;
            document.getElementById('temp-chamber-input').value = this.lastChamberTarget;
        } else {
            chamberZone.style.display = 'none';
        }

        const nozzleZone = document.getElementById('temp-zone-nozzles');
        if (caps.dual_nozzle) {
            nozzleZone.style.display = '';
            const ist = device.nozzle_temps || {};
            const soll = device.nozzle_targets || {};
            // 1 is LEFT, 0 is RIGHT -- not the other way round.
            const zeige = (seite, key) => {
                document.getElementById(`temp-nozzle-${seite}`).textContent =
                    ist[key] != null ? Math.round(ist[key]) : '--';
                document.getElementById(`temp-nozzle-${seite}-target`).textContent =
                    soll[key] != null ? Math.round(soll[key]) : '--';
            };
            zeige('left', '1');
            zeige('right', '0');

            // The slider at the top always sets the active nozzle: M104 has no
            // side selection, neither here nor in the Home Assistant
            // integration.
            const aktiv = device.active_nozzle === 1
                ? (texts.temp_nozzle_left || 'Links')
                : (texts.temp_nozzle_right || 'Rechts');
            document.getElementById('temp-nozzle-active-hint').textContent =
                (texts.temp_nozzle_active_hint || 'Der Regler oben gilt für die aktive Düse') + ': ' + aktiv;
        } else {
            nozzleZone.style.display = 'none';
        }

        // A single-zone call (a badge in the graphic, or a card on the
        // overview): show only the zone that was clicked. The temperature
        // button still opens without a zone -> everything visible.
        const zeige = (id, on) => {
            const e = document.getElementById(id);
            if (e) e.style.display = on ? '' : 'none';
        };
        if (this._zone) {
            zeige('temp-zone-nozzle', this._zone === 'nozzle');
            zeige('temp-zone-bed', this._zone === 'bed');
            if (this._zone !== 'chamber') zeige('temp-zone-chamber', false);
            if (this._zone !== 'nozzle') zeige('temp-zone-nozzles', false);
        } else {
            zeige('temp-zone-nozzle', true);
            zeige('temp-zone-bed', true);
        }

        // Show the current values
        document.getElementById('temp-nozzle-current').textContent = Math.round(this.lastNozzleTemp);
        document.getElementById('temp-bed-current').textContent = Math.round(this.lastBedTemp);

        // Set the slider to the target temperature (or 0 when there is none)
        document.getElementById('temp-nozzle-slider').value = this.lastNozzleTarget;
        document.getElementById('temp-nozzle-input').value = this.lastNozzleTarget;
        document.getElementById('temp-bed-slider').value = this.lastBedTarget;
        document.getElementById('temp-bed-input').value = this.lastBedTarget;
    }

    close() {
        document.getElementById('tempModal').style.display = 'none';
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
    }

    // =========================================================
    // Bambu: the display style of the fan window -- the machine in the middle,
    // the zones outside with leader lines, a click unfolds the stepper and the
    // presets.
    // =========================================================

    static PRESETS = {
        nozzle: [['PLA', 220], ['PETG', 250], ['ABS', 265]],
        bed: [[null, 55], [null, 65], [null, 80], [null, 100]],
        chamber: [[null, 40], [null, 50], [null, 60], [null, 65]],
    };

    static ICONS = {
        nozzle: '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M9 3h6v4l2 1v3H7V8l2-1zM10 11l2 5 2-5M12 16v4"/></svg>',
        bed: '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M4 16h16M6 16v3M18 16v3M8 7c1.5 1.5-1.5 2.5 0 4M12 7c1.5 1.5-1.5 2.5 0 4M16 7c1.5 1.5-1.5 2.5 0 4"/></svg>',
        chamber: '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true">'
            + '<rect x="3" y="3" width="18" height="18" rx="2"/>'
            + '<path d="M9 13c1.2 1.2-1.2 2 0 3.2M13 13c1.2 1.2-1.2 2 0 3.2M8 8h8"/></svg>',
    };

    _status() {
        return (window.printerControlManager && window.printerControlManager.lastState) || {};
    }

    /** Send the target of one zone (the nozzle side through nozzle_id). */
    _sende(schluessel, wert) {
        const w = Math.max(0, Math.round(wert));
        if (schluessel === 'bed') window.printerAdapter.setTemp('bed', w);
        else if (schluessel === 'chamber') window.printerAdapter.setTemp('chamber', w);
        else window.printerAdapter.setTemp('extruder', w, parseInt(schluessel, 10));
        // Optimistic: show the target straight away, the status confirms later.
        this._pending[schluessel] = { wert: w, bis: Date.now() + 8000 };
        this.renderBambu();
    }

    _maxWert(schluessel) {
        if (schluessel === 'bed') return 120;
        if (schluessel === 'chamber') return 65;
        return 320;
    }

    /** The stepper: collects briefly, then sends -- this avoids MQTT spam. */
    dtStep(seite, delta) {
        const schluessel = String(seite);
        const aktuell = (this._pending[schluessel] && this._pending[schluessel].wert != null)
            ? this._pending[schluessel].wert
            : this._sollWert(schluessel);
        const neu = Math.max(0, Math.min(this._maxWert(schluessel), aktuell + delta));
        this._pending[schluessel] = { wert: neu, bis: Date.now() + 60000, offen: true };
        this.renderBambu();
        if (this._stepTimer) clearTimeout(this._stepTimer);
        this._stepTimer = setTimeout(() => {
            Object.keys(this._pending).forEach(k => {
                if (this._pending[k] && this._pending[k].offen) {
                    this._pending[k].offen = false;
                    this._sende(k, this._pending[k].wert);
                }
            });
        }, 900);
    }

    _sollWert(schluessel) {
        const st = this._status();
        if (schluessel === 'bed') return Math.round(st.bed_target || 0);
        if (schluessel === 'chamber') return Math.round(st.chamber_target || 0);
        const ziele = st.nozzle_targets || {};
        const v = ziele[schluessel] != null ? ziele[schluessel] : ziele[parseInt(schluessel, 10)];
        return Math.round(v || st.nozzle_target || 0);
    }

    // The positions of the parts in x2d.png (per cent) -- where the leader
    // lines point.
    static ANKER = {
        nozzleL: '42,31', nozzleR: '48,30', bed: '42,62', chamber: '54,74',
    };

    /** One zone entry in the fan style: head › value › detail (stepper + chips). */
    _eintrag(def) {
        const box = document.createElement('div');
        box.className = 'dfx-fan dfx-fan--' + def.seite;
        if (def.anker) box.dataset.anker = def.anker;

        const head = document.createElement('div');
        head.className = 'dfx-fan-head';
        head.style.cursor = 'pointer';
        head.innerHTML = TemperatureModalManager.ICONS[def.art] + ' '
            + '<span>' + def.label + '</span>'
            + '<span class="dsp-active" style="display:none;"></span>'
            + ' <span class="dfx-arrow">›</span>';
        box.appendChild(head);

        const val = document.createElement('div');
        val.className = 'dfx-fan-val';
        box.appendChild(val);

        const note = document.createElement('div');
        note.className = 'dfx-fan-note';
        note.style.display = 'none';
        box.appendChild(note);

        let hw = null;
        if (def.art === 'nozzle') {
            hw = document.createElement('div');
            hw.className = 'dtx-hw';
            box.appendChild(hw);
        }

        const detail = document.createElement('div');
        detail.className = 'dtx-detail';
        detail.style.display = 'none';

        // Two quiet segmented bars instead of single buttons: stepper + presets.
        const step = document.createElement('div');
        step.className = 'dtx-seg';
        [[-10, '−10'], [-1, '−1'], [1, '+1'], [10, '+10']].forEach(([d, label]) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.addEventListener('click', () => this.dtStep(def.key, d));
            step.appendChild(b);
        });
        detail.appendChild(step);

        const chips = document.createElement('div');
        chips.className = 'dtx-seg dtx-seg--presets';
        detail.appendChild(chips);

        box.appendChild(detail);

        head.addEventListener('click', () => {
            detail.style.display = detail.style.display === 'none' ? '' : 'none';
        });

        this._karten[def.key] = {
            art: def.art, val, note, hw, chips, detail,
            aktiv: head.querySelector('.dsp-active'),
        };
        return box;
    }

    /** Build the stage once (like the fan window) -- the values arrive separately. */
    _baueStage(dual, hatKammer) {
        const wrap = document.getElementById('dt-stage');
        if (!wrap) return;
        const texts = window.texts || {};
        const st = this._status();
        wrap.innerHTML = '';
        this._karten = {};

        const stage = document.createElement('div');
        stage.className = 'dfx-stage';
        const links = document.createElement('div');
        links.className = 'dfx-col dfx-col--l';
        const mitte = document.createElement('div');
        mitte.className = 'dfx-mitte';
        mitte.innerHTML = '<img src="/static/img/printers/x2d.png" alt="">';
        const rechts = document.createElement('div');
        rechts.className = 'dfx-col dfx-col--r';

        // Laid out like the display: on the left the left nozzle and the heated
        // bed, on the right the right nozzle and the chamber. 1 is LEFT,
        // 0 is RIGHT.
        const A = TemperatureModalManager.ANKER;
        let defs = [];
        if (dual) {
            defs.push({ key: '1', label: texts.temp_nozzle_left_full || 'Düse links', seite: 'l', art: 'nozzle', anker: A.nozzleL });
            defs.push({ key: '0', label: texts.temp_nozzle_right_full || 'Düse rechts', seite: 'r', art: 'nozzle', anker: A.nozzleR });
        } else {
            defs.push({ key: String(st.active_nozzle || 0), label: texts.temp_nozzle || 'Düse', seite: 'l', art: 'nozzle', anker: A.nozzleL });
        }
        defs.push({ key: 'bed', label: texts.temp_bed_full || 'Heizbett', seite: 'l', art: 'bed', anker: A.bed });
        if (hatKammer) defs.push({ key: 'chamber', label: texts.temp_chamber || 'Kammer', seite: 'r', art: 'chamber', anker: A.chamber });
        // A zone call (card or badge): show ONLY the zone that was clicked --
        // for 'nozzle' both nozzles, otherwise exactly the one entry.
        if (this._zone) {
            defs = defs.filter(this._zone === 'nozzle'
                ? d => d.art === 'nozzle'
                : d => d.key === this._zone);
        }
        defs.forEach(d => (d.seite === 'l' ? links : rechts).appendChild(this._eintrag(d)));

        stage.appendChild(links);
        stage.appendChild(mitte);
        stage.appendChild(rechts);
        wrap.appendChild(stage);

        // The hint matches what is visible: the full view names every zone,
        // the nozzle view only the nozzle. Bed and chamber arrive already
        // unfolded -- there the explanation from the display stands instead.
        let hintText = null;
        if (!this._zone) {
            hintText = texts.temp_hint_click
                || 'Düse, Heizbett oder Kammer anklicken, um die Temperatur einzustellen.';
        } else if (this._zone === 'nozzle' && dual) {
            hintText = texts.temp_hint_click_nozzle
                || 'Düse anklicken, um die Temperatur einzustellen.';
        } else if (this._zone === 'bed') {
            hintText = texts.temp_hint_bed
                || 'Das Heizbett hält die eingestellte Temperatur während des Drucks — für bessere Haftung auf der Platte.';
        } else if (this._zone === 'chamber') {
            hintText = texts.temp_hint_chamber
                || 'Niedrige Kammertemperatur passt zu PLA/PETG, hohe zu verzugsanfälligen Materialien wie ABS/ASA/PC/PA.';
        }
        if (hintText) {
            const hint = document.createElement('div');
            hint.className = 'dsp-hint';
            hint.innerHTML = '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true">'
                + '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg> '
                + '<span>' + hintText + '</span>';
            wrap.appendChild(hint);
        }
        if (window.dfxWatchStage) window.dfxWatchStage(stage);

        // A zone call (badge or card): the requested zone arrives already
        // unfolded -- all of them stay visible.
        const zielKey = this._zone === 'bed' ? 'bed'
            : this._zone === 'chamber' ? 'chamber'
            : this._zone === 'nozzle' ? (dual ? String(st.active_nozzle != null ? st.active_nozzle : 0) : defs[0].key)
            : null;
        if (zielKey && this._karten[zielKey]) this._karten[zielKey].detail.style.display = '';
    }

    renderBambu() {
        const texts = window.texts || {};
        const st = this._status();
        const temps = st.nozzle_temps || {};
        const holen = (o, k) => (o[k] != null ? o[k] : o[String(k)]);
        const dual = [holen(temps, 0), holen(temps, 1)].filter(v => v != null).length > 1;
        const caps = st.capabilities || {};
        const hatKammer = !!caps.chamber_heater;

        const sig = (dual ? 'd' : 's') + (hatKammer ? 'k' : '-') + '|' + (this._zone || '');
        if (sig !== this._sig || !this._karten) {
            this._sig = sig;
            this._baueStage(dual, hatKammer);
        }

        const soll = (schluessel) => {
            const p = this._pending[schluessel];
            if (p && (p.offen || p.bis > Date.now())) return p.wert;
            return this._sollWert(schluessel);
        };

        Object.entries(this._karten).forEach(([key, k]) => {
            let ist;
            if (key === 'bed') ist = st.bed_temp;
            else if (key === 'chamber') ist = st.chamber_temp;
            else {
                const v = holen(temps, key);
                ist = v != null ? v : st.nozzle_temp;
            }
            const sollV = soll(key);
            k.val.innerHTML = Math.round(ist || 0) + '° <small>/ ' + sollV + '°</small>';

            // The presets take two lines: the material on top, the degrees
            // small below it -- on one line 'PETG 250' was squeezed right up
            // against the dividers.
            const presets = TemperatureModalManager.PRESETS[k.art];
            const eintraege = [[texts.temp_off || 'Aus', 0]].concat(
                presets.map(([n, v]) => [n ? (n + '<small>' + v + '°</small>') : String(v), v]));
            k.chips.innerHTML = eintraege.map(([label, v]) =>
                '<button class="' + (sollV === v ? 'dtx-on' : '') + '" ' +
                'onclick="window.temperatureModal._sende(\'' + key + '\',' + v + ')">' +
                label + '</button>').join('');

            if (k.art === 'nozzle') {
                const an = dual && String(st.active_nozzle) === key;
                k.aktiv.style.display = an ? '' : 'none';
                k.aktiv.textContent = texts.temp_active || 'AKTIV';
                const info = (st.nozzles || []).find(n => n && String(n.id) === key);
                k.hw.textContent = info
                    ? [info.type, info.diameter ? info.diameter + ' mm' : null].filter(Boolean).join(' · ')
                    : '';
            }
            if (key === 'chamber') {
                const heizt = st.airduct_mode === 1 && sollV > 0;
                k.note.style.display = heizt ? '' : 'none';
                k.note.innerHTML = window.skIcon('hitze', 'hd-ic--xs') + ' ' + (texts.temp_heating || 'heizt');
            }
        });
    }

    updateDisplay(type, value) {
        document.getElementById(`temp-${type}-input`).value = value;
        document.getElementById(`temp-${type}-slider`).value = value;
    }

    setPreset(type, value) {
        document.getElementById(`temp-${type}-slider`).value = value;
        document.getElementById(`temp-${type}-input`).value = value;
    }

    async apply() {
        const texts = window.texts || {};
        const nozzleTemp = parseInt(document.getElementById('temp-nozzle-input').value) || 0;
        const bedTemp = parseInt(document.getElementById('temp-bed-input').value) || 0;
        try {
            if (nozzleTemp !== this.lastNozzleTarget) {
                await window.printerAdapter.setTemp('extruder', nozzleTemp);
            }
            if (bedTemp !== this.lastBedTarget) {
                await window.printerAdapter.setTemp('bed', bedTemp);
            }
            const chamberZone = document.getElementById('temp-zone-chamber');
            if (chamberZone && chamberZone.style.display !== 'none') {
                const chamberTemp = parseInt(document.getElementById('temp-chamber-input').value) || 0;
                if (chamberTemp !== this.lastChamberTarget) {
                    await window.printerAdapter.setTemp('chamber', chamberTemp);
                }
            }
            skToast(texts.temp_apply_success || 'Temperatur wird geändert', 'info');
            this.close();
        } catch (error) {
            console.error('Temperature error:', error);
            skToast(texts.temp_apply_error || 'Fehler beim Setzen der Temperatur', 'error');
        }
    }

    requestFullStatus() {
        const texts = window.texts || {};
        console.log(texts.console_request_full_status);

        apiCall('/api/request_full_status', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                skToast(texts.toast_full_data_requested, 'success');
                console.log(texts.console_current_data, data.current_data);

                if (data.current_data) {
                    console.log(texts.console_progress, data.current_data.progress + '%');
                    console.log(texts.console_layers, data.current_data.layer_num + '/' + data.current_data.total_layers);
                    console.log(texts.console_remaining, data.current_data.remaining_time + ' min');
                }
            } else {
                skToast(texts.toast_error_fetching_data, 'error');
            }
        })
        .catch(error => {
            console.error(texts.console_error + ':', error);
            skToast(texts.connection_error, 'error');
        });
    }
}

// Global singleton
window.temperatureModal = new TemperatureModalManager();

// Backwards compatibility
window.openTempControl = (zone) => window.temperatureModal.open(zone);
window.closeTempModal = () => window.temperatureModal.close();
window.updateTempDisplay = (type, value) => window.temperatureModal.updateDisplay(type, value);
window.setTempPreset = (type, value) => window.temperatureModal.setPreset(type, value);
window.applyTemperatures = () => window.temperatureModal.apply();
window.requestFullStatus = () => window.temperatureModal.requestFullStatus();
window.dtStep = (seite, delta) => window.temperatureModal.dtStep(seite, delta);
