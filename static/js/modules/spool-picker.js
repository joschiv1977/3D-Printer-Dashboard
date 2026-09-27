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
        spools: [],
        treffer: [],       // IDs, die zur aktuellen Datei passen
        datei: null,       // Dateiname, wenn aus dem Planen/Drucken geoeffnet
        wanted: null,      // {material, color} der Datei
        material: null,    // Filter
        suche: '',
        sortierung: 'zuletzt',
        gewaehlt: null,
        onWahl: null,
        onKeine: null,   // "none of them" -- the answer to a question of the state
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
            color: fil.color_hex ? ('#' + String(fil.color_hex).replace('#', '').slice(0, 6)) : '#8a8a8a',
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
                <span class="spw-rad" style="--fuell:${prozent}; --farbe:${esc(a.color)};"><span>${prozent}%</span></span>
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
            feuchteSchwelle = daten.threshold;
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
                const v = e.history || [];
                return v.length ? String(v[v.length - 1].time || '') : '';
            };
            feuchteJeSpule = new Map();
            for (const e of (daten.history_spools || [])) {
                if (e.spool_id == null) continue;
                const bisher = feuchteJeSpule.get(e.spool_id);
                if (!bisher) { feuchteJeSpule.set(e.spool_id, e); continue; }
                const a = juengste(e), b = juengste(bisher);
                if (a > b || (a === b && e.inside && !bisher.inside)) {
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
        if (e.verdict === 'trocken') {
            text = t('humidity_verdict_dry', 'trocken');
        } else if (e.days_above >= 1) {
            text = t('humidity_short_days', '{n} d über {s} %')
                .replace('{n}', e.days_above.toFixed(e.days_above < 10 ? 1 : 0))
                .replace('{s}', feuchteSchwelle);
        } else {
            text = t('humidity_short_hours', '{n} h über {s} %')
                .replace('{n}', Math.max(1, Math.round(e.hours_above)))
                .replace('{s}', feuchteSchwelle);
        }
        // Clickable rather than just labelled: the history belongs in a window
        // of its own. Glued under the card, the curve looked like wallpaper
        // across eleven cards.
        // NOT a <button>: the card is one already, and a button inside a
        // button is invalid HTML -- the browser breaks the card open there.
        const titel = t('humidity_open', 'Feuchteverlauf zeigen');
        return `<span class="spw-feucht spw-feucht--${esc(e.verdict)}" role="button"`
             + ` tabindex="0" data-humidity="${spoolId}" title="${esc(titel)}">`
             + ikon('wasser') + esc(text) + ikon('chevronRechts') + '</span>';
    }

    /** The history of one spool as a window of its own. */
    function zeigeFeuchte(spoolId) {
        const e = feuchteJeSpule.get(spoolId);
        if (!e || !window.amsHumidity) return;
        const spule = zustand.spools.find(x => x.id === spoolId) || {};
        const fil = spule.filament || {};
        const name = [((fil.vendor || {}).name || ''), fil.name || ''].filter(Boolean).join(' ')
            || (e.type || '');
        const zeit = window.amsHumidity.spanne(e.history);
        const letzte = window.amsHumidity.letzteZeit(e.history);
        const kurve = window.amsHumidity.kurve(e.history, feuchteSchwelle, 480, 96);
        const worte = {
            trocken: t('humidity_verdict_dry', 'trocken'),
            beobachten: t('humidity_verdict_watch', 'im Blick behalten'),
            trocknen: t('humidity_verdict_needs_drying', 'trocknen'),
        };
        const ueber = e.days_above >= 1
            ? t('humidity_short_days', '{n} d über {s} %')
                .replace('{n}', e.days_above.toFixed(e.days_above < 10 ? 1 : 0))
                .replace('{s}', feuchteSchwelle)
            : (e.hours_above > 0
                ? t('humidity_short_hours', '{n} h über {s} %')
                    .replace('{n}', Math.max(1, Math.round(e.hours_above)))
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
                    <span class="spf-urteil spf-urteil--${esc(e.verdict)}">${esc(worte[e.verdict] || e.verdict)}</span>
                    ${zeit.text ? `<span class="spf-spanne">${esc(zeit.text)}</span>` : ''}
                    ${letzte ? `<span class="spf-spanne">${esc(letzte)}</span>` : ''}
                    <span class="spf-grenze">${esc(t('humidity_threshold', 'Grenze {s} %')
                        .replace('{s}', feuchteSchwelle))}</span>
                </div>
                ${kurve || `<div class="fk-frisch">${esc(t('humidity_too_short',
                    'Noch zu wenig aufgezeichnet für einen Verlauf.'))}</div>`}
                <div class="spf-werte">
                    ${wert(t('humidity_now', 'Jetzt'), e.now + ' %')}
                    ${wert(t('humidity_max', 'Spitze'), e.max + ' %')}
                    ${wert(t('humidity_above', 'Über der Grenze'), ueber)}
                    ${wert(t('humidity_dwell', 'Im AMS'), Math.round(e.hours) + ' h')}
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
        let liste = zustand.spools.filter(spool => {
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
        zustand.spools.forEach(s => {
            const f = familie(anzeigeName(s).material);
            if (!f) return;
            zaehler[f] = zaehler[f] || { n: 0, color: anzeigeName(s).color };
            zaehler[f].n++;
        });
        const chips = [`<button type="button" class="spw-chip${zustand.material ? '' : ' spw-chip--an'}"
                          data-material="">${esc(t('all', 'Alle'))} <b>${zustand.spools.length}</b></button>`];
        Object.keys(zaehler).sort().forEach(f => {
            chips.push(`<button type="button" class="spw-chip${zustand.material === f ? ' spw-chip--an' : ''}"
                          data-material="${esc(f)}">
                          <i class="spw-chip-punkt" style="background:${esc(zaehler[f].color)}"></i>
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
        const offen = (feuchteStand.spools || []).filter(s => s.spool_id == null);
        if (!offen.length) return '';
        return offen.map(s => {
            const vorschlag = (s.suggestions || [])[0];
            return '<div class="spw-hinweis-zeile">'
                 + esc(t('humidity_unassigned',
                         'Fach {n} im AMS ist keiner Spule zugeordnet.')
                       .replace('{n}', (s.slot ?? 0) + 1))
                 + (vorschlag
                    ? ' <b>' + esc(t('humidity_suggestion', 'Vorschlag: {name}')
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
        // Right after a page load the manager has not asked the server yet,
        // and `connected` is false until it has. "Assign spool" on the
        // messages page opens the main page and the picker in the same
        // moment: on 18sep26 it said "Spoolman must be enabled" instead of
        // opening. Ask first, then decide.
        if (sm && !sm.connected && typeof sm.checkStatus === 'function') {
            await sm.checkStatus();
        }
        if (!sm || !sm.connected) {
            window.skToast && window.skToast(t('spoolman_required', 'Spoolman nicht verbunden'), 'warning');
            return;
        }
        // The list is no longer reloaded every 30 s (spoolman-manager.js); it
        // is fetched here, where somebody is about to look at it.
        if (sm.ensureSpools) await sm.ensureSpools();

        zustand = Object.assign(zustand, {
            spools: sm.spools || [],
            // Candidates: from the file's match, or handed in (the
            // filament state suggests spools for its open question).
            treffer: Array.isArray(opts.treffer) ? opts.treffer : [],
            datei: opts.datei || null,
            wanted: null,
            material: null,
            suche: '',
            gewaehlt: opts.gewaehlt != null ? opts.gewaehlt : (window.activeSpoolId || null),
            onWahl: opts.onWahl || null,
            onKeine: opts.onKeine || null,
        });

        const fenster = document.getElementById('spoolPickerModal');
        if (!fenster) return;
        // "No spool" only where the picker activates directly (the material
        // card) and only while there is an active spool to clear.
        const abwahl = document.getElementById('spw-abwaehlen');
        // "No spool": for a question of the state it is the answer "none of
        // them"; on the material card it clears the active spool.
        if (abwahl) {
            abwahl.hidden = zustand.onKeine
                ? false : (!!zustand.onWahl || !window.activeSpoolId);
        }
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
        const spule = zustand.spools.find(s => s.id === id);
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
        const feucht = e.target.closest && e.target.closest('[data-humidity]');
        if (feucht) {
            // Do not select the card -- the click was meant for the badge.
            e.preventDefault();
            e.stopPropagation();
            zeigeFeuchte(parseInt(feucht.dataset.humidity, 10));
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

    /** "No spool": clears the active spool on the server (material card only). */
    async function abwaehlen() {
        if (zustand.onKeine) {
            const fertig = zustand.onKeine;
            schliesse();
            fertig();
            return;
        }
        const sm = window.spoolmanManager;
        if (!sm) return;
        if (await sm.deactivate()) schliesse();
    }

    window.spoolPicker = { oeffne, schliesse, uebernehmen, abwaehlen };
    window.openSpoolPicker = (opts) => oeffne(opts);
})();
