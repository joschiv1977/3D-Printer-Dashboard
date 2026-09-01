/**
 * Feuchte-Gedaechtnis des AMS.
 *
 * Der Momentwert steht im Status und wird ueberall angezeigt. Die Frage vor
 * einem Druck ist aber, wie lange eine Spule feucht LAG — dafuer liefert der
 * Server unter /api/filament/feuchte den Verlauf je Einheit und ein Urteil je
 * Fach. Dieses Modul holt das einmal, haelt es kurz und zeichnet daraus die
 * Kurve und die Merkzeile.
 */
(function () {
    'use strict';

    const GUELTIG_MS = 60000;      // so lange gilt eine Antwort als frisch
    let stand = null, geholt = 0, laufend = null;

    const t = (key, ersatz) => ((window.texts || {})[key] || ersatz);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /** Holt den Stand; mehrfache Aufrufe im selben Moment teilen eine Anfrage. */
    async function hole(tage) {
        const jetzt = Date.now();
        if (stand && (jetzt - geholt) < GUELTIG_MS) return stand;
        if (laufend) return laufend;
        laufend = (async () => {
            try {
                const antwort = await window.apiCall(
                    '/api/filament/feuchte?tage=' + (tage || 14));
                const daten = await antwort.json();
                if (daten && daten.success) { stand = daten; geholt = Date.now(); }
                return stand;
            } catch (e) {
                return stand;
            } finally { laufend = null; }
        })();
        return laufend;
    }

    /** Nach einer Trocknung ist der alte Stand hinfaellig. */
    function vergiss() { stand = null; geholt = 0; }

    function fuerFach(daten, amsId, slot) {
        return ((daten && daten.spulen) || []).find(
            s => s.ams_id === amsId && s.slot === slot) || null;
    }

    function einheit(daten, amsId) {
        return ((daten && daten.einheiten) || []).find(e => e.id === amsId) || null;
    }

    /** Wie viel Zeit die Messreihe wirklich abdeckt — als Text. */
    function spanne(verlauf) {
        const p = (verlauf || []).filter(x => x.feuchte != null);
        if (p.length < 2) return { ms: 0, text: '' };
        const zeit = x => new Date(String(x.zeit).replace(' ', 'T')).getTime();
        const t0 = zeit(p[0]), t1 = zeit(p[p.length - 1]);
        const ms = Math.max(t1 - t0, 0);
        const stunden = ms / 3600000;
        // Die Ueberschrift sagte bisher immer "letzte 14 Tage" — auch wenn
        // fuenf Minuten Messwerte dahinter lagen. Sie nennt jetzt, was
        // wirklich drin ist.
        // Einheit so waehlen, dass die Zahl immer >= 2 ist — sonst stuende da
        // "letzte 1 Stunden". Einzahlformen fuer fuenf Sprachen waeren zehn
        // weitere Zeichenketten fuer einen Fall, den es so nicht gibt.
        const text = stunden >= 48
            ? t('feuchte_spanne_tage', 'letzte {n} Tage').replace('{n}', Math.round(stunden / 24))
            : (stunden >= 2
                ? t('feuchte_spanne_stunden', 'letzte {n} Stunden').replace('{n}', Math.round(stunden))
                : t('feuchte_spanne_minuten', 'letzte {n} Minuten').replace('{n}', Math.max(2, Math.round(ms / 60000))));
        return { ms, text, von: t0, bis: t1 };
    }

    let lfdNr = 0;

    /** Die Flaeche unter der Kurve — je Liegezeit ein geschlossener Zug. */
    function flaeche(punkte, x, y, h) {
        const stuecke = [];
        let lauf = [];
        punkte.forEach((p, i) => {
            if (i && p.luecke) { stuecke.push(lauf); lauf = []; }
            lauf.push(p);
        });
        stuecke.push(lauf);
        return stuecke.filter(st => st.length > 1).map(st =>
            st.map((p, i) => (i ? 'L' : 'M') + x(p).toFixed(1) + ' ' + y(p.feuchte).toFixed(1)).join(' ')
            + ` L${x(st[st.length - 1]).toFixed(1)} ${h} L${x(st[0]).toFixed(1)} ${h} Z`).join(' ');
    }

    /**
     * Der Verlauf als Kurve.
     *
     * Gefuellt wird NUR ueber der Grenze und in Rot: eine Flaeche vom Wert
     * bis zum Boden sah bei jeder ruhigen Spule gleich aus — ein halb
     * blauer Kasten, der nichts sagte. So bleiben von einer trockenen Spule
     * eine flache Linie und von einer nassen rote Berge uebrig.
     */
    function kurve(verlauf, schwelle, breite, hoehe) {
        const punkte = (verlauf || []).filter(p => p.feuchte != null);
        if (punkte.length < 2) return '';
        const b = breite || 260, h = hoehe || 46;
        const zeit = p => new Date(String(p.zeit).replace(' ', 'T')).getTime();
        const t0 = zeit(punkte[0]), t1 = zeit(punkte[punkte.length - 1]);
        const dauer = Math.max(t1 - t0, 1);
        // Feste Skala 10–60 %: eine mitwachsende Achse liesse eine ruhige
        // Spule genauso zappeln wie eine nasse. 35 % liegt damit in der Mitte.
        const UNTEN = 10, OBEN = 60;
        const x = p => ((zeit(p) - t0) / dauer) * b;
        const y = v => h - ((Math.min(Math.max(v, UNTEN), OBEN) - UNTEN) / (OBEN - UNTEN)) * h;
        // `luecke` faengt einen neuen Strich an: zwischen zwei Liegezeiten
        // lag die Spule im Regal, da wurde nichts gemessen. Eine
        // durchgezogene Linie waere dort erfunden.
        const d = punkte.map((p, i) => ((i && !p.luecke) ? 'L' : 'M') + x(p).toFixed(1)
            + ' ' + y(p.feuchte).toFixed(1)).join(' ');
        const ys = y(schwelle).toFixed(1);
        const nr = 'fkc' + (++lfdNr);
        const nass = punkte.some(p => p.feuchte >= schwelle);
        // Die Messpunkte reisen im Element mit: beim Ueberfahren sucht der
        // Zeiger den naechsten und zeigt Zeit, Feuchte und Temperatur. Ohne
        // das waere die Kurve nur eine Form ohne Zahlen.
        const daten = punkte.map(p => [
            new Date(String(p.zeit).replace(' ', 'T')).getTime(),
            Math.round(p.feuchte * 10) / 10,
            p.temperatur == null ? null : Math.round(p.temperatur * 10) / 10,
        ]);
        return `<svg class="fk-kurve" viewBox="0 0 ${b} ${h}" preserveAspectRatio="none"
                     role="img" aria-hidden="true"
                     data-fk="${esc(JSON.stringify(daten))}">
            ${nass ? `<clipPath id="${nr}"><rect x="0" y="0" width="${b}" height="${ys}"/></clipPath>
            <path class="fk-nass" d="${flaeche(punkte, x, y, h)}" clip-path="url(#${nr})"/>` : ''}
            <line class="fk-schwelle" x1="0" y1="${ys}" x2="${b}" y2="${ys}"/>
            <path class="fk-linie" d="${d}"/>
        </svg>`;
    }

    /** Die Merkzeile zu einer Spule: Urteil, Spitzenwert, Zeit ueber der Schwelle. */
    function merkzeile(spule, schwelle) {
        if (!spule) return '';
        const worte = {
            trocken: t('feuchte_urteil_trocken', 'trocken'),
            beobachten: t('feuchte_urteil_beobachten', 'im Blick behalten'),
            trocknen: t('feuchte_urteil_trocknen', 'trocknen'),
        };
        const teile = [];
        if (spule.tage_ueber >= 1) {
            teile.push(t('feuchte_tage_ueber', '{n} Tage über {s} %')
                .replace('{n}', spule.tage_ueber.toFixed(spule.tage_ueber < 10 ? 1 : 0))
                .replace('{s}', schwelle));
        } else if (spule.stunden_ueber > 0) {
            teile.push(t('feuchte_stunden_ueber', '{n} h über {s} %')
                .replace('{n}', Math.round(spule.stunden_ueber))
                .replace('{s}', schwelle));
        }
        teile.push(t('feuchte_spitze', 'Spitze {n} %').replace('{n}', spule.max));
        return `<span class="fk-urteil fk-urteil--${esc(spule.urteil)}">`
             + esc(worte[spule.urteil] || spule.urteil) + '</span>'
             + `<span class="fk-detail">${esc(teile.join(' · '))}</span>`;
    }

    // ------------------------------------------------------------------
    // Beim Ueberfahren: Zeit, Feuchte und Temperatur des naechsten Punktes.
    //
    // EIN Zuhoerer am Dokument statt einer je Kurve — die Kurven entstehen
    // und verschwinden mit ihren Fenstern, ein delegierter Zuhoerer trifft
    // auch die, die es beim Laden noch nicht gab.
    // ------------------------------------------------------------------
    let schild = null;

    function zeigeSchild(svg, ev) {
        let punkte;
        try { punkte = JSON.parse(svg.dataset.fk || '[]'); } catch (e) { return; }
        if (!punkte.length) return;
        const kasten = svg.getBoundingClientRect();
        if (!kasten.width) return;
        const anteil = (ev.clientX - kasten.left) / kasten.width;
        const t0 = punkte[0][0], t1 = punkte[punkte.length - 1][0];
        const gesucht = t0 + anteil * Math.max(t1 - t0, 1);
        // Naechster Punkt statt Interpolation: zwischen zwei Messungen liegt
        // je nach Bremse bis zu eine Stunde — ein gerechneter Wert waere
        // erfunden.
        let nah = punkte[0];
        for (const p of punkte) {
            if (Math.abs(p[0] - gesucht) < Math.abs(nah[0] - gesucht)) nah = p;
        }
        if (!schild) {
            schild = document.createElement('div');
            schild.className = 'fk-schild';
            document.body.appendChild(schild);
        }
        const d = new Date(nah[0]);
        const zeit = d.toLocaleString(undefined,
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        schild.innerHTML = '<b>' + esc(nah[1]) + ' %</b>'
            + (nah[2] == null ? '' : '<span>' + esc(nah[2]) + ' °C</span>')
            + '<span class="fk-schild-zeit">' + esc(zeit) + '</span>';
        schild.style.display = 'block';
        // Am Zeiger, aber nie ueber den Fensterrand hinaus.
        const breite = schild.offsetWidth;
        const links = Math.min(Math.max(ev.clientX - breite / 2, 8),
                               window.innerWidth - breite - 8);
        schild.style.left = links + 'px';
        schild.style.top = (kasten.top - schild.offsetHeight - 8) + 'px';
    }

    function versteckeSchild() {
        if (schild) schild.style.display = 'none';
    }

    document.addEventListener('mousemove', (ev) => {
        const svg = ev.target.closest && ev.target.closest('.fk-kurve[data-fk]');
        if (svg) zeigeSchild(svg, ev);
        else versteckeSchild();
    }, { passive: true });
    document.addEventListener('mouseleave', versteckeSchild, true);
    // Auf dem Tablet gibt es keinen Zeiger — dort tut es der Finger.
    document.addEventListener('touchmove', (ev) => {
        const b = ev.touches && ev.touches[0];
        if (!b) return;
        const ziel = document.elementFromPoint(b.clientX, b.clientY);
        const svg = ziel && ziel.closest && ziel.closest('.fk-kurve[data-fk]');
        if (svg) zeigeSchild(svg, { clientX: b.clientX });
        else versteckeSchild();
    }, { passive: true });
    document.addEventListener('touchend', versteckeSchild, { passive: true });

    window.amsFeuchte = { hole, vergiss, fuerFach, einheit, kurve, merkzeile, spanne };
})();
