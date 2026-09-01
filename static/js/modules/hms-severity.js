/**
 * HMS-Hinweis oder echter Fehler?
 *
 * Der Drucker kodiert den Schweregrad in den Code selbst — deshalb braucht
 * es dafuer keine gepflegte Liste. Vorher hatte jede Oberflaeche (Web,
 * Android, iOS, Server) ihre eigene Aufzaehlung mit zwei Codes im kurzen
 * Format "0300-8013", die auf die 16-stelligen Codes aus hms_list nie
 * passte: eine offene Vordertuer kam damit als roter "⚠️ Druckerfehler"
 * mit Vibration durch.
 *
 * Spiegelt mixins/progress/constants.py (hms_stufe_aus_code /
 * hms_ist_hinweis). Aendert sich die Regel dort, gehoert sie hier mit
 * angepasst.
 */
(function (global) {
    'use strict';

    // Kurze print_error-Codes ohne Schweregrad-Feld — nur die brauchen
    // noch eine gepflegte Aufzaehlung.
    const INFO_HMS_CODES = ['0300-8013', '0300-8004'];

    /**
     * Schweregrad-Ziffer aus dem Code (0 = nicht ermittelbar).
     *
     *     0300940000030001
     *     ^^^^^^^^          attr (Modul + Bauteil)
     *             ^^^^      1 fatal, 2 ernst, 3 normal, 4 Hinweis
     *                 ^^^^  laufende Nummer
     */
    function hmsStufeAusCode(code) {
        const text = String(code || '').replace(/[-_]/g, '').trim();
        if (text.length !== 16) return 0;
        const stufe = parseInt(text.slice(8, 12), 16);
        return Number.isNaN(stufe) ? 0 : stufe;
    }

    /**
     * Hinweis (blaues Fenster am Drucker) statt Fehler?
     *
     * Stufe 3 ("normal") und 4 ("Hinweis") sind Meldungen, die den Druck
     * nicht gefaehrden: offene Tuer, langsam kuehlende Kammer, Bett ueber
     * Solltemperatur.
     *
     * @param {Object|string} fehler Fehlerobjekt vom Server (mit is_info)
     *                               oder blosser Code.
     */
    function hmsIstHinweis(fehler) {
        if (fehler && typeof fehler === 'object') {
            // Der Server schickt die Einstufung mit — die gewinnt.
            if (typeof fehler.is_info === 'boolean') return fehler.is_info;
            return hmsIstHinweis(fehler.code);
        }
        const code = String(fehler || '');
        return hmsStufeAusCode(code) >= 3 || INFO_HMS_CODES.includes(code);
    }

    global.hmsStufeAusCode = hmsStufeAusCode;
    global.hmsIstHinweis = hmsIstHinweis;
})(window);
