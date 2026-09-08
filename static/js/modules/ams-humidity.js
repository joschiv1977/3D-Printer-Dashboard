/**
 * The humidity memory of the AMS.
 *
 * The instantaneous value is in the status and shown everywhere. The question
 * before a print, though, is how long a spool LAY damp -- for that the server
 * delivers the history per unit and a verdict per tray under
 * /api/filament/feuchte. This module fetches that once, keeps it briefly and
 * draws the curve and the summary line from it.
 */
(function () {
    'use strict';

    const GUELTIG_MS = 60000;      // so lange gilt eine Antwort als frisch
    let stand = null, geholt = 0, laufend = null;

    const t = (key, ersatz) => ((window.texts || {})[key] || ersatz);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /** Fetches the state; several calls in the same moment share one request. */
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

    /** After a drying run the old state is void. */
    function vergiss() { stand = null; geholt = 0; }

    function fuerFach(daten, amsId, slot) {
        return ((daten && daten.spulen) || []).find(
            s => s.ams_id === amsId && s.slot === slot) || null;
    }

    function einheit(daten, amsId) {
        return ((daten && daten.einheiten) || []).find(e => e.id === amsId) || null;
    }

    /** How much time the series really covers -- as text. */
    function spanne(verlauf) {
        const p = (verlauf || []).filter(x => x.feuchte != null);
        if (p.length < 2) return { ms: 0, text: '' };
        const zeit = x => new Date(String(x.zeit).replace(' ', 'T')).getTime();
        const t0 = zeit(p[0]), t1 = zeit(p[p.length - 1]);
        const ms = Math.max(t1 - t0, 0);
        const stunden = ms / 3600000;
        // The heading always used to say "the last 14 days" -- even with five
        // minutes of measurements behind it. It now names what is really
        // there.
        // The unit is chosen so the number is always >= 2 -- otherwise it would
        // read "the last 1 hours". Singular forms for five languages would be
        // ten more strings for a case that does not arise.
        const text = stunden >= 48
            ? t('feuchte_spanne_tage', 'letzte {n} Tage').replace('{n}', Math.round(stunden / 24))
            : (stunden >= 2
                ? t('feuchte_spanne_stunden', 'letzte {n} Stunden').replace('{n}', Math.round(stunden))
                : t('feuchte_spanne_minuten', 'letzte {n} Minuten').replace('{n}', Math.max(2, Math.round(ms / 60000))));
        return { ms, text, von: t0, bis: t1 };
    }

    let lfdNr = 0;

    /** The area under the curve -- one closed path per period. */
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
     * The history as a curve.
     *
     * It is filled ONLY above the threshold, and in red: an area from the value
     * down to the floor looked the same for every quiet spool -- a half-blue
     * box that said nothing. This way a dry spool leaves a flat line and a wet
     * one leaves red mountains.
     */
    function kurve(verlauf, schwelle, breite, hoehe) {
        const punkte = (verlauf || []).filter(p => p.feuchte != null);
        if (punkte.length < 2) return '';
        const b = breite || 260, h = hoehe || 46;
        const zeit = p => new Date(String(p.zeit).replace(' ', 'T')).getTime();
        const t0 = zeit(punkte[0]), t1 = zeit(punkte[punkte.length - 1]);
        const dauer = Math.max(t1 - t0, 1);
        // A fixed scale of 10-60%: an axis that grows with the data would make
        // a quiet spool jitter exactly like a wet one. 35% then sits in the
        // middle.
        const UNTEN = 10, OBEN = 60;
        const x = p => ((zeit(p) - t0) / dauer) * b;
        const y = v => h - ((Math.min(Math.max(v, UNTEN), OBEN) - UNTEN) / (OBEN - UNTEN)) * h;
        // `luecke` starts a new stroke: between two periods the spool sat on
        // the shelf and nothing was measured. A continuous line would be made
        // up there.
        const d = punkte.map((p, i) => ((i && !p.luecke) ? 'L' : 'M') + x(p).toFixed(1)
            + ' ' + y(p.feuchte).toFixed(1)).join(' ');
        const ys = y(schwelle).toFixed(1);
        const nr = 'fkc' + (++lfdNr);
        const nass = punkte.some(p => p.feuchte >= schwelle);
        // The measurements travel inside the element: on hover the pointer
        // finds the nearest one and shows time, humidity and temperature.
        // Without that the curve would be a shape without numbers.
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

    /** The summary line for a spool: verdict, peak value, time above the threshold. */
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
    // On hover: the time, humidity and temperature of the nearest point.
    //
    // ONE listener on the document rather than one per curve -- the curves come
    // and go with their windows, and a delegated listener also catches the ones
    // that did not exist at load time.
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
        // The nearest point rather than interpolation: depending on the
        // throttle there can be up to an hour between two measurements -- a
        // computed value would be made up.
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
        // At the pointer, but never past the edge of the window.
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
    // On a tablet there is no pointer -- there the finger does it.
    document.addEventListener('touchmove', (ev) => {
        const b = ev.touches && ev.touches[0];
        if (!b) return;
        const ziel = document.elementFromPoint(b.clientX, b.clientY);
        const svg = ziel && ziel.closest && ziel.closest('.fk-kurve[data-fk]');
        if (svg) zeigeSchild(svg, { clientX: b.clientX });
        else versteckeSchild();
    }, { passive: true });
    document.addEventListener('touchend', versteckeSchild, { passive: true });

    window.amsHumidity = { hole, vergiss, fuerFach, einheit, kurve, merkzeile, spanne };
})();
