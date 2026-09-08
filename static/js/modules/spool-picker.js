/**
 * Spool selection
 * ==========================================================================
 * A window of its own instead of the picker list in the material card.
 *
 * The list could only manage one line of text per spool -- name, material,
 * grams, per cent, all in a row. But on a spool change one looks for COLOUR
 * and remaining amount, and both were only readable there after unfolding.
 *
 * Every spool is a ring here: the outer ring carries the filament colour and
 * is filled as far as the spool is still full. Colour and remainder at a
 * glance.
 *
 * The card tells four states itself:
 *   match   -- blue, from /api/spoolman/match for the chosen file
 *   active  -- green
 *   low     -- orange, under KNAPP_GRAMM
 *   empty   -- dimmed, not selectable
 */
(function () {
    'use strict';

    /** From here a spool counts as "low" -- the same threshold as the server warner. */
    const KNAPP_GRAMM = 50;

    /** Density in g/cm3 per material family, for the length estimate. */
    const DICHTE = {
        pla: 1.24, petg: 1.27, abs: 1.04, asa: 1.07,
        tpu: 1.21, pc: 1.20, nylon: 1.14, hips: 1.04, pva: 1.23,
    };

    let zustand = {
        spulen: [],
        treffer: [],       // IDs, die zur aktuellen Datei passen
        datei: null,       // Dateiname, wenn aus dem Planen/Drucken geoeffnet
        wanted: null,      // {material, color} der Datei
        material: null,    // Filter
        suche: '',
        sortierung: 'zuletzt',
        gewaehlt: null,
        onWahl: null,
    };

    const t = (schluessel, standard) => (window.texts || {})[schluessel] || standard;
    const esc = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    /** Material family -- the same grouping as on the server. */
    function familie(material) {
        const m = String(material || '').toLowerCase().trim();
        for (const schluessel of Object.keys(DICHTE)) {
            if (m.startsWith(schluessel)) return schluessel;
        }
        return m;
    }

    /**
     * Grams into running metres. Estimated: density per material, diameter
     * from the spool (falling back to 1.75 mm). It stands small beside the
     * remaining amount, so one knows whether the print fits at all.
     */
    function meter(spool) {
        const gramm = spool.remaining_weight || 0;
        if (gramm <= 0) return null;
        const fil = spool.filament || {};
        const dichte = DICHTE[familie(fil.material)] || 1.24;
        const durchmesser = fil.diameter || 1.75;      // mm
        const flaeche = Math.PI * Math.pow(durchmesser / 20, 2);  // cm2
        const laenge = gramm / dichte / flaeche;       // cm
        return Math.round(laenge / 100);               // m
    }

    /** "today, 06:10" · "3 days ago" · "2 months ago" · "new" */
    function zuletzt(iso) {
        if (!iso) return t('spool_never_used', 'neu');
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const tage = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (tage <= 0) {
            return t('spool_today', 'heute') + ', ' +
                d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        if (tage === 1) return t('spool_yesterday', 'gestern');
        if (tage < 31) return t('spool_days_ago', 'vor {n} Tagen').replace('{n}', tage);
        const monate = Math.round(tage / 30);
        return monate === 1
            ? t('spool_month_ago', 'vor 1 Monat')
            : t('spool_months_ago', 'vor {n} Monaten').replace('{n}', monate);
    }

    function anzeigeName(spool) {
        const fil = spool.filament || {};
        return {
            hersteller: (fil.vendor && fil.vendor.name) || '',
            name: fil.name || t('unknown', 'Unbekannt'),
            material: fil.material || '',
            farbe: fil.color_hex ? ('#' + String(fil.color_hex).replace('#', '').slice(0, 6)) : '#8a8a8a',
        };
    }

    // ======================================================================
    // Zeichnen
    // ======================================================================

    function karteHtml(spool) {
        const a = anzeigeName(spool);
        const rest = Math.round(spool.remaining_weight || 0);
        const prozent = Math.max(0, Math.min(100, Math.round(spool.remaining_percentage || 0)));
        const m = meter(spool);
        const leer = rest <= 0;
        const knapp = !leer && rest < KNAPP_GRAMM;
        const aktiv = spool.id === window.activeSpoolId;
        const passt = zustand.treffer.includes(spool.id);

        const klassen = ['spw-spule'];
        if (passt) klassen.push('spw-spule--passt');
        if (aktiv) klassen.push('spw-spule--aktiv');
        if (knapp) klassen.push('spw-spule--knapp');
        if (leer) klassen.push('spw-spule--leer');
        if (spool.id === zustand.gewaehlt) klassen.push('spw-spule--wahl');

        let marke = '';
        if (aktiv) {
            marke = `<span class="spw-marke spw-marke--aktiv">${ikon('haken')}${esc(t('spool_active', 'Aktiv'))}</span>`;
        } else if (passt) {
            marke = `<span class="spw-marke spw-marke--passt">${ikon('haken')}${esc(t('spool_fits', 'Passt'))}</span>`;
        } else if (knapp) {
            marke = `<span class="spw-marke spw-marke--knapp">${ikon('warnung')}${esc(t('spool_low', 'Knapp'))}</span>`;
        }

        const fuss = [
            `<span>${ikon('uhr')}${esc(zuletzt(spool.last_used))}</span>`,
            spool.price != null || (spool.filament || {}).price != null
                ? `<span>${esc(((spool.price != null ? spool.price : spool.filament.price)).toFixed(2))} €</span>` : '',
            spool.location ? `<span>${esc(spool.location)}</span>` : '',
            feuchteChip(spool.id),
        ].filter(Boolean).join('');

        return `
            <button type="button" class="${klassen.join(' ')}" data-id="${spool.id}"${leer ? ' disabled' : ''}>
                ${marke}
                <span class="spw-rad" style="--fuell:${prozent}; --farbe:${esc(a.farbe)};"><span>${prozent}%</span></span>
                <span class="spw-text">
                    <span class="spw-hersteller">${esc(a.hersteller)}</span>
                    <span class="spw-name">${esc(a.name)}</span>
                    <span class="spw-zeile">
                        ${a.material ? `<span class="spw-material">${esc(a.material)}</span>` : ''}
                        <span class="spw-rest">${rest} g</span>
                        ${m ? `<span class="spw-meter">≈ ${m} m</span>` : ''}
                    </span>
                    <span class="spw-fuss">${fuss}</span>
                </span>
            </button>`;
    }

    function ikon(name) {
        return window.skIcon ? window.skIcon(name, 'hd-ic--xs') : '';
    }

    // Humidity memory per Spoolman number. The bridge comes into being at the
    // print start (print_filaments holds spool_id and ams_tray_id together),
    // so not every spool has an entry -- only what was really measured is shown.
    let feuchteJeSpule = new Map();
    let feuchteStand = {};
    let feuchteSchwelle = 35;

    async function ladeFeuchte() {
        if (!window.amsHumidity) return;
        try {
            const daten = await window.amsHumidity.hole(400);
            if (!daten) return;
            feuchteSchwelle = daten.schwelle;
            feuchteStand = daten;
            // Several rows can point at the same Spoolman number: one per
            // spell in the tray, and a spool often lies in there more than
            // once. `new Map([...])` takes the LAST on an equal key -- with no
            // rule at all about which is the right one. A row that ended at
            // 14:16 once won that way while the open one had measured until
            // 15:43: the window showed the state from an hour and a half
            // earlier.
            //
            // Now the row with the most recent measurement wins; on a tie the
            // one still open.
            const juengste = e => {
                const v = e.verlauf || [];
                return v.length ? String(v[v.length - 1].zeit || '') : '';
            };
            feuchteJeSpule = new Map();
            for (const e of (daten.verlauf_spulen || [])) {
                if (e.spool_id == null) continue;
                const bisher = feuchteJeSpule.get(e.spool_id);
                if (!bisher) { feuchteJeSpule.set(e.spool_id, e); continue; }
                const a = juengste(e), b = juengste(bisher);
                if (a > b || (a === b && e.bis == null && bisher.bis != null)) {
                    feuchteJeSpule.set(e.spool_id, e);
                }
            }
        } catch (e) { /* ohne Feuchte bleibt es die einfache Auswahl */ }
    }

    /** The badge on the card: the verdict and how long it was too damp. */
    function feuchteChip(spoolId) {
        const e = feuchteJeSpule.get(spoolId);
        if (!e) return '';
        let text;
        if (e.urteil === 'trocken') {
            text = t('feuchte_urteil_trocken', 'trocken');
        } else if (e.tage_ueber >= 1) {
            text = t('feuchte_kurz_tage', '{n} d über {s} %')
                .replace('{n}', e.tage_ueber.toFixed(e.tage_ueber < 10 ? 1 : 0))
                .replace('{s}', feuchteSchwelle);
        } else {
            text = t('feuchte_kurz_stunden', '{n} h über {s} %')
                .replace('{n}', Math.max(1, Math.round(e.stunden_ueber)))
                .replace('{s}', feuchteSchwelle);
        }
        // Clickable rather than just labelled: the history belongs in a window
        // of its own. Glued under the card, the curve looked like wallpaper
        // across eleven cards.
        // NOT a <button>: the card is one already, and a button inside a
        // button is invalid HTML -- the browser breaks the card open there.
        const titel = t('feuchte_open', 'Feuchteverlauf zeigen');
        return `<span class="spw-feucht spw-feucht--${esc(e.urteil)}" role="button"`
             + ` tabindex="0" data-feuchte="${spoolId}" title="${esc(titel)}">`
             + ikon('wasser') + esc(text) + ikon('chevronRechts') + '</span>';
    }

    /** The history of one spool as a window of its own. */
    function zeigeFeuchte(spoolId) {
        const e = feuchteJeSpule.get(spoolId);
        if (!e || !window.amsHumidity) return;
        const spule = zustand.spulen.find(x => x.id === spoolId) || {};
        const fil = spule.filament || {};
        const name = [((fil.vendor || {}).name || ''), fil.name || ''].filter(Boolean).join(' ')
            || (e.typ || '');
        const zeit = window.amsHumidity.spanne(e.verlauf);
        const kurve = window.amsHumidity.kurve(e.verlauf, feuchteSchwelle, 480, 96);
        const worte = {
            trocken: t('feuchte_urteil_trocken', 'trocken'),
            beobachten: t('feuchte_urteil_beobachten', 'im Blick behalten'),
            trocknen: t('feuchte_urteil_trocknen', 'trocknen'),
        };
        const ueber = e.tage_ueber >= 1
            ? t('feuchte_kurz_tage', '{n} d über {s} %')
                .replace('{n}', e.tage_ueber.toFixed(e.tage_ueber < 10 ? 1 : 0))
                .replace('{s}', feuchteSchwelle)
            : (e.stunden_ueber > 0
                ? t('feuchte_kurz_stunden', '{n} h über {s} %')
                    .replace('{n}', Math.max(1, Math.round(e.stunden_ueber)))
                    .replace('{s}', feuchteSchwelle)
                : '–');
        const wert = (kopf, w) => `<div class="spf-wert"><div class="spf-wert-kopf">${esc(kopf)}</div>`
            + `<div class="spf-wert-zahl">${esc(w)}</div></div>`;

        const alt = document.getElementById('spf-overlay');
        if (alt) alt.remove();
        const ov = document.createElement('div');
        ov.id = 'spf-overlay';
        ov.className = 'tray-edit-overlay';
        ov.innerHTML = `
            <div class="tray-edit-box spf-box">
                <h4>${esc(name)}</h4>
                <div class="spf-kopf">
                    <span class="spf-urteil spf-urteil--${esc(e.urteil)}">${esc(worte[e.urteil] || e.urteil)}</span>
                    ${zeit.text ? `<span class="spf-spanne">${esc(zeit.text)}</span>` : ''}
                    <span class="spf-grenze">${esc(t('feuchte_schwelle', 'Grenze {s} %')
                        .replace('{s}', feuchteSchwelle))}</span>
                </div>
                ${kurve || `<div class="fk-frisch">${esc(t('feuchte_zu_kurz',
                    'Noch zu wenig aufgezeichnet für einen Verlauf.'))}</div>`}
                <div class="spf-werte">
                    ${wert(t('feuchte_jetzt', 'Jetzt'), e.jetzt + ' %')}
                    ${wert(t('feuchte_max', 'Spitze'), e.max + ' %')}
                    ${wert(t('feuchte_ueber', 'Über der Grenze'), ueber)}
                    ${wert(t('feuchte_liegezeit', 'Im AMS'), Math.round(e.stunden) + ' h')}
                </div>
                <div class="tray-edit-actions">
                    <button class="tray-edit-cancel" id="spf-zu">${esc(t('settings_close', 'Schließen'))}</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        // Above the spool picker, which already lies in front.
        if (window.skNachVorn) window.skNachVorn(ov, 10050);
        const zu = () => ov.remove();
        ov.querySelector('#spf-zu').addEventListener('click', zu);
        ov.addEventListener('click', (ev) => { if (ev.target === ov) zu(); });
    }

    function gefiltert() {
        const suche = zustand.suche.trim().toLowerCase();
        let liste = zustand.spulen.filter(spool => {
            const a = anzeigeName(spool);
            if (zustand.material && familie(a.material) !== zustand.material) return false;
            if (!suche) return true;
            return `${a.hersteller} ${a.name} ${a.material}`.toLowerCase().includes(suche);
        });

        const rest = (s) => s.remaining_weight || 0;
        liste = liste.slice().sort((x, y) => {
            switch (zustand.sortierung) {
                case 'rest': return rest(y) - rest(x);
                case 'name': return anzeigeName(x).name.localeCompare(anzeigeName(y).name);
                case 'material': return familie(anzeigeName(x).material)
                    .localeCompare(familie(anzeigeName(y).material));
                default: {
                    const zx = x.last_used ? new Date(x.last_used).getTime() : 0;
                    const zy = y.last_used ? new Date(y.last_used).getTime() : 0;
                    return zy - zx;
                }
            }
        });

        // Matching spools to the top -- they are the reason the window opened.
        if (zustand.treffer.length) {
            liste.sort((x, y) =>
                (zustand.treffer.includes(y.id) ? 1 : 0) - (zustand.treffer.includes(x.id) ? 1 : 0));
        }
        return liste;
    }

    function materialChips() {
        const zaehler = {};
        zustand.spulen.forEach(s => {
            const f = familie(anzeigeName(s).material);
            if (!f) return;
            zaehler[f] = zaehler[f] || { n: 0, farbe: anzeigeName(s).farbe };
            zaehler[f].n++;
        });
        const chips = [`<button type="button" class="spw-chip${zustand.material ? '' : ' spw-chip--an'}"
                          data-material="">${esc(t('all', 'Alle'))} <b>${zustand.spulen.length}</b></button>`];
        Object.keys(zaehler).sort().forEach(f => {
            chips.push(`<button type="button" class="spw-chip${zustand.material === f ? ' spw-chip--an' : ''}"
                          data-material="${esc(f)}">
                          <i class="spw-chip-punkt" style="background:${esc(zaehler[f].farbe)}"></i>
                          ${esc(f.toUpperCase())} <b>${zaehler[f].n}</b></button>`);
        });
        return chips.join('');
    }

    function zeichne() {
        const raster = document.getElementById('spw-raster');
        if (!raster) return;
        const liste = gefiltert();
        raster.innerHTML = liste.length
            ? liste.map(karteHtml).join('')
            : `<div class="spw-leer">${esc(t('spool_none_found', 'Keine Spule gefunden'))}</div>`;

        // Say when a tray has no spool assigned.
        //
        // This used to stay silent: the card simply showed no badge, and
        // nobody could know there was something to set. Nothing is guessed any
        // more, so the hint has to be there.
        const hinweis = document.getElementById('spw-hinweis');
        if (hinweis) hinweis.innerHTML = ohneZuordnungHtml();

        const chips = document.getElementById('spw-chips');
        if (chips) chips.innerHTML = materialChips();

        const uebernehmen = document.getElementById('spw-uebernehmen');
        if (uebernehmen) uebernehmen.disabled = zustand.gewaehlt == null;
    }

    /** Trays in the AMS with no Spoolman spool assigned. */
    function ohneZuordnungHtml() {
        const offen = (feuchteStand.spulen || []).filter(s => s.spool_id == null);
        if (!offen.length) return '';
        return offen.map(s => {
            const vorschlag = (s.vorschlaege || [])[0];
            return '<div class="spw-hinweis-zeile">'
                 + esc(t('feuchte_ohne_zuordnung',
                         'Fach {n} im AMS ist keiner Spule zugeordnet.')
                       .replace('{n}', (s.slot ?? 0) + 1))
                 + (vorschlag
                    ? ' <b>' + esc(t('feuchte_vorschlag', 'Vorschlag: {name}')
                                   .replace('{name}', vorschlag.name || '')) + '</b>'
                    : '')
                 + '</div>';
        }).join('');
    }

    function bandHtml() {
        if (!zustand.datei || !zustand.wanted) return '';
        const anzahl = zustand.treffer.length;
        const text = anzahl === 0
            ? t('spool_band_none', 'Für {file} passt keine der vorhandenen Spulen.')
                .replace('{file}', zustand.datei)
            : t('spool_band', 'Für {file} passen {n} Spulen — {material}')
                .replace('{file}', zustand.datei)
                .replace('{n}', anzahl)
                .replace('{material}', zustand.wanted.material || '');
        return `<div class="spw-band${anzahl ? '' : ' spw-band--leer'}">
                    ${ikon(anzahl ? 'haken' : 'warnung')}<span>${esc(text)}</span>
                </div>`;
    }

    // ======================================================================
    // Oeffnen / Schliessen
    // ======================================================================

    /**
     * @param {object} opts
     *   datei   -- file name; it sets the recommendation band and the matches
     *   plate   -- plate number (default 1)
     *   gewaehlt-- preselected spool id
     *   onWahl  -- callback with the chosen spool; without it the spool is
     *              activated directly (the material card)
     */
    async function oeffne(opts = {}) {
        const sm = window.spoolmanManager;
        if (!sm || !sm.connected) {
            window.skToast && window.skToast(t('spoolman_required', 'Spoolman nicht verbunden'), 'warning');
            return;
        }

        zustand = Object.assign(zustand, {
            spulen: sm.spools || [],
            treffer: [],
            datei: opts.datei || null,
            wanted: null,
            material: null,
            suche: '',
            gewaehlt: opts.gewaehlt != null ? opts.gewaehlt : (window.activeSpoolId || null),
            onWahl: opts.onWahl || null,
        });

        const fenster = document.getElementById('spoolPickerModal');
        if (!fenster) return;
        // The tray dialog sits at z-index 10050. Without this the picker
        // opened BEHIND it -- only the dimming was visible.
        if (window.skNachVorn) window.skNachVorn(fenster, 1006);
        fenster.style.display = 'block';
        document.getElementById('spw-band').innerHTML = '';
        zeichne();
        ladeFeuchte().then(() => { if (feuchteJeSpule.size) zeichne(); });

        // Load the matching spools -- the matching lives on the server, so the
        // list, scheduling and an immediate print share one opinion.
        if (opts.datei) {
            try {
                const antwort = await window.apiCall(
                    `/api/spoolman/match?file=${encodeURIComponent(opts.datei)}&plate=${opts.plate || 1}`);
                const daten = await antwort.json();
                zustand.wanted = daten.wanted || null;
                zustand.treffer = (daten.candidates || []).map(k => k.spool.id);
                document.getElementById('spw-band').innerHTML = bandHtml();
                zeichne();
            } catch (e) {
                /* without matches it stays the plain picker */
            }
        }
    }

    function schliesse() {
        const fenster = document.getElementById('spoolPickerModal');
        if (fenster) fenster.style.display = 'none';
    }

    function uebernehmen() {
        const id = zustand.gewaehlt;
        if (id == null) return;
        const spule = zustand.spulen.find(s => s.id === id);
        if (zustand.onWahl) {
            zustand.onWahl(spule);
        } else if (window.activateSpool) {
            window.activateSpool(id);
        }
        schliesse();
    }

    // ======================================================================
    // Bedienung
    // ======================================================================

    document.addEventListener('click', (e) => {
        const feucht = e.target.closest && e.target.closest('[data-feuchte]');
        if (feucht) {
            // Do not select the card -- the click was meant for the badge.
            e.preventDefault();
            e.stopPropagation();
            zeigeFeuchte(parseInt(feucht.dataset.feuchte, 10));
            return;
        }
        const karte = e.target.closest && e.target.closest('.spw-spule');
        if (karte && !karte.disabled) {
            zustand.gewaehlt = parseInt(karte.dataset.id, 10);
            zeichne();
            return;
        }
        const chip = e.target.closest && e.target.closest('.spw-chip');
        if (chip) {
            zustand.material = chip.dataset.material || null;
            zeichne();
        }
    });

    document.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'spw-suche') {
            zustand.suche = e.target.value;
            zeichne();
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'spw-sortierung') {
            zustand.sortierung = e.target.value;
            zeichne();
        }
    });

    window.spoolPicker = { oeffne, schliesse, uebernehmen };
    window.openSpoolPicker = (opts) => oeffne(opts);
})();
