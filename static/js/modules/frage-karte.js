/* global module */
// frage-karte.js -- the open questions in the middle of the page, one after
// the other.
//
// Until 16sep26 the questions of the filament state came as a toast in the
// top right corner that went after twelve seconds, and as a row in the
// material card nobody looked at. The printer's own dialogs ("did filament
// come out?") stood in the message stack, also top right. User 16sep26: it
// all goes under. Design: docs/superpowers/specs/2026-09-16-frage-karte-design.md.
//
// One card, centred, not dimming the page. It collects what the page already
// has: the printer dialogs from `hms_details`, the questions of
// `filament_state`, and `prompts_later` -- the questions put off with
// "later" on any device. Order and ids are the same on Android and iOS.
//
// An answer goes to the server and ends the question on every device.
// "Later" goes to the server too; the card comes back as soon as a question
// is open that is not on that list.
(function (global) {
    'use strict';

    // Printer dialogs that wait for an answer (moved here from hms-banner.js).
    // "Did filament come out?" -- ams_control done | resume.
    const BESTAETIGEN = ['07FF-8007', '07FE-8007', '18FF-8007', '18FE-8007',
                         '07FF-C00A', '07FE-C00A'];
    // "Pull it out / feed it in" -- action 9 in Bambu's table, "Resume" on
    // the display, ams_control resume (measured 30aug26).
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

    // The printer first, then whether the roll is there at all, then which
    // spool it is, then the profile.
    const RANG = { drucker: 0, hms: 1, meldung: 2, mismatch: 3, spool_removed: 4,
                   which_spool: 5, confirm_profile: 6, power_off: 7 };
    //: The auto power-off has its own banner in the corner; the card would
    //: show the same countdown a second time. It is a question all the same,
    //: so "later" takes it off the screen and the messages page keeps it.
    const NUR_LISTE = { power_off: 1 };

    /**
     * The buttons a printer dialog gets -- or null when it asks nothing.
     * Phase 1 is checked first: 07FF-8003 is also in FORTSETZEN, and checked
     * after the lists "Load" was never offered (on all three surfaces).
     */
    // The kinds a question of the filament state can have -- the others in
    // RANG come from elsewhere.
    const STATE_KINDS = { spool_removed: 1, which_spool: 1, confirm_profile: 1 };

    /** Printer dialog, printer error, important message, the auto
     *  power-off: the orange "!". */
    function isWarning(f) {
        return f.art === 'drucker' || f.art === 'hms' || f.art === 'meldung'
            || f.art === 'power_off';
    }

    /** m:ss, the way the banner writes the countdown. */
    function restZeit(sekunden) {
        const rest = Math.max(0, Math.round(sekunden || 0));
        return Math.floor(rest / 60) + ':' + String(rest % 60).padStart(2, '0');
    }

    function druckerAktionen(code, phase) {
        const c = String(code || '').toUpperCase();
        if (phase === 1 && c === '07FF-8003') {
            return [{ aktion: 'load', text: 'filament_change_load', haupt: true }];
        }
        if (BESTAETIGEN.indexOf(c) >= 0) {
            return [{ aktion: 'retry', text: 'filament_change_retry' },
                    { aktion: 'done', text: 'filament_change_done', haupt: true }];
        }
        if (FORTSETZEN.indexOf(c) >= 0) {
            return [{ aktion: 'retry', text: 'filament_change_continue', haupt: true }];
        }
        return null;
    }

    /** The open questions, ordered: [{id, art, code?, text?, ort?, profil?, profilName?}]. */
    function fragenAus(status, block) {
        const out = [];
        const phase = (status && status.filament_change_phase) || 0;
        ((status && status.hms_details) || []).forEach(function (f) {
            const code = String((f && f.code) || '').toUpperCase();
            const id = 'printer|' + code;
            if (out.some(function (x) { return x.id === id; })) return;
            if (druckerAktionen(code, phase)) {
                out.push({ id: id, art: 'drucker', code: code, text: (f && f.reason) || code });
                return;
            }
            // A printer error that asks nothing: in the card as well, until
            // it is dismissed (18sep26: what matters goes to the middle). A
            // notice (is_info) stays in the corner; Klipper's own error has
            // no dismissal.
            if (!f || f.is_info === true || code === 'KLIPPER_ERROR') return;
            out.push({ id: id, art: 'hms', code: code, text: f.reason || code,
                       messageId: f.message_id || '' });
        });
        // The important messages (server: notification_log.WICHTIG) -- open
        // until one device deals with them.
        ((status && status.important_messages) || []).forEach(function (m) {
            if (!m || !m.id) return;
            out.push({ id: 'msg|' + m.id, art: 'meldung', titel: m.title || '', text: m.body || '',
                       message: m });
        });
        // A print's filament against its tray (services/print_mismatch):
        // open on the server until someone deals with it.
        // The auto power-off after a print: a question, because it waits
        // for an answer -- let it run, or cancel it.
        const timer = status && status.power_off_timer;
        if (timer && timer.active) {
            out.push({ id: 'power_off', art: 'power_off',
                       titel: t('power_off_in', 'Auto Power-Off in') + ' '
                              + restZeit(timer.remaining_seconds),
                       text: timer.reason || '' });
        }
        const mismatch = status && status.print_mismatch;
        if (mismatch && mismatch.id) {
            out.push({ id: 'mismatch|' + mismatch.id, art: 'mismatch', text: mismatch.text || '',
                       titel: mismatch.title || '', mismatch: mismatch });
        }
        const zustand = block || (status && status.filament_state) || null;
        ((zustand && zustand.questions) || []).forEach(function (q) {
            if (!q || !q.place || !(q.kind in STATE_KINDS)) return;
            out.push({ id: q.place + '|' + q.kind, art: q.kind, ort: q.place,
                       profil: q.profile || '', profilName: q.profile_name || '' });
        });
        out.sort(function (a, b) {
            return (RANG[a.art] - RANG[b.art]) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0));
        });
        return out;
    }

    /** Is there a question that was not put off? */
    function sichtbar(fragen, spaeter) {
        const weg = new Set(spaeter || []);
        return (fragen || []).some(function (f) { return !weg.has(f.id); });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { druckerAktionen, fragenAus, sichtbar };
        return;
    }

    // ------------------------------------------------------------------
    // The card
    // ------------------------------------------------------------------

    let letzterStatus = null;
    let block = null;
    let spaeter = [];
    let aktuell = null;          // id of the question shown
    let laeuft = false;
    // Answered here, the server's next state not there yet: hidden for ten
    // seconds so the same question does not flash up again.
    const erledigt = new Map();
    const ERLEDIGT_MS = 10000;
    // No wait of its own: a question shows when the server has it. The server
    // holds "which spool?" back while a roll is new (READ_GRACE_S in
    // services/filament_state.py) -- that covers the flash the card used to
    // wait 1.5 s for (16sep26), and the bell and the card show the question
    // at the same moment (18sep26: the bell 1-2 s before the card).
    let geoeffnetAusUrl = false;
    // The messages page shows the same questions as a list ("waiting for
    // you"). While it does, the floating card stays away: one page, one
    // place. Texts and buttons come from the same functions, so the list
    // and the card can never word the same question differently.
    let listenKnoten = null;

    // The home page sets `texts`; pages that load only the i18n manager
    // (the messages page) have them there.
    function texte() {
        return global.texts || (global.i18nManager && global.i18nManager.texts) || {};
    }
    function t(schluessel, ersatz) { return texte()[schluessel] || ersatz; }

    function stil() {
        if (document.getElementById('fk-stil')) return;
        const st = document.createElement('style');
        st.id = 'fk-stil';
        st.textContent = `
#frage-karte{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1050;
  width:min(380px,calc(100vw - 32px));background:var(--bg-card,#fff);color:var(--text-primary,#1d2530);
  border:1px solid var(--border-color,rgba(0,0,0,.08));border-radius:16px;
  box-shadow:0 18px 50px rgba(20,30,50,.28);overflow:hidden;font-size:14px;line-height:1.45}
#frage-karte[hidden]{display:none}
.fk-kopf{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;font-size:12px;
  color:var(--text-secondary,#6b7684);border-bottom:1px solid var(--border-color,rgba(0,0,0,.06))}
.fk-pfeil{border:0;background:none;color:var(--color-blue,#2196f3);font-size:18px;font-weight:700;
  cursor:pointer;padding:0 8px;line-height:1}
.fk-pfeil:disabled{opacity:.3;cursor:default}
.fk-inhalt{display:flex;gap:12px;padding:14px 16px 4px}
.fk-ic{width:30px;height:30px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;
  font-weight:800;color:#fff}
.fk-ic--drucker{background:var(--color-orange,#ff9800)}
.fk-ic--spule{background:var(--color-blue,#2196f3)}
.fk-titel{font-weight:700;font-size:15px}
.fk-detail{color:var(--text-secondary,#6b7684);font-size:12.5px;margin-top:3px;display:flex;gap:6px;align-items:center}
#frage-karte .fk-detail,.fk-liste .fk-detail{white-space:normal;overflow:visible;text-overflow:clip;align-items:baseline}
.fk-punkt{width:9px;height:9px;border-radius:50%;display:inline-block;border:1px solid rgba(128,128,128,.35);flex:none}
.fk-knoepfe{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:12px 16px 14px;flex-wrap:wrap}
.fk-k{padding:7px 13px;border-radius:9px;border:1px solid var(--border-color,#d6dbe2);
  background:var(--bg-card,#fff);color:inherit;font:inherit;font-weight:600;font-size:13px;cursor:pointer}
.fk-k--haupt{background:var(--color-blue,#2196f3);border-color:var(--color-blue,#2196f3);color:#fff}
.fk-k--leise{border-color:transparent;color:var(--text-secondary,#6b7684);margin-right:auto}
.fk-k:disabled{opacity:.55;cursor:default}
.fk-liste{display:flex;flex-direction:column;gap:10px}
.fk-eintrag{background:var(--bg-card,#fff);border:1px solid var(--border-color,rgba(0,0,0,.08));
  border-radius:12px;overflow:hidden}
.fk-eintrag .fk-inhalt{padding:14px 16px 4px}
.fk-eintrag .fk-knoepfe{padding:10px 16px 14px}
`;
        document.head.appendChild(st);
    }

    function knoten() {
        let el = document.getElementById('frage-karte');
        if (!el) {
            stil();
            el = document.createElement('div');
            el.id = 'frage-karte';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-live', 'polite');
            el.hidden = true;
            document.body.appendChild(el);
        }
        return el;
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** The place in words -- the same words as filament-state.js placeLabel. */
    function ortName(key) {
        if (global.filamentState && global.filamentState.placeLabel) {
            return global.filamentState.placeLabel(key);
        }
        const aussen = /^ext:(\d+)$/.exec(key || '');
        if (aussen) {
            const seite = aussen[1] === '254' ? t('spool_left', 'Links') : t('spool_right', 'Rechts');
            return t('fs_place_ext', 'Externe Spule {side}').replace('{side}', seite);
        }
        const m = /^ams:(\d+)\/(\d+)$/.exec(key || '');
        if (!m) return key || '';
        const einheit = ((block && block.units) || []).find(function (u) { return u.id === parseInt(m[1], 10); });
        return t('fs_place_slot', '{model} Fach {n}')
            .replace('{model}', (einheit && einheit.model) || 'AMS')
            .replace('{n}', parseInt(m[2], 10) + 1);
    }

    function ort(key) {
        return ((block && block.places) || []).find(function (p) { return p.key === key; }) || null;
    }

    function titelVon(f) {
        if (f.art === 'drucker' || f.art === 'hms') return f.text;
        if (f.art === 'meldung') return f.titel || f.text;
        if (f.art === 'mismatch') return f.titel || t('fk_title', 'Filament passt nicht');
        if (f.art === 'power_off') return f.titel;
        const name = ortName(f.ort);
        if (f.art === 'spool_removed') {
            return t('fs_removed_question', 'Filament ist draußen. {place} zurücksetzen?').replace('{place}', name);
        }
        if (f.art === 'confirm_profile') {
            return t('fs_proposal_question', 'Kein eigenes Profil für diese Spule – {name} einstellen?')
                .replace('{name}', f.profilName || f.profil);
        }
        const konflikt = ((block && block.conflicts) || []).find(function (k) { return k.place === f.ort; });
        if (konflikt) {
            return t('fs_conflict', 'Der Drucker meldet {printer}, die Spule ist {spool}.')
                .replace('{printer}', konflikt.printer).replace('{spool}', konflikt.spool);
        }
        // R15: a roll with a chip that no free Spoolman spool fits -- say so
        const frage = ((block && block.questions) || []).find(function (q) {
            return q.place === f.ort && q.kind === f.art;
        });
        if (frage && frage.reason === 'not_in_spoolman') {
            return t('fs_question_new_spool', 'Neue Spule in {place} erkannt – noch keiner Spoolman-Spule zugewiesen')
                .replace('{place}', name);
        }
        return t('fs_question', 'Welche Spule liegt in {place}?').replace('{place}', name);
    }

    /** The line under the title, and the colour dot in front of it. */
    function detailOf(f) {
        if (f.art === 'drucker') return { text: '', color: '' };
        if (f.art === 'hms') return { text: t('hms_printer_fault', 'Drucker-Fehler') + ' \u00b7 ' + f.code, color: '' };
        if (f.art === 'meldung') return { text: f.titel ? f.text : '', color: '' };
        if (f.art === 'power_off') return { text: f.text, color: '' };
        if (f.art === 'mismatch') {
            const wanted = (f.mismatch && f.mismatch.wanted) || {};
            return { text: f.text, color: String(wanted.color || '').replace('#', '') };
        }
        const c = (ort(f.ort) || {}).content || {};
        return { text: [ortName(f.ort), c.material].filter(Boolean).join(' \u00b7 '),
                 color: String(c.color || '') };
    }

    function knoepfeVon(f) {
        if (f.art === 'hms') {
            return [{ text: t('hms_dismiss', 'Ausblenden'), haupt: true, tun: function () { return dismissHms(f); } }];
        }
        if (f.art === 'meldung') {
            return [{ text: t('msg_close', 'Ausblenden'), haupt: true, tun: function () { return dismissMessage(f); } }];
        }
        if (f.art === 'mismatch') {
            return [{ text: t('fk_fits', 'Passt so'), tun: function () { return fitsAsIs(f); } },
                    { text: t('fk_open', 'Beheben'), haupt: true, tun: function () { return fixMismatch(f); } }];
        }
        if (f.art === 'power_off') {
            return [{ text: t('cancel', 'Abbrechen'), haupt: true,
                      tun: function () { return cancelPowerOff(f); } }];
        }
        if (f.art === 'drucker') {
            const phase = (letzterStatus && letzterStatus.filament_change_phase) || 0;
            return (druckerAktionen(f.code, phase) || []).map(function (a) {
                return { text: t(a.text, a.aktion), haupt: !!a.haupt, tun: function () { return druckerAntwort(a.aktion); } };
            });
        }
        if (f.art === 'spool_removed') {
            return [{ text: t('spool_prompt_keep', 'Behalten'), tun: function () { return abgenommen(f, false); } },
                    { text: t('spool_prompt_reset', 'Zurücksetzen'), haupt: true, tun: function () { return abgenommen(f, true); } }];
        }
        if (f.art === 'confirm_profile') {
            return [{ text: t('fs_proposal_skip', 'Nicht einstellen'), tun: function () { return vorschlag(f, false); } },
                    { text: t('fs_proposal_set_button', '{name} einstellen').replace('{name}', f.profilName || f.profil),
                      haupt: true, tun: function () { return vorschlag(f, true); } }];
        }
        return [{ text: t('fs_assign', 'Spule zuordnen'), haupt: true, tun: function () { return zuordnen(f); } }];
    }

    function offeneFragen() {
        const jetzt = Date.now();
        erledigt.forEach(function (wann, id) { if (jetzt - wann > ERLEDIGT_MS) erledigt.delete(id); });
        return fragenAus(letzterStatus, block).filter(function (f) { return !erledigt.has(f.id); });
    }

    /** Put the buttons of one question into a bar; both card and list use it. */
    function knoepfeBauen(leiste, knoepfe, neuZeichnen) {
        knoepfe.forEach(function (k) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'fk-k' + (k.haupt ? ' fk-k--haupt' : '') + (k.leise ? ' fk-k--leise' : '');
            b.textContent = k.text;
            b.disabled = laeuft;
            b.addEventListener('click', function () {
                if (laeuft) return;
                laeuft = true;
                neuZeichnen();
                Promise.resolve().then(k.tun).catch(function () { /* reported where it happened */ })
                    .then(function () { laeuft = false; neuZeichnen(); });
            });
            leiste.appendChild(b);
        });
    }

    /**
     * The same questions as a list -- for the messages page. "Later" is not
     * offered here: this IS the place you come to afterwards, and the ones
     * put off belong in it (they are still open).
     */
    function zeichneListe() {
        const el = listenKnoten;
        if (!el) return;
        const fragen = offeneFragen();
        const stand = fragen.map(function (f) { return f.id + ':' + titelVon(f); }).join('|') + '§' + laeuft;
        if (el.dataset.stand === stand) return;
        el.dataset.stand = stand;
        el.innerHTML = '';
        el.hidden = !fragen.length;
        if (typeof el.dataset.leerZiel === 'string') {
            const huelle = document.getElementById(el.dataset.leerZiel);
            if (huelle) huelle.hidden = !fragen.length;
        }
        fragen.forEach(function (f) {
            const drucker = isWarning(f);
            const d = detailOf(f);
            const detail = d.text;
            const punkt = d.color
                ? '<span class="fk-punkt" style="background:#' + esc(d.color.slice(0, 6)) + '"></span>' : '';
            const karte = document.createElement('div');
            karte.className = 'fk-eintrag';
            karte.innerHTML = '<div class="fk-inhalt"><div class="fk-ic '
                + (drucker ? 'fk-ic--drucker">!' : 'fk-ic--spule">?') + '</div>'
                + '<div><div class="fk-titel">' + esc(titelVon(f)) + '</div>'
                + (detail ? '<div class="fk-detail">' + punkt + esc(detail) + '</div>' : '')
                + '</div></div><div class="fk-knoepfe"></div>';
            knoepfeBauen(karte.querySelector('.fk-knoepfe'), knoepfeVon(f), function () {
                el.dataset.stand = '';
                zeichneListe();
            });
            el.appendChild(karte);
        });
    }

    function zeichne() {
        if (!document.body) return;
        zeichneListe();
        // The card leaves out what has a banner of its own.
        const fragen = offeneFragen().filter(function (f) { return !(f.art in NUR_LISTE); });
        const el = knoten();
        // On the page that lists them, the card would be the second answer
        // to the same question.
        if (listenKnoten) { el.hidden = true; el.dataset.stand = ''; return; }
        if (!fragen.length || !sichtbar(fragen, spaeter)) {
            el.hidden = true;
            el.dataset.stand = '';
            aktuell = null;
            return;
        }
        let pos = fragen.findIndex(function (f) { return f.id === aktuell; });
        if (pos < 0) pos = 0;
        const f = fragen[pos];
        aktuell = f.id;

        // Only rebuilt when something changes: the status comes every
        // second, and a button replaced under the finger never gets its
        // click (hms-banner.js, 30aug26).
        const titel = titelVon(f);
        const d = detailOf(f);
        const stand = [f.id, pos, fragen.length, titel, d.text, d.color, laeuft,
                       (global.texts && global.texts.prompt_later) || ''].join('§');
        if (el.dataset.stand === stand && !el.hidden) return;
        el.dataset.stand = stand;

        const drucker = isWarning(f);
        const detail = d.text;
        const punkt = d.color
            ? '<span class="fk-punkt" style="background:#' + esc(d.color.slice(0, 6)) + '"></span>' : '';
        const kopf = fragen.length > 1
            ? '<div class="fk-kopf"><span>' + esc(t('prompt_count', 'Frage {n} von {m}')
                .replace('{n}', pos + 1).replace('{m}', fragen.length)) + '</span><span>'
              + '<button type="button" class="fk-pfeil" data-schritt="-1"' + (pos === 0 ? ' disabled' : '') + '>‹</button>'
              + '<button type="button" class="fk-pfeil" data-schritt="1"' + (pos === fragen.length - 1 ? ' disabled' : '') + '>›</button>'
              + '</span></div>'
            : '';
        el.innerHTML = kopf
            + '<div class="fk-inhalt"><div class="fk-ic ' + (drucker ? 'fk-ic--drucker">!' : 'fk-ic--spule">?') + '</div>'
            + '<div><div class="fk-titel">' + esc(titel) + '</div>'
            + (detail ? '<div class="fk-detail">' + punkt + esc(detail) + '</div>' : '')
            + '</div></div><div class="fk-knoepfe"></div>';

        el.querySelectorAll('.fk-pfeil').forEach(function (b) {
            b.addEventListener('click', function () {
                const neu = fragen[pos + parseInt(b.dataset.schritt, 10)];
                if (neu) { aktuell = neu.id; zeichne(); }
            });
        });
        const leiste = el.querySelector('.fk-knoepfe');
        const alle = [{ text: t('prompt_later', 'Später'), leise: true, tun: function () { return spaeterTippen(fragen); } }]
            .concat(knoepfeVon(f));
        knoepfeBauen(leiste, alle, function () { el.dataset.stand = ''; zeichne(); });
        el.hidden = false;
    }

    // ------------------------------------------------------------------
    // The answers
    // ------------------------------------------------------------------

    function fehler(text) {
        if (global.skToast) global.skToast(text || t('connection_error', 'Verbindungsfehler'), 'error');
    }

    /** POST JSON; apiCall where the page has it (auth, CSRF), fetch otherwise. */
    function schicke(url, body) {
        const optionen = { method: 'POST', headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify(body) };
        if (typeof global.apiCall === 'function') {
            return global.apiCall(url, optionen).then(function (r) { return r.json(); });
        }
        const csrf = (global.sessionStorage && sessionStorage.getItem('csrf_token'))
            || (global.localStorage && localStorage.getItem('csrf_token')) || '';
        optionen.headers['X-CSRF-Token'] = csrf;
        optionen.credentials = 'include';
        return fetch(url, optionen).then(function (r) { return r.json(); });
    }

    function nachAntwort(f, d, meldung) {
        if (!d || !d.success) {
            fehler(d && d.error);
            throw new Error('refused');
        }
        erledigt.set(f.id, Date.now());
        if (d.filament_state) {
            block = d.filament_state;
            if (global.filamentState) global.filamentState.update(d.filament_state);
            if (global.printerControlManager && global.printerControlManager.renderMaterialZone) {
                global.printerControlManager.renderMaterialZone();
            }
        }
        if (meldung && d.message && global.skToast) global.skToast(d.message, 'success');
    }

    function druckerAntwort(aktion) {
        const f = fragenAus(letzterStatus, block).find(function (x) { return x.id === aktuell; });
        const weiter = function (d) {
            if (f && d && d.success !== false) erledigt.set(f.id, Date.now());
        };
        if (typeof global.filamentChangeAction === 'function') {
            return Promise.resolve(global.filamentChangeAction(aktion)).then(weiter);
        }
        return schicke('/api/mqtt/filament_change', { action: aktion }).then(function (d) {
            if (!d || !d.success) { fehler(d && d.error); throw new Error('refused'); }
            weiter(d);
        }, function () { fehler(); });
    }

    function abgenommen(f, ja) {
        return schicke('/api/filament/places/' + f.ort + '/removed', { removed: !!ja })
            .then(function (d) { nachAntwort(f, d, true); }, function () { fehler(); });
    }

    function vorschlag(f, ja) {
        return schicke('/api/filament/places/' + f.ort + '/profile', { accept: !!ja })
            .then(function (d) { nachAntwort(f, d, true); }, function () { fehler(); });
    }

    function zuordnen(f) {
        const pcm = global.printerControlManager;
        if (pcm && typeof pcm.frageBeantworten === 'function' && global.openSpoolPicker) {
            pcm.frageBeantworten(f.ort);
            return Promise.resolve();
        }
        // Another page: the picker lives on the main page, which opens it.
        global.location.href = '/?frage=' + encodeURIComponent(f.ort);
        return Promise.resolve();
    }

    /** A printer error: dismissed on the server -- every device, the history,
     *  and the printer's own dialog (hms-banner.js does the same). */
    function dismissHms(f) {
        if (global.HmsBanner && global.HmsBanner.wegklickenEinzeln) {
            global.HmsBanner.wegklickenEinzeln(f.code, null, f.messageId);
        }
        erledigt.set(f.id, Date.now());
        return Promise.resolve();
    }

    /** An important message: dealt with here = gone on every device. */
    function dismissMessage(f) {
        return schicke('/api/notifications/' + encodeURIComponent(f.message.id) + '/dismiss', {})
            .then(function () { erledigt.set(f.id, Date.now()); }, function () { fehler(); });
    }

    /** "Fix it": the dialog with the spools that could be in the tray. */
    function fixMismatch(f) {
        const pa = global.printActions;
        if (pa && typeof pa.zeigeFilamentKonflikt === 'function' && global.printerControlManager) {
            pa.zeigeFilamentKonflikt(f.mismatch, f.mismatch.filename || '');
            return Promise.resolve();
        }
        // Another page: the dialog lives on the main page, which opens it.
        global.location.href = '/?frage=mismatch';
        return Promise.resolve();
    }

    /** "Fits as it is": closes it for every device. */
    function fitsAsIs(f) {
        return schicke('/api/prompts/mismatch/fits', { id: f.mismatch.id }).then(function (d) {
            if (!d || !d.success) { fehler(d && d.error); return; }
            erledigt.set(f.id, Date.now());
        }, function () { fehler(); });
    }

    /** Let the printer stay on: the timer is cancelled for every device. */
    function cancelPowerOff(f) {
        return schicke('/api/cancel_power_off', {}).then(function (d) {
            if (d && d.success === false) { fehler(d && d.error); return; }
            erledigt.set(f.id, Date.now());
        }, function () { fehler(); });
    }

    function spaeterTippen(fragen) {
        const ids = fragen.map(function (f) { return f.id; });
        spaeter = ids;
        return schicke('/api/prompts/later', { ids: ids }).then(function (d) {
            if (d && d.success && Array.isArray(d.ids)) spaeter = d.ids;
            else fehler(d && d.error);
        }, function () { fehler(); });
    }

    /** Main page, reached from another page's "Assign spool": open the picker once. */
    function frageAusUrl() {
        if (geoeffnetAusUrl || !global.location || !global.URLSearchParams) return;
        const frage = new URLSearchParams(global.location.search).get('frage');
        const pcm = global.printerControlManager;
        if (frage === 'mismatch') {
            const offen = letzterStatus && letzterStatus.print_mismatch;
            if (!offen || !global.printActions || !global.printActions.zeigeFilamentKonflikt) return;
            geoeffnetAusUrl = true;
            try {
                const url = new URL(global.location.href);
                url.searchParams.delete('frage');
                global.history.replaceState(null, '', url.pathname + url.search + url.hash);
            } catch (e) { /* the dialog opens anyway */ }
            global.printActions.zeigeFilamentKonflikt(offen, offen.filename || '');
            return;
        }
        if (!frage || !block || !pcm || !global.openSpoolPicker) return;
        geoeffnetAusUrl = true;
        try {
            const url = new URL(global.location.href);
            url.searchParams.delete('frage');
            global.history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch (e) { /* the question opens anyway */ }
        pcm.frageBeantworten(frage);
    }

    global.FrageKarte = {
        druckerAktionen, fragenAus, sichtbar,
        /**
         * Draw the open questions into this element instead of the floating
         * card (messages page). `leerZiel` is the id of a wrapper that is
         * hidden along with the list when nothing is open.
         */
        liste: function (el, leerZiel) {
            listenKnoten = el || null;
            if (el && leerZiel) el.dataset.leerZiel = leerZiel;
            zeichne();
        },
        /** The full status (socket or /api/status). */
        status: function (daten) {
            if (!daten) return;
            letzterStatus = daten;
            if (daten.filament_state && Array.isArray(daten.filament_state.places)) block = daten.filament_state;
            if (Array.isArray(daten.prompts_later)) spaeter = daten.prompts_later;
            zeichne();
            frageAusUrl();
        },
        /** The socket event filament_state. */
        zustand: function (neu) {
            if (neu && Array.isArray(neu.places)) block = neu;
            zeichne();
            frageAusUrl();
        },
        /** The socket event print_mismatch: {mismatch: {...} | null}. */
        mismatch: function (next) {
            if (!letzterStatus) letzterStatus = {};
            letzterStatus = Object.assign({}, letzterStatus, { print_mismatch: next || null });
            zeichne();
        },
        /** Put ONE question off from outside the card -- the auto power-off
         *  banner does that with its own "later" button. */
        putOff: function (id) {
            if (!id) return Promise.resolve();
            if (spaeter.indexOf(id) >= 0) return Promise.resolve();
            spaeter = spaeter.concat([id]);
            zeichne();
            return schicke('/api/prompts/later', { ids: spaeter }).then(function (d) {
                if (d && d.success && Array.isArray(d.ids)) spaeter = d.ids;
                zeichne();
            }, function () { fehler(); });
        },
        /** Has this question been put off? The banner asks before it shows. */
        isPutOff: function (id) { return spaeter.indexOf(id) >= 0; },
        /** The socket event prompts_later. */
        spaeterListe: function (ids) {
            if (Array.isArray(ids)) spaeter = ids;
            zeichne();
        },
    };
})(typeof window !== 'undefined' ? window : globalThis);
