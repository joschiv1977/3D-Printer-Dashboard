/**
 * The banner sample -- make every banner visible at once.
 *
 * Otherwise they are never seen together: recovery needs a power cut, HMS needs
 * a printer error, auto-off needs a finished print.
 *
 * Called from the browser console:
 *     bannerProbe()            all of them on, with sample data
 *     bannerProbe('hms')       only one
 *     bannerProbe.aus()        everything off again
 *     bannerProbe.liste()      which ones exist
 *
 * The sample fills the REAL nodes from _banners.html -- so it really checks what
 * appears in operation, not a reproduction of it. The next status push
 * overwrites the sample values; that is enough for a look, and nothing gets
 * stuck.
 */
(function () {
    'use strict';

    // Node -> sample values. The keys are the element ids from
    // templates/partials/_banners.html.
    const SAMPLES = {
        preconditioning: {
            node: 'precondition-banner',
            texts: { 'precondition-banner-countdown': '6:12' },
        },
        drying: {
            node: 'filament-drying-banner',
            texts: {
                'filament-drying-title': 'Filamenttrocknung aktiv',
                'filament-drying-details': 'Heizbett bei 55°C • Fertig um 14:20 • Druckersteuerung blockiert',
            },
        },
        autoaus: {
            node: 'power-off-banner',
            texts: {
                'power-off-banner-countdown': '29:41',
                'power-off-banner-reason': 'Nach dem Druck',
            },
        },
        recovery: {
            node: 'recovery-banner',
            texts: { 'recovery-banner-message': 'Benchy.gcode bei 47 % — Schicht 118 bei Z 23.60 mm' },
        },
        filament: {
            node: 'filament-amount-banner',
            texts: {
                'filament-amount-title': 'Filament reicht vermutlich nicht',
                'filament-amount-message': 'Benötigt 240 g, vorhanden 195 g — 45 g zu wenig · Polymaker PolyLite ASA Dark Green Grey',
            },
        },
        hms: {
            node: 'hms-error-banner',
            texts: {
                'hms-error-title': 'Fehler 0700-2002',
                'hms-error-message': 'Der Filamentsensor meldet keinen Vorschub.',
                'hms-error-code': '0700-2002',
            },
        },
        wartung: {
            node: 'maintenance-banner',
            texts: {
                'maintenance-banner-title': 'Wartung heute fällig',
                'maintenance-banner-message': 'Riemenspannung prüfen · zuletzt vor 412 Druckstunden',
            },
        },
    };

    function setze(sample) {
        // The HMS message no longer stands in the page; it is built as soon as
        // there is something to report (hms-banner.js). For the sample it is
        // built here.
        if (sample.node === 'hms-error-banner' && !document.getElementById(sample.node)
                && window.HmsBanner) {
            window.HmsBanner.node();
        }
        const el = document.getElementById(sample.node);
        if (!el) return false;
        Object.entries(sample.texts).forEach(([id, wert]) => {
            const ziel = document.getElementById(id);
            if (ziel) ziel.textContent = wert;
        });
        el.classList.add('active');
        return true;
    }

    function sample(name) {
        const namen = name ? [name] : Object.keys(SAMPLES);
        const gezeigt = [];
        namen.forEach(n => {
            const p = SAMPLES[n];
            if (!p) { console.warn(`Banner sample: "${n}" does not exist`); return; }
            if (setze(p)) gezeigt.push(n); else console.warn(`Banner sample: node missing for "${n}"`);
        });
        console.log(`🎏 Banner sample on: ${gezeigt.join(', ') || '(nothing)'}`);
        console.log('   Off again with  bannerProbe.aus()');
        return gezeigt;
    }

    sample.aus = function () {
        Object.values(SAMPLES).forEach(p => {
            const el = document.getElementById(p.node);
            if (el) el.classList.remove('active');
        });
        console.log('🎏 Banner sample off');
    };

    sample.liste = function () {
        console.log('🎏 Banner-Sample kennt:', Object.keys(SAMPLES).join(', '));
        return Object.keys(SAMPLES);
    };

    window.bannerTest = sample;
})();
