/**
 * What a print file is called — the same answer as on the server, on Android
 * and on iOS.
 *
 * `window.cleanPrintName` was CALLED in six places and defined in none. Every
 * one of them read
 *
 *     window.cleanPrintName ? window.cleanPrintName(x) : x
 *
 * so the fallback always won and the web showed the full name with its
 * suffix — while Android showed it cut and iOS cut it wrongly
 * (`replacingOccurrences(of: ".3mf")` also hits the middle of a name). Three
 * clients, three names for one file.
 */
(function () {
    'use strict';

    // Longest first: `.gcode.3mf` has to be tested before `.3mf`, or the
    // shorter one wins and eats half of it.
    const SUFFIXES = ['.gcode.3mf', '.gcode', '.gco', '.3mf', '.g'];

    /** The name without its print suffix — for SHOWING, never for sending. */
    function cleanPrintName(name) {
        const n = (name || '').trim();
        if (!n) return '';
        const lower = n.toLowerCase();
        for (const suffix of SUFFIXES) {
            if (lower.endsWith(suffix)) return n.slice(0, -suffix.length);
        }
        return n;
    }

    /** Is this a print file at all? */
    function isPrintFile(name) {
        const n = (name || '').trim().toLowerCase();
        return !!n && SUFFIXES.some(s => n.endsWith(s));
    }

    window.cleanPrintName = cleanPrintName;
    window.isPrintFile = isPrintFile;
    window.PRINT_SUFFIXES = SUFFIXES.slice();
})();
