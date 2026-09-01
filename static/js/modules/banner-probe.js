/**
 * Banner-Probe — alle Banner auf einmal sichtbar machen.
 *
 * Sonst bekommt man sie nie zusammen zu sehen: Recovery braucht einen
 * Stromausfall, HMS einen Druckerfehler, Auto-Aus einen fertigen Druck.
 *
 * Aufruf in der Browser-Konsole:
 *     bannerProbe()            alle an, mit Beispieldaten
 *     bannerProbe('hms')       nur eines
 *     bannerProbe.aus()        alles wieder weg
 *     bannerProbe.liste()      welche es gibt
 *
 * Die Probe fuellt die ECHTEN Knoten aus _banners.html — sie prueft also
 * wirklich das, was im Betrieb erscheint, und nicht eine Nachbildung.
 * Der naechste Status-Push ueberschreibt die Beispielwerte; zum Ansehen
 * reicht es, und nichts bleibt haengen.
 */
(function () {
    'use strict';

    // Knoten -> Beispielwerte. Die Schluessel sind die Element-IDs aus
    // templates/partials/_banners.html.
    const PROBEN = {
        vorkonditionierung: {
            knoten: 'precondition-banner',
            texte: { 'precondition-banner-countdown': '6:12' },
        },
        trocknung: {
            knoten: 'filament-drying-banner',
            texte: {
                'filament-drying-title': 'Filamenttrocknung aktiv',
                'filament-drying-details': 'Heizbett bei 55°C • Fertig um 14:20 • Druckersteuerung blockiert',
            },
        },
        autoaus: {
            knoten: 'power-off-banner',
            texte: {
                'power-off-banner-countdown': '29:41',
                'power-off-banner-reason': 'Nach dem Druck',
            },
        },
        recovery: {
            knoten: 'recovery-banner',
            texte: { 'recovery-banner-message': 'Benchy.gcode bei 47 % — Schicht 118 bei Z 23.60 mm' },
        },
        filament: {
            knoten: 'filament-amount-banner',
            texte: {
                'filament-amount-title': 'Filament reicht vermutlich nicht',
                'filament-amount-message': 'Benötigt 240 g, vorhanden 195 g — 45 g zu wenig · Polymaker PolyLite ASA Dark Green Grey',
            },
        },
        hms: {
            knoten: 'hms-error-banner',
            texte: {
                'hms-error-title': 'Fehler 0700-2002',
                'hms-error-message': 'Der Filamentsensor meldet keinen Vorschub.',
                'hms-error-code': '0700-2002',
            },
        },
        wartung: {
            knoten: 'maintenance-banner',
            texte: {
                'maintenance-banner-title': 'Wartung heute fällig',
                'maintenance-banner-message': 'Riemenspannung prüfen · zuletzt vor 412 Druckstunden',
            },
        },
    };

    function setze(probe) {
        // Die HMS-Meldung steht nicht mehr in der Seite, sie wird gebaut,
        // sobald es etwas zu melden gibt (hms-banner.js). Fuer die Probe
        // bauen wir sie hier an.
        if (probe.knoten === 'hms-error-banner' && !document.getElementById(probe.knoten)
                && window.HmsBanner) {
            window.HmsBanner.knoten();
        }
        const el = document.getElementById(probe.knoten);
        if (!el) return false;
        Object.entries(probe.texte).forEach(([id, wert]) => {
            const ziel = document.getElementById(id);
            if (ziel) ziel.textContent = wert;
        });
        el.classList.add('active');
        return true;
    }

    function probe(name) {
        const namen = name ? [name] : Object.keys(PROBEN);
        const gezeigt = [];
        namen.forEach(n => {
            const p = PROBEN[n];
            if (!p) { console.warn(`Banner probe: "${n}" does not exist`); return; }
            if (setze(p)) gezeigt.push(n); else console.warn(`Banner probe: node missing for "${n}"`);
        });
        console.log(`🎏 Banner probe on: ${gezeigt.join(', ') || '(nothing)'}`);
        console.log('   Off again with  bannerProbe.aus()');
        return gezeigt;
    }

    probe.aus = function () {
        Object.values(PROBEN).forEach(p => {
            const el = document.getElementById(p.knoten);
            if (el) el.classList.remove('active');
        });
        console.log('🎏 Banner probe off');
    };

    probe.liste = function () {
        console.log('🎏 Banner-Probe kennt:', Object.keys(PROBEN).join(', '));
        return Object.keys(PROBEN);
    };

    window.bannerProbe = probe;
})();
