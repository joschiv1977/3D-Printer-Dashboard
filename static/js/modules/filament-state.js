/**
 * The central filament state -- as the server decides it.
 * ==========================================================================
 * services/filament_state.py judges every slot and external spool: is a roll
 * in, which spool is it, is this live or only last seen. Until 16sep26 the
 * web judged for itself, with three rules for "empty" that disagreed:
 * `present === false` on the material card, a missing `type` on the drying
 * card, the device tab and the load lock, `empty` for the external spools --
 * and with the printer off every screen showed its last values as if live.
 *
 * This module holds the block `filament_state` (from /api/status and the
 * socket event of the same name) and answers what the screens ask -- only
 * from the block. The screens work nothing out from the raw printer fields
 * any more (`present`, `type`, `extruders`, `filament_step`, `tray_current`):
 * the server knows the printer, a screen that guesses is wrong the way the
 * server used to be. Without a block (Klipper has no AMS) nothing is known,
 * and nothing is shown as known.
 */
(function () {
    'use strict';

    let block = null;

    /** Take a new block; anything without places is not one. */
    function update(next) {
        if (next && Array.isArray(next.places)) block = next;
    }

    function slotKey(amsId, slot) { return 'ams:' + amsId + '/' + (slot || 0); }
    function externalKey(id) { return 'ext:' + id; }

    function place(key) {
        return block ? (block.places.find(p => p.key === key) || null) : null;
    }

    function unit(id) {
        return block ? ((block.units || []).find(u => u.id === id) || null) : null;
    }

    /**
     * R11: the AMS unit that takes this external spool's nozzle inlet, or
     * null when the spool is usable. {id, model} even when the unit itself
     * is not in the block any more.
     */
    function blockedBy(key) {
        const p = place(key);
        if (!p || p.blocked_by == null) return null;
        return unit(p.blocked_by) || { id: p.blocked_by, model: 'AMS' };
    }

    /** Nothing in the place: its roll is out. */
    function isEmpty(key) {
        const p = place(key);
        return !!p && p.roll === 'out';
    }

    /** A roll in the place (in, or still being read). */
    function hasRoll(key) {
        const p = place(key);
        return !!p && (p.roll === 'in' || p.roll === 'reading');
    }

    /**
     * Parked (R10): the slot reports empty while its unit dries with the
     * roll turning -- the roll is still in there and keeps its spool.
     */
    function isParked(key) {
        const p = place(key);
        return !!(p && p.parked);
    }

    /** The nozzle that pulls filament from this place right now -- or null. */
    function feeding(key) {
        const p = place(key);
        return p && p.feeding != null ? p.feeding : null;
    }

    /** Filament in any nozzle. */
    function nozzleLoaded() {
        return !!block && (block.nozzles || []).some(n => n.filament);
    }

    /**
     * The filament routine running on a nozzle: {nozzle, step, action}, or
     * null. `action` is load or unload -- the side a routine started at the
     * printer or in Studio belongs to.
     */
    function routine() { return block ? (block.routine || null) : null; }

    /** The printer is off or out of reach: everything is as last seen. */
    function isLastSeen() { return !!block && block.contact === 'last_seen'; }

    /** When the state last heard from the printer, as a Date -- or null. */
    function seenAt() {
        if (!block || !block.seen_at) return null;
        const d = new Date(block.seen_at);
        return isNaN(d) ? null : d;
    }

    /** The open questions ("which spool is in this place?"), with candidates. */
    function questions() { return block ? (block.questions || []) : []; }
    function conflicts() { return block ? (block.conflicts || []) : []; }
    function questionFor(key) { return questions().find(q => q.place === key) || null; }
    function conflictFor(key) { return conflicts().find(c => c.place === key) || null; }

    /** The place in words -- "AMS HT slot 1", "External spool left". */
    function placeLabel(key) {
        const texts = window.texts || {};
        const aussen = /^ext:(\d+)$/.exec(key);
        if (aussen) {
            const seite = aussen[1] === '254' ? (texts.spool_left || 'Links')
                                              : (texts.spool_right || 'Rechts');
            return (texts.fs_place_ext || 'Externe Spule {side}').replace('{side}', seite);
        }
        const m = /^ams:(\d+)\/(\d+)$/.exec(key);
        if (!m) return key;
        const u = unit(parseInt(m[1], 10));
        return (texts.fs_place_slot || '{model} Fach {n}')
            .replace('{model}', (u && u.model) || 'AMS')
            .replace('{n}', parseInt(m[2], 10) + 1);
    }

    window.filamentState = {
        update, slotKey, externalKey, place, unit, blockedBy, isEmpty, hasRoll, isParked,
        feeding, nozzleLoaded, routine,
        isLastSeen, seenAt, questions, conflicts, questionFor, conflictFor, placeLabel,
        block: () => block,
    };
})();
