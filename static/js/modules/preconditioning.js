/**
 * Thermal preconditioning -- showing the remaining time (Bambu, stage 58).
 *
 * Before the first layer the printer heats the chamber through. With ASA that
 * is a real ten minutes: on print 1319 `stg_cd` started at 599 seconds and
 * counted cleanly down to 0, exactly up to the change to stage 14. All that
 * time the progress reads 0% and layer 0 -- without a display it looks as if
 * something has hung.
 *
 * Deliberately a STATE banner in the message stack, not a fleeting message: ten
 * minutes is too long to disappear after twelve seconds. It goes by itself as
 * soon as the stage changes.
 *
 * Dismissing it is remembered by this browser only, and only for THIS print --
 * unlike HMS, where the acknowledgement deliberately applies everywhere. This
 * is a display, not an event other devices would have to confirm.
 */
(function () {
    'use strict';

    const STUFE_VORKONDITIONIERUNG = 58;

    let weggeklicktFuer = null;   // Druck-Nummer, fuer die es aus bleibt
    let letzteDrucknummer = null; // fuer das Wegklicken, ohne globalen Status

    function knoten() {
        return document.getElementById('precondition-banner');
    }

    function zeitText(sekunden) {
        const s = Math.max(0, Math.round(sekunden));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    /** Called out of the status -- on every update. */
    function aktualisiere(status) {
        const el = knoten();
        if (!el || !status) return;

        const druck = status.history_print_id || status.current_print_id || null;
        letzteDrucknummer = druck;
        const laeuft = Number(status.stage) === STUFE_VORKONDITIONIERUNG;
        const rest = Number(status.stg_cd);

        // A new print: an earlier dismissal no longer applies.
        if (druck && weggeklicktFuer && druck !== weggeklicktFuer) {
            weggeklicktFuer = null;
        }

        // stg_cd 0 means "about to finish" -- the banner is then not worth it.
        if (!laeuft || !(rest > 0) || (druck && druck === weggeklicktFuer)) {
            el.classList.remove('active');
            return;
        }

        const zaehler = document.getElementById('precondition-banner-countdown');
        if (zaehler) zaehler.textContent = zeitText(rest);
        el.classList.add('active');
    }

    function wegklicken() {
        const el = knoten();
        if (el) el.classList.remove('active');
        weggeklicktFuer = letzteDrucknummer || 'unbekannt';
    }

    window.preconditioning = { aktualisiere, wegklicken };
})();
