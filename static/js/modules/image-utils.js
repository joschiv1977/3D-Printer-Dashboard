// Notnagel fuer skIcon (icons.js): Seiten, die nur einen Teil der Module
// laden — und ein Buendel, das nach einer neuen Moduldatei noch nicht neu
// gebaut wurde — sollen kein Symbol bekommen, aber auch nicht abstuerzen.
window.skIcon = window.skIcon || function () { return ''; };

/**
 * Bildtyp aus Base64-Daten bestimmen.
 *
 * Thumbnails kommen aus zwei Quellen: freigestellte Slicer-Vorschauen (PNG,
 * mit Transparenz) und Kamera-Schnappschuesse (JPEG). Vorher stand der Typ
 * an jeder Anzeigestelle fest verdrahtet — und damit an einer davon falsch.
 */
(function (global) {
    'use strict';

    // Signaturen am Anfang der Base64-Zeichenkette: PNG beginnt mit \x89PNG,
    // JPEG mit \xFF\xD8\xFF, GIF mit "GIF8".
    const SIGNATURES = [
        ['iVBORw0KGgo', 'image/png'],
        ['/9j/', 'image/jpeg'],
        ['R0lGOD', 'image/gif'],
    ];

    function imageMimeFromBase64(b64) {
        if (!b64) return 'image/png';
        for (const [prefix, mime] of SIGNATURES) {
            if (b64.startsWith(prefix)) return mime;
        }
        return 'image/png';
    }

    function imageDataUrl(b64) {
        return b64 ? `data:${imageMimeFromBase64(b64)};base64,${b64}` : '';
    }

    global.imageMimeFromBase64 = imageMimeFromBase64;
    global.imageDataUrl = imageDataUrl;
})(window);
