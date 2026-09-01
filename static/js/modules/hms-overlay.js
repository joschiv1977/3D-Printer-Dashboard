// hms-overlay.js — die Drucker-Meldung auf den uebrigen Seiten.
//
// Die Hauptseite bekommt ihren Zustand ueber den Socket. Konsole, Historie,
// Einstellungen und die anderen haben keinen — dort fragt dieses Modul im
// gleichen Takt nach wie das Telefon (5 s). Gezeichnet wird mit derselben
// Routine (hms-banner.js), damit die Meldung ueberall gleich aussieht und
// gleich reagiert.
//
// Es startet NICHT auf der Hauptseite: die traegt den Stapel schon in der
// Seite, und dort waere der Poll neben dem Socket nur doppelt.
(function () {
    'use strict';

    const TAKT = 5000;
    let weggeklickt = [];
    let geladen = false;

    async function quittungen() {
        try {
            const a = await fetch('/api/hms/status');
            const d = await a.json();
            if (d.success) weggeklickt = d.dismissed_errors || [];
        } catch (f) {
            console.error('❌ Error loading HMS status:', f);
        } finally {
            geladen = true;
        }
    }

    async function nachsehen() {
        try {
            const a = await fetch('/api/status');
            if (!a.ok) return;
            const d = await a.json();
            // Die Quittungsliste kommt im Zustand mit — sie kann sich auf
            // einem anderen Geraet geaendert haben.
            if (Array.isArray(d.hms_dismissed)) weggeklickt = d.hms_dismissed;
            window.HmsBanner.zeichne(d, {
                geladen,
                weggeklickt: c => weggeklickt.some(x => window.HmsBanner.gleich(x, c)),
            });
        } catch (f) {
            // Server weg oder Sitzung abgelaufen: still bleiben, der
            // naechste Takt versucht es wieder.
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (document.getElementById('meldungs-stapel')) return;   // Hauptseite
        if (!window.HmsBanner) return;
        await quittungen();
        nachsehen();
        setInterval(nachsehen, TAKT);
    });
})();
