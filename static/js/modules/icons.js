/* ==========================================================================
   Strichsymbole  (21aug26)
   --------------------------------------------------------------------------
   Knöpfe, die ihr Aussehen zur Laufzeit neu schreiben (Licht, MQTT, Strom,
   Verlauf, Kamera), trugen bis heute Emoji im Quelltext — je nach Schrift
   und Betriebssystem mal bunt, mal flach, und nie passend zu den SVGs im
   Markup. Hier steht der Satz einmal; wer Markup baut, holt ihn über
   skIcon('name').

   Alle Pfade liegen im 24er-Raster und zeichnen mit currentColor, damit sie
   die Farbe ihres Knopfes annehmen (siehe .hd-ic in components.css).
   ========================================================================== */
(function () {
    'use strict';

    const PFADE = {
        licht:    '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2z"/>',
        strom:    '<path d="M12 2v9"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
        funk:     '<circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>',
        balken:   '<path d="M6 20v-4M12 20V10M18 20V4"/>',
        zahnrad:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        warnung:  '<path d="M12 9v5M12 17.5v.5"/><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',
        start:    '<path d="M6 4l12 8-12 8z"/>',
        pause:    '<path d="M9 5v14M15 5v14"/>',
        stopp:    '<rect x="6" y="6" width="12" height="12" rx="1"/>',
        tropfen:  '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4.5 4.5 0 1 0 4 0z"/>',
        // ACHTUNG: 'tropfen' oben ist in Wahrheit ein THERMOMETER (Kolben
        // und Saeule) — der Name taeuscht. Das hier ist der echte Tropfen,
        // fuer die Luftfeuchte im AMS.
        wasser:   '<path d="M12 3s6 6.4 6 10.4a6 6 0 0 1-12 0C6 9.4 12 3 12 3z"/>',
        // Die beiden Plaketten am Geraet: Kammer und Heizbett. Sie lagen
        // bisher nur als data-URI im Template (_progress.html) und fehlten
        // damit Android und iOS. Aus dem 16er-Raster auf 24 gerechnet.
        kammer:   '<rect x="2.25" y="2.25" width="18.258" height="19.687" rx="0.819"/><rect x="5.656" y="6.349" width="11.445" height="3.284" rx="0.819"/><rect x="5.656" y="14.552" width="7.357" height="3.284" rx="0.819"/>',
        heizbett: '<path d="M7.118 3C7.118 4.209 4.676 4.209 4.676 5.415C4.676 6.623 7.118 6.623 7.118 7.832C7.118 9.04 4.676 9.04 4.676 10.249C4.676 11.457 7.118 11.457 7.118 12.666C7.118 13.874 4.676 13.874 4.676 15.083"/><path d="M13.681 3C13.681 4.209 11.238 4.209 11.238 5.415C11.238 6.623 13.681 6.623 13.681 7.832C13.681 9.04 11.238 9.04 11.238 10.249C11.238 11.457 13.681 11.457 13.681 12.666C13.681 13.874 11.238 13.874 11.238 15.083"/><path d="M20.245 3C20.245 4.209 17.803 4.209 17.803 5.415C17.803 6.623 20.245 6.623 20.245 7.832C20.245 9.04 17.803 9.04 17.803 10.249C17.803 11.457 20.245 11.457 20.245 12.666C20.245 13.874 17.803 13.874 17.803 15.083"/><rect x="3.75" y="18.158" width="17.794" height="2.822" rx="1.411"/>',
        haus:     '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/>',
        platte:   '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
        sanduhr:  '<path d="M6 2h12M6 22h12"/><path d="M8 2v4.5L12 11l4-4.5V2M8 22v-4.5L12 13l4 4.5V22"/>',
        wuerfel:  '<path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5z"/><path d="m3 8.5 9 5 9-5M12 13.5V21"/>',
        lupe:     '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        thermo:   '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4.5 4.5 0 1 0 4 0z"/><path d="M12 9v6"/>',
        kamera:   '<path d="m23 7-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
        weiter:   '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
        schnee:   '<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5"/>',
        hoch:     '<path d="M12 19V5M5 12l7-7 7 7"/>',
        runter:   '<path d="M12 5v14M19 12l-7 7-7-7"/>',
        // Die drei kommen aus der Historie: Suchfeld leeren, Duplikate
        // ausblenden, Filterblatt oeffnen. Standen dort inline im HTML —
        // benannt braucht sie auch iOS und Android.
        kreuz:    '<path d="M18 6 6 18M6 6l12 12"/>',
        duplikate:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        trichter: '<path d="M3 4h18l-7 8.5V20l-4-2v-5.5z"/>',
        // Blaetterpfeile der Historie (.hv-blaettern) — spitze Winkel, kein
        // Abspiel-Dreieck.
        chevronLinks:  '<path d="M15 18l-6-6 6-6"/>',
        chevronRechts: '<path d="M9 18l6-6-6-6"/>',
        // Zeitraffer-Bedienung: Vollbild und Sichern.
        vollbild: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        sichern:  '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
        regler:   '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
        // Diese elf standen nur in SkIkonPfade.swift und fehlten in dieser
        // Quelle — ein Lauf des Generators haette sie geloescht (und hat es
        // am 25aug26 auch getan). Sie gehoeren hierher, damit Web, Android
        // und iOS dieselben Symbole haben.
        protokoll: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
        benutzer: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
        schild: '<path d="M12 3l7 3v6c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V6z"/>',
        schloss: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
        globus: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15 0 18M12 3c-2.5 2.7-2.5 15 0 18"/>',
        abmelden: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
        geraete: '<rect x="2" y="4" width="14" height="10" rx="2"/><path d="M2 18h20"/><rect x="17" y="8" width="5" height="9" rx="1"/>',
        bildschirm: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
        laptop: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
        handy: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
        tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>',
        karte:    '<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z"/><path d="M9 4v13M15 6.5v13"/>',
        notaus:   '<circle cx="12" cy="12" r="9"/><path d="M9 9h6v6H9z"/>',
        auge:     '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
        ziel:     '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
        palette:  '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.6 1.5-1.3 0-.4-.2-.7-.4-1-.3-.3-.4-.6-.4-1 0-.7.6-1.2 1.3-1.2H16a5 5 0 0 0 5-5c0-4.1-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="8.5" r="1"/>',
        lineal:   '<rect x="2" y="8" width="20" height="8" rx="1"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>',
        welle:    '<path d="M2 8c2.5-3 5-3 7.5 0S15 11 17.5 8 22 5 22 5"/><path d="M2 15c2.5-3 5-3 7.5 0s5.5 3 8-.5"/>',
        puls:     '<path d="M3 12h3l2-6 4 12 2.5-7 1.5 3h5"/>',
        aktualisieren: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
        haken:    '<path d="m5 13 4 4L19 7"/>',
        mond:     '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
        sonne:    '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
        halbmond: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
        hitze:    '<path d="M8 3c3 3-3 5 0 8M13 3c3 3-3 5 0 8"/><path d="M5 14h14l-2 7H7z"/>',
        auto:     '<circle cx="12" cy="12" r="9"/><path d="M9.5 15 12 8l2.5 7M10.3 13h3.4"/>',
        kalender: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        postfach: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5.5 5.5 4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5l-1.5-7.5A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.9 1.5z"/>',
        ordner:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        uhr:      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        waage:    '<path d="M12 4v16M7 20h10"/><path d="M5 9h14l-2 5H7z"/><circle cx="12" cy="4" r="1.5"/>',
        bett:     '<path d="M2 17h20M4 17V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8M4 17v3M20 17v3"/>',
        winkel:   '<path d="M4 4v16h16"/><path d="M4 12h8v8"/>',
        // --- Nachgetragen 24aug26 ------------------------------------------
        // Diese zehn standen bisher als Inline-SVG im Markup bzw. als IC_*-
        // Konstanten in sd-card-manager.js, und Android hatte sie von Hand in
        // SkIkon.kt kopiert. Damit gab es drei Wahrheiten. Jetzt stehen sie
        // hier — icons.js ist die einzige Quelle, aus der Android und iOS
        // erzeugt werden (tools/gen_skikon_swift.py).
        zeit:      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        gewicht:   '<path d="M12 3v10M7 21h10M6 13h12l-2 8H8z"/>',
        drucker:   '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
        papierkorb:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
        plus:      '<path d="M12 5v14M5 12h14"/>',
        stift:     '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
        spule:     '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
        druckbett: '<rect x="1" y="7" width="18" height="11" rx="2"/><path d="M3 12h18"/>',
        kalenderPlan: '<rect x="1" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        sonneOptionen: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
        // --- Kartenkoepfe der Statistik (25aug26) ---------------------------
        // Eigene Zeichnungen, weil die gleichnamigen Symbole oben anders
        // aussehen (ziel/balken/thermo/regler) oder fehlten. Standen bis
        // heute nur inline in analytics-dashboard.js — iOS konnte sie damit
        // nicht zeichnen und nahm SF-Symbole, die anders aussahen.
        statZiel:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
        statBalken:  '<path d="M4 20h16M7 16V8M12 16V4M17 16v-6"/>',
        statVerlauf: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
        statKiste:   '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
        statMuell:   '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
        statPokal:   '<path d="M8 3h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M10 21h4M12 12v9"/>',
        statThermo:  '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4.5 4.5 0 1 0 4 0z"/>',
        statRegler:  '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
        // --- Wartungen (25aug26) -------------------------------------------
        // Standen nur inline in static/maintenance.html — iOS zeichnete
        // dort leere Kacheln, weil es die Pfade nicht kannte.
        wartung_duese: '<path d="M8 3h8v6l-2 3v9h-4v-9L8 9z"/>',
        wartung_platte: '<rect x="3" y="7" width="18" height="11" rx="2"/><path d="M3 12h18"/>',
        wartung_riemen: '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M7 9h10M7 15h10"/>',
        wartung_schmier: '<path d="M12 3v6M8 9h8l2 5a6 6 0 1 1-12 0z"/>',
        wartung_kamera: '<path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
        wartung_rost: '<path d="M12 3l8 4v6c0 4.5-3.4 7.6-8 8-4.6-.4-8-3.5-8-8V7z"/>',
        wartung_dichtung: '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
        wartung_klinge: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 8l12 10M8 16L20 6"/>',
        wartung_achse: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
        wartung_schlauch: '<path d="M5 6h6a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h10"/>',
        wartung_luefter: '<circle cx="12" cy="12" r="2.5"/><path d="M12 9.5V4a4 4 0 0 1 3.5 6M14.5 12H20a4 4 0 0 1-6 3.5M9.5 12H4a4 4 0 0 1 6-3.5"/>',
        wartung_kalibrierung: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
        wartung_filter: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
        wartung_reinigung: '<path d="M5 21h14l-1-8H6z"/><path d="M9 13V6a3 3 0 0 1 6 0v7"/>',
        wartung_schrauber: '<path d="M14.7 6.3a4.5 4.5 0 0 0 6 6l-8.4 8.4a2.1 2.1 0 0 1-3 0l-3-3a2.1 2.1 0 0 1 0-3z"/><path d="M14.7 6.3 18 3"/>',
    };

    /** Nur die Pfad-Bruchstuecke — fuer Aufrufer mit eigener SVG-Huelle. */
    window.skIconPfad = function (name) { return PFADE[name] || ''; };

    /** SVG-Text für ein Symbol. `zusatz` hängt weitere Klassen an (z.B. 'hd-ic--xs'). */
    window.skIcon = function (name, zusatz) {
        const p = PFADE[name];
        if (!p) return '';
        const klasse = 'hd-ic' + (zusatz ? ' ' + zusatz : '');
        return '<svg class="' + klasse + '" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
    };
})();
