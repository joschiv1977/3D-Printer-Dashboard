/**
 * Thermische Vorkonditionierung — Restzeit anzeigen (Bambu, Stufe 58).
 *
 * Der Drucker heizt vor der ersten Schicht die Kammer durch. Bei ASA sind
 * das echte zehn Minuten: bei Druck 1319 am 27aug26 startete `stg_cd` bei
 * 599 Sekunden und zaehlte sauber auf 0 herunter, exakt bis zum Wechsel auf
 * Stufe 14. Solange steht der Fortschritt auf 0 % und Schicht 0 — ohne
 * Anzeige sieht es aus, als haenge etwas.
 *
 * Bewusst ein ZUSTANDSbanner im Meldungsstapel, keine fluechtige Meldung:
 * zehn Minuten sind zu lang, um nach zwoelf Sekunden zu verschwinden. Es
 * geht von selbst, sobald die Stufe wechselt.
 *
 * Das Wegklicken merkt sich nur dieser Browser und nur fuer DIESEN Druck —
 * anders als bei HMS, wo die Quittung bewusst ueberall gilt. Das hier ist
 * eine Anzeige, kein Ereignis, das andere Geraete bestaetigen muessten.
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

    /** Aus dem Status heraus aufgerufen — bei jedem Update. */
    function aktualisiere(status) {
        const el = knoten();
        if (!el || !status) return;

        const druck = status.history_print_id || status.current_print_id || null;
        letzteDrucknummer = druck;
        const laeuft = Number(status.stage) === STUFE_VORKONDITIONIERUNG;
        const rest = Number(status.stg_cd);

        // Neuer Druck: ein frueheres Wegklicken gilt nicht mehr.
        if (druck && weggeklicktFuer && druck !== weggeklicktFuer) {
            weggeklicktFuer = null;
        }

        // stg_cd 0 heisst "gleich fertig" — dann lohnt das Banner nicht mehr.
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

    window.vorkonditionierung = { aktualisiere, wegklicken };
})();
