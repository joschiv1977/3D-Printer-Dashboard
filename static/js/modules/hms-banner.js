// hms-banner.js — die Drucker-Meldungen: EINE Karte je Meldung.
//
// Warum eigenes Modul: der Knoten lag in _banners.html und wurde von
// socket-manager gefuellt — beides gibt es nur auf der Hauptseite. Wer von
// dort auf die Konsole ging, verlor die Meldung (gemeldet 29aug26). Sie ist
// aber das Einzige, was man nirgends verpassen darf.
//
// Also: Aufbau, Zeichnen und Wegklicken wohnen hier. Die Hauptseite ruft es
// ueber den Socket, die uebrigen Seiten ueber hms-overlay.js. Getrennte
// Fassungen sind an genau dieser Stelle schon einmal auseinandergelaufen
// (20aug26, Socket gegen Poll) — deshalb hier nur eine.
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

    /** Der Stapel. Auf der Hauptseite steht er in der Seite, sonst nicht. */
    function stapel() {
        let s = document.getElementById('meldungs-stapel');
        if (!s) {
            s = document.createElement('div');
            s.id = 'meldungs-stapel';
            s.className = 'mld-stapel';
            document.body.appendChild(s);
        }
        return s;
    }

    //: Hoechstens so viele Karten baut dieses Modul. Der Stapel kuerzt
    //  selbst weiter ("+N weitere"); das hier ist nur die Schranke gegen
    //  eine Welle — im Test vom 31aug26 lagen 6092 Codes gleichzeitig an.
    const HOECHSTENS_KARTEN = 6;

    // Gerade hier weggeklickt, der Server zieht nach. Eine Bruecke ueber die
    // Sekunde bis zum naechsten Zustand — ohne sie stuende die Karte nach dem
    // Klick weiter da.
    //
    // Der Schluessel ist die VORGANGS-Kennung, nicht der Code. Der Server
    // laesst denselben Code bewusst wieder durch, sobald er ein neuer Vorgang
    // ist (services/message_rules) — auf den Code gemerkt wuerde diese
    // Bruecke genau das verschlucken und den ganzen Umbau aushebeln.
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
     * Die Karte fuer Platz i. Wird einmal gebaut und dann nur noch gefuellt.
     *
     * Karte 0 traegt die alten Kennungen (`hms-error-banner` und die inneren
     * `hms-error-*`): banner-probe.js, app-init.js und app-bundle.js greifen
     * darauf zu. Die weiteren tragen nur Klassen — zwei Knoten mit derselben
     * id waeren ungueltig, und getElementById traefe den falschen.
     *
     * Der Schliessen-Knopf traegt data-bambu-only: Klipper kennt keine
     * dauerhafte Quittung, dort verschwindet die Meldung von selbst, sobald
     * snap.error_message wieder leer ist.
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

    /** Eine Karte ausblenden — beide Klassen, sonst bleibt der Uebergang stehen. */
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

    /** Alles ab Platz i ausblenden — die Meldungen sind weniger geworden. */
    function versteckeAb(i) {
        for (let n = i; n < HOECHSTENS_KARTEN; n++) {
            const el = document.getElementById(n === 0 ? KNOTEN : KNOTEN + '-' + n);
            if (el) verstecke(el);
        }
    }

    /** Gross/klein zaehlt nicht — bis 28aug26 klein, seither gross wie Studio. */
    function gleich(a, b) {
        return String(a || '').toUpperCase() === String(b || '').toUpperCase();
    }

    // Der zuletzt gesehene Zustand. Die Hauptseite haengt am Socket, und der
    // schickt nur bei AENDERUNG — ein Fehler, der beim Laden schon anstand,
    // kommt also kein zweites Mal. Genau daran ist er verschwunden, sobald man
    // einmal auf Benutzer oder Einstellungen und zurueck ging.
    let letzterZustand = null;

    /**
     * Meldung setzen.
     *
     * @param {object} daten   Zustand mit hms_errors/hms_details.
     * @param {object} lage    { geladen, weggeklickt(code), aufraeumen() }
     */
    function zeichne(daten, lage) {
        lage = lage || {};
        if (daten) letzterZustand = daten;
        // Vor dem ersten Abgleich nichts zeigen: sonst blitzt eine laengst
        // weggeklickte Meldung auf, bis die Quittungsliste da ist.
        if (lage.geladen === false) return;

        const alle = (daten && Array.isArray(daten.hms_details)) ? daten.hms_details : [];

        // Die Bruecke aufraeumen: was nicht mehr anliegt, braucht sie nicht
        // mehr. Ueber die Vorgangs-Kennung, also bleibt ein NEUER Vorgang
        // desselben Codes davon unberuehrt.
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

        // Eine Karte je Meldung, jede mit eigenem Kreuz. Bis 31aug26 stand
        // hier nur `hms_details[0]`: lagen fuenf Meldungen an, sah man eine,
        // und das Kreuz quittierte trotzdem alle fuenf — vier davon hatte
        // niemand je gelesen.
        const wieviel = Math.min(offen.length, HOECHSTENS_KARTEN);
        for (let i = 0; i < wieviel; i++) fuelle(knoten(i), offen[i], daten);
        versteckeAb(wieviel);
    }

    /** Eine Karte mit einer Meldung fuellen. */
    function fuelle(el, fehler, daten) {
        const texte = global.texts || {};
        const code = fehler.code;
        // Hinweis oder echter Fehler — die Einstufung kommt vom Server mit.
        const istHinweis = global.hmsIstHinweis ? global.hmsIstHinweis(fehler) : false;
        const istKlipper = code === 'klipper_error';

        el.querySelector('.hms-b-ic').innerHTML = istHinweis ? SYM_HINWEIS : SYM_FEHLER;
        // Die Ueberschrift traegt das Problem, nicht die Codenummer — die
        // steht klein darunter.
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
        // Einblenden gehoert hierher, nicht in den Stapel: .active macht den
        // Knoten nur zu einem flex-Kasten, sichtbar wird er erst mit
        // .mld-an (opacity/transform). meldungs-stapel.js besorgt das sonst,
        // laeuft aber nur auf der Hauptseite — auf der Konsole stand die
        // Meldung damit unsichtbar im Stapel.
        requestAnimationFrame(function () { el.classList.add('mld-an'); });

        // Kam der Push frueher an als der Zustand, liegt dieselbe Meldung als
        // Kopie im Stapel darueber — die geht hier weg.
        if (global.MeldungsStapel && global.MeldungsStapel.entferneSache) {
            global.MeldungsStapel.entferneSache(code);
        }
    }

    /**
     * Eine einzelne Meldung quittieren.
     *
     * Der Server loest den Code auf den offenen Vorgang auf und raeumt von
     * dort aus alles weitere ab: andere Geraete, Historie und der Drucker
     * selbst (clean_print_error, Dialog am Display zu).
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
        // Sofort ausblenden, ohne auf die Antwort zu warten.
        if (el) verstecke(el);
    }

    /**
     * Alle anstehenden Meldungen auf einmal quittieren.
     *
     * Seit 31aug26 nicht mehr das, was das Kreuz an einer Karte tut — das
     * quittiert nur seine eigene. Diese Fassung bleibt fuer Aufrufer, die
     * wirklich alles meinen (app-bundle.js, Tastenkuerzel).
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
        // Sofort ausblenden, ohne auf die Antwort zu warten.
        (letzterZustand && letzterZustand.hms_details || []).forEach(function (f) {
            soebenWeggeklickt.add(schluesselVon(f));
        });
        versteckeAb(0);
    }

    /**
     * Denselben Zustand noch einmal zeichnen.
     *
     * Gebraucht, sobald die Quittungsliste nachkommt: bis dahin haelt sich
     * `zeichne` zurueck (sonst blitzt Weggeklicktes auf), und ohne diesen
     * Nachzug bliebe es dabei — der naechste Socket-Push kommt erst, wenn
     * sich etwas AENDERT.
     */
    function nachziehen(lage) {
        if (letzterZustand) zeichne(letzterZustand, lage);
    }

    global.HmsBanner = { knoten, zeichne, nachziehen, wegklicken,
                         wegklickenEinzeln, gleich };
})(window);
