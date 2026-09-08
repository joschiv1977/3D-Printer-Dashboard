// hms-overlay.js -- the printer message on the remaining pages.
//
// The main page gets its state over the socket. The console, the history, the
// settings and the others have none -- there this module asks at the same
// cadence as the phone (5 s). It draws with the same routine (hms-banner.js),
// so the message looks and behaves the same everywhere.
//
// It does NOT start on the main page: that one already carries the stack in the
// page, and there the poll beside the socket would only be a duplicate.
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
            // The acknowledgement list comes along in the state -- it may have
            // changed on another device.
            if (Array.isArray(d.hms_dismissed)) weggeklickt = d.hms_dismissed;
            window.HmsBanner.zeichne(d, {
                geladen,
                weggeklickt: c => weggeklickt.some(x => window.HmsBanner.gleich(x, c)),
            });
        } catch (f) {
            // The server is gone or the session has expired: stay quiet, the
            // next tick tries again.
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (document.getElementById('notification-stack')) return;   // Hauptseite
        if (!window.HmsBanner) return;
        await quittungen();
        nachsehen();
        setInterval(nachsehen, TAKT);
    });
})();
