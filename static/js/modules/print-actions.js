/**
 * Print Actions Manager
 * Handles print control actions (pause/resume/stop), homing, print-from-SD workflow,
 * plate selection, filament warning/error dialogs, print detail modal tabs,
 * progress chart, events timeline, and timelapse fullscreen.
 */
/**
 * Collect the print options in ONE place.
 *
 * Used to be spelled out identically five times in the module — every new
 * option had to be maintained in all five spots, and that is exactly where
 * the three-stage calibrations would have gotten stuck.
 *
 * Three-stage means: 0 off, 1 on, 2 automatic. That's how the printer knows
 * them (measured against real Bambu Studio commands on 18aug26), and that's
 * how it shows them on its display too.
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
        // Drying in parallel with the print. The server pulls material and
        // values from the 3MF itself — the switch here is enough.
        dry_during_print: haken('print-opt-dry-during'),
    };
}

// ========================================
// Skip parts
// ========================================
// The printer can drop individual parts of a running print
// (skip_objects, fun bit 49). If one comes loose from the bed, this saves
// the rest of the job — until now the only option was to abort.
//
// Not reversible: whatever is skipped does not come back in this job.
// That's why there's a checklist and an explicit confirmation prompt.
// Visibility of the button. ONE function, called from both paths: the
// web runs over the socket, the poll is only the fallback. That is exactly
// why the button did not show up on the first attempt — the logic was
// stuck in the poll path, which never runs while the socket is active. The
// comment in socket-manager already names the same bug for the device display.
window.skTeileKnopfZeigen = function (data) {
    if (!data) return;
    const laeuft = ['RUNNING', 'PAUSE'].includes(
        String(data.gcode_state || '').toUpperCase()) || data.paused === true;
    const sichtbar = laeuft && data.kann_teile_ueberspringen === true;
    // Three places: the print card (that's where you look during a print)
    // and the two button rows on the developer card.
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
        return aufgeben();            // cross-origin source — then just go without the image
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
        if (!punkte[pos + 3]) return;          // missed
        // The number lives in TWO channels: red is the low byte, green
        // is the high byte. Measured on 31aug26 on a part numbered 752 —
        // the pick map carried RGB(240, 2, 0) there, and 240 + 2*256 = 752.
        //
        // The old measurement on six cubes (numbers 56 to 204) still held
        // true: below 256, green is always 0. Reading only red gets you
        // 240 instead of 752 for larger numbers and finds no part — the
        // tap then did nothing at all.
        const nummer = punkte[pos] + punkte[pos + 1] * 256;
        if (!bekannt.has(nummer)) return;      // already skipped
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

    // The name alone is not enough: three copies of the same part all have
    // the same name (seen on 29aug26 with "Cube + Cube + Cube"). So the
    // number is always added — it's what gets sent anyway —
    // along with the position on the plate, so you can find it on the device.
    // The position is determined RELATIVE to the other parts; the bed size
    // plays no role.
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
            // Show the printer's own reason, not our error code. It
            // says exactly what's going on ("no matched obj_list"), and that is
            // worth more than a generic "failed".
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
        // Unified — backend dispatches depending on the controller (Bambu MQTT, Klipper REST).
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
        // During an active filament-change pause (phase 1/2) the resume button
        // is an action button — see socket-manager.js, which changes the icon/label.
        // Phase 1: "Load filament" -> filamentChangeAction('load')
        // Phase 2: "Done"            -> filamentChangeAction('done')
        // Phase 0: normal resume
        const fcPhase = (window.lastPrintData &&
                         window.lastPrintData.filament_change_phase) || 0;
        if (fcPhase === 1 || fcPhase === 2) {
            const action = (fcPhase === 1) ? 'load' : 'done';
            window.filamentChangeAction(action).then(() => {
                document.getElementById('resume-btn-mobile').style.display = 'none';
                document.getElementById('resume-btn-desktop').style.display = 'none';
            }).catch(() => { /* error toast already shown in filamentChangeAction */ });
            return;
        }

        // Unified — normal resume.
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
        showConfirmDialog({ text: texts.confirm_stop_print, knopf: texts.confirm_stop, gefaehrlich: true }, function() {
            window.printerAdapter.stop();
        });
    }

    // ========================================
    // startHoming
    // ========================================
    startHoming() {
        const texts = window.texts || {};
        // Label for the homing button — icon from icons.js instead of an emoji.
        const homingInhalt = (text) =>
            ((typeof window.skIcon === 'function') ? window.skIcon('haus') : '') + '<span>' + text + '</span>';
        showConfirmDialog(texts.confirm_start_homing, function() {
        // Disable button during homing
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
            // Re-enable buttons after 25 seconds (fallback)
            // Normally reset earlier by a home_flag update
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
     * Entry point for clicking "Print".
     *
     * Bambu: show the print preparation first — preview, plate, filament
     * and all options on one sheet, just like the printer does on its
     * own display. Before, the options lived in the file list's gear menu
     * and were no longer visible while printing.
     *
     * The actual flow behind it (spool check, multi-color dialog,
     * plate selection, start) stays unchanged and lives in beginPrintFlow.
     */
    startPrintFromSD(filename, location, buttonElement) {
        const istKlipper = window.isKlipperMode && window.isKlipperMode();
        if (!istKlipper && window.printPrepare) {
            window.printPrepare.oeffne(filename, location).then(gezeigt => {
                // Preparation not loadable (e.g. file not in the
                // cache)? Then go straight to the old path instead of doing nothing.
                if (!gezeigt) this.beginPrintFlow(filename, location, buttonElement);
            });
            return;
        }
        this.beginPrintFlow(filename, location, buttonElement);
    }

    beginPrintFlow(filename, location, buttonElement) {
        const texts = window.texts || {};

        // Klipper: simple print start without the AMS/plate/spool wizard.
        // Backend dispatches via controller.start_print(filename).
        // Only supported option: timelapse (moonraker-timelapse plugin).
        if (window.isKlipperMode && window.isKlipperMode()) {
            const msg = (texts.confirm_start_print || 'Druck starten') + ': ' + filename + '?';
            // Custom styled modal instead of native confirm() (like in the Bambu path).
            if (window.showConfirmDialog) {
                window.showConfirmDialog({ text: msg, knopf: texts.confirm_start }, () => this._klipperStartWithSpoolCheck(filename));
            } else if (window.skConfirm) {
                window.skConfirm(msg).then(ja => {
                    if (ja) this._klipperStartWithSpoolCheck(filename);
                });
            }
            return;
        }

        // PRIORITY 1: multi-filament check
        const fileData = window.sdDateiFinden ? window.sdDateiFinden(filename)
            : window.lastSDFiles?.find(f => f.name === filename);

        if (fileData && fileData.is_multifilament && fileData.all_filaments) {
            // Assigning a spool per colour needs Spoolman. Printing does not:
            // the server picks the tray for each filament by type and colour
            // straight from the AMS — mqtt_payload_builder never asks
            // Spoolman anything. So without it, carry on to the plate check
            // instead of refusing the file.
            if (window.spoolmanManager && window.spoolmanManager.connected) {
                showMultiFilamentSpoolModal(fileData, location, 'print');
                return;
            }
        }

        // PRIORITY 2: Spoolman single-filament check
        let selectedSpoolId = window.activeSpoolId;

        if (buttonElement) {
            // .sd-zeile has been the file row since the 21aug26 rework;
            // .sd-file-card and .file-card stay in for other lists.
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

        // PRIORITY 3: continue with the plate check
        this.proceedWithPlateCheck(filename, location);
    }

    _findHumidityAssignmentCandidate(feuchteStand, spoolId) {
        if (!feuchteStand || spoolId == null) return null;
        const id = parseInt(spoolId, 10);
        if (!Number.isFinite(id)) return null;

        const offene = (feuchteStand.spulen || []).filter(s => s && s.spool_id == null);
        if (!offene.length) return null;

        const jeSlot = new Map();
        (feuchteStand.verlauf_spulen || []).forEach(e => {
            if (!e) return;
            jeSlot.set(`${e.ams_id}:${e.slot}`, e);
        });

        const treffer = [];
        offene.forEach(s => {
            const slot = Number.isFinite(parseInt(s.slot, 10)) ? parseInt(s.slot, 10) : 0;
            const amsId = Number.isFinite(parseInt(s.ams_id, 10)) ? parseInt(s.ams_id, 10) : null;
            if (amsId == null) return;
            const verlauf = jeSlot.get(`${amsId}:${slot}`) || null;
            const vorschlaege = Array.isArray((verlauf || {}).vorschlaege)
                ? verlauf.vorschlaege
                : (Array.isArray(s.vorschlaege) ? s.vorschlaege : []);
            const passend = vorschlaege.find(v => {
                const vid = parseInt((v && (v.spool_id != null ? v.spool_id : v.id)), 10);
                return Number.isFinite(vid) && vid === id;
            });
            if (!passend) return;
            treffer.push({
                ams_id: amsId,
                slot: slot,
                typ: s.typ || (verlauf && verlauf.typ) || '',
                farbe: s.farbe || (verlauf && verlauf.farbe) || '',
                name: s.name || (verlauf && verlauf.name) || '',
            });
        });

        return treffer.length === 1 ? treffer[0] : null;
    }

    async _confirmHumidityAssignmentBeforePrint(spoolId, spoolMapping) {
        if (!window.amsHumidity) return;

        // A multi-colour print carries one spool per filament index instead of
        // a single spool id. Until 04sep26 the presence of that mapping made
        // this method return on the spot -- so the one case where the user has
        // just named every spool by hand was the one case nothing was
        // remembered, and the material card kept the slot marked orange
        // ("not assigned to any spool") until it was assigned a second time
        // through the tray editor.
        //
        // Every entry is resolved the same way a single spool is, and a slot
        // is only claimed when exactly one candidate fits it -- guessing stays
        // out of this.
        const rohIds = spoolMapping
            ? Object.values(spoolMapping)
            : (spoolId != null ? [spoolId] : []);
        const ids = [...new Set(rohIds.map(v => parseInt(v, 10)).filter(Number.isFinite))];
        if (!ids.length) return;

        let stand = null;
        try {
            stand = await window.amsHumidity.hole(14);
        } catch (_) {
            return;
        }

        const texts = window.texts || {};
        const namen = (nummer) => {
            const spool = (window.spoolmanSpools || []).find(s => s.id === nummer);
            const filament = (spool && spool.filament) || {};
            return [
                filament.vendor && filament.vendor.name ? filament.vendor.name : '',
                filament.name || ''
            ].filter(Boolean).join(' ') || `#${nummer}`;
        };

        const offen = [];
        const belegteFaecher = new Set();
        ids.forEach(nummer => {
            const kandidat = this._findHumidityAssignmentCandidate(stand, nummer);
            if (!kandidat) return;
            const fach = kandidat.ams_id + ':' + kandidat.slot;
            // Two spools pointing at the same slot means the suggestion is not
            // unambiguous after all -- then neither of them gets it.
            if (belegteFaecher.has(fach)) {
                const i = offen.findIndex(e => e.fach === fach);
                if (i >= 0) offen.splice(i, 1);
                return;
            }
            belegteFaecher.add(fach);
            offen.push({ fach, spoolNum: nummer, kandidat });
        });
        if (!offen.length) return;

        const message = offen.map(e => (texts.feuchte_assign_before_print
            || 'AMS slot {slot} has no spool assignment for humidity history. Assign {spool} now?')
            .replace('{slot}', String((e.kandidat.slot || 0) + 1))
            .replace('{spool}', namen(e.spoolNum))).join('\n\n');

        const bestaetigt = await new Promise(resolve => {
            if (window.showConfirmDialog) {
                window.showConfirmDialog(message, () => resolve(true), () => resolve(false));
                return;
            }
            if (window.skConfirm) {
                window.skConfirm(message).then(resolve).catch(() => resolve(false));
                return;
            }
            resolve(false);
        });
        if (!bestaetigt) return;

        try {
            for (const e of offen) {
                await window.apiCall('/api/filament/feuchte/zuordnung', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ams_id: e.kandidat.ams_id,
                        slot: e.kandidat.slot,
                        spool_id: e.spoolNum,
                        typ: e.kandidat.typ || '',
                        farbe: e.kandidat.farbe || '',
                        name: e.kandidat.name || '',
                    }),
                });
            }
            if (window.amsHumidity) window.amsHumidity.vergiss();
            if (window.skToast) window.skToast(texts.feuchte_assignment_saved, 'success');
        } catch (e) {
            if (window.skToast) window.skToast(texts.feuchte_assignment_save_failed, 'warning');
            console.warn('Failed to persist AMS humidity mapping before print:', e);
        }
    }

    // Klipper print start with a spool weight check (like the Bambu server does before printing):
    // required filament (Moonraker metadata) vs. the remaining weight of the active
    // Spoolman spool. Empty → block; not enough → ask for confirmation; no spool/Spoolman
    // off → just print.
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

                // 1) Material mismatch (Companion logic pulled forward — otherwise it would
                //    only stop the print mid heat-soak): first
                //    profile type vs. spool material, base material normalized.
                const baseMat = (s) => {
                    let t = String(s || '').toUpperCase().trim();
                    for (const sep of ['+', '-', ' ', '/', '_']) t = t.split(sep)[0];
                    return t.trim();
                };
                // filament_type can be an array, a JSON-array string (["PLA","PLA","TPU"])
                // or "PLA;PLA;TPU" — multi-plate files list ALL plates.
                // We don't know the chosen plate here → the spool has to match
                // ANY of the types, otherwise false positive (e.g. a TPU plate
                // in a file whose plate 1 is PLA).
                let typeList = (fileData && fileData.filament_type);
                if (!Array.isArray(typeList)) {
                    let s = String(typeList || '').trim();
                    if (s.startsWith('[')) { try { typeList = JSON.parse(s); } catch (_) { typeList = null; } }
                    if (!Array.isArray(typeList)) typeList = s.split(/[;,]/);
                }
                const profileBases = [...new Set(typeList.map(baseMat).filter(Boolean))];
                const spoolBase = baseMat(fil.material);
                if (profileBases.length && spoolBase && !profileBases.includes(spoolBase)) {
                    // BLOCK (no override): the Companion would abort the print
                    // during heat-soak anyway — fix the spool/profile first.
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
                            ? await new Promise(res => window.showConfirmDialog({ text: msg, knopf: texts.confirm_print_anyway }, () => res(true), () => res(false)))
                            : (window.skConfirm ? await window.skConfirm(msg) : true);
                        if (!okShort) return;
                    }
                }
            }
        } catch (_) { /* check is best-effort — print anyway on error */ }

        // Checkbox not found → do NOT send timelapse (null): the
        // adapter then leaves the global setting untouched, instead of
        // unintentionally flipping it to false.
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

        // Extra fields (e.g. filament_confirmed: true from the mismatch-dialog retry,
        // or an explicit spool_id override).
        if (extraBody && typeof extraBody === 'object') {
            Object.assign(requestBody, extraBody);
        }

        await this._confirmHumidityAssignmentBeforePrint(
            requestBody.spool_id,
            requestBody.spool_mapping
        );

        try {
            const response = await apiCall('/api/mqtt/print', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            // Debug: Log response details
            console.log('Print response:', {status: response.status, data: data});

            // Single-filament mismatch (HTTP 409 with filament_mismatch):
            // backend could not auto-match unambiguously -> user dialog.
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
                // The multi-filament dialog closes itself before it starts the
                // print (print-scheduler.js, `modal.remove()` right before
                // proceedWithPlateCheck). A `closeMultiFilamentSpoolModal()`
                // stood here and was never defined anywhere -- it threw a
                // ReferenceError on every multi-colour start, and everything
                // below it was skipped: the two dialogs stayed open and the
                // "print started" toast never appeared, while the print itself
                // was already running.
                document.getElementById('plateSelectModal').style.display = 'none';
                closeSDModal();
                // Only now — the job has been accepted.
                if (texts.toast_starting_print_plate) {
                    skToast(texts.toast_starting_print_plate
                        .replace('{plate}', plate != null ? plate : 1), 'info');
                }

                // SpoolmanCard update is handled by backend via SocketIO 'spoolman_active_spool' event

                // Second line names the file, the action leads to the card —
                // before, it just said "print started" and you had to scroll yourself.
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
                    // Server guard (e.g. a filament change still running) —
                    // translate the key instead of showing it raw.
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
    /** The conflict dialog for a print we did NOT send.
     *
     *  showFilamentMismatchDialog below belongs to our own print command: it
     *  asks BEFORE the start and its answer is "take this spool and go". A
     *  job from the slicer is already running when we notice, so the answer
     *  is a different one -- say which spool is really in the tray, or stop
     *  the print. Everything else it shows is the same, so it looks the same.
     */
    zeigeFilamentKonflikt(konflikt, dateiname) {
        const texts = window.texts || {};
        const e = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const farbe = (c, s) => (c && /^#?[0-9a-fA-F]{6}$/.test(c))
            ? (c[0] === '#' ? c : '#' + c) : s;

        const will = konflikt.wanted || {};
        const fach = konflikt.tray || {};
        const kandidaten = Array.isArray(konflikt.candidates) ? konflikt.candidates : [];
        const aktiv = konflikt.current_active;
        const optionen = [];
        const gesehen = new Set();
        kandidaten.forEach(sp => { if (!gesehen.has(sp.id)) { optionen.push(sp); gesehen.add(sp.id); } });
        if (aktiv && !gesehen.has(aktiv.id)) optionen.push(aktiv);

        // Stopping is offered while the printer is still preparing. The
        // check runs at the start, so the message is there in time -- but it
        // waits in the stack, and opening it three hours later must not put
        // a red button next to a print at 80 %. Then the answer is the
        // assignment; whoever really wants to stop has the button on the
        // card, where the whole context is.
        const stand = window.lastPrintData || {};
        const zustand = String(stand.gcode_state || '').toUpperCase();
        const nochVorbereitung = zustand === 'PREPARE'
            || (zustand === 'RUNNING' && Number(stand.progress || 0) <= 0);

        const zeile = (sp, i) => {
            const fil = sp.filament || {};
            const hersteller = (fil.vendor || {}).name || '';
            return `
                <label class="ui-zeile ui-zeile--klick fm-option" data-spool-id="${sp.id}">
                    <input type="radio" name="fk-spule" value="${sp.id}" class="fm-radio"${i === 0 ? ' checked' : ''}>
                    <span class="mf-punkt" style="background:${farbe(fil.color_hex, '#888')};"></span>
                    <span class="ui-zeile-name">
                        <span class="mf-name">${e(hersteller ? hersteller + ' ' : '')}${e(fil.name || '')}</span>
                        <span class="mf-typ">${e(fil.material || '')}</span>
                    </span>
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
                    <span>${e(texts.fk_title || 'Filament passt nicht')}</span>
                </h2>
            </div>
            <div class="ui-koerper" style="padding:16px 20px 20px;">
                <div class="ui-karte">
                    <div class="ui-karte-kopf"><span>${e(texts.fk_file_wants || 'Die Datei braucht')}</span></div>
                    <div class="ui-zeile">
                        <span class="mf-punkt" style="background:${farbe(will.color, '#888')};"></span>
                        <span class="ui-zeile-name">
                            <span class="mf-name">${e(will.name || '—')}</span>
                            <span class="mf-typ">${e(will.material || '')}</span>
                        </span>
                    </div>
                </div>
                <div class="ui-karte">
                    <div class="ui-karte-kopf"><span>${e(texts.fk_tray_holds || 'Im Fach liegt')}</span></div>
                    <div class="ui-zeile">
                        <span class="mf-punkt" style="background:${farbe(fach.color, '#888')};"></span>
                        <span class="ui-zeile-name">
                            <span class="mf-name">${e(fach.name || '—')}</span>
                            <span class="mf-typ">${e(fach.type || '')}</span>
                        </span>
                    </div>
                </div>
                <div class="ui-karte">
                    <div class="ui-karte-kopf"><span>${e(texts.fk_pick || 'Welche Spule liegt wirklich im Fach?')}</span></div>
                    ${optionen.length ? `<div id="fk-options">${optionen.map(zeile).join('')}</div>`
                        : `<div class="fm-hinweis">${e(texts.no_matching_spool || 'Keine passende Spule im Spoolman gefunden.')}</div>`}
                </div>
            </div>
            <div class="ui-fuss">
                <button class="modal-btn modal-btn-cancel" id="fk-zu">${e(texts.close || 'Schliessen')}</button>
                ${nochVorbereitung ? `<button class="modal-btn modal-btn-danger" id="fk-stop">${e(texts.fk_abort_print || 'Druck abbrechen')}</button>` : ''}
                <button class="modal-btn modal-btn-primary" id="fk-ok"${optionen.length ? '' : ' disabled'}>${e(texts.fk_assign || 'Zuordnen')}</button>
            </div>`;
        modal.appendChild(content);
        document.body.appendChild(modal);

        const zu = () => modal.remove();
        content.querySelector('#fk-zu').addEventListener('click', zu);
        modal.addEventListener('click', ev => { if (ev.target === modal) zu(); });

        const stopKnopf = content.querySelector('#fk-stop');
        if (stopKnopf) stopKnopf.addEventListener('click', () => {
            // The same path and the same confirmation as the stop button on
            // the card. Nothing here talks to the printer on its own.
            zu();
            showConfirmDialog({ text: texts.confirm_stop_print, knopf: texts.confirm_stop,
                                gefaehrlich: true }, () => window.printerAdapter.stop());
        });

        content.querySelector('#fk-ok').addEventListener('click', async () => {
            const gewaehlt = content.querySelector('input[name="fk-spule"]:checked');
            if (!gewaehlt) return;
            const id = parseInt(gewaehlt.value, 10);
            const sp = optionen.find(o => o.id === id) || {};
            const fil = sp.filament || {};
            const ruf = window.apiCall || ((u, o) => fetch(u, Object.assign({ credentials: 'include' }, o)));
            try {
                // 1. Bind the spool to the tray -- that is the lasting answer.
                await ruf('/api/filament/feuchte/zuordnung', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ams_id: fach.ams_id, slot: fach.slot, spool_id: id,
                        typ: fil.material || '', farbe: (fil.color_hex || ''),
                        name: ((fil.vendor || {}).name ? (fil.vendor.name + ' ') : '') + (fil.name || '')
                    })
                });
                // 2. Make it the active spool. The running print's history
                //    follows along on the server (_historie_auf_spule).
                await ruf(`/api/spoolman/spool/${id}/activate`, { method: 'POST' });
                zu();
                if (window.skToast) skToast(texts.fk_assigned || 'Zugeordnet', 'success');
            } catch (err) {
                if (window.skToast) skToast(texts.fk_assign_error || 'Zuordnen fehlgeschlagen', 'error');
            }
        });
    }

    showFilamentMismatchDialog(filename, location, plate, printOptions, mismatch) {
        const self = this;
        const texts = window.texts || {};
        const e = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        const wanted = mismatch.wanted || {};
        const candidates = Array.isArray(mismatch.candidates) ? mismatch.candidates : [];
        const current = mismatch.current_active;
        // Without real matches the server sends ALL spools, so the
        // user can choose from the full list instead of getting false suggestions.
        const allSpools = Array.isArray(mismatch.all_spools) ? mismatch.all_spools : [];

        const farbe = (v, fallback) => {
            const c = String(v || '').replace('#', '');
            return c ? `#${c}` : fallback;
        };

        // Order: real matches first, otherwise all spools with the
        // active one on top.
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
        // Pre-select right away when there is exactly one option.
        const einzige = content.querySelectorAll('.fm-option');
        if (einzige.length === 1) {
            einzige[0].querySelector('input').checked = true;
            setzeAuswahl(parseInt(einzige[0].dataset.spoolId, 10));
        }

        content.querySelector('#fm-cancel').onclick = () => modal.remove();
        knopf.onclick = async () => {
            if (!gewaehlt) return;
            try {
                // Activate first, so the second attempt sees the right one.
                await apiCall(`/api/spoolman/spool/${gewaehlt}/activate`, { method: 'POST' });
            } catch (err) {
                console.warn('Spool activate failed, retry anyway:', err);
            }
            modal.remove();
            // filament_confirmed=true — the server skips the matching step.
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

        // Build a readable warning list
        const warningLines = warnings.map(w => {
            console.log('Warning item:', w);
            return '• ' + w.message;
        }).join('\n\n');

        const message = `${texts.filament_warning_title}:\n\n${warningLines}\n\n${texts.filament_warning_confirm}`;

        console.log('Showing confirm dialog with message:', message);

        const self = this;
        showConfirmDialog({ text: message, knopf: texts.confirm_print_anyway }, function() {
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
        // NEW: debug
        console.log('🔍 proceedWithPlateCheck aufgerufen');
        console.log('🔍 window.pendingSpoolMapping:', window.pendingSpoolMapping);

        // Save for later
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

        // Show modal with loading indicator
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

        // If the multi-filament modal already picked the plate
        // (pendingPlateOverride), skip the plate picker and print
        // directly — the user already selected the plate above, we
        // don't need to ask again.
        if (typeof window.pendingPlateOverride === 'number') {
            const overridePlate = window.pendingPlateOverride;
            delete window.pendingPlateOverride;
            modal.style.display = 'none';
            self.continuePrintWithPlate(overridePlate);
            return;
        }

        // Check plates
        apiCall(`/api/check_plates/${filename}`)
            .then(response => response.json())
            .then(plateData => {
                loading.style.display = 'none';

                if (plateData.multi && plateData.plates.length > 1) {
                    // Multi-plate: show selection
                    self.showPlateButtons(plateData);
                } else {
                    // Single-plate: close modal and start directly
                    modal.style.display = 'none';
                    const plate = plateData.plates ? plateData.plates[0] : 1;

                    const getPrintOption = (className) => {
                        const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
                        return checkbox ? checkbox.checked : false;
                    };

                    const printOptions = {
                        ...collectPrintOptions(filename)
                    };

                    // Start directly without confirmation
                    self.continuePrintWithPlate(plate);
                }
            })
            .catch(error => {
                console.error(texts.console_plate_check_error + ':', error);
                modal.style.display = 'none';

                // Fallback: ask anyway
                const getPrintOption = (className) => {
                    const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
                    return checkbox ? checkbox.checked : false;
                };

                const printOptions = {
                    ...collectPrintOptions(filename)
                };

                // Fallback: start with plate 1
                self.continuePrintWithPlate(1);
            });
    }

    // ========================================
    // showPlateButtons
    // ========================================
    showPlateButtons(plateData) {
        const list = document.getElementById('plate-list');

        // Show list
        list.style.display = 'grid';
        list.innerHTML = '';

        // Use plate_details when present
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

            // With thumbnail or icon
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
        // Close plate modal
        document.getElementById('plateSelectModal').style.display = 'none';

        // Visual feedback
        skToast(texts.toast_preparing_print, 'info');

        // Start directly without further confirmation
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
    async continuePrintWithPlate(plateNumber) {
        const texts = window.texts || {};
        if (!this.currentPlateSelection) return;

        const { filename, location, spoolId, spoolMapping } = this.currentPlateSelection;

        // Close SD modal immediately
        closeSDModal();

        // No "Starting print..." at this point. The toast used to appear
        // here unconditionally, 100 ms after the button was pressed — so
        // BEFORE any request had even gone out. If the server then
        // responds with 409 because the file's filament doesn't match the
        // loaded spool, the spool dialog opens, with
        // "Starting print from plate 1..." shown above it for a print that isn't
        // running at all (reported 02sep26). It is now only reported once the
        // server has accepted the job — in sendPrintCommand.

        // Get ALL print options
        const getPrintOption = (className) => {
            const checkbox = document.querySelector(`.${className}[data-file="${filename}"]`);
            return checkbox ? checkbox.checked : false;
        };

        const printOptions = {
            ...collectPrintOptions(filename)
        };

        // Weight check before printing (single-filament only)
        if (window._skipSpoolCheck) { delete window._skipSpoolCheck; }
        else if (window.spoolmanEnabled && spoolId && !spoolMapping) {
            // Find the file data
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
                        showConfirmDialog({ text: message, knopf: texts.confirm_print_anyway }, function() {
                            // User confirmed — start the print anyway (skip check)
                            window._skipSpoolCheck = true;
                            // Continue straight on: the user already filled
                            // out the preparation and just confirmed it —
                            // showing the view again would only get in
                            // the way.
                            self.beginPrintFlow(filename, location);
                        }, function() {
                            self.currentPlateSelection = null;
                        });
                        return;
                    }
                }
            }
        }

        // Build the request body BEFORE the apiCall
        const requestBody = {
            command: 'print_sd',
            filename: filename,
            location: location || 'cache',
            plate: plateNumber,
            ...printOptions  // add all options
        };

        // Multi-filament: use spool mapping
        if (spoolMapping) {
            console.log('🔍 spoolMapping vorhanden:', spoolMapping);
            console.log('🔍 spoolMapping type:', typeof spoolMapping);
            console.log('🔍 spoolMapping JSON:', JSON.stringify(spoolMapping));
            requestBody.spool_mapping = spoolMapping;
        } else if (spoolId) {
            console.log('🔍 Only spool_id:', spoolId);
            // Single-filament: use a single spool ID
            requestBody.spool_id = spoolId;
        }

        await this._confirmHumidityAssignmentBeforePrint(
            requestBody.spool_id,
            requestBody.spool_mapping
        );

        console.log('🔍 FINALER requestBody:', JSON.stringify(requestBody, null, 2));

        const self = this;

        // Send print WITHOUT further confirmation
        apiCall('/api/mqtt/print', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(requestBody)
        })
        .then(response => {
            // Parse JSON and keep response for the status check
            return response.json().then(data => ({response, data}));
        })
        .then(({response, data}) => {
            console.log('continuePrintWithPlate response:', {status: response.status, data: data});

            // Single-filament mismatch (option C): backend could not
            // auto-match unambiguously -> user dialog with candidates.
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
                // Success feedback with a delay
                setTimeout(() => {
                    skToast(texts.toast_plate_printing.replace('{plate}', plateNumber), 'success');
                }, 200);

                // Scroll to the progress card after a short delay
                setTimeout(() => {
                    const progressCard = document.querySelector('.progress-card');
                    if (progressCard) {
                        progressCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 500);
            } else {
                // Show error
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
        showConfirmDialog({ text: message, knopf: texts.confirm_start }, async function() {
            await self._confirmHumidityAssignmentBeforePrint(window.activeSpoolId, null);
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

    /* Until 21aug26 this is where the homepage's print-detail dialog lived
       (initDetailModalTranslations, showOverviewTab, switchDetailTab,
       showProgressChart, showEventsTimeline, toggleTimelapseFullscreen)
       together with the _print-detail.html partial — around 550 lines that no
       one ever laid eyes on: the dialog was never opened anywhere, and the
       print history has carried its own, maintained versions of the same
       functions since its rework. */
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
