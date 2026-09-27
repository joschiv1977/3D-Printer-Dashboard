/**
 * What may be done right now -- as the server decides it.
 * ==========================================================================
 * services/action_guards.py judges every group of actions: movement, heating,
 * extruder, filament, drying, print control, print start, calibration, and
 * the device itself. The same table guards the action when it arrives, so a
 * greyed-out button and a refused call cannot disagree.
 *
 * Until 17sep26 every surface worked this out from `gcode_state` for itself --
 * 35 places in the web alone, and they disagreed: the filament tab locked
 * during a pause, the calibration card did not; a coordinate move was possible
 * mid-print because nobody had thought of `move_to`.
 *
 * This module holds the block `actions` (from /api/status and the socket push)
 * and answers what the screens ask -- only from the block. Without one nothing
 * is allowed and nothing pretends to know better: no block, no printer.
 */
(function () {
    'use strict';

    let block = null;

    /** Take a new block; anything without groups is not one. */
    function update(next) {
        if (next && typeof next === 'object' && next.device) block = next;
    }

    function eintrag(gruppe) {
        return block ? (block[gruppe] || null) : null;
    }

    /** May this group of actions run? Without the block: no. */
    function erlaubt(gruppe) {
        const e = eintrag(gruppe);
        return !!(e && e.allowed);
    }

    /** The i18n key of the block, or '' when it is allowed. */
    function grund(gruppe) {
        const e = eintrag(gruppe);
        return (e && !e.allowed && e.reason) ? e.reason : '';
    }

    /** The reason in the viewer's language, ready to put on screen. */
    function text(gruppe) {
        const schluessel = grund(gruppe);
        if (!schluessel) return '';
        const texts = window.texts || {};
        return texts[schluessel] || schluessel;
    }

    /** Is the printer occupied at all, and with what?
     *  {active, reason, detail} -- detail is the printer's own step
     *  ("Filament wechseln"), already in words. */
    function busy() {
        return (block && block.busy) || { active: false, reason: null, detail: '' };
    }

    /** Lock or unlock one element and say why, without a rule of its own. */
    function sperre(el, gruppe) {
        if (!el) return erlaubt(gruppe);
        const frei = erlaubt(gruppe);
        if ('disabled' in el) el.disabled = !frei;
        el.setAttribute('aria-disabled', String(!frei));
        el.classList.toggle('ctrl-gesperrt', !frei);
        if (frei) el.removeAttribute('title');
        else el.title = text(gruppe);
        return frei;
    }

    window.aktionen = { update, erlaubt, grund, text, busy, sperre, block: () => block };
})();
