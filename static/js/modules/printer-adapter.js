/**
 * Printer Adapter — Multi-Printer (Refactor Phase)
 *
 * ONE action function, ONE state event, NO type checks in the frontend.
 *
 * The backend dispatches via `printer_app.controller.<action>()`. Bambu and
 * Klipper land on the same endpoint, only the implementation differs.
 *
 * Frontend uses:
 *   - window.printerAdapter.action(name, params)  — generic
 *   - window.printerAdapter.<convenience>()       — typed wrapper
 *
 * Status stream:
 *   - SocketIO 'printer_state' (unified schema)
 *   - State lands in window.activePrinter.state and window.lastPrintData
 *
 * Capability visibility:
 *   - data-capability="X"      — visible when the backend has capability X
 *   - data-not-capability="X"  — hidden when the backend has capability X
 *   - data-printer-type="bambu|klipper" — visible only for this type
 */

(function () {
    'use strict';

    // -------------------------------------------------------------
    // Default state (server-side hint in body[data-active-printer])
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
            // Klipper-specific, for camera adapter / Spoolman / files
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
        // Klipper-specific extras (klipperId for the camera proxy etc.)
        // — the old /api/printer-info endpoint delivers those separately.
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
    // Capability visibility (Phase E)
    // -------------------------------------------------------------
    // DOM elements are shown/hidden based on their data attribute.
    // Idempotent — repeated on printer_state events.
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
    // ACTION — the only action path in the system
    // -------------------------------------------------------------
    async function action(name, params) {
        // Use window.apiCall instead of a raw fetch: it attaches the CSRF/device
        // token and does ONE token refresh + retry on 401/403. A raw fetch
        // would fail permanently with 403 after every server restart, because the
        // stored CSRF token was gone server-side.
        const r = await window.apiCall('/api/printer/' + encodeURIComponent(name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params || {}),
        });
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok && data.ok, status: r.status, data: data,
                 error: data.error };
    }

    // Convenience wrappers — all delegate to action(). The frontend can
    // still write e.g. `printerAdapter.pause()`, which is more readable.
    const pause          = ()                  => action('pause');
    const resume         = ()                  => action('resume');
    const stop           = ()                  => action('stop');
    // Every move that is NOT an absolute target invalidates the map's mark:
    // the head ends up somewhere nobody named, so a mark left standing would
    // claim a position that was never sent. Clearing it here covers all four
    // at once instead of at every call site.
    const forgetMark = (r) => {
        if (window.clearMovementMark) window.clearMovementMark();
        return r;
    };
    const home           = (axis)              => action('home', { axis: axis || null }).then(forgetMark);
    const move           = (axis, distance)    => action('move', { axis: axis, distance: distance }).then(forgetMark);
    const park           = ()                  => action('park').then(forgetMark);
    const center         = ()                  => action('center').then(forgetMark);
    // Absolute target in machine coordinates — the map view sends a point on
    // the bed instead of a step. Axes left out stay where they are.
    const moveTo         = (target)            => action('move_to', {
        x: target.x != null ? target.x : null,
        y: target.y != null ? target.y : null,
        z: target.z != null ? target.z : null,
    });
    // nozzleId optional (0 right, 1 left) — for a dual nozzle, targets the
    // desired side instead of the active one.
    const setTemp        = (target, value, nozzleId) => action('set_temp',
        nozzleId != null ? { target: target, value: value, nozzle_id: nozzleId }
                         : { target: target, value: value });
    const selectExtruder = (extruderIndex)     => action('select_extruder', { extruder_index: extruderIndex });
    const setSpeed       = (percent)           => action('set_speed', { percent: percent });
    // Only send node when it's not the main light — Klipper doesn't
    // know this parameter.
    const setLight       = (on, node)          => action('set_light',
        node ? { on: !!on, node: node } : { on: !!on });
    const setLightBrightness = (frac)          => action('set_light_brightness', { value: frac });
    const setToolheadLed     = (r, g, b)       => action('set_toolhead_led', { r: r, g: g, b: b });
    const extrude        = (length)            => action('extrude', { length: length });
    // ams_id selects the external spool on a Bambu dual nozzle (255 left,
    // 254 right). Only send it when there is actually something to select —
    // backends with a single source (Klipper) don't know this parameter.
    const filamentLoad   = (amsId, slotId)     => action('filament_load',
        amsId != null ? { ams_id: amsId, slot_id: slotId || 0 } : {});
    const filamentUnload = (amsId)             => action('filament_unload', amsId != null ? { ams_id: amsId } : {});
    // Bambu-style filament-change episode (Klipper-only).
    // start: call after the M600 pause — heats + unloads + waits.
    // inserted: call after inserting — loads + purges + RESUME.
    // abort: cancels the episode + the print.
    const filamentChangeStart    = () => action('filament_change_start');
    const filamentChangeInserted = () => action('filament_change_inserted');
    const filamentChangeAbort    = () => action('filament_change_abort');
    // Bambu only (H2/X2/P2 series). Backends without this capability respond 501.
    const setFan         = (fan, percent)      => action('set_fan', { fan: fan, percent: percent });
    // XCam monitoring (spaghetti detection & co.) — sensitivity optional
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
    // AMS: only AMS 2 Pro and AMS HT can dry (status.ams.units[].can_dry).
    const amsDryStart    = (amsId, temp, duration, filament, rotate) =>
        action('ams_dry_start', { ams_id: amsId, temp: temp, duration: duration,
                                  filament: filament || '', rotate: !!rotate });
    const amsDryStop     = (amsId)             => action('ams_dry_stop', { ams_id: amsId });
    const amsReadRfid    = (amsId, slotId)     => action('ams_read_rfid', { ams_id: amsId, slot_id: slotId });
    // tray_info_idx is Bambu's profile identifier (e.g. GFL99) — without it
    // the printer won't accept the setting.
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
                    // Power/online (switch/mqtt) from the socket into the same logic
                    // as the /api/status path → the power button + online cards now
                    // live off the socket, the 8s /api/status poll is gone.
                    if (window.statusManager &&
                        typeof window.statusManager.updateStatusDisplay === 'function') {
                        // Do NOT swallow errors silently — otherwise buttons
                        // (e.g. SD card) stay invisible without any trace in the console.
                        try { window.statusManager.updateStatusDisplay(msg); }
                        catch (e) { console.error('updateStatusDisplay failed:', e); }
                    }
                    updateExtraDetailChips(msg);
                }
            });

            // Legacy: the 'klipper_state' event has the same mapping during
            // the migration phase. The backend pushes both, the frontend
            // tolerates both.
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

        // HelixScreen pattern: Klipper reports state=printing already during
        // the START_PRINT macro (heat-soak/QGL/mesh/purge). We override gcode_state
        // to PREPARE as long as the macro reports `preparation_done=false`.
        // When the variable is missing (slicer prints without START_PRINT), we
        // use print_duration as a fallback (first-extrusion signal).
        let resolvedState = s.state || 'unknown';
        if (resolvedState === 'printing') {
            const prepDone = s.print_preparation_done;
            if (prepDone === true) {
                // real print
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
            // Raw seconds for the HelixScreen print card "1h 52m elapsed".
            // IMPORTANT: total_duration_seconds (from print start, including heat-soak/
            // QGL/mesh) — NOT print_duration_seconds (extrusion only).
            // HelixScreen shows total_duration, which matches user expectation.
            elapsed_seconds: s.total_duration_seconds
                || s.elapsed_seconds
                || s.print_duration_seconds
                || 0,
            filename: s.current_filename || '',
            // Bambu sends `thumbnail_base64` directly in print_progress.
            // Klipper has no push mechanism — we point to
            // our proxy `/api/sd_thumbnail/<filename>` which fetches it from
            // Moonraker metadata. socket-manager uses thumbnail_url
            // directly as <img src>.
            thumbnail_url: s.current_filename
                ? '/api/sd_thumbnail/' + encodeURIComponent(s.current_filename)
                : '',
            gcode_state: stateMap[resolvedState] || 'IDLE',
            // status_text MUST have the "status." prefix so
            // translateStatusKey() can resolve the localization.
            // Otherwise the frontend shows the raw enum string ("printing")
            // instead of the translated variant ("Printing:").
            status_text: s.status_text || `status.${resolvedState}`,
            // Stage arrives already classified from the producer (STATUS_CONTRACT §4b):
            // stage_code = 'stage.*' (client translates), stage_custom = raw M117
            // (Decision A). Just pass it through here, don't re-derive it.
            stage_code: s.stage_code || '',
            stage_custom: s.stage_custom || '',
            nozzle_temp: s.nozzle_temp,
            nozzle_target: s.nozzle_target,
            bed_temp: s.bed_temp,
            bed_target: s.bed_target,
            chamber_temp: s.chamber_temp,
            // Extended live values (KlipperScreen parity)
            z_position: s.z_position,
            speed_factor_percent: s.speed_factor_percent,
            flow_factor_percent: s.flow_factor_percent,
            filament_used_mm: s.filament_used_mm,
            print_duration_seconds: s.print_duration_seconds,
            total_duration_seconds: s.total_duration_seconds,
            z_offset_mm: s.z_offset_mm,
            display_message: s.display_message,
            // HelixScreen parity: fan values + objects + heating status pills.
            // The Klipper backend pushes them in the SocketIO klipper_state event,
            // we map them through 1:1.
            part_fan_percent: s.part_fan_percent != null
                ? Math.round(s.part_fan_percent) : null,
            hotend_fan_percent: s.hotend_fan_percent != null
                ? Math.round(s.hotend_fan_percent) : null,
            aux_fan_percent: s.aux_fan_percent != null
                ? Math.round(s.aux_fan_percent) : null,
            objects_current: s.objects_current,
            objects_total: s.objects_total,
            // Heating status (ready/heating/cooling/off) — derived server-side in
            // _klipper_publish_state from |actual-target|.
            // Not included in the klipper_state event → we derive it client-side.
            nozzle_status: deriveHeaterStatus(s.nozzle_temp, s.nozzle_target),
            bed_status: deriveHeaterStatus(s.bed_temp, s.bed_target),
            // Chamber pill only when a REAL chamber heater exists (like Android).
            // A sensor-only chamber (e.g. AHT20) → has_chamber_heater=false → no pill
            // (otherwise "Heating" even though only a temperature_fan target is set).
            chamber_status: (s.chamber_temp != null && s.has_chamber_heater !== false)
                ? deriveHeaterStatus(s.chamber_temp, s.chamber_target) : null,
            // Temp targets (for the actual/target display)
            nozzle_temp: s.nozzle_temp,
            nozzle_target: s.nozzle_target,
            bed_temp: s.bed_temp,
            bed_target: s.bed_target,
            chamber_temp: s.chamber_temp,
            chamber_target: s.chamber_target,
            // Dual nozzle, air duct, door, tool (X2D/H2D & co.)
            nozzle_temps: s.nozzle_temps,
            nozzle_targets: s.nozzle_targets,
            active_nozzle: s.active_nozzle,
            nozzles: s.nozzles,
            airduct_mode: s.airduct_mode,
            airduct_modes: s.airduct_modes,
            door_open: s.door_open,
            tool_module: s.tool_module,
            ams_units: (s.ams && s.ams.units) || s.ams_units || [],
            // What the printer can do — profile and live state merged
            // server-side (services/printer_capabilities.py).
            capabilities: s.capabilities || null,
            chamber_humidity: s.chamber_humidity,
            has_chamber_heater: s.has_chamber_heater,
            speed_percent: s.speed_factor_percent,
            // ETA time + speed level now also come from the socket → the ~finish
            // time and "Standard/Sport…" are live too.
            eta_time: s.eta_time || '',
            speed_level: s.speed_level,
            speed_level_text: s.speed_level_text,
            // filament_display now ALSO comes via SocketIO printer_state
            // (the adapter's publishState resolves Spoolman/metadata). Prefer the
            // socket value; if it's missing in an update, keep the last known value
            // so the filament doesn't flicker to "--".
            filament_display: s.filament_display
                || (window.lastPrintData && window.lastPrintData.filament_display)
                || '',
            filament_name: (window.lastPrintData &&
                (window.lastPrintData.filament_display ||
                 window.lastPrintData.filament_name)) || '',
            // bed_mesh now ALSO comes via SocketIO printer_state (localhost →
            // the matrix size is uncritical). Prefer the socket value, otherwise keep
            // the last known one so the heatmap doesn't flicker.
            bed_mesh: s.bed_mesh
                || (window.lastPrintData && window.lastPrintData.bed_mesh)
                || null,
        };
    }

    // Heating status derivation (mirrors _heater_state in web_app.py).
    // Ready: target>0 and |actual-target|<1.5; Heating: target>actual+1.5;
    // Cooling: target==0 and actual>30; Off: target==0 and actual<=30.
    function deriveHeaterStatus(actual, target) {
        const a = Number(actual) || 0;
        const t = Number(target) || 0;
        if (t > 0) {
            return Math.abs(a - t) < 1.5 ? 'ready' : 'heating';
        }
        return a > 30 ? 'cooling' : 'off';
    }

    // KlipperScreen parity detail chips: Z height, speed factor, flow factor,
    // filament usage, ETA as a time, Z offset, display message.
    // Only show a chip when the value != null/undefined (otherwise not meaningful anyway).
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
        // Only show Z offset (babystepping) when live active. 0 = no
        // babystepping → hide the chip, otherwise it constantly shows
        // "+0.000 mm" and looks like a dead value.
        setChip('z-offset-info', 'z-offset-value',
                (s.z_offset_mm != null && Math.abs(s.z_offset_mm) > 0.0001)
                    ? s.z_offset_mm : null,
                v => (v >= 0 ? '+' : '') + v.toFixed(3) + ' mm');
        setChip('display-message-info', 'display-message-value',
                (s.display_message && s.display_message !== 'Printing') ? s.display_message : null);

        // ETA as a time (now + remaining_seconds), only while actively printing
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

        // Speed factor: existing #speed-value chip — we update it with
        // the live value (instead of the Bambu level text when that isn't set).
        if (s.speed_factor_percent != null) {
            const sv = document.getElementById('speed-value');
            if (sv && (!sv.textContent || sv.textContent.includes('--'))) {
                sv.textContent = s.speed_factor_percent + '%';
            } else if (sv && window.activePrinter.type === 'klipper') {
                // In Klipper mode, always the live value
                sv.textContent = s.speed_factor_percent + '%';
            }
        }
    }
    window._updateExtraDetailChips = updateExtraDetailChips;

    // Light button renderer (semantic — the only UI spot that
    // sets the light status based on the backend value).
    function updateLightButtonsFromState(isOn) {
        const texts = window.texts || {};
        // The label describes the action: when the light is on, it reads "Licht aus" (light off).
        const label = isOn ? (texts.light_off || 'Licht aus')
                           : (texts.light_on  || 'Licht an');

        ['light-btn', 'light-btn-mobile'].forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.style.visibility = '';
            btn.className = isOn ? 'control-btn warning' : 'control-btn';
            btn.innerHTML = window.skIcon('licht') + '<span>' + label + '</span>';
        });

        // Button in the overview of the control window …
        const uebersicht = document.getElementById('ov-light-btn');
        if (uebersicht) {
            uebersicht.classList.toggle('ov-on', isOn);
            const lbl = document.getElementById('ov-light-label');
            if (lbl) lbl.textContent = label;
        }
        // … and the one on the camera image, reachable from every tab.
        const amBild = document.getElementById('ctrl-camera-light');
        if (amBild) {
            amBild.classList.toggle('ctrl-licht-an', isOn);
            const lbl = document.getElementById('ctrl-camera-light-label');
            if (lbl) lbl.textContent = label;
        }
    }

    // -------------------------------------------------------------
    // LIGHT BRIGHTNESS — right-click (desktop) + long-press (touch) on the
    // light button opens a brightness slider (like the Android long-press).
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
    // TOOLHEAD LED — RGB section in the brightness dialog (only when the
    // printer reports a `neopixel toolhead_rgb`; hidden otherwise).
    // Base color (presets + free color field) × brightness slider → SET_LED.
    // -------------------------------------------------------------
    const TOOLHEAD_PRESETS = ['#ffffff', '#ffb46b', '#ff2020', '#20c020', '#2060ff', '#b040ff'];

    function buildToolheadLedSection(texts) {
        const led = window.__toolheadLed;
        if (!led) return '';
        const max = Math.max(led.r, led.g, led.b);
        const pct = Math.round(max * 100);
        // Base color = current color normalized to full brightness (off = white)
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
        if (!bright) return; // section not rendered (no toolhead_rgb)
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
        // Only for dimmable light (light_level reported) — Bambu/non-dimmable: no dialog.
        const canDim = () => typeof window.__lightLevel === 'number';
        // Right-click (desktop) → brightness dialog instead of the browser context menu.
        document.addEventListener('contextmenu', (e) => {
            if (onLightBtn(e.target)) { e.preventDefault(); if (canDim()) openLightBrightnessDialog(); }
        });
        // Long-press (touch) → dialog; suppress the following toggle click.
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
    // FILE OPERATIONS — unified via /api/printer/files/*
    // -------------------------------------------------------------
    // opts: { fresh, page, per_page, sort, dir, search, only_new }
    // Search, sorting and paging are done by the adapter server-side across the
    // full set — the response carries total/page/pages/per_page, which the
    // pagination bar needs.
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
    // Open the printer's native web UI (Mainsail/Fluidd for Klipper).
    // Bambu has no local web UI — no-op.
    // -------------------------------------------------------------
    function openPrinterWeb() {
        if (window.activePrinter.type !== 'klipper') return;
        // Only when the printer is on — otherwise Mainsail is unreachable.
        // Without a configured smart plug, the connection decides — the
        // answer lives in status-manager.js, here it's only read.
        const printerOnline = (typeof window.druckerDa === 'boolean') ? window.druckerDa
            : (window.lastKnownSwitchState === 'on' && window.lastMqttStatus === true);
        if (!printerOnline) {
            const texts = window.texts || {};
            skToast(texts.printer_offline_no_web || 'Drucker aus — Web-UI nicht erreichbar', 'warning');
            return;
        }
        const url = window.activePrinter.klipperBaseUrl;
        if (!url) return;
        // klipperBaseUrl points to Moonraker (port 7125). But the native web UI
        // (Mainsail/Fluidd) runs on port 80 → strip the Moonraker port
        // and open just the host, otherwise you land on the bare Moonraker page.
        let target = url;
        try {
            const u = new URL(url);
            target = u.protocol + '//' + u.hostname + '/';
        } catch (_) { /* fallback: original URL */ }
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
        moveTo: moveTo,
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
