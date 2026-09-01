/**
 * Speed Modal Manager
 * Print speed control with 4-level slider
 */
class SpeedModalManager {
    open() {
        const texts = window.texts || {};
        document.getElementById('speedModal').style.display = 'block';

        // Null-sicher: im Bambu-Template existieren Hint/Cancel/Apply und
        // der Slider nicht (Klipper-Zweig) — harte getElementById-Zugriffe
        // crashten open() VOR dem Karten-Code (deshalb fehlten Markierung
        // und Hinweistext komplett).
        const setze = (id, v) => { const e = document.getElementById(id); if (e && v) e.textContent = v; };
        setze('speed-modal-title', texts.speed_control);
        setze('speed-modal-hint', texts.speed_hint);
        setze('speed-cancel-btn', texts.cancel);
        setze('speed-apply-btn', texts.apply);

        const slider = document.getElementById('speed-slider');
        const labels = document.getElementById('speed-level-labels');
        this._klipper = !!(window.isKlipperMode && window.isKlipperMode());

        // Bambu (Display-Stil): vier Stufen-Karten, Klick setzt sofort.
        if (!this._klipper && document.getElementById('ds-grid')) {
            const namen = {1: texts.speed_silent, 2: texts.speed_standard,
                           3: texts.speed_sport, 4: texts.speed_ludicrous};
            const infos = {1: texts.speed_desc_silent || '50 %',
                           2: texts.speed_desc_standard || '100 %',
                           3: texts.speed_desc_sport || '124 %',
                           4: texts.speed_desc_ludicrous || '166 %'};
            for (let i = 1; i <= 4; i++) {
                const n = document.getElementById('ds-name-' + i);
                const d = document.getElementById('ds-desc-' + i);
                if (n && namen[i]) n.textContent = namen[i];
                if (d) d.textContent = infos[i];
            }
            const hint = document.getElementById('ds-hint');
            if (hint) hint.textContent = texts.speed_hint
                || 'Wirkt sofort auf den laufenden Druck.';
            // Aktive Stufe: der Bambu-Status traegt sie unter speed.speed_level
            // (lastPrintData ist der Klipper-Weg und hier leer).
            const st = (window.printerControlManager
                && window.printerControlManager.lastState) || {};
            const lvl = (st.speed && st.speed.speed_level)
                || (window.lastPrintData && window.lastPrintData.speed_level) || 2;
            this._markiere(lvl);
            return;
        }

        if (!slider) return;
        if (this._klipper) {
            // Klipper: stufenloser Geschwindigkeitsfaktor 1–200 % (M220), wie Mainsail.
            if (labels) labels.style.display = 'none';
            slider.min = 1; slider.max = 200; slider.step = 1;
            const cur = Math.round((window.lastPrintData && window.lastPrintData.speed_percent) || 100);
            slider.value = Math.min(200, Math.max(1, cur));
            this.updateDisplay(slider.value);
        } else {
            // Bambu: 4 Stufen mit Labels.
            if (labels) labels.style.display = '';
            slider.min = 1; slider.max = 4; slider.step = 1;
            document.getElementById('speed-label-silent').textContent = texts.speed_silent;
            document.getElementById('speed-label-standard').textContent = texts.speed_standard;
            document.getElementById('speed-label-sport').textContent = texts.speed_sport;
            document.getElementById('speed-label-ludicrous').textContent = texts.speed_ludicrous;
            const lvl = (window.lastPrintData && window.lastPrintData.speed_level) || 2;
            slider.value = lvl;
            this.updateDisplay(lvl);
        }
    }

    close() {
        document.getElementById('speedModal').style.display = 'none';
    }

    _markiere(stufe) {
        for (let i = 1; i <= 4; i++) {
            const c = document.getElementById('ds-card-' + i);
            if (c) c.classList.toggle('dsp-on', i === parseInt(stufe, 10));
        }
    }

    /** Bambu-Karten: Stufe waehlen und sofort senden. */
    pick(stufe) {
        const texts = window.texts || {};
        this._markiere(stufe);
        const percent = {1: 50, 2: 100, 3: 124, 4: 166}[stufe] || 100;
        const namen = ['', texts.speed_silent, texts.speed_standard,
                       texts.speed_sport, texts.speed_ludicrous];
        window.printerAdapter.setSpeed(percent).then(r => {
            if (r.ok) {
                skToast((texts.toast_speed_set || '{speed}')
                    .replace('{speed}', namen[stufe] + ' (' + percent + '%)'), 'info');
                this.close();
            } else {
                skToast(r.error || texts.error, 'error');
            }
        }).catch(() => skToast(texts.connection_error, 'error'));
    }

    updateDisplay(value) {
        const texts = window.texts || {};
        if (this._klipper) {
            // Stufenlos: nur „X %" anzeigen.
            const display = document.getElementById('speed-display');
            display.textContent = value + '%';
            display.style.color = 'var(--accent-blue)';
            document.getElementById('speed-description').textContent = '';
            return;
        }
        const speedNames = {
            '1': { name: texts.speed_silent, desc: texts.speed_silent_desc, color: '#4CAF50' },
            '2': { name: texts.speed_standard, desc: texts.speed_standard_desc, color: '#2196F3' },
            '3': { name: texts.speed_sport, desc: texts.speed_sport_desc, color: '#FFC107' },
            '4': { name: texts.speed_ludicrous, desc: texts.speed_ludicrous_desc, color: '#ff5722' }
        };
        const speed = speedNames[value];
        if (speed) {
            document.getElementById('speed-display').textContent = speed.name;
            document.getElementById('speed-display').style.color = speed.color;
            document.getElementById('speed-description').textContent = speed.desc;
        }
    }

    apply() {
        const texts = window.texts || {};
        const self = this;
        const slider = document.getElementById('speed-slider');
        let percent, speedText;
        if (this._klipper) {
            // Klipper: Slider-Wert = Prozent direkt → M220.
            percent = parseInt(slider.value, 10) || 100;
            speedText = percent + '%';
        } else {
            // Bambu: 4 Levels → Prozent (Backend mappt zurück).
            const speedLevel = parseInt(slider.value, 10);
            percent = {1: 50, 2: 100, 3: 124, 4: 166}[speedLevel] || 100;
            const names = ['', texts.speed_silent, texts.speed_standard,
                           texts.speed_sport, texts.speed_ludicrous];
            speedText = names[speedLevel] + ' (' + percent + '%)';
        }

        window.printerAdapter.setSpeed(percent).then(r => {
            if (r.ok) {
                skToast((texts.toast_speed_set || '{speed}').replace('{speed}', speedText), 'info');
                self.close();
            } else {
                skToast(r.error || texts.error, 'error');
            }
        }).catch(() => skToast(texts.connection_error, 'error'));
    }
}

// Global singleton
window.speedModal = new SpeedModalManager();

// Backwards compatibility
window.openSpeedControl = () => window.speedModal.open();
window.closeSpeedModal = () => window.speedModal.close();
window.updateSpeedDisplay = (value) => window.speedModal.updateDisplay(value);
window.applySpeed = () => window.speedModal.apply();
window.dsPick = (stufe) => window.speedModal.pick(stufe);
