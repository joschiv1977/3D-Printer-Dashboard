/**
 * A notice or a real error?
 *
 * The server says so. It classifies every message it sends -- the severity
 * sits in the HMS code itself (1 fatal, 2 serious, 3 normal, 4 notice), and
 * the short print_error codes without that field are covered by one list in
 * mixins/progress/constants.py.
 *
 * Until 17sep26 this file decoded the code itself whenever the server sent no
 * classification, and Android and iOS each carried the same copy. That was
 * needed because two server paths sent nothing (the print_error entry and the
 * command channel); since they do, the copies are gone. Nothing known about a
 * message means it is treated as an error -- which is the safe way round.
 */
(function (global) {
    'use strict';

    /**
     * @param {Object|string} fehler the message from the server; a bare code
     *                               carries no classification and counts as
     *                               an error.
     */
    function hmsIstHinweis(fehler) {
        return !!(fehler && typeof fehler === 'object' && fehler.is_info === true);
    }

    global.hmsIstHinweis = hmsIstHinweis;
})(window);
