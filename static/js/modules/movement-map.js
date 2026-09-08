/**
 * The map view of the axes tab: the bed seen from above, and the machine
 * from the side.
 *
 * Clicking the bed sends the head to that point -- both coordinates at once,
 * instead of tapping four arrows. The Z slider works the same way: drag to a
 * height, release, and the bed goes there.
 *
 * WHAT THE MARK MEANS
 * Only Klipper reports where the head actually is (gcode_move.gcode_position).
 * Bambu reports no position at all -- its telegram carries 91 scalar fields
 * and not one is a coordinate. So the mark says two different things and
 * looks different for each:
 *
 *   dashed, hollow          the last command went here -- an intention
 *   solid, with centre dot  the head is here -- a measurement
 *
 * That distinction is the point. A mark that mixed "where I sent it" with
 * "where it is" would be wrong the moment someone drives the head at the
 * printer's own screen, and nothing here would ever notice.
 */
(function () {
    'use strict';

    /** Bed size in mm, or null while it is unknown. */
    let bed = null;
    /** Where the last command went, {x, y} in mm -- null after a home. */
    let targetXY = null;
    /** Where the last Z command went, in mm. */
    let targetZ = null;

    const SVG = 'http://www.w3.org/2000/svg';
    /** SVG viewBox of the bed map, and the frame inset inside it.
     *  HOEHE is taller than BOX: the bed stays square, the extra strip at the
     *  bottom carries the plate's label bar. */
    const BOX = 240, PAD = 10, SIDE = BOX - 2 * PAD, HOEHE = 256;

    const t = (key, fallback) => (window.texts && window.texts[key]) || fallback;
    const state = () => (window.printerControlManager &&
                         window.printerControlManager.lastState) || {};

    /**
     * Bed size, asked once. Both operating modes answer it under the same
     * name on /api/printer/info -- Bambu from the printer profile, Klipper
     * from toolhead.axis_maximum -- so there is nothing to branch on here.
     * Null means the map stays locked and the buttons carry on.
     */
    async function loadBed() {
        if (bed) return bed;
        try {
            const r = await fetch('/api/printer/info', { credentials: 'same-origin' });
            const info = await r.json();
            const l = info && info.bed_limits;
            if (l && l.x && l.y) {
                bed = { x: +l.x, y: +l.y, z: +(l.z || 0),
                        duesen: l.duesen_reichweite || null };
            }
        } catch (e) {
            console.debug('movement-map: bed size not readable', e);
        }
        return bed;
    }

    /** What the plate carries printed on its front edge. Read off Bambu
     *  Studio's own artwork (images/bbl_bed_<x>_bottom_n.svg, where the text
     *  is outlines, not strings). Fixed per plate: the printer reports WHICH
     *  plate lies there, never what is written on it. */
    const LEISTE = {
        1: ['PLA', 'GLUE STICK CAN HELP.'],
        2: ['Engineering Plate', 'APPLY GLUE STICK BEFORE PRINTING'],
        3: ['PLA/ABS/PETG', 'HOT SURFACE'],
        4: ['PLA/ABS/PETG', 'HOT SURFACE'],
        5: ['Cool Plate Super Tack', 'PLA/PETG'],
    };

    /** Which plate is on the bed, or '' when the printer does not say.
     *  base is the slicer BedType enum, measured on the X2D; the raw QR id is
     *  the fallback. Same table as the device tab (printer-control.js). */
    const PLATTEN = { 1: 'Cool Plate', 2: 'Engineering Plate', 3: 'Smooth PEI Plate',
                      4: 'Textured PEI Plate', 5: 'Cool Plate SuperTack' };
    function plattenName() {
        const bp = (state() || {}).build_plate || {};
        return PLATTEN[bp.base] || '';
    }

    /** Are the named axes referenced? null means the printer does not say.
     *  Klipper answers with a string, Bambu with a bitmask: bit 0 X, 1 Y, 2 Z.
     */
    function homed(achsen = 'xy') {
        const s = state();
        const wanted = achsen.toLowerCase().split('');
        if (typeof s.homed_axes === 'string') {
            const a = s.homed_axes.toLowerCase();
            return wanted.every(x => a.includes(x));
        }
        if (typeof s.home_flag === 'number') {
            const bit = { x: 0, y: 1, z: 2 };
            return wanted.every(x => (s.home_flag >> bit[x]) & 1);
        }
        return null;
    }

    /** How far X may travel — for the nozzle that is active.
     *
     *  Both nozzles sit on the same carriage at different X offsets, so
     *  they do not reach the same edge (X2D: the right one not closer than
     *  20.5 mm to the left). The map DREW that strip from the start but
     *  took a click in it all the same, and the head ran into the side.
     *
     *  1 = left, 0 = right — device.extruder.state bits 4-7, see
     *  docs/duesen-ams-spulen.md. A missing value is not a nozzle: then the
     *  strict range applies, what both reach. The server clamps the same
     *  way (bambu.py `_x_bereich`); this is the lock in front of it, so a
     *  click is refused with a reason instead of silently landing
     *  somewhere else.
     */
    function xBereich() {
        const breite = (bed && bed.x) || 0;
        const dn = bed && bed.duesen;
        if (!dn || !Array.isArray(dn.links) || !Array.isArray(dn.rechts)) {
            return { von: 0, bis: breite, duese: null };
        }
        const aktiv = state().active_nozzle;
        if (aktiv === 1) return { von: dn.links[0], bis: Math.min(dn.links[1], breite), duese: 'links' };
        if (aktiv === 0) return { von: dn.rechts[0], bis: Math.min(dn.rechts[1], breite), duese: 'rechts' };
        return { von: Math.max(dn.links[0], dn.rechts[0]),
                 bis: Math.min(dn.links[1], dn.rechts[1], breite), duese: null };
    }

    /** Where the head really is -- or null when the printer never says. */
    function livePosition() {
        const s = state();
        return (typeof s.x_position === 'number' && typeof s.y_position === 'number')
            ? { x: s.x_position, y: s.y_position }
            : null;
    }

    const el = (name, attrs) => {
        const node = document.createElementNS(SVG, name);
        for (const a in attrs) node.setAttribute(a, attrs[a]);
        return node;
    };

    /** Draw the bed: frame, a light grid, and the mark if there is one. */
    function drawBed() {
        const svg = document.getElementById('bed-map');
        if (!svg) return;
        svg.textContent = '';
        if (!bed) {
            const note = el('text', { x: BOX / 2, y: BOX / 2, 'text-anchor': 'middle',
                                      class: 'bed-empty' });
            note.textContent = t('move_no_bed_size', 'Bettmaße unbekannt');
            svg.appendChild(note);
            return;
        }

        // The plate seen from above, the way Bambu Studio draws it: dark
        // body, the handle notch at the top, a millimetre grid and the plate
        // name across it. Drawn rather than photographed -- a photo has to be
        // stretched to the bed size, and then its grid no longer lines up with
        // the coordinates it is supposed to help read.
        svg.appendChild(el('path', {
            d: `M${BOX / 2 - 22} ${PAD} q0 -7 7 -7 h30 q7 0 7 7 z`,
            class: 'bed-lasche' }));
        svg.appendChild(el('rect', { x: PAD, y: PAD, width: SIDE, height: SIDE,
                                     rx: 5, class: 'bed-platte' }));

        // 10 mm fine, 50 mm strong -- Studio's spacing. In millimetres, not in
        // quarters of the picture, so a line means the same on every bed size.
        const raster = (schritt, klasse) => {
            for (let mm = schritt; mm < bed.x; mm += schritt) {
                const x = PAD + (mm / bed.x) * SIDE;
                svg.appendChild(el('line', { x1: x, y1: PAD, x2: x, y2: PAD + SIDE,
                                             class: klasse }));
            }
            for (let mm = schritt; mm < bed.y; mm += schritt) {
                const y = PAD + SIDE - (mm / bed.y) * SIDE;
                svg.appendChild(el('line', { x1: PAD, y1: y, x2: PAD + SIDE, y2: y,
                                             class: klasse }));
            }
        };
        raster(10, 'bed-grid');
        raster(50, 'bed-grid bed-grid--stark');

        // Where only one nozzle reaches. On the X2D the right one cannot come
        // closer than 20.5 mm to the left edge; on the H2D it cuts both ways,
        // the left stopping at 325 while the right goes to 350. Both numbers
        // come from the printer profile, taken from Studio's own machine
        // profile (extruder_printable_area) -- no guessed width.
        const dn = bed.duesen;
        if (dn && Array.isArray(dn.links) && Array.isArray(dn.rechts)) {
            const streifen = (von, bis, text) => {
                if (!(bis > von)) return;
                const x = PAD + (von / bed.x) * SIDE;
                const w = ((bis - von) / bed.x) * SIDE;
                svg.appendChild(el('rect', { x, y: PAD, width: w, height: SIDE,
                                             class: 'bed-nur-eine' }));
                const zeile = el('text', { x: x + w / 2, y: PAD + SIDE / 2,
                                           'text-anchor': 'middle',
                                           class: 'bed-nur-eine-text',
                                           transform: `rotate(-90 ${x + w / 2} ${PAD + SIDE / 2})` });
                zeile.textContent = text;
                svg.appendChild(zeile);
            };
            streifen(dn.links[0], dn.rechts[0], t('move_left_nozzle_only', 'Nur linke Düse'));
            streifen(dn.links[1], dn.rechts[1], t('move_right_nozzle_only', 'Nur rechte Düse'));
        }

        svg.appendChild(el('rect', { x: PAD, y: PAD, width: SIDE, height: SIDE,
                                     rx: 5, class: 'bed-area' }));

        // Fields a game has lit. Above the grid so they read, below the mark
        // so the head stays the most important thing on the picture.
        for (const f of spielFelder) {
            svg.appendChild(el('rect', {
                x: PAD + (f.x / bed.x) * SIDE,
                y: PAD + SIDE - ((f.y + f.h) / bed.y) * SIDE,
                width: (f.w / bed.x) * SIDE,
                height: (f.h / bed.y) * SIDE,
                rx: 3,
                class: f.an ? 'bed-feld bed-feld--an' : 'bed-feld' }));
        }

        // The name of the plate the printer reports. No guess: without the
        // report nothing is written there.
        const platte = plattenName();
        if (platte) {
            const schrift = el('text', { x: BOX / 2, y: PAD + 16,
                                         'text-anchor': 'middle', class: 'bed-plattenname' });
            schrift.textContent = platte;
            svg.appendChild(schrift);
        }

        // The label bar on the plate's front edge. Below the printable area,
        // never inside it -- inside it would cover bed a click can reach.
        const bp = (state() || {}).build_plate || {};
        const beschriftung = LEISTE[bp.base];
        if (beschriftung) {
            const y = PAD + SIDE + 3, h = HOEHE - y - 1;
            svg.appendChild(el('rect', { x: PAD + 14, y, width: SIDE - 28, height: h,
                                         rx: 1.5, class: 'bed-leiste' }));
            // Each half gets its own room. "Engineering Plate" and "APPLY GLUE
            // STICK BEFORE PRINTING" ran into each other otherwise -- the bar
            // is narrow and one of the two is always long. Where a half does
            // not fit, textLength squeezes it instead of letting it collide;
            // the width is estimated from the character count, because in an
            // SVG the real width is only known after it is in the document.
            const haelfte = (SIDE - 38) / 2 - 3;
            const setz = (x, anker, text) => {
                const z = el('text', { x, y: y + h - 3.2, 'text-anchor': anker,
                                       class: 'bed-leiste-text' });
                if (text.length * 3.9 > haelfte) {
                    z.setAttribute('textLength', haelfte);
                    z.setAttribute('lengthAdjust', 'spacingAndGlyphs');
                }
                z.textContent = text;
                svg.appendChild(z);
            };
            setz(PAD + 19, 'start', beschriftung[0]);
            setz(PAD + SIDE - 19, 'end', beschriftung[1]);
        }

        const gesperrt = homed('xy') === false;
        svg.classList.toggle('bed-map--gesperrt', gesperrt);
        if (gesperrt) {
            svg.appendChild(el('rect', { x: PAD, y: PAD, width: SIDE, height: SIDE,
                                         rx: 4, class: 'bed-sperre' }));
            const zeile = el('text', { x: BOX / 2, y: BOX / 2 + 5,
                                       'text-anchor': 'middle', class: 'bed-sperre-text' });
            zeile.textContent = t('move_locked_home', 'Erst Home fahren');
            svg.appendChild(zeile);
            return;
        }

        const live = livePosition();
        const point = live || targetXY;
        if (!point) return;
        // Y grows away from the front of the machine, the SVG grows downwards.
        const px = PAD + (point.x / bed.x) * SIDE;
        const py = PAD + SIDE - (point.y / bed.y) * SIDE;
        const group = el('g', { class: live ? 'bed-mark bed-mark--live'
                                            : 'bed-mark bed-mark--target' });
        group.appendChild(el('circle', { cx: px, cy: py, r: 13 }));
        group.appendChild(el('line', { x1: px, y1: py - 12, x2: px, y2: py + 12 }));
        group.appendChild(el('line', { x1: px - 12, y1: py, x2: px + 12, y2: py }));
        if (live) group.appendChild(el('circle', { cx: px, cy: py, r: 2.5,
                                                   class: 'bed-mark-core' }));
        // The label has to stay inside the picture. Centred under the mark it
        // ran off the left edge at X 0 -- "X 1" was cut away and only "7 · Y
        // 247" was left standing. Near an edge it anchors to that edge
        // instead, and below the bed it flips above the mark.
        const rand = 3;
        const anchor = px < 44 ? 'start' : px > BOX - 44 ? 'end' : 'middle';
        const lx = anchor === 'start' ? rand
                 : anchor === 'end' ? BOX - rand
                 : px;
        const ly = py + 28 > BOX - 6 ? py - 20 : py + 28;
        const label = el('text', { x: lx, y: ly, 'text-anchor': anchor });
        label.textContent = `X ${Math.round(point.x)} · Y ${Math.round(point.y)}`;
        group.appendChild(label);
        svg.appendChild(group);
    }

    /** Draw the machine from the side: frame, nozzle, bed at its height. */
    function drawSide() {
        const svg = document.getElementById('z-side');
        if (!svg || !bed || !bed.z) return;
        zSperre();
        svg.textContent = '';
        const top = 14, bottom = 226, left = 18, right = 102;

        svg.appendChild(el('rect', { x: left, y: top, width: right - left,
                                     height: bottom - top, rx: 4, class: 'side-frame' }));
        // The nozzle sits at the top and stays put; on this machine the bed
        // is what travels in Z.
        svg.appendChild(el('path', { d: `M${(left + right) / 2 - 7} ${top + 8} h14 l-5 12 h-4 z`,
                                     class: 'side-nozzle' }));

        const s = state();
        const height = typeof s.z_position === 'number' ? s.z_position
                     : targetZ == null ? 0 : targetZ;
        const clamped = Math.max(0, Math.min(bed.z, height));
        // Z counts from the nozzle downwards: 0 puts the bed right under it,
        // the maximum drops it to the bottom of the frame.
        const y = top + 26 + (clamped / bed.z) * (bottom - top - 40);
        svg.appendChild(el('line', { x1: left + 6, y1: y, x2: right - 6, y2: y,
                                     class: 'side-bed' }));

        if (homed('z') === false) {
            const zeile = el('text', { x: (left + right) / 2, y: (top + bottom) / 2,
                                       'text-anchor': 'middle', class: 'bed-sperre-text' });
            zeile.textContent = t('move_locked_home', 'Erst Home fahren');
            svg.appendChild(zeile);
        }
    }

    /** Grey the slider out while Z is unreferenced -- a control that cannot
     *  act should not look as if it could. */
    function zSperre() {
        const slider = document.getElementById('z-slider');
        if (!slider) return;
        const gesperrt = homed('z') === false;
        slider.disabled = gesperrt;
        slider.classList.toggle('z-slider--gesperrt', gesperrt);
    }

    function draw() { drawBed(); drawSide(); }

    /** Turn a click on the bed into millimetres and send it. */
    async function bedClicked(event) {
        if (!bed) return;
        const svg = document.getElementById('bed-map');
        const box = svg.getBoundingClientRect();
        // The SVG scales with the panel, so go through the viewBox rather
        // than whatever pixel size it happens to have right now.
        const vx = ((event.clientX - box.left) / box.width) * BOX;
        const vy = ((event.clientY - box.top) / box.height) * HOEHE;
        const x = ((vx - PAD) / SIDE) * bed.x;
        const y = (1 - (vy - PAD) / SIDE) * bed.y;
        if (x < 0 || y < 0 || x > bed.x || y > bed.y) return;

        // A running game owns the clicks -- otherwise a tap would drive the
        // head freely in the middle of a round.
        if (window.bedSimon && window.bedSimon.nimmtKlicks()) {
            window.bedSimon.tipp(x, y);
            return;
        }

        // Unreferenced axes: the click goes nowhere. Without a reference the
        // printer counts from wherever it happens to stand, so a target in
        // millimetres means nothing and the head runs into the frame. The map
        // says so itself (drawBed), this is the second lock behind it.
        const bereit = homed('xy');
        if (bereit === false) return;
        if (bereit === null) {
            // Neither homed_axes nor home_flag -- the printer does not say.
            // Ask instead of refusing: refusing would lock out every machine
            // that simply keeps quiet about it.
            const go = window.skConfirm
                ? await window.skConfirm(t('move_home_first',
                    'Achsen nicht referenziert. Erst Home fahren?'))
                : true;
            if (!go) return;
        }
        const bereich = xBereich();
        if (x < bereich.von || x > bereich.bis) {
            const text = bereich.duese === 'rechts'
                ? t('move_out_of_reach_right', 'Dort kommt die rechte Düse nicht hin')
                : bereich.duese === 'links'
                    ? t('move_out_of_reach_left', 'Dort kommt die linke Düse nicht hin')
                    : t('move_out_of_reach', 'Dort kommt die aktive Düse nicht hin');
            if (window.skToast) window.skToast(text, 'warning');
            return;
        }
        await send({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    }

    /** One way to the printer, for both the map and the slider. */
    async function send(target) {
        const answer = await window.printerAdapter.moveTo(target);
        if (!answer.ok) {
            const why = answer.error === 'unknown_printer_model'
                ? t('move_no_profile', 'Kein Drucker-Modell gesetzt.')
                : answer.error === 'unknown_bed_size'
                    ? t('move_no_bed_size', 'Bettmaße unbekannt.')
                    : answer.error || '';
            if (window.skToast) window.skToast(why, 'warning');
            return;
        }
        // Take the clamped values back from the server: it decides what is
        // reachable, and the mark has to show what actually went out.
        const r = (answer.data && answer.data.result) || target;
        if (r.x != null && r.y != null) targetXY = { x: r.x, y: r.y };
        if (r.z != null) targetZ = r.z;
        draw();
    }

    // -- Entry points called from the markup -----------------------------

    window.setMovementView = async function (view) {
        document.querySelectorAll('.jog-switch-btn').forEach(b => {
            b.classList.toggle('jog-switch-btn--on', b.dataset.view === view);
        });
        const map = document.getElementById('jog-layout-map');
        const buttons = document.getElementById('jog-layout-buttons');
        if (map) map.style.display = view === 'map' ? '' : 'none';
        if (buttons) buttons.style.display = view === 'map' ? 'none' : '';
        if (view !== 'map') return;

        await loadBed();
        const slider = document.getElementById('z-slider');
        if (slider && bed && bed.z) {
            slider.max = bed.z;
            const s = state();
            if (typeof s.z_position === 'number') slider.value = s.z_position;
        }
        draw();
    };

    window.zSliderMoved = function (value) {
        // While dragging only the drawing follows -- the printer hears about
        // it on release. Sending on every pixel would fill the queue with
        // targets that are stale before they arrive.
        targetZ = parseFloat(value);
        const readout = document.getElementById('z-slider-value');
        if (readout) readout.textContent = `${targetZ.toFixed(1)} mm`;
        drawSide();
    };

    window.zSliderReleased = async function (value) {
        // Z has its own reference bit; the X/Y question would be the wrong one
        // here. The slider is disabled while it is unset (zSperre), this is
        // the lock behind that.
        const bereit = homed('z');
        if (bereit === false) return;
        if (bereit === null) {
            const go = window.skConfirm
                ? await window.skConfirm(t('move_home_first',
                    'Achsen nicht referenziert. Erst Home fahren?'))
                : true;
            if (!go) return;
        }
        send({ z: Math.round(parseFloat(value) * 10) / 10 });
    };

    /** After a home the mark is wrong -- the head is demonstrably elsewhere. */
    window.clearMovementMark = function () {
        targetXY = null;
        targetZ = null;
        draw();
    };

    let letzterStand = null;
    /** Fields a game wants lit, as {x, y, w, h} in millimetres. */
    let spielFelder = [];

    /** Redraw when the live state moved. Called by printer-control.js right
     *  after it writes `lastState` -- both modes, one place.
     *
     *  Hanging this off the socket does not work: the only event that carries
     *  it in Klipper mode is `printer_state`, and the Bambu server never emits
     *  that one (it pushes `print_progress`). The lock therefore stayed on
     *  screen after a home until the view was switched by hand. Whoever writes
     *  the state says so, and the order is guaranteed. */
    window.refreshMovementMap = function () {
        const map = document.getElementById('jog-layout-map');
        if (!map || map.style.display === 'none') return;
        // A live position moves the mark; the homing state lifts the lock.
        const stand = `${homed('xy')}|${homed('z')}`;
        if (livePosition() || stand !== letzterStand) {
            letzterStand = stand;
            draw();
        }
    };

    /** What a game on the bed needs, and nothing more. Everything goes
     *  through the same paths a click takes -- the same guard, the same
     *  server-side clamp to the build volume. */
    window.bedMap = {
        /** Bed size in mm, or null while it is unknown. */
        masse: () => (bed ? { x: bed.x, y: bed.y } : null),
        /** May the head move at all right now? */
        bereit: () => Boolean(bed) && homed('xy') === true,
        /** Drive there. Same call as a click on the map. */
        fahre: (ziel) => send(ziel),
        /** Light fields, [] clears them. */
        felder: (liste) => { spielFelder = liste || []; draw(); },
    };

    document.addEventListener('DOMContentLoaded', () => {
        const svg = document.getElementById('bed-map');
        if (svg) svg.addEventListener('click', bedClicked);
    });
})();
