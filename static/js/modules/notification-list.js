/* ==========================================================================
   Benachrichtigungs-Liste  (21aug26)
   --------------------------------------------------------------------------
   Dieselbe Liste steht auf der eigenen Seite (notifications.html) und im
   Abschnitt "Benachrichtigungen" der Einstellungen. Bis heute war sie
   zweimal gebaut, mit unterschiedlichem Stand: einmal mit Strichsymbolen,
   einmal noch mit Emoji und Kaesten. Jetzt einmal hier.

   Benutzung:
       notificationList.zeichne(container, meldungen, {
           filter: 'all' | 'unread',
           aufWeg: (id) => …,      // Knopf "Weg"
       });
   Die Klassen stehen in static/css/benachrichtigungen.css.
   ========================================================================== */
(function () {
    'use strict';

    const TON = {
        gruen: { ton: '#2e7d32', flaeche: 'rgba(76,175,80,.14)' },
        rot:   { ton: '#c62828', flaeche: 'rgba(229,83,75,.14)' },
        gelb:  { ton: '#b26a00', flaeche: 'rgba(255,152,0,.15)' },
        blau:  { ton: '#1565c0', flaeche: 'rgba(33,150,243,.13)' },
        grau:  { ton: 'var(--text-secondary)', flaeche: 'rgba(128,128,128,.12)' },
    };

    const P = {
        start:      '<path d="M6 4l12 8-12 8z"/>',
        fertig:     '<path d="m5 13 4 4L19 7"/>',
        kreuz:      '<path d="M6 6l12 12M18 6L6 18"/>',
        pause:      '<path d="M9 5v14M15 5v14"/>',
        balken:     '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
        warnung:    '<path d="M12 9v5M12 17.5v.5"/><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',
        spule:      '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
        strom:      '<path d="M18.4 5.6a9 9 0 1 1-12.8 0M12 3v9"/>',
        info:       '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
        uhr:        '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        schluessel: '<path d="M14.7 6.3a4.5 4.5 0 0 0 6 6l-8.4 8.4a2.1 2.1 0 0 1-3 0l-3-3a2.1 2.1 0 0 1 0-3z"/><path d="M14.7 6.3 18 3"/>',
        tropfen:    '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4.5 4.5 0 1 0 4 0z"/>',
        glocke:     '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    };

    // The types occur twice over (print_finish / print_finished), depending on
    // which part of the server reports -- both spellings stand here, or the
    // message falls back to the bell.
    const EREIGNIS = {
        print_start:            { p: P.start,      f: TON.blau },
        print_started:          { p: P.start,      f: TON.blau },
        print_finish:           { p: P.fertig,     f: TON.gruen },
        print_finished:         { p: P.fertig,     f: TON.gruen },
        print_failed:           { p: P.kreuz,      f: TON.rot },
        print_cancelled:        { p: P.kreuz,      f: TON.gelb },
        print_pause:            { p: P.pause,      f: TON.gelb },
        print_paused:           { p: P.pause,      f: TON.gelb },
        milestone:              { p: P.balken,     f: TON.blau },
        milestone_notification: { p: P.balken,     f: TON.blau },
        hms_error:              { p: P.warnung,    f: TON.gelb },
        filament_change_action: { p: P.spule,      f: TON.blau },
        power_event:            { p: P.strom,      f: TON.grau },
        scheduled_print_event:  { p: P.uhr,        f: TON.blau },
        print_event:            { p: P.info,       f: TON.blau },
        maintenance:            { p: P.schluessel, f: TON.gelb },
        maintenance_due:        { p: P.schluessel, f: TON.gelb },
        drying_start:           { p: P.tropfen,    f: TON.blau },
        drying_finished:        { p: P.tropfen,    f: TON.gruen },
        info:                   { p: P.info,       f: TON.blau },
    };
    const GLOCKE = { p: P.glocke, f: TON.grau };

    function t(schluessel, rueckfall) {
        return (window.texts && window.texts[schluessel]) || rueckfall;
    }

    function sicher(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // The messages carry their status emoji in the title ("✅ print finished").
    // There is an icon for that on the left now, so out it goes -- exactly what
    // the toast does.
    function ohneZeichen(text) {
        return String(text == null ? '' : text)
            .replace(/^\s*(?:[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2705}\u{274C}\u{26A0}\u{2139}]+\s*)+/u, '');
    }

    function zeichen(typ) {
        const e = EREIGNIS[typ] || GLOCKE;
        return `<span class="nb-zeichen" style="--nb-ton:${e.f.ton}; --nb-flaeche:${e.f.flaeche}">
                    <svg viewBox="0 0 24 24" aria-hidden="true">${e.p}</svg>
                </span>`;
    }

    function zeit(sekunden) {
        if (!sekunden) return '';
        const d = new Date(sekunden * 1000);
        const diff = (Date.now() - d.getTime()) / 1000;
        if (diff < 60) return t('nb_gerade', 'gerade eben');
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function kanal(c) {
        return { websocket: 'Web', fcm_ios: 'iOS', fcm_android: 'Android', fcm_electron: 'Desktop' }[c] || c;
    }

    // The device's own name ("Mac mini (M4, 2024)"), not its platform.
    // "read on Desktop" says nothing once there are two computers, and the
    // server has known which one all along -- the id in `read_by` is the one
    // from /api/auth/sessions. The rule lives in device-names.js; without
    // that module the platform is still the answer.
    function geraet(did) {
        return window.deviceNames ? window.deviceNames.name(did)
                                   : (did ? String(did).split(/[:_-]/)[0] : '?');
    }

    // As soon as any of the user's devices has marked the message, it counts as
    // done everywhere -- otherwise a notice dismissed on the phone keeps
    // blinking as unread in the browser.
    function erledigt(n) {
        return Object.keys(n.read_by || {}).length > 0
            || Object.keys(n.dismissed_by || {}).length > 0;
    }

    function gelesenAuf(n) {
        const alle = {};
        for (const [did, ts] of Object.entries(n.read_by || {})) {
            if (!alle[did] || alle[did] < ts) alle[did] = ts;
        }
        for (const [did, ts] of Object.entries(n.dismissed_by || {})) {
            if (!alle[did] || alle[did] < ts) alle[did] = ts;
        }
        const eintraege = Object.entries(alle).sort((a, b) => b[1] - a[1]);
        if (!eintraege.length) return '';
        const plattformen = [];
        for (const [did] of eintraege) {
            const k = geraet(did);
            if (!plattformen.includes(k)) plattformen.push(k);
        }
        const wort = t('nb_gelesen_auf', 'gelesen auf');
        if (plattformen.length <= 2) return `${wort} ${plattformen.join(', ')}`;
        return `${wort} ${plattformen.slice(0, 2).join(', ')} +${plattformen.length - 2}`;
    }

    function zeichne(container, meldungen, opt) {
        if (!container) return;
        opt = opt || {};
        const liste = (meldungen || []).filter(n => opt.filter === 'unread' ? !erledigt(n) : true);

        if (!liste.length) {
            container.innerHTML = `<div class="nb-leer">
                    <svg viewBox="0 0 24 24" aria-hidden="true">${P.glocke}</svg>
                    <span>${sicher(t('nb_leer', 'Keine Benachrichtigungen'))}</span>
                </div>`;
            return;
        }

        container.innerHTML = liste.map(n => {
            const neu = !erledigt(n);
            const kanaele = Object.keys(n.channels_sent || {});
            const gelesen = gelesenAuf(n);
            return `
            <div class="nb-zeile" data-id="${sicher(n.id)}">
                ${zeichen(n.event_type)}
                <div class="nb-text">
                    <div class="nb-titel">
                        ${neu ? '<span class="nb-neu-punkt"></span>' : ''}
                        <span>${sicher(ohneZeichen(n.title))}</span>
                    </div>
                    <div class="nb-satz">${sicher(n.body)}</div>
                    <div class="nb-fuss">
                        <span>${zeit(n.created_at)}</span>
                        <span class="nb-kanaele">${kanaele.map(c => `<span class="nb-marke">${sicher(kanal(c))}</span>`).join('')}</span>
                        ${gelesen ? `<span>${sicher(gelesen)}</span>` : ''}
                    </div>
                </div>
                <div class="nb-tat">
                    ${neu
                        ? `<button class="nb-weg" data-weg="${sicher(n.id)}">
                               <svg class="nb-ic" style="width:12px;height:12px" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
                               ${sicher(t('nb_weg', 'Weg'))}
                           </button>`
                        /* When the footer already says "read on web",
                           braucht es rechts kein zweites "gelesen". */
                        : (gelesen ? '' : `<span class="nb-gelesen">${sicher(t('nb_gelesen', 'gelesen'))}</span>`)}
                </div>
            </div>`;
        }).join('');

        if (opt.aufWeg && !container._wegVerdrahtet) {
            container._wegVerdrahtet = true;
            container.addEventListener('click', (e) => {
                const knopf = e.target.closest('[data-weg]');
                if (knopf) opt.aufWeg(knopf.getAttribute('data-weg'));
            });
        }

        // The names come from the server, the list must not wait for them:
        // it draws at once with the platform and once more when the table is
        // in. Only on the first pass -- afterwards the table answers straight
        // away, and a second round would draw forever.
        if (window.deviceNames && !namenGeholt) {
            namenGeholt = true;
            window.deviceNames.laden()
                .then(() => zeichne(container, meldungen, opt))
                .catch(() => {});
        }
    }

    //: Whether the name table has already been asked for, this page load.
    let namenGeholt = false;

    window.notificationList = { zeichne, erledigt, zeit, kanal, ohneZeichen, t };
})();
