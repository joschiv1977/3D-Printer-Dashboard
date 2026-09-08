/**
 * Print preparation — the step between "Print" and the actual start.
 *
 * The printer does the same thing on its own display: first a sheet with
 * preview, plate, nozzles, filament and all options, then start printing.
 * For us the options used to sit behind the gear icon in the file list —
 * anyone who wanted to see them while printing had to have opened it first.
 *
 * The option fields deliberately keep the same classes and data-file
 * attributes as before in the list: collectPrintOptions() in
 * print-actions.js still reads them out unchanged.
 */
(function () {
    'use strict';

    let aktuell = null;   // { filename, location, daten, plate }

    /**
     * Label for a plate tile.
     *
     * The server does send a `name` field, but it's hardcoded in English
     * ("Plate 3") — next to it sat the translated heading "PLATTE".
     * The number lives in `index`; the rest of the label is built here,
     * so the language matches too.
     */
    const plattenName = (p) => `${t('print_prepare_plate', 'Platte')} ${p.index}`;

    /**
     * Label for the start button.
     *
     * If a spool question still follows this sheet, "Drucken" (Print)
     * promises too much. The answer comes from the server
     * (`spulenauswahl_noetig`) and is the same one the print command later
     * relies on. Before, there was a guess of our own here — "multiple
     * filaments" — which caught multi-color prints but not a single-filament
     * print whose material doesn't match the loaded spool (reported 02sep26).
     */
    function setzeStartKnopf(daten) {
        const knopf = document.getElementById('prep-start');
        if (!knopf) return;
        knopf.textContent = daten && daten.spulenauswahl_noetig
            ? t('print_prepare_continue', 'Weiter')
            : t('print', 'Drucken');
    }

    const esc = (t) => String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function t(key, fallback) {
        const texts = window.texts || {};
        return texts[key] || fallback;
    }

    function dauer(sekunden) {
        if (!sekunden || sekunden <= 0) return null;
        const h = Math.floor(sekunden / 3600);
        const m = Math.round((sekunden % 3600) / 60);
        return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    }

    /** Icon glyph before a row label. The label itself is passed through
     *  esc(), so it cannot contain markup. */
    function zeichen(name) {
        return name ? window.skIcon(name, 'hd-ic--xs') + ' ' : '';
    }

    /** Segmented choice (auto / on / off) — the same building blocks as in
     *  the previous options list, so the look stays the same. */
    function stufenReihe(cls, datei, label, vorgabe, symbol) {
        const knopf = (v, txt) =>
            `<label class="sd-popover-tri__opt">` +
            `<input type="radio" name="${cls}-prep" class="${cls}" data-file="${esc(datei)}" ` +
            `value="${v}"${v === vorgabe ? ' checked' : ''}><span>${esc(txt)}</span></label>`;
        return `<div class="prep-row prep-row--tri">
            <span class="prep-row__label">${zeichen(symbol)}${esc(label)}</span>
            <span class="sd-popover-tri">
                ${knopf(2, t('cali_auto', 'Auto'))}${knopf(1, t('cali_on', 'Ein'))}${knopf(0, t('cali_off', 'Aus'))}
            </span>
        </div>`;
    }

    function schalterReihe(cls, datei, label, an, symbol) {
        return `<div class="prep-row prep-row--sw">
            <span class="prep-row__label">${zeichen(symbol)}${esc(label)}</span>
            <label class="prep-switch">
                <input type="checkbox" class="${cls}" data-file="${esc(datei)}"${an ? ' checked' : ''}>
                <span></span>
            </label>
        </div>`;
    }

    function zeichneOptionen(datei, vorgaben, mehrfarbig) {
        const stufe = (wert, haken, wennAn) =>
            [0, 1, 2].includes(wert) ? wert : (haken ? wennAn : 0);

        let html = schalterReihe('print-opt-timelapse', datei,
            t('timelapse', 'Timelapse'), vorgaben.timelapse !== false, 'kamera');
        // Where the timelapse goes. The printer takes the destination from
        // the job — there's no separate settings command for it — that's
        // why the choice lives here and not in settings.
        html += schalterReihe('print-opt-timelapse-intern', datei,
            t('timelapse_intern', 'Timelapse intern speichern'),
            vorgaben.timelapse_intern === true, 'karte');
        html += schalterReihe('print-opt-use-ams', datei,
            t('use_ams', 'AMS verwenden'), vorgaben.use_ams === true, 'palette');
        html += stufenReihe('print-opt-bed-leveling', datei,
            t('bed_leveling_short', 'Bett-Nivellierung'),
            stufe(vorgaben.bed_leveling_mode, vorgaben.bed_leveling !== false, 2), 'lineal');
        html += stufenReihe('print-opt-flow-cali', datei,
            t('flow_calibration_short', 'Fluss-Kalibrierung'),
            stufe(vorgaben.flow_cali_mode, vorgaben.flow_cali === true, 2), 'welle');
        // The nozzle offset row always stays visible. What it defaults to
        // is decided by the server's PRESET: if the print uses both nozzles
        // it starts on "on", otherwise "off". You can still switch it by
        // hand — hiding it entirely was the wrong answer on 28aug26.
        html += stufenReihe('print-opt-nozzle-offset', datei,
            t('nozzle_offset_short', 'Düsenversatz'),
            stufe(vorgaben.nozzle_offset_mode, false, 0), 'ziel');
        html += schalterReihe('print-opt-layer-inspect', datei,
            t('layer_inspect_short', 'Schicht-Inspektion'), vorgaben.layer_inspect !== false, 'auge');
        html += schalterReihe('print-opt-vibration-cali', datei,
            t('vibration_calibration_short', 'Vibrations-Kalibrierung'), vorgaben.vibration_cali === true, 'puls');
        if (mehrfarbig) {
            html += schalterReihe('print-opt-manual-color-change', datei,
                t('manual_color_change_short', 'Manueller Farbwechsel'),
                vorgaben.manual_color_change !== false, 'palette');
        }

        // Drying during the print. Only with a heated AMS, and suggested
        // when the active spool has been sitting for a while — Spoolman
        // tracks last_used, the same source as the hint in the material zone.
        const lagerhinweis = trocknungVorschlag();
        if (lagerhinweis.moeglich) {
            const gemessen = feuchteHinweis();
            html += schalterReihe('print-opt-dry-during', datei,
                t('dry_during_print', 'Filament während des Drucks trocknen'),
                !!gemessen || lagerhinweis.vorschlagen, 'tropfen');
            if (gemessen) {
                html += `<div class="prep-hinweis prep-hinweis--mess">${esc(gemessen.text)}</div>`;
            } else if (lagerhinweis.tage) {
                html += `<div class="prep-hinweis">${esc(
                    t('dry_spool_stale', 'Diese Spule wurde seit {n} Tagen nicht benutzt — vielleicht feucht.')
                        .replace('{n}', lagerhinweis.tage))}</div>`;
            }
        }
        return html;
    }

    /**
     * Should drying during the print be suggested?
     *
     * `moeglich` depends on a heated AMS (AMS HT / 2 Pro), `vorschlagen` on
     * how long the active spool has been sitting. The 30 days is the same
     * threshold as the hint in the material zone — one number in two places
     * would be one too many, so it lives here as a constant with the same name.
     */
    const TAGE_BIS_FEUCHT = 30;

    function trocknungVorschlag() {
        const faehig = window.lastCapabilities
            || (window.lastPrintData && window.lastPrintData.capabilities) || {};
        if (faehig.ams_drying !== true) return { moeglich: false };

        const sm = window.spoolmanManager;
        const spule = (sm && sm.spools || []).find(x => x.id === (sm && sm.activeSpoolId));
        if (!spule || !spule.last_used) return { moeglich: true, vorschlagen: false, tage: 0 };

        // floor, not ceil: ceil rounds any started day up, so at exactly
        // 30 days it would show "31 days" and the switch would turn on
        // one day too early.
        const tage = Math.floor(Math.abs(Date.now() - new Date(spule.last_used)) / 86400000);
        return { moeglich: true, vorschlagen: tage > TAGE_BIS_FEUCHT, tage: tage > TAGE_BIS_FEUCHT ? tage : 0 };
    }

    /**
     * What the AMS measured takes priority over the storage time from Spoolman.
     *
     * `last_used` only says when the spool was last active — it doesn't know
     * whether it got humid during that time. The humidity memory does know.
     * That's why the measured hint comes before the estimated one; only when
     * nothing was measured does it fall back to the old day counter.
     */
    function feuchteHinweis() {
        const daten = feuchteStand;
        if (!daten) return null;
        const nass = (daten.spulen || []).filter(sp => sp.urteil === 'trocknen');
        if (!nass.length) return null;
        // The longest time sitting sets the tone — it's the reason given.
        nass.sort((a, b) => b.tage_ueber - a.tage_ueber);
        const s = nass[0];
        return {
            text: t('dry_spool_wet', 'Fach {slot} ({typ}) lag {n} Tage über {s} % Feuchte.')
                .replace('{slot}', s.slot + 1)
                .replace('{typ}', s.typ || '?')
                .replace('{n}', s.tage_ueber.toFixed(s.tage_ueber < 10 ? 1 : 0))
                .replace('{s}', daten.schwelle),
        };
    }

    // The status is fetched on open; zeichneOptionen runs synchronously and
    // can't wait for it. If it's not there yet, the day counter takes over.
    let feuchteStand = null;

    async function holeFeuchte() {
        if (!window.amsHumidity) return null;
        try { feuchteStand = await window.amsHumidity.hole(14); } catch (e) { feuchteStand = null; }
        return feuchteStand;
    }

    function zeichneFilamente(daten) {
        const seiten = {
            1: t('spool_left', 'Links'),
            2: t('spool_right', 'Rechts'),
        };
        const einDuesig = (daten.nozzle_count || 1) < 2;
        return (daten.filaments || []).map(f => {
            const seite = einDuesig ? t('spool_external', 'Externe Spule')
                                    : (seiten[f.extruder] || String(f.extruder));
            const farbe = esc(f.color || '#888888');
            return `<div class="prep-row">
                <span class="prep-row__label">${esc(seite)}</span>
                <span class="prep-filament">
                    <span class="prep-filament__dot" style="background:${farbe};"></span>
                    <strong>${esc(f.type || '')}</strong>
                    <span class="prep-filament__name">${esc(f.name || '')}</span>
                </span>
            </div>`;
        }).join('');
    }

    function zeichnePlatten(daten) {
        const block = document.getElementById('prep-plates-block');
        const liste = document.getElementById('prep-plates');
        if (!block || !liste) return;
        const platten = daten.plates || [];
        block.style.display = platten.length > 1 ? '' : 'none';
        if (platten.length <= 1) return;

        liste.innerHTML = platten.map(p => `
            <button class="prep-plate${p.index === aktuell.plate ? ' prep-plate--on' : ''}"
                    onclick="window.printPrepare.waehlePlatte(${p.index})">
                ${p.thumbnail ? `<img src="${imageDataUrl(p.thumbnail)}" alt="">` : ''}
                <span>${esc(plattenName(p))}</span>
            </button>`).join('');
    }

    /**
     * Which filament the file needs — with a color dot like in the file
     * list. Belongs on EVERY file card: without it you'd have to expand
     * "Details" first just to see which spool you're choosing for.
     *
     * For sliced .gcode.3mf files, /api/print_preview returns no
     * `filaments` (the parser returns an empty list for a SINGLE filament)
     * — then the info only lives in the file list.
     */
    function filamentFakt(daten, filename) {
        let liste = daten.filaments || [];
        if (!liste.length) {
            const ausListe = window.sdDateiFinden ? window.sdDateiFinden(filename)
                : (window.lastSDFiles || []).find(f => f && f.name === filename);
            const material = ausListe && (ausListe.filament_material || ausListe.filament_type);
            if (material) {
                liste = [{ type: material, name: '', color: ausListe.filament_color }];
            }
        }
        if (!liste.length) return '';

        const punkt = (farbe) =>
            `<span class="prep-fil-punkt" style="background:${esc(farbe || '#888')};"></span>`;

        if (liste.length === 1) {
            const f0 = liste[0] || {};
            const bezeichnung = [f0.name, f0.type].filter(Boolean).join(' · ') || f0.type || '';
            if (!bezeichnung) return '';
            return (f0.color ? punkt(f0.color) : '') + esc(bezeichnung);
        }
        return liste.slice(0, 6).map(f => punkt(f.color)).join('')
            + esc((t('multifilament_count', '{count} Filamente'))
                .replace('{count}', liste.length));
    }

    function zeichne(daten) {
        const facts = [];
        const zeit = dauer(daten.print_time_seconds);
        if (zeit) facts.push(`${window.skIcon('uhr', 'hd-ic--xs')} ${zeit}`);
        if (daten.weight_grams) facts.push(`${window.skIcon('waage', 'hd-ic--xs')} ${Math.round(daten.weight_grams)} g`);
        if (daten.bed_type) facts.push(`${window.skIcon('bett', 'hd-ic--xs')} ${esc(daten.bed_type)}`);
        if (daten.nozzle_diameter) {
            const anzahl = daten.nozzle_count || 1;
            const d = daten.nozzle_diameter + ' mm';
            facts.push(window.skIcon('ziel', 'hd-ic--xs') + ' ' + (anzahl > 1 ? `${d} / ${d}` : d));
        }
        if (daten.layer_height) facts.push(`${window.skIcon('winkel', 'hd-ic--xs')} ${daten.layer_height} mm`);
        const fil = filamentFakt(daten, aktuell && aktuell.filename);
        if (fil) facts.push(fil);

        document.getElementById('prep-filename').textContent = daten.filename;
        document.getElementById('prep-facts').innerHTML =
            facts.map(f => `<span class="prep-fact">${f}</span>`).join('');

        const bild = document.getElementById('prep-thumb');
        if (daten.thumbnail) {
            bild.src = imageDataUrl(daten.thumbnail);
            bild.style.display = '';
        } else {
            bild.style.display = 'none';
        }

        zeichnePlatten(daten);

        const filBlock = document.getElementById('prep-filament-block');
        const filamente = daten.filaments || [];
        filBlock.style.display = filamente.length ? '' : 'none';
        document.getElementById('prep-filaments').innerHTML = zeichneFilamente(daten);

        document.getElementById('prep-options').innerHTML =
            zeichneOptionen(aktuell.filename, daten.defaults || {},
                            daten.manual_color_change_possible === true);
    }

    async function oeffne(filename, location) {
        const modal = document.getElementById('printPrepareModal');
        if (!modal) return false;

        aktuell = { filename, location, plate: null, daten: null };
        document.getElementById('prep-title').textContent = t('print_prepare_title', 'Druck vorbereiten');
        document.getElementById('prep-cancel').textContent = t('cancel', 'Abbrechen');
        document.getElementById('prep-start').textContent = t('print', 'Drucken');
        document.getElementById('prep-plates-title').textContent = t('print_prepare_plate', 'Platte');
        document.getElementById('prep-filament-title').textContent = t('print_prepare_filament', 'Filament');
        document.getElementById('prep-options-title').textContent = t('print_options', 'Optionen');
        document.getElementById('prep-loading').style.display = 'block';
        document.getElementById('prep-body').style.display = 'none';
        // Since the rework, the footer sits outside prep-body and so has
        // to be toggled along with it.
        const fuss0 = document.getElementById('prep-fuss');
        if (fuss0) fuss0.style.display = 'none';
        modal.style.display = 'block';

        try {
            const [antwort] = await Promise.all([
                apiCall('/api/print_preview/' + encodeURIComponent(filename)),
                holeFeuchte(),
            ]);
            const daten = await antwort.json();
            if (daten.error) throw new Error(daten.error);
            aktuell.daten = daten;
            aktuell.plate = daten.plate;
            zeichne(daten);

            // Does a spool question still follow this sheet? Then "Drucken"
            // (Print) promises too much.
            //
            // The answer comes from the server (`spulenauswahl_noetig`) and
            // is the same one the print command later relies on. Before,
            // there was a guess of our own here: "multiple filaments" —
            // which caught multi-color prints but not a single-filament
            // print whose material doesn't match the loaded spool. There it
            // said "Drucken" (Print), and the spool prompt showed up right
            // after anyway (reported 02sep26).
            setzeStartKnopf(daten);
            document.getElementById('prep-loading').style.display = 'none';
            document.getElementById('prep-body').style.display = '';
            const fuss = document.getElementById('prep-fuss');
            if (fuss) fuss.style.display = '';
            return true;
        } catch (e) {
            console.error('Print preparation not loaded:', e);
            // Better to print without preparation than not at all — the old
            // path still works.
            modal.style.display = 'none';
            aktuell = null;
            return false;
        }
    }

    function schliesse() {
        const modal = document.getElementById('printPrepareModal');
        if (modal) modal.style.display = 'none';
    }

    function bestaetige() {
        if (!aktuell) return;
        const { filename, location, plate } = aktuell;
        schliesse();
        // The plate is already chosen here — otherwise the later plate
        // dialog would ask again.
        if (typeof plate === 'number') window.pendingPlateOverride = plate;
        if (window.printActions && typeof window.printActions.beginPrintFlow === 'function') {
            window.printActions.beginPrintFlow(filename, location);
        }
        aktuell = null;
    }

    /**
     * Render the same content into a foreign container — the schedule
     * dialog uses this to show exactly what appears before an immediate
     * print too.
     *
     * `vorgaben` overrides the defaults (when editing a scheduled print,
     * they come from the saved entry).
     *
     * `ziele` splits the output across multiple containers:
     * `{ datei, platte, filament, optionen }`. The schedule dialog uses this
     * to put each part into its own card — before, everything sat in one
     * block under the heading "Druckoptionen", which meant the preview and
     * key facts ended up where you'd expect toggles. Without `ziele` it
     * stays as one block (immediate print).
     *
     * Returns: { plate() } — the chosen plate.
     */
    async function rendereIn(behaelter, filename, vorgaben, ziele) {
        if (!behaelter) return null;
        behaelter.innerHTML = '<div style="text-align:center;padding:20px;"><div class="loading"></div></div>';

        let daten = null;
        try {
            const [antwort] = await Promise.all([
                apiCall('/api/print_preview/' + encodeURIComponent(filename)),
                holeFeuchte(),
            ]);
            daten = await antwort.json();
            if (daten.error) throw new Error(daten.error);
        } catch (e) {
            console.error('Preparation not loaded:', e);
            behaelter.innerHTML = '';
            return null;
        }

        const zustand = { plate: daten.plate };
        const wurzel = (ziele && ziele.platte) || behaelter;
        const zeichnePlattenListe = () => {
            const liste = wurzel.querySelector('.prep-plates');
            if (!liste) return;
            liste.innerHTML = (daten.plates || []).map(p => `
                <button type="button" class="prep-plate${p.index === zustand.plate ? ' prep-plate--on' : ''}"
                        data-plate="${p.index}">
                    ${p.thumbnail ? `<img src="${imageDataUrl(p.thumbnail)}" alt="">` : ''}
                    <span>${esc(plattenName(p))}</span>
                </button>`).join('');
            liste.querySelectorAll('.prep-plate').forEach(knopf => {
                knopf.onclick = () => {
                    zustand.plate = parseInt(knopf.dataset.plate, 10);
                    zeichnePlattenListe();
                };
            });
        };

        // Key facts with line icons instead of emoji — same visual language
        // as the dialog headers.
        const ic = (pfad) => `<svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true">${pfad}</svg>`;
        const IC_ZEIT = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
        const IC_GEWICHT = '<path d="M12 3v10M7 21h10M6 13h12l-2 8H8z"/>';
        const IC_PLATTE = '<rect x="3" y="7" width="18" height="11" rx="2"/><path d="M3 12h18"/>';
        const IC_DUESE = '<path d="M9 3h6l-1 9-2 4-2-4z"/>';

        const fakten = [];
        const zeit = dauer(daten.print_time_seconds);
        if (zeit) fakten.push(ic(IC_ZEIT) + esc(zeit));
        if (daten.weight_grams) fakten.push(ic(IC_GEWICHT) + Math.round(daten.weight_grams) + ' g');
        if (daten.bed_type) fakten.push(ic(IC_PLATTE) + esc(daten.bed_type));
        if (daten.nozzle_diameter) {
            const d = daten.nozzle_diameter + ' mm';
            fakten.push(ic(IC_DUESE) + ((daten.nozzle_count || 1) > 1 ? `${d} / ${d}` : d));
        }
        const filFakt = filamentFakt(daten, filename);
        if (filFakt) fakten.push(filFakt);

        const filamente = daten.filaments || [];
        const mehrPlatten = (daten.plates || []).length > 1;

        // Build the four building blocks once, then distribute them per caller.
        const teilDatei = `
            <div class="prep-datei">
                ${daten.thumbnail ? `<img class="prep-datei__bild" src="${imageDataUrl(daten.thumbnail)}" alt="">` : ''}
                <div class="prep-datei__text">
                    <div class="prep-datei__name">${esc(daten.filename || filename)}</div>
                    <div class="prep-facts">${fakten.map(f => `<span class="prep-fact">${f}</span>`).join('')}</div>
                </div>
            </div>`;
        const teilPlatte = mehrPlatten
            ? '<div class="prep-plates"></div>' : '';
        const teilFilament = filamente.length
            ? `<div class="prep-rows">${zeichneFilamente(daten)}</div>` : '';
        const teilOptionen = `<div class="prep-rows">${zeichneOptionen(
            filename,
            Object.assign({}, daten.defaults || {}, vorgaben || {}),
            daten.manual_color_change_possible === true)}</div>`;

        if (ziele) {
            // Split up: each part into its own card. The caller hides empty
            // containers so no empty cards are shown.
            behaelter.innerHTML = '';
            const setze = (el, html) => {
                if (!el) return;
                el.innerHTML = html;
                const kasten = el.closest('[data-leer-ausblenden]');
                if (kasten) kasten.style.display = html ? '' : 'none';
            };
            setze(ziele.datei, teilDatei);
            setze(ziele.platte, teilPlatte);
            setze(ziele.filament, teilFilament);
            setze(ziele.optionen, teilOptionen);
        } else {
            behaelter.innerHTML = `
                ${teilDatei}
                ${mehrPlatten ? `<div class="prep-section-title">${esc(t('print_prepare_plate', 'Platte'))}</div>${teilPlatte}` : ''}
                ${filamente.length ? `<div class="prep-section-title">${esc(t('print_prepare_filament', 'Filament'))}</div>${teilFilament}` : ''}
                <div class="prep-section-title" style="margin-top:12px;">${esc(t('print_options', 'Optionen'))}</div>
                ${teilOptionen}
            `;
        }
        if (mehrPlatten) zeichnePlattenListe();

        return { plate: () => zustand.plate };
    }

    window.printPrepare = {
        oeffne,
        rendereIn,
        /**
         * A different plate was chosen — and its data needs to be fetched
         * fresh.
         *
         * In slice_info.config everything sits in per-plate blocks, including
         * the nozzle assignment. The server returns it for the plate given in
         * `?plate=`; without that it takes the first one. Before, only the
         * tiles were redrawn here, and the filament section kept plate 1's
         * assignment — for a file with six plates it showed "Links" (Left)
         * three times, even though plate 2 puts its second filament on the
         * second nozzle (measured 02sep26).
         *
         * The tiles redraw immediately so the tap doesn't feel ignored; the
         * data follows after.
         */
        async waehlePlatte(index) {
            if (!aktuell || aktuell.plate === index) return;
            aktuell.plate = index;
            zeichnePlatten(aktuell.daten);
            try {
                const antwort = await apiCall(
                    '/api/print_preview/' + encodeURIComponent(aktuell.filename)
                    + '?plate=' + encodeURIComponent(index));
                const daten = await antwort.json();
                if (daten.error) throw new Error(daten.error);
                // Keep the chosen plate: the server responds with its own
                // `plate`, and it's the same one — but if it falls back to
                // the first one for an unknown number, the tile selection
                // shouldn't jump.
                aktuell.daten = daten;
                zeichne(daten);          // also redraws the tiles
                setzeStartKnopf(daten);
            } catch (e) {
                console.warn('Plate change: preview not reloaded', e);
            }
        },
    };
    window.closePrintPrepare = schliesse;
    window.confirmPrintPrepare = bestaetige;
})();
