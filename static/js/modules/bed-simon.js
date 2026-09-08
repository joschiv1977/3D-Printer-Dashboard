/**
 * Simon Says on the print bed.
 *
 * The printer plays a sequence of fields, the head really drives to each one,
 * and you tap them back on the map. One field longer every round.
 *
 * Why this game and not a shooter: the head is mechanics. At F6000 it crosses
 * a 256 mm bed in about 2.6 seconds, so anything that wants reflexes would
 * either be unplayable or would whip the belts. And the Bambu firmware reports
 * no position at all -- we only ever know where the head was SENT -- so a game
 * that needs to know where it IS could not tell the truth. Simon Says needs
 * neither: few deliberate moves, no hit detection.
 *
 * It moves the machine through exactly the same path a click on the map takes:
 * window.bedMap.fahre -> printerAdapter.moveTo -> the server, which clamps
 * to the build volume and refuses while a print runs. No second door.
 */
(function () {
    'use strict';

    const t = (key, fallback) => (window.texts && window.texts[key]) || fallback;

    /** 3x3 -- nine fields are enough to get hard, and each one stays big
     *  enough to hit on a phone. */
    const N = 3;
    /** Measured, not guessed: the moves go out as G0 F6000. */
    const MM_PRO_S = 100;
    /** On top of the travel time, so a field is seen and not just passed. */
    const RUHE_MS = 420;

    let folge = [];
    let dran = 0;          // how far the player has got this round
    let laeuft = false;    // a game is running at all
    let eingabe = false;   // the player's turn

    /** Field i as a rectangle in millimetres. A margin all round keeps the
     *  head off the very edge of the bed. */
    function feld(i) {
        const b = window.bedMap.masse();
        const rand = 12;
        const w = (b.x - 2 * rand) / N;
        const h = (b.y - 2 * rand) / N;
        return { x: rand + (i % N) * w, y: rand + Math.floor(i / N) * h, w, h };
    }

    function mitte(i) {
        const f = feld(i);
        return { x: Math.round((f.x + f.w / 2) * 10) / 10,
                 y: Math.round((f.y + f.h / 2) * 10) / 10 };
    }

    /** Which field a point in millimetres falls into, or -1 beside them. */
    function feldBei(x, y) {
        for (let i = 0; i < N * N; i++) {
            const f = feld(i);
            if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return i;
        }
        return -1;
    }

    function zeichne(anI) {
        const liste = [];
        for (let i = 0; i < N * N; i++) liste.push({ ...feld(i), an: i === anI });
        window.bedMap.felder(liste);
    }

    function melde(text) {
        const el = document.getElementById('move-bed-clear');
        if (el) el.textContent = text;
    }

    /** Put the panel's own note back -- the game borrowed that line, it does
     *  not own it, and a finished game must not leave "Vorbei" standing under
     *  a map that works perfectly well. */
    function meldungZurueck() {
        melde(t('move_bed_clear', 'Bett frei? Der Kopf fährt sofort los.'));
    }

    const warte = (ms) => new Promise(r => setTimeout(r, ms));

    /** How long the head needs from `von` to `nach`, plus a moment to settle.
     *  There is no arrival message from the printer, so this is reckoned, and
     *  reckoned generously -- a field shown too early is a wrong answer the
     *  player never made. */
    function fahrzeit(von, nach) {
        const d = von ? Math.hypot(nach.x - von.x, nach.y - von.y)
                      : Math.hypot(nach.x, nach.y);
        return Math.min(4200, (d / MM_PRO_S) * 1000 + RUHE_MS);
    }

    async function vorspielen() {
        eingabe = false;
        melde(t('simon_watch', 'Zusehen …'));
        let vorher = null;
        for (const i of folge) {
            if (!laeuft) return;
            const ziel = mitte(i);
            zeichne(i);
            window.bedMap.fahre(ziel);
            await warte(fahrzeit(vorher, ziel));
            vorher = ziel;
            zeichne(-1);
            await warte(160);
        }
        if (!laeuft) return;
        dran = 0;
        eingabe = true;
        melde(t('simon_your_turn', 'Du bist dran') + ' · ' + folge.length);
    }

    async function naechsteRunde() {
        folge.push(Math.floor(Math.random() * N * N));
        await warte(500);
        await vorspielen();
    }

    function ende(gewonnen) {
        laeuft = false;
        eingabe = false;
        window.bedMap.felder([]);
        melde(gewonnen ? t('simon_done', 'Geschafft!')
                       : t('simon_over', 'Vorbei') + ' · ' + (folge.length - 1));
        folge = [];
        setTimeout(meldungZurueck, 4000);
    }

    window.bedSimon = {
        /** True while the game wants the clicks on the map. */
        nimmtKlicks: () => laeuft && eingabe,

        /** Start, if the machine is in a state to be driven at all. */
        start() {
            if (laeuft) return;
            if (!window.bedMap || !window.bedMap.bereit()) {
                if (window.skToast) window.skToast(t('move_locked_home', 'Erst Home fahren'), 'warning');
                return;
            }
            folge = [];
            laeuft = true;
            if (window.skToast) window.skToast(t('simon_start', 'Simon sagt …'), 'info');
            naechsteRunde();
        },

        stop() { if (laeuft) ende(false); },

        /** A tap during the player's turn. */
        async tipp(x, y) {
            if (!eingabe) return;
            const i = feldBei(x, y);
            if (i < 0) return;
            zeichne(i);
            setTimeout(() => { if (eingabe) zeichne(-1); }, 220);

            if (i !== folge[dran]) { ende(false); return; }
            dran += 1;
            if (dran < folge.length) return;

            eingabe = false;
            melde(t('simon_right', 'Richtig!'));
            await warte(600);
            if (laeuft) naechsteRunde();
        },
    };

    // The way in: seven taps on the heading of the map panel. No new control
    // anywhere -- an easter egg that advertises itself is a button.
    document.addEventListener('DOMContentLoaded', () => {
        const titel = document.getElementById('control-xy-movement-map');
        if (!titel) return;
        let zaehler = 0, letzter = 0;
        titel.addEventListener('click', () => {
            const jetzt = Date.now();
            zaehler = (jetzt - letzter < 900) ? zaehler + 1 : 1;
            letzter = jetzt;
            if (zaehler >= 7) { zaehler = 0; window.bedSimon.start(); }
        });
    });
})();
