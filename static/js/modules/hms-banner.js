// hms-banner.js -- the printer messages: ONE card per message.
//
// Why a module of its own: the node lived in _banners.html and was filled by
// socket-manager -- both exist only on the main page. Whoever went from
// there to the console lost the message. But it is the one thing that must
// not be missed anywhere.
//
// So building, drawing and dismissing live here. The main page calls it over
// the socket, the other pages through hms-overlay.js. Separate versions have
// already drifted apart at exactly this spot (socket against poll), so there
// is only one here.
(function (global) {
    'use strict';

    const KNOTEN = 'hms-error-banner';

    // Codes that ask the user something instead of just reporting.
    //
    // Both are the manual filament change: the printer pauses and waits
    // for an answer. Until now the message stood here and the answer sat
    // on the resume button elsewhere on the screen — one had to read in
    // one place and act in another.
    //
    // Tied to the phase AND the code on purpose. The phase alone would put
    // buttons under whatever message happens to show while the printer is
    // paused; the code alone would offer them after the pause is over.
    // Bambu marks 345 codes for the X2D as needing an action
    // (hms_action_20P.json in Bambu Studio), but that table does not say
    // WHICH command answers them — for these two we know it, from the
    // MQTT capture of 17apr26. Hence two, not 345.
    // The confirmation "has filament been extruded?" — six times, per nozzle
    // and AMS kind. Answer: ams_control done | resume, without a side reference.
    const BESTAETIGEN = ['07FF-8007', '07FE-8007', '18FF-8007', '18FE-8007',
                         '07FF-C00A', '07FE-C00A'];

    // Prompts to do something by hand ("pull the filament out",
    // "feed it into the PTFE tube"). Bambu's own action table
    // gives them action 9, and the printer display shows
    // "Resume" for it (hms_action_20P.json). The command behind it is
    // ams_control resume — measured 30aug26: 07FF-C003 stood for twelve
    // seconds, 1.3 s after the command it was gone.
    const FORTSETZEN = [
        '07FE-8002', '07FE-8003', '07FE-8004', '07FE-8005',
        '07FE-8006', '07FE-8010', '07FE-8025', '07FE-8030',
        '07FE-C003', '07FE-C006', '07FE-C008', '07FE-C009',
        '07FE-C010', '07FE-C030', '07FF-8002', '07FF-8003',
        '07FF-8004', '07FF-8005', '07FF-8006', '07FF-8010',
        '07FF-8017', '07FF-8025', '07FF-8030', '07FF-C003',
        '07FF-C006', '07FF-C008', '07FF-C009', '07FF-C010',
        '07FF-C030', '18FE-8004', '18FE-8005', '18FF-8003',
        '18FF-8004', '18FF-8005'];

    /**
     * Which buttons belong under which message.
     *
     * By CODE, not by phase. The phase only exists for the two
     * codes the server knows — `07FF-C003` for instance never has one, and
     * that is exactly why it stood there without a button on 30aug26 although the
     * Druckerdisplay "Fortsetzen" anbot.
     *
     * `phase` only stands where it is really needed: on loading
     * the M620 sequence goes out, and its slot numbers come from a
     * recording of a single-nozzle device. That one stays tied to the print.
     */
    function frageZu(code, phase) {
        const ist = function (liste) {
            return liste.some(function (c) { return gleich(c, code); });
        };
        if (ist(BESTAETIGEN)) {
            return [{ aktion: 'done',  text: 'filament_change_done', haupt: true },
                    { aktion: 'retry', text: 'filament_change_retry' }];
        }
        if (ist(FORTSETZEN)) {
            return [{ aktion: 'retry', text: 'filament_change_continue', haupt: true }];
        }
        if (phase === 1 && gleich('07FF-8003', code)) {
            return [{ aktion: 'load', text: 'filament_change_load', haupt: true }];
        }
        // Our own question after unloading: was the spool taken off the
        // holder? The answer goes to the server, not to the printer — the
        // reset lives in the route so every client takes the same way.
        if (gleich('SPULE-LINKS', code) || gleich('SPULE-RECHTS', code)) {
            return [{ aktion: 'reset', text: 'spool_prompt_reset', haupt: true,
                      ruf: 'spulenAntwort' },
                    { aktion: 'keep', text: 'spool_prompt_keep',
                      ruf: 'spulenAntwort' }];
        }
        return null;
    }

    /**
     * Draw the answer buttons, if this message is one that asks something.
     *
     * Returns silently when nothing matches — most messages just report.
     */
    function zeichneAktionen(el, daten, code) {
        const kasten = el.querySelector('#hms-error-actions');
        if (!kasten) return;

        const phase = (daten && daten.filament_change_phase) || 0;
        const frage = frageZu(code, phase);
        // Which function answers is on the button, not fixed: our own
        // questions do not go through the filament-change route.
        const ruferDa = (k) => typeof global[k.ruf || 'filamentChangeAction'] === 'function';
        const passt = !!frage && frage.every(ruferDa);

        // Only rebuild when something really changes.
        //
        // Before, the box was emptied and refilled on EVERY draw —
        // and it is drawn on every status push, so during a filament
        // run-out once a second. The buttons vanished under the
        // finger that way: mouse down on one element, up on its
        // successor, and a click never happens.
        // Reported 30aug26 — the buttons stood there and did nothing.
        const kennung = passt ? phase + ':' + String(code).toUpperCase() : '';
        if (kasten.dataset.stand === kennung) return;
        kasten.dataset.stand = kennung;
        kasten.innerHTML = '';
        if (!passt) return;

        const texte = global.texts || {};
        frage.forEach(function (k) {
            const b = document.createElement('button');
            b.className = k.haupt ? 'knopf knopf--primaer' : 'knopf';
            b.textContent = texte[k.text] || k.aktion;
            b.addEventListener('click', function () {
                // Locked while the call runs, free again afterwards.
                // Locking permanently was wrong: after "load again" the
                // printer asks the same thing once more, and then
                // "done — continue" has to work.
                const frei = function (an) {
                    Array.prototype.forEach.call(kasten.children, function (x) {
                        x.disabled = !an;
                    });
                };
                frei(false);
                let p;
                try { p = global[k.ruf || 'filamentChangeAction'](k.aktion, code); }
                catch (e) { frei(true); throw e; }
                if (p && typeof p.then === 'function') {
                    p.then(function () { frei(true); }, function () { frei(true); });
                } else {
                    frei(true);
                }
            });
            kasten.appendChild(b);
        });
    }

    /** The stack. On the main page it stands in the page, elsewhere not.
     *
     *  It belongs to notification-stack.js — that module also observes it and
     *  ranks what is in it. These four lines used to stand here a second
     *  time, identical: same id, same class, same parent. Two owners for one
     *  container, and nothing that would have caught them drifting apart.
     *
     *  The fallback stays for a page that loads this module without the
     *  stack: better an unranked card than none.
     */
    function stapel() {
        if (window.NotificationStack && window.NotificationStack.behaelter) {
            return window.NotificationStack.behaelter();
        }
        let s = document.getElementById('notification-stack');
        if (!s) {
            s = document.createElement('div');
            s.id = 'notification-stack';
            s.className = 'mld-stapel';
            document.body.appendChild(s);
        }
        return s;
    }

    //: This module builds at most this many cards. The stack shortens further
    //  by itself ("+N more"); this is only the barrier against a wave -- in a
    //  test 6092 codes were pending at once.
    const HOECHSTENS_KARTEN = 6;

    // Just dismissed here, with the server catching up. A bridge over the
    // second until the next state -- without it the card would stay after the
    // click.
    //
    // The key is the CASE id, not the code. The server deliberately lets the
    // same code through again as soon as it is a new case
    // (services/message_rules) -- keyed on the code, this bridge would
    // swallow exactly that and defeat the whole rebuild.
    const soebenWeggeklickt = new Set();

    function schluesselVon(fehler) {
        return String(fehler.message_id || fehler.code || '').toUpperCase();
    }

    const SYM_FEHLER =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 17H3z"/>' +
        '<path d="M12 10v4M12 17v.5"/></svg>';
    const SYM_HINWEIS =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/>' +
        '<path d="M12 11v5M12 8v.5"/></svg>';

    /**
     * The card for slot i. Built once and then only filled.
     *
     * Card 0 carries the old ids (`hms-error-banner` and the inner
     * `hms-error-*`): banner-test.js, app-init.js and app-bundle.js reach
     * for them. The others carry classes only -- two nodes with the same id
     * would be invalid, and getElementById would hit the wrong one.
     *
     * The close button carries data-bambu-only: Klipper knows no permanent
     * acknowledgement, and there the message disappears by itself as soon as
     * snap.error_message is empty again.
     */
    function knoten(i) {
        i = i || 0;
        const kennung = i === 0 ? KNOTEN : KNOTEN + '-' + i;
        let el = document.getElementById(kennung);
        if (el) return el;
        const ident = function (name) {
            return i === 0 ? ' id="hms-error-' + name + '"' : '';
        };
        el = document.createElement('div');
        el.id = kennung;
        el.className = 'mld mld--fehler';
        el.innerHTML =
            '<span class="mld-ic hms-b-ic"' + ident('icon') + '>' + SYM_FEHLER + '</span>' +
            '<div class="mld-t">' +
            '<div class="mld-titel hms-b-titel"' + ident('title') + '>HMS</div>' +
            '<div class="mld-detail hms-b-text"' + ident('message') + '>--</div>' +
            '<div class="mld-code hms-b-code"' + ident('code') + '></div>' +
            '<div class="mld-akt hms-b-akt"' + ident('actions') + '></div>' +
            '</div>' +
            '<button class="mld-zu hms-dismiss-btn" data-i18n-title="hms_dismiss" ' +
            'title="Ausblenden" data-bambu-only>&times;</button>';
        el.querySelector('.mld-zu').addEventListener('click', function () {
            wegklickenEinzeln(el.dataset.errorCode, el, el.dataset.messageId);
        });
        stapel().appendChild(el);
        return el;
    }

    /** Hide one card -- both classes, or the transition stays. */
    function verstecke(el) {
        el = el || document.getElementById(KNOTEN);
        if (!el) return;
        el.classList.remove('active', 'mld-an');
        // Clear the marker, otherwise the OLD buttons stay next time —
        // including their lock. That is exactly how "load again" worked
        // once on 30aug26 and afterwards "done — continue" was dead:
        // same code, so no rebuild, so both stayed locked.
        const kasten = el.querySelector('.hms-b-akt');
        if (kasten) delete kasten.dataset.stand;
        delete el.dataset.errorCode;
        delete el.dataset.messageId;
    }

    /** Hide everything from slot i on -- there are fewer messages now. */
    function versteckeAb(i) {
        for (let n = i; n < HOECHSTENS_KARTEN; n++) {
            const el = document.getElementById(n === 0 ? KNOTEN : KNOTEN + '-' + n);
            if (el) verstecke(el);
        }
    }

    /** Case does not count -- upper case, like Studio. */
    function gleich(a, b) {
        return String(a || '').toUpperCase() === String(b || '').toUpperCase();
    }

    // The last seen state. The main page hangs off the socket, and that only
    // sends on a CHANGE -- an error already pending at load time therefore
    // never arrives a second time. That is exactly how it vanished as soon as
    // one went to the user or settings page and back.
    let letzterZustand = null;

    /**
     * Set the message.
     *
     * @param {object} daten   state with hms_errors/hms_details.
     * @param {object} lage    { geladen, weggeklickt(code), aufraeumen() }
     */
    function zeichne(daten, lage) {
        lage = lage || {};
        if (daten) letzterZustand = daten;
        // Show nothing before the first reconciliation: otherwise a long
        // dismissed message flashes up until the acknowledgement list is there.
        if (lage.geladen === false) return;

        const alle = (daten && Array.isArray(daten.hms_details)) ? daten.hms_details : [];

        // Clear the bridge: whatever is no longer pending does not need it.
        // Over the case id, so a NEW case of the same code stays untouched.
        const anliegend = new Set(alle.map(schluesselVon));
        soebenWeggeklickt.forEach(function (k) {
            if (!anliegend.has(k)) soebenWeggeklickt.delete(k);
        });

        const offen = alle.filter(function (f) {
            if (soebenWeggeklickt.has(schluesselVon(f))) return false;
            return !(lage.weggeklickt && lage.weggeklickt(f.code));
        });

        if (!offen.length) {
            versteckeAb(0);
            if (daten && daten.hms_errors === 0 && lage.aufraeumen) lage.aufraeumen();
            return;
        }

        // One card per message, each with its own cross. Only
        // `hms_details[0]` used to stand here: with five messages pending one
        // was visible, and the cross acknowledged all five anyway -- four of
        // which nobody had ever read.
        const wieviel = Math.min(offen.length, HOECHSTENS_KARTEN);
        for (let i = 0; i < wieviel; i++) fuelle(knoten(i), offen[i], daten);
        versteckeAb(wieviel);
    }

    /** Fill one card with one message. */
    function fuelle(el, fehler, daten) {
        const texte = global.texts || {};
        const code = fehler.code;
        // A hint or a real error -- the grading comes from the server.
        const istHinweis = global.hmsIstHinweis ? global.hmsIstHinweis(fehler) : false;
        const istKlipper = code === 'klipper_error';

        el.querySelector('.hms-b-ic').innerHTML = istHinweis ? SYM_HINWEIS : SYM_FEHLER;
        // The heading carries the problem, not the code number -- that stands
        // small underneath.
        el.querySelector('.hms-b-titel').textContent = fehler.reason || '';
        el.querySelector('.hms-b-text').textContent = istKlipper
            ? (texte.hms_printer_error || 'Drucker-Fehler')
            : (istHinweis ? (texte.hms_printer_info || 'Drucker-Hinweis')
                          : (texte.hms_printer_fault || 'Drucker-Fehler'));
        el.querySelector('.hms-b-code').textContent = istKlipper ? '' : code;
        el.dataset.errorCode = code;
        el.dataset.messageId = fehler.message_id || '';
        el.classList.toggle('mld--info', istHinweis);
        el.classList.toggle('mld--fehler', !istHinweis);
        zeichneAktionen(el, daten, code);
        el.classList.add('active');
        // Showing belongs here, not in the stack: .active only makes the node
        // a flex box, and it becomes visible with .mld-an
        // (opacity/transform). notification-stack.js does that otherwise, but it
        // runs only on the main page -- on the console the message stood
        // invisible in the stack.
        requestAnimationFrame(function () { el.classList.add('mld-an'); });

        // If the push arrived before the state, the same message lies as a
        // copy in the stack above -- that one goes here.
        if (global.NotificationStack && global.NotificationStack.entferneSache) {
            global.NotificationStack.entferneSache(code);
        }
    }

    /**
     * Acknowledge one single message.
     *
     * The server resolves the code onto the open case and clears everything
     * else from there: other devices, the history and the printer itself
     * (clean_print_error, the dialog on the display closes).
     */
    function wegklickenEinzeln(code, el, kennung) {
        if (!code) return wegklicken();
        soebenWeggeklickt.add(String(kennung || code).toUpperCase());
        const csrf = sessionStorage.getItem('csrf_token')
            || localStorage.getItem('csrf_token');
        fetch('/api/hms/dismiss/' + encodeURIComponent(code), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
        })
            .then(a => a.json())
            .then(d => {
                if (!d.success) console.error('❌ Failed to dismiss HMS error:', d.error);
            })
            .catch(f => console.error('❌ Error dismissing HMS:', f));
        // Hide it at once, without waiting for the answer.
        if (el) verstecke(el);
    }

    /**
     * Acknowledge every pending message at once.
     *
     * No longer what the cross on a card does -- that acknowledges only its
     * own. This version stays for callers that really mean everything
     * (app-bundle.js, keyboard shortcuts).
     */
    function wegklicken() {
        const csrf = sessionStorage.getItem('csrf_token')
            || localStorage.getItem('csrf_token');
        fetch('/api/hms/dismiss-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
        })
            .then(a => a.json())
            .then(d => {
                if (d.success) {
                    console.log(`✅ ${d.dismissed_count} HMS error(s) dismissed:`,
                                d.dismissed_codes);
                } else {
                    console.error('❌ Failed to dismiss HMS errors:', d.error);
                }
            })
            .catch(f => console.error('❌ Error dismissing HMS:', f));
        // Hide it at once, without waiting for the answer.
        (letzterZustand && letzterZustand.hms_details || []).forEach(function (f) {
            soebenWeggeklickt.add(schluesselVon(f));
        });
        versteckeAb(0);
    }

    /**
     * Draw the same state once more.
     *
     * Needed as soon as the acknowledgement list arrives: until then `zeichne`
     * holds back (or dismissed things flash up), and without this follow-up it
     * would stay that way -- the next socket push only comes when something
     * CHANGES.
     */
    function nachziehen(lage) {
        if (letzterZustand) zeichne(letzterZustand, lage);
    }

    global.HmsBanner = { knoten, zeichne, nachziehen, wegklicken,
                         wegklickenEinzeln, gleich };
})(window);
