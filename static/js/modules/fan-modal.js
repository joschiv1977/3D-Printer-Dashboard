// Lüfter-Steuerung (Klipper-Direct) — 1:1 wie Android FanControlDialog.
// Grid aus Lüfter-Karten: 270°-Gauge + (Slider | „Ⓐ Automatisch"). Pollt /api/fans
// alle 2s solange offen, setzt via POST /api/fans/set (M106/M107 bzw. SET_FAN_SPEED).
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R = 38;
  const C = 2 * Math.PI * R;   // Umfang
  const ARC = C * 0.75;        // sichtbarer 270°-Bogen
  let timer = null;
  let dragging = null;         // object-Name dessen Slider gerade gezogen wird
  // Frisch gesetzte Werte: der Drucker meldet den neuen Stand erst einen
  // Poll spaeter — solange halten wir den Sollwert fest, sonst springt der
  // Regler einmal zurueck und wieder vor.
  const pending = {};          // object -> { value, until }
  const cards = {};            // object -> {prog, txt, rpm, slider}
  let curKeys = '';

  function t(key, fb) { return (window.getText ? window.getText(key, fb) : fb); }

  // ===== Verbindungslinien wie am X2D-Display: vom Eintrag horizontal,
  // Knick senkrecht ueber dem Bauteil, offener Kreis als Endpunkt. Jeder
  // Eintrag traegt sein Ziel als data-anker="x,y" (Prozent im Maschinenbild).
  // Wird auch vom Temperatur-Fenster benutzt (gleiche Stage). =====
  window.dfxDrawWires = function (stage) {
    if (!stage || !stage.isConnected) return;
    const img = stage.querySelector('.dfx-mitte img');
    if (!img) return;
    let svg = stage.querySelector('svg.dfx-wires');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'dfx-wires');
      stage.appendChild(svg);
    }
    const sr = stage.getBoundingClientRect();
    if (!sr.width) return;
    const ir = img.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + sr.width + ' ' + sr.height);
    let teile = '';
    stage.querySelectorAll('.dfx-fan[data-anker]').forEach((f) => {
      const xy = (f.dataset.anker || '').split(',');
      const ax = parseFloat(xy[0]);
      const ay = parseFloat(xy[1]);
      if (isNaN(ax) || isNaN(ay)) return;
      const kopf = f.querySelector('.dfx-fan-head') || f;
      const fr = kopf.getBoundingClientRect();
      const linksSeite = f.classList.contains('dfx-fan--l');
      const x1 = (linksSeite ? fr.right + 8 : fr.left - 8) - sr.left;
      const y1 = fr.top + fr.height / 2 - sr.top;
      const x2 = ir.left - sr.left + ir.width * ax / 100;
      const y2 = ir.top - sr.top + ir.height * ay / 100;
      const pts = x1.toFixed(1) + ',' + y1.toFixed(1) + ' '
        + x2.toFixed(1) + ',' + y1.toFixed(1) + ' '
        + x2.toFixed(1) + ',' + y2.toFixed(1);
      teile += '<polyline points="' + pts + '"/>'
        + '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="3.5"/>';
    });
    svg.innerHTML = teile;
  };

  // Neu zeichnen sobald sich das Layout bewegt (Aufklappen, Resize, Bild da).
  window.dfxWatchStage = function (stage) {
    const neu = () => window.requestAnimationFrame(() => window.dfxDrawWires(stage));
    const img = stage.querySelector('.dfx-mitte img');
    if (img && !img.complete) img.addEventListener('load', neu);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(neu);
      ro.observe(stage);
      stage.querySelectorAll('.dfx-col').forEach((c) => ro.observe(c));
    }
    neu();
  };

  function setGauge(prog, txt, pct) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    prog.setAttribute('stroke-dasharray', (ARC * pct / 100).toFixed(2) + ' ' + C.toFixed(2));
    txt.textContent = pct <= 0 ? t('fan_off', 'Aus') : (pct + '%');
  }

  function mkCircle(strokeStyle) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(R));
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '9');
    c.setAttribute('stroke-linecap', 'round');
    c.setAttribute('transform', 'rotate(135 50 50)');
    c.style.stroke = strokeStyle;
    return c;
  }

  function buildCard(fan) {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-secondary); border-radius:12px; padding:14px 10px; display:flex; flex-direction:column; align-items:center; gap:6px;';

    const label = document.createElement('div');
    // Bambu liefert i18n-Schluessel (fan_part, ...), Klipper fertige Namen —
    // t() faellt bei unbekanntem Schluessel auf den Text selbst zurueck.
    label.textContent = t(fan.label, fan.label);
    label.title = fan.object;
    label.style.cssText = 'font-size:13px; font-weight:600; color:var(--text-primary); text-align:center; min-height:34px; display:flex; align-items:center; justify-content:center; line-height:1.2;';
    card.appendChild(label);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('width', '94'); svg.setAttribute('height', '94');
    const track = mkCircle('rgba(128,128,128,0.22)');
    track.setAttribute('stroke-dasharray', ARC.toFixed(2) + ' ' + C.toFixed(2));
    const prog = mkCircle('var(--accent-blue, #3b82f6)');
    prog.setAttribute('stroke-dasharray', '0 ' + C.toFixed(2));
    const txt = document.createElementNS(SVG_NS, 'text');
    txt.setAttribute('x', '50'); txt.setAttribute('y', '50');
    txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('dominant-baseline', 'central');
    txt.setAttribute('font-size', '19'); txt.setAttribute('font-weight', '700');
    txt.style.fill = 'var(--text-primary)';
    svg.appendChild(track); svg.appendChild(prog); svg.appendChild(txt);
    card.appendChild(svg);

    const rpm = document.createElement('div');
    rpm.style.cssText = 'font-size:11px; color:var(--text-secondary); min-height:14px;';
    card.appendChild(rpm);

    let slider = null;
    if (fan.controllable) {
      slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '10';
      slider.value = String(fan.speed_percent);
      slider.style.cssText = 'width:100%; cursor:pointer; accent-color:var(--accent-blue);';
      slider.addEventListener('input', () => {
        dragging = fan.object;
        setGauge(prog, txt, parseInt(slider.value, 10) || 0);
      });
      slider.addEventListener('change', () => {
        const pct = parseInt(slider.value, 10) || 0;
        dragging = null;
        pending[fan.object] = { value: pct, until: Date.now() + 6000 };
        // apiCall setzt den CSRF-Token — roher fetch wurde vom Server mit
        // "CSRF Token missing" abgelehnt und der Regler sprang nach dem
        // naechsten Poll auf den echten Wert zurueck. Klipper-Direct hat
        // kein apiCall und keine CSRF-Pruefung → fetch als Rueckfall.
        const anfrage = {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ object: fan.object, kind: fan.kind, percent: pct }),
        };
        (typeof apiCall === 'function'
          ? apiCall('/api/fans/set', anfrage)
          : fetch('/api/fans/set', anfrage)
        ).catch(() => {});
      });
      card.appendChild(slider);
      if (fan.note) {
        const hinweis = document.createElement('div');
        hinweis.innerHTML = window.skIcon('hitze', 'hd-ic--xs') + ' ' + t(fan.note, fan.note);
        hinweis.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        card.appendChild(hinweis);
      }
    } else {
      const auto = document.createElement('div');
      // note (z.B. fan_recirc im Heiz-Modus) erklaert WARUM nicht regelbar.
      auto.innerHTML = fan.note
        ? window.skIcon('hitze', 'hd-ic--xs') + ' ' + t(fan.note, fan.note)
        : window.skIcon('auto', 'hd-ic--xs') + ' ' + t('fan_automatic', 'Automatisch');
      auto.style.cssText = 'font-size:12px; color:var(--text-secondary); background:rgba(128,128,128,0.14); border-radius:8px; padding:4px 12px;';
      card.appendChild(auto);
    }

    cards[fan.object] = { prog, txt, rpm, slider };
    return card;
  }

  function updateCard(fan) {
    const c = cards[fan.object];
    if (!c) return;
    // Sollwert-Schonfrist: gemeldeten Altwert ignorieren, bis der Drucker
    // den neuen bestaetigt (oder 6s um sind — dann gilt die Realitaet).
    const p = pending[fan.object];
    let anzeige = fan.speed_percent;
    if (p) {
      // Der Drucker rastet auf Zehnerschritte — kleine Abweichung = bestaetigt.
      if (Math.abs(fan.speed_percent - p.value) <= 5 || Date.now() > p.until) {
        delete pending[fan.object];
      } else {
        anzeige = p.value;
      }
    }
    if (dragging !== fan.object) setGauge(c.prog, c.txt, anzeige);
    c.rpm.textContent = (fan.rpm != null) ? (fan.rpm + ' RPM') : '';
    if (c.slider && dragging !== fan.object) c.slider.value = String(anzeige);
  }

  // ===== Bambu: Display-Layout wie am X2D ("Luftmanagement: Modi und
  // Luefter") — Modus-Toggle oben, Maschine mittig, Luefter aussen mit
  // gepunkteten Linien zu ihren Positionen. Klick klappt den Regler aus. =====
  function sende(fan, pct) {
    pending[fan.object] = { value: pct, until: Date.now() + 6000 };
    const anfrage = {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: fan.object, kind: fan.kind, percent: pct }),
    };
    (typeof apiCall === 'function'
      ? apiCall('/api/fans/set', anfrage)
      : fetch('/api/fans/set', anfrage)
    ).catch(() => {});
  }

  // Bauteil-Positionen im x2d.png (Prozent): dahin zeigen die Linien.
  const ANKER = {
    part: '44,34', aux_l: '26,50', aux: '26,50',
    aux_r: '58,36', chamber: '72,34', hotend: '48,29',
  };

  function fanEintrag(fan, seite) {
    const box = document.createElement('div');
    box.className = 'dfx-fan dfx-fan--' + seite;
    box.id = 'dfx-fan-' + fan.object;
    if (ANKER[fan.object]) box.dataset.anker = ANKER[fan.object];

    const head = document.createElement('div');
    head.className = 'dfx-fan-head';
    head.innerHTML = '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="2.2"/>' +
      '<path d="M12 9.8C12 5 15 3.5 17.5 5.1 19.6 6.4 19 9.8 14 11M14.2 12c4.8 0 6.3 3 4.7 5.5-1.3 2.1-4.7 1.5-5.9-3.5M9.8 13c-4.8 1.2-5.4 4.6-3.3 5.9C9 20.5 12 19 12 14.2"/></svg> ' +
      '<span>' + t(fan.label, fan.label) + '</span>' +
      (fan.controllable ? ' <span class="dfx-arrow">›</span>' : '');
    box.appendChild(head);

    const val = document.createElement('div');
    val.className = 'dfx-fan-val';
    val.id = 'dfx-val-' + fan.object;
    box.appendChild(val);

    if (fan.note) {
      const note = document.createElement('div');
      note.className = 'dfx-fan-note';
      note.innerHTML = window.skIcon('hitze', 'hd-ic--xs') + ' ' + t(fan.note, fan.note);
      box.appendChild(note);
    }

    if (fan.controllable) {
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '10';
      slider.className = 'df-slider dfx-slider';
      slider.style.display = 'none';
      slider.value = String(fan.speed_percent || 0);
      slider.addEventListener('input', () => {
        dragging = fan.object;
        val.textContent = (parseInt(slider.value, 10) || 0) + ' %';
      });
      slider.addEventListener('change', () => {
        dragging = null;
        sende(fan, parseInt(slider.value, 10) || 0);
      });
      box.appendChild(slider);
      head.style.cursor = 'pointer';
      head.addEventListener('click', () => {
        slider.style.display = slider.style.display === 'none' ? '' : 'none';
      });
      cards[fan.object] = { val, slider, bambu: true };
    } else {
      cards[fan.object] = { val, slider: null, bambu: true };
    }
    return box;
  }

  function baueModusToggle(container) {
    const modi = document.createElement('div');
    modi.className = 'dfx-modes';
    [[0, t('airduct_strong_cooling', 'Starke Kühlung')],
     [1, t('airduct_heating', 'Heizen')]].forEach(([m, name]) => {
      const b = document.createElement('button');
      b.className = 'dfx-mode';
      b.id = 'dfx-mode-' + m;
      b.innerHTML = '<span>' + name + '</span><span class="dfx-mode-dot"></span>';
      b.addEventListener('click', () => {
        window.printerAdapter.setAirduct(m).then(r => {
          if (!r.ok) skToast(r.error || '', 'error');
          else zeigeModus(m);
        }).catch(() => {});
      });
      modi.appendChild(b);
    });

    container.appendChild(modi);
  }

  /**
   * Kammer- und AUX-Luefter auf 100 %.
   *
   * Nur was der Drucker gerade regeln laesst: im Heiz-Modus gehoeren die
   * AUX-Pfade zum Umluftkreis der Kammerheizung und faellt AUX links ganz
   * aus der Liste (19aug26 gemessen). Deshalb wird nicht blind gesetzt,
   * sondern gegen die gemeldete Liste geprueft und gesagt, was ging.
   */
  const KUEHL_LUEFTER = ['chamber', 'aux_l', 'aux_r', 'aux'];

  /** Die regelbaren Kuehl-Luefter aus der zuletzt gemeldeten Liste. */
  function kuehlLuefter() {
    return (letzteFans || []).filter(
      f => KUEHL_LUEFTER.includes(f.object) && f.controllable !== false);
  }

  /**
   * Laeuft die Abkuehlung? Wenn ALLE regelbaren Kuehl-Luefter auf 100
   * stehen. Damit stimmt der Knopf auch nach einem Neuladen der Seite —
   * er haengt am Zustand des Druckers, nicht an einem Merker.
   */
  function kuehltGerade() {
    const l = kuehlLuefter();
    return l.length > 0 && l.every(f => angezeigterWert(f) >= 100);
  }

  /**
   * Was der Nutzer sieht: der eben gesendete Wert, solange der Drucker ihn
   * noch nicht bestaetigt hat, sonst der gemeldete.
   *
   * Ohne das dauerte es bis zu acht Sekunden, bis der Knopf auf „Kuehlung
   * abbrechen" umsprang — so lange braucht die Runde ueber MQTT und den
   * 2-s-Takt. Die Regler daneben rechnen laengst so.
   */
  function angezeigterWert(fan) {
    const p = pending[fan.object];
    if (p && Date.now() <= p.until) return p.value;
    return fan.speed_percent || 0;
  }

  /** Werte vor der Abkuehlung, damit „abbrechen" sie zurueckholt. */
  const vorKuehlung = {};

  function kuehleAb() {
    const treffer = kuehlLuefter();
    if (!treffer.length) {
      skToast(t('fan_cooldown_none', 'Kein regelbarer Kühl-Lüfter — im Heizen-Modus steuert der Drucker sie selbst.'), 'warning');
      return;
    }
    treffer.forEach(f => {
      vorKuehlung[f.object] = f.speed_percent || 0;
      sende(f, 100);
    });
    zeigeKuehlKnopf();
    skToast(t('fan_cooldown_done', '{n} Lüfter auf 100 %').replace('{n}', treffer.length), 'success');
  }

  /**
   * Zurueck auf die Werte von vorher. Sind keine gemerkt (Seite neu
   * geladen, Fenster zwischendurch zu), dann aus — das ist die Erwartung
   * bei „Kühlung abbrechen", und ein geratener Zwischenwert waere
   * schlechter als ein klarer Zustand.
   */
  function brichAb() {
    const treffer = kuehlLuefter();
    treffer.forEach(f => sende(f, vorKuehlung[f.object] ?? 0));
    zeigeKuehlKnopf();
    skToast(t('fan_cooldown_stopped', 'Kühlung beendet'), 'info');
  }

  /** Beschriftung des Knopfes an den Zustand haengen. */
  function zeigeKuehlKnopf() {
    const b = document.getElementById('dfx-abkuehlen');
    if (!b) return;
    const an = kuehltGerade();
    b.classList.toggle('dfx-kuehlen--an', an);
    b.innerHTML = (window.skIcon ? window.skIcon(an ? 'stopp' : 'schnee', 'hd-ic--xs') : '')
      + '<span>' + (an ? t('fan_cooldown_cancel', 'Kühlung abbrechen')
                       : t('fan_cooldown', 'Drucker abkühlen')) + '</span>';
  }

  function zeigeModus(modus) {
    [0, 1].forEach(m => {
      const b = document.getElementById('dfx-mode-' + m);
      if (b) b.classList.toggle('dfx-mode--on', m === modus);
    });
  }

  /** Zuletzt gemeldete Luefter — „Drucker abkuehlen" prueft dagegen. */
  let letzteFans = [];

  function renderBambu(fans) {
    letzteFans = fans || [];
    zeigeKuehlKnopf();
    const grid = document.getElementById('fan-cards');
    if (!grid) return;
    const st = (window.printerControlManager && window.printerControlManager.lastState) || {};
    const keys = 'x|' + fans.map((f) => f.object + (f.note || '') + (f.controllable ? 1 : 0)).join('|');
    if (keys !== curKeys) {
      Object.keys(cards).forEach((k) => delete cards[k]);
      curKeys = keys;
      grid.innerHTML = '';
      grid.style.display = 'block';

      baueModusToggle(grid);

      const stage = document.createElement('div');
      stage.className = 'dfx-stage';
      const links = document.createElement('div');
      links.className = 'dfx-col dfx-col--l';
      const mitte = document.createElement('div');
      mitte.className = 'dfx-mitte';
      mitte.innerHTML = '<img src="/static/img/printers/x2d.png" alt="">';
      const rechts = document.createElement('div');
      rechts.className = 'dfx-col dfx-col--r';

      const nach = { part: links, aux_l: links, aux: links,
                     aux_r: rechts, chamber: rechts, hotend: rechts };
      fans.forEach((f) => {
        const ziel = nach[f.object] || rechts;
        ziel.appendChild(fanEintrag(f, ziel === links ? 'l' : 'r'));
      });

      // Kammer-Temperatur wie am Display als eigener Eintrag rechts unten.
      const kt = document.createElement('div');
      kt.className = 'dfx-fan dfx-fan--r';
      kt.dataset.anker = '54,76';
      kt.style.cursor = 'pointer';
      kt.innerHTML = '<div class="dfx-fan-head">' +
        '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="3" rx="1"/><rect x="7" y="14" width="6" height="3" rx="1"/></svg> ' +
        '<span>' + t('temp_chamber', 'Kammer') + '</span> <span class="dfx-arrow">›</span></div>' +
        '<div class="dfx-fan-val" id="dfx-val-chamber-temp">--</div>';
      kt.addEventListener('click', () => {
        window.closeFanControl();
        if (typeof openTempControl === 'function') openTempControl('chamber');
      });
      rechts.appendChild(kt);

      stage.appendChild(links);
      stage.appendChild(mitte);
      stage.appendChild(rechts);
      grid.appendChild(stage);

      // „Drucker abkuehlen" unter der Maschine, mittig. In der Modus-Zeile
      // stand er zwischen zwei Knoepfen, die eine AUSWAHL sind — hier ist
      // es eine Handlung. Am Telefon blieb dort ausserdem nur „Druck…"
      // uebrig (24aug26 am Geraet gesehen).
      const kuehlZeile = document.createElement('div');
      kuehlZeile.className = 'dfx-kuehl-zeile';
      const kuehl = document.createElement('button');
      kuehl.className = 'dfx-mode dfx-kuehlen';
      kuehl.id = 'dfx-abkuehlen';
      kuehl.addEventListener('click', () => (kuehltGerade() ? brichAb() : kuehleAb()));
      kuehlZeile.appendChild(kuehl);
      grid.appendChild(kuehlZeile);

      const hint = document.createElement('div');
      hint.className = 'dsp-hint';
      hint.innerHTML = '<svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true">'
        + '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg> '
        + '<span>' + t('fan_hint_click', 'Lüfter anklicken, um die Drehzahl zu ändern.') + '</span>';
      grid.appendChild(hint);
      window.dfxWatchStage(stage);
    }

    zeigeModus(st.airduct_mode || 0);
    const ktv = document.getElementById('dfx-val-chamber-temp');
    if (ktv) ktv.textContent = Math.round(st.chamber_temp || 0) + ' °C / '
      + Math.round(st.chamber_target || 0) + ' °C';

    fans.forEach((fan) => {
      const c = cards[fan.object];
      if (!c || !c.bambu) return;
      const p = pending[fan.object];
      let anzeige = fan.speed_percent;
      if (p) {
        if (Math.abs(fan.speed_percent - p.value) <= 5 || Date.now() > p.until) delete pending[fan.object];
        else anzeige = p.value;
      }
      if (dragging !== fan.object) {
        c.val.textContent = (anzeige || 0) + ' %';
        if (c.slider) c.slider.value = String(anzeige || 0);
      }
    });
  }

  function render(fans) {
    const grid = document.getElementById('fan-cards');
    const empty = document.getElementById('fan-empty');
    if (!grid) return;
    if (!fans || !fans.length) {
      grid.innerHTML = ''; Object.keys(cards).forEach((k) => delete cards[k]); curKeys = '';
      if (empty) { empty.style.display = ''; empty.textContent = t('fan_none_found', 'Kein Lüfter gefunden'); }
      return;
    }
    if (empty) empty.style.display = 'none';
    // Bambu: Display-Stil mit Maschinen-Render. Klipper: Gauge-Grid.
    if (!(window.isKlipperMode && window.isKlipperMode())) {
      renderBambu(fans);
      return;
    }
    const keys = fans.map((f) => f.object).join('|');
    if (keys !== curKeys) {
      grid.innerHTML = ''; Object.keys(cards).forEach((k) => delete cards[k]);
      fans.forEach((f) => grid.appendChild(buildCard(f)));
      curKeys = keys;
    }
    fans.forEach(updateCard);
  }

  function loadFans() {
    fetch('/api/fans', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => render((d && d.fans) || []))
      .catch(() => {});
  }

  window.openFanControl = function () {
    const m = document.getElementById('fanModal');
    if (!m) return;
    const title = document.getElementById('fan-modal-title');
    if (title) title.textContent = t('fan_modal_title', 'Lüfter');
    m.style.display = 'block';
    loadFans();
    if (timer) clearInterval(timer);
    timer = setInterval(loadFans, 2000);
  };

  window.closeFanControl = function () {
    const m = document.getElementById('fanModal');
    if (m) m.style.display = 'none';
    if (timer) { clearInterval(timer); timer = null; }
    dragging = null;
  };

  // Klick auf den abgedunkelten Hintergrund schließt das Modal.
  document.addEventListener('DOMContentLoaded', () => {
    const m = document.getElementById('fanModal');
    if (m) m.addEventListener('click', (e) => { if (e.target === m) window.closeFanControl(); });
  });
})();
