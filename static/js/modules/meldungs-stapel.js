// meldungs-stapel.js — Reihenfolge und Kuerzung der Drucker-Meldungen.
//
// Die sechs Meldungen liegen als feste DOM-Knoten in _banners.html und werden
// weiterhin von ihren jeweiligen Modulen ueber classList.add('active')
// geschaltet — hier wird nichts umgeleitet und keine Aufrufstelle angefasst.
// Dieses Modul kuemmert sich nur um das, was erst durch den Stapel noetig
// wird:
//
//   * Einblenden mit Uebergang (die .active-Klasse allein wuerde springen),
//   * Reihenfolge: Dringendes oben, laufende Zustaende unten,
//   * "+N weitere", wenn mehr als drei Meldungen gleichzeitig anliegen.
//
// Zustaende (.mld--zustand) werden dabei NIE gekuerzt: was der Drucker gerade
// tut, darf nicht hinter einer Sammelzeile verschwinden.
(function () {
    'use strict';

    // Sichtbare Meldungen, danach wird gezaehlt. Am Schreibtisch ist Platz
    // fuer fuenf uebereinander — am Telefon nicht, dort sitzt der Stapel
    // unten ueber der Seite und wuerde die unterste Karte begraben. Dieselbe
    // Grenze wie im CSS und wie in Android (SCHMAL_DP).
    function hoechstens() {
        return (window.innerWidth || 0) > 600 ? 5 : 3;
    }
    // Dringendes zuerst. Zustaende haben absichtlich den hoechsten Wert und
    // rutschen damit ans Ende des Stapels.
    const RANG = { 'mld--fehler': 0, 'mld--warnung': 1, 'mld--info': 2, 'mld--laeuft': 3 };

    let stapel = null;
    let aufgeklappt = false;
    let wache = null;
    let zuwachs = null;
    let geplant = false;

    // Wohin der Benutzer den Stapel geschoben hat — nur fuer diese Sitzung.
    //
    // Meldungen sollen IMMER an derselben Stelle ankommen, sonst sucht man
    // sie. Manchmal liegt der Stapel aber genau auf dem Knopf, den man
    // gerade braucht. Also: beiseiteschieben ja, merken nein. Reine
    // Modulvariable, kein localStorage — beim naechsten Laden steht er
    // wieder, wo er hingehoert. Dieselbe Regel wie in Android
    // (MeldungsVerschiebung).
    let schubX = 0;
    let schubY = 0;
    let griff = null;

    function setzeSchub() {
        if (!stapel) return;
        stapel.style.transform = (schubX || schubY)
            ? `translate(${schubX}px, ${schubY}px)` : '';
    }

    /** Der Griff. Zieht sofort — kein Halten, keine Verwechslung mit dem X. */
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
            // Nur so weit, dass der Stapel im Bild bleibt — sonst schiebt
            // man ihn hinaus und findet ihn bis zum Neuladen nicht wieder.
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

    /** Griff nur zeigen, wenn auch etwas dasteht. */
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

    // Der Beobachter wird waehrend des Umbaus abgeschaltet. classList.remove()
    // schreibt das class-Attribut auch dann neu, wenn die Klasse gar nicht
    // gesetzt war — der Beobachter loeste sich damit selbst wieder aus und die
    // Seite fror ein. Zusaetzlich wird pro Bild nur einmal umgebaut.
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

    function baueAuf() {
        const alle = [...stapel.querySelectorAll('.mld:not(.mld-sammel)')];
        // Der Griff ist keine Meldung: er traegt kein .mld und faellt
        // deshalb hier gar nicht erst an. Er wird nur ein- und ausgeblendet.
        const offen = alle.filter(el => el.classList.contains('active'));

        // Eingeblendete bekommen den Uebergang erst im naechsten Bild, sonst
        // springt der Kasten ohne Bewegung ins Bild.
        alle.forEach(el => {
            const auf = el.classList.contains('active');
            const an = el.classList.contains('mld-an');
            if (auf && !an) requestAnimationFrame(() => el.classList.add('mld-an'));
            else if (!auf && an) el.classList.remove('mld-an');
        });

        // Only move what really has to go somewhere else. `appendChild` on
        // a node that already sits right takes it out anyway
        // and re-inserts it — with everything attached to it.
        const sortiert = offen.sort((a, b) => rangVon(a) - rangVon(b));
        sortiert.forEach((el, i) => {
            if (stapel.children[i] !== el) stapel.appendChild(el);
        });

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
            // Vor den Zustaenden: die bleiben immer als letzte stehen.
            stapel.insertBefore(s, zustaende[0] || null);
        }
        if (rest <= 0) aufgeklappt = false;
        griffPflegen(offen.length);
        setzeSchub();
    }

    function beobachte() {
        if (!wache || !stapel) return;
        stapel.querySelectorAll('.mld:not(.mld-sammel)').forEach(el =>
            wache.observe(el, { attributes: true, attributeFilter: ['class'] }));
    }

    // Nicht alle Meldungen stehen von Anfang an in der Seite: die
    // Drucker-Meldung baut sich selbst ein, sobald es etwas zu melden gibt
    // (hms-banner.js). Ohne diesen Beobachter blieb sie ausserhalb von Rang
    // und Kuerzung — der Stapel zaehlte sie nicht mit.
    function beobachteZuwachs() {
        if (!stapel) return;
        if (!zuwachs) {
            zuwachs = new MutationObserver(() => { beobachte(); anstossen(); });
        }
        zuwachs.observe(stapel, { childList: true });
    }

    function start() {
        stapel = document.getElementById('meldungs-stapel');
        if (!stapel) return;
        // Die Module setzen/entfernen nur die Klasse 'active' — der Beobachter
        // laeuft danach EINMAL pro Aenderung, statt in jedem Modul einen
        // Aufruf zu ergaenzen (und beim naechsten Modul zu vergessen).
        wache = new MutationObserver(anstossen);
        beobachte();
        beobachteZuwachs();
        ordne();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    // ---------------------------------------------------------------
    // Meldungen zur Laufzeit — fuer Push-Nachrichten
    // ---------------------------------------------------------------
    // Die sechs festen Knoten oben gehoeren je einem Zweck. Eine
    // Push-Meldung hat keinen: Titel und Text stehen erst beim Eintreffen
    // fest. Bis 27aug26 gab es dafuer gar nichts — in der Electron-App
    // erschien deshalb das alte Popup ausserhalb der Oberflaeche, waehrend
    // HMS und Systemhinweise laengst hier oben rechts liefen.
    //
    // Erzeugt wird derselbe Aufbau wie in _banners.html, damit Rang,
    // Kuerzung und Uebergang ohne Sonderweg greifen.
    const ART_KLASSE = {
        error: 'mld--fehler', hms_error: 'mld--fehler', print_failed: 'mld--fehler',
        warning: 'mld--warnung', filament: 'mld--warnung',
    };
    const SYMBOL = {
        'mld--fehler': '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17v.5"/>',
        'mld--warnung': '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17v.5"/>',
        'mld--info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
    };
    //: So lange bleibt eine Push-Meldung stehen. Fehler bleiben, bis der
    //: Benutzer sie wegklickt — sie koennen einen Druck betreffen.
    // Frueher die Stehzeit einer Meldung. Seit 28aug26 bleiben sie stehen,
    // bis jemand sie wegklickt — siehe zeige(). Bewusst nicht geloescht,
    // damit die Zahl nicht als "war nie da" gilt, falls doch mal etwas
    // Selbstausblendendes in diesen Stapel soll.
    const STEHZEIT_MS = 12000;   // ungenutzt

    // Push-Kopien von Meldungen, die die Seite laengst als festen Knoten
    // zeigt. Der Server schickt HMS-Fehler zusaetzlich als Push; im Browser
    // landet der als System-Meldung ausserhalb der Seite, in Electron seit
    // 27aug26 aber in genau diesem Stapel. Dann stand dieselbe Sache zweimal
    // untereinander: "AMS-HT A: Eine Frontabdeckung ist offen" als
    // Zustandsknoten und daruntergesetzt als "Druckerfehler" (gesehen
    // 27aug26).
    //
    // Zur Zeit hat NUR hms_error einen festen Zwilling. filament_drying geht
    // data_only raus und erreicht die Oberflaeche nie, und power_event meint
    // das Schalten der Steckdose, nicht den Auto-Aus-Countdown im Banner —
    // beide gehoeren deshalb nicht hierher. Ein neuer Zwilling ist eine Zeile.
    const FESTER_KNOTEN = {
        hms_error: { id: 'hms-error-banner', schluessel: 'errorCode' },
    };

    /** Zeigt ein fester Knoten dieselbe Sache schon an? */
    function schonAmSchirm(meldung) {
        const eintrag = FESTER_KNOTEN[meldung.art];
        if (!eintrag) return false;
        const el = document.getElementById(eintrag.id);
        if (!el || !el.classList.contains('active')) return false;
        // Ohne Kennzeichen genuegt "der Knoten steht". Mit Kennzeichen muss es
        // dieselbe Sache sein — sonst verschluckt ein stehender Banner die
        // Meldung ueber einen ZWEITEN, anderen Fehler.
        if (!eintrag.schluessel || !meldung.sache) return true;
        return String(el.dataset[eintrag.schluessel] || '') === String(meldung.sache);
    }

    function zeige(meldung) {
        if (!stapel || !meldung) return null;
        if (schonAmSchirm(meldung)) {
            console.log('⏭️ Push copy discarded, already shown as a banner:', meldung.titel);
            return null;
        }
        const klasse = ART_KLASSE[meldung.art] || 'mld--info';
        const knoten = document.createElement('div');
        knoten.className = 'mld ' + klasse;
        if (meldung.kennung) knoten.dataset.kennung = meldung.kennung;
        // Worum es geht (HMS-Code) — daran erkennt entferneSache die Kopie.
        if (meldung.sache) knoten.dataset.sache = String(meldung.sache);

        const zu = (window.texts && window.texts.mld_schliessen) || 'Ausblenden';
        knoten.innerHTML =
            '<span class="mld-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            SYMBOL[klasse] + '</svg></span>' +
            '<div class="mld-t"><div class="mld-titel"></div>' +
            '<div class="mld-detail"></div></div>' +
            '<button class="mld-zu" type="button" title="' + zu + '">&times;</button>';
        // Titel und Text als Text setzen, nicht als HTML: sie kommen vom
        // Server und koennen Dateinamen enthalten.
        knoten.querySelector('.mld-titel').textContent = meldung.titel || '';
        knoten.querySelector('.mld-detail').textContent = meldung.text || '';
        knoten.querySelector('.mld-zu').addEventListener('click', () => {
            meldeWeggeklickt(meldung.kennung);
            nimmWeg(knoten);
        });

        stapel.appendChild(knoten);
        // Einblenden erst im naechsten Bild, sonst springt der Kasten ins
        // Bild statt hereinzuziehen — dieselbe Regel wie in baueAuf().
        requestAnimationFrame(() => { knoten.classList.add('active'); anstossen(); });

        // KEIN Selbstausblenden. In diesen Stapel kommt ausschliesslich, was
        // ueber FCM hereinkam (electron-app/push-receiver-init.js ist der
        // einzige Aufrufer) — und eine Push-Nachricht verschwindet nicht von
        // allein. Am Handy wartet dieselbe Meldung im Mitteilungsfeld, bis
        // jemand sie wegwischt; hier stand sie bis 28aug26 zwoelf Sekunden
        // und war dann spurlos weg, wenn man gerade nicht hinsah (an
        // "25% erreicht" gemerkt).
        //
        // Der Stapel waechst dadurch nicht ueber den Schirm: ab HOECHSTENS
        // klappt baueAuf() den Rest zu "+N weitere Meldungen" zusammen.
        return knoten;
    }

    // Wegklicken dem Server melden — sonst gilt die Meldung dort weiter als
    // offen, und Handy und iOS zeigen sie unveraendert an. Das alte Popup tat
    // das beim Schliessen (markNotificationOnServer); beim Umzug in die
    // Oberflaeche waere es sonst ersatzlos verschwunden.
    //
    // Nur beim Klick auf das Kreuz, NICHT wenn die Meldung nach ihrer
    // Stehzeit von selbst geht: von allein verschwinden heisst nicht, dass
    // jemand sie gesehen und erledigt hat.
    function meldeWeggeklickt(kennung) {
        if (!kennung) return;
        const ruf = window.apiCall
            || ((url, opt) => fetch(url, Object.assign({ credentials: 'include' }, opt)));
        ruf('/api/notifications/' + encodeURIComponent(kennung) + '/dismiss',
            { method: 'POST' }).catch(() => {});
    }

    function nimmWeg(knoten) {
        if (!knoten || !knoten.parentNode) return;
        knoten.classList.remove('mld-an');
        // Erst nach dem Ausblenden entfernen, sonst verschwindet der Kasten
        // schlagartig; 0.18s ist die Dauer aus components.css.
        setTimeout(() => { knoten.remove(); anstossen(); }, 200);
    }

    /** Eine Meldung zu dieser Kennung wieder wegnehmen (anderswo weggeklickt). */
    function entferne(kennung) {
        if (!stapel || !kennung) return;
        stapel.querySelectorAll('.mld[data-kennung]').forEach(el => {
            if (el.dataset.kennung === kennung) nimmWeg(el);
        });
    }

    /**
     * Push-Kopien zu dieser Sache wegnehmen — der feste Knoten hat sie
     * uebernommen. Die Gegenrichtung zu schonAmSchirm: kommt der Push VOR dem
     * Status (der Banner haengt am Poll bzw. am Socket), steht die Kopie
     * schon, wenn der Knoten aufgeht. Ohne das waere die Doppelung nur
     * umgedreht statt weg.
     */
    function entferneSache(sache) {
        if (!sache) return;
        if (stapel) {
            stapel.querySelectorAll('.mld[data-sache]').forEach(el => {
                if (el.dataset.sache === String(sache)) nimmWeg(el);
            });
        }
        // Und dasselbe ausserhalb der Oberflaeche: war die App zu, als der
        // Fehler kam, wurde daraus ein Popup neben dem Fenster. Beim Aufmachen
        // stand es dann neben dem Zustandsknoten, der dasselbe sagt.
        try {
            if (window.electronAPI && window.electronAPI.schliesseMeldungFuerSache) {
                window.electronAPI.schliesseMeldungFuerSache(String(sache));
            }
        } catch (_) {}
    }

    window.MeldungsStapel = { ordne: anstossen, zeige, entferne, entferneSache };
})();
