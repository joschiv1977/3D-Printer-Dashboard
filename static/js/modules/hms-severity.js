/**
 * An HMS notice or a real error?
 *
 * The printer encodes the severity in the code itself -- so no maintained list
 * is needed for it. Every front end (web, Android, iOS, the server) used to
 * have its own enumeration with two codes in the short format "0300-8013",
 * which never matched the 16-digit codes from hms_list: an open front door came
 * through as a red "printer error" with a vibration.
 *
 * Mirrors mixins/progress/constants.py (hms_stufe_aus_code / hms_ist_hinweis).
 * If the rule changes there, it wants changing here too.
 */
(function (global) {
    'use strict';

    // The short print_error codes without a severity field -- only those still
    // need a maintained enumeration.
    const INFO_HMS_CODES = ['0300-8013', '0300-8004'];

    /**
     * The severity digit out of the code (0 = cannot be determined).
     *
     *     0300940000030001
     *     ^^^^^^^^          attr (module and part)
     *             ^^^^      1 fatal, 2 serious, 3 normal, 4 notice
     *                 ^^^^  the running number
     */
    function hmsStufeAusCode(code) {
        const text = String(code || '').replace(/[-_]/g, '').trim();
        if (text.length !== 16) return 0;
        const stufe = parseInt(text.slice(8, 12), 16);
        return Number.isNaN(stufe) ? 0 : stufe;
    }

    /**
     * A notice (the blue window on the printer) rather than an error?
     *
     * Levels 3 ("normal") and 4 ("notice") are messages that do not endanger
     * the print: an open door, a chamber cooling slowly, the bed above its
     * target temperature.
     *
     * @param {Object|string} fehler the error object from the server (carrying
     *                               is_info), or a bare code.
     */
    function hmsIstHinweis(fehler) {
        if (fehler && typeof fehler === 'object') {
            // The server sends its classification along -- that wins.
            if (typeof fehler.is_info === 'boolean') return fehler.is_info;
            return hmsIstHinweis(fehler.code);
        }
        const code = String(fehler || '');
        return hmsStufeAusCode(code) >= 3 || INFO_HMS_CODES.includes(code);
    }

    global.hmsStufeAusCode = hmsStufeAusCode;
    global.hmsIstHinweis = hmsIstHinweis;
})(window);
