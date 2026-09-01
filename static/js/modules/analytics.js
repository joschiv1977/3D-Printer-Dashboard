// analytics.js — Port von Android HistoryAnalytics.kt (1:1) für die Web-Statistik.
// Reine Berechnung auf der Druckliste (snake_case-Felder vom Companion). Deep-
// Analysen (aggregateDeep) arbeiten auf den pro Druck geladenen Detail-JSONs.
(function () {
  'use strict';

  const GRAMS_PER_METER = 2.98; // PLA 1,75 mm ≈ 2,98 g/m

  // Range-Key → Tage (null = alle). Trend-Granularität: ≤30T Tag, 90T Woche, sonst Monat.
  const RANGE_DAYS = { D7: 7, D30: 30, D90: 90, Y1: 365, ALL: null };
  function rangeDays(key) { return RANGE_DAYS[key] !== undefined ? RANGE_DAYS[key] : 30; }
  function trendMode(key) { return (key === 'D7' || key === 'D30') ? 'day' : (key === 'D90' ? 'week' : 'month'); }

  // Material-Kategorie — spezifischere zuerst (PETG-CF vor PETG …).
  const CATS = ['PAHT-CF', 'PA-CF', 'PET-CF', 'PETG-CF', 'PLA-CF', 'PETG', 'PLA',
    'ABS', 'ASA', 'TPU', 'TPE', 'PVA', 'HIPS', 'NYLON', 'PC', 'PA'];
  function materialCategory(raw) {
    const s = (raw || '').toUpperCase();
    if (!s.trim()) return '?';
    return CATS.find(c => s.includes(c)) || '?';
  }
  function materialsOf(all) {
    return [...new Set(all.map(p => materialCategory(p.filament_material || p.filament_type)).filter(m => m !== '?'))].sort();
  }

  const num = x => (typeof x === 'number' && !isNaN(x)) ? x : 0;
  const dayKey = p => (p.start_time || '').slice(0, 10);
  function hourOf(p) {
    const t = p.start_time || '';
    if (t.length < 13) return null;
    const h = parseInt(t.slice(11, 13), 10);
    return isNaN(h) ? null : h;
  }
  function weekdayOf(p) { // Mo=0 … So=6
    const d = new Date(dayKey(p) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return (d.getDay() + 6) % 7;
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function ym(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  const filPrice = (p, def) => (p.filament_price_per_kg && p.filament_price_per_kg > 0) ? p.filament_price_per_kg : def;
  // Gespeicherte Kosten BEVORZUGEN (inkl. Strom, Multi-Filament je Spule) —
  // die Formel ist nur Fallback fuer Drucke ohne gespeicherten Wert.
  const printCost = (p, def, pwr) => (p.cost_eur && p.cost_eur > 0) ? num(p.cost_eur)
      : num(p.filament_grams) / 1000 * filPrice(p, def) + num(p.power_kwh) * pwr;
  // Filament-Anteil eines Drucks: gespeicherte Kosten minus Strom, sonst Formel.
  const printFilCost = (p, def, pwr) => (p.cost_eur && p.cost_eur > 0)
      ? Math.max(0, num(p.cost_eur) - num(p.power_kwh) * pwr)
      : num(p.filament_grams) / 1000 * filPrice(p, def);

  function filterPrints(all, filter) {
    let cutoffDay = null;
    const days = rangeDays(filter.range);
    if (days != null) cutoffDay = ymd(new Date(Date.now() - (days - 1) * 86400000));
    return all.filter(p =>
      (cutoffDay == null || dayKey(p) >= cutoffDay) &&
      (filter.material == null || materialCategory(p.filament_material || p.filament_type) === filter.material) &&
      // Systemlauf ist kein Status: eine Kalibrierung kann genauso gelingen
      // oder scheitern wie ein Druck. "Erfolgreich" meint deshalb Drucke,
      // nicht die geglueckte Kalibrierung von vorhin.
      (filter.status == null
        || (filter.status === 'system' ? !!p.is_system_run
                                       : (p.status === filter.status && !p.is_system_run)))
    );
  }

  // ---- Labels (lokalisiert über Browser-Locale) ----
  // Numerisch statt "17. Aug.": unter einer Saeule von 34px Breite klebte der
  // Monatsname am naechsten Label.
  const fmtDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric' });
  const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
  function shortLabel(key, mode) {
    try {
      if (mode === 'day') return fmtDay.format(new Date(key + 'T00:00:00'));
      if (mode === 'month') return fmtMonth.format(new Date(key + '-01T00:00:00'));
      return key.substring(key.indexOf('-') + 1); // Www
    } catch (_) { return key; }
  }
  function isoWeekKey(p) {
    try {
      const d = new Date(dayKey(p) + 'T00:00:00');
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNr = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - dayNr + 3);
      const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
      const week = 1 + Math.round(((t - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
      return t.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
    } catch (_) { return (p.start_time || '').slice(0, 7); }
  }

  function bucketize(values, edges, labels) {
    const counts = new Array(labels.length).fill(0);
    values.forEach(v => {
      let idx = edges.findIndex(e => v < e);
      if (idx < 0) idx = labels.length - 1;
      counts[idx]++;
    });
    return labels.map((l, i) => ({ label: l, count: counts[i] }));
  }
  function fmtH(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function buildTrend(prints, rangeKey, filDef, pwr) {
    const mode = trendMode(rangeKey);
    const groups = new Map();
    [...prints].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')).forEach(p => {
      const key = mode === 'day' ? dayKey(p) : (mode === 'month' ? (p.start_time || '').slice(0, 7) : isoWeekKey(p));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    const mk = (k, ps) => {
      const c = ps.length;
      // Ein laufender Druck ist weder gelungen noch gescheitert. Vorher zaehlte
      // er als Misserfolg — die Erfolgslinie stuerzte am aktuellen Tag auf 0 %,
      // sobald der Drucker lief.
      const fertig = ps.filter(x => x.status !== 'running');
      const s = fertig.filter(x => x.status === 'success').length;
      return {
        key: k,            // Bucket-Key (Tagesmodus = YYYY-MM-DD → Lookup in dayPrints)
        prints: ps,        // Drucke dieses Buckets (Tag/Woche/Monat) für den Klick-Dialog
        label: shortLabel(k, mode), count: c,
        // Leerer Tag (oder nur laufende Drucke) → successRate null: die Linie
        // ueberbrueckt die Luecke, statt auf 0 % zu fallen.
        successRate: fertig.length > 0 ? Math.floor(s * 100 / fertig.length) : null,
        cost: ps.reduce((a, p) => a + printCost(p, filDef, pwr), 0),
        filamentG: ps.reduce((a, p) => a + num(p.filament_grams), 0)
      };
    };
    let list;
    if (mode === 'day' && groups.size) {
      // Tages-Modus: leere Tage zwischen erstem und letztem Druck-Tag mit count=0
      // auffüllen, damit der Verlauf die echten Lücken zeigt statt sie
      // zusammenzuschieben.
      const keys = [...groups.keys()].sort();
      const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const cur = new Date(keys[0] + 'T00:00:00'), end = new Date(keys[keys.length - 1] + 'T00:00:00');
      list = [];
      while (cur <= end) {
        const k = fmt(cur);
        list.push(mk(k, groups.get(k) || []));
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      list = [...groups.entries()].map(([k, ps]) => mk(k, ps));
    }
    return { trend: list, trendUnit: mode };
  }

  function compute(all, filter, filamentDefaultPerKg, powerPerKwh) {
    const prints = filterPrints(all, filter);
    if (prints.length === 0) return { total: 0, empty: true, materialOptions: materialsOf(all) };

    const n = prints.length;
    const ok = prints.filter(p => p.status === 'success').length;
    const failed = prints.filter(p => p.status === 'failed').length;
    const cancelled = prints.filter(p => p.status === 'cancelled').length;
    const totalMin = prints.reduce((a, p) => a + num(p.duration_minutes), 0);
    const longest = prints.reduce((a, p) => Math.max(a, num(p.duration_minutes)), 0);
    const grams = prints.reduce((a, p) => a + num(p.filament_grams), 0);
    const kwh = prints.reduce((a, p) => a + num(p.power_kwh), 0);
    const filamentCost = prints.reduce((a, p) => a + printFilCost(p, filamentDefaultPerKg, powerPerKwh), 0);
    const powerCost = kwh * powerPerKwh;
    const totalCost = filamentCost + powerCost;
    const wasted = prints.filter(p => p.status === 'failed' || p.status === 'cancelled');
    const wastedG = wasted.reduce((a, p) => a + num(p.filament_grams), 0);
    const wastedCost = wasted.reduce((a, p) => a + printFilCost(p, filamentDefaultPerKg, powerPerKwh), 0);

    const now = new Date();
    const ymNow = ym(now);
    const prevYm = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const weekCut = ymd(new Date(Date.now() - 6 * 86400000));
    const msAll = all.filter(p =>
      (filter.material == null || materialCategory(p.filament_material || p.filament_type) === filter.material) &&
      (filter.status == null || p.status === filter.status));

    const matMap = new Map();
    prints.forEach(p => {
      const t = materialCategory(p.filament_material || p.filament_type);
      if (!matMap.has(t)) matMap.set(t, []);
      matMap.get(t).push(p);
    });
    const materials = [...matMap.entries()].map(([type, ps]) => {
      const c = ps.length;
      const fertig = ps.filter(x => x.status !== 'running');
      const s = fertig.filter(x => x.status === 'success').length;
      return {
        type, count: c, grams: ps.reduce((a, p) => a + num(p.filament_grams), 0),
        successRate: fertig.length > 0 ? Math.floor(s * 100 / fertig.length) : 0,
        cost: ps.reduce((a, p) => a + printFilCost(p, filamentDefaultPerKg, powerPerKwh), 0),
        failedGrams: ps.filter(x => x.status !== 'success').reduce((a, p) => a + num(p.filament_grams), 0)
      };
    }).sort((a, b) => b.count - a.count);

    const { trend, trendUnit } = buildTrend(prints, filter.range, filamentDefaultPerKg, powerPerKwh);

    const durationBuckets = bucketize(prints.map(p => num(p.duration_minutes)).filter(v => v > 0),
      [60, 180, 360, 720], ['<1h', '1–3h', '3–6h', '6–12h', '>12h']);
    const filamentBuckets = bucketize(prints.map(p => Math.floor(num(p.filament_grams))),
      [10, 50, 100, 250], ['<10g', '10–50g', '50–100g', '100–250g', '>250g']);
    const layerBuckets = bucketize(prints.map(p => num(p.total_layers)).filter(v => v > 0),
      [100, 300, 600], ['<100', '100–300', '300–600', '>600']);

    const weekday = new Array(7).fill(0);
    const weekdayOk = new Array(7).fill(0);
    const hw = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const cal = {};
    prints.forEach(p => {
      const k = dayKey(p); cal[k] = (cal[k] || 0) + 1;
      const wd = weekdayOf(p); if (wd == null) return;
      // Laufende Drucke zaehlen fuer die Quote nicht mit (siehe oben).
      if (p.status !== 'running') { weekday[wd]++; if (p.status === 'success') weekdayOk[wd]++; }
      const h = hourOf(p); if (h != null && h >= 0 && h <= 23) hw[wd][h]++;
    });
    const successByWeekday = weekday.map((c, i) => c > 0 ? Math.floor(weekdayOk[i] * 100 / c) : 0);

    const records = [];
    const recBy = (sel, key, fmt) => {
      let best = null;
      prints.forEach(p => { if (best == null || sel(p) > sel(best)) best = p; });
      if (best && sel(best) > 0) records.push({ labelKey: key, filename: best.filename, value: fmt(best) });
    };
    recBy(p => num(p.duration_minutes), 'longest', p => fmtH(num(p.duration_minutes)));
    recBy(p => num(p.filament_grams), 'most_filament', p => `${Math.round(num(p.filament_grams))} g`);
    recBy(p => num(p.total_layers), 'most_layers', p => `${num(p.total_layers)}`);
    recBy(p => num(p.avg_nozzle_temp), 'hottest', p => `${Math.round(num(p.avg_nozzle_temp))} °C`);

    const dayPrints = {};
    prints.forEach(p => { const k = dayKey(p); (dayPrints[k] = dayPrints[k] || []).push(p); });

    // Gleiche Regel fuer die Gesamtquote: sie bezieht sich auf die
    // abgeschlossenen Drucke. Sonst passte die Prozentzahl nicht zu den
    // Zahlen daneben — bei 7 erfolgreichen, 0 fehlgeschlagenen und einem
    // laufenden Druck standen dort 87 %, obwohl nichts misslungen war.
    const laufend = prints.filter(p => p.status === 'running').length;
    const abgeschlossen = n - laufend;
    return {
      total: n, successful: ok, failed, cancelled, running: laufend,
      successRate: abgeschlossen > 0 ? Math.floor(ok * 100 / abgeschlossen) : 0,
      totalMinutes: totalMin, avgMinutes: n > 0 ? Math.floor(totalMin / n) : 0, longestMinutes: longest,
      filamentKg: grams / 1000, filamentMeters: grams / GRAMS_PER_METER, avgFilamentG: n > 0 ? grams / n : 0,
      powerKwh: kwh, totalCost, avgCost: n > 0 ? totalCost / n : 0, filamentCost, powerCost,
      wastedGrams: wastedG, wastedCost,
      // WANN die Fehlschlaege passierten. Eine Erfolgsquote allein wirft
      // zusammen, was verschiedene Ursachen hat: ein Abbruch vor der ersten
      // Schicht (Haftung, Kalibrierung, Filament nicht geladen) und einer in
      // Schicht 47 (gerissen, verstopft, abgeloest) sind nicht dasselbe
      // Problem. Die Phase rechnet der Server aus dem Verlauf; `unbekannt`
      // sind Drucke ohne aufgezeichneten Verlauf — die werden nicht geraten.
      fehlerPhasen: (() => {
        const z = { pre_first_layer: 0, first_layers: 0, later: 0, unbekannt: 0 };
        wasted.forEach(p => {
          const ph = p.fail_phase;
          if (ph && z[ph] !== undefined) z[ph] += 1; else z.unbekannt += 1;
        });
        return z;
      })(),
      thisMonth: msAll.filter(p => (p.start_time || '').slice(0, 7) === ymNow).length,
      lastMonth: msAll.filter(p => (p.start_time || '').slice(0, 7) === prevYm).length,
      last7: msAll.filter(p => dayKey(p) >= weekCut).length,
      topMaterial: materials.length ? materials[0].type : '—',
      trend, trendUnit, materials,
      durationBuckets, filamentBuckets, layerBuckets,
      weekday, hourWeekday: hw, calendar: cal, successByWeekday,
      records, materialOptions: materialsOf(all), dayPrints
    };
  }

  // ---- Deep-Analysen aus Detail-JSONs ----
  function evtMinutes(events, from, to) {
    const a = events.find(e => e.type === from); const b = events.find(e => e.type === to);
    if (!a || !b) return null;
    const pa = new Date(String(a.time).replace(' ', 'T').slice(0, 19));
    const pb = new Date(String(b.time).replace(' ', 'T').slice(0, 19));
    if (isNaN(pa) || isNaN(pb)) return null;
    const m = (pb - pa) / 60000;
    return (m >= 0 && m <= 600) ? m : null;
  }

  function aggregateDeep(details) {
    if (!details.length) return { samples: 0 };
    const stats = details.map(d => d.statistics).filter(s => s && Object.keys(s).length);
    const avg = sel => { const xs = stats.map(sel).filter(v => v != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
    const mx = sel => { const xs = stats.map(sel).filter(v => v != null); return xs.length ? Math.max(...xs) : null; };

    const phase = (key, from, to) => {
      const ms = details.map(d => d.events ? evtMinutes(d.events, from, to) : null).filter(v => v != null);
      return ms.length ? { key, avgMin: ms.reduce((a, b) => a + b, 0) / ms.length, count: ms.length } : null;
    };
    const phases = [
      phase('soak', 'heat_soak_start', 'heat_soak_end'),
      phase('purge', 'purge_start', 'purge_end'),
      phase('prepare', 'prepare_start', 'printing_start'),
      phase('print', 'printing_start', 'print_end')
    ].filter(Boolean);

    // Bambu kennt die Klipper-Phasen-Events nicht — dort kommen die Phasen
    // aus den stage_change-Events: Dauer einer Stage = Zeit bis zum
    // naechsten Stage-Wechsel. Label ist der (bereits uebersetzte)
    // Stage-Text ohne fuehrendes Icon.
    if (!phases.length) {
      const agg = new Map();
      details.forEach(d => {
        const evs = (d.events || [])
          .filter(e => e.type === 'stage_change' || e.type === 'finish')
          .slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
        for (let i = 0; i < evs.length; i++) {
          const e = evs[i];
          if (e.type !== 'stage_change') continue;
          const next = evs[i + 1];
          if (!next) continue;
          const t0 = new Date(String(e.time).replace(' ', 'T').slice(0, 19));
          const t1 = new Date(String(next.time).replace(' ', 'T').slice(0, 19));
          if (isNaN(t0) || isNaN(t1)) continue;
          const min = (t1 - t0) / 60000;
          if (min < 0 || min > 600) continue;
          const name = String(e.details || '').replace(/^[^A-Za-z0-9ÄÖÜäöüß]+\s*/, '').trim();
          if (!name) continue;
          const cur = agg.get(name) || { sum: 0, count: 0 };
          cur.sum += min; cur.count++;
          agg.set(name, cur);
        }
      });
      phases.push(...[...agg.entries()]
        .map(([label, v]) => ({ key: label, label, avgMin: v.sum / v.count, count: v.count }))
        .sort((a, b) => b.avgMin - a.avgMin)
        .slice(0, 10));
    }

    const corr = (titleKey, sel, edges, labels) => {
      const counts = new Array(labels.length).fill(0), okc = new Array(labels.length).fill(0);
      details.forEach(d => {
        const v = d.settings ? sel(d.settings) : null; if (v == null) return;
        let idx = edges.findIndex(e => v < e); if (idx < 0) idx = labels.length - 1;
        counts[idx]++; if (d.print && d.print.status === 'success') okc[idx]++;
      });
      const buckets = labels.map((l, i) => ({ label: l, count: counts[i], successRate: counts[i] > 0 ? Math.floor(okc[i] * 100 / counts[i]) : 0 }))
        .filter(b => b.count > 0);
      return buckets.length ? { titleKey, buckets } : null;
    };
    const nz = v => (v == null ? null : Number(v));
    const correlations = [
      corr('layer_height', s => nz(s.layer_height), [0.15, 0.25], ['<0.15', '0.15–0.25', '>0.25']),
      corr('infill', s => nz(s.infill_density), [15, 30, 60], ['<15%', '15–30%', '30–60%', '>60%']),
      corr('speed', s => nz(s.print_speed), [100, 200, 300], ['<100', '100–200', '200–300', '>300']),
      corr('nozzle', s => nz(s.nozzle_temp), [210, 240, 260], ['<210°', '210–240°', '240–260°', '>260°'])
    ].filter(Boolean);

    const ratios = details.map(d => {
      if (!d.print || d.print.status !== 'success') return null;
      const estSec = d.settings ? d.settings.print_time_estimate : null;
      const act = d.print.duration_minutes;
      if (estSec == null || act == null || estSec <= 0 || act <= 0) return null;
      return act / (estSec / 60);
    }).filter(v => v != null);
    // MEDIAN statt Mittelwert: robust gegen Ausreißer (Drucke mit absurder
    // Schätzung/Dauer würden den Mittelwert zerschießen).
    let slicerDev = null;
    if (ratios.length) {
      const s = ratios.slice().sort((a, b) => a - b);
      const m = s.length >> 1;
      const median = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      slicerDev = Math.round((median - 1) * 100);
    }

    return {
      samples: details.length,
      avgNozzle: avg(s => nz(s.avg_nozzle_temp)), maxNozzle: mx(s => nz(s.max_nozzle_temp)),
      avgBed: avg(s => nz(s.avg_bed_temp)), maxBed: mx(s => nz(s.max_bed_temp)),
      avgChamberTemp: avg(s => nz(s.avg_chamber_temp)), maxChamberTemp: mx(s => nz(s.max_chamber_temp)),
      avgChamberHum: avg(s => nz(s.avg_chamber_humidity)),
      avgPowerW: avg(s => nz(s.avg_power_consumption)),
      avgSuccessScore: (() => { const v = avg(s => nz(s.success_score)); return v == null ? null : Math.round(v); })(),
      phases, correlations,
      slicerDeviationPct: slicerDev, slicerSamples: ratios.length
    };
  }

  window.HistoryAnalytics = {
    RANGE_DAYS, rangeDays, trendMode, materialCategory, materialsOf,
    filterPrints, compute, aggregateDeep, fmtH
  };
})();
