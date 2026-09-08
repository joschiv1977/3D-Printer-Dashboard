// notification-stack.js — ordering and truncation of the printer notifications.
//
// The six notifications sit as fixed DOM nodes in _banners.html and are
// still toggled by their respective modules via classList.add('active')
// — nothing here gets redirected and no call site gets touched.
// This module only takes care of what the stack itself makes
// necessary:
//
//   * fading in with a transition (the .active class alone would jump),
//   * ordering: urgent on top, ongoing states at the bottom,
//   * "+N more" once more than three notifications are up at once.
//
// States (.mld--zustand) are NEVER truncated: what the printer is
// currently doing must not disappear behind a collapsed summary line.
(function () {
    'use strict';

    // Visible notifications, that's what gets counted. On desktop there's
    // room for five stacked on top of each other — not on the phone, where
    // the stack sits at the bottom over the page and would bury the lowest
    // card. Same threshold as in the CSS and as in Android (SCHMAL_DP).
    function hoechstens() {
        return (window.innerWidth || 0) > 600 ? 5 : 3;
    }
    // Urgent first. States deliberately carry the highest value and so
    // slide to the end of the stack.
    const RANG = { 'mld--fehler': 0, 'mld--warnung': 1, 'mld--info': 2, 'mld--laeuft': 3 };

    let stapel = null;
    let aufgeklappt = false;
    let wache = null;
    let zuwachs = null;
    let geplant = false;

    // Where the user has dragged the stack to — only for this session.
    //
    // Notifications should ALWAYS arrive in the same spot, otherwise you
    // go looking for them. But sometimes the stack sits right on top of
    // the button you need. So: pushing it aside, yes — remembering it, no.
    // Plain module variable, no localStorage — on the next load it's back
    // where it belongs. Same rule as in Android
    // (MeldungsVerschiebung).
    let schubX = 0;
    let schubY = 0;
    let griff = null;

    function setzeSchub() {
        if (!stapel) return;
        stapel.style.transform = (schubX || schubY)
            ? `translate(${schubX}px, ${schubY}px)` : '';
    }

    /** The drag handle. Drags immediately — no press-and-hold, no confusing it with the X. */
    function baueGriff() {
        if (griff || !stapel) return;
        griff = document.createElement('div');
        griff.className = 'mld-griff';
        griff.title = (window.texts && window.texts.mld_schieben) || 'Verschieben';
        let start = null;
        griff.addEventListener('pointerdown', function (e) {
            start = { x: e.clientX - schubX, y: e.clientY - schubY };
            griff.setPointerCapture(e.pointerId);
            stapel.classList.add('mld-stapel--zieht');
            e.preventDefault();
        });
        griff.addEventListener('pointermove', function (e) {
            if (!start) return;
            const kasten = stapel.getBoundingClientRect();
            // Only far enough to keep the stack on screen — push it further
            // and you won't find it again until the next reload.
            const spielX = Math.max(0, window.innerWidth - kasten.width);
            const spielY = Math.max(0, window.innerHeight - kasten.height);
            schubX = Math.min(spielX, Math.max(-spielX, e.clientX - start.x));
            schubY = Math.min(spielY, Math.max(-spielY, e.clientY - start.y));
            setzeSchub();
        });
        const schluss = function (e) {
            start = null;
            stapel.classList.remove('mld-stapel--zieht');
            try { griff.releasePointerCapture(e.pointerId); } catch (_) {}
        };
        griff.addEventListener('pointerup', schluss);
        griff.addEventListener('pointercancel', schluss);
        stapel.appendChild(griff);
    }

    /** Only show the handle when there's actually something to show. */
    function griffPflegen(sichtbare) {
        if (!stapel) return;
        if (sichtbare > 0) {
            baueGriff();
            griff.style.display = '';
        } else if (griff) {
            griff.style.display = 'none';
        }
    }

    function rangVon(el) {
        if (el.classList.contains('mld--zustand')) return 9;
        for (const k in RANG) if (el.classList.contains(k)) return RANG[k];
        return 5;
    }

    /** The next OPEN sibling — everything else may sit wherever it likes. */
    function naechsterOffener(el, offen) {
        let n = el.nextElementSibling;
        while (n && offen.indexOf(n) === -1) n = n.nextElementSibling;
        return n || null;
    }

    // The observer gets switched off during the rebuild. classList.remove()
    // rewrites the class attribute even when the class wasn't set to begin
    // with — the observer would trigger itself right back and the page
    // would freeze. On top of that, only one rebuild happens per frame.
    function anstossen() {
        if (geplant) return;
        geplant = true;
        requestAnimationFrame(() => { geplant = false; ordne(); });
    }

    function ordne() {
        if (!stapel) return;
        if (wache) wache.disconnect();
        // Shut down the growth observer as well. It hung on the stack's
        // childList — and baueAuf() moves nodes around, so it produces exactly
        // such changes. That way the rebuild kept re-triggering itself,
        // frame by frame. It only became visible on the answer buttons
        // in the printer banner (30aug26): whoever pressed one held the
        // mouse button across several frames, the node was re-attached
        // in between, and a `click` only happens when press and
        // release hit the same node. The buttons did nothing.
        if (zuwachs) zuwachs.disconnect();
        try { baueAuf(); } finally { beobachte(); beobachteZuwachs(); }
    }

    /** Open = shown and not already fading out. The one definition. */
    function istOffen(el) {
        return el.classList.contains('active') && !el.classList.contains('mld-geht');
    }

    function baueAuf() {
        const alle = [...stapel.querySelectorAll('.mld:not(.mld-sammel)')];
        // The handle isn't a notification: it carries no .mld class and so
        // doesn't even show up here. It's only ever shown and hidden.
        const offen = alle.filter(istOffen);

        // Fade a newly shown one in. The transition needs a rendered start
        // state, which a forced layout provides — NOT a frame.
        //
        // It used to hang on requestAnimationFrame, and that does not run
        // while the window is throttled: covered by other windows, or the
        // app in the menu bar. Since `.mld` without `.active` is
        // display:none, the notification then sat invisible in the page —
        // and no popup came either, because the main process had already
        // been told it was delivered.
        alle.forEach(el => {
            const auf = istOffen(el);
            const an = el.classList.contains('mld-an');
            if (auf && !an) { void el.offsetWidth; el.classList.add('mld-an'); }
            else if (!auf && an) el.classList.remove('mld-an');
        });

        // Only move what really has to go somewhere else. `appendChild` on
        // a node that already sits right takes it out anyway and re-inserts
        // it — with everything attached to it, and a `click` only counts
        // when press and release hit the same node.
        //
        // The guard compares against the OPEN nodes, not against
        // `stapel.children`: those also hold the inactive fixed nodes, the
        // drag handle and the collector line, so `children[i]` was
        // practically never the node in question — and every rebuild
        // re-hung every notification. During a print that happens several
        // times a second, and the cross had to be clicked twice.
        const sortiert = offen.slice().sort((a, b) => rangVon(a) - rangVon(b));
        // Work from the back: each node has to sit directly before its
        // successor, ignoring everything that isn't open.
        for (let i = sortiert.length - 1; i >= 0; i--) {
            const el = sortiert[i];
            const soll = sortiert[i + 1] || null;
            if (naechsterOffener(el, offen) !== soll) stapel.insertBefore(el, soll);
        }

        const alteSammel = stapel.querySelector('.mld-sammel');
        if (alteSammel) alteSammel.remove();

        const zustaende = offen.filter(el => el.classList.contains('mld--zustand'));
        const meldungen = offen.filter(el => !el.classList.contains('mld--zustand'));
        const grenze = hoechstens();
        meldungen.forEach((el, i) => {
            const soll = (aufgeklappt || i < grenze) ? '' : 'none';
            if (el.style.display !== soll) el.style.display = soll;
        });

        const rest = meldungen.length - grenze;
        if (rest > 0 && !aufgeklappt) {
            const s = document.createElement('div');
            s.className = 'mld mld--info mld-sammel active mld-an';
            const text = (window.texts && window.texts.mld_weitere) || '+{n} weitere Meldungen';
            s.innerHTML =
                '<span class="mld-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' +
                '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/></svg></span>' +
                '<div class="mld-t"><div class="mld-titel">' +
                String(text).replace('{n}', rest) + '</div>' +
                '<div class="mld-mehr">' +
                ((window.texts && window.texts.mld_alle_zeigen) || 'Alle anzeigen') +
                '</div></div>';
            s.addEventListener('click', () => { aufgeklappt = true; anstossen(); });
            // Before the states: those always stay at the very end.
            stapel.insertBefore(s, zustaende[0] || null);
        }
        if (rest <= 0) aufgeklappt = false;
        griffPflegen(offen.length);
        setzeSchub();
    }

    function beobachte() {
        if (!wache || !stapel) return;
        stapel.querySelectorAll('.mld:not(.mld-sammel)').forEach(el =>
            wache.observe(el, { attributes: true, attributeFilter: ['class'],
                                attributeOldValue: true }));
    }

    /**
     * Did the class attribute actually change?
     *
     * `classList.remove()` rewrites the attribute even when the class was
     * never set, and the observer fires on that. The printer status does
     * exactly that on every single update — preconditioning.aktualisiere()
     * clears a banner that isn't up — so the stack rebuilt several times a
     * second while nothing about it had changed.
     *
     * The check sits HERE and not in the modules: every one of them writes
     * this way, including the ones added later.
     */
    function wirklichGeaendert(eintraege) {
        for (const e of eintraege) {
            if (e.target.getAttribute('class') !== e.oldValue) return true;
        }
        return false;
    }

    // Not every notification is in the page from the start: the printer
    // notification builds itself in as soon as there's something to report
    // (hms-banner.js). Without this observer it stayed outside ranking and
    // truncation — the stack didn't count it.
    function beobachteZuwachs() {
        if (!stapel) return;
        if (!zuwachs) {
            zuwachs = new MutationObserver(() => { beobachte(); anstossen(); });
        }
        zuwachs.observe(stapel, { childList: true });
    }

    function start() {
        // Repeatable: behaelter() calls this again when the container is gone
        // from the document. Without dropping the old observers each call
        // would leave one behind, still watching a detached node.
        if (wache) { wache.disconnect(); wache = null; }
        if (zuwachs) { zuwachs.disconnect(); zuwachs = null; }
        stapel = document.getElementById('notification-stack');
        if (!stapel) {
            // The container only exists as a fixture on the home page,
            // because it sits in a Jinja partial (_banners.html) and the
            // other pages are static HTML — so they can't include it at
            // all. Result: a notification vanished when switching to the dock.
            //
            // So the module creates it itself when it's missing. Empty,
            // without the home page's six fixed nodes: each of those
            // belongs to a purpose that has no business on a settings
            // page. The styles are on every page anyway (meldungen.css).
            stapel = document.createElement('div');
            stapel.id = 'notification-stack';
            stapel.className = 'mld-stapel';
            document.body.appendChild(stapel);
        }
        // The modules only set/remove the 'active' class — the observer
        // then runs ONCE per change, instead of adding a call in every
        // module (and forgetting it in the next one).
        wache = new MutationObserver((eintraege) => {
            if (wirklichGeaendert(eintraege)) anstossen();
        });
        beobachte();
        beobachteZuwachs();
        ordne();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    // ---------------------------------------------------------------
    // Runtime notifications — for push messages
    // ---------------------------------------------------------------
    // The six fixed nodes above each belong to one purpose. A push
    // notification has none: title and text only get fixed once it
    // arrives. Until 27aug26 there was nothing for that at all — in the
    // Electron app the old popup therefore appeared outside the UI, while
    // HMS and system notices had long been running here in the top right.
    //
    // What gets created is the same structure as in _banners.html, so
    // ranking, truncation and transition apply without a special case.
    const ART_KLASSE = {
        error: 'mld--fehler', hms_error: 'mld--fehler', print_failed: 'mld--fehler',
        warning: 'mld--warnung', filament: 'mld--warnung',
    };
    const SYMBOL = {
        'mld--fehler': '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17v.5"/>',
        'mld--warnung': '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17v.5"/>',
        'mld--info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
    };
    //: How long a push notification stays up. Errors stay until the user
    //: dismisses them — they can concern a print.
    // Formerly the display time of a notification. Since 28aug26 they stay
    // up until someone dismisses them — see zeige(). Deliberately not
    // deleted, so the number doesn't read as "never existed" in case
    // something self-hiding is ever meant for this stack again.
    const STEHZEIT_MS = 12000;   // unused

    // Push copies of notifications that the page has long been showing as
    // a fixed node. The server additionally sends HMS errors as a push; in
    // the browser that lands as a system notification outside the page,
    // but in Electron, since 27aug26, right into this very stack. Then the
    // same thing showed up twice, one under the other: "AMS-HT A: a front
    // cover is open" as the state node, and underneath it as "Printer
    // error" (seen 27aug26).
    //
    // Right now ONLY hms_error has a fixed twin. filament_drying goes out
    // data_only and never reaches the UI, and power_event means switching
    // the outlet, not the auto-off countdown in the banner — so neither
    // belongs here. A new twin is a single line.
    const FESTER_KNOTEN = {
        hms_error: { id: 'hms-error-banner', schluessel: 'errorCode' },
    };

    /** Is a fixed node already showing this same thing? */
    function schonAmSchirm(meldung) {
        const eintrag = FESTER_KNOTEN[meldung.art];
        if (!eintrag) return false;
        const el = document.getElementById(eintrag.id);
        if (!el || !el.classList.contains('active')) return false;
        // Without a marker it's enough that "the node is up". With a
        // marker it has to be the same thing — otherwise a standing banner
        // would swallow the notification about a SECOND, different error.
        if (!eintrag.schluessel || !meldung.sache) return true;
        return String(el.dataset[eintrag.schluessel] || '') === String(meldung.sache);
    }

    function zeige(meldung) {
        if (!stapel || !meldung) return null;
        if (schonAmSchirm(meldung)) {
            console.log('⏭️ Push copy discarded, already shown as a banner:', meldung.titel);
            return null;
        }
        // The same id is already in the stack. That can be a second push
        // about the same thing — or, now that restoration exists, a
        // repeat sync after reconnecting: `connect` fires on EVERY one,
        // and without this guard the box would end up standing there
        // twice.
        if (meldung.kennung
            && stapel.querySelector('.mld:not(.mld-geht)[data-kennung="'
                                    + String(meldung.kennung).replace(/"/g, '\\"') + '"]')) {
            return null;
        }
        const klasse = ART_KLASSE[meldung.art] || 'mld--info';
        const knoten = document.createElement('div');
        knoten.className = 'mld ' + klasse;
        if (meldung.kennung) knoten.dataset.kennung = meldung.kennung;
        // What this is about (HMS code) — entferneSache uses it to recognize the copy.
        if (meldung.sache) knoten.dataset.sache = String(meldung.sache);

        const zu = (window.texts && window.texts.mld_schliessen) || 'Ausblenden';
        knoten.innerHTML =
            '<span class="mld-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            SYMBOL[klasse] + '</svg></span>' +
            '<div class="mld-t"><div class="mld-titel"></div>' +
            '<div class="mld-detail"></div></div>' +
            '<button class="mld-zu" type="button" title="' + zu + '">&times;</button>';
        // Set title and text as text, not as HTML: they come from the
        // server and can contain file names.
        knoten.querySelector('.mld-titel').textContent = meldung.titel || '';
        knoten.querySelector('.mld-detail').textContent = meldung.text || '';

        // A message that can be ACTED on carries its button here. Until
        // 04sep26 the stack could only report; the filament conflict of a
        // slicer print said what was wrong and left you to find the place
        // that fixes it yourself.
        if (meldung.aktion && typeof meldung.aktion.tun === 'function') {
            const knopf = document.createElement('button');
            knopf.type = 'button';
            knopf.className = 'mld-aktion';
            knopf.textContent = meldung.aktion.text || '';
            knopf.addEventListener('click', (ev) => {
                ev.stopPropagation();
                meldung.aktion.tun();
            });
            knoten.querySelector('.mld-t').appendChild(knopf);
        }
        knoten.querySelector('.mld-zu').addEventListener('click', () => {
            meldeWeggeklickt(meldung.kennung);
            nimmWeg(knoten);
        });

        stapel.appendChild(knoten);
        // Visible AT ONCE. `.mld` without `.active` is display:none, and
        // this used to be set inside requestAnimationFrame — which does not
        // run while the window is throttled (covered, or in the menu bar).
        // The notification then hung invisible in the page, and the main
        // process showed no popup either, because the page had confirmed
        // delivery.
        //
        // The forced layout in between is what the transition needs: it
        // gives the fade its start state, which is what the frame used to
        // be there for.
        knoten.classList.add('active');
        void knoten.offsetWidth;
        knoten.classList.add('mld-an');
        anstossen();

        // NO self-hiding. Only things that arrived via FCM ever end up in
        // this stack (electron-app/push-receiver-init.js is the only
        // caller) — and a push message doesn't disappear on its own. On
        // the phone the same notification waits in the notification tray
        // until someone swipes it away; here, until 28aug26, it stood for
        // twelve seconds and then was gone without a trace if you happened
        // to look away (noticed with "25% reached").
        //
        // This keeps the stack from growing past the screen: past
        // HOECHSTENS, baueAuf() collapses the rest into "+N more notifications".
        return knoten;
    }

    // Report the dismissal to the server — otherwise the notification stays
    // marked as open there, and phone and iOS keep showing it unchanged.
    // The old popup did this on close (markNotificationOnServer); moving it
    // into the UI would otherwise have dropped it without a replacement.
    //
    // Only on clicking the cross, NOT when the notification goes away on its
    // own after its display time: disappearing by itself doesn't mean someone
    // has seen and handled it.
    function meldeWeggeklickt(kennung) {
        if (!kennung) return;
        // Remember it HERE, before reporting.
        //
        // The set was only ever filled by the socket echo — that is, after
        // the round trip. In that gap `/api/notifications/recent` still
        // reports the notification as open, so a holeOffene() landing in it
        // (reconnect, next push, page switch) put the box straight back on
        // screen and it had to be dismissed a second time.
        if (!window.__dismissedNotificationIds) {
            window.__dismissedNotificationIds = new Set();
        }
        window.__dismissedNotificationIds.add(kennung);

        // And the main process keeps the books for both ways of showing it:
        // without this its cache would still hold the notification and hand
        // it back to the stack when the window comes up again.
        try {
            if (window.electronAPI && window.electronAPI.notificationDismissed) {
                window.electronAPI.notificationDismissed(String(kennung));
            }
        } catch (_) {}

        const ruf = window.apiCall
            || ((url, opt) => fetch(url, Object.assign({ credentials: 'include' }, opt)));
        ruf('/api/notifications/' + encodeURIComponent(kennung) + '/dismiss',
            { method: 'POST' }).catch(() => {});
    }

    function nimmWeg(knoten) {
        if (!knoten || !knoten.parentNode) return false;
        // Already on its way out — a second call must not count again.
        if (knoten.classList.contains('mld-geht')) return false;
        // `active` has to stay for the fade — it is what carries
        // display:flex. So the node says separately that it is on its way
        // out: without that it kept counting as a notification for another
        // 200 ms (ranking, the limit, the "+N more" line), and baueAuf()
        // faded it right back in because for it the node was still open.
        knoten.classList.add('mld-geht');
        knoten.classList.remove('mld-an');
        // Remove it only after fading out, otherwise the box disappears
        // abruptly; 0.18s is the duration from components.css.
        setTimeout(() => { knoten.remove(); anstossen(); }, 200);
        anstossen();
        return true;
    }

    /** Remove a notification for this id again (dismissed elsewhere). */
    /**
     * Remove a notification from the stack.
     *
     * Returns how many entries were actually removed. Previously there was
     * no feedback, and the caller in Electron therefore reported every
     * attempt as a success: at startup the log showed 30 lines of
     * "handled elsewhere, removed from the stack" in the log, even though the stack
     * was empty and there was nothing to remove (01sep26).
     */
    function entferne(kennung) {
        if (!stapel || !kennung) return 0;
        let weg = 0;
        stapel.querySelectorAll('.mld[data-kennung]').forEach(el => {
            if (el.dataset.kennung === kennung && nimmWeg(el)) weg++;
        });
        return weg;
    }

    /**
     * Remove push copies for this thing — the fixed node has taken over.
     * The reverse direction of schonAmSchirm: if the push arrives BEFORE
     * the status (the banner depends on the poll or the socket), the copy
     * is already there by the time the node opens. Without this the
     * duplication would just flip around instead of going away.
     */
    function entferneSache(sache) {
        if (!sache) return;
        if (stapel) {
            stapel.querySelectorAll('.mld[data-sache]').forEach(el => {
                if (el.dataset.sache === String(sache)) nimmWeg(el);
            });
        }
        // And the same outside the UI: if the app was closed when the
        // error came in, it turned into a popup next to the window. On
        // opening it, it stood next to the state node saying the same thing.
        try {
            if (window.electronAPI && window.electronAPI.closeNotificationsForSubject) {
                window.electronAPI.closeNotificationsForSubject(String(sache));
            }
        } catch (_) {}
    }

    //: This far back gets restored on load, and at most this many. Both a
    //: matter of taste, not measurement — after a week's absence, twenty
    //: boxes shouldn't be standing there.
    const WIEDER_STUNDEN = 24;
    const WIEDER_HOECHSTENS = 5;

    /**
     * Put open notifications from the server back into the stack.
     *
     * The stack lives purely in the DOM. A reload, a page switch via the
     * dock, or a discarded renderer: the boxes were gone and never came
     * back, even though nobody had dismissed them.
     *
     * ONLY in Electron. That's where push-receiver-init.js fills the
     * stack, and only there is something missing. In the browser it was
     * never filled — filling it there now would be new behavior, not a bug fix.
     *
     * Calling it multiple times is harmless: `zeige` won't accept the
     * same id twice.
     */
    async function holeOffene() {
        if (!window.electronAPI || !stapel) return 0;

        // The server is the source. The main process keeps a copy, and it
        // is the one that answers when the server cannot be reached: the
        // push came through, only the fetch did not, and an empty stack
        // would be the one outcome the user must not get.
        let offene = null;
        try {
            const ruf = window.apiCall
                || ((url, opt) => fetch(url, Object.assign({ credentials: 'include' }, opt)));
            const antwort = await ruf('/api/notifications/recent?limit=50');
            if (antwort && antwort.ok) {
                const { notifications } = await antwort.json();
                const grenze = Date.now() / 1000 - WIEDER_STUNDEN * 3600;
                offene = (notifications || [])
                    .filter(n => !Object.keys(n.dismissed_by || {}).length
                              && !Object.keys(n.read_by || {}).length
                              && (n.created_at || 0) >= grenze)
                    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
                    .slice(-WIEDER_HOECHSTENS)
                    .map(n => ({
                        kennung: n.event_id || n.id,
                        titel: n.title || '',
                        text: n.body || '',
                        art: n.event_type || '',
                        extra: (n.meta || {}).extra_data || {},
                    }));
                // The answer is the truth — the books get corrected by it,
                // so a notification handled on the phone doesn't come back
                // out of the cache on the next start.
                melde(offene);
            }
        } catch (_) { /* offene stays null -> the cache answers */ }

        if (offene === null) offene = await ausDemSpeicher();

        let zurueck = 0;
        for (const n of offene) {
            if (!n.kennung) continue;
            // Say WHY nothing appears. The stack answered "0 open" for three
            // different reasons and named none of them, and the difference
            // matters: an id in the dismissed set is correct, a node already
            // in the stack means it hangs there invisibly, and a fixed banner
            // means the page shows the same thing elsewhere (08sep26 — on the
            // home page nothing appeared, on every other page it did).
            if (window.__dismissedNotificationIds
                && window.__dismissedNotificationIds.has(n.kennung)) {
                console.log('⏭️ Meldungsstapel: uebersprungen, hier schon weggeklickt:', n.kennung);
                continue;
            }
            const zusatz = n.extra || {};
            const schonDa = stapel.querySelector(
                '.mld:not(.mld-geht)[data-kennung="'
                + String(n.kennung).replace(/"/g, '\\"') + '"]');
            if (schonDa) {
                console.log('⏭️ Meldungsstapel: steht schon im Stapel:', n.kennung,
                            'sichtbar=' + schonDa.classList.contains('mld-an'),
                            'aktiv=' + schonDa.classList.contains('active'));
                continue;
            }
            const knoten = zeige({
                titel: n.titel,
                text: n.text,
                art: n.art,
                kennung: n.kennung,
                sache: zusatz.error_code || null,
                aktion: konfliktAktion(n.art, zusatz),
            });
            if (knoten) zurueck++;
            else console.log('⏭️ Meldungsstapel: zeige() hat nichts gebaut:', n.kennung, n.art);
        }
        if (zurueck) {
            console.log(`📥 Meldungsstapel: ${zurueck} offene Meldung(en) wieder eingelegt`);
        }
        return zurueck;
    }

    /** Tell the main process what the server considers open. */
    function melde(offene) {
        try {
            if (window.electronAPI && window.electronAPI.notificationsFetched) {
                window.electronAPI.notificationsFetched(offene);
            }
        } catch (_) {}
    }

    /** The last known state, from the main process. */
    async function ausDemSpeicher() {
        try {
            if (window.electronAPI && window.electronAPI.notificationsOpen) {
                const liste = await window.electronAPI.notificationsOpen();
                if (Array.isArray(liste) && liste.length) {
                    console.log(`📴 Server nicht erreichbar — ${liste.length} Meldung(en) `
                                + 'aus dem Zwischenspeicher');
                    return liste;
                }
            }
        } catch (_) {}
        return [];
    }

    // Check in once on loading EVERY page — that's where the case in
    // question lives. On the home page the socket connector also calls
    // it, which covers reconnecting.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => holeOffene());
    } else {
        holeOffene();
    }

    /** The button for a message that can be fixed — or nothing.
     *
     *  Today only the filament conflict of a slicer print. It carries the
     *  whole picture in `mismatch` (what the file wants, what the tray says,
     *  which spools could be in there), and the dialog does the fixing.
     */
    function konfliktAktion(art, zusatz) {
        if (art !== 'filament_mismatch' || !zusatz || !zusatz.mismatch) return null;
        let konflikt = zusatz.mismatch;
        if (typeof konflikt === 'string') {
            try { konflikt = JSON.parse(konflikt); } catch (_) { return null; }
        }
        if (!konflikt || typeof konflikt !== 'object') return null;
        return {
            text: (window.texts && window.texts.fk_open) || 'Beheben',
            tun: () => {
                if (window.printActions && window.printActions.zeigeFilamentKonflikt) {
                    window.printActions.zeigeFilamentKonflikt(konflikt, zusatz.filename || '');
                }
            },
        };
    }

    /** The container — created on first ask if it is not in the page.
     *
     *  hms-banner.js used to carry its own copy of these four lines: same
     *  id, same class, same parent. It worked, but two places had to stay
     *  in step, and nothing said so. One owner now; the banner asks.
     */
    function behaelter() {
        if (!stapel || !stapel.isConnected) start();
        return stapel;
    }

    window.NotificationStack = { ordne: anstossen, zeige, entferne, entferneSache,
                              holeOffene, behaelter };
})();
