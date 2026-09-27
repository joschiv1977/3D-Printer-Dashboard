/**
 * The home page's overview while the printer is off: the next planned print,
 * the last print, the next maintenance and the month in numbers.
 *
 * Switched off, the print card, the material and the drying card have
 * nothing to say. While the socket reports the printer off, one card stands
 * in their place -- on the desktop the grid swaps them (app-init.js,
 * setzeAusModus), on a phone the column hides them (body.drucker-aus). The
 * same four blocks as the apps (HomeAusUebersicht.swift / .kt).
 *
 * Off means: a socket is set up and says "off". Nobody answering is not off.
 */
(function () {
    const SPEICHER = 'home-off-overview';
    const t = (key, fallback) =>
        (typeof window.getText === 'function' ? window.getText(key, fallback) : fallback);
    // Dates and numbers in the app's language, not the browser's -- the
    // words around them are in the app's language too.
    const sprache = () => (window.i18nManager && window.i18nManager.currentLang) || 'de';
    const esc = v => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    class OffOverview {
        constructor() {
            this.aus = false;
            this.stand = this._lies();
        }

        // ------------------------------------------------------------ state

        /** From every status: is the printer off, and did that change? */
        aktualisiereZustand() {
            const aus = window.lastPowerMode !== 'none' && window.lastKnownSwitchState === 'off';
            if (aus === this.aus) return;
            this.aus = aus;
            document.body.classList.toggle('drucker-aus', aus);
            if (window.appInit && typeof window.appInit.setzeAusModus === 'function') {
                window.appInit.setzeAusModus(aus);
            }
            if (aus) {
                // The cache first, then fresh -- it may be from the last time
                // the printer was off.
                this._zeichne();
                this.laden();
            }
        }

        /** The planner changed (socket event) -- only the plan is new. */
        planNeu() {
            if (this.aus) this._ladePlan();
        }

        /** Coming back to the tab. History and maintenance do not change
         *  while the printer is off -- nothing prints -- so this is enough. */
        laden() {
            this._ladePlan();
            this._ladeHistorie();
            this._ladeWartung();
        }

        // ---------------------------------------------------------- loading

        async _json(url) {
            const antwort = await window.authFetch(url);
            if (!antwort.ok) throw new Error(`${url}: HTTP ${antwort.status}`);
            return antwort.json();
        }

        async _ladePlan() {
            try {
                const daten = await this._json('/api/scheduled_prints');
                const naechster = (daten.prints || [])
                    .filter(p => p.status === 'pending' || p.status === 'planned')
                    .sort((a, b) => String(a.scheduled_time).localeCompare(String(b.scheduled_time)))[0];
                this.stand.geplant = naechster ? {
                    dateiname: naechster.filename,
                    plate: naechster.plate || 1,
                    zeit: naechster.scheduled_time,
                    dauer: naechster.print_time || null,
                    spule: naechster.spool_name || null,
                    strom: !!naechster.auto_power
                } : null;
                this._merke();
                this._zeichnePlan();
            } catch (e) {
                // An unreachable server says nothing about the plan -- the
                // card keeps what it showed.
                console.warn('Off overview: planner not loaded', e);
            }
        }

        /** The last print and the month, by the statistics tab's rules: a
         *  system run (calibration, drying) is not a print, and the rate
         *  counts finished prints only. */
        async _ladeHistorie() {
            try {
                const daten = await this._json('/api/history');
                const echte = (daten.prints || []).filter(p => !p.is_system_run);
                const letzter = echte
                    .filter(p => p.status !== 'running')
                    .sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)))[0];
                this.stand.letzter = letzter ? {
                    id: letzter.id,
                    name: letzter.filename,
                    status: letzter.status,
                    ende: letzter.end_time || letzter.start_time,
                    minuten: letzter.duration_minutes,
                    gramm: letzter.filament_grams,
                    kosten: letzter.cost_eur,
                    farben: String(letzter.filament_color || '').split('+')
                        .map(f => f.trim()).filter(Boolean).slice(0, 3),
                    bild: !!letzter.has_thumbnail
                } : null;

                const jetzt = new Date();
                const schluessel = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}`;
                const imMonat = echte.filter(p => String(p.start_time).startsWith(schluessel));
                const ok = imMonat.filter(p => p.status === 'success').length;
                const fertig = imMonat.filter(p => ['success', 'failed', 'cancelled'].includes(p.status)).length;
                this.stand.monat = {
                    schluessel,
                    drucke: imMonat.length,
                    erfolg: fertig > 0 ? Math.floor(ok * 100 / fertig) : null,
                    minuten: imMonat.reduce((s, p) => s + (p.duration_minutes || 0), 0),
                    gramm: imMonat.reduce((s, p) => s + (p.filament_grams || 0), 0)
                };
                this._merke();
                this._zeichneLetzter();
                this._zeichneMonat();
            } catch (e) {
                console.warn('Off overview: history not loaded', e);
            }
        }

        /** The maintenance page's first printer, as that page opens on it. */
        async _ladeWartung() {
            try {
                const drucker = await this._json('/api/maintenance/printers');
                const erster = Array.isArray(drucker) ? drucker[0] : null;
                if (!erster) return;
                this.stand.wartung = await this._json(
                    `/api/maintenance/tasks?printer_id=${encodeURIComponent(erster.printer_id)}`);
                this._merke();
                this._zeichneWartung();
            } catch (e) {
                console.warn('Off overview: maintenance not loaded', e);
            }
        }

        _lies() {
            try {
                return JSON.parse(localStorage.getItem(SPEICHER)) || {};
            } catch (e) {
                return {};
            }
        }

        _merke() {
            try { localStorage.setItem(SPEICHER, JSON.stringify(this.stand)); } catch (e) { /* full: no cache */ }
        }

        // ---------------------------------------------------------- drawing

        _zeichne() {
            this._zeichnePlan();
            this._zeichneLetzter();
            this._zeichneWartung();
            this._zeichneMonat();
        }

        _feld(id, inhalt) {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.display = inhalt ? '' : 'none';
            if (inhalt) el.innerHTML = inhalt;
            // The pair row goes when neither print has anything to say.
            const paar = el.closest('.aus-paar');
            if (paar) {
                paar.style.display = [...paar.children].some(k => k.style.display !== 'none') ? '' : 'none';
            }
        }

        _kopf(titel, link, aktion) {
            return `<div class="aus-feld-kopf"><span>${esc(titel)}</span>
                <button type="button" class="aus-link" onclick="${aktion}">${esc(link)}
                <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button></div>`;
        }

        _zeile({ bild, name, marke, zeit, farben, menge }) {
            const punkte = (farben || []).map(f =>
                `<span class="aus-punkt" style="background:${esc(f.startsWith('#') ? f : '#' + f)}"></span>`).join('');
            return `<div class="aus-zeile">
                <div class="aus-bild">${bild
                    ? `<img src="${esc(bild)}" alt="" loading="lazy" onerror="this.remove()">`
                    : ''}<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg></div>
                <div class="aus-text">
                    <div class="aus-name"><span>${esc(name)}</span>${marke || ''}</div>
                    ${zeit ? `<div class="aus-klein">${esc(zeit)}</div>` : ''}
                    ${(menge || punkte) ? `<div class="aus-klein aus-menge">${punkte}${menge ? `<span>${esc(menge)}</span>` : ''}</div>` : ''}
                </div>
            </div>`;
        }

        _zeichnePlan() {
            const p = this.stand.geplant;
            if (!p) { this._feld('aus-plan', ''); return; }
            const bild = `/api/sd_thumbnail/${encodeURIComponent(p.dateiname)}`
                + (/\.3mf$/i.test(p.dateiname) && p.plate > 1 ? `?plate=${Number(p.plate)}` : '');
            this._feld('aus-plan',
                this._kopf(t('home_off_next_print', 'Nächster Druck'), t('home_off_planner', 'Planer'),
                           'openScheduleManager()')
                + `<div class="aus-tipp" onclick="openScheduleManager()">`
                + this._zeile({
                    bild, name: this._name(p.dateiname), zeit: [this._wann(p.zeit), p.dauer].filter(Boolean).join(' · '),
                    menge: p.spule
                })
                + (p.strom ? `<div class="aus-klein aus-strom"><svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/></svg> ${esc(t('home_off_auto_power', 'Schaltet den Drucker selbst ein'))}</div>` : '')
                + `</div>`);
        }

        _zeichneLetzter() {
            const l = this.stand.letzter;
            if (!l) { this._feld('aus-letzter', ''); return; }
            const menge = [
                l.gramm > 0 ? `${Math.round(l.gramm)} g` : null,
                l.kosten > 0 ? l.kosten.toLocaleString(sprache(), { style: 'currency', currency: 'EUR' }) : null
            ].filter(Boolean).join(' · ');
            this._feld('aus-letzter',
                this._kopf(t('home_off_last_print', 'Letzter Druck'), t('history', 'Historie'),
                           "location.href='/static/history.html'")
                + `<div class="aus-tipp" onclick="location.href='/static/history.html?print=${Number(l.id)}'">`
                + this._zeile({
                    bild: l.bild ? `/api/history/${Number(l.id)}/thumbnail` : null,
                    name: this._name(l.name),
                    marke: this._marke(l.status),
                    zeit: [this._wann(l.ende), this._dauer(l.minuten)].filter(Boolean).join(' · '),
                    farben: l.farben, menge
                })
                + `</div>`);
        }

        /** The next tasks, by the maintenance page's rules: whatever is
         *  overdue or close first; otherwise the page's own "next up" (the
         *  nearest date) and the consumption task nearest its target. The
         *  two kinds are not ranked against each other -- a roll count has
         *  no date. The desktop has room for a third. */
        _zeichneWartung() {
            const R = window.WartungRest;
            const aufgaben = Array.isArray(this.stand.wartung) ? this.stand.wartung : [];
            if (!R || !aufgaben.length) { this._feld('aus-wartung', ''); return; }
            const rang = r => (r.art === 'ueber' ? 2 : r.art === 'bald' ? 1 : 0);
            const bewertet = aufgaben.map(a => ({ a, r: R.restAngabe(a) }));
            const liste = bewertet.filter(x => x.r.art)
                .sort((x, y) => rang(y.r) - rang(x.r) || y.r.anteil - x.r.anteil);
            const termine = bewertet.filter(x => !R.istVerbrauch(x.a))
                .sort((x, y) => (x.a.days_until_due || 0) - (y.a.days_until_due || 0));
            const verbrauch = bewertet.filter(x => R.istVerbrauch(x.a))
                .sort((x, y) => y.r.anteil - x.r.anteil);
            const anzahl = window.innerWidth > 768 ? 3 : 2;
            for (const x of [termine[0], verbrauch[0], termine[1], verbrauch[1]]) {
                if (x && !liste.includes(x)) liste.push(x);
            }
            const zeilen = liste.slice(0, anzahl).map(({ a, r }) => {
                const ton = r.art === 'ueber' ? 'ueber' : r.art === 'bald' ? 'bald' : '';
                return `<div class="aus-wartung">
                    <div class="aus-wartung-kopf"><span>${esc(a.name)}</span>
                        <span class="aus-rest ${ton ? 'aus-rest--' + ton : ''}">${esc(R.restKurz(a))}</span></div>
                    <div class="aus-bahn"><i class="${ton ? 'aus-bahn--' + ton : ''}" style="width:${Math.max(2, Math.min(100, r.anteil)).toFixed(0)}%"></i></div>
                </div>`;
            }).join('');
            this._feld('aus-wartung',
                this._kopf(t('maintenance', 'Wartung'), t('home_off_plan', 'Plan'),
                           "location.href='/static/maintenance.html'")
                + `<div class="aus-tipp" onclick="location.href='/static/maintenance.html'">${zeilen}</div>`);
        }

        _zeichneMonat() {
            const m = this.stand.monat;
            if (!m) { this._feld('aus-monat', ''); return; }
            const [jahr, monat] = m.schluessel.split('-').map(Number);
            const name = new Date(jahr, monat - 1, 1).toLocaleDateString(sprache(), { month: 'long' });
            const zeit = m.minuten >= 60 ? `${Math.round(m.minuten / 60)} h` : `${m.minuten} min`;
            const menge = m.gramm >= 1000
                ? `${(m.gramm / 1000).toLocaleString(sprache(), { maximumFractionDigits: 1 })} kg`
                : `${Math.round(m.gramm)} g`;
            const zahl = (wert, text) => `<div class="aus-zahl"><b>${esc(wert)}</b><span>${esc(text)}</span></div>`;
            this._feld('aus-monat',
                this._kopf(name.charAt(0).toUpperCase() + name.slice(1),
                           t('history_tab_statistics', 'Statistik'),
                           "location.href='/static/history.html?tab=statistics'")
                + `<div class="aus-zahlen aus-tipp" onclick="location.href='/static/history.html?tab=statistics'">`
                + zahl(m.drucke, t('home_off_stat_prints', 'Drucke'))
                + zahl(m.erfolg != null ? `${m.erfolg} %` : '–', t('home_off_stat_success', 'Erfolg'))
                + zahl(zeit, t('home_off_stat_time', 'Druckzeit'))
                + zahl(menge, t('home_off_stat_filament', 'Filament'))
                + `</div>`);
        }

        // ------------------------------------------------------- text rules

        _name(datei) {
            return String(datei || '').split('/').pop().replace(/(\.gcode\.3mf|\.gcode|\.gco|\.3mf|\.g)$/i, '');
        }

        _datum(roh) {
            if (!roh) return null;
            const d = new Date(String(roh).replace(' ', 'T'));
            return isNaN(d) ? null : d;
        }

        /** "Gestern, 15:42" / "Morgen, 08:00" -- further off gets its date. */
        _wann(roh) {
            const d = this._datum(roh);
            if (!d) return null;
            const tag = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
            const abstand = Math.round((tag(d) - tag(new Date())) / 864e5);
            const uhr = d.toLocaleTimeString(sprache(), { hour: '2-digit', minute: '2-digit' });
            if (Math.abs(abstand) <= 1) {
                const wort = new Intl.RelativeTimeFormat(sprache(), { numeric: 'auto' }).format(abstand, 'day');
                return `${wort.charAt(0).toUpperCase() + wort.slice(1)}, ${uhr}`;
            }
            return `${d.toLocaleDateString(sprache(), { day: '2-digit', month: '2-digit' })}, ${uhr}`;
        }

        /** "47 min" or "3:50 h" -- the history's rule. */
        _dauer(min) {
            if (min == null) return null;
            if (min < 60) return `${Math.max(1, min)} min`;
            return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
        }

        _marke(status) {
            const art = { success: ['erfolg', 'status_success', 'Erfolgreich'],
                          failed: ['fehler', 'status_failed', 'Fehlgeschlagen'],
                          cancelled: ['abbruch', 'status_cancelled', 'Abgebrochen'] }[status];
            return art ? `<span class="aus-marke aus-marke--${art[0]}">${esc(t(art[1], art[2]))}</span>` : '';
        }
    }

    window.offOverview = new OffOverview();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && window.offOverview.aus) window.offOverview.laden();
    });
})();
