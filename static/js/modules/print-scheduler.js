/**
 * Print Scheduler Manager
 * Handles print scheduling: schedule modal, confirm/cancel scheduled prints,
 * multi-filament spool selection for scheduling, schedule manager with SD file browsing,
 * filament warning dialogs, and scheduled prints badge.
 */
class PrintSchedulerManager {
    constructor() {
        this.scheduledFileName = '';
        this.scheduledFileLocation = '';
        this.cameFromScheduleManager = false;
        this.editingScheduledId = null;   // Edit mode: id of the entry being replaced
        /** Does the file picker show the archive instead of the live list? */
        this.archivAktiv = false;

        // Refresh the badge periodically
        setInterval(() => this.updateScheduledPrintsBadge(), 30000);
    }

    // ========================================
    // schedulePrintFromSD — open schedule modal for a file
    // prefill (optional): an existing scheduled print (frontend shape) —
    // the modal is pre-filled with its time/options, and confirmSchedulePrint
    // replaces the entry (DELETE old + POST new, the outlet timer follows along).
    // ========================================
    schedulePrintFromSD(filename, location, prefill = null) {
        const texts = window.texts || {};
        const isKlipper = window.isKlipperMode && window.isKlipperMode();

        if (!prefill) delete window.pendingScheduleMapping;

        // Remember edit mode (null = normal new scheduling)
        this.editingScheduledId = prefill ? prefill.id : null;

        // Multi-filament check (skipped when editing — the spool assignment
        // was already made during the original scheduling)
        const fileData = window.sdDateiFinden ? window.sdDateiFinden(filename)
            : window.lastSDFiles?.find(f => f.name === filename);

        // Klipper currently has no multi-filament wizard with AMS tray
        // mapping — spool selection goes through Spoolman as a single spool.
        if (!prefill && !isKlipper && fileData && fileData.is_multifilament && fileData.all_filaments) {
            // Same as on the direct print: the per-colour assignment needs
            // Spoolman, the print itself does not. Without it the scheduling
            // dialog opens as it does for a single filament.
            if (window.spoolmanManager && window.spoolmanManager.connected) {
                // The SAME modal, only with a different button text.
                this.showMultiFilamentSpoolModal(fileData, location, 'schedule');
                return;
            }
        }

        this.scheduledFileName = filename;
        this.scheduledFileLocation = location;

        // Open the modal
        document.getElementById('schedulePrintModal').style.display = 'block';
        // Fallback only (Klipper-Direct): once print preparation has loaded,
        // its file card carries the name along with the preview.
        this._zeigeDateiname(filename);

        // Hide error area
        document.getElementById('schedule-error').style.display = 'none';

        // Force current time on every open (LOCAL time, not UTC!)
        // When editing: prefill with the entry's scheduled time.
        const currentTime = (prefill && prefill.scheduled_time)
            ? new Date(String(prefill.scheduled_time).replace(' ', 'T'))
            : new Date();
        if (!prefill) currentTime.setMinutes(currentTime.getMinutes() + 10);

        // Format local date (not UTC!)
        const year = currentTime.getFullYear();
        const month = String(currentTime.getMonth() + 1).padStart(2, '0');
        const day = String(currentTime.getDate()).padStart(2, '0');
        const hours = String(currentTime.getHours()).padStart(2, '0');
        const minutes = String(currentTime.getMinutes()).padStart(2, '0');

        document.getElementById('schedule-date').value = `${year}-${month}-${day}`;
        document.getElementById('schedule-time').value = `${hours}:${minutes}`;

        console.log(texts.console_modal_opened_preset, {
            datum: `${year}-${month}-${day}`,
            zeit: `${hours}:${minutes}`,
            lokalZeit: currentTime.toLocaleString('de-DE')
        });

        // Render the preparation view — the same view as before an immediate print:
        // preview, plate, filament per nozzle, and all options. A separate set of
        // checkboxes and a second plate list used to live here; both did the
        // same thing and drifted apart (for example, the three-stage
        // calibrations were missing here entirely).
        //
        // When editing, the entry's saved values take precedence over
        // the defaults from the configuration.
        if (prefill && prefill.auto_power !== undefined && prefill.auto_power !== null) {
            const ap = document.getElementById('schedule-auto-power');
            if (ap) ap.checked = !!prefill.auto_power;
        }

        // Build the pre-drying block and restore it when editing.
        this.trocknungBlockAufbauen();
        if (prefill && prefill.dry_enabled) {
            const an = document.getElementById('schedule-dry-enabled');
            const felder = document.getElementById('schedule-dry-felder');
            if (an) an.checked = true;
            if (felder) felder.style.display = '';
            const setz = (id, v) => { const e = document.getElementById(id); if (e && v != null) e.value = v; };
            setz('schedule-dry-filament', prefill.dry_filament);
            setz('schedule-dry-temp', prefill.dry_temp);
            setz('schedule-dry-std', prefill.dry_duration ? (prefill.dry_duration / 60) : null);
        }
        this.trocknungHinweis();
        this.prepareHandle = null;
        if (window.printPrepare && !isKlipper) {
            // Split across cards: file, plate, filament, options. Everything used
            // to sit in one block under the heading "Print Options" — that's also
            // where the preview and key data used to live.
            window.printPrepare.rendereIn(
                document.getElementById('schedule-prepare'), filename, prefill || null,
                {
                    datei: document.getElementById('schedule-datei'),
                    platte: document.getElementById('schedule-platte'),
                    filament: document.getElementById('schedule-filament'),
                    optionen: document.getElementById('schedule-optionen'),
                }
            ).then(handle => {
                this.prepareHandle = handle;
                this._zeigeDateiname('');
                this._materialKarteZeigen();
            });
        }

        // Only show the Spoolman container when connected
        const spoolContainer = document.getElementById('schedule-spool-container');
        if ((window.spoolmanManager && window.spoolmanManager.connected)) {
            spoolContainer.style.display = '';

            // Fill the Spoolman selector
            const scheduleSelector = document.getElementById('schedule-spool');
            scheduleSelector.innerHTML = `<option value="">${texts.no_spool_selected}</option>`;

            const mainSelector = document.getElementById('spool-selector');
            if (mainSelector) {
                for (let i = 1; i < mainSelector.options.length; i++) {
                    const opt = mainSelector.options[i];
                    scheduleSelector.innerHTML += `<option value="${opt.value}">${opt.text}</option>`;
                }
            }
            // Preselect edit mode's spool, or the active spool.
            if (prefill && prefill.spool_id != null) {
                scheduleSelector.value = String(prefill.spool_id);
            } else if (window.activeSpoolId != null) {
                scheduleSelector.value = String(window.activeSpoolId);
            }
            scheduleSelector.onchange = () => this._aktualisierePlanButton();
            const vorgewaehlt = (window.spoolmanManager && window.spoolmanManager.spools || [])
                .find(x => String(x.id) === scheduleSelector.value);
            this._spulKnopfBeschriften(vorgewaehlt || null);

            // ...and only then ask what the FILE requires. This used to just
            // default to the active spool: a PETG file would get the active
            // PLA spool suggested. The matching now runs on the server
            // (find_matching_spools) — the same function the immediate print
            // uses, so there's only one opinion.
            if (!(prefill && prefill.spool_id != null)) {
                this._spuleVorschlagen(scheduleSelector);
            }
        } else {
            spoolContainer.style.display = 'none';
        }
        this._materialKarteZeigen();
        this._aktualisierePlanButton();

        // Load scheduled prints
        this.loadScheduledPrints();
    }

    /**
     * Open the spool selection — the same window as in the
     * material card, just with the file in tow: that way the matching
     * spools appear at the top and carry their badge.
     */
    oeffneSpulenwahl() {
        const selector = document.getElementById('schedule-spool');
        window.openSpoolPicker({
            datei: this.scheduledFileName,
            plate: this.scheduledPlate || 1,
            gewaehlt: selector && selector.value ? parseInt(selector.value, 10) : null,
            onWahl: (spule) => {
                if (!spule || !selector) return;
                // The hidden list stays the source of truth for the
                // send path — this just follows along.
                selector.value = String(spule.id);
                this._spulKnopfBeschriften(spule);
                this._aktualisierePlanButton();
            },
        });
    }

    /** The button carries the chosen spool: color dot, name, material, remaining amount. */
    _spulKnopfBeschriften(spule) {
        const text = document.getElementById('schedule-spool-text');
        const punkt = document.getElementById('schedule-spool-punkt');
        if (!text) return;
        const texts = window.texts || {};
        if (!spule) {
            text.textContent = texts.spool_choose || 'Spule wählen';
            if (punkt) punkt.style.background = 'rgba(128,128,128,0.25)';
            return;
        }
        const fil = spule.filament || {};
        const hersteller = (fil.vendor && fil.vendor.name) || '';
        text.textContent = [
            [hersteller, fil.name].filter(Boolean).join(' '),
            fil.material ? `(${fil.material})` : '',
            `${Math.round(spule.remaining_weight || 0)} g`,
        ].filter(Boolean).join(' · ');
        if (punkt && fil.color_hex) {
            punkt.style.background = '#' + String(fil.color_hex).replace('#', '').slice(0, 6);
        }
    }

    /**
     * Suggest a matching spool and set the hint below it.
     *
     * Three cases, three messages — guessing would be the worst thing to do here:
     *   exactly one   → select it, green checkmark
     *   several       → select the best one, name the count
     *   none          → leave it alone, warn
     */
    _spuleVorschlagen(selector) {
        const datei = this.scheduledFileName;
        if (!datei || !selector) return;
        const platte = this.scheduledPlate || 1;
        const texts = window.texts || {};

        window.apiCall(`/api/spoolman/match?file=${encodeURIComponent(datei)}&plate=${platte}`)
            .then(r => r.json())
            .then(daten => {
                const hinweis = document.getElementById('schedule-spool-hinweis');
                const treffer = (daten && daten.candidates) || [];
                if (!hinweis) return;

                if (!daten || !daten.wanted) { hinweis.style.display = 'none'; return; }

                if (treffer.length === 0) {
                    hinweis.className = 'sched-spulhinweis sched-spulhinweis--warnung';
                    hinweis.textContent = (texts.spool_match_none
                        || 'Keine passende Spule für {material} gefunden.')
                        .replace('{material}', daten.wanted.material || '?');
                    hinweis.style.display = '';
                    return;
                }

                const beste = treffer[0].spool;
                selector.value = String(beste.id);
                this._spulKnopfBeschriften(beste);
                this._aktualisierePlanButton();

                const fil = beste.filament || {};
                const name = [((fil.vendor || {}).name || ''), fil.name || ''].join(' ').trim();
                hinweis.className = 'sched-spulhinweis';
                hinweis.textContent = treffer.length === 1
                    ? (texts.spool_match_one || 'Passend zur Datei: {spool}').replace('{spool}', name)
                    : (texts.spool_match_many || '{n} Spulen passen — vorgewählt: {spool}')
                        .replace('{n}', treffer.length).replace('{spool}', name);
                hinweis.style.display = '';
            })
            .catch(() => { /* nothing to suggest without Spoolman */ });
    }

    // ========================================
    // closeScheduleModal
    // ========================================
    closeScheduleModal() {
        const texts = window.texts || {};

        this.editingScheduledId = null;
        document.getElementById('schedulePrintModal').style.display = 'none';

        // If we came from the Schedule Manager, recreate it
        if (this.cameFromScheduleManager) {
            this.cameFromScheduleManager = false;  // Reset

            // Recreate the Schedule Manager modal
            const modal = document.createElement('div');
            modal.id = 'scheduleManagerModal';
            modal.className = 'modal-overlay';
            modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:1000; display:block;';
            modal.innerHTML = `
                <div class="modal-panel sd-modal-panel">
                    <div class="sd-modal-header">
                        <h2 class="sd-modal-title">${window.skIcon('kalender')} ${texts.scheduled_prints}</h2>
                        <div class="sd-header-actions">
                            <button class="sd-close-btn" onclick="document.getElementById('scheduleManagerModal').remove()">&times;</button>
                        </div>
                    </div>
                    <div class="sd-modal-body">
                        <div id="schedule-manager-list">
                            <div class="sd-loading-state">
                                <div class="loading"></div>
                                <p>${texts.load_scheduled_prints}</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            this.loadScheduleManagerList();
        }
    }

    // ========================================
    // confirmSchedulePrint
    // ========================================
    confirmSchedulePrint() {
        const texts = window.texts || {};

        const date = document.getElementById('schedule-date').value;
        const time = document.getElementById('schedule-time').value;
        const autoPower = document.getElementById('schedule-auto-power').checked;
        const spoolId = document.getElementById('schedule-spool')?.value || null;
        // Options and plate come from the preparation step — the same
        // collection point as for the immediate print.
        const optionen = (typeof collectPrintOptions === 'function')
            ? collectPrintOptions(this.scheduledFileName) : {};
        const timelapse = optionen.timelapse !== false;
        const plate = (this.prepareHandle && this.prepareHandle.plate())
            || document.getElementById('schedule-plate')?.value || 1;
        const spoolMapping = window.pendingScheduleMapping || null;

        const hasSpool = spoolMapping
            ? Object.keys(spoolMapping).length > 0 && Object.values(spoolMapping).every(Boolean)
            : !!spoolId;
        if (window.spoolmanManager && window.spoolmanManager.connected && !hasSpool) {
            skToast(texts.no_spool_selected || 'Keine Spule ausgewählt', 'warning');
            return;
        }

        console.log(texts.console_schedule_debug, { date, time, scheduledFileName: this.scheduledFileName, scheduledFileLocation: this.scheduledFileLocation });

        if (!date || !time) {
            skToast(texts.toast_select_datetime, 'warning');
            return;
        }

        if (!this.scheduledFileName) {
            skToast(texts.toast_no_file_selected, 'warning');
            return;
        }

        // Combine into a local DateTime string WITHOUT UTC conversion
        const scheduledTimeLocal = `${date} ${time}:00`;

        // Check if it's in the future (with 1 minute tolerance)
        const scheduledDateTime = new Date(`${date}T${time}:00`);
        const now = new Date();
        now.setSeconds(0, 0); // Ignore seconds for comparison

        console.log(texts.console_time_comparison, {
            geplant: scheduledDateTime.toISOString(),
            jetzt: now.toISOString(),
            istZukunft: scheduledDateTime > now
        });

        if (scheduledDateTime < now) {
            console.log(texts.console_error_time_past);
            window.skToast(texts.alert_scheduled_future.replace('{scheduled}', scheduledDateTime.toLocaleString(window.currentLang === 'de' ? 'de-DE' : 'en-US')).replace('{now}', now.toLocaleString(window.currentLang === 'de' ? 'de-DE' : 'en-US')), 'warning');
            skToast(texts.toast_future_time_required, 'warning');
            return;
        }

        // Get print_time and weight from the saved SD files.
        // Bambu provides extended_meta.print_time_minutes (minutes),
        // Klipper/Moonraker provides extended_meta.estimated_time (seconds).
        const fileData = window.sdDateiFinden ? window.sdDateiFinden(this.scheduledFileName)
            : window.lastSDFiles?.find(f => f.name === this.scheduledFileName);

        let print_time = null;
        const emeta = fileData?.extended_meta || {};
        let totalMinutes = null;
        if (emeta.print_time_minutes) {
            totalMinutes = emeta.print_time_minutes;
        } else if (emeta.estimated_time) {
            totalMinutes = Math.round(emeta.estimated_time / 60);
        }
        if (totalMinutes != null) {
            const hours = Math.floor(totalMinutes / 60);
            const remainingMinutes = totalMinutes % 60;
            print_time = `${hours}h ${remainingMinutes}min`;
        }

        // Collect checkbox values for all print options. The backend expected
        // them (routes/scheduled_prints.py) — but until now only timelapse
        // actually got through, everything else was silently mapped to config
        // defaults. Now all 7 flags go along.
        const useAms = optionen.use_ams ?? false;
        const layerInspect = optionen.layer_inspect ?? true;
        const vibrationCali = optionen.vibration_cali ?? false;
        const manualColorChange = optionen.manual_color_change ?? false;
        // Three-valued (0 off, 1 on, 2 automatic) — the old boolean values are
        // kept in sync so the backend scheduler can keep computing with them
        // unchanged.
        const bedLevelingMode = optionen.bed_leveling_mode ?? 2;
        const flowCaliMode = optionen.flow_cali_mode ?? 2;
        const nozzleOffsetMode = optionen.nozzle_offset_mode ?? 0;
        const bedLeveling = bedLevelingMode !== 0;
        const flowCali = flowCaliMode !== 0;

        const requestData = {
            filename: this.scheduledFileName,
            location: this.scheduledFileLocation,
            scheduled_time: scheduledTimeLocal,
            auto_power: autoPower,
            timelapse: timelapse,
            // Pre-drying. dry_duration in MINUTES — the scheduler uses it to
            // calculate the earlier power-on time.
            ...this._trocknungsFelder(),
            use_ams: useAms,
            bed_leveling: bedLeveling,
            layer_inspect: layerInspect,
            flow_cali: flowCali,
            vibration_cali: vibrationCali,
            manual_color_change: manualColorChange,
            bed_leveling_mode: bedLevelingMode,
            flow_cali_mode: flowCaliMode,
            nozzle_offset_mode: nozzleOffsetMode,
            spool_id: spoolId,
            spool_mapping: spoolMapping,
            plate: parseInt(plate),
            print_time: print_time,  // Use the converted time
            weight: fileData?.weight || null
        };

        // Edit mode: first delete the old entry centrally (this also clears
        // the outlet timer), then create a new one — same semantics as
        // Android (updatePrint = delete + re-add, the timer follows along).
        const editId = this.editingScheduledId;
        this.editingScheduledId = null;
        const deleteOld = editId
            ? apiCall(`/api/scheduled_prints/${editId}`, {method: 'DELETE'}).catch(() => {})
            : Promise.resolve();

        deleteOld.then(() => apiCall('/api/schedule_print', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(requestData)
        }))
        .then(response => {
            if (response.status === 409) {
                // 409 = filament warnings - show confirmation dialog
                return response.json().then(data => {
                    if (data.error_key === 'schedule_current_print_conflict') {
                        const template = texts.schedule_current_print_conflict || data.error;
                        const message = template
                            .replace('{end}', new Date(data.estimated_end).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}))
                            .replace('{start}', new Date(data.earliest_start).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}))
                            .replace('{minutes}', data.remaining_minutes);
                        const errorDiv = document.getElementById('schedule-error');
                        const errorText = document.getElementById('schedule-error-text');
                        if (errorText) errorText.textContent = message;
                        if (errorDiv) errorDiv.style.display = 'flex';
                        throw new Error('Schedule conflict');
                    }
                    if (data.needs_confirmation && data.filament_warnings) {
                        this.showScheduleFilamentWarningDialog(data.filament_warnings, requestData, scheduledDateTime);
                    }
                    throw new Error('Confirmation needed'); // Abort the promise chain
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                skToast(texts.toast_print_scheduled.replace('{datetime}', scheduledDateTime.toLocaleString(window.currentLang === 'de' ? 'de-DE' : 'en-US')), 'success');
                this.closeScheduleModal();
                this.loadScheduledPrints();
                delete window.pendingScheduleMapping;
            } else if (data.conflict) {
                // Time conflict (running or another scheduled print) — just a
                // warning, the user may deliberately schedule tightly.
                this.showScheduleConflictDialog(data.conflict, requestData, scheduledDateTime);
            } else if (data.error_key === 'schedule_drying_conflict') {
                const template = texts.schedule_drying_conflict || data.error;
                const message = template.replace('{end}', data.drying_end)
                    .replace('{hours}', data.drying_hours);
                const errorDiv = document.getElementById('schedule-error');
                const errorText = document.getElementById('schedule-error-text');
                if (errorText) errorText.textContent = message;
                if (errorDiv) errorDiv.style.display = 'flex';
            } else if (data.error_key === 'schedule_existing_print_conflict') {
                const template = texts.schedule_existing_print_conflict;
                const duration = data.conflict_minutes >= 60
                    ? `${Math.floor(data.conflict_minutes / 60)} h ${data.conflict_minutes % 60} min`
                    : `${data.conflict_minutes} min`;
                const message = template.replace('{file}', data.conflict_filename)
                    .replace('{start}', data.conflict_start).replace('{duration}', duration)
                    .replace('{earliest}', data.earliest_start_text || '');
                const errorDiv = document.getElementById('schedule-error');
                const errorText = document.getElementById('schedule-error-text');
                if (errorText) errorText.textContent = message;
                if (errorDiv) errorDiv.style.display = 'flex';
                            } else if (data.error) {
                // Show critical error in the modal
                const errorDiv = document.getElementById('schedule-error');
                const errorText = document.getElementById('schedule-error-text');
                errorText.textContent = data.error || 'Unbekannter Fehler';
                errorDiv.style.display = 'block';

                // Also show filament warnings on a critical error
                if (data.filament_warnings && data.filament_warnings.length > 0) {
                    errorText.textContent += '\n\n' + texts.filament_details + ':\n';
                    data.filament_warnings.forEach(warning => {
                        errorText.textContent += '• ' + warning.message + '\n';
                    });
                }

                // Hide after 10 seconds
                setTimeout(() => {
                    errorDiv.style.display = 'none';
                }, 10000);
            }
        })
        .catch(error => {
            // Ignore "Confirmation needed" - that's not a real error
            if (error.message === 'Confirmation needed' || error.message === 'Schedule conflict') {
                return;
            }

            console.error(texts.console_error_scheduling + ':', error);
            const errorDiv = document.getElementById('schedule-error');
            const errorText = document.getElementById('schedule-error-text');
            errorText.textContent = `Fehler beim Planen: ${error.message || error}`;
            errorDiv.style.display = 'block';
        });
    }

    // ========================================
    // showMultiFilamentSpoolModal
    // ========================================
    /** Normalize material names for comparison: "PLA Basic", "pla-cf",
     *  "PLA+" all resolve to PLA. Without this, preselection would fail on
     *  the different spellings that Spoolman and the slicer use. */
    _material(text) {
        return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').trim().split(' ')[0];
    }

    /** Distance between two colors (0 = identical). Enough to tell black
     *  from green apart — it isn't meant to do more than that. */
    _farbAbstand(a, b) {
        const zerlege = (v) => {
            const h = String(v || '').replace('#', '').slice(0, 6);
            if (h.length < 6) return null;
            const z = parseInt(h, 16);
            return [(z >> 16) & 255, (z >> 8) & 255, z & 255];
        };
        const x = zerlege(a), y = zerlege(b);
        if (!x || !y) return 999;
        return Math.sqrt((x[0]-y[0])**2 + (x[1]-y[1])**2 + (x[2]-y[2])**2);
    }

    /** Best spool for a filament from the file.
     *
     *  Material is a requirement, not a score: better no preselection than
     *  ASA with a PETG spool. Within the material, color decides, then
     *  vendor and name match, and finally the remaining amount. Spools
     *  already assigned drop out — two filaments can't share the same
     *  spool. */
    _besteSpule(fil, spools, vergeben) {
        const mat = this._material(fil.type);
        const worte = String(fil.name || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 2);
        let beste = null, bestwert = -1;
        spools.forEach(spool => {
            if (vergeben.has(spool.id)) return;
            const f = spool.filament || {};
            if (this._material(f.material) !== mat || !mat) return;
            const abstand = this._farbAbstand(fil.color, f.color_hex);
            let wert = 1000 - Math.min(abstand, 442);          // Color first
            const marke = String(f.vendor && f.vendor.name || '').toUpperCase();
            if (marke && worte.includes(marke)) wert += 120;    // same vendor
            const name = String(f.name || '').toUpperCase();
            worte.forEach(w => { if (w !== marke && name.includes(w)) wert += 40; });
            wert += Math.min(spool.remaining_weight || 0, 1000) / 100;  // remaining amount as tiebreaker
            if (wert > bestwert) { bestwert = wert; beste = spool; }
        });
        return beste;
    }

    async showMultiFilamentSpoolModal(fileData, location, mode = 'print') {
        const texts = window.texts || {};

        // Fetch plate info (with filament_ids per plate) in parallel with the
        // Spoolman query. If the 3MF is multi-plate AND the plates use
        // different filaments, we show a plate selector at the top of the
        // modal and only display the filaments actually used.
        // For single-plate files, or when plate_details is empty,
        // the old flow runs (all filaments).
        let plateDetails = [];
        let selectedPlateIdx = null;
        try {
            const pr = await authFetch(`/api/check_plates/${encodeURIComponent(fileData.name)}`);
            const pd = await pr.json();
            if (Array.isArray(pd.plate_details)) {
                plateDetails = pd.plate_details.filter(p => Array.isArray(p.filament_ids) && p.filament_ids.length > 0);
            }
        } catch (_) {
            plateDetails = [];
        }

        // Helper: which filaments are on the currently selected plate?
        const getVisibleFilaments = () => {
            if (selectedPlateIdx === null || !plateDetails.length) {
                return fileData.all_filaments;
            }
            const plate = plateDetails.find(p => p.index === selectedPlateIdx);
            if (!plate || !plate.filament_ids || !plate.filament_ids.length) {
                return fileData.all_filaments;
            }
            const ids = new Set(plate.filament_ids);
            return fileData.all_filaments.filter(f => ids.has(f.index));
        };

        // Structured like the other dialogs (ui-karte).
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%;'
            + 'background:rgba(0,0,0,0.6); z-index:10000; display:flex;'
            + 'align-items:center; justify-content:center;';

        const content = document.createElement('div');
        content.className = 'modal-panel';
        content.style.cssText = 'position:relative; width:92%; max-width:600px;'
            + 'max-height:85vh; overflow-y:auto; border-radius:12px; padding:0;';

        // Only show the plate selector when there are multiple plates with filament_ids
        const showPlateSelector = plateDetails.length > 1;
        if (plateDetails.length >= 1) {
            // Default: first plate — even for single-plate 3MFs with
            // filament_ids info we want to filter (fewer filaments might
            // actually be used than defined in the project).
            selectedPlateIdx = plateDetails[0].index;
        }

        const plattenText = (p) => `${texts.plate || 'Platte'} ${p.index + 1} — `
            + `${p.filament_ids.length} ${p.filament_ids.length === 1
                ? (texts.filament || 'Filament') : (texts.filaments || 'Filamente')}`
            + (p.weight ? ` (${p.weight} g)` : '');

        const plateSelectorHTML = showPlateSelector ? `
            <div class="ui-karte">
                <div class="ui-karte-kopf">
                    <svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="11" rx="2"/><path d="M3 12h18"/></svg>
                    <span>${texts.print_prepare_plate || 'Platte'}</span>
                </div>
                <div class="ui-zeile">
                    <span class="ui-zeile-name">${texts.mf_plate_hint || 'Nur deren Filamente werden zugewiesen'}</span>
                    <select id="mf-plate-select" class="sd-spool-select ui-breit">
                        ${plateDetails.map(p => `<option value="${p.index}">${plattenText(p)}</option>`).join('')}
                    </select>
                </div>
            </div>
        ` : '';

        content.innerHTML = `
            <div class="sd-modal-header">
                <h2 class="sd-modal-title">
                    <svg class="hd-ic hd-ic--lg" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/></svg>
                    <span>${mode === 'schedule' ? texts.multifilament_schedule : texts.multifilament_print}</span>
                </h2>
            </div>
            <div class="ui-koerper" style="padding:16px 20px 20px;">
                ${plateSelectorHTML}
                <div class="ui-karte">
                    <div class="ui-karte-kopf">
                        <svg class="hd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M7 16V8M12 16V4M17 16v-6"/></svg>
                        <span id="mf-description"></span>
                    </div>
                    <div id="filament-mapping-list"></div>
                </div>
            </div>
            <div class="ui-fuss">
                <button class="modal-btn modal-btn-cancel" id="cancel-multifilament">${texts.cancel}</button>
                <button class="modal-btn modal-btn-success" id="confirm-multifilament">
                    ${mode === 'schedule' ? texts.continue_to_schedule : texts.start_print}
                </button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Load the spools BEFORE the loop
        let spools = [];
        try {
            const response = await authFetch('/api/spoolman/spools');
            spools = await response.json();
            if (!spools || spools.length === 0) {
                window.skToast(texts.no_spools_available, 'error');
                modal.remove();
                return;
            }
        } catch (error) {
            console.error(texts.console_error_loading_spools + ':', error);
            window.skToast(texts.error_loading_spools, 'error');
            modal.remove();
            return;
        }

        const listDiv = document.getElementById('filament-mapping-list');
        const descEl = document.getElementById('mf-description');

        const renderFilamentList = () => {
            const visible = getVisibleFilaments();
            // Suggest every spool only once.
            const vergeben = new Set();
            if (descEl) {
                descEl.textContent = texts.multifilament_description.replace('{count}', visible.length);
            }
            listDiv.innerHTML = '';
            visible.forEach(fil => {
                // One row per filament: colour, name and type on the left,
                // the spool picker on the right. Every filament used to be a
                // grey box of its own with a heading inside it.
                const filDiv = document.createElement('div');
                filDiv.className = 'ui-zeile';
                filDiv.innerHTML = `
                    <span class="ui-zeile-name">
                        <span class="mf-punkt" style="background:${fil.color};"></span>
                        <span class="mf-name">${fil.name}</span>
                        <span class="mf-typ">${fil.type}</span>
                    </span>
                    <select id="spool-select-${fil.index}" class="sd-spool-select mf-wahl">
                        <option value="">${texts.please_select}</option>
                    </select>
                `;

                listDiv.appendChild(filDiv);

                const select = document.getElementById(`spool-select-${fil.index}`);

                // Fill the dropdown with the spools loaded earlier
                spools.forEach(spool => {
                    const filament = spool.filament || {};
                    const vendor = filament.vendor?.name || '';
                    const name = filament.name || 'Unbekannt';
                    const remaining = spool.remaining_weight || 0;

                    const displayName = vendor ? `${vendor} ${name}` : name;
                    const option = document.createElement('option');
                    option.value = spool.id;
                    option.textContent = `${displayName} (${remaining.toFixed(0)}g)`;
                    option.dataset.material = this._material(filament.material);
                    select.appendChild(option);
                });

                // Preselection: a matching material, then the nearest colour.
                const treffer = this._besteSpule(fil, spools, vergeben);
                if (treffer) {
                    select.value = String(treffer.id);
                    vergeben.add(treffer.id);
                }

                // A warning row under the choice. The material of the print
                // stands small beside the name -- skimming it, a wrong spool
                // is otherwise invisible (ASA was nearly printed with PETG).
                const warnung = document.createElement('div');
                warnung.className = 'mf-warnung';
                warnung.style.display = 'none';
                filDiv.appendChild(warnung);

                const pruefe = () => {
                    const opt = select.options[select.selectedIndex];
                    const gewaehlt = opt ? (opt.dataset.material || '') : '';
                    const passt = !select.value || gewaehlt === this._material(fil.type);
                    select.classList.toggle('mf-wahl--falsch', !passt);
                    warnung.style.display = passt ? 'none' : '';
                    if (!passt) {
                        warnung.textContent = (texts.mf_material_mismatch
                            || 'Andere Sorte als im Druck: {datei} statt {spule}')
                            .replace('{datei}', fil.type)
                            .replace('{spule}', gewaehlt || '?');
                    }
                };
                select.addEventListener('change', pruefe);
                pruefe();
            });
        };

        // Initial render + Plate-Selector-Listener
        renderFilamentList();
        if (showPlateSelector) {
            const plateSelectEl = document.getElementById('mf-plate-select');
            plateSelectEl.addEventListener('change', (e) => {
                selectedPlateIdx = parseInt(e.target.value);
                renderFilamentList();
            });
        }

        document.getElementById('cancel-multifilament').onclick = () => modal.remove();

        document.getElementById('confirm-multifilament').onclick = () => {
            const mapping = {};
            let allSelected = true;

            const visible = getVisibleFilaments();
            visible.forEach(fil => {
                const select = document.getElementById(`spool-select-${fil.index}`);
                if (select && select.value) {
                    mapping[String(fil.index)] = parseInt(select.value);  // ← String() hinzugefügt!
                } else {
                    allSelected = false;
                }
            });

            if (!allSelected) {
                window.skToast(texts.alert_select_all_spools, 'warning');
                return;
            }

            // Store the plate pick so the following print start takes the
            // choice over automatically (sparing the user a second plate
            // picker) and the backend starts the right gcode.
            if (selectedPlateIdx !== null) {
                window.pendingPlateOverride = selectedPlateIdx;
            }

            console.log(texts.console_multifilament_mapping, mapping);

            if (mode === 'schedule') {
                // SCHEDULE MODE: store only the mapping and open the schedule modal
                window.pendingScheduleMapping = mapping;
                this._aktualisierePlanButton();
                modal.remove();

                this.scheduledFileName = fileData.name;
                this.scheduledFileLocation = location;

                // Open the schedule modal MANUALLY
                document.getElementById('schedulePrintModal').style.display = 'block';
                window.printScheduler._zeigeDateiname(fileData.name);

                // Zeit setzen
                const currentTime = new Date();
                currentTime.setMinutes(currentTime.getMinutes() + 10);
                const year = currentTime.getFullYear();
                const month = String(currentTime.getMonth() + 1).padStart(2, '0');
                const day = String(currentTime.getDate()).padStart(2, '0');
                const hours = String(currentTime.getHours()).padStart(2, '0');
                const minutes = String(currentTime.getMinutes()).padStart(2, '0');
                document.getElementById('schedule-date').value = `${year}-${month}-${day}`;
                document.getElementById('schedule-time').value = `${hours}:${minutes}`;

                // Spoolman Container verstecken (da Multi-Filament)
                document.getElementById('schedule-spool-container').style.display = 'none';

                // Draw the preparation -- the same view as everywhere else.
                // This is where the multi-colour path arrives: the spool
                // assignment is already made, only time and options are left.
                if (window.printPrepare) {
                    const self = window.printScheduler;
                    self.prepareHandle = null;
                    // WITH target cards, exactly like the single-colour path
                    // above. Without them rendereIn writes the whole stack
                    // (file, plate, filament, options) into ONE block -- and
                    // because the four cards beside it were already filled,
                    // the print options stood twice in the dialog. Visible
                    // only with more than one filament, because only this
                    // path comes past here.
                    window.printPrepare.rendereIn(
                        document.getElementById('schedule-prepare'), fileData.name, null,
                        {
                            datei: document.getElementById('schedule-datei'),
                            platte: document.getElementById('schedule-platte'),
                            filament: document.getElementById('schedule-filament'),
                            optionen: document.getElementById('schedule-optionen'),
                        }
                    ).then(handle => { self.prepareHandle = handle; });
                }

            } else {
                // PRINT MODE: print straight away -- without the schedule parts
                window.pendingSpoolMapping = mapping;
                modal.remove();
                proceedWithPlateCheck(fileData.name, location);
            }
        };

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    // ========================================
    // loadScheduledPrints
    // ========================================
    loadScheduledPrints() {
        // The list used to sit in the create dialog and was filled here. It
        // has had a screen of its own for a while; the call now simply means
        // "the scheduled prints have changed": refresh the counter and, when
        // the overview stands open, redraw it. The many callers therefore
        // stay correct unchanged.
        this.updateScheduledPrintsBadge();
        if (document.getElementById('scheduleManagerModal')) {
            this.loadScheduleManagerList();
        }
    }

    // ========================================
    // updateScheduledPrintsBadge
    // ========================================
    updateScheduledPrintsBadge() {
        const texts = window.texts || {};

        apiCall('/api/scheduled_prints')
            .then(response => response.json())
            .then(data => {
                const badgeMobile = document.getElementById('scheduled-badge-mobile');
                const badgeDesktop = document.getElementById('scheduled-badge-desktop');
                const badgeZone = document.getElementById('mz-sched-badge');

                if (data.prints && data.prints.length > 0) {
                    // Show the badge with the count
                    const count = data.prints.length;

                    if (badgeMobile) {
                        badgeMobile.textContent = count;
                        badgeMobile.style.display = 'flex';
                    }
                    if (badgeDesktop) {
                        badgeDesktop.textContent = count;
                        badgeDesktop.style.display = 'flex';
                    }
                    if (badgeZone) {
                        badgeZone.textContent = count;
                        badgeZone.style.display = 'flex';
                    }
                } else {
                    // Hide the badge when nothing is scheduled
                    if (badgeMobile) {
                        badgeMobile.style.display = 'none';
                    }
                    if (badgeDesktop) {
                        badgeDesktop.style.display = 'none';
                    }
                }
            })
            .catch(error => {
                console.error(texts.console_error_loading_scheduled + ':', error);
            });
    }

    // ========================================
    // cancelScheduledPrint
    // ========================================
    cancelScheduledPrint(printId) {
        const texts = window.texts || {};

        showConfirmDialog({ text: texts.confirm_delete_scheduled, knopf: texts.confirm_ok, gefaehrlich: true }, function() {
        apiCall(`/api/scheduled_prints/${printId}`, {method: 'DELETE'})
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    skToast(texts.toast_scheduled_deleted, 'success');
                    loadScheduledPrints(); // Liste neu laden
                } else {
                    skToast(texts.toast_error_deleting, 'error');
                }
            })
            .catch(error => {
                console.error(texts.console_error + ':', error);
                skToast(texts.connection_error, 'error');
            });
        });
    }

    // ========================================
    // showScheduleConflictDialog
    // ========================================
    // A time conflict: the companion warns when the appointment falls into
    // the running print or into another scheduled one. Deliberately NO block
    // -- planning tightly is allowed, it should only not happen unnoticed.
    showScheduleConflictDialog(conflict, requestData, scheduledDateTime) {
        const texts = window.texts || {};
        const title = conflict.type === 'running'
            ? (texts.schedule_conflict_running || 'Druck laeuft noch')
            : (texts.schedule_conflict_overlap || 'Termin ueberlappt');
        const message = `\u26a0\ufe0f ${title}:\n\n${conflict.message}\n\n`
            + (texts.schedule_conflict_confirm || 'Trotzdem einplanen?');

        showConfirmDialog({ text: message, knopf: texts.confirm_schedule_anyway }, () => {
            requestData.force = true;
            apiCall('/api/schedule_print', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(requestData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    skToast('\u2705 ' + texts.toast_print_scheduled.replace('{datetime}', scheduledDateTime.toLocaleString(window.currentLang === 'de' ? 'de-DE' : 'en-US')));
                    this.closeScheduleModal();
                    this.loadScheduledPrints();
                    delete window.pendingScheduleMapping;
                } else {
                    const errorDiv = document.getElementById('schedule-error');
                    const errorText = document.getElementById('schedule-error-text');
                    errorText.textContent = data.error || 'Unbekannter Fehler';
                    errorDiv.style.display = 'block';
                    setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
                }
            })
            .catch(error => {
                console.error('Error scheduling with force:', error);
                const errorDiv = document.getElementById('schedule-error');
                const errorText = document.getElementById('schedule-error-text');
                errorText.textContent = `Fehler: ${error.message || error}`;
                errorDiv.style.display = 'block';
            });
        });
    }

    // ========================================
    // showScheduleFilamentWarningDialog
    // ========================================
    showScheduleFilamentWarningDialog(warnings, requestData, scheduledDateTime) {
        const texts = window.texts || {};

        console.log('showScheduleFilamentWarningDialog called with warnings:', warnings);

        // Erstelle lesbare Warnungsliste
        const warningLines = warnings.map(w => {
            return '• ' + w.message;
        }).join('\n\n');

        const message = `${texts.filament_warning_title}:\n\n${warningLines}\n\n${texts.filament_warning_confirm}`;

        showConfirmDialog({ text: message, knopf: texts.confirm_schedule_anyway }, () => {
            console.log('User confirmed schedule with warnings - retrying with force=true');
            requestData.force = true;

            apiCall('/api/schedule_print', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(requestData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    skToast(texts.toast_print_scheduled.replace('{datetime}', scheduledDateTime.toLocaleString(window.currentLang === 'de' ? 'de-DE' : 'en-US')), 'success');
                    this.closeScheduleModal();
                    this.loadScheduledPrints();
                    delete window.pendingScheduleMapping;
                } else {
                    const errorDiv = document.getElementById('schedule-error');
                    const errorText = document.getElementById('schedule-error-text');
                    errorText.textContent = data.error || 'Unbekannter Fehler';
                    errorDiv.style.display = 'block';
                    setTimeout(() => {
                        errorDiv.style.display = 'none';
                    }, 5000);
                }
            })
            .catch(error => {
                console.error('Error scheduling with force:', error);
                const errorDiv = document.getElementById('schedule-error');
                const errorText = document.getElementById('schedule-error-text');
                errorText.textContent = `Fehler: ${error.message || error}`;
                errorDiv.style.display = 'block';
            });
        });
    }

    // ========================================
    // openScheduleManager
    // ========================================
    openScheduleManager() {
        const texts = window.texts || {};

        const modal = document.createElement('div');
        modal.id = 'scheduleManagerModal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:block; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:1001;';

        modal.innerHTML = `
            <div class="modal-panel sd-modal-panel">
                <div class="sd-modal-header">
                    <h2 class="sd-modal-title">${window.skIcon('kalender')} ${texts.scheduled_prints}</h2>
                    <div class="sd-header-actions">
                        <button class="sd-close-btn" onclick="document.getElementById('scheduleManagerModal').remove()">&times;</button>
                    </div>
                </div>
                <div class="sd-modal-body">
                    <div id="schedule-manager-list">
                        <div class="sd-loading-state">
                            <div class="loading"></div>
                            <p>${texts.load_scheduled_prints}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.loadScheduleManagerList();
    }

    // ========================================
    // loadScheduleManagerList
    // ========================================
    loadScheduleManagerList() {
        const texts = window.texts || {};

        const isKlipper = window.isKlipperMode && window.isKlipperMode();

        apiCall('/api/scheduled_prints')
            .then(response => response.json())
            .then(data => {
                const container = document.getElementById('schedule-manager-list');
                if (!container) return;

                    // Check the printer state and show the SD files when no prints are scheduled
                if ((!data.prints || data.prints.length === 0)) {
                    // Klipper: the host (SBC/RPi) is usually permanently
                    // online, even with the printer power off -- the files are
                    // always available. We skip the switch check.
                    if (isKlipper) {
                        this.showSDFilesInScheduleManager(container);
                        return;
                    }
                    // Without scheduled prints, show the files to schedule
                    // right away -- regardless of whether the printer runs.
                    //
                    // With the printer running there used to be only the hint
                    // "go to the SD card": one click closed this window,
                    // opened the normal file list, and there one had to press
                    // "schedule" per file again. Three steps for what one
                    // intended anyway when opening "scheduled prints".
                    this.showSDFilesInScheduleManager(container);
                    return; // Rest macht showSDFilesInScheduleManager
                }

                if (data.prints && data.prints.length > 0) {
                    // Always show the file list too. On Bambu as well one
                    // should be able to schedule further prints while the
                    // printer is switched on.
                    const appendFiles = () => {
                        const separator = document.createElement('hr');
                        separator.className = 'sched-separator';
                        container.appendChild(separator);
                        const sdContainer = document.createElement('div');
                        container.appendChild(sdContainer);
                        this.showSDFilesInScheduleManager(sdContainer);
                    };
                    const afterPrintsRendered = () => {
                        appendFiles();
                    };

                    // Render the scheduled prints 1:1 with the SD card card --
                    // we first fetch the full file list (Klipper: the adapter,
                    // Bambu: /api/mqtt/sdcard with metadata) and match every
                    // plan row by filename. On Klipper the cache from
                    // /api/printer/files takes over automatically when the
                    // host is offline. per_page=all: the match needs ALL
                    // files, not the first page of the pager.
                    const filesPromise = isKlipper
                        ? window.printerAdapter.listFiles({ per_page: 'all' }).then(r => r.files || [])
                        : apiCall('/api/mqtt/sdcard?per_page=all').then(r => r.json()).then(d => d.files || []);

                    const renderWithFiles = (files) => {
                        window.lastScheduleSDFiles = files || [];
                        const byName = {};
                        (files || []).forEach(f => {
                            if (f && f.name) byName[f.name] = f;
                        });
                        // State for a re-render on a sort change
                        this.scheduledPrintsState = {
                            prints: data.prints,
                            byName,
                        };
                        const sortTexts = window.texts || {};
                        container.innerHTML = `
                            <div class="sd-toolbar" id="scheduled-sort-options">
                                <span class="sd-toolbar-label">${sortTexts.sort_label || 'Sortierung:'}</span>
                                <select id="scheduled-sort-select" class="sd-sort-select" onchange="sortScheduledPrints()">
                                    <option value="scheduled_time">${sortTexts.sort_by_scheduled_time || 'Geplant für'}</option>
                                    <option value="name">${sortTexts.sort_by_name || 'Name'}</option>
                                    <option value="print_time">${sortTexts.sort_by_print_time || 'Druckzeit'}</option>
                                    <option value="weight">${sortTexts.sort_by_weight || 'Gewicht'}</option>
                                </select>
                                <span class="sd-file-count">${data.prints.length} ${data.prints.length === 1 ? (sortTexts.print || 'Druck') : (sortTexts.prints || 'Drucke')}</span>
                            </div>
                            <div class="sd-file-list" id="scheduled-prints-list-cards"></div>
                        `;
                        this.renderScheduledPrintsCards();
                        afterPrintsRendered();
                    };

                    filesPromise
                        .then(renderWithFiles)
                        .catch(() => renderWithFiles([]));
                }
            });
    }

    // ========================================
    // renderScheduledPrintsCards -- renders the cards from
    // scheduledPrintsState (called on the initial load AND on a sort change)
    // ========================================
    renderScheduledPrintsCards() {
        const state = this.scheduledPrintsState;
        if (!state) return;
        const listEl = document.getElementById('scheduled-prints-list-cards');
        if (!listEl) return;

        const sortBy = document.getElementById('scheduled-sort-select')?.value || 'scheduled_time';
        const prints = [...state.prints].sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return (a.filename || '').localeCompare(b.filename || '');
                case 'print_time': {
                    // print_time is "1h 17min" -- parse it to minutes.
                    const toMin = (s) => {
                        if (!s) return 0;
                        const m = /(\d+)h\s*(\d+)min/.exec(s);
                        if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
                        const m2 = /(\d+)min/.exec(s);
                        if (m2) return parseInt(m2[1]);
                        return 0;
                    };
                    return toMin(b.print_time) - toMin(a.print_time);
                }
                case 'weight':
                    return (parseFloat(b.weight) || 0) - (parseFloat(a.weight) || 0);
                default: { // scheduled_time: neueste zuerst (analog SD-Liste)
                    const ta = new Date(a.scheduled_time).getTime() || 0;
                    const tb = new Date(b.scheduled_time).getTime() || 0;
                    return tb - ta;
                }
            }
        });

        // A row of its own instead of the SD card tile: that carried the file
        // size, the slicer version and the layer height -- things nobody needs
        // while scheduling, and which let the appointment get lost.
        listEl.className = 'sched-liste';
        listEl.innerHTML = prints.map(print =>
            this.geplanterEintragHtml(print, state.byName[print.filename])).join('');
    }

    // ========================================
    // geplanterEintragHtml -- one row of the overview
    // ========================================

    /** The date as "Fri 21.08. · 07:30" in the interface language. */
    _terminText(datum) {
        const spr = (window.i18nManager && window.i18nManager.currentLanguage) || 'de';
        const tag = datum.toLocaleDateString(spr, { weekday: 'short', day: '2-digit', month: '2-digit' });
        const uhr = datum.toLocaleTimeString(spr, { hour: '2-digit', minute: '2-digit' });
        return `${tag} · ${uhr}`;
    }

    /**
     * How long to go -- "in 7 h", "tomorrow", "in 3 days". The time is the
     * reason the entry exists; one used to have to work it out oneself.
     */
    _restText(datum) {
        const texts = window.texts || {};
        const minuten = Math.round((datum.getTime() - Date.now()) / 60000);
        if (minuten < 0) return texts.sched_overdue || 'überfällig';
        if (minuten < 60) return (texts.sched_in_minutes || 'in {n} min').replace('{n}', minuten);
        const stunden = Math.round(minuten / 60);
        if (stunden < 24) return (texts.sched_in_hours || 'in {n} h').replace('{n}', stunden);
        const tage = Math.round(stunden / 24);
        if (tage === 1) return texts.sched_tomorrow || 'morgen';
        return (texts.sched_in_days || 'in {n} Tagen').replace('{n}', tage);
    }

    geplanterEintragHtml(print, datei) {
        const texts = window.texts || {};
        const e = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const ic = (pfad) => `<svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true">${pfad}</svg>`;
        const IC_ZEIT = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
        const IC_GEWICHT = '<path d="M12 3v10M7 21h10M6 13h12l-2 8H8z"/>';
        const IC_SPULE = '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>';
        const IC_STROM = '<path d="M18.4 5.6a9 9 0 1 1-12.8 0M12 3v9"/>';
        const IC_TROCKNEN = '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4.5 4.5 0 1 0 4 0z"/>';

        const datum = new Date(print.scheduled_time);
        const vorbei = datum < new Date();
        const name = (window.cleanPrintName ? window.cleanPrintName(print.filename)
                                            : print.filename.replace(/\.(gcode\.)?3mf$/, ''));

        // Preview: the same source as the SD list.
        const bild = (datei && datei.has_thumbnail !== false)
            ? `<img src="/api/sd_thumbnail/${encodeURIComponent(print.filename)}" alt=""
                    onerror="this.style.display='none'">` : '';

        // Line 1 of the details: what the print IS.
        const fakten = [];
        const zeit = print.print_time || (datei && datei.print_time);
        if (zeit) fakten.push(ic(IC_ZEIT) + e(zeit));
        const gewicht = print.weight || (datei && datei.weight);
        if (gewicht) fakten.push(ic(IC_GEWICHT) + e(Math.round(parseFloat(gewicht))) + ' g');
        if (print.spool_name) {
            const mehrere = print.spool_name.includes(',');
            fakten.push(ic(IC_SPULE) + (mehrere
                ? (texts.sched_spools || '{n} Spulen').replace('{n}', print.spool_name.split(',').length)
                : e(print.spool_name)));
        }

        // Line 2: what's CONFIGURED. Bed, flow and nozzle offset bundled
        // into one entry — showing the same default three times never helped.
        const marken = [];
        if (print.dry_enabled && print.dry_duration > 0) {
            const start = new Date(datum.getTime() - (print.dry_duration + 10) * 60000);
            const uhr = String(start.getHours()).padStart(2, '0') + ':' +
                        String(start.getMinutes()).padStart(2, '0');
            marken.push(`<span class="sched-marke sched-marke--orange">${ic(IC_TROCKNEN)}` +
                (texts.sched_dry_from || 'Trocknen ab {t} · {g} °C · {h} h')
                    .replace('{t}', uhr)
                    .replace('{g}', e(print.dry_temp))
                    .replace('{h}', String(print.dry_duration / 60)) + '</span>');
        }
        if (print.auto_power) {
            marken.push(`<span class="sched-marke sched-marke--gruen">${ic(IC_STROM)}` +
                e(texts.sched_auto_on || 'Auto-Ein') + '</span>');
        }
        if (print.timelapse) marken.push('<span class="sched-marke">Timelapse</span>');
        if (print.use_ams) marken.push('<span class="sched-marke">AMS</span>');
        const kali = [];
        if (print.bed_leveling) kali.push(texts.bed_leveling_short || 'Bett');
        if (print.flow_cali) kali.push(texts.flow_calibration_short || 'Fluss');
        if (print.vibration_cali) kali.push(texts.vibration_calibration_short || 'Vibration');
        if (kali.length) marken.push(`<span class="sched-marke">${e(kali.join(' · '))}</span>`);
        if ((print.plate || 1) > 1) {
            marken.push(`<span class="sched-marke">${e(texts.plate || 'Platte')} ${print.plate}</span>`);
        }

        return `
            <div class="sched-eintrag${vorbei ? ' sched-eintrag--vorbei' : ''}">
                <div class="sched-eintrag-bild">${bild}</div>
                <div class="sched-eintrag-text">
                    <div class="sched-eintrag-kopf">
                        <span class="sched-eintrag-name" title="${e(print.filename)}">${e(name)}</span>
                        <span class="sched-eintrag-zeit">${e(this._terminText(datum))}</span>
                        <span class="sched-eintrag-rest">${e(this._restText(datum))}</span>
                    </div>
                    <div class="sched-eintrag-fakten">${fakten.map(f => `<span>${f}</span>`).join('')}</div>
                    <div class="sched-marken">${marken.join('')}</div>
                </div>
                <div class="sched-eintrag-akt">
                    <button class="sched-iknopf" title="${e(texts.sched_edit || 'Bearbeiten')}"
                            onclick="editScheduledPrint(${print.id})">
                        <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                    </button>
                    <button class="sched-iknopf sched-iknopf--rot" title="${e(texts.delete || 'Löschen')}"
                            onclick="deleteScheduledPrint(${print.id})">
                        <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>
                    </button>
                </div>
            </div>`;
    }

    // ========================================
    // showSDFilesInScheduleManager
    // ========================================
    showSDFilesInScheduleManager(container) {
        const texts = window.texts || {};
        const isKlipper = window.isKlipperMode && window.isKlipperMode();
        const title = isKlipper
            ? (texts.klipper_files_to_schedule || 'Drucker-Dateien zum Planen')
            : texts.sd_files_to_schedule;
        const subtitle = texts.schedule_pick_file_hint
            || texts.klipper_schedule_hint
            || 'Datei auswählen und für einen späteren Zeitpunkt einplanen';
        const icon = window.skIcon(isKlipper ? 'wuerfel' : 'speicher');

        container.innerHTML = `
            <div class="sched-sd-header">
                <div class="sched-sd-header-info">
                    <h3 class="sched-sd-title">${icon} ${title}</h3>
                    <p class="sched-sd-subtitle">${subtitle}</p>
                </div>
                ${isKlipper ? '' : `
                <button class="sd-header-btn${this.archivAktiv ? ' sd-header-btn--an' : ''}"
                        onclick="schedArchivUmschalten()"
                        title="${texts.sd_archive_hint || ''}">
                    <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v3H3zM5 10v9h14v-9M10 14h4"/></svg>
                    <span>${this.archivAktiv ? (texts.sd_archive_live || 'Live')
                                             : (texts.sd_archive || 'Archiv')}</span>
                </button>`}
                <button class="sd-header-btn" onclick="refreshSDInSchedule()">
                    <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>
                    <span>${texts.refresh}</span>
                </button>
            </div>
            <div id="schedule-sd-files">
                <div class="sd-loading-state">
                    <div class="loading"></div>
                    <p>${texts.loading_files}</p>
                </div>
            </div>
        `;

        // Load SD files
        this.loadSDFilesForScheduling();
    }

    // ========================================
    // loadSDFilesForScheduling
    // ========================================
    loadSDFilesForScheduling() {
        const texts = window.texts || {};

        // Klipper: /api/printer/files already returns the Bambu-compatible
        // format, including metadata (filament_type, weight, slicer,
        // estimated_time, layer_count, ...). Pass it straight through, do NOT
        // remap it — otherwise we lose the metadata and the cards look
        // different from the SD modal.
        // per_page=all: the file picker in the scheduler shows the entire set.
        //
        // The archive belongs in here as much as the live list does. Without
        // it only what currently sits on the printer could be scheduled --
        // and putting a file into the archive is exactly what one does with
        // something that is to be printed again later. Klipper has no
        // archive; there the switch does not exist.
        const fetchPromise = (window.isKlipperMode && window.isKlipperMode())
            ? window.printerAdapter.listFiles({ per_page: 'all' }).then(r => ({ files: r.files || [] }))
            : this.archivAktiv
                ? apiCall('/api/sd/archiv?per_page=all').then(r => r.json())
                : apiCall('/api/mqtt/sdcard?per_page=all').then(r => r.json());

        fetchPromise
            .then(data => {
                const container = document.getElementById('schedule-sd-files');
                if (!container) return;

                if (data.files && data.files.length > 0) {
                    window.lastScheduleSDFiles = data.files;

                    let html = `
                        <div class="sd-toolbar" id="schedule-sort-options">
                            <span class="sd-toolbar-label">${texts.sort_label}</span>
                            <select id="schedule-sort-select" class="sd-sort-select" onchange="sortScheduleSDFiles()">
                                <option value="date">${texts.sort_by_date}</option>
                                <option value="new">${texts.sort_by_new}</option>
                                <option value="printed">${texts.sort_by_printed}</option>
                                <option value="name">${texts.sort_by_name}</option>
                            </select>
                            <label class="sd-filter-check">
                                <input type="checkbox" id="schedule-filter-new" onchange="filterScheduleSDFiles()">
                                <span>${texts.filter_show_only_new}</span>
                            </label>
                        </div>
                    `;

                    html += '<div class="sd-file-list" id="schedule-files-list"></div>';
                    container.innerHTML = html;
                    // Initial render goes through sortScheduleSDFiles so the default
                    // sort (date, newest first) also applies —
                    // otherwise the files come in backend order.
                    this.sortScheduleSDFiles();
                } else {
                    container.innerHTML = `
                        <div class="sd-loading-state">
                            <div style="margin-bottom:10px;">${window.skIcon('ordner', 'hd-ic--xl')}</div>
                            <p>${texts.no_files_found}</p>
                        </div>
                    `;
                }
            })
            .catch(error => {
                console.error(texts.console_sd_files_error + ':', error);
                if (document.getElementById('schedule-sd-files')) {
                    document.getElementById('schedule-sd-files').innerHTML = `
                        <div class="sd-error-state">
                            <div style="margin-bottom:10px;">${window.skIcon('warnung', 'hd-ic--xl')}</div>
                            <p>${texts.error_loading_sd_files}</p>
                        </div>
                    `;
                }
            });
    }

    // ========================================
    // sortScheduleSDFiles
    // ========================================
    sortScheduleSDFiles() {
        if (!window.lastScheduleSDFiles) return;

        const sortBy = document.getElementById('schedule-sort-select').value;
        const sorted = [...window.lastScheduleSDFiles].sort((a,b) => {
            switch(sortBy) {
                case 'new':
                    return (a.printed ? 1 : 0) - (b.printed ? 1 : 0);
                case 'printed':
                    return (b.print_count || 0) - (a.print_count || 0);
                case 'name':
                    return a.name.localeCompare(b.name);
                default: // date
                    return (b.sort_timestamp || 0) - (a.sort_timestamp || 0);
            }
        });
        this.displayScheduleSDFiles(sorted);
    }

    // ========================================
    // filterScheduleSDFiles
    // ========================================
    filterScheduleSDFiles() {
        if (!window.lastScheduleSDFiles) return;

        const onlyNew = document.getElementById('schedule-filter-new').checked;
        const filtered = onlyNew ?
            window.lastScheduleSDFiles.filter(f => !f.printed) :
            window.lastScheduleSDFiles;
        this.displayScheduleSDFiles(filtered);
    }

    // ========================================
    // displayScheduleSDFiles
    // ========================================
    displayScheduleSDFiles(files) {
        const container = document.getElementById('schedule-files-list');
        if (!container) return;
        container.innerHTML = '';

        // Identical to the SD modal card (thumbnail, filament, layer height,
        // slicer, ...) — only the action buttons are reduced to "Schedule".
        // The renderer comes from the SDCardManager singleton.
        files.forEach(file => {
            container.insertAdjacentHTML(
                'beforeend',
                window.createSDFileCardHTML(file, { mode: 'schedule-pick' })
            );
        });
    }

    // ========================================
    // refreshSDInSchedule
    // ========================================
    refreshSDInSchedule() {
        const texts = window.texts || {};

        const container = document.getElementById('schedule-sd-files');
        if (container) {
            container.innerHTML = `
                <div class="sd-loading-state">
                    <div class="loading"></div>
                    <p>${texts.loading_files || 'Aktualisiere SD-Dateien...'}</p>
                </div>
            `;
        }
        this.loadSDFilesForScheduling();
    }

    // ========================================
    // schedulePrintFromScheduleManager
    // ========================================
    schedulePrintFromScheduleManager(filename, location) {
        this.cameFromScheduleManager = true;

        // Load SD files if not already present — unified files for Klipper
        if (!window.lastSDFiles) {
            const fetchP = (window.isKlipperMode && window.isKlipperMode())
                ? window.printerAdapter.listFiles({ per_page: 'all' }).then(r => ({
                    files: (r.files || []).map(f => ({
                        name: f.path, size: f.size_bytes,
                        modified: f.modified_unix, location: 'gcodes',
                    })),
                }))
                : apiCall('/api/mqtt/sdcard?per_page=all').then(r => r.json());
            fetchP.then(data => {
                window.lastSDFiles = data.files || [];
                document.getElementById('scheduleManagerModal').remove();
                this.schedulePrintFromSD(filename, location);
            });
        } else {
            // Continue normally
            document.getElementById('scheduleManagerModal').remove();
            this.schedulePrintFromSD(filename, location);
        }
    }

    // ========================================
    // editScheduledPrint — edit a scheduled print: open the schedule
    // modal with the saved values; confirming replaces the entry.
    // ========================================
    editScheduledPrint(printId) {
        const print = this.scheduledPrintsState?.prints?.find(p => p.id === printId);
        if (!print) return;

        this.cameFromScheduleManager = true;
        // Ensure the files cache for metadata (print_time/weight) —
        // the manager list has already loaded it.
        if (!window.lastSDFiles && window.lastScheduleSDFiles) {
            window.lastSDFiles = window.lastScheduleSDFiles;
        }
        document.getElementById('scheduleManagerModal')?.remove();
        this.schedulePrintFromSD(print.filename, print.location || 'cache', print);
    }

    // ========================================
    // deleteScheduledPrint
    // ========================================
    deleteScheduledPrint(printId) {
        const texts = window.texts || {};

        showConfirmDialog({ text: texts.confirm_delete_scheduled, knopf: texts.confirm_ok, gefaehrlich: true }, function() {
            apiCall(`/api/scheduled_prints/${printId}`, {method: 'DELETE'})
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        skToast(texts.toast_scheduled_deleted, 'success');
                        loadScheduleManagerList();
                    }
                });
        });
    }
    /**
     * The material card holds two things, either of which can be missing: the
     * spool choice (only with Spoolman) and the filament per nozzle (only if
     * the file reports one). Without either, an empty card would be left
     * standing.
     */
    /**
     * Filename as a fallback. In Bambu mode, print preparation immediately
     * renders a file card with preview, name, and key data right after this
     * and hides this line again — otherwise the name would appear twice.
     */
    _zeigeDateiname(name) {
        const el = document.getElementById('schedule-filename');
        if (!el) return;
        el.textContent = name || '';
        el.style.display = name ? '' : 'none';
    }

    _materialKarteZeigen() {
        const karte = document.getElementById('schedule-material-karte');
        if (!karte) return;
        const spule = document.getElementById('schedule-spool-container');
        const filament = document.getElementById('schedule-filament');
        const hatSpule = spule && spule.style.display !== 'none';
        const hatFilament = filament && filament.innerHTML.trim() !== '';
        karte.style.display = (hatSpule || hatFilament) ? '' : 'none';
    }

    _aktualisierePlanButton() {
        const button = document.getElementById('schedule-confirm-button');
        if (!button) return;
        const mapping = window.pendingScheduleMapping;
        const hasSpool = mapping
            ? Object.keys(mapping).length > 0 && Object.values(mapping).every(Boolean)
            : !!document.getElementById('schedule-spool')?.value;
        const requiresSpool = !!(window.spoolmanManager && window.spoolmanManager.connected);
        button.disabled = requiresSpool && !hasSpool;
        button.title = button.disabled
            ? (window.texts?.no_spool_selected || 'Keine Spule ausgewählt') : '';
    }

    /**
     * Can this printer dry filament? Prefers the live report, otherwise the
     * server's capability list (which remembers a heating AMS it has seen
     * once, and knows the settings checkbox). Klipper-Direct has no heating
     * AMS.
     */
    _kannTrocknen() {
        if (window.isKlipperMode && window.isKlipperMode()) return false;
        const einheiten = (window.lastPrintData?.ams?.units) || [];
        if (einheiten.some(u => u.can_dry)) return true;
        const faehig = window.lastCapabilities
            || window.lastPrintData?.capabilities || {};
        return faehig.ams_drying === true;
    }

    /** Values of the pre-drying block for the request. */
    _trocknungsFelder() {
        const an = document.getElementById('schedule-dry-enabled');
        if (!an || !an.checked) return { dry_enabled: false };
        const std = parseFloat(document.getElementById('schedule-dry-std')?.value) || 0;
        return {
            dry_enabled: true,
            dry_filament: document.getElementById('schedule-dry-filament')?.value || '',
            dry_temp: parseInt(document.getElementById('schedule-dry-temp')?.value, 10) || 0,
            dry_duration: Math.round(std * 60)
        };
    }

    /**
     * Build the pre-drying block: only show the checkbox when a drying-capable
     * AMS is reported, fill the filament list from the existing presets, and
     * show the calculated power-on time.
     */
    trocknungBlockAufbauen() {
        const haken = document.getElementById('schedule-dry-check');
        const felder = document.getElementById('schedule-dry-felder');
        const an = document.getElementById('schedule-dry-enabled');
        if (!haken || !felder || !an) return;

        const beschriftung = document.getElementById('schedule-dry-label');
        if (beschriftung) {
            beschriftung.textContent = (window.texts || {}).schedule_dry_label
                || 'Filament vorher trocknen';
        }

        // Fill the filament list FIRST — it doesn't depend on the printer,
        // only on the Studio presets. It used to sit behind the
        // visibility check and stayed empty when editing as soon as the
        // printer was off.
        const sel = document.getElementById('schedule-dry-filament');
        if (sel && !sel.options.length) {
            const presets = window.BAMBU_DRY_PRESETS || {};
            Object.keys(presets).forEach(t => {
                const o = document.createElement('option');
                o.value = t; o.textContent = t;
                sel.appendChild(o);
            });
            sel.onchange = () => this._trocknungVoreinstellung(true);
        }

        // Visibility comes from the capabilities, not from the live AMS
        // data: a powered-off printer reports no units, and that's exactly
        // when you'd schedule. capabilities.ams_drying also remembers an
        // AMS seen once and the "Use AMS" checkbox from the settings.
        const kannTrocknen = this._kannTrocknen();
        haken.style.display = kannTrocknen ? '' : 'none';
        if (!kannTrocknen) { felder.style.display = 'none'; an.checked = false; return; }

        an.onchange = () => {
            felder.style.display = an.checked ? '' : 'none';
            if (an.checked) this._trocknungVoreinstellung();
            this.trocknungHinweis();
        };
        ['schedule-dry-std', 'schedule-dry-temp'].forEach(id => {
            const e = document.getElementById(id);
            if (e) e.oninput = () => this.trocknungHinweis();
        });
        const zeit = document.getElementById('schedule-time');
        if (zeit) zeit.addEventListener('change', () => this.trocknungHinweis());
    }

    /**
     * Temperature and duration from the preset of the selected type.
     * BAMBU_DRY_PRESETS holds two pairs [degrees, hours] per type: [0] for
     * the idle printer, [1] during a print. Pre-drying happens before the
     * print, so always [0] — the same choice as in the material zone's
     * dialog.
     *
     * @param {boolean} ueberschreiben When the type is chosen, the preset
     *        wins; when merely enabling, entered values (and those of an
     *        entry being edited) are left as they are.
     */
    _trocknungVoreinstellung(ueberschreiben = false) {
        const typ = document.getElementById('schedule-dry-filament')?.value;
        const p = ((window.BAMBU_DRY_PRESETS || {})[typ] || [[55, 8], [55, 8]])[0];
        const t = document.getElementById('schedule-dry-temp');
        const h = document.getElementById('schedule-dry-std');
        if (t && (ueberschreiben || !t.value)) t.value = p[0];
        if (h && (ueberschreiben || !h.value)) h.value = p[1];
        this.trocknungHinweis();
    }

    /**
     * Shows when the printer needs to switch on for it — and warns if that
     * time has already passed. Not a hard block: a short pre-drying can be
     * intentional.
     */
    trocknungHinweis() {
        const strahl = document.getElementById('schedule-dry-strahl');
        const box = document.getElementById('schedule-dry-hinweis');
        const an = document.getElementById('schedule-dry-enabled');
        if (!box || !an) return;
        if (strahl) strahl.innerHTML = '';
        if (!an.checked) { box.textContent = ''; return; }

        const texts = window.texts || {};
        const PUFFER = 10;   // Minutes for powering up, homing, and parking
        const std = parseFloat(document.getElementById('schedule-dry-std')?.value) || 0;
        const datum = document.getElementById('schedule-date')?.value;
        const uhr = document.getElementById('schedule-time')?.value;
        if (!std || !datum || !uhr) { box.textContent = ''; return; }

        const druck = new Date(datum + 'T' + uhr);
        const start = new Date(druck.getTime() - (std * 60 + PUFFER) * 60000);
        const trocknung = new Date(start.getTime() + PUFFER * 60000);
        const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' +
                            String(d.getMinutes()).padStart(2, '0');

        // Too tight: the printer would already need to be running now. Not a
        // block — a short pre-drying can be intentional.
        if (start <= new Date()) {
            box.className = 'sched-dry-hinweis warnung';
            box.textContent = (texts.schedule_dry_too_late ||
                'Zu knapp — der Drucker müsste schon jetzt laufen. Kürzere Trocknung oder späterer Druck.');
            return;
        }

        box.textContent = '';
        if (!strahl) return;
        const punkt = (cls, zeit, was) =>
            `<div class="sp-strahl-punkt${cls}">` +
              `<div class="sp-strahl-zeit">${zeit}</div>` +
              `<div class="sp-strahl-was">${was}</div></div>`;
        const stundenText = (texts.schedule_dry_step_dry || 'Trocknung, {h} h')
            .replace('{h}', String(std));
        strahl.innerHTML =
            punkt('', hhmm(start), texts.schedule_dry_step_power || 'Drucker an') +
            punkt(' sp-strahl-punkt--trocknen', hhmm(trocknung), stundenText) +
            punkt(' sp-strahl-punkt--druck', hhmm(druck), texts.schedule_dry_step_print || 'Druck');
    }


}

// ========================================
// Instantiate global singleton
// ========================================
window.printScheduler = new PrintSchedulerManager();

// ========================================
// Global wrappers for HTML onclick handlers
// ========================================
function schedulePrintFromSD(filename, location) { window.printScheduler.schedulePrintFromSD(filename, location); }
function closeScheduleModal() { window.printScheduler.closeScheduleModal(); }
function confirmSchedulePrint() { window.printScheduler.confirmSchedulePrint(); }
function showMultiFilamentSpoolModal(fileData, location, mode) { window.printScheduler.showMultiFilamentSpoolModal(fileData, location, mode); }
function loadScheduledPrints() { window.printScheduler.loadScheduledPrints(); }
function updateScheduledPrintsBadge() { window.printScheduler.updateScheduledPrintsBadge(); }
function cancelScheduledPrint(printId) { window.printScheduler.cancelScheduledPrint(printId); }
function openScheduleManager() { window.printScheduler.openScheduleManager(); }
function loadScheduleManagerList() { window.printScheduler.loadScheduleManagerList(); }
function showSDFilesInScheduleManager(container) { window.printScheduler.showSDFilesInScheduleManager(container); }
function loadSDFilesForScheduling() { window.printScheduler.loadSDFilesForScheduling(); }
function refreshSDInSchedule() { window.printScheduler.refreshSDInSchedule(); }
function schedulePrintFromScheduleManager(filename, location) { window.printScheduler.schedulePrintFromScheduleManager(filename, location); }

/** Switch the file picker between the live list and the archive. */
window.schedArchivUmschalten = function () {
    const planer = window.printScheduler;
    planer.archivAktiv = !planer.archivAktiv;
    const behaelter = document.querySelector('.sched-sd-header')?.parentElement;
    if (behaelter) planer.showSDFilesInScheduleManager(behaelter);
};

/**
 * Schedule a file that lies in the archive.
 *
 * Fetch it back first, then the normal path. After that it is an ordinary
 * cache file and travels the way a freshly uploaded one does: the sync at
 * power-on carries it onto the printer. Archived it would stay put — the
 * sync leaves the archive alone on purpose.
 */
window.schedulePrintFromArchive = async function (filename) {
    const texts = window.texts || {};
    try {
        const antwort = await apiCall('/api/sd/archiv/zurueckholen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename })
        });
        const daten = await antwort.json();
        if (!daten || !daten.success) {
            skToast((daten && daten.error) || (texts.toast_error || 'Fehler'), 'error');
            return;
        }
        skToast(texts.sched_archive_restored
                || 'Aus dem Archiv geholt — geht beim Einschalten auf den Drucker', 'success');
        // Back to the live list, otherwise the picker still shows the archive
        // while the file is no longer in it.
        window.printScheduler.archivAktiv = false;
        schedulePrintFromScheduleManager(filename, 'root');
    } catch (fehler) {
        skToast(texts.toast_error || 'Fehler', 'error');
        console.error('Archiv/Planen:', fehler);
    }
};
function editScheduledPrint(printId) { window.printScheduler.editScheduledPrint(printId); }
function deleteScheduledPrint(printId) { window.printScheduler.deleteScheduledPrint(printId); }
function sortScheduleSDFiles() { window.printScheduler.sortScheduleSDFiles(); }
function sortScheduledPrints() { window.printScheduler.renderScheduledPrintsCards(); }
function filterScheduleSDFiles() { window.printScheduler.filterScheduleSDFiles(); }
function displayScheduleSDFiles(files) { window.printScheduler.displayScheduleSDFiles(files); }
