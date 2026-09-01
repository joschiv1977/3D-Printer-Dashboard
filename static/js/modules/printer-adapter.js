/**
 * Printer Adapter — Multi-Printer (Refactor Phase)
 *
 * EINE Action-Funktion, EIN State-Event, KEINE Type-Checks im Frontend.
 *
 * Backend dispatcht via `printer_app.controller.<action>()`. Bambu und
 * Klipper landen am selben Endpoint, nur die Implementation unterscheidet.
 *
 * Frontend nutzt:
 *   - window.printerAdapter.action(name, params)  — generic
 *   - window.printerAdapter.<convenience>()       — typed wrapper
 *
 * Status-Stream:
 *   - SocketIO 'printer_state' (unified Schema)
 *   - State landet in window.activePrinter.state und window.lastPrintData
 *
 * Capability-Visibility:
 *   - data-capability="X"      — sichtbar wenn Backend Cap X hat
 *   - data-not-capability="X"  — versteckt wenn Backend Cap X hat
 *   - data-printer-type="bambu|klipper" — sichtbar nur bei diesem Type
 */

(function () {
    'use strict';

    // -------------------------------------------------------------
    // Default-State (Server-Side Hint im body[data-active-printer])
    // -------------------------------------------------------------
    window.activePrinter = window.activePrinter || {
        type: 'bambu',
        capabilities: [],
        klipperId: null,
    };

    let _readyResolve;
    const readyPromise = new Promise((resolve) => { _readyResolve = resolve; });

    function applyType(info) {
        const type = (info && info.type) || 'bambu';
        window.activePrinter = {
            type: type,
            capabilities: (info && info.capabilities) || [],
            displayName: (info && info.display_name) || null,
            connected: !!(info && info.connected),
            // Klipper-spezifisch fuer Camera-Adapter / Spoolman / Files
            klipperId: window.activePrinter.klipperId,
            klipperBaseUrl: window.activePrinter.klipperBaseUrl,
        };
        document.body.dataset.activePrinter = type;
        document.body.dataset.printerCaps = (info.capabilities || []).join(' ');
        applyCapabilityVisibility();
    }

    async function loadPrinterInfo() {
        try {
            const r = await fetch('/api/printer/info', { credentials: 'same-origin' });
            if (r.ok) applyType(await r.json());
        } catch (e) {
            console.warn('printer-adapter: /api/printer/info failed', e);
        }
        // Klipper-spezifische extras (klipperId fuer Camera-Proxy etc.)
        // — der alte /api/printer-info-Endpoint liefert die separat.
        try {
            const r2 = await fetch('/api/printer-info', { credentials: 'same-origin' });
            if (r2.ok) {
                const d = await r2.json();
                window.activePrinter.klipperId = d.klipper_id || null;
                window.activePrinter.klipperBaseUrl = d.klipper_base_url || null;
            }
        } catch (_) {}
        if (_readyResolve) { _readyResolve(); _readyResolve = null; }
    }

    // -------------------------------------------------------------
    // Capability-Visibility (Phase E)
    // -------------------------------------------------------------
    // DOM-Elemente werden anhand ihres data-Attributs sichtbar/versteckt.
    // Funktioniert idempotent — wird bei printer_state-Events wiederholt.
    function applyCapabilityVisibility() {
        const caps = new Set(window.activePrinter.capabilities || []);
        const type = window.activePrinter.type || 'bambu';

        document.querySelectorAll('[data-capability]').forEach((el) => {
            const need = el.dataset.capability;
            el.toggleAttribute('hidden', !caps.has(need));
        });
        document.querySelectorAll('[data-not-capability]').forEach((el) => {
            const blocker = el.dataset.notCapability;
            el.toggleAttribute('hidden', caps.has(blocker));
        });
        document.querySelectorAll('[data-printer-type]').forEach((el) => {
            const want = el.dataset.printerType;
            el.toggleAttribute('hidden', want !== type);
        });
    }
    window.applyCapabilityVisibility = applyCapabilityVisibility;

    // -------------------------------------------------------------
    // ACTION — der einzige Action-Weg im System
    // -------------------------------------------------------------
    async function action(name, params) {
        // window.apiCall statt rohem fetch: haengt CSRF/Device-Token an und
        // macht bei 401/403 EINEN Token-Refresh + Retry. Ein roher fetch
        // scheiterte nach jedem Server-Neustart dauerhaft mit 403, weil der
        // gespeicherte CSRF-Token serverseitig weg war.
        const r = await window.apiCall('/api/printer/' + encodeURIComponent(name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params || {}),
        });
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok && data.ok, status: r.status, data: data,
                 error: data.error };
    }

    // Convenience-Wrapper — alle delegieren an action(). Frontend kann
    // weiter z.B. `printerAdapter.pause()` schreiben, das ist lesbarer.
    const pause          = ()                  => action('pause');
    const resume         = ()                  => action('resume');
    const stop           = ()                  => action('stop');
    const home           = (axis)              => action('home', { axis: axis || null });
    const move           = (axis, distance)    => action('move', { axis: axis, distance: distance });
    const park           = ()                  => action('park');
    const center         = ()                  => action('center');
    // nozzleId optional (0 rechts, 1 links) — trifft bei Doppelduese die
    // gewuenschte Seite statt der aktiven.
    const setTemp        = (target, value, nozzleId) => action('set_temp',
        nozzleId != null ? { target: target, value: value, nozzle_id: nozzleId }
                         : { target: target, value: value });
    const selectExtruder = (extruderIndex)     => action('select_extruder', { extruder_index: extruderIndex });
    const setSpeed       = (percent)           => action('set_speed', { percent: percent });
    // node nur mitschicken, wenn es nicht das Hauptlicht ist — Klipper kennt
    // den Parameter nicht.
    const setLight       = (on, node)          => action('set_light',
        node ? { on: !!on, node: node } : { on: !!on });
    const setLightBrightness = (frac)          => action('set_light_brightness', { value: frac });
    const setToolheadLed     = (r, g, b)       => action('set_toolhead_led', { r: r, g: g, b: b });
    const extrude        = (length)            => action('extrude', { length: length });
    // ams_id waehlt bei Bambu-Doppelduese die externe Spule (255 links,
    // 254 rechts). NUR mitschicken, wenn es wirklich etwas zu waehlen gibt —
    // Backends mit einer Quelle (Klipper) kennen den Parameter nicht.
    const filamentLoad   = (amsId, slotId)     => action('filament_load',
        amsId != null ? { ams_id: amsId, slot_id: slotId || 0 } : {});
    const filamentUnload = (amsId)             => action('filament_unload', amsId != null ? { ams_id: amsId } : {});
    // Bambu-Style Filament-Change-Episode (Klipper-only).
    // start: nach M600-Pause aufrufen — heizt + entlaedt + wartet.
    // inserted: nach Einlegen aufrufen — laedt + purgt + RESUME.
    // abort: bricht die Episode + den Druck ab.
    const filamentChangeStart    = () => action('filament_change_start');
    const filamentChangeInserted = () => action('filament_change_inserted');
    const filamentChangeAbort    = () => action('filament_change_abort');
    // Nur Bambu (H2/X2/P2-Reihe). Backends ohne diese Faehigkeit antworten 501.
    const setFan         = (fan, percent)      => action('set_fan', { fan: fan, percent: percent });
    // XCam-Ueberwachung (Spaghetti & Co.) — sensitivity optional
    // (never_halt | low | medium | high).
    const setXcam        = (module, on, sensitivity) => action('set_xcam',
        sensitivity ? { module: module, on: !!on, sensitivity: sensitivity }
                    : { module: module, on: !!on });
    // Step loss recovery. Not an xcam module — the printer takes it as
    // print_option (Studio: command_set_printing_option).
    const setPrintOption = (autoRecovery)      => action('set_print_option',
        { auto_recovery: !!autoRecovery });
    const setAirduct     = (mode)              => action('set_airduct', { mode: mode });
    const buzzer         = (mode)              => action('buzzer', { mode: mode });
    // AMS: Trocknen koennen nur AMS 2 Pro und AMS HT (status.ams.units[].can_dry).
    const amsDryStart    = (amsId, temp, duration, filament, rotate) =>
        action('ams_dry_start', { ams_id: amsId, temp: temp, duration: duration,
                                  filament: filament || '', rotate: !!rotate });
    const amsDryStop     = (amsId)             => action('ams_dry_stop', { ams_id: amsId });
    const amsReadRfid    = (amsId, slotId)     => action('ams_read_rfid', { ams_id: amsId, slot_id: slotId });
    // tray_info_idx ist Bambus Profil-Kennung (z.B. GFL99) — ohne sie
    // uebernimmt der Drucker die Einstellung nicht.
    const amsSetFilament = (amsId, trayId, idx, type, color, tempMin, tempMax) =>
        action('ams_set_filament', { ams_id: amsId, tray_id: trayId,
                                     tray_info_idx: idx, tray_type: type, tray_color: color,
                                     ...(tempMin != null ? { nozzle_temp_min: tempMin } : {}),
                                     ...(tempMax != null ? { nozzle_temp_max: tempMax } : {}) });
    const sendGcode      = (script)            => action('gcode', { script: script });
    const startPrint     = (filename, opts)    => action('start_print', { filename: filename, ...(opts || {}) });

    // -------------------------------------------------------------
    // STATE — Unified printer_state Event
    // -------------------------------------------------------------
    function attachSocketHandlers() {
        const tryAttach = () => {
            const s = window.socket;
            if (!s || !s.on) { setTimeout(tryAttach, 500); return; }

            s.on('printer_state', (msg) => {
                if (!msg) return;
                window.activePrinter.state = msg;
                if (msg.light_level != null) window.__lightLevel = msg.light_level;
                if (msg.toolhead_led !== undefined) window.__toolheadLed = msg.toolhead_led;
                if (msg.light_on != null && !window.lightToggleInProgress) {
                    updateLightButtonsFromState(!!msg.light_on);
                }
                if (window.activePrinter.type === 'klipper') {
                    window.lastPrintData = mapStateToPrintData(msg);
                    if (window.socketManager &&
                        typeof window.socketManager.handlePrintUpdate === 'function') {
                        window.socketManager.handlePrintUpdate(
                            window.lastPrintData, 'printer_state');
                    }
                    // Power/Online (switch/mqtt) aus dem Socket in dieselbe Logik
                    // wie der /api/status-Pfad → Power-Button + Online-Cards leben
                    // jetzt vom Socket, der 8s-/api/status-Poll entfällt.
                    if (window.statusManager &&
                        typeof window.statusManager.updateStatusDisplay === 'function') {
                        // Fehler NICHT stumm schlucken — sonst bleiben Buttons
                        // (z.B. SD-Karte) unsichtbar ohne jede Spur in der Konsole.
                        try { window.statusManager.updateStatusDisplay(msg); }
                        catch (e) { console.error('updateStatusDisplay failed:', e); }
                    }
                    updateExtraDetailChips(msg);
                }
            });

            // Legacy: 'klipper_state'-Event hat dasselbe Mapping waehrend
            // der Migrationsphase. Backend wird beides pushen, Frontend
            // toleriert beide.
            s.on('klipper_state', (msg) => {
                if (!msg || window.activePrinter.type !== 'klipper') return;
                window.activePrinter.state = msg;
                if (msg.light_level != null) window.__lightLevel = msg.light_level;
                if (msg.toolhead_led !== undefined) window.__toolheadLed = msg.toolhead_led;
                if (msg.light_on != null && !window.lightToggleInProgress) {
                    updateLightButtonsFromState(!!msg.light_on);
                }
                window.lastPrintData = mapStateToPrintData(msg);
                if (window.socketManager &&
                    typeof window.socketManager.handlePrintUpdate === 'function') {
                    window.socketManager.handlePrintUpdate(
                        window.lastPrintData, 'klipper_state');
                }
                updateExtraDetailChips(msg);
            });
        };
        tryAttach();
    }

    function mapStateToPrintData(s) {
        const stateMap = {
            idle: 'IDLE', preparing: 'PREPARE', printing: 'RUNNING',
            paused: 'PAUSE', finished: 'FINISH', cancelled: 'FAILED',
            error: 'FAILED', offline: 'IDLE', unknown: 'IDLE',
        };
        const remainingMin = Math.round((s.remaining_seconds || 0) / 60);
        const elapsedMin = Math.round((s.elapsed_seconds || 0) / 60);

        // HelixScreen-Pattern: Klipper meldet state=printing schon waehrend
        // START_PRINT-Macro (Heat-Soak/QGL/Mesh/Purge). Wir override gcode_state
        // auf PREPARE solange das Macro `preparation_done=false` meldet.
        // Wenn die Variable fehlt (Slicer-Drucke ohne START_PRINT), nutzen wir
        // print_duration als Fallback (first-extrusion-Signal).
        let resolvedState = s.state || 'unknown';
        if (resolvedState === 'printing') {
            const prepDone = s.print_preparation_done;
            if (prepDone === true) {
                // echter Druck
            } else if (prepDone === false) {
                resolvedState = 'preparing';
            } else {
                const pd = s.print_duration_seconds || 0;
                if (pd <= 0) resolvedState = 'preparing';
            }
        }

        return {
            progress: s.progress_percent || 0,
            layer_num: s.layer_current || 0,
            total_layers: s.layer_total || 0,
            remaining_time: remainingMin,
            print_time: elapsedMin,
            // Roh-Sekunden fuer HelixScreen-PrintCard "1h 52m vergangen".
            // WICHTIG: total_duration_seconds (ab Print-Start inkl. Heat-Soak/
            // QGL/Mesh) — NICHT print_duration_seconds (nur Extrusion).
            // HelixScreen zeigt total_duration, das matched fuer User-Erwartung.
            elapsed_seconds: s.total_duration_seconds
                || s.elapsed_seconds
                || s.print_duration_seconds
                || 0,
            filename: s.current_filename || '',
            // Bambu sendet `thumbnail_base64` direkt im print_progress.
            // Klipper hat keinen Push-Mechanismus — wir verweisen auf
            // unseren Proxy `/api/sd_thumbnail/<filename>` der das aus
            // Moonraker-Metadata holt. socket-manager nimmt thumbnail_url
            // direkt als <img src>.
            thumbnail_url: s.current_filename
                ? '/api/sd_thumbnail/' + encodeURIComponent(s.current_filename)
                : '',
            gcode_state: stateMap[resolvedState] || 'IDLE',
            // status_text MUSS mit "status."-Prefix sein damit
            // translateStatusKey() die Lokalisierung aufloesen kann.
            // Sonst zeigt das Frontend den raw Enum-String ("printing")
            // statt der uebersetzten Variante ("Druckt:").
            status_text: s.status_text || `status.${resolvedState}`,
            // Stage kommt fertig klassifiziert vom Producer (STATUS_CONTRACT §4b):
            // stage_code = 'stage.*' (Client übersetzt), stage_custom = roher M117
            // (Decision A). Hier NUR durchreichen, nicht erneut ableiten.
            stage_code: s.stage_code || '',
            stage_custom: s.stage_custom || '',
            nozzle_temp: s.nozzle_temp,
            nozzle_target: s.nozzle_target,
            bed_temp: s.bed_temp,
            bed_target: s.bed_target,
            chamber_temp: s.chamber_temp,
            // Erweiterte Live-Werte (KlipperScreen-Parity)
            z_position: s.z_position,
            speed_factor_percent: s.speed_factor_percent,
            flow_factor_percent: s.flow_factor_percent,
            filament_used_mm: s.filament_used_mm,
            print_duration_seconds: s.print_duration_seconds,
            total_duration_seconds: s.total_duration_seconds,
            z_offset_mm: s.z_offset_mm,
            display_message: s.display_message,
            // HelixScreen-Parity: Fan-Werte + Objects + Heating-Status-Pills.
            // Klipper-Backend pusht die im SocketIO klipper_state-Event,
            // wir mappen sie 1:1 durch. Vorher flackerten sie nach dem ersten
            // /api/status-Load weg, weil mapStateToPrintData sie nicht weitergab.
            part_fan_percent: s.part_fan_percent != null
                ? Math.round(s.part_fan_percent) : null,
            hotend_fan_percent: s.hotend_fan_percent != null
                ? Math.round(s.hotend_fan_percent) : null,
            aux_fan_percent: s.aux_fan_percent != null
                ? Math.round(s.aux_fan_percent) : null,
            objects_current: s.objects_current,
            objects_total: s.objects_total,
            // Heating-Status (ready/heating/cooling/off) — vom Server in
            // _klipper_publish_state aus |actual-target| abgeleitet.
            // Im klipper_state-Event nicht enthalten → wir leiten clientside ab.
            nozzle_status: deriveHeaterStatus(s.nozzle_temp, s.nozzle_target),
            bed_status: deriveHeaterStatus(s.bed_temp, s.bed_target),
            // Kammer-Pill nur wenn ein ECHTER Kammer-Heizer existiert (wie Android).
            // Sensor-only Kammer (z.B. AHT20) → has_chamber_heater=false → kein Pill
            // (sonst „Heizt", obwohl nur ein temperature_fan-Target gesetzt ist).
            chamber_status: (s.chamber_temp != null && s.has_chamber_heater !== false)
                ? deriveHeaterStatus(s.chamber_temp, s.chamber_target) : null,
            // Temp-Targets (fuer die Aktuelle/Soll-Anzeige)
            nozzle_temp: s.nozzle_temp,
            nozzle_target: s.nozzle_target,
            bed_temp: s.bed_temp,
            bed_target: s.bed_target,
            chamber_temp: s.chamber_temp,
            chamber_target: s.chamber_target,
            // Doppelduese, Luftfuehrung, Tuer, Werkzeug (X2D/H2D & Co.)
            nozzle_temps: s.nozzle_temps,
            nozzle_targets: s.nozzle_targets,
            active_nozzle: s.active_nozzle,
            nozzles: s.nozzles,
            airduct_mode: s.airduct_mode,
            airduct_modes: s.airduct_modes,
            door_open: s.door_open,
            tool_module: s.tool_module,
            ams_units: (s.ams && s.ams.units) || s.ams_units || [],
            // Was der Drucker kann — Profil und Live-Zustand serverseitig
            // zusammengefuehrt (services/printer_capabilities.py).
            capabilities: s.capabilities || null,
            chamber_humidity: s.chamber_humidity,
            has_chamber_heater: s.has_chamber_heater,
            speed_percent: s.speed_factor_percent,
            // ETA-Uhrzeit + Speed-Level kommen jetzt aus dem Socket (vorher nur
            // /api/status) → ~Fertig-Zeit und „Standard/Sport…" auch live.
            eta_time: s.eta_time || '',
            speed_level: s.speed_level,
            speed_level_text: s.speed_level_text,
            // filament_display kommt jetzt AUCH über SocketIO printer_state
            // (Adapter publishState resolvet Spoolman/Metadaten). Den Socket-Wert
            // bevorzugen; fehlt er mal in einem Update, den letzten bekannten Wert
            // behalten, damit das Filament nicht auf "--" flackert.
            filament_display: s.filament_display
                || (window.lastPrintData && window.lastPrintData.filament_display)
                || '',
            filament_name: (window.lastPrintData &&
                (window.lastPrintData.filament_display ||
                 window.lastPrintData.filament_name)) || '',
            // bed_mesh kommt jetzt AUCH über SocketIO printer_state (localhost →
            // die Matrix-Größe ist unkritisch). Socket-Wert bevorzugen, sonst den
            // letzten bekannten behalten, damit die Heatmap nicht flackert.
            bed_mesh: s.bed_mesh
                || (window.lastPrintData && window.lastPrintData.bed_mesh)
                || null,
        };
    }

    // Heating-Status-Ableitung (spiegelt _heater_state in web_app.py).
    // Ready: target>0 und |actual-target|<1.5; Heating: target>actual+1.5;
    // Cooling: target==0 und actual>30; Off: target==0 und actual<=30.
    function deriveHeaterStatus(actual, target) {
        const a = Number(actual) || 0;
        const t = Number(target) || 0;
        if (t > 0) {
            return Math.abs(a - t) < 1.5 ? 'ready' : 'heating';
        }
        return a > 30 ? 'cooling' : 'off';
    }

    // KlipperScreen-Parity Detail-Chips: Z-Hoehe, Speed-Faktor, Flow-Faktor,
    // Filament-Verbrauch, ETA als Uhrzeit, Z-Offset, Display-Message.
    // Zeige Chip nur wenn Wert != null/undefined (sonst eh nicht aussagekraeftig).
    function updateExtraDetailChips(s) {
        const setChip = (chipId, valueId, value, format) => {
            const chip = document.getElementById(chipId);
            const val = document.getElementById(valueId);
            if (!chip || !val) return;
            if (value == null || value === '') {
                chip.style.display = 'none';
                return;
            }
            val.textContent = format ? format(value) : String(value);
            chip.style.display = '';
        };

        setChip('z-height-info', 'z-height-value', s.z_position,
                v => v.toFixed(2) + ' mm');
        setChip('flow-info', 'flow-value', s.flow_factor_percent,
                v => v + '%');
        setChip('filament-used-info', 'filament-used-value', s.filament_used_mm,
                v => v >= 1000 ? (v / 1000).toFixed(2) + ' m' : Math.round(v) + ' mm');
        // Z-Offset (Babystepping) nur zeigen wenn live aktiv. 0 = kein
        // Babystepping → Chip ausblenden, sonst stehen da konstant
        // "+0.000 mm" und es wirkt wie ein toter Wert.
        setChip('z-offset-info', 'z-offset-value',
                (s.z_offset_mm != null && Math.abs(s.z_offset_mm) > 0.0001)
                    ? s.z_offset_mm : null,
                v => (v >= 0 ? '+' : '') + v.toFixed(3) + ' mm');
        setChip('display-message-info', 'display-message-value',
                (s.display_message && s.display_message !== 'Printing') ? s.display_message : null);

        // ETA als Uhrzeit (jetzt + remaining_seconds), nur wenn aktiv druckend
        const remSec = s.remaining_seconds;
        if (remSec && remSec > 0 && s.state === 'printing') {
            const eta = new Date(Date.now() + remSec * 1000);
            const h = String(eta.getHours()).padStart(2, '0');
            const m = String(eta.getMinutes()).padStart(2, '0');
            const sameDay = eta.toDateString() === new Date().toDateString();
            const txt = sameDay ? `${h}:${m}` : `${h}:${m} (${eta.toLocaleDateString('de-DE')})`;
            setChip('eta-info', 'eta-value', txt);
        } else {
            setChip('eta-info', 'eta-value', null);
        }

        // Speed-Faktor: existing #speed-value chip — wir aktualisieren mit
        // dem live-Wert (statt Bambu-Level-Text wenn der nicht gesetzt ist).
        if (s.speed_factor_percent != null) {
            const sv = document.getElementById('speed-value');
            if (sv && (!sv.textContent || sv.textContent.includes('--'))) {
                sv.textContent = s.speed_factor_percent + '%';
            } else if (sv && window.activePrinter.type === 'klipper') {
                // Im Klipper-Mode immer den Live-Wert
                sv.textContent = s.speed_factor_percent + '%';
            }
        }
    }
    window._updateExtraDetailChips = updateExtraDetailChips;

    // Light-Button-Renderer (semantisch — die einzige UI-Stelle die
    // den Light-Status anhand des Backend-Werts setzt).
    function updateLightButtonsFromState(isOn) {
        const texts = window.texts || {};
        // Beschriftung ist die Handlung: leuchtet es, steht "Licht aus" drauf.
        const label = isOn ? (texts.light_off || 'Licht aus')
                           : (texts.light_on  || 'Licht an');

        ['light-btn', 'light-btn-mobile'].forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.style.visibility = '';
            btn.className = isOn ? 'control-btn warning' : 'control-btn';
            btn.innerHTML = window.skIcon('licht') + '<span>' + label + '</span>';
        });

        // Knopf in der Uebersicht des Steuerungs-Fensters …
        const uebersicht = document.getElementById('ov-light-btn');
        if (uebersicht) {
            uebersicht.classList.toggle('ov-on', isOn);
            const lbl = document.getElementById('ov-light-label');
            if (lbl) lbl.textContent = label;
        }
        // … und der am Kamerabild, der in jedem Reiter erreichbar ist.
        const amBild = document.getElementById('ctrl-camera-light');
        if (amBild) {
            amBild.classList.toggle('ctrl-licht-an', isOn);
            const lbl = document.getElementById('ctrl-camera-light-label');
            if (lbl) lbl.textContent = label;
        }
    }

    // -------------------------------------------------------------
    // LICHT-HELLIGKEIT — Rechtsklick (Desktop) + Long-Press (Touch) auf den
    // Licht-Button öffnet einen Helligkeits-Slider (wie Android Long-Press).
    // -------------------------------------------------------------
    function openLightBrightnessDialog() {
        const texts = window.texts || {};
        const cur = (typeof window.__lightLevel === 'number') ? window.__lightLevel : 1;
        let pct = Math.round(Math.max(0, Math.min(1, cur)) * 100);
        const old = document.getElementById('light-bright-modal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'light-bright-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);';
        modal.innerHTML =
            '<div style="background:var(--bg-secondary,#1c1f26);border:1px solid var(--border-color,#2a2f3a);border-radius:16px;padding:22px;width:min(360px,90vw);box-shadow:0 12px 40px rgba(0,0,0,.4);">' +
              '<div style="font-size:17px;font-weight:700;margin-bottom:4px;color:var(--text-primary);">' + window.skIcon('licht') + ' ' + (texts.light_brightness || 'Licht-Helligkeit') + '</div>' +
              '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">' + (texts.light_brightness_hint || 'Helligkeit der Drucker-Beleuchtung') + '</div>' +
              '<div style="display:flex;align-items:center;gap:12px;">' +
                '<input type="range" id="light-bright-slider" min="0" max="100" step="1" value="' + pct + '" style="flex:1;accent-color:var(--accent-blue,#667eea);">' +
                '<span id="light-bright-val" style="min-width:48px;text-align:right;font-weight:700;font-size:15px;color:var(--text-primary);">' + pct + '%</span>' +
              '</div>' +
              buildToolheadLedSection(texts) +
              '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">' +
                '<button class="modal-btn modal-btn-cancel" id="light-bright-off" type="button">' + (texts.light_off || 'Aus') + '</button>' +
                '<button class="modal-btn modal-btn-primary" id="light-bright-close" type="button">' + (texts.close || texts.done || 'Fertig') + '</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(modal);

        const slider = modal.querySelector('#light-bright-slider');
        const valLbl = modal.querySelector('#light-bright-val');
        let t = null;
        const send = (v) => { clearTimeout(t); t = setTimeout(() => { setLightBrightness(v / 100); }, 120); };
        slider.addEventListener('input', () => { valLbl.textContent = slider.value + '%'; send(parseInt(slider.value, 10)); });
        modal.querySelector('#light-bright-off').addEventListener('click', () => {
            slider.value = 0; valLbl.textContent = '0%'; setLightBrightness(0);
        });
        wireToolheadLedSection(modal);
        const close = () => modal.remove();
        modal.querySelector('#light-bright-close').addEventListener('click', close);
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    // -------------------------------------------------------------
    // TOOLHEAD-LED — RGB-Sektion im Helligkeits-Dialog (nur wenn der
    // Drucker ein `neopixel toolhead_rgb` meldet; sonst unsichtbar).
    // Basisfarbe (Presets + freies Farbfeld) × Helligkeits-Slider → SET_LED.
    // -------------------------------------------------------------
    const TOOLHEAD_PRESETS = ['#ffffff', '#ffb46b', '#ff2020', '#20c020', '#2060ff', '#b040ff'];

    function buildToolheadLedSection(texts) {
        const led = window.__toolheadLed;
        if (!led) return '';
        const max = Math.max(led.r, led.g, led.b);
        const pct = Math.round(max * 100);
        // Basisfarbe = auf volle Helligkeit normierte aktuelle Farbe (aus = weiß)
        const norm = (c) => Math.round((max > 0 ? c / max : 1) * 255);
        const hex = '#' + [led.r, led.g, led.b].map((c) =>
            norm(c).toString(16).padStart(2, '0')).join('');
        const swatches = TOOLHEAD_PRESETS.map((c) =>
            '<button type="button" class="th-led-preset" data-color="' + c + '" ' +
            'style="width:26px;height:26px;border-radius:50%;border:2px solid var(--border-color,#2a2f3a);background:' + c + ';cursor:pointer;padding:0;"></button>'
        ).join('');
        return '' +
            '<div style="border-top:1px solid var(--border-color,#2a2f3a);margin-top:18px;padding-top:14px;">' +
              '<div style="font-size:15px;font-weight:700;margin-bottom:10px;color:var(--text-primary);"><svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6l1 5H8z"/><path d="M8 7h8v3a4 4 0 0 1-8 0z"/><path d="M12 14v8"/></svg> ' + (texts.toolhead_led || 'Toolhead-LED') + '</div>' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">' +
                swatches +
                '<input type="color" id="th-led-color" value="' + hex + '" style="width:34px;height:30px;border:none;background:none;cursor:pointer;padding:0;">' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:12px;">' +
                '<input type="range" id="th-led-bright" min="0" max="100" step="1" value="' + pct + '" style="flex:1;accent-color:var(--accent-blue,#667eea);">' +
                '<span id="th-led-val" style="min-width:48px;text-align:right;font-weight:700;font-size:15px;color:var(--text-primary);">' + pct + '%</span>' +
              '</div>' +
            '</div>';
    }

    function wireToolheadLedSection(modal) {
        const bright = modal.querySelector('#th-led-bright');
        if (!bright) return; // Sektion nicht gerendert (kein toolhead_rgb)
        const colorInp = modal.querySelector('#th-led-color');
        const valLbl = modal.querySelector('#th-led-val');
        let t = null;
        const sendLed = () => {
            const hex = colorInp.value;
            const frac = parseInt(bright.value, 10) / 100;
            const ch = (i) => (parseInt(hex.slice(i, i + 2), 16) / 255) * frac;
            clearTimeout(t);
            t = setTimeout(() => { setToolheadLed(ch(1), ch(3), ch(5)); }, 120);
        };
        bright.addEventListener('input', () => { valLbl.textContent = bright.value + '%'; sendLed(); });
        colorInp.addEventListener('input', () => {
            if (parseInt(bright.value, 10) === 0) { bright.value = 100; valLbl.textContent = '100%'; }
            sendLed();
        });
        modal.querySelectorAll('.th-led-preset').forEach((btn) => {
            btn.addEventListener('click', () => {
                colorInp.value = btn.dataset.color;
                if (parseInt(bright.value, 10) === 0) { bright.value = 100; valLbl.textContent = '100%'; }
                sendLed();
            });
        });
    }

    function setupLightBrightnessTriggers() {
        if (window.__lightBrightSetup) return;
        window.__lightBrightSetup = true;
        const onLightBtn = (el) => el && el.closest && el.closest('#light-btn, #light-btn-mobile');
        // Nur bei dimmbarem Licht (light_level gemeldet) — Bambu/nicht-dimmbar: kein Dialog.
        const canDim = () => typeof window.__lightLevel === 'number';
        // Rechtsklick (Desktop) → Helligkeits-Dialog statt Browser-Kontextmenü.
        document.addEventListener('contextmenu', (e) => {
            if (onLightBtn(e.target)) { e.preventDefault(); if (canDim()) openLightBrightnessDialog(); }
        });
        // Long-Press (Touch) → Dialog; den folgenden Toggle-Click unterdrücken.
        let lpTimer = null, lpFired = false;
        document.addEventListener('touchstart', (e) => {
            if (!onLightBtn(e.target) || !canDim()) return;
            lpFired = false;
            lpTimer = setTimeout(() => { lpFired = true; openLightBrightnessDialog(); }, 550);
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            clearTimeout(lpTimer);
            if (lpFired && onLightBtn(e.target)) { e.preventDefault(); lpFired = false; }
        }, { passive: false });
        document.addEventListener('touchmove', () => clearTimeout(lpTimer), { passive: true });
    }
    if (document.readyState !== 'loading') setupLightBrightnessTriggers();
    else document.addEventListener('DOMContentLoaded', setupLightBrightnessTriggers);

    // -------------------------------------------------------------
    // FILE OPERATIONS — unified ueber /api/printer/files/*
    // -------------------------------------------------------------
    // opts: { fresh, page, per_page, sort, dir, search, only_new }
    // Suche, Sortierung und Seiten macht der Adapter serverseitig ueber den
    // ganzen Bestand — die Antwort traegt total/page/pages/per_page, die
    // die Blaetterleiste braucht.
    async function listFiles(opts) {
        const o = opts || {};
        const p = new URLSearchParams();
        if (o.fresh) p.set('fresh', '1');
        if (o.page) p.set('page', o.page);
        if (o.per_page) p.set('per_page', o.per_page);
        if (o.sort) p.set('sort', o.sort);
        if (o.dir) p.set('dir', o.dir);
        if (o.search) p.set('search', o.search);
        if (o.only_new) p.set('only_new', 'true');
        const q = p.toString();
        const r = await fetch('/api/printer/files' + (q ? '?' + q : ''), { credentials: 'same-origin' });
        const d = await r.json().catch(() => ({}));
        return {
            ok: r.ok && d.ok, status: r.status, files: d.files || [], error: d.error,
            total: d.total, page: d.page, pages: d.pages, per_page: d.per_page,
        };
    }
    async function fileMetadata(path) {
        const r = await fetch('/api/printer/files/metadata?path=' + encodeURIComponent(path),
                              { credentials: 'same-origin' });
        const d = await r.json().catch(() => ({}));
        return { ok: r.ok && d.ok, status: r.status, metadata: d.metadata, error: d.error };
    }
    async function uploadFile(file, opts) {
        const startAfter = !!(opts && opts.startAfter);
        const fd = new FormData();
        fd.append('file', file);
        const url = '/api/printer/files/upload' + (startAfter ? '?start=1' : '');
        const r = await window.apiCall(url, { method: 'POST', body: fd });
        const d = await r.json().catch(() => ({}));
        return { ok: r.ok && d.ok, status: r.status, upload: d.upload, error: d.error };
    }
    async function deleteFile(path) {
        const r = await window.apiCall('/api/printer/files', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path }),
        });
        const d = await r.json().catch(() => ({}));
        return { ok: r.ok && d.ok, status: r.status, error: d.error };
    }

    // -------------------------------------------------------------
    // Open the printer's native web UI (Mainsail/Fluidd fuer Klipper).
    // Bambu hat keine local-Web-UI — no-op.
    // -------------------------------------------------------------
    function openPrinterWeb() {
        if (window.activePrinter.type !== 'klipper') return;
        // Nur bei eingeschaltetem Drucker — Mainsail ist sonst nicht erreichbar.
        // Ohne eingerichtete Steckdose entscheidet die Verbindung -- die
        // Antwort steht in status-manager.js, hier wird sie nur gelesen.
        const printerOnline = (typeof window.druckerDa === 'boolean') ? window.druckerDa
            : (window.lastKnownSwitchState === 'on' && window.lastMqttStatus === true);
        if (!printerOnline) {
            const texts = window.texts || {};
            skToast(texts.printer_offline_no_web || 'Drucker aus — Web-UI nicht erreichbar', 'warning');
            return;
        }
        const url = window.activePrinter.klipperBaseUrl;
        if (!url) return;
        // klipperBaseUrl zeigt auf Moonraker (Port 7125). Die native Web-UI
        // (Mainsail/Fluidd) läuft aber auf Port 80 → den Moonraker-Port strippen
        // und nur Host öffnen, sonst landet man auf der nackten Moonraker-Seite.
        let target = url;
        try {
            const u = new URL(url);
            target = u.protocol + '//' + u.hostname + '/';
        } catch (_) { /* Fallback: Original-URL */ }
        window.open(target, '_blank', 'noopener');
    }
    window.openPrinterWeb = openPrinterWeb;

    // -------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------
    window.printerAdapter = {
        // Generic
        action: action,
        // Convenience
        pause: pause,
        resume: resume,
        stop: stop,
        home: home,
        move: move,
        park: park,
        center: center,
        setTemp: setTemp,
        selectExtruder: selectExtruder,
        setSpeed: setSpeed,
        setLight: setLight,
        setLightBrightness: setLightBrightness,
        setToolheadLed: setToolheadLed,
        extrude: extrude,
        filamentLoad: filamentLoad,
        filamentUnload: filamentUnload,
        filamentChangeStart: filamentChangeStart,
        filamentChangeInserted: filamentChangeInserted,
        filamentChangeAbort: filamentChangeAbort,
        setFan: setFan,
        setXcam: setXcam,
        setPrintOption: setPrintOption,
        setAirduct: setAirduct,
        buzzer: buzzer,
        amsDryStart: amsDryStart,
        amsDryStop: amsDryStop,
        amsReadRfid: amsReadRfid,
        amsSetFilament: amsSetFilament,
        gcode: sendGcode,
        startPrint: startPrint,
        // Files
        listFiles: listFiles,
        fileMetadata: fileMetadata,
        uploadFile: uploadFile,
        deleteFile: deleteFile,
        // Meta
        reload: loadPrinterInfo,
        ready: readyPromise,
        applyVisibility: applyCapabilityVisibility,
        get type() { return window.activePrinter.type; },
        get isKlipper() { return window.activePrinter.type === 'klipper'; },
        get isBambu() { return window.activePrinter.type === 'bambu'; },
        hasCapability: function (cap) {
            return (window.activePrinter.capabilities || []).indexOf(cap) >= 0;
        },
    };

    // -------------------------------------------------------------
    // Init
    // -------------------------------------------------------------
    function init() {
        loadPrinterInfo();
        attachSocketHandlers();
        applyCapabilityVisibility();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
