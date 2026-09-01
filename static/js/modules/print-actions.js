/**
 * Print Actions Manager
 * Handles print control actions (pause/resume/stop), homing, print-from-SD workflow,
 * plate selection, filament warning/error dialogs, print detail modal tabs,
 * progress chart, events timeline, and timelapse fullscreen.
 */
/**
 * Die Druckoptionen an EINER Stelle einsammeln.
 *
 * Standen vorher fuenfmal wortgleich im Modul — jede neue Option musste an
 * allen fuenf gepflegt werden, und genau daran waeren die dreistufigen
 * Kalibrierungen haengengeblieben.
 *
 * Dreistufig heisst: 0 aus, 1 ein, 2 automatisch. So kennt der Drucker sie
 * (am 18aug26 gegen echte Bambu-Studio-Befehle gemessen), und so zeigt er
 * sie auch auf seinem Display.
 */
function collectPrintOptions(filename) {
    const haken = (cls) => {
        const cb = document.querySelector(`.${cls}[data-file="${filename}"]`);
        return cb ? cb.checked : false;
    };
    const stufe = (cls, vorgabe) => {
        const gewaehlt = document.querySelector(`.${cls}[data-file="${filename}"]:checked`);
        if (!gewaehlt) return vorgabe;
        const v = parseInt(gewaehlt.value, 10);
        return [0, 1, 2].includes(v) ? v : vorgabe;
    };
    return {
        timelapse: haken('print-opt-timelapse'),
        timelapse_intern: haken('print-opt-timelapse-intern'),
        use_ams: haken('print-opt-use-ams'),
        layer_inspect: haken('print-opt-layer-inspect'),
        vibration_cali: haken('print-opt-vibration-cali'),
        manual_color_change: haken('print-opt-manual-color-change'),
        bed_leveling_mode: stufe('print-opt-bed-leveling', 2),
        flow_cali_mode: stufe('print-opt-flow-cali', 2),
        nozzle_offset_mode: stufe('print-opt-nozzle-offset', 0),
        // Trocknung parallel zum Druck. Material und Werte holt der Server
        // selbst aus der 3MF — hier reicht der Schalter.
        dry_during_print: haken('print-opt-dry-during'),
    };
}

// ========================================
// Teile ueberspringen
// ========================================
// Der Drucker kann einzelne Teile eines laufenden Drucks fallen lassen
// (skip_objects, fun-Bit 49). Loest sich eines vom Bett, rettet das den
// Rest des Auftrags — bisher blieb nur der Abbruch.
//
// Nicht umkehrbar: was uebersprungen ist, kommt in diesem Auftrag nicht
// wieder. Darum die Liste zum Ankreuzen und eine ausdrueckliche Rueckfrage.
// Sichtbarkeit des Knopfes. EINE Funktion, von beiden Wegen gerufen: das
// Web laeuft ueber den Socket, der Poll ist nur der Rueckfall. Genau daran
// ist der Knopf beim ersten Versuch nicht aufgetaucht — die Logik hing im
// Poll-Pfad, der beim laufenden Socket gar nicht drankommt. Denselben Fehler
// nennt der Kommentar in socket-manager schon fuer die Geraete-Anzeige.
window.skTeileKnopfZeigen = function (data) {
    if (!data) return;
    const laeuft = ['RUNNING', 'PAUSE'].includes(
        String(data.gcode_state || '').toUpperCase()) || data.paused === true;
    const sichtbar = laeuft && data.kann_teile_ueberspringen === true;
    // Drei Stellen: die Druckkarte (dort schaut man waehrend eines Drucks
    // hin) und die beiden Knopfreihen der Entwickler-Karte.
    ['pcb-skip', 'skip-btn-mobile', 'skip-btn-desktop'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = sichtbar ? '' : 'none';
    });
};

/**
 * The mark for a part that is going to be dropped.
 *
 * A faint tint on its own reads as "greyed out", not as "this one falls
 * away" — so the part turns red and carries a cross. The cross sits on the
 * part's centre of area, not in the middle of its bounding box: a cable tie
 * lying diagonally (measured 30aug26 in Kabelbinder_mit_Klemmhebel, bbox
 * 392x392 for a strip 14 wide) has its box centre in thin air.
 *
 * Its size follows the area, capped, so a cube and a bar get the same
 * stamp and a tiny clip still gets one that fits.
 */
function drawCross(g, mx, my, area) {
    const side = Math.min(70, Math.max(16, Math.sqrt(area) * 1.2));
    const h = side / 2;
    const thick = Math.max(3, side * 0.16);
    const stroke = (width, color) => {
        g.lineWidth = width;
        g.strokeStyle = color;
        g.beginPath();
        g.moveTo(mx - h, my - h); g.lineTo(mx + h, my + h);
        g.moveTo(mx + h, my - h); g.lineTo(mx - h, my + h);
        g.stroke();
    };
    stroke(thick + 4, 'rgb(150, 15, 15)');
    stroke(thick, '#ffffff');
}

/**
 * The plate from above, with clickable parts.
 *
 * Every 3MF brings two images: `top` is the top view to look at,
 * `pick` the pick map Bambu uses for part selection on the printer
 * display. In the pick map every part sits in a red shade of its own —
 * and **this red value IS the part number**: counted on six cubes on
 * 30aug26, RGB(56,0,0) to (204,0,0) against identify_id 56 to 204.
 *
 * With that no geometry and no lookup table is needed here: tap a
 * point, read the red value, that is the part. And the mix-up between
 * the `id` from `bbox_objects` and the `identify_id` that cost an hour
 * on 29aug26 cannot arise at all.
 *
 * Once the plate is up, the list below it disappears: the same six
 * cubes twice underneath each other say nothing the image does not show
 * better. The checkboxes stay in the tree all the same — they are the
 * store of the selection that the buttons below read out.
 *
 * If one of the images is missing, the plate stays away and the list comes
 * back — it alone was enough before, too.
 */
async function zeigePlatte(ov, teile) {
    const kasten = ov.querySelector('.sk-teile-platte');
    const bild = ov.querySelector('.sk-teile-bild');
    const wahl = ov.querySelector('.sk-teile-wahl');
    const liste = ov.querySelector('.sk-teile-liste');
    const aufgeben = () => {
        if (kasten) kasten.hidden = true;
        if (liste) liste.hidden = false;
    };
    if (!kasten || !bild || !wahl) return aufgeben();

    const laden = (art) => new Promise((fertig) => {
        const i = new Image();
        i.onload = () => fertig(i);
        i.onerror = () => fertig(null);
        i.src = '/api/mqtt/print_objects/bild/' + art;
    });
    const [oben, treffer] = await Promise.all([laden('top'), laden('pick')]);
    if (!oben || !treffer) return aufgeben();

    const K = 512;
    [bild, wahl].forEach(c => { c.width = K; c.height = K; });
    bild.getContext('2d').drawImage(oben, 0, 0, K, K);

    // The pick map is never shown, only read out.
    const versteckt = document.createElement('canvas');
    versteckt.width = versteckt.height = K;
    const tk = versteckt.getContext('2d', { willReadFrequently: true });
    tk.drawImage(treffer, 0, 0, K, K);
    let punkte;
    try {
        punkte = tk.getImageData(0, 0, K, K).data;
    } catch (e) {
        return aufgeben();            // fremde Quelle — dann eben ohne Bild
    }

    const bekannt = new Set(teile.map(o => o.id));
    const kaestchen = () => [...ov.querySelectorAll('.sk-teile-liste input')];

    const male = () => {
        const gewaehlt = new Set(kaestchen().filter(k => k.checked)
                                            .map(k => parseInt(k.value, 10)));
        const g = wahl.getContext('2d');
        g.clearRect(0, 0, K, K);
        if (!gewaehlt.size) return;
        const bild2 = g.createImageData(K, K);
        // Centre of area per part, summed up in the same pass that tints
        // it — that is where the cross goes.
        const centres = new Map();
        for (let i = 0; i < punkte.length; i += 4) {
            const nummer = punkte[i] + punkte[i + 1] * 256;
            if (!punkte[i + 3] || !gewaehlt.has(nummer)) continue;
            bild2.data[i] = 211; bild2.data[i + 1] = 47;
            bild2.data[i + 2] = 47; bild2.data[i + 3] = 170;
            const stelle = i / 4;
            const m = centres.get(nummer) || [0, 0, 0];
            m[0] += stelle % K; m[1] += (stelle / K) | 0; m[2] += 1;
            centres.set(nummer, m);
        }
        g.putImageData(bild2, 0, 0);
        g.lineCap = 'round';
        centres.forEach(([sx, sy, count]) => {
            if (count < 40) return;         // a few pixels — the tint has to do
            drawCross(g, sx / count, sy / count, count);
        });
    };

    wahl.addEventListener('click', (e) => {
        const r = wahl.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * K);
        const y = Math.floor((e.clientY - r.top) / r.height * K);
        if (x < 0 || y < 0 || x >= K || y >= K) return;
        const pos = (y * K + x) * 4;
        if (!punkte[pos + 3]) return;          // daneben
        // Die Nummer steckt in ZWEI Kanaelen: Rot ist das untere Byte, Gruen
        // das obere. Am 31aug26 an einem Teil mit der Nummer 752 gemessen —
        // die Trefferkarte trug dort RGB(240, 2, 0), und 240 + 2*256 = 752.
        //
        // Die alte Messung an sechs Wuerfeln (Nummern 56 bis 204) stimmte
        // trotzdem: unter 256 ist Gruen immer 0. Wer nur Rot liest, bekommt
        // bei groesseren Nummern 240 statt 752 und findet kein Teil — das
        // Antippen tat dann gar nichts.
        const nummer = punkte[pos] + punkte[pos + 1] * 256;
        if (!bekannt.has(nummer)) return;      // schon uebersprungen
        const k = kaestchen().find(i => parseInt(i.value, 10) === nummer);
        if (k) { k.checked = !k.checked; male(); }
    });
    liste.addEventListener('change', male);
}

window.teileUeberspringenOeffnen = async function () {
    const t = (k, f) => ((window.texts || {})[k]) || f;
    let daten;
    try {
        const antwort = await apiCall('/api/mqtt/print_objects');
        daten = await antwort.json();
    } catch (e) {
        window.skToast && window.skToast(t('parts_load_failed', 'Teile nicht ladbar'), 'error');
        return;
    }
    const teile = (daten.objects || []).filter(o => !o.skipped);
    if (!daten.supported) {
        window.skToast && window.skToast(t('parts_unsupported',
            'Dieser Drucker kann keine Teile überspringen'), 'error');
        return;
    }
    if (!teile.length) {
        window.skToast && window.skToast(t('parts_none', 'Keine überspringbaren Teile'), 'info');
        return;
    }

    // Der Name allein reicht nicht: drei Kopien desselben Teils heissen
    // alle gleich (am 29aug26 an "Cube + Cube + Cube" gesehen). Darum
    // immer die Nummer dazu — sie ist ohnehin das, was geschickt wird —
    // und die Lage auf der Platte, damit man sie am Geraet wiederfindet.
    // Die Lage wird RELATIV zu den anderen Teilen bestimmt; die Bettgroesse
    // spielt dabei keine Rolle.
    const mitte = o => (Array.isArray(o.bbox) && o.bbox.length === 4)
        ? [(o.bbox[0] + o.bbox[2]) / 2, (o.bbox[1] + o.bbox[3]) / 2] : null;
    const punkte = teile.map(mitte).filter(Boolean);
    const spanne = i => punkte.length
        ? [Math.min(...punkte.map(p => p[i])), Math.max(...punkte.map(p => p[i]))] : [0, 0];
    const [xMin, xMax] = spanne(0), [yMin, yMax] = spanne(1);
    const lage = (o) => {
        const m = mitte(o);
        if (!m || xMax - xMin < 1 && yMax - yMin < 1) return '';
        const teil = (wert, min, max, klein, gross) => {
            if (max - min < 1) return '';
            const anteil = (wert - min) / (max - min);
            return anteil < 0.34 ? klein : (anteil > 0.66 ? gross : '');
        };
        const waag = teil(m[0], xMin, xMax, t('pos_left', 'links'), t('pos_right', 'rechts'));
        const senk = teil(m[1], yMin, yMax, t('pos_front', 'vorne'), t('pos_back', 'hinten'));
        return [senk, waag].filter(Boolean).join(' ');
    };

    const zeilen = teile.map(o => {
        const sauber = x => String(x).replace(/[<>&]/g, '');
        const wo = lage(o);
        return `<label class="sk-teil"><input type="checkbox" value="${o.id}">
            <span class="sk-teil-text"><span class="sk-teil-name">${sauber(o.name)}</span>
            <span class="sk-teil-kennung">#${o.id}${wo ? ' · ' + sauber(wo) : ''}</span>
            </span></label>`;
    }).join('');
    const ov = document.createElement('div');
    ov.className = 'sk-teile-ov';
    ov.innerHTML = `<div class="sk-teile-box">
        <h3>${t('skip_parts', 'Teile überspringen')}</h3>
        <p class="sk-teile-hinweis">${t('skip_parts_hint',
            'Übersprungene Teile werden in diesem Druck nicht mehr gedruckt.')}</p>
        <div class="sk-teile-platte">
          <canvas class="sk-teile-bild"></canvas>
          <canvas class="sk-teile-wahl"></canvas>
        </div>
        <div class="sk-teile-liste" hidden>${zeilen}</div>
        <div class="sk-teile-knoepfe">
          <button type="button" data-ab>${t('cancel', 'Abbrechen')}</button>
          <button type="button" data-ok>${t('skip', 'Überspringen')}</button>
        </div></div>`;
    document.body.appendChild(ov);
    if (window.skNachVorn) window.skNachVorn(ov, 2147483640);

    zeigePlatte(ov, teile);

    const zu = () => ov.remove();
    ov.querySelector('[data-ab]').onclick = zu;
    ov.querySelector('[data-ok]').onclick = async () => {
        const ids = [...ov.querySelectorAll('input:checked')].map(i => parseInt(i.value, 10));
        if (!ids.length) { zu(); return; }
        const namen = teile.filter(o => ids.includes(o.id)).map(o => o.name).join(', ');
        zu();
        const sicher = await window.skConfirm(
            t('skip_parts_confirm', 'Diese Teile wirklich überspringen?') + '\n\n' + namen);
        if (!sicher) return;
        try {
            const antwort = await apiCall('/api/mqtt/skip_objects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ obj_list: ids }),
            });
            const erg = await antwort.json();
            // Den Grund des Druckers zeigen, nicht unseren Fehlercode. Er
            // sagt genau, was los ist ("no matched obj_list"), und das ist
            // mehr wert als ein allgemeines "fehlgeschlagen".
            let text, art;
            if (erg.success) {
                art = 'success';
                text = erg.bestaetigt === false
                    ? t('skip_parts_sent_unconfirmed', 'Gesendet — der Drucker hat nicht geantwortet')
                    : t('skip_parts_done', 'Wird übersprungen');
            } else {
                art = 'error';
                text = erg.grund
                    ? t('skip_parts_refused', 'Drucker hat abgelehnt') + ': ' + erg.grund
                    : (erg.error || t('skip_parts_failed', 'Überspringen fehlgeschlagen'));
            }
            window.skToast && window.skToast(text, art);
        } catch (e) {
            window.skToast && window.skToast(t('skip_parts_failed', 'Überspringen fehlgeschlagen'), 'error');
        }
    };
};

class PrintActionsManager {
    constructor() {
        this.currentPlateSelection = null;
        this.currentPrintData = null;
        this.printProgressChart = null;
    }

    // ========================================
    // pausePrint
    // ========================================
    pausePrint() {
        // Unified — Backend dispatcht je nach Controller (Bambu MQTT, Klipper REST).
        window.printerAdapter.pause().then(() => {
            document.getElementById('pause-btn-mobile').style.display = 'none';
            document.getElementById('pause-btn-desktop').style.display = 'none';
            document.getElementById('resume-btn-mobile').style.display = 'block';
            document.getElementById('resume-btn-desktop').style.display = 'block';
            this._updateResumeButtonText(false);
        });
    }

    // ========================================
    // resumePrint
    // ========================================
    resumePrint() {
        // Bei aktiver Filament-Change-Pause (Phase 1/2) ist der Resume-Button
        // ein Action-Button — siehe socket-manager.js der Icon/Label aendert.
        // Phase 1: "Filament laden" -> filamentChangeAction('load')
        // Phase 2: "Fertig"          -> filamentChangeAction('done')
        // Phase 0: normaler resume
        const fcPhase = (window.lastPrintData &&
                         window.lastPrintData.filament_change_phase) || 0;
        if (fcPhase === 1 || fcPhase === 2) {
            const action = (fcPhase === 1) ? 'load' : 'done';
            window.filamentChangeAction(action).then(() => {
                document.getElementById('resume-btn-mobile').style.display = 'none';
                document.getElementById('resume-btn-desktop').style.display = 'none';
            }).catch(() => { /* error toast schon im filamentChangeAction */ });
            return;
        }

        // Unified — normaler resume.
        window.printerAdapter.resume().then(() => {
            document.getElementById('resume-btn-mobile').style.display = 'none';
            document.getElementById('resume-btn-desktop').style.display = 'none';
            document.getElementById('pause-btn-mobile').style.display = 'block';
            document.getElementById('pause-btn-desktop').style.display = 'block';
        });
    }

    // ========================================
    // stopPrint
    // ========================================
    stopPrint() {
        const texts = window.texts || {};
        showConfirmDialog(texts.confirm_stop_print, function() {
            window.printerAdapter.stop();
        });
    }

    // ========================================
    // startHoming
    // ========================================
    startHoming() {
        const texts = window.texts || {};
        // Beschriftung des Homing-Knopfes — Symbol aus icons.js statt Emoji.
        const homingInhalt = (text) =>
            ((typeof window.skIcon === 'function') ? window.skIcon('haus') : '') + '<span>' + text + '</span>';
        showConfirmDialog(texts.confirm_start_homing, function() {
        // Button deaktivieren während Homing
        const homingBtnMobile = document.getElementById('homing-btn-mobile');
        const homingBtnDesktop = document.getElementById('homing-btn-desktop');

        if (homingBtnMobile) {
            homingBtnMobile.disabled = true;
            homingBtnMobile.innerHTML = homingInhalt(texts.homing_running || 'Läuft…');
        }
        if (homingBtnDesktop) {
            homingBtnDesktop.disabled = true;
            homingBtnDesktop.innerHTML = homingInhalt(texts.homing_running || 'Läuft…');
        }

        // Unified — Backend dispatcht.
        window.printerAdapter.home(null)
        .then(r => {
            if (r.ok) {
                skToast(texts.toast_homing_started, 'success');
            } else {
                skToast(texts.toast_homing_failed + ': ' + (r.error || texts.error), 'error');
            }
        })
        .catch(error => {
            skToast(texts.connection_error, 'error');
        })
        .finally(() => {
            // Buttons nach 25 Sekunden wieder aktivieren (Fallback)
            // Wird normalerweise früher durch home_flag Update zurückgesetzt
            setTimeout(() => {
                if (homingBtnMobile) {
                    homingBtnMobile.disabled = false;
                    homingBtnMobile.innerHTML = homingInhalt(texts.homing || 'Homing');
                }
                if (homingBtnDesktop) {
                    homingBtnDesktop.disabled = false;
                    homingBtnDesktop.innerHTML = homingInhalt(texts.homing || 'Homing');
                }
            }, 25000);
        });
        });
    }

    // ========================================
    // reloadPrintDetails
    // ========================================
    // ========================================
    // startPrintFromSD
    // ========================================
    /**
     * Einstieg beim Klick auf "Drucken".
     *
     * Bambu: erst die Druckvorbereitung zeigen — Vorschau, Platte, Filament
     * und alle Optionen auf einem Blatt, so wie es der Drucker auf seinem
     * Display auch macht. Vorher lagen die Optionen im Zahnrad der Dateiliste
     * und waren beim Drucken nicht mehr zu sehen.
     *
     * Der eigentliche Ablauf dahinter (Spulenpruefung, Mehrfarben-Dialog,
     * Plattenwahl, Start) bleibt unveraendert und steckt in beginPrintFlow.
     */
    startPrintFromSD(filename, location, buttonElement) {
        const istKlipper = window.isKlipperMode && window.isKlipperMode();
        if (!istKlipper && window.printPrepare) {
            window.printPrepare.oeffne(filename, location).then(gezeigt => {
                // Vorbereitung nicht ladbar (z.B. Datei nicht im Zwischen-
                // speicher)? Dann direkt den alten Weg gehen statt gar nichts.
                if (!gezeigt) this.beginPrintFlow(filename, location, buttonElement);
            });
            return;
        }
        this.beginPrintFlow(filename, location, buttonElement);
    }

    beginPrintFlow(filename, location, buttonElement) {
        const texts = window.texts || {};

        // Klipper: simpler Druck-Start ohne AMS/Plate/Spool-Wizard.
        // Backend dispatcht ueber controller.start_print(filename).
        // Einzige unterstuetzte Option: Timelapse (moonraker-timelapse-Plugin).
        if (window.isKlipperMode && window.isKlipperMode()) {
            const msg = (texts.confirm_start_print || 'Druck starten') + ': ' + filename + '?';
            // Eigenes gestyltes Modal statt nativem confirm() (wie im Bambu-Pfad).
            if (window.showConfirmDialog) {
                window.showConfirmDialog(msg, () => this._klipperStartWithSpoolCheck(filename));
            } else if (window.skConfirm) {
                window.skConfirm(msg).then(ja => {
                    if (ja) this._klipperStartWithSpoolCheck(filename);
                });
            }
            return;
        }

        // PRIORITÄT 1: Multi-Filament Check
        const fileData = window.sdDateiFinden ? window.sdDateiFinden(filename)
            : window.lastSDFiles?.find(f => f.name === filename);

        if (fileData && fileData.is_multifilament && fileData.all_filaments) {
            // Multi-Filament detected!
            if (!(window.spoolmanManager && window.spoolmanManager.connected)) {
                window.skToast(texts.spoolman_required, 'warning');
                return;
            }

            showMultiFilamentSpoolModal(fileData, location, 'print');
            return;
        }

        // PRIORITÄT 2: Spoolman Single-Filament Check
        let selectedSpoolId = window.activeSpoolId;

        if (buttonElement) {
            // .sd-zeile ist die Dateizeile seit dem Umbau 21aug26;
            // .sd-file-card und .file-card bleiben fuer andere Listen drin.
            const fileCard = buttonElement.closest('.sd-zeile')
                || buttonElement.closest('.sd-file-card')
                || buttonElement.closest('.file-card');
            if (fileCard) {
                const spoolDropdown = fileCard.querySelector('select[onchange*="selectSpoolFromSD"]');
                if (spoolDropdown && spoolDropdown.value) {
                    selectedSpoolId = parseInt(spoolDropdown.value) || null;
                    console.log(`📦 Using the spool from the dropdown: ${selectedSpoolId}`);
                }
            }
        }

        this.currentPlateSelection = {
            filename: filename,
            location: location,
            spoolId: selectedSpoolId
        };

        if ((window.spoolmanManager && window.spoolmanManager.connected) && !selectedSpoolId) {
            window.skToast(texts.alert_select_spool_first, 'warning');
            return;
        }

        // PRIORITÄT 3: Weiter mit Platten-Check
        this.proceedWithPlateCheck(filename, location);
    }

    // Klipper-Druckstart mit Spulen-Gewichts-Check (wie Bambu-Server vor dem Print):
    // benötigtes Filament (Moonraker-Metadaten) vs. Restgewicht der aktiven
    // Spoolman-Spule. Leer → blockieren; zu wenig → Rückfrage; kein Spool/Spoolman
    // aus → einfach drucken.
    async _klipperStartWithSpoolCheck(filename) {
        const texts = window.texts || {};
        try {
            const fileData = window.sdDateiFinden ? window.sdDateiFinden(filename)
                : (window.lastSDFiles || []).find(f => f.name === filename || f.path === filename);
            const required = fileData && fileData.weight > 0 ? fileData.weight : 0;
            const st = await (await apiCall('/api/spoolman/status')).json().catch(() => null);
            const spoolId = st && st.active_spool;
            if (spoolId) {
                const spool = await (await apiCall('/api/spoolman/spool/' + spoolId)).json().catch(() => null);
                const remaining = spool && (typeof spool.remaining_weight === 'number' ? spool.remaining_weight
                    : (spool.spool && spool.spool.remaining_weight));
                const fil = (spool && (spool.filament || (spool.spool && spool.spool.filament))) || {};
                const vendor = fil.vendor && fil.vendor.name ? fil.vendor.name + ' ' : '';
                const name = vendor + (fil.name || ('#' + spoolId));

                // 1) Material-Mismatch (Companion-Logik vorgezogen — sie würde
                //    den Druck sonst erst mitten im Heat-Soak stoppen): erster
                //    Profil-Typ vs. Spulen-Material, Basis-Material normalisiert.
                const baseMat = (s) => {
                    let t = String(s || '').toUpperCase().trim();
                    for (const sep of ['+', '-', ' ', '/', '_']) t = t.split(sep)[0];
                    return t.trim();
                };
                // filament_type kann Array, JSON-Array-String (["PLA","PLA","TPU"])
                // oder "PLA;PLA;TPU" sein — Mehr-Platten-Dateien listen ALLE Platten.
                // Wir kennen die gewählte Platte hier nicht → die Spule muss zu
                // IRGENDEINEM der Typen passen, sonst false-positive (z.B. TPU-Platte
                // einer Datei, deren Platte 1 PLA ist).
                let typeList = (fileData && fileData.filament_type);
                if (!Array.isArray(typeList)) {
                    let s = String(typeList || '').trim();
                    if (s.startsWith('[')) { try { typeList = JSON.parse(s); } catch (_) { typeList = null; } }
                    if (!Array.isArray(typeList)) typeList = s.split(/[;,]/);
                }
                const profileBases = [...new Set(typeList.map(baseMat).filter(Boolean))];
                const spoolBase = baseMat(fil.material);
                if (profileBases.length && spoolBase && !profileBases.includes(spoolBase)) {
                    // BLOCKIEREN (kein Override): die Companion würde den Druck
                    // im Heat-Soak ohnehin abbrechen — Spule/Profil erst fixen.
                    const msg = (texts.spool_check_mismatch || 'Falsches Filament: Profil braucht {profile}, gewählte Spule {name} ist {material} – bitte Spule oder Profil prüfen.')
                        .replace('{profile}', profileBases.join('/'))
                        .replace('{name}', name)
                        .replace('{material}', spoolBase);
                    window.skToast(msg, 'error');
                    return;
                }

                // 2) Mengen-Check (Dateigewicht vs. Restgewicht).
                if (required > 0 && typeof remaining === 'number') {
                    if (remaining <= 0) {
                        window.skToast((texts.spool_check_empty || 'Aktive Spule ist leer — Druck wird nicht gestartet.').replace('{name}', name), 'error');
                        return;
                    }
                    if (remaining < required) {
                        const shortage = Math.round(required - remaining);
                        const msg = (texts.spool_check_short || 'Achtung: Spule {name} hat nur {remaining} g, der Druck braucht ca. {required} g (es fehlen {shortage} g). Trotzdem starten?')
                            .replace('{name}', name)
                            .replace('{remaining}', Math.round(remaining))
                            .replace('{required}', Math.round(required))
                            .replace('{shortage}', shortage);
                        const okShort = window.showConfirmDialog
                            ? await new Promise(res => window.showConfirmDialog(msg, () => res(true), () => res(false)))
                            : (window.skConfirm ? await window.skConfirm(msg) : true);
                        if (!okShort) return;
                    }
                }
            }
        } catch (_) { /* Check ist best-effort — bei Fehler trotzdem drucken */ }

        // Checkbox nicht gefunden → timelapse NICHT mitsenden (null): der
        // Adapter lässt das globale Setting dann unangetastet, statt es
        // ungewollt auf false zu kippen.
        const timelapseCb = document.querySelector(`.print-opt-timelapse[data-file="${filename}"]`);
        const timelapse = timelapseCb ? timelapseCb.checked : null;
        const r = await window.printerAdapter.startPrint(filename, { timelapse });
        if (r.ok) {
            skToast(filename, 'info');
            if (typeof closeSDModal === 'function') closeSDModal();
        } else {
            skToast(r.error || texts.toast_print_failed, 'error');
        }
    }

    // ========================================
    // sendPrintCommand
    // ========================================
    async sendPrintCommand(filename, location, plate, spoolMapping, forceStart = false, extraBody = null) {
        const texts = window.texts || {};
        const getPrintOption = (className) => {
            const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
            return checkbox ? checkbox.checked : false;
        };

        const printOptions = {
            ...collectPrintOptions(filename)
        };

        const requestBody = {
            command: 'print_sd',
            filename: filename,
            location: location || 'cache',
            plate: plate,
            ...printOptions
        };

        // Add force parameter if user confirmed warnings
        if (forceStart) {
            requestBody.force = true;
        }

        if (spoolMapping) {
            requestBody.spool_mapping = spoolMapping;
        } else if (this.currentPlateSelection && this.currentPlateSelection.spoolId) {
            requestBody.spool_id = this.currentPlateSelection.spoolId;
        }

        // Extra-Felder (z.B. filament_confirmed: true vom Mismatch-Dialog-Retry,
        // oder explizite spool_id-Ueberschreibung).
        if (extraBody && typeof extraBody === 'object') {
            Object.assign(requestBody, extraBody);
        }

        try {
            const response = await apiCall('/api/mqtt/print', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            // Debug: Log response details
            console.log('Print response:', {status: response.status, data: data});

            // Single-Filament Mismatch (HTTP 409 mit filament_mismatch):
            // Backend konnte nicht eindeutig automatchen -> User-Dialog.
            if (response.status === 409 && data.filament_mismatch) {
                console.log('Showing filament-mismatch dialog (HTTP 409)');
                this.showFilamentMismatchDialog(filename, location, plate, printOptions, data.filament_mismatch);
                return;
            }

            // Check for filament warnings FIRST (HTTP 409)
            if (response.status === 409 && data.filament_warnings) {
                console.log('Showing filament warning dialog (HTTP 409)');
                this.showFilamentWarningDialog(filename, location, plate, spoolMapping, data.filament_warnings, data.has_critical_errors);
                return;
            }

            // Check for critical errors (HTTP 400)
            if (response.status === 400 && data.filament_warnings) {
                console.log('Showing filament error dialog (HTTP 400)');
                this.showFilamentErrorDialog(data.filament_warnings);
                return;
            }

            if (data.success) {
                closeMultiFilamentSpoolModal();
                document.getElementById('plateSelectModal').style.display = 'none';
                closeSDModal();

                // SpoolmanCard update is handled by backend via SocketIO 'spoolman_active_spool' event

                // Zweite Zeile nennt die Datei, die Handlung fuehrt zur Karte —
                // vorher stand nur "Druck gestartet" da und man scrollte selbst.
                const zeigeKarte = () => {
                    const karte = document.getElementById('print-status-container');
                    if (karte) karte.scrollIntoView({ behavior: 'smooth', block: 'center' });
                };
                const timelapseInfo = printOptions.timelapse ? (' ' + texts.with_timelapse) : '';
                skToast(texts.toast_print_started, {
                    detail: (window.cleanPrintName ? window.cleanPrintName(filename) : filename)
                            + timelapseInfo,
                    aktion: { text: texts.toast_show || 'Anzeigen', onClick: zeigeKarte },
                });

                setTimeout(zeigeKarte, 500);
            } else {
                if (data.error && data.error.indexOf('guard_') === 0) {
                    // Server-Guard (z.B. Filament-Wechsel laeuft noch) —
                    // Schluessel uebersetzen statt roh anzeigen.
                    window.skToast((window.texts || {})[data.error] || data.error, 'warning');
                } else if (data.error && (data.error.includes('Spoolman') || data.error.includes('Spule'))) {
                    window.skToast(data.error, 'warning');
                } else {
                    window.skToast(data.error || texts.alert_print_start_failed, 'error');
                }
            }

        } catch (error) {
            console.error('Print error caught:', error);

            // Check if error contains filament warning data
            if (error.response) {
                const errorData = await error.response.json();
                console.log('Error response data:', errorData);

                // Check for filament warnings (HTTP 409)
                if (error.response.status === 409 && errorData.filament_warnings) {
                    console.log('Showing filament warning dialog from catch');
                    this.showFilamentWarningDialog(filename, location, plate, spoolMapping, errorData.filament_warnings, errorData.has_critical_errors);
                    return;
                }

                // Check for critical errors (HTTP 400)
                if (error.response.status === 400 && errorData.filament_warnings) {
                    console.log('Showing filament error dialog from catch');
                    this.showFilamentErrorDialog(errorData.filament_warnings);
                    return;
                }
            }

            skToast(texts.connection_error, 'error');
            console.error(texts.console_print_start_error + ':', error);
        }
    }

    // ========================================
    // showFilamentMismatchDialog (Option C: Single-Filament Spool-Confirm)
    // ========================================
    showFilamentMismatchDialog(filename, location, plate, printOptions, mismatch) {
        const self = this;
        const texts = window.texts || {};
        const e = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        const wanted = mismatch.wanted || {};
        const candidates = Array.isArray(mismatch.candidates) ? mismatch.candidates : [];
        const current = mismatch.current_active;
        // Ohne echte Treffer schickt der Server ALLE Spulen mit, damit der
        // Nutzer aus der vollen Liste waehlen kann statt falscher Vorschlaege.
        const allSpools = Array.isArray(mismatch.all_spools) ? mismatch.all_spools : [];

        const farbe = (v, fallback) => {
            const c = String(v || '').replace('#', '');
            return c ? `#${c}` : fallback;
        };

        // Reihenfolge: echte Treffer zuerst, sonst alle Spulen mit der
        // aktiven oben.
        const optionen = [];
        let ohneTreffer = false;
        if (candidates.length > 0) {
            candidates.forEach(sp => optionen.push({ spool: sp, art: 'treffer' }));
            if (current && !candidates.some(c => c.id === current.id)) {
                optionen.push({ spool: current, art: 'aktiv' });
            }
        } else {
            ohneTreffer = true;
            const gesehen = new Set();
            if (current) { optionen.push({ spool: current, art: 'aktiv' }); gesehen.add(current.id); }
            allSpools.forEach(sp => {
                if (!gesehen.has(sp.id)) { optionen.push({ spool: sp, art: 'frei' }); gesehen.add(sp.id); }
            });
        }

        const zeile = (opt) => {
            const sp = opt.spool;
            const fil = sp.filament || {};
            const hersteller = (fil.vendor && fil.vendor.name) || '';
            const name = fil.name || '—';
            const material = fil.material || '';
            const rest = sp.remaining_weight != null ? `${Math.round(sp.remaining_weight)} g` : '';
            const marke = opt.art === 'treffer'
                ? `<span class="sched-marke sched-marke--gruen">${e(texts.fm_match || 'Passt')}</span>`
                : (opt.art === 'aktiv'
                    ? `<span class="sched-marke">${e(texts.fm_current || 'aktuell aktiv')}</span>` : '');
            return `
                <label class="ui-zeile ui-zeile--klick fm-option" data-spool-id="${sp.id}">
                    <input type="radio" name="fm-spule" value="${sp.id}" class="fm-radio">
                    <span class="mf-punkt" style="background:${farbe(fil.color_hex, '#888')};"></span>
                    <span class="ui-zeile-name">
                        <span class="mf-name">${e(hersteller ? hersteller + ' ' : '')}${e(name)}</span>
                        <span class="mf-typ">${e(material)}${rest ? ' · ' + e(rest) : ''}</span>
                    </span>
                    ${marke}
                </label>`;
        };

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%;'
            + 'background:rgba(0,0,0,0.6); z-index:10000; display:flex;'
            + 'align-items:center; justify-content:center;';

        const content = document.createElement('div');
        content.className = 'modal-panel';
        content.style.cssText = 'position:relative; width:92%; max-width:560px;'
            + 'max-height:85vh; overflow-y:auto; border-radius:12px; padding:0;';

        content.innerHTML = `
            <div class="sd-modal-header">
                <h2 class="sd-modal-title">
                    <svg class="hd-ic hd-ic--lg" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/></svg>
                    <span>${e(texts.fm_title || 'Spule bestätigen')}</span>
                </h2>
            </div>

            <div class="ui-koerper" style="padding:16px 20px 20px;">
                <div class="ui-karte">
                    <div class="ui-karte-kopf">
                        <svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>
                        <span>${e(texts.fm_needed || 'Die Datei braucht')}</span>
                    </div>
                    <div class="ui-zeile">
                        <span class="mf-punkt" style="background:${farbe(wanted.color, '#888')};"></span>
                        <span class="ui-zeile-name">
                            <span class="mf-name">${e(wanted.name || '—')}</span>
                            <span class="mf-typ">${e(wanted.vendor || '')}${wanted.material ? ' · ' + e(wanted.material) : ''}</span>
                        </span>
                    </div>
                </div>

                <div class="ui-karte">
                    <div class="ui-karte-kopf">
                        <svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/></svg>
                        <span>${e(optionen.length > 1
                            ? (texts.fm_pick || 'Passende Spule wählen')
                            : (texts.fm_use_this || 'Mit dieser Spule drucken?'))}</span>
                    </div>
                    ${ohneTreffer ? `<div class="fm-hinweis">${e(texts.no_matching_spool
                        || 'Keine passende Spule im Spoolman gefunden — bitte manuell wählen.')}</div>` : ''}
                    <div id="fm-options">${optionen.map(zeile).join('')}</div>
                </div>
            </div>

            <div class="ui-fuss">
                <button class="modal-btn modal-btn-cancel" id="fm-cancel">${e(texts.cancel || 'Abbrechen')}</button>
                <button class="modal-btn modal-btn-success" id="fm-confirm" disabled>
                    ${e(texts.start_print || 'Druck starten')}</button>
            </div>
        `;
        modal.appendChild(content);
        document.body.appendChild(modal);

        let gewaehlt = null;
        const knopf = content.querySelector('#fm-confirm');
        const setzeAuswahl = (id) => {
            gewaehlt = id;
            knopf.disabled = id == null;
        };
        content.querySelectorAll('.fm-option').forEach(el => {
            el.addEventListener('change', () => setzeAuswahl(parseInt(el.dataset.spoolId, 10)));
        });
        // Bei genau einer Moeglichkeit gleich vorwaehlen.
        const einzige = content.querySelectorAll('.fm-option');
        if (einzige.length === 1) {
            einzige[0].querySelector('input').checked = true;
            setzeAuswahl(parseInt(einzige[0].dataset.spoolId, 10));
        }

        content.querySelector('#fm-cancel').onclick = () => modal.remove();
        knopf.onclick = async () => {
            if (!gewaehlt) return;
            try {
                // Erst aktivieren, damit der zweite Anlauf die richtige sieht.
                await apiCall(`/api/spoolman/spool/${gewaehlt}/activate`, { method: 'POST' });
            } catch (err) {
                console.warn('Spool activate failed, retry anyway:', err);
            }
            modal.remove();
            // filament_confirmed=true — der Server ueberspringt den Abgleich.
            self.sendPrintCommand(filename, location, plate, null, false,
                                  { filament_confirmed: true, spool_id: gewaehlt });
        };
    }

    // ========================================
    // showFilamentWarningDialog
    // ========================================
    showFilamentWarningDialog(filename, location, plate, spoolMapping, warnings, hasCritical) {
        const texts = window.texts || {};
        console.log('showFilamentWarningDialog called with warnings:', warnings);

        // Erstelle lesbare Warnungsliste
        const warningLines = warnings.map(w => {
            console.log('Warning item:', w);
            return '• ' + w.message;
        }).join('\n\n');

        const message = `${texts.filament_warning_title}:\n\n${warningLines}\n\n${texts.filament_warning_confirm}`;

        console.log('Showing confirm dialog with message:', message);

        const self = this;
        showConfirmDialog(message, function() {
            console.log('User confirmed, retrying with force=true');
            self.sendPrintCommand(filename, location, plate, spoolMapping, true);
        });
    }

    // ========================================
    // showFilamentErrorDialog
    // ========================================
    showFilamentErrorDialog(warnings) {
        const texts = window.texts || {};
        const errorList = warnings
            .filter(w => w.type === 'critical')
            .map(w => '• ' + w.message)
            .join('\n\n');

        window.skToast(`${texts.filament_error_title}:\n\n${errorList}`, 'error');
    }

    // ========================================
    // proceedWithPlateCheck
    // ========================================
    proceedWithPlateCheck(filename, location) {
        const texts = window.texts || {};
        // NEU: Debug
        console.log('🔍 proceedWithPlateCheck aufgerufen');
        console.log('🔍 window.pendingSpoolMapping:', window.pendingSpoolMapping);

        // Speichere für später
        this.currentPlateSelection = {
            filename: filename,
            location: location,
            spoolId: window.activeSpoolId,
            spoolMapping: window.pendingSpoolMapping || null
        };

        console.log('🔍 currentPlateSelection:', this.currentPlateSelection);

        // Clear pending mapping
        if (window.pendingSpoolMapping) {
            delete window.pendingSpoolMapping;
        }

        // Zeige Modal mit Ladeindikator
        const modal = document.getElementById('plateSelectModal');
        const loading = document.getElementById('plate-loading');
        const list = document.getElementById('plate-list');
        const filenameDiv = document.getElementById('plate-filename');

        loading.style.display = 'block';
        list.style.display = 'none';

        const displayName = filename.length > 30 ?
            filename.substring(0, 27) + '...' : filename;
        filenameDiv.textContent = displayName;

        modal.style.display = 'block';

        const self = this;

        // Wenn der Multi-Filament-Modal die Plate bereits gewaehlt hat
        // (pendingPlateOverride), Plate-Picker ueberspringen und direkt
        // drucken — der User hat oben schon die Platte selektiert, wir
        // muessen ihn nicht nochmal fragen.
        if (typeof window.pendingPlateOverride === 'number') {
            const overridePlate = window.pendingPlateOverride;
            delete window.pendingPlateOverride;
            modal.style.display = 'none';
            self.continuePrintWithPlate(overridePlate);
            return;
        }

        // Prüfe Platten
        apiCall(`/api/check_plates/${filename}`)
            .then(response => response.json())
            .then(plateData => {
                loading.style.display = 'none';

                if (plateData.multi && plateData.plates.length > 1) {
                    // Multi-Plate: Zeige Auswahl
                    self.showPlateButtons(plateData);
                } else {
                    // Single-Plate: Schließe Modal und starte direkt
                    modal.style.display = 'none';
                    const plate = plateData.plates ? plateData.plates[0] : 1;

                    const getPrintOption = (className) => {
                        const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
                        return checkbox ? checkbox.checked : false;
                    };

                    const printOptions = {
                        ...collectPrintOptions(filename)
                    };

                    // Starte direkt ohne Bestätigung
                    self.continuePrintWithPlate(plate);
                }
            })
            .catch(error => {
                console.error(texts.console_plate_check_error + ':', error);
                modal.style.display = 'none';

                // Fallback: Frage trotzdem
                const getPrintOption = (className) => {
                    const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
                    return checkbox ? checkbox.checked : false;
                };

                const printOptions = {
                    ...collectPrintOptions(filename)
                };

                // Fallback: Starte mit Platte 1
                self.continuePrintWithPlate(1);
            });
    }

    // ========================================
    // showPlateButtons
    // ========================================
    showPlateButtons(plateData) {
        const list = document.getElementById('plate-list');

        // Zeige Liste
        list.style.display = 'grid';
        list.innerHTML = '';

        // Nutze plate_details wenn vorhanden
        const plateDetails = plateData.plate_details || plateData.plates.map(p => ({index: p}));

        const self = this;

        plateDetails.forEach(plate => {
            const btn = document.createElement('button');
            btn.style.cssText = `
                background: var(--bg-secondary);
                border: 2px solid var(--border-color);
                border-radius: 8px;
                padding: 8px;
                cursor: pointer;
                transition: all 0.2s;
                color: var(--text-primary);
                font-size: 13px;
                font-weight: bold;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 5px;
                position: relative;
                overflow: hidden;
            `;

            // Mit Thumbnail oder Icon
            if (plate.thumbnail) {
                btn.innerHTML = `
                    <img src="${imageDataUrl(plate.thumbnail)}" class="plate-thumb"
                         style="width:60px; height:60px; object-fit:cover; border-radius:4px;">
                    <span>Platte ${plate.index}</span>
                    ${plate.weight ? `<span style="font-size:11px; color:var(--text-secondary);">${plate.weight}g</span>` : ''}
                `;
            } else {
                btn.innerHTML = `
                    ${(typeof window.skIcon === 'function') ? window.skIcon('platte', 'hd-ic--lg') : ''}
                    <span>Platte ${plate.index}</span>
                    ${plate.weight ? `<span style="font-size:11px; color:var(--text-secondary);">${plate.weight}g</span>` : ''}
                `;
            }

            // Hover
            btn.onmouseover = () => {
                btn.style.borderColor = 'var(--accent-blue)';
                btn.style.transform = 'scale(1.05)';
                btn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
            };

            btn.onmouseout = () => {
                btn.style.borderColor = 'var(--border-color)';
                btn.style.transform = 'scale(1)';
                btn.style.boxShadow = 'none';
            };

            // Click
            btn.onclick = () => self.selectPlate(plate.index);

            list.appendChild(btn);
        });
    }

    // ========================================
    // selectPlate
    // ========================================
    selectPlate(plateNumber) {
        const texts = window.texts || {};
        // Schließe Platten-Modal
        document.getElementById('plateSelectModal').style.display = 'none';

        // Visuelles Feedback
        skToast(texts.toast_preparing_print, 'info');

        // Starte direkt ohne weitere Bestätigung
        this.continuePrintWithPlate(plateNumber);
    }

    // ========================================
    // closePlateModal
    // ========================================
    closePlateModal() {
        document.getElementById('plateSelectModal').style.display = 'none';
        this.currentPlateSelection = null;
    }

    // ========================================
    // continuePrintWithPlate
    // ========================================
    continuePrintWithPlate(plateNumber) {
        const texts = window.texts || {};
        if (!this.currentPlateSelection) return;

        const { filename, location, spoolId, spoolMapping } = this.currentPlateSelection;

        // Schließe SD-Modal sofort
        closeSDModal();

        // Warte kurz, dann zeige Toast
        setTimeout(() => {
            skToast(texts.toast_starting_print_plate.replace('{plate}', plateNumber), 'info');
        }, 100);

        // Hole ALLE Print-Optionen
        const getPrintOption = (className) => {
            const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
            return checkbox ? checkbox.checked : false;
        };

        const printOptions = {
            ...collectPrintOptions(filename)
        };

        // Gewichtsprüfung vor dem Druck (nur bei Single-Filament)
        if (window._skipSpoolCheck) { delete window._skipSpoolCheck; }
        else if (window.spoolmanEnabled && spoolId && !spoolMapping) {
            // Finde die Datei-Daten
            const fileData = window.sdDateiFinden ? window.sdDateiFinden(filename)
            : window.lastSDFiles?.find(f => f.name === filename);

            if (fileData && fileData.weight) {
                const activeSpool = window.spoolmanSpools?.find(s => s.id === spoolId);
                if (activeSpool && activeSpool.remaining_weight) {
                    const printWeight = fileData.weight;
                    const remaining = activeSpool.remaining_weight;

                    if (printWeight > remaining) {
                        const shortage = printWeight - remaining;
                        const message = texts.confirm_filament_shortage
                            .replace('{needed}', printWeight.toFixed(0))
                            .replace('{available}', remaining.toFixed(0))
                            .replace('{shortage}', shortage.toFixed(0));

                        const self = this;
                        showConfirmDialog(message, function() {
                            // User bestätigt — Druck trotzdem starten (skip check)
                            window._skipSpoolCheck = true;
                            // Direkt weiter im Ablauf: der User hat die
                            // Vorbereitung schon ausgefuellt und gerade erst
                            // bestaetigt — die Ansicht nochmal zu zeigen waere
                            // nur im Weg.
                            self.beginPrintFlow(filename, location);
                        }, function() {
                            self.currentPlateSelection = null;
                        });
                        return;
                    }
                }
            }
        }

        // Baue Request Body VOR dem apiCall
        const requestBody = {
            command: 'print_sd',
            filename: filename,
            location: location || 'cache',
            plate: plateNumber,
            ...printOptions  // Alle Optionen hinzufügen
        };

        // Multi-Filament: Nutze Spool-Mapping
        if (spoolMapping) {
            console.log('🔍 spoolMapping vorhanden:', spoolMapping);
            console.log('🔍 spoolMapping type:', typeof spoolMapping);
            console.log('🔍 spoolMapping JSON:', JSON.stringify(spoolMapping));
            requestBody.spool_mapping = spoolMapping;
        } else if (spoolId) {
            console.log('🔍 Only spool_id:', spoolId);
            // Single-Filament: Nutze einzelne Spool ID
            requestBody.spool_id = spoolId;
        }

        console.log('🔍 FINALER requestBody:', JSON.stringify(requestBody, null, 2));

        const self = this;

        // Sende Druck OHNE weitere Bestätigung
        apiCall('/api/mqtt/print', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(requestBody)
        })
        .then(response => {
            // Parse JSON und behalte response für Status-Check
            return response.json().then(data => ({response, data}));
        })
        .then(({response, data}) => {
            console.log('continuePrintWithPlate response:', {status: response.status, data: data});

            // Single-Filament Mismatch (Option C): Backend konnte nicht
            // eindeutig auto-matchen -> User-Dialog mit Kandidaten.
            if (response.status === 409 && data.filament_mismatch) {
                console.log('Showing filament-mismatch dialog from continuePrintWithPlate');
                self.showFilamentMismatchDialog(filename, location, plateNumber, null, data.filament_mismatch);
                self.currentPlateSelection = null;
                return;
            }

            // Check for filament warnings FIRST (HTTP 409)
            if (response.status === 409 && data.filament_warnings) {
                console.log('Showing filament warning dialog from continuePrintWithPlate');
                self.showFilamentWarningDialog(filename, location, plateNumber, spoolMapping, data.filament_warnings, data.has_critical_errors);
                self.currentPlateSelection = null;
                return;
            }

            // Check for critical errors (HTTP 400)
            if (response.status === 400 && data.filament_warnings) {
                console.log('Showing filament error dialog from continuePrintWithPlate');
                self.showFilamentErrorDialog(data.filament_warnings);
                self.currentPlateSelection = null;
                return;
            }

            if (data.success) {
                // Erfolgs-Feedback mit Verzögerung
                setTimeout(() => {
                    skToast(texts.toast_plate_printing.replace('{plate}', plateNumber), 'success');
                }, 200);

                // Nach kurzer Verzögerung zur Progress-Card scrollen
                setTimeout(() => {
                    const progressCard = document.querySelector('.progress-card');
                    if (progressCard) {
                        progressCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 500);
            } else {
                // Zeige Fehler
                if (data.error && (data.error.includes('Spoolman') || data.error.includes('Spule'))) {
                    window.skToast(data.error, 'warning');

                    self.closePlateModal();
                    closeSDModal();

                    const spoolmanCard = document.getElementById('spoolman-card');
                    if (spoolmanCard) {
                        spoolmanCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        spoolmanCard.style.border = '2px solid var(--accent-red)';
                        setTimeout(() => {
                            spoolmanCard.style.border = '';
                        }, 3000);
                    }

                    skToast(texts.toast_select_spool_first, 'warning');
                } else {
                    window.skToast(data.error || texts.alert_print_start_failed, 'error');
                    skToast(texts.toast_error_starting, 'error');
                }
            }
            self.currentPlateSelection = null;
        })
        .catch(error => {
            skToast(texts.connection_error, 'error');
            console.error(texts.console_print_start_error + ':', error);
            self.currentPlateSelection = null;
        });
    }

    // ========================================
    // startPrintWithoutPlateCheck
    // ========================================
    startPrintWithoutPlateCheck(filename, location) {
        const texts = window.texts || {};
        const getPrintOption = (className) => {
            const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
            return checkbox ? checkbox.checked : false;
        };

        const printOptions = {
            ...collectPrintOptions(filename)
        };

        const message = printOptions.timelapse ?
            texts.confirm_print_with_timelapse.replace('{filename}', filename) :
            texts.confirm_print_without_timelapse.replace('{filename}', filename);

        const self = this;
        showConfirmDialog(message, function() {
            apiCall('/api/mqtt/print', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    command: 'print_sd',
                    filename: filename,
                    location: location || 'cache',
                    plate: 1,
                    spool_id: window.activeSpoolId,
                    ...printOptions
                })
            })
            .then(response => {
                return response.json().then(data => ({response, data}));
            })
            .then(({response, data}) => {
                if (response.status === 409 && data.filament_mismatch) {
                    self.showFilamentMismatchDialog(filename, location, 1, null, data.filament_mismatch);
                    return;
                }
                if (response.status === 409 && data.filament_warnings) {
                    self.showFilamentWarningDialog(filename, location, 1, null, data.filament_warnings, data.has_critical_errors);
                    return;
                }
                if (response.status === 400 && data.filament_warnings) {
                    self.showFilamentErrorDialog(data.filament_warnings);
                    return;
                }
                if (data.success) {
                    closeSDModal();
                    const timelapseInfo = data.timelapse ? (' (' + texts.with_timelapse + ')') : '';
                    skToast(texts.toast_print_started_file.replace('{filename}', filename) + timelapseInfo, 'success');
                } else {
                    skToast(data.error || texts.toast_unknown_error, 'error');
                }
            });
        });
    }

    /* Hier lag bis 21aug26 der Druck-Detail-Dialog der Startseite
       (initDetailModalTranslations, showOverviewTab, switchDetailTab,
       showProgressChart, showEventsTimeline, toggleTimelapseFullscreen)
       samt Partial _print-detail.html — rund 550 Zeilen, die nie jemand
       zu Gesicht bekam: geoeffnet wurde der Dialog nirgends, und die
       Druck-Historie bringt seit ihrem Umbau eigene, gepflegte Fassungen
       derselben Funktionen mit. */
}

// ========================================
// Instantiate global manager
// ========================================
window.printActions = new PrintActionsManager();

// ========================================
// Global wrappers for HTML onclick handlers
// ========================================
function pausePrint() { window.printActions.pausePrint(); }
function resumePrint() { window.printActions.resumePrint(); }
function stopPrint() { window.printActions.stopPrint(); }
function startHoming() { window.printActions.startHoming(); }
function startPrintFromSD(filename, location, buttonElement) { window.printActions.startPrintFromSD(filename, location, buttonElement); }
function sendPrintCommand(filename, location, plate, spoolMapping, forceStart) { window.printActions.sendPrintCommand(filename, location, plate, spoolMapping, forceStart); }
function showFilamentWarningDialog(filename, location, plate, spoolMapping, warnings, hasCritical) { window.printActions.showFilamentWarningDialog(filename, location, plate, spoolMapping, warnings, hasCritical); }
function showFilamentErrorDialog(warnings) { window.printActions.showFilamentErrorDialog(warnings); }
function proceedWithPlateCheck(filename, location) { window.printActions.proceedWithPlateCheck(filename, location); }
function showPlateButtons(plateData) { window.printActions.showPlateButtons(plateData); }
function selectPlate(plateNumber) { window.printActions.selectPlate(plateNumber); }
function closePlateModal() { window.printActions.closePlateModal(); }
function continuePrintWithPlate(plateNumber) { window.printActions.continuePrintWithPlate(plateNumber); }
function startPrintWithoutPlateCheck(filename, location) { window.printActions.startPrintWithoutPlateCheck(filename, location); }
