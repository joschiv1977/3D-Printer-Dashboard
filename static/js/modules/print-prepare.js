/**
 * Druckvorbereitung — der Schritt zwischen "Drucken" und dem eigentlichen Start.
 *
 * Der Drucker macht es auf seinem Display genauso: erst ein Blatt mit Vorschau,
 * Platte, Duesen, Filament und allen Optionen, dann losdrucken. Bei uns steckten
 * die Optionen vorher im Zahnrad der Dateiliste — wer sie beim Drucken sehen
 * wollte, musste sie vorher geoeffnet haben.
 *
 * Die Optionsfelder tragen bewusst dieselben Klassen und data-file-Attribute wie
 * vorher in der Liste: collectPrintOptions() in print-actions.js liest sie
 * unveraendert weiter aus.
 */
(function () {
    'use strict';

    let aktuell = null;   // { filename, location, daten, plate }

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

    /** Strichsymbol vor einer Zeilenbeschriftung. Das Label selbst laeuft
     *  durch esc(), Markup kann also nicht darin stehen. */
    function zeichen(name) {
        return name ? window.skIcon(name, 'hd-ic--xs') + ' ' : '';
    }

    /** Segment-Auswahl (automatisch / ein / aus) — dieselben Bausteine wie in
     *  der bisherigen Optionsliste, damit die Optik gleich bleibt. */
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
        // Wohin die Timelapse geht. Der Drucker uebernimmt das Ziel aus
        // dem Auftrag, einen eigenen Einstellungsbefehl gibt es nicht —
        // darum steht die Wahl hier und nicht in den Einstellungen.
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
        // Der Duesenversatz bleibt immer sichtbar. Was er soll, entscheidet
        // die VORBELEGUNG vom Server: benutzt der Druck beide Duesen, steht
        // er auf "ein", sonst auf "aus". Von Hand umstellen geht weiter —
        // ihn ganz auszublenden war am 28aug26 die falsche Antwort.
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

        // Trocknung waehrend des Drucks. Nur mit heizendem AMS, und
        // vorgeschlagen, wenn die aktive Spule lange lag — Spoolman fuehrt
        // last_used, dieselbe Quelle wie der Hinweis in der Material-Zone.
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
     * Soll die Trocknung waehrend des Drucks vorgeschlagen werden?
     *
     * `moeglich` haengt am heizenden AMS (AMS HT / 2 Pro), `vorschlagen` an
     * der Lagerzeit der aktiven Spule. Die 30 Tage sind dieselbe Schwelle
     * wie beim Hinweis in der Material-Zone — eine Zahl, zwei Stellen waeren
     * eine zu viel, darum steht sie hier als Konstante mit demselben Namen.
     */
    const TAGE_BIS_FEUCHT = 30;

    function trocknungVorschlag() {
        const faehig = window.lastCapabilities
            || (window.lastPrintData && window.lastPrintData.capabilities) || {};
        if (faehig.ams_drying !== true) return { moeglich: false };

        const sm = window.spoolmanManager;
        const spule = (sm && sm.spools || []).find(x => x.id === (sm && sm.activeSpoolId));
        if (!spule || !spule.last_used) return { moeglich: true, vorschlagen: false, tage: 0 };

        // floor, nicht ceil: ceil rundet jeden angefangenen Tag auf, dann
        // stuenden bei exakt 30 Tagen "31 Tage" da und der Schalter ginge
        // einen Tag zu frueh an.
        const tage = Math.floor(Math.abs(Date.now() - new Date(spule.last_used)) / 86400000);
        return { moeglich: true, vorschlagen: tage > TAGE_BIS_FEUCHT, tage: tage > TAGE_BIS_FEUCHT ? tage : 0 };
    }

    /**
     * Was das AMS gemessen hat, schlaegt die Lagerzeit aus Spoolman.
     *
     * `last_used` sagt nur, wann die Spule zuletzt dran war — ob sie in der
     * Zeit feucht wurde, weiss es nicht. Das Feuchte-Gedaechtnis weiss es.
     * Deshalb steht der gemessene Hinweis vor dem geschaetzten; nur wenn
     * nichts gemessen wurde, bleibt es beim alten Tagezaehler.
     */
    function feuchteHinweis() {
        const daten = feuchteStand;
        if (!daten) return null;
        const nass = (daten.spulen || []).filter(sp => sp.urteil === 'trocknen');
        if (!nass.length) return null;
        // Die laengste Liegezeit gibt den Ton an — sie ist der Grund.
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

    // Der Stand wird beim Oeffnen geholt; zeichneOptionen laeuft synchron und
    // kann nicht warten. Fehlt er noch, greift der Tagezaehler.
    let feuchteStand = null;

    async function holeFeuchte() {
        if (!window.amsFeuchte) return null;
        try { feuchteStand = await window.amsFeuchte.hole(14); } catch (e) { feuchteStand = null; }
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
                <span>${esc(p.name || ('#' + p.index))}</span>
            </button>`).join('');
    }

    /**
     * Welches Filament die Datei verlangt — mit Farbpunkt wie in der
     * Dateiliste. Gehoert in JEDE Dateikarte: ohne die Angabe muss man
     * erst „Details" aufklappen, um zu sehen, wofuer man die Spule waehlt.
     *
     * Bei gesliceten .gcode.3mf liefert /api/print_preview keine
     * `filaments` (der Parser gibt bei EINEM Filament eine leere Liste
     * zurueck) — dann steht die Angabe nur in der Dateiliste.
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
        // Die Fusszeile liegt seit dem Umbau ausserhalb von prep-body und
        // muss darum mitgeschaltet werden.
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

            // Bei mehreren Filamenten folgt nach diesem Blatt noch die
            // Spulen-Zuordnung — dann verspricht „Drucken" zu viel.
            const ausListe = window.sdDateiFinden ? window.sdDateiFinden(filename)
                : (window.lastSDFiles || []).find(f => f && f.name === filename);
            const nochZuordnen = !!(ausListe && ausListe.is_multifilament && ausListe.all_filaments);
            document.getElementById('prep-start').textContent = nochZuordnen
                ? t('print_prepare_continue', 'Weiter')
                : t('print', 'Drucken');
            document.getElementById('prep-loading').style.display = 'none';
            document.getElementById('prep-body').style.display = '';
            const fuss = document.getElementById('prep-fuss');
            if (fuss) fuss.style.display = '';
            return true;
        } catch (e) {
            console.error('Print preparation not loaded:', e);
            // Lieber ohne Vorbereitung drucken als gar nicht — der alte Weg
            // funktioniert weiterhin.
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
        // Die Platte ist hier schon gewaehlt — der spaetere Plattendialog
        // wuerde sonst nochmal fragen.
        if (typeof plate === 'number') window.pendingPlateOverride = plate;
        if (window.printActions && typeof window.printActions.beginPrintFlow === 'function') {
            window.printActions.beginPrintFlow(filename, location);
        }
        aktuell = null;
    }

    /**
     * Denselben Inhalt in einen fremden Behaelter zeichnen — der
     * Planen-Dialog zeigt damit genau das, was auch vor dem Sofortdruck steht.
     *
     * `vorgaben` ueberschreibt die Standardwerte (beim Bearbeiten eines
     * geplanten Drucks kommen sie aus dem gespeicherten Eintrag).
     *
     * `ziele` teilt die Ausgabe auf mehrere Behaelter auf:
     * `{ datei, platte, filament, optionen }`. Der Planen-Dialog setzt damit
     * jeden Teil in seine eigene Karte — vorher lag alles in einem Block
     * unter der Ueberschrift "Druckoptionen", weshalb Vorschau und Eckdaten
     * dort standen, wo man Schalter erwartet. Ohne `ziele` bleibt es beim
     * einen Block (Sofortdruck).
     *
     * Rueckgabe: { plate() } — die gewaehlte Platte.
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
                    <span>${esc(p.name || ('#' + p.index))}</span>
                </button>`).join('');
            liste.querySelectorAll('.prep-plate').forEach(knopf => {
                knopf.onclick = () => {
                    zustand.plate = parseInt(knopf.dataset.plate, 10);
                    zeichnePlattenListe();
                };
            });
        };

        // Eckdaten mit Strich-Icons statt Emoji — gleiche Bildsprache wie
        // die Kopfzeilen der Dialoge.
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

        // Die vier Bausteine einmal bauen, dann je nach Aufrufer verteilen.
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
            // Aufgeteilt: jeder Teil in seine eigene Karte. Leere Behaelter
            // blendet der Aufrufer aus, damit keine leeren Karten stehen.
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
        waehlePlatte(index) {
            if (!aktuell) return;
            aktuell.plate = index;
            zeichnePlatten(aktuell.daten);
        },
    };
    window.closePrintPrepare = schliesse;
    window.confirmPrintPrepare = bestaetige;
})();
