// analytics-dashboard.js — Web-Pendant zu Androids AnalyticsDashboard.
// Rendert das komplette Analyse-Dashboard (14 Sektionen + Tag-Dialog +
// Flugschreiber) aus der Druckliste. Deep-Analysen laden Detail-JSONs (gecacht).
// Nutzt window.HistoryAnalytics (analytics.js) + Chart.js.
(function () {
  'use strict';

  // ---- Lokalisierung (alle 5 Sprachen, self-contained) ----
  const T = {
    de: {
      period: 'Zeitraum', r7: '7T', r30: '30T', r90: '90T', r1y: '1J', rall: 'Alle',
      mat_all: 'Alle Materialien', st_all: 'Alle Status', st_success: 'Erfolgreich', st_failed: 'Fehlgeschlagen', st_cancelled: 'Abgebrochen', st_running: 'Läuft', st_system: 'System',
      prints: 'Drucke', success_rate: 'Erfolgsrate', time_total: 'Gesamtzeit', filament: 'Filament', cost: 'Kosten', power: 'Strom', avg: 'Ø',
      this_month: 'Diesen Monat', last_month: 'Letzter Monat', last7: 'Letzte 7 Tage',
      trend: 'Verlauf', materials: 'Materialien', machine: 'Maschine', phases: 'Druckphasen', no_filament: 'Druck ohne gespeichertes Filament',
      correlations: 'Erfolgsquote je Slicer-Einstellung', slicer: 'Slicer-Genauigkeit', distributions: 'Verteilungen',
      calendar: 'Wann ich drucke', when: 'Aktivste Stunden', success_weekday: 'Erfolg nach Wochentag', waste: 'Verschwendung', records: 'Rekorde',
      quickstats: 'Schnellstatistiken',
      count: 'Anzahl', success: 'Erfolg', wasted_filament: 'Verschwendetes Filament', wasted_cost: 'Verschwendete Kosten',
      dur_dist: 'Druckdauer', fil_dist: 'Filament', lay_dist: 'Schichten',
      nozzle: 'Düse', bed: 'Bett', chamber: 'Kammer', humidity: 'Feuchte', avg_power: 'Ø Leistung', success_score: 'Qualität', max: 'Max',
      ph_soak: 'Heat-Soak', ph_purge: 'Reinigen', ph_prepare: 'Vorbereiten', ph_print: 'Drucken',
      c_layer_height: 'Schichthöhe', c_infill: 'Infill', c_speed: 'Geschwindigkeit', c_nozzle: 'Düsentemp',
      slicer_faster: 'schneller als geschätzt', slicer_slower: 'länger als geschätzt', slicer_exact: 'exakt wie geschätzt',
      no_aborts: 'Kein Druck im Zeitraum abgebrochen.', more_phases: '{n} weitere Phasen',
      fail_when: 'Fehlschläge nach Phase', fp_pre: 'vor der ersten Schicht',
      fk_titel: 'Feuchte-Gedächtnis', fk_grenze: 'Als zu feucht gilt ab {s} % relativer Luftfeuchte.',
      fk_grenze_kurz: 'Grenze', fk_fach: 'AMS {a} · Fach {n}',
      fk_tage: '{n} Tage darüber', fk_stunden: '{n} h darüber', fk_spitze: 'Spitze {n} %',
      fk_trocken: 'trocken', fk_beobachten: 'im Blick behalten', fk_trocknen: 'trocknen',
      hms_profile: 'Fehler-Steckbrief', hms_prints: 'Drucke', hms_print: 'Druck', hms_failed: 'davon gescheitert',
      hms_more: '{n} weitere Codes zeigen',
      hms_none: 'Keine Druckerfehler im Zeitraum.',
      fp_first: 'in den ersten Schichten', fp_later: 'später', fp_unknown: 'ohne Verlauf',
      based_on: 'aus {n} Drucken', no_data: 'Keine Daten im Zeitraum', loading: 'Lade Detail-Daten…', no_deep: 'Keine Detail-Daten verfügbar',
      rec_longest: 'Längster Druck', rec_most_filament: 'Meiste Filament', rec_most_layers: 'Meiste Schichten', rec_hottest: 'Heißeste Düse',
      day_prints: 'Drucke am {d}', flight: 'Flugschreiber', close: 'Schließen', progress: 'Fortschritt',
      wd: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    },
    en: {
      period: 'Period', r7: '7d', r30: '30d', r90: '90d', r1y: '1y', rall: 'All',
      mat_all: 'All materials', st_all: 'All statuses', st_success: 'Success', st_failed: 'Failed', st_cancelled: 'Cancelled', st_running: 'Running', st_system: 'System',
      prints: 'Prints', success_rate: 'Success rate', time_total: 'Total time', filament: 'Filament', cost: 'Cost', power: 'Power', avg: 'Avg',
      this_month: 'This month', last_month: 'Last month', last7: 'Last 7 days',
      trend: 'Trend', materials: 'Materials', machine: 'Machine', phases: 'Print phases', no_filament: 'Print without saved filament',
      correlations: 'Success rate by slicer setting', slicer: 'Slicer accuracy', distributions: 'Distributions',
      calendar: 'When I print', when: 'Most active hours', success_weekday: 'Success by weekday', waste: 'Waste', records: 'Records',
      quickstats: 'Quick stats',
      count: 'Count', success: 'Success', wasted_filament: 'Wasted filament', wasted_cost: 'Wasted cost',
      dur_dist: 'Print duration', fil_dist: 'Filament', lay_dist: 'Layers',
      nozzle: 'Nozzle', bed: 'Bed', chamber: 'Chamber', humidity: 'Humidity', avg_power: 'Avg power', success_score: 'Quality', max: 'Max',
      ph_soak: 'Heat soak', ph_purge: 'Clean', ph_prepare: 'Prepare', ph_print: 'Print',
      c_layer_height: 'Layer height', c_infill: 'Infill', c_speed: 'Speed', c_nozzle: 'Nozzle temp',
      slicer_faster: 'faster than estimated', slicer_slower: 'slower than estimated', slicer_exact: 'exactly as estimated',
      no_aborts: 'No print was aborted in this period.', more_phases: '{n} more phases',
      fail_when: 'Failures by phase', fp_pre: 'before the first layer',
      fk_titel: 'Humidity memory', fk_grenze: 'Counted as damp from {s} % relative humidity.',
      fk_grenze_kurz: 'Limit', fk_fach: 'AMS {a} · slot {n}',
      fk_tage: '{n} days above', fk_stunden: '{n} h above', fk_spitze: 'peak {n} %',
      fk_trocken: 'dry', fk_beobachten: 'keep an eye on it', fk_trocknen: 'dry it',
      hms_profile: 'Error profile', hms_prints: 'prints', hms_print: 'print', hms_failed: 'of those failed',
      hms_more: 'Show {n} more codes',
      hms_none: 'No printer errors in this period.',
      fp_first: 'in the first layers', fp_later: 'later', fp_unknown: 'no history',
      based_on: 'from {n} prints', no_data: 'No data in this period', loading: 'Loading detail data…', no_deep: 'No detail data available',
      rec_longest: 'Longest print', rec_most_filament: 'Most filament', rec_most_layers: 'Most layers', rec_hottest: 'Hottest nozzle',
      day_prints: 'Prints on {d}', flight: 'Flight recorder', close: 'Close', progress: 'Progress',
      wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    },
    fr: {
      period: 'Période', r7: '7j', r30: '30j', r90: '90j', r1y: '1a', rall: 'Tous',
      mat_all: 'Tous matériaux', st_all: 'Tous statuts', st_success: 'Réussis', st_failed: 'Échoués', st_cancelled: 'Annulés', st_running: 'En cours', st_system: 'Système',
      prints: 'Impressions', success_rate: 'Taux de réussite', time_total: 'Temps total', filament: 'Filament', cost: 'Coût', power: 'Élec.', avg: 'Moy',
      this_month: 'Ce mois', last_month: 'Mois dernier', last7: '7 derniers jours',
      trend: 'Évolution', materials: 'Matériaux', machine: 'Machine', phases: 'Phases', no_filament: 'Impression sans filament enregistré',
      correlations: 'Taux de réussite par réglage', slicer: 'Précision du trancheur', distributions: 'Répartitions',
      calendar: 'Quand j’imprime', when: 'Heures actives', success_weekday: 'Réussite par jour', waste: 'Gaspillage', records: 'Records',
      quickstats: 'Statistiques rapides',
      count: 'Nombre', success: 'Réussite', wasted_filament: 'Filament gaspillé', wasted_cost: 'Coût gaspillé',
      dur_dist: 'Durée', fil_dist: 'Filament', lay_dist: 'Couches',
      nozzle: 'Buse', bed: 'Plateau', chamber: 'Caisson', humidity: 'Humidité', avg_power: 'Élec. moy', success_score: 'Qualité', max: 'Max',
      ph_soak: 'Préchauffe', ph_purge: 'Nettoyage', ph_prepare: 'Préparation', ph_print: 'Impression',
      c_layer_height: 'Hauteur couche', c_infill: 'Remplissage', c_speed: 'Vitesse', c_nozzle: 'Temp buse',
      slicer_faster: 'plus rapide que prévu', slicer_slower: 'plus lent que prévu', slicer_exact: 'exactement comme prévu',
      no_aborts: "Aucune impression annulée sur la période.", more_phases: '{n} autres phases',
      fail_when: 'Échecs par phase', fp_pre: 'avant la première couche',
      fk_titel: 'Mémoire d\u2019humidité', fk_grenze: 'Considéré humide à partir de {s} % d\u2019humidité relative.',
      fk_grenze_kurz: 'Limite', fk_fach: 'AMS {a} · emplacement {n}',
      fk_tage: '{n} jours au-dessus', fk_stunden: '{n} h au-dessus', fk_spitze: 'pic {n} %',
      fk_trocken: 'sec', fk_beobachten: 'à surveiller', fk_trocknen: 'à sécher',
      hms_profile: 'Profil des erreurs', hms_prints: 'impressions', hms_print: 'impression', hms_failed: 'dont échouées',
      hms_more: 'Afficher {n} codes de plus',
      hms_none: 'Aucune erreur imprimante sur la période.',
      fp_first: 'dans les premières couches', fp_later: 'plus tard', fp_unknown: 'sans historique',
      based_on: 'sur {n} impressions', no_data: 'Aucune donnée sur la période', loading: 'Chargement des détails…', no_deep: 'Aucun détail disponible',
      rec_longest: 'Plus longue', rec_most_filament: 'Plus de filament', rec_most_layers: 'Plus de couches', rec_hottest: 'Buse la plus chaude',
      day_prints: 'Impressions le {d}', flight: 'Enregistreur', close: 'Fermer', progress: 'Progression',
      wd: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
    },
    es: {
      period: 'Período', r7: '7d', r30: '30d', r90: '90d', r1y: '1a', rall: 'Todos',
      mat_all: 'Todos materiales', st_all: 'Todos estados', st_success: 'Exitosos', st_failed: 'Fallidos', st_cancelled: 'Cancelados', st_running: 'En curso', st_system: 'Sistema',
      prints: 'Impresiones', success_rate: 'Tasa de éxito', time_total: 'Tiempo total', filament: 'Filamento', cost: 'Coste', power: 'Energía', avg: 'Med',
      this_month: 'Este mes', last_month: 'Mes pasado', last7: 'Últimos 7 días',
      trend: 'Evolución', materials: 'Materiales', machine: 'Máquina', phases: 'Fases', no_filament: 'Impresión sin filamento guardado',
      correlations: 'Tasa de éxito por ajuste', slicer: 'Precisión del slicer', distributions: 'Distribuciones',
      calendar: 'Cuándo imprimo', when: 'Horas activas', success_weekday: 'Éxito por día', waste: 'Desperdicio', records: 'Récords',
      quickstats: 'Estadísticas rápidas',
      count: 'Cantidad', success: 'Éxito', wasted_filament: 'Filamento desperdiciado', wasted_cost: 'Coste desperdiciado',
      dur_dist: 'Duración', fil_dist: 'Filamento', lay_dist: 'Capas',
      nozzle: 'Boquilla', bed: 'Cama', chamber: 'Cámara', humidity: 'Humedad', avg_power: 'Energía med', success_score: 'Calidad', max: 'Máx',
      ph_soak: 'Calentamiento', ph_purge: 'Limpieza', ph_prepare: 'Preparación', ph_print: 'Impresión',
      c_layer_height: 'Altura de capa', c_infill: 'Relleno', c_speed: 'Velocidad', c_nozzle: 'Temp boquilla',
      slicer_faster: 'más rápido que lo estimado', slicer_slower: 'más lento que lo estimado', slicer_exact: 'exacto a lo estimado',
      no_aborts: 'Ninguna impresión cancelada en el período.', more_phases: '{n} fases más',
      fail_when: 'Fallos por fase', fp_pre: 'antes de la primera capa',
      fk_titel: 'Memoria de humedad', fk_grenze: 'Se considera húmedo a partir del {s} % de humedad relativa.',
      fk_grenze_kurz: 'Límite', fk_fach: 'AMS {a} · bandeja {n}',
      fk_tage: '{n} días por encima', fk_stunden: '{n} h por encima', fk_spitze: 'pico {n} %',
      fk_trocken: 'seco', fk_beobachten: 'vigilar', fk_trocknen: 'secar',
      hms_profile: 'Perfil de errores', hms_prints: 'impresiones', hms_print: 'impresión', hms_failed: 'fallidas',
      hms_more: 'Mostrar {n} códigos más',
      hms_none: 'Sin errores de impresora en el período.',
      fp_first: 'en las primeras capas', fp_later: 'más tarde', fp_unknown: 'sin historial',
      based_on: 'de {n} impresiones', no_data: 'Sin datos en el período', loading: 'Cargando detalles…', no_deep: 'Sin detalles disponibles',
      rec_longest: 'Más larga', rec_most_filament: 'Más filamento', rec_most_layers: 'Más capas', rec_hottest: 'Boquilla más caliente',
      day_prints: 'Impresiones el {d}', flight: 'Registrador', close: 'Cerrar', progress: 'Progreso',
      wd: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    },
    it: {
      period: 'Periodo', r7: '7g', r30: '30g', r90: '90g', r1y: '1a', rall: 'Tutti',
      mat_all: 'Tutti i materiali', st_all: 'Tutti gli stati', st_success: 'Riusciti', st_failed: 'Falliti', st_cancelled: 'Annullati', st_running: 'In corso', st_system: 'Sistema',
      prints: 'Stampe', success_rate: 'Tasso di successo', time_total: 'Tempo totale', filament: 'Filamento', cost: 'Costo', power: 'Energia', avg: 'Med',
      this_month: 'Questo mese', last_month: 'Mese scorso', last7: 'Ultimi 7 giorni',
      trend: 'Andamento', materials: 'Materiali', machine: 'Macchina', phases: 'Fasi', no_filament: 'Stampa senza filamento salvato',
      correlations: 'Tasso di successo per impostazione', slicer: 'Precisione slicer', distributions: 'Distribuzioni',
      calendar: 'Quando stampo', when: 'Ore più attive', success_weekday: 'Successo per giorno', waste: 'Spreco', records: 'Record',
      quickstats: 'Statistiche rapide',
      count: 'Numero', success: 'Successo', wasted_filament: 'Filamento sprecato', wasted_cost: 'Costo sprecato',
      dur_dist: 'Durata', fil_dist: 'Filamento', lay_dist: 'Strati',
      nozzle: 'Ugello', bed: 'Piano', chamber: 'Camera', humidity: 'Umidità', avg_power: 'Energia med', success_score: 'Qualità', max: 'Max',
      ph_soak: 'Riscaldamento', ph_purge: 'Pulizia', ph_prepare: 'Preparazione', ph_print: 'Stampa',
      c_layer_height: 'Altezza strato', c_infill: 'Riempimento', c_speed: 'Velocità', c_nozzle: 'Temp ugello',
      slicer_faster: 'più veloce del previsto', slicer_slower: 'più lento del previsto', slicer_exact: 'esatto come previsto',
      no_aborts: 'Nessuna stampa annullata nel periodo.', more_phases: '{n} altre fasi',
      fail_when: 'Fallimenti per fase', fp_pre: 'prima del primo strato',
      fk_titel: 'Memoria di umidità', fk_grenze: 'Considerato umido dal {s} % di umidità relativa.',
      fk_grenze_kurz: 'Limite', fk_fach: 'AMS {a} · scomparto {n}',
      fk_tage: '{n} giorni sopra', fk_stunden: '{n} h sopra', fk_spitze: 'picco {n} %',
      fk_trocken: 'asciutto', fk_beobachten: 'da tenere d\u2019occhio', fk_trocknen: 'da asciugare',
      hms_profile: 'Profilo errori', hms_prints: 'stampe', hms_print: 'stampa', hms_failed: 'di cui fallite',
      hms_more: 'Mostra altri {n} codici',
      hms_none: 'Nessun errore stampante nel periodo.',
      fp_first: 'nei primi strati', fp_later: 'più tardi', fp_unknown: 'senza cronologia',
      based_on: 'da {n} stampe', no_data: 'Nessun dato nel periodo', loading: 'Caricamento dettagli…', no_deep: 'Nessun dettaglio disponibile',
      rec_longest: 'Più lunga', rec_most_filament: 'Più filamento', rec_most_layers: 'Più strati', rec_hottest: 'Ugello più caldo',
      day_prints: 'Stampe del {d}', flight: 'Registratore', close: 'Chiudi', progress: 'Avanzamento',
      wd: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
    }
  };
  function lang() { return (window.i18nManager && window.i18nManager.currentLang) || 'de'; }
  function t(k) { const L = T[lang()] || T.en; return L[k] != null ? L[k] : (T.en[k] != null ? T.en[k] : k); }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const eur = n => (n || 0).toFixed(2) + ' €';
  const clean = s => (window.cleanPrintName ? window.cleanPrintName(s) : (s || '')).replace(/\.(gcode|3mf)$/i, '');
  const LOCALES = { de: 'de-DE', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT' };
  const longDate = k => {
    try { return new Intl.DateTimeFormat(LOCALES[lang()] || 'de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(k + 'T00:00:00')); }
    catch (_) { return k; }
  };
  const hhmm = s => { const t = String(s || ''); return t.length >= 16 ? t.slice(11, 16) : ''; };

  // ---- CSS einmalig injizieren ----
  function injectCss() {
    if (document.getElementById('ad-style')) return;
    const css = `
/* Zwei Spalten statt einer endlosen Saeule: Erfolgsrate und Material stehen
   nebeneinander, breite Sachen (Kennzahlen, Verlauf, Kalender) ueber beide. */
.ad-wrap{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:4px 2px 24px;align-items:start;}
.ad-wrap>.ad-filter,.ad-wrap>.ad-breit{grid-column:1 / -1;}
@media(max-width:1000px){.ad-wrap{grid-template-columns:1fr;}}
/* Stundenband: ein Balken je Stunde. */
.ad-band{display:flex;align-items:flex-end;gap:2px;height:52px;}
.ad-band i{flex:1;background:var(--bg-card-variant);border-radius:2px;min-height:3px;display:block;}
.ad-band-f{display:flex;justify-content:space-between;font-size:10.5px;color:var(--text-secondary);margin-top:4px;}
.ad-leer{flex:1;font-size:12px;color:var(--text-secondary);font-style:italic;}
.ad-mehr{margin-top:8px;}
.ad-mehr>summary{font-size:12px;color:var(--text-secondary);cursor:pointer;margin-bottom:6px;}
.ad-ic{width:16px;height:16px;flex:0 0 auto;opacity:.75;}
.ad-gruppe{display:flex;flex-direction:column;gap:14px;min-width:0;}
.ad-chips2{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;}
.ad-chip2{display:inline-flex;align-items:center;gap:7px;background:rgba(128,128,128,.10);border:1px solid rgba(128,128,128,.18);border-radius:999px;padding:4px 11px;font-size:12.5px;color:var(--text-primary);}
.ad-chip2 i{width:9px;height:9px;border-radius:50%;flex:none;display:block;}
.ad-chip2 b{font-variant-numeric:tabular-nums;}
.ad-saeulen{display:flex;align-items:flex-end;gap:8px;height:104px;margin-top:4px;}
.ad-saeule{flex:1 1 0;max-width:34px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;cursor:pointer;}
.ad-saeule:hover{opacity:.82;}
.ad-stapel{display:flex;flex-direction:column-reverse;border-radius:3px;overflow:hidden;min-height:3px;}
.ad-stapel i{display:block;}
.ad-saeulen-f{display:flex;gap:8px;margin-top:5px;}
.ad-saeulen-f span{flex:1 1 0;max-width:34px;font-size:10.5px;color:var(--text-secondary);text-align:center;white-space:nowrap;overflow:visible;}
.ad-donut{width:104px;height:104px;}
.ad-donut-c b{font-size:21px;}
.ad-herostat{gap:18px;}
.ad-herostat div b{font-size:19px;font-weight:680;font-variant-numeric:tabular-nums;}
.ad-herostat div span{font-size:11.5px;}
/* Fehlschlaege nach Phase — eine ruhige Zeile unter der Quote, mit Trennlinie
   darueber, damit sie nicht als weitere Kennzahl gelesen wird. */
.ad-failphase{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;
  margin-top:12px;padding-top:10px;border-top:1px solid var(--border-color);}
.ad-failphase-t{font-size:11.5px;color:var(--text-secondary);width:100%;}
.ad-failphase-i{font-size:12px;color:var(--text-secondary);white-space:nowrap;}
.ad-failphase-i b{font-size:14px;font-weight:680;font-variant-numeric:tabular-nums;
  margin-right:3px;}
/* Fehler-Steckbrief: eine Zeile je Code, Nummer und Beschreibung links,
   die Zahlen rechts. Keine Tabelle — bei zwoelf Zeilen liest sich das so
   schneller. */
.ad-hms{display:flex;flex-direction:column;gap:2px;}
.ad-hms-z{display:flex;align-items:baseline;justify-content:space-between;
  gap:14px;padding:7px 0;border-bottom:1px solid var(--border-color);}
.ad-hms-z:last-child{border-bottom:0;}
.ad-hms-l{min-width:0;flex:1;}
.ad-hms-l b{font-variant-numeric:tabular-nums;font-size:13px;}
.ad-hms-oft{font-size:11px;color:var(--text-secondary);}
.ad-hms-d{display:block;font-size:11.5px;color:var(--text-secondary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ad-hms-r{display:flex;gap:14px;flex:none;font-size:11.5px;
  color:var(--text-secondary);white-space:nowrap;}
.ad-hms-r b{font-size:13px;font-variant-numeric:tabular-nums;}
.ad-hms-m{opacity:.75;}
.ad-hms-mehr{margin-top:8px;border:0;background:none;padding:0;cursor:pointer;
  font:inherit;font-size:12px;color:var(--accent-blue,#3b82f6);}
.ad-hms-mehr:hover{text-decoration:underline;}
.ad-filter{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:10px 12px;}
.ad-chips{display:inline-flex;gap:2px;background:var(--bg-card-variant);border:1px solid var(--border-color);border-radius:10px;padding:3px;}
.ad-chip{padding:6px 14px;border-radius:8px;border:0;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:13px;font-weight:500;transition:background .12s,color .12s;}
.ad-chip:hover{color:var(--text-primary);}
.ad-chip.active{background:var(--accent-blue,#2196f3);color:#fff;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.25);}
.ad-sel{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;}
.ad-sel select{background:var(--input-bg,#111);color:var(--text-primary);border:1px solid var(--border-color);border-radius:10px;padding:6px 10px;font-size:13px;}
.ad-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:13px 14px;}
/* Gleicher Kartenkopf wie im Druck-Detail: klein, grau, Grossbuchstaben. */
.ad-card h3{margin:0 0 11px;font-size:12px;font-weight:640;letter-spacing:.04em;text-transform:uppercase;display:flex;align-items:center;gap:8px;color:var(--text-secondary);}
.ad-chartbox{position:relative;height:200px;width:100%;}
.ad-chartbox canvas{position:absolute;inset:0;}
.ad-chartbox--hoch{height:230px;}
/* Feuchte-Gedaechtnis */
.ad-sub{font-size:12px;color:var(--text-secondary);margin:-4px 0 10px;}
.ad-fkliste{margin-top:12px;display:flex;flex-direction:column;gap:1px;}
.ad-fkzeile{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:7px;font-size:12.5px;}
.ad-fkzeile:nth-child(odd){background:var(--bg-card-variant,rgba(127,127,127,.06));}
.ad-fkpunkt{flex:none;width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15);}
.ad-fkname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);font-weight:600;}
.ad-fkfach{font-weight:400;color:var(--text-secondary);margin-left:6px;}
.ad-fkzeit,.ad-fkmax{flex:none;color:var(--text-secondary);font-variant-numeric:tabular-nums;}
.ad-fkmax{width:86px;text-align:right;}
.ad-fkurteil{flex:none;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:600;}
.ad-fkurteil--trocken{background:rgba(34,197,94,.16);color:#16a34a;}
.ad-fkurteil--beobachten{background:rgba(245,158,11,.18);color:#b45309;}
.ad-fkurteil--trocknen{background:rgba(239,68,68,.18);color:#dc2626;}
.ad-hero{display:flex;align-items:center;gap:26px;flex-wrap:wrap;}
.ad-donut{position:relative;width:140px;height:140px;flex:0 0 auto;}
.ad-donut.sm{width:128px;height:128px;}
.ad-donut canvas{position:absolute;inset:0;}
.ad-donut-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;text-align:center;}
.ad-donut-c b{font-size:24px;font-weight:700;color:var(--text-primary);line-height:1;}
.ad-donut-c span{font-size:10px;color:var(--text-secondary);margin-top:3px;}
.ad-herostat{display:flex;gap:22px;flex-wrap:wrap;}
.ad-herostat div b{display:block;font-size:22px;color:var(--text-primary);}
.ad-herostat div span{font-size:12px;color:var(--text-secondary);}
.ad-donutrow{display:flex;gap:20px;align-items:center;flex-wrap:wrap;}
.ad-legend{display:flex;flex-direction:column;gap:6px;flex:1;min-width:190px;}
.ad-leg{display:flex;align-items:center;gap:9px;font-size:13px;cursor:pointer;padding:5px 7px;border-radius:8px;transition:background .12s;}
.ad-leg:hover{background:var(--bg-hover);}
.ad-leg.active{background:var(--bg-hover);}
.ad-leg .dot{width:10px;height:10px;border-radius:3px;flex:0 0 auto;}
.ad-leg .nm{color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ad-leg .vl{color:var(--text-secondary);font-size:12px;flex:0 0 auto;}
.ad-leg.active .nm{color:var(--accent-blue,#2196f3);font-weight:700;}
.ad-seg{display:inline-flex;gap:2px;background:var(--bg-card-variant);border:1px solid var(--border-color);border-radius:9px;padding:3px;margin-bottom:14px;}
.ad-seg button{padding:5px 13px;border:0;background:transparent;color:var(--text-secondary);border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:background .12s,color .12s;}
.ad-seg button:hover{color:var(--text-primary);}
.ad-seg button.active{background:var(--accent-blue,#2196f3);color:#fff;}
.ad-statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px;}
.ad-stat{background:var(--bg-card-variant);border:1px solid var(--border-color);border-radius:12px;padding:10px 12px;min-width:0;}
.ad-stat .l{font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ad-stat .v{font-size:17px;font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums;}
.ad-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;}
.ad-kpi{background:var(--bg-card-variant);border:1px solid var(--border-color);border-radius:12px;padding:12px;}
.ad-kpi .v{font-size:20px;font-weight:700;color:var(--text-primary);}
.ad-kpi .l{font-size:11px;color:var(--text-secondary);margin-top:2px;}
.ad-bars{display:flex;flex-direction:column;gap:8px;}
.ad-bar{display:flex;align-items:center;gap:10px;font-size:13px;}
.ad-bar .lbl{width:96px;color:var(--text-secondary);flex:0 0 auto;}
.ad-bar .track{flex:1;height:14px;border-radius:7px;background:var(--bg-card-variant);overflow:hidden;display:block;}
.ad-bar .fill{display:block;height:100%;border-radius:7px;min-width:2px;transition:width .3s ease;}
.ad-bar .val{width:88px;text-align:right;color:var(--text-primary);flex:0 0 auto;}
.ad-bar.click{cursor:pointer;}
.ad-bar.active .lbl{color:var(--accent-blue,#2196f3);font-weight:700;}
.ad-mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;}
.ad-cal{display:flex;gap:3px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;}
.ad-cal .wk{display:flex;flex-direction:column;gap:3px;}
.ad-cell{width:13px;height:13px;border-radius:3px;background:var(--bg-card-variant);cursor:pointer;}
.ad-cal-cap{font-size:11px;color:var(--text-secondary);margin-top:8px;}
.ad-heat{display:grid;grid-template-columns:auto repeat(24,1fr);gap:2px;font-size:9px;align-items:center;}
.ad-heat .hc{height:13px;border-radius:2px;background:var(--bg-card-variant);}
.ad-heat .rh{color:var(--text-secondary);padding-right:4px;}
.ad-records{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;}
.ad-rec{background:var(--bg-card-variant);border:1px solid var(--border-color);border-radius:12px;padding:12px;cursor:pointer;transition:border-color .12s;}
.ad-rec:hover{border-color:var(--accent-blue,#2196f3);}
.ad-rec .rv{font-size:18px;font-weight:700;color:var(--text-primary);}
.ad-rec .rl{font-size:11px;color:var(--text-secondary);}
.ad-rec .rf{font-size:11px;color:var(--accent-blue,#2196f3);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ad-cap{font-size:12px;color:var(--text-secondary);margin-top:8px;}
.ad-empty{color:var(--text-secondary);text-align:center;padding:24px;}
.ad-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;}
.ad-modal .box{background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;max-width:640px;width:100%;max-height:86vh;overflow:auto;padding:0;box-shadow:0 12px 40px rgba(0,0,0,.28);}
.ad-modal-kopf{display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid var(--border-color);}
.ad-modal-kopf h3{margin:0;flex:1;min-width:0;font-size:14px;font-weight:650;letter-spacing:0;text-transform:none;color:var(--text-primary);}
.ad-modal-zu{border:0;background:none;color:var(--text-secondary);font-size:21px;line-height:1;cursor:pointer;padding:0 2px;flex:none;}
.ad-modal-zu:hover{color:var(--text-primary);}
.ad-modal .ad-chips2{padding:13px 15px 0;margin:0;}
.ad-modal-summe{padding:7px 15px 0;font-size:12px;color:var(--text-secondary);font-variant-numeric:tabular-nums;}
.ad-drows{padding:4px 15px 12px;display:flex;flex-direction:column;}
.ad-modal-fuss{display:flex;justify-content:flex-end;padding:12px 15px;border-top:1px solid var(--border-color);}
.ad-modal-fuss .ok{border:1px solid var(--border-color);background:var(--bg-card-variant);color:var(--text-primary);border-radius:9px;padding:7px 16px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;}
.ad-modal-fuss .ok:hover{border-color:var(--accent-blue,#2196f3);}
/* Wie die Zeilen der Druckliste: Vorschau links, duenne Trennlinie zwischen
   den Eintraegen, Flaeche beim Ueberfahren. Kein Kasten je Eintrag — die
   Vorschau setzt sie schon deutlich genug voneinander ab. */
.ad-drow{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:9px;cursor:pointer;
  border-left:3px solid transparent;transition:background .12s;}
.ad-drow + .ad-drow{border-top:1px solid var(--border-color);border-radius:0 9px 9px 0;}
.ad-drow--markiert{border-left-color:var(--c);}
.ad-drow:hover{background:var(--bg-card-variant);}
.ad-drow-bild{width:38px;height:38px;border-radius:8px;flex:none;overflow:hidden;
  background:rgba(127,127,127,.10);border:1px solid var(--border-color);display:grid;place-items:center;}
.ad-drow-bild img{width:100%;height:100%;object-fit:contain;}
.ad-drow .nm{font-size:13px;font-weight:620;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ad-drow .mt{font-size:11.5px;color:var(--text-secondary);margin-top:2px;}
.ad-chev{margin-left:auto;color:var(--text-secondary);opacity:.6;flex:0 0 auto;}
`;
    const el = document.createElement('style'); el.id = 'ad-style'; el.textContent = css;
    document.head.appendChild(el);
  }

  // Linien-Icons statt Emoji: die sahen je nach Betriebssystem anders aus und
  // passten nicht zu den Icons im Rest der Oberflaeche.
  const I = (d) => `<svg class="ad-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  // Die Pfade stehen in icons.js — eine Quelle fuer Web, Android und iOS
  // (tools/gen_skikon_swift.py erzeugt daraus SkIkonPfade.swift).
  const P = n => (window.skIconPfad ? window.skIconPfad(n) : '');
  const ICO = {
    ziel:      I(P('statZiel')),
    balken:    I(P('statBalken')),
    verlauf:   I(P('statVerlauf')),
    spule:     I(P('spule')),
    kiste:     I(P('statKiste')),
    kalender:  I(P('kalender')),
    uhr:       I(P('uhr')),
    haken:     I(P('haken')),
    muell:     I(P('statMuell')),
    pokal:     I(P('statPokal')),
    thermo:    I(P('statThermo')),
    regler:    I(P('statRegler')),
    warnung:   I(P('warnung')),
    // 'tropfen' ist in icons.js in Wahrheit ein Thermometer —
    // der echte Tropfen heisst 'wasser'.
    wasser:    I(P('wasser'))
  };

  const RANGES = [['D7', 'r7'], ['D30', 'r30'], ['D90', 'r90'], ['Y1', 'r1y'], ['ALL', 'rall']];
  const PALETTE = { PLA: '#22c55e', PETG: '#3b82f6', 'PETG-CF': '#2563eb', ABS: '#ef4444', ASA: '#f59e0b', TPU: '#8b5cf6', 'PLA-CF': '#16a34a', '?': '#6b7280' };
  const matColor = m => PALETTE[m] || '#6b7280';
  // Anzeige-Label fürs Material: unbekannt ('?') → "Druck ohne gespeichertes Filament".
  const matLabel = m => (m === '?' || !m) ? t('no_filament') : m;
  const heatColor = (v, max) => v <= 0 ? 'var(--bg-card-variant)' : `rgba(59,130,246,${0.18 + 0.82 * (v / (max || 1))})`;

  function bars(items, opts) {
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="ad-bars">` + items.map(i =>
      `<div class="ad-bar ${i.onclick ? 'click' : ''} ${i.active ? 'active' : ''}" ${i.onclick ? `data-act="${i.onclick}"` : ''}>
        <span class="lbl">${esc(i.label)}${i.active ? ' ✕' : ''}</span>
        <span class="track"><span class="fill" style="width:${Math.max(2, i.value / max * 100)}%;background:${i.color || 'var(--accent-blue,#3b82f6)'}"></span></span>
        <span class="val">${esc(i.valText)}</span>
      </div>`).join('') + `</div>`;
  }

  function render(container, allPrints, opts) {
    injectCss();
    // Vertikalen Abstand zwischen den Abschnitts-Karten sicherstellen: das gap der
    // .ad-wrap-Regel greift nur, wenn der Mount-Container diese Klasse trägt (sonst
    // kleben die .ad-card-Divs aneinander).
    container.classList.add('ad-wrap');
    opts = opts || {};
    const A = window.HistoryAnalytics;
    const filDef = opts.filamentDefaultPerKg || 21;
    const pwr = opts.powerPerKwh || 0.30;
    const state = { range: 'D30', material: null, status: null, matMetric: 'grams' };
    const deepCache = {};
    const DEEP_CAP = 250; // jüngste N Drucke (Web hat keinen lokalen Detail-Cache → Last begrenzen)
    let deep = { samples: 0, loading: false };
    let successChart = null, materialChart = null;
    let deepToken = 0;

    function curResult() { return A.compute(allPrints, { range: state.range, material: state.material, status: state.status }, filDef, pwr); }

    async function loadDeep() {
      const token = ++deepToken;
      // Deep folgt dem AUSGEWÄHLTEN Zeitraum (+ Material/Status), damit Slicer &
      // Co. zur Auswahl passen. Bei großen Zeiträumen auf DEEP_CAP jüngste begrenzt.
      let set = A.filterPrints(allPrints, { range: state.range, material: state.material, status: state.status });
      set = set.slice().sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, DEEP_CAP);
      deep = { samples: set.length, loading: true };
      paintDeep();
      const need = set.filter(p => deepCache[p.id] === undefined);
      let i = 0;
      async function worker() {
        while (i < need.length) {
          const p = need[i++];
          try { deepCache[p.id] = await opts.fetchDetail(p.id); } catch (_) { deepCache[p.id] = null; }
          if (token !== deepToken) return; // Filter gewechselt → abbrechen
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, need.length || 1) }, worker));
      if (token !== deepToken) return; // veraltetes Ergebnis verwerfen
      const details = set.map(p => deepCache[p.id]).filter(Boolean);
      deep = A.aggregateDeep(details); deep.loading = false;
      paintDeep();
    }

    function paint() {
      const r = curResult();
      container.innerHTML = filterBar() + (r.empty
        ? `<div class="ad-card"><div class="ad-empty">${t('no_data')}</div></div>`
        // Reihenfolge so, dass immer zwei zusammengehoerende Karten
        // nebeneinander stehen; nur die wirklich breiten Sachen (Kennzahlen,
        // Phasen, Rekorde, Kalender) gehen ueber beide Spalten.
        : hero(r) + materialsCard(r) + kpis(r)
          + `<div class="ad-card ad-breit" id="ad-hms"></div>`
          + `<div class="ad-card ad-breit" id="ad-feuchte"></div>`
          + trendKarte(r)
          + `<div class="ad-gruppe">${hourHeat(r)}${calendar(r)}</div>`
          + `<div class="ad-card" id="ad-machine"></div><div class="ad-card" id="ad-slicer"></div>`
          + `<div class="ad-card ad-breit" id="ad-phases"></div>`
          + `<div class="ad-card" id="ad-corr"></div>`
          + distributions(r) + successWeekday(r) + waste(r) + records(r));
      wire(r);
      if (!r.empty) { drawHero(r); drawMaterials(r); paintDeep(); ladeHms(); ladeFeuchte(); }
    }

    // ---- Fehler-Steckbrief ----------------------------------------------
    // Die HMS-Fehler liegen seit jeher in der Datenbank und wurden nur
    // einmal live gezeigt. Hier beantworten sie, was man beim naechsten Mal
    // wissen will: kam das schon oefter, bei welchem Material, ging der
    // Druck danach kaputt.
    // ---- Feuchte-Gedaechtnis --------------------------------------------
    // Die Momentfeuchte steht seit jeher in der Oberflaeche, aber niemand
    // konnte sagen, wie lange eine Spule feucht LAG. Genau das steht hier.
    let feuchteChart = null, feuchteToken = 0;
    async function ladeFeuchte() {
      const el = container.querySelector('#ad-feuchte');
      if (!el) return;
      if (!opts.fetchFeuchte) { el.remove(); return; }
      const token = ++feuchteToken;
      // Der Zeitraum folgt der Filterleiste wie beim Steckbrief; „alle"
      // deckelt bei einem Jahr — laenger reicht die Aufzeichnung ohnehin nicht.
      const tage = { r7: 7, r30: 30, r90: 90, r1y: 365, rall: 365 }[state.range] || 30;
      let daten = null;
      try { daten = await opts.fetchFeuchte(tage); } catch (_) { daten = null; }
      if (token !== feuchteToken) return;
      const einheiten = ((daten || {}).einheiten || [])
        .filter(e => (e.verlauf || []).length > 1);
      if (!einheiten.length) { el.remove(); return; }
      zeichneFeuchte(el, daten, einheiten);
    }

    function zeichneFeuchte(el, daten, einheiten) {
      const worte = { trocken: t('fk_trocken'), beobachten: t('fk_beobachten'), trocknen: t('fk_trocknen') };
      const spulen = (daten.spulen || []).slice().sort((a, b) => b.tage_ueber - a.tage_ueber);
      el.innerHTML = `<h3>${ICO.wasser} ${esc(t('fk_titel'))}</h3>`
        + `<div class="ad-sub">${esc(t('fk_grenze').replace('{s}', daten.schwelle))}</div>`
        + `<div class="ad-chartbox ad-chartbox--hoch"><canvas id="ad-feuchte-cv"></canvas></div>`
        + (spulen.length ? `<div class="ad-fkliste">` + spulen.map(sp => `
            <div class="ad-fkzeile">
              <span class="ad-fkpunkt" style="background:${esc(farbeVon(sp.farbe))}"></span>
              <span class="ad-fkname">${esc((sp.typ || '?'))}
                <span class="ad-fkfach">${esc(t('fk_fach').replace('{a}', sp.ams_id).replace('{n}', sp.slot + 1))}</span></span>
              <span class="ad-fkzeit">${esc(sp.tage_ueber >= 1
                  ? t('fk_tage').replace('{n}', sp.tage_ueber.toFixed(sp.tage_ueber < 10 ? 1 : 0))
                  : (sp.stunden_ueber > 0 ? t('fk_stunden').replace('{n}', Math.round(sp.stunden_ueber)) : '–'))}</span>
              <span class="ad-fkmax">${esc(t('fk_spitze').replace('{n}', sp.max))}</span>
              <span class="ad-fkurteil ad-fkurteil--${esc(sp.urteil)}">${esc(worte[sp.urteil] || sp.urteil)}</span>
            </div>`).join('') + `</div>` : '');

      const cv = el.querySelector('#ad-feuchte-cv');
      if (!cv || !window.Chart) return;
      if (feuchteChart) feuchteChart.destroy();
      const FARBEN = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#ef4444', '#06b6d4'];
      const reihen = einheiten.map((e, i) => ({
        label: (e.model || ('AMS ' + e.id)),
        data: (e.verlauf || []).filter(p => p.feuchte != null)
          .map(p => ({ x: new Date(String(p.zeit).replace(' ', 'T')).getTime(), y: p.feuchte })),
        borderColor: FARBEN[i % FARBEN.length], backgroundColor: FARBEN[i % FARBEN.length],
        borderWidth: 2, pointRadius: 0, tension: 0.25,
      }));
      // Die Grenze als eigene Reihe: das Annotation-Plugin ist hier nicht
      // geladen, und ohne die Linie sagt eine Kurve zwischen 30 und 45 nichts.
      const alle = reihen.flatMap(r => r.data.map(p => p.x));
      if (alle.length) {
        reihen.push({
          label: t('fk_grenze_kurz'), borderColor: '#94a3b8', borderDash: [5, 4],
          borderWidth: 1, pointRadius: 0, fill: false,
          data: [{ x: Math.min(...alle), y: daten.schwelle },
                 { x: Math.max(...alle), y: daten.schwelle }],
        });
      }
      feuchteChart = new window.Chart(cv.getContext('2d'), {
        type: 'line',
        data: { datasets: reihen },
        options: {
          responsive: true, maintainAspectRatio: false,
          parsing: false, animation: false,
          scales: {
            x: { type: 'linear', ticks: { callback: v => new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) } },
            y: { min: 0, max: 70, ticks: { callback: v => v + ' %' } },
          },
          plugins: { legend: { display: reihen.length > 1, position: 'bottom' } },
        },
      });
    }

    function farbeVon(hex) {
      const h = String(hex || '').replace('#', '');
      return h ? '#' + h.slice(0, 6) : '#94a3b8';
    }

    let hmsToken = 0;
    async function ladeHms() {
      const el = container.querySelector('#ad-hms');
      if (!el) return;
      if (!opts.fetchHmsProfile) { el.remove(); return; }
      const token = ++hmsToken;
      el.innerHTML = `<h3>${ICO.warnung} ${esc(t('hms_profile'))}</h3>`
        + `<div class="ad-empty">${esc(t('loading'))}</div>`;
      const tage = { r7: 7, r30: 30, r90: 90, r1y: 365, rall: null }[state.range];
      let daten = null;
      try { daten = await opts.fetchHmsProfile(tage); } catch (_) { daten = null; }
      if (token !== hmsToken) return;
      const codes = (daten && daten.codes) || [];
      hmsAlle = false;
      zeichneHms(codes);
    }

    let hmsAlle = false;
    function zeichneHms(codes) {
      const el = container.querySelector('#ad-hms');
      if (!el) return;
      if (!codes.length) {
        el.innerHTML = `<h3>${ICO.warnung} ${esc(t('hms_profile'))}</h3>`
          + `<div class="ad-empty">${esc(t('hms_none'))}</div>`;
        return;
      }
      // Acht. Vom User so festgelegt (27aug26). Darueber hinaus haengt der
      // Rest an "{n} weitere Codes zeigen" — abgeschnitten wird nichts
      // stillschweigend.
      const ZEIGEN = 8;
      const sichtbar = hmsAlle ? codes : codes.slice(0, ZEIGEN);
      const rest = codes.length - sichtbar.length;
      el.innerHTML = `<h3>${ICO.warnung} ${esc(t('hms_profile'))}</h3>`
        + `<div class="ad-hms">${sichtbar.map(c => {
            const quote = c.prints > 0 ? Math.round(c.failed_prints * 100 / c.prints) : 0;
            const ton = quote >= 50 ? '#ef4444' : quote > 0 ? '#f59e0b' : '#94a3b8';
            const wieoft = c.occurrences > c.prints
              ? ` <span class="ad-hms-oft">(${c.occurrences}\u00d7)</span>` : '';
            return `<div class="ad-hms-z">
              <div class="ad-hms-l">
                <b>${esc(c.code)}</b>${wieoft}
                <span class="ad-hms-d">${esc(c.description || '')}</span>
              </div>
              <div class="ad-hms-r">
                <span><b>${c.prints}</b> ${esc(t(c.prints === 1 ? 'hms_print' : 'hms_prints'))}</span>
                <span style="color:${ton}"><b>${c.failed_prints}</b> ${esc(t('hms_failed'))}</span>
                ${c.materials.length ? `<span class="ad-hms-m">${esc(c.materials.join(', '))}</span>` : ''}
              </div></div>`;
          }).join('')}</div>`
        + (rest > 0
            ? `<button class="ad-hms-mehr" id="ad-hms-mehr">${
                esc(t('hms_more').replace('{n}', rest))}</button>`
            : '');
      const mehr = el.querySelector('#ad-hms-mehr');
      if (mehr) mehr.onclick = () => { hmsAlle = true; zeichneHms(codes); };
    }

    function paintDeep() {
      ['machine', 'phases', 'corr', 'slicer'].forEach(id => {
        const el = container.querySelector('#ad-' + id); if (!el) return;
        el.innerHTML = deep.loading ? `<div class="ad-empty">${t('loading')}</div>`
          : (id === 'machine' ? machineBody() : id === 'phases' ? phasesBody() : id === 'corr' ? corrBody() : slicerBody());
      });
    }

    // ---- Sektionen ----
    function filterBar() {
      const mats = curResult().materialOptions || A.materialsOf(allPrints);
      return `<div class="ad-filter">
        <div class="ad-chips">${RANGES.map(([k, l]) => `<button class="ad-chip ${state.range === k ? 'active' : ''}" data-range="${k}">${t(l)}</button>`).join('')}</div>
        <div class="ad-sel">
          <select id="ad-mat"><option value="">${t('mat_all')}</option>${mats.map(m => `<option value="${esc(m)}" ${state.material === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
          <select id="ad-st"><option value="">${t('st_all')}</option>
            <option value="success" ${state.status === 'success' ? 'selected' : ''}>${t('st_success')}</option>
            <option value="failed" ${state.status === 'failed' ? 'selected' : ''}>${t('st_failed')}</option>
            <option value="cancelled" ${state.status === 'cancelled' ? 'selected' : ''}>${t('st_cancelled')}</option>
            <option value="system" ${state.status === 'system' ? 'selected' : ''}>${t('st_system')}</option>
          </select>
        </div></div>`;
    }
    // Saeulen als HTML statt Chart.js: die Balken bekommen eine
    // Maximalbreite (34px), damit aus fuenf Tagen nicht fuenf Flaechen ueber
    // die halbe Karte werden. Erfolg und Misserfolg stecken IM Balken — die
    // zweite Achse mit der Erfolgslinie ist damit ueberfluessig.
    const ST_FARBE = { success: '#22c55e', failed: '#ef4444', cancelled: '#f59e0b', running: '#94a3b8' };
    function trendKarte(r) {
      const maxC = Math.max(1, ...r.trend.map(p => p.count));
      const gesamt = { success: 0, failed: 0, cancelled: 0, running: 0 };
      r.trend.forEach(p => (p.prints || []).forEach(x => {
        if (gesamt[x.status] != null) gesamt[x.status]++;
      }));
      const saeulen = r.trend.map((p, i) => {
        const zaehl = { success: 0, failed: 0, cancelled: 0, running: 0 };
        (p.prints || []).forEach(x => { if (zaehl[x.status] != null) zaehl[x.status]++; });
        const stapel = Object.keys(zaehl).filter(k => zaehl[k] > 0).map(k =>
          `<i style="height:${(zaehl[k] / p.count) * 100}%;background:${ST_FARBE[k]}"></i>`).join('');
        return `<div class="ad-saeule" data-trend="${i}" title="${esc(p.label)}: ${p.count}">
          <span class="ad-stapel" style="height:${(p.count / maxC) * 100}%">${stapel}</span></div>`;
      }).join('');
      const chips = Object.keys(gesamt).filter(k => gesamt[k] > 0).map(k =>
        `<span class="ad-chip2"><i style="background:${ST_FARBE[k]}"></i>${t('st_' + k)} <b>${gesamt[k]}</b></span>`).join('');
      return `<div class="ad-card" id="ad-trend"><h3>${ICO.verlauf} ${t('trend')}</h3>
        <div class="ad-saeulen">${saeulen}</div>
        <div class="ad-saeulen-f">${(() => {
          const jede = Math.ceil(r.trend.length / 8) || 1;
          return r.trend.map((p, i) =>
            `<span>${(i % jede === 0 || i === r.trend.length - 1) ? esc(p.label) : ''}</span>`).join('');
        })()}</div>
        <div class="ad-chips2" style="margin:10px 0 0">${chips}</div></div>`;
    }

    function hero(r) {
      // „Laeuft" gehoert dazu, sonst geht die Summe nicht auf: bei sieben
      // erfolgreichen und einem laufenden Druck standen dort 7 + 0 + 0 = 7,
      // waehrend daneben „8 Drucke" zu lesen war.
      const zahlen = [
        [r.total, t('prints'), ''],
        [r.successful, t('st_success'), '#22c55e'],
        [r.failed, t('st_failed'), r.failed ? '#ef4444' : ''],
        [r.cancelled, t('st_cancelled'), r.cancelled ? '#f59e0b' : ''],
        [r.running || 0, t('st_running'), r.running ? '#3b82f6' : '']
      ].filter(x => x[0] > 0 || x[1] === t('prints') || x[1] === t('st_success'));
      // Wann die Fehlschlaege passierten. Die Quote allein wirft zusammen,
      // was verschiedene Ursachen hat — ein Abbruch vor der ersten Schicht
      // ist kein Filamentproblem.
      const ph = r.fehlerPhasen || {};
      const phasen = [
        [ph.pre_first_layer, t('fp_pre'), '#ef4444'],
        [ph.first_layers, t('fp_first'), '#f59e0b'],
        [ph.later, t('fp_later'), '#a855f7'],
        [ph.unbekannt, t('fp_unknown'), '#94a3b8'],
      ].filter(x => x[0] > 0);
      const phasenZeile = phasen.length
        ? `<div class="ad-failphase"><span class="ad-failphase-t">${esc(t('fail_when'))}</span>${
            phasen.map(([v, l, c]) =>
              `<span class="ad-failphase-i"><b style="color:${c}">${v}</b> ${esc(l)}</span>`).join('')
          }</div>`
        : '';
      return `<div class="ad-card"><h3>${ICO.ziel} ${t('success_rate')}</h3><div class="ad-hero">
        <div class="ad-donut"><canvas id="ad-success-cv"></canvas><div class="ad-donut-c"><b>${r.successRate}%</b></div></div>
        <div class="ad-herostat">${zahlen.map(([v, l, c]) =>
          `<div><b${c ? ` style="color:${c}"` : ''}>${v}</b><span>${esc(l)}</span></div>`).join('')}
        </div></div>${phasenZeile}</div>`;
    }
    function kpis(r) {
      // Ohne Emoji-Kachel davor: acht bunte Symbole in einer Reihe ordneten
      // nichts, der Name steht ohnehin unter jeder Zahl.
      const k = [
        [A.fmtH(r.totalMinutes), t('time_total')],
        [r.filamentKg.toFixed(2) + ' kg', t('filament')],
        [r.powerKwh.toFixed(2) + ' kWh', t('power')],
        [eur(r.totalCost), t('cost')],
        [eur(r.avgCost), t('avg') + ' ' + t('cost')],
        [r.thisMonth + '', t('this_month')],
        [r.last7 + '', t('last7')],
        [r.topMaterial, t('materials')]
      ];
      return `<div class="ad-card ad-breit"><h3>${ICO.balken} ${t('quickstats')}</h3><div class="ad-statgrid">${k.map(x =>
        `<div class="ad-stat"><div class="v">${esc(x[0])}</div><div class="l">${esc(x[1])}</div></div>`).join('')}</div></div>`;
    }
    function materialsCard(r) {
      if (!r.materials.length) return '';
      return `<div class="ad-card" id="ad-materials">${materialsInner(r)}</div>`;
    }
    function materialsInner(r) {
      const metric = state.matMetric;
      const segs = [['grams', t('filament')], ['count', t('prints')]];
      const total = r.materials.reduce((a, m) => a + (metric === 'grams' ? m.grams : m.count), 0) || 1;
      const legend = r.materials.map(m => {
        const val = metric === 'grams' ? m.grams : m.count;
        const pct = Math.round(val / total * 100);
        const valText = metric === 'grams' ? Math.round(m.grams) + ' g' : m.count + '';
        return `<div class="ad-leg ${state.material === m.type ? 'active' : ''}" data-act="mat:${esc(m.type)}">
          <span class="dot" style="background:${matColor(m.type)}"></span>
          <span class="nm">${esc(matLabel(m.type))}</span>
          <span class="vl">${valText} · ${pct}%</span></div>`;
      }).join('');
      const centerB = metric === 'grams' ? Math.round(total) + ' g' : total + '';
      return `<h3>${ICO.spule} ${t('materials')}</h3>
        <div class="ad-seg">${segs.map(([k, l]) => `<button class="${metric === k ? 'active' : ''}" data-metric="${k}">${esc(l)}</button>`).join('')}</div>
        <div class="ad-donutrow">
          <div class="ad-donut sm"><canvas id="ad-mat-cv"></canvas><div class="ad-donut-c"><b>${centerB}</b><span>${r.materials.length} ${t('materials')}</span></div></div>
          <div class="ad-legend">${legend}</div>
        </div>`;
    }
    function distributions(r) {
      const block = (title, bs, color) => `<div style="margin-bottom:10px"><div class="ad-cap" style="margin:0 0 6px">${title}</div>` +
        bars(bs.filter(b => b.count > 0).map(b => ({ label: b.label, value: b.count, valText: b.count + '', color }))) + `</div>`;
      return `<div class="ad-card"><h3>${ICO.kiste} ${t('distributions')}</h3>
        ${block(t('dur_dist'), r.durationBuckets, '#3b82f6')}
        ${block(t('fil_dist'), r.filamentBuckets, '#22c55e')}
        ${block(t('lay_dist'), r.layerBuckets, '#8b5cf6')}</div>`;
    }
    function calendar(r) {
      const days = Object.keys(r.calendar); if (!days.length) return '';
      const maxC = Math.max(...Object.values(r.calendar));
      // Feste Wochenzahl je Zeitraum — exakt wie Android (17/26/52). Zellen haben
      // feste Größe (CSS), werden NICHT auf die Kartenbreite gestreckt (sonst auf
      // dem breiten Desktop riesig).
      const wks = (state.range === 'D90') ? 26 : (state.range === 'Y1' || state.range === 'ALL') ? 52 : 17;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      // Start = Montag der Woche, die (wks-1) Wochen vor der aktuellen Woche liegt.
      const start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (wks - 1) * 7);
      const weeks = [];
      let cur = new Date(start), firstDay = null, lastDay = null;
      for (let w = 0; w < wks; w++) {
        const col = [];
        for (let i = 0; i < 7; i++) {
          const k = fmt(cur), future = cur > today, c = r.calendar[k] || 0;
          if (!future) { if (!firstDay) firstDay = k; lastDay = k; }
          const titelDatum = (() => { const dd = new Date(k + 'T00:00:00');
            return isNaN(dd) ? k : dd.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }); })();
          col.push(`<div class="ad-cell" title="${titelDatum}: ${c}" style="background:${future ? 'transparent' : heatColor(c, maxC)};${future ? 'cursor:default' : ''}" ${future ? '' : `data-day="${k}"`}></div>`);
          cur.setDate(cur.getDate() + 1);
        }
        weeks.push(`<div class="wk">${col.join('')}</div>`);
      }
      // firstDay/lastDay sind ISO-Schluessel (YYYY-MM-DD) — die gehoeren in
      // den Lookup, nicht in die Anzeige.
      const zeigDatum = k => {
        const d = new Date(k + 'T00:00:00');
        return isNaN(d) ? k : d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
      };
      return `<div class="ad-card"><h3>${ICO.kalender} ${t('calendar')}</h3><div class="ad-cal">${weeks.join('')}</div><div class="ad-cal-cap">${zeigDatum(firstDay)} – ${zeigDatum(lastDay)}</div></div>`;
    }
    // Ein Balken je Stunde statt eines 7x24-Rasters. Bei einer Handvoll Drucke
    // waren von 168 Feldern fast alle leer, die Karte trotzdem knapp 400px hoch.
    // Das Band braucht rund 50px und beantwortet dieselbe Frage.
    function hourHeat(r) {
      const je = new Array(24).fill(0);
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) je[h] += r.hourWeekday[d][h];
      const max = Math.max(1, ...je);
      if (!je.some(v => v > 0)) {
        return `<div class="ad-card"><h3>${ICO.uhr} ${t('when')}</h3><div class="ad-empty">${t('no_data')}</div></div>`;
      }
      const balken = je.map((v, h) => v > 0
        ? `<i style="height:${Math.round(18 + 82 * v / max)}%;background:rgba(59,130,246,.8)" title="${h}:00 — ${v}"></i>`
        : '<i title="' + h + ':00 — 0"></i>').join('');
      return `<div class="ad-card"><h3>${ICO.uhr} ${t('when')}</h3>
        <div class="ad-band">${balken}</div>
        <div class="ad-band-f"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div></div>`;
    }
    // Tage ohne Drucke sind KEINE 0 %. Vorher stand fuer jeden druckfreien Tag
    // ein roter Stummel mit 0 % — das las sich, als waere dort alles misslungen.
    function successWeekday(r) {
      const mit = r.successByWeekday
        .map((v, i) => ({ v, i, n: (r.weekday && r.weekday[i]) || 0 }))
        .filter(x => x.n > 0);
      const ohne = r.successByWeekday
        .map((_, i) => i).filter(i => !((r.weekday && r.weekday[i]) || 0));
      const inhalt = mit.length
        ? bars(mit.map(x => ({
            label: t('wd')[x.i], value: x.v, valText: x.v + '% (' + x.n + ')',
            color: x.v >= 90 ? '#22c55e' : x.v >= 70 ? '#f59e0b' : '#ef4444'
          })))
        : `<div class="ad-empty">${t('no_data')}</div>`;
      const rest = ohne.length
        ? `<div class="ad-bar"><span class="lbl">${ohne.map(i => t('wd')[i]).join(' / ')}</span>
             <span class="ad-leer">${t('no_data')}</span></div>`
        : '';
      return `<div class="ad-card"><h3>${ICO.haken} ${t('success_weekday')}</h3>${inhalt}${rest}</div>`;
    }
    // Ohne Abbruch gibt es nichts zu verschwenden. „0 g / 0,00 €" sah aus wie
    // ein gemessener Wert; hier steht stattdessen, dass es keinen Fall gab.
    function waste(r) {
      const abbrueche = (r.failed || 0) + (r.cancelled || 0);
      const inhalt = abbrueche
        ? `<div class="ad-kpis">
             <div class="ad-kpi"><div class="v">${Math.round(r.wastedGrams)} g</div><div class="l">${t('wasted_filament')}</div></div>
             <div class="ad-kpi"><div class="v">${eur(r.wastedCost)}</div><div class="l">${t('wasted_cost')}</div></div></div>`
        : `<div class="ad-empty">${t('no_aborts')}</div>`;
      return `<div class="ad-card"><h3>${ICO.muell} ${t('waste')}</h3>${inhalt}</div>`;
    }
    function records(r) {
      if (!r.records.length) return '';
      return `<div class="ad-card ad-breit"><h3>${ICO.pokal} ${t('records')}</h3><div class="ad-records">` + r.records.map(rec =>
        `<div class="ad-rec" data-rec="${esc(rec.filename)}"><div class="rv">${esc(rec.value)}</div><div class="rl">${t('rec_' + rec.labelKey)}</div><div class="rf">${esc(clean(rec.filename))}</div></div>`
      ).join('') + `</div></div>`;
    }
    // Deep-Bodies
    function machineBody() {
      if (!deep.samples) return `<h3>${ICO.thermo} ${t('machine')}</h3><div class="ad-empty">${t('no_deep')}</div>`;
      const row = (l, v) => v == null ? '' : `<div class="ad-kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
      const d1 = x => x == null ? null : x.toFixed(0);
      return `<h3>${ICO.thermo} ${t('machine')}</h3><div class="ad-mgrid">
        ${row(t('avg') + ' ' + t('nozzle'), d1(deep.avgNozzle) && d1(deep.avgNozzle) + ' °C')}
        ${row(t('max') + ' ' + t('nozzle'), d1(deep.maxNozzle) && d1(deep.maxNozzle) + ' °C')}
        ${row(t('avg') + ' ' + t('bed'), d1(deep.avgBed) && d1(deep.avgBed) + ' °C')}
        ${row(t('max') + ' ' + t('bed'), d1(deep.maxBed) && d1(deep.maxBed) + ' °C')}
        ${row(t('avg') + ' ' + t('chamber'), d1(deep.avgChamberTemp) && d1(deep.avgChamberTemp) + ' °C')}
        ${row(t('chamber') + ' ' + t('humidity'), d1(deep.avgChamberHum) && d1(deep.avgChamberHum) + ' %')}
        ${row(t('avg_power'), d1(deep.avgPowerW) && d1(deep.avgPowerW) + ' W')}
      </div><div class="ad-cap">${t('based_on').replace('{n}', deep.samples)}</div>`;
    }
    function phasesBody() {
      if (!deep.phases || !deep.phases.length) return `<h3>${ICO.uhr} ${t('phases')}</h3><div class="ad-empty">${t('no_deep')}</div>`;
      // Bambu-Stages bringen ihr (uebersetztes) Label mit, Klipper-Phasen
      // laufen weiter ueber die ph_*-Sprachschluessel.
      const zuBalken = p => ({
        label: p.label || t('ph_' + p.key), value: p.avgMin,
        valText: p.avgMin.toFixed(1) + ' min', color: '#8b5cf6'
      });
      // Nur die fuenf laengsten stehen offen. Der Rest lag durchweg unter einer
      // Minute und machte die Karte doppelt so hoch, ohne etwas zu erklaeren.
      const oben = deep.phases.slice(0, 5), rest = deep.phases.slice(5);
      return `<h3>${ICO.uhr} ${t('phases')}</h3>` + bars(oben.map(zuBalken))
        + (rest.length ? `<details class="ad-mehr"><summary>${t('more_phases').replace('{n}', rest.length)}</summary>${bars(rest.map(zuBalken))}</details>` : '')
        + `<div class="ad-cap">${t('based_on').replace('{n}', deep.samples)}</div>`;
    }
    function corrBody() {
      if (!deep.correlations || !deep.correlations.length) return `<h3>${ICO.ziel} ${t('correlations')}</h3><div class="ad-empty">${t('no_deep')}</div>`;
      return `<h3>${ICO.ziel} ${t('correlations')}</h3>` + deep.correlations.map(g =>
        `<div class="ad-cap" style="margin:8px 0 6px;font-weight:600">${t('c_' + g.titleKey)}</div>` + bars(g.buckets.map(b => ({
          label: b.label, value: b.successRate, valText: b.successRate + '% (' + b.count + ')',
          color: b.successRate >= 90 ? '#22c55e' : b.successRate >= 70 ? '#f59e0b' : '#ef4444'
        })))
      ).join('');
    }
    function slicerBody() {
      if (deep.slicerDeviationPct == null) return `<h3>${ICO.regler} ${t('slicer')}</h3><div class="ad-empty">${t('no_deep')}</div>`;
      const dv = deep.slicerDeviationPct;
      const txt = dv > 1 ? `+${dv}% ${t('slicer_slower')}` : dv < -1 ? `${dv}% ${t('slicer_faster')}` : t('slicer_exact');
      const col = Math.abs(dv) <= 5 ? '#22c55e' : Math.abs(dv) <= 15 ? '#f59e0b' : '#ef4444';
      return `<h3>${ICO.regler} ${t('slicer')}</h3><div class="ad-kpi"><div class="v" style="color:${col}">${txt}</div><div class="l">${t('based_on').replace('{n}', deep.slicerSamples)}</div></div>`;
    }

    function drawHero(r) {
      const cv = container.querySelector('#ad-success-cv'); if (!cv || !window.Chart) return;
      if (successChart) successChart.destroy();
      successChart = new window.Chart(cv.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: [t('st_success'), t('st_failed'), t('st_cancelled')],
          datasets: [{ data: [r.successful, r.failed, r.cancelled], backgroundColor: ['#22c55e', '#ef4444', '#f59e0b'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }
      });
    }
    function drawMaterials(r) {
      const cv = container.querySelector('#ad-mat-cv'); if (!cv || !window.Chart || !r.materials.length) return;
      if (materialChart) materialChart.destroy();
      const metric = state.matMetric;
      materialChart = new window.Chart(cv.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: r.materials.map(m => matLabel(m.type)),
          datasets: [{ data: r.materials.map(m => metric === 'grams' ? Math.round(m.grams) : m.count), backgroundColor: r.materials.map(m => matColor(m.type)), borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
      });
    }

    function wire(r) {
      container.querySelectorAll('.ad-saeule').forEach(el => {
        el.onclick = () => {
          const tp = r.trend[Number(el.dataset.trend)];
          if (!tp) return;
          const prints = tp.prints || (tp.key ? (r.dayPrints[tp.key] || []) : []);
          if (!prints.length) return;
          dayDialog(tp.key, prints, r.trendUnit === 'day' ? null : tp.label);
        };
      });
      container.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { state.range = b.dataset.range; paint(); loadDeep(); });
      container.querySelectorAll('[data-metric]').forEach(b => b.onclick = () => { state.matMetric = b.dataset.metric; paint(); });
      const mat = container.querySelector('#ad-mat'); if (mat) mat.onchange = () => { state.material = mat.value || null; paint(); loadDeep(); };
      const st = container.querySelector('#ad-st'); if (st) st.onchange = () => { state.status = st.value || null; paint(); loadDeep(); };
      container.querySelectorAll('[data-act^="mat:"]').forEach(el => el.onclick = () => {
        const m = el.dataset.act.slice(4);
        // Toggle wie Android: Klick auf das bereits aktive Material → zurück zu „alle".
        state.material = (state.material === m) ? null : m;
        paint(); loadDeep();
      });
      container.querySelectorAll('[data-day]').forEach(el => el.onclick = () => dayDialog(el.dataset.day, r.dayPrints[el.dataset.day] || []));
      container.querySelectorAll('[data-rec]').forEach(el => el.onclick = () => { if (opts.onOpenPrint) opts.onOpenPrint(findId(el.dataset.rec)); });
    }
    function findId(filename) { const p = allPrints.find(x => x.filename === filename); return p ? p.id : null; }

    function dayDialog(day, prints, titleOverride) {
      const sorted = prints.slice().sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
      const ok = prints.filter(p => p.status === 'success').length;
      const failed = prints.filter(p => p.status === 'failed').length;
      const canc = prints.filter(p => p.status === 'cancelled').length;
      const grams = prints.reduce((a, p) => a + (+p.filament_grams || 0), 0);
      const mins = prints.reduce((a, p) => a + (+p.duration_minutes || 0), 0);
      const cost = prints.reduce((a, p) => a + (+p.filament_grams || 0) / 1000 * ((p.filament_price_per_kg > 0) ? p.filament_price_per_kg : filDef) + (+p.power_kwh || 0) * pwr, 0);
      const statusLabel = s => s === 'success' ? t('st_success') : s === 'failed' ? t('st_failed') : s === 'cancelled' ? t('st_cancelled') : s;
      const statusColor = s => s === 'success' ? '#22c55e' : s === 'failed' ? '#ef4444' : '#9ca3af';

      const rows = sorted.map(p => {
        const mat = A.materialCategory(p.filament_type);
        const meta = [hhmm(p.start_time), A.fmtH(+p.duration_minutes || 0), mat !== '?' ? mat : null, (+p.filament_grams > 0 ? Math.round(p.filament_grams) + ' g' : null)].filter(Boolean).join('  ·  ');
        // Gleiche Bauform wie die Zeilen der Druckliste: Vorschau, Name,
        // Angaben. Die Vorschau setzt die Eintraege voneinander ab, ohne dass
        // jeder in einen eigenen Kasten muss.
        const abweichend = p.status !== 'success';
        const bild = p.has_thumbnail
          ? `<img src="/api/history/${p.id}/thumbnail" alt=""
                  onerror="this.remove(); this.parentNode.classList.add('kein-bild');">` : '';
        return `<div class="ad-drow${abweichend ? ' ad-drow--markiert' : ''}"
                     style="--c:${statusColor(p.status)}" data-id="${p.id}">
          <div class="ad-drow-bild${p.has_thumbnail ? '' : ' kein-bild'}">${bild}</div>
          <div style="flex:1;min-width:0">
            <div class="nm">${esc(clean(p.filename))}</div>
            <div class="mt">${abweichend ? `<b style="color:${statusColor(p.status)}">${esc(statusLabel(p.status))}</b>  ·  ` : ''}${esc(meta)}</div>
          </div>
          <svg class="ad-ic ad-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </div>`;
      }).join('') || `<div class="ad-empty">—</div>`;

      // Kopf, Chips und Zeilen in derselben Form wie die Karten daneben —
      // vorher waren es Emoji-Pillen und ein blauer Vollflaechen-Knopf.
      const chip = (farbe, text) =>
        `<span class="ad-chip2"><i style="background:${farbe}"></i>${text}</span>`;

      const box = document.createElement('div'); box.className = 'ad-modal';
      box.innerHTML = `<div class="box">
        <div class="ad-modal-kopf">
          ${ICO.kalender}
          <h3>${esc(titleOverride || longDate(day))}</h3>
          <button class="ad-modal-zu" aria-label="${esc(t('close'))}">&times;</button>
        </div>
        <div class="ad-chips2">
          ${chip('var(--text-secondary)', `${t('prints')} <b>${prints.length}</b>`)}
          ${ok ? chip('#22c55e', `${t('st_success')} <b>${ok}</b>`) : ''}
          ${failed ? chip('#ef4444', `${t('st_failed')} <b>${failed}</b>`) : ''}
          ${canc ? chip('#f59e0b', `${t('st_cancelled')} <b>${canc}</b>`) : ''}
        </div>
        <div class="ad-modal-summe">${Math.round(grams)} g · ${A.fmtH(mins)} · ${eur(cost)}</div>
        <div class="ad-drows">${rows}</div>
        <div class="ad-modal-fuss"><button class="ok">${t('close')}</button></div>
      </div>`;
      box.onclick = e => {
        if (e.target === box || e.target.classList.contains('ok')
            || e.target.classList.contains('ad-modal-zu')) box.remove();
      };
      box.querySelectorAll('[data-id]').forEach(el => el.onclick = () => {
        box.remove();
        if (opts.onOpenPrint) opts.onOpenPrint(parseInt(el.dataset.id, 10));
      });
      document.body.appendChild(box);
    }

    paint();
    loadDeep();
  }

  window.AnalyticsDashboard = { render };
})();
