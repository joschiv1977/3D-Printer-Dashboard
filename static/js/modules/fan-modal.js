// Fan control (Klipper direct) -- 1:1 like Android FanControlDialog.
// A grid of fan cards: a 270° gauge plus a slider or "Ⓐ automatic". It polls
// /api/fans every 2 s while open, setting via POST /api/fans/set.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R = 38;
  const C = 2 * Math.PI * R;   // Umfang
  const ARC = C * 0.75;        // sichtbarer 270°-Bogen
  let timer = null;
  let dragging = null;         // object-Name dessen Slider gerade gezogen wird
  // Freshly set values: the printer reports the new state only one poll
  // later -- until then we hold the target, or the slider jumps back once
  // and forward again.
  const pending = {};          // object -> { value, until }
  const cards = {};            // object -> {prog, txt, rpm, slider}
  let curKeys = '';

  function t(key, fb) { return (window.getText ? window.getText(key, fb) : fb); }

  // ===== Connection lines as on the X2D display: horizontal from the entry,
  // a bend vertically above the component, an open circle as the endpoint.
  // Every entry carries its target as data-anker="x,y" (per cent in the
  // machine image). The temperature window uses it too (the same stage). =====
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

  // Redraw as soon as the layout moves (unfolding, resize, image arriving).
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
    // Bambu delivers i18n keys (fan_part, …), Klipper finished names --
    // t() falls back to the text itself on an unknown key.
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
        // apiCall sets the CSRF token -- a raw fetch was refused by the
        // server with "CSRF Token missing" and the slider jumped back to the
        // real value on the next poll. Klipper direct has no apiCall and no
        // CSRF check, so fetch is the fallback there.
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
      // note (fan_recirc in heating mode, say) explains WHY it is not controllable.
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
    // A grace period for the target: ignore the reported old value until the
    // printer confirms the new one (or 6 s pass -- then reality counts).
    const p = pending[fan.object];
    let anzeige = fan.speed_percent;
    if (p) {
      // The printer snaps to steps of ten -- a small deviation counts as confirmed.
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

  // ===== Bambu: the display layout as on the X2D ("air management: modes
  // and fans") -- the mode toggle on top, the machine in the middle, the fans
  // outside with dotted lines to their positions. A click unfolds the slider. =====
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

  // Component positions in x2d.png (per cent): that is where the lines point.
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
   * Chamber and AUX fans to 100 %.
   *
   * Only what the printer currently lets one control: in heating mode the
   * AUX paths belong to the recirculation circuit of the chamber heater, and
   * AUX left drops out of the list entirely. So nothing is set blindly; it is
   * checked against the reported list, and what worked is said.
   */
  const KUEHL_LUEFTER = ['chamber', 'aux_l', 'aux_r', 'aux'];

  /** The controllable cooling fans from the last reported list. */
  function kuehlLuefter() {
    return (letzteFans || []).filter(
      f => KUEHL_LUEFTER.includes(f.object) && f.controllable !== false);
  }

  /**
   * Is the cool-down running? When ALL controllable cooling fans stand at
   * 100. That way the button is right after a page reload too -- it hangs off
   * the printer state, not off a flag.
   */
  function kuehltGerade() {
    const l = kuehlLuefter();
    return l.length > 0 && l.every(f => angezeigterWert(f) >= 100);
  }

  /**
   * What the user sees: the value just sent, while the printer has not
   * confirmed it yet, otherwise the reported one.
   *
   * Without that it took up to eight seconds for the button to flip to
   * "cancel cooling" -- that is how long the round over MQTT and the 2 s
   * beat takes. The sliders beside it have long computed that way.
   */
  function angezeigterWert(fan) {
    const p = pending[fan.object];
    if (p && Date.now() <= p.until) return p.value;
    return fan.speed_percent || 0;
  }

  /** Values from before the cool-down, so "cancel" brings them back. */
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
   * Back to the earlier values. Where none are remembered (the page was
   * reloaded, the window closed in between) it goes off -- that is what one
   * expects from "cancel cooling", and a guessed middle value would be worse
   * than a clear state.
   */
  function brichAb() {
    const treffer = kuehlLuefter();
    treffer.forEach(f => sende(f, vorKuehlung[f.object] ?? 0));
    zeigeKuehlKnopf();
    skToast(t('fan_cooldown_stopped', 'Kühlung beendet'), 'info');
  }

  /** Hang the button label off the state. */
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

  /** The fans last reported -- "cool the printer down" checks against them. */
  let letzteFans = [];

  function renderBambu(fans) {
    letzteFans = fans || [];
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

      // Chamber temperature as on the display, an entry of its own bottom right.
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

      // "Cool the printer down" under the machine, centred. In the mode row
      // it stood between two buttons that are a CHOICE -- this is an action.
      // On the phone only "coo…" was left there as well.
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

    // Label LAST, not first.
    //
    // The call used to sit at the top of this function — that is, before the
    // button had even been built. On the first open it found nothing, bailed
    // out, and the button appeared afterwards with no icon and no text: an
    // empty area that only the next status round filled in. Down here the
    // button is finished in every case.
    zeigeKuehlKnopf();
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
    // Bambu: display style with the machine render. Klipper: a gauge grid.
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

  // A click on the dimmed background closes the modal.
  document.addEventListener('DOMContentLoaded', () => {
    const m = document.getElementById('fanModal');
    if (m) m.addEventListener('click', (e) => { if (e.target === m) window.closeFanControl(); });
  });
})();
