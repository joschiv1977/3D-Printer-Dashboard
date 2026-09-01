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
        this.editingScheduledId = null;   // Edit-Modus: id des zu ersetzenden Eintrags

        // Badge regelmäßig aktualisieren
        setInterval(() => this.updateScheduledPrintsBadge(), 30000);
    }

    // ========================================
    // schedulePrintFromSD — open schedule modal for a file
    // prefill (optional): bestehender geplanter Druck (Frontend-Shape) —
    // Modal wird mit dessen Zeit/Optionen vorbelegt und confirmSchedulePrint
    // ersetzt den Eintrag (DELETE alt + POST neu, Steckdosen-Timer zieht mit).
    // ========================================
    schedulePrintFromSD(filename, location, prefill = null) {
        const texts = window.texts || {};
        const isKlipper = window.isKlipperMode && window.isKlipperMode();

        if (!prefill) delete window.pendingScheduleMapping;

        // Edit-Modus merken (null = normales Neu-Planen)
        this.editingScheduledId = prefill ? prefill.id : null;

        // NEU: Multi-Filament Check (beim Bearbeiten überspringen — die
        // Spool-Zuordnung wurde beim ursprünglichen Planen schon gemacht)
        const fileData = window.sdDateiFinden ? window.sdDateiFinden(filename)
            : window.lastSDFiles?.find(f => f.name === filename);

        // Klipper hat (Stand jetzt) keinen Multi-Filament-Wizard mit AMS-
        // Tray-Mapping — Spool-Auswahl laeuft ueber Spoolman als Single-Spool.
        if (!prefill && !isKlipper && fileData && fileData.is_multifilament && fileData.all_filaments) {
            if (!(window.spoolmanManager && window.spoolmanManager.connected)) {
                window.skToast(texts.spoolman_required, 'warning');
                return;
            }

            // WICHTIG: Nutze das GLEICHE Modal, aber mit anderem Button-Text!
            this.showMultiFilamentSpoolModal(fileData, location, 'schedule');  // <-- mode parameter!
            return;
        }

        this.scheduledFileName = filename;
        this.scheduledFileLocation = location;

        // Modal öffnen
        document.getElementById('schedulePrintModal').style.display = 'block';
        // Nur der Rueckfall (Klipper-Direkt): sobald die Druckvorbereitung
        // geladen hat, traegt ihre Datei-Karte den Namen samt Vorschau.
        this._zeigeDateiname(filename);

        // Fehlerbereich ausblenden
        document.getElementById('schedule-error').style.display = 'none';

        // Forciere aktuelle Zeit bei jedem Öffnen (LOKALE Zeit, nicht UTC!)
        // Beim Bearbeiten: geplante Zeit des Eintrags vorbelegen.
        const currentTime = (prefill && prefill.scheduled_time)
            ? new Date(String(prefill.scheduled_time).replace(' ', 'T'))
            : new Date();
        if (!prefill) currentTime.setMinutes(currentTime.getMinutes() + 10);

        // Formatiere lokales Datum (nicht UTC!)
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

        // Vorbereitung zeichnen — dieselbe Ansicht wie vor dem Sofortdruck:
        // Vorschau, Platte, Filament je Duese und alle Optionen. Vorher standen
        // hier eigene Haekchen UND eine zweite Plattenliste; beide konnten
        // dasselbe und liefen auseinander (die dreistufigen Kalibrierungen
        // fehlten hier zum Beispiel ganz).
        //
        // Beim Bearbeiten gewinnen die gespeicherten Werte des Eintrags ueber
        // die Vorgaben aus der Konfiguration.
        if (prefill && prefill.auto_power !== undefined && prefill.auto_power !== null) {
            const ap = document.getElementById('schedule-auto-power');
            if (ap) ap.checked = !!prefill.auto_power;
        }

        // Vortrocknung aufbauen und beim Bearbeiten wiederherstellen.
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
            // Aufgeteilt auf die Karten: Datei, Platte, Filament, Optionen.
            // Vorher lag alles in einem Block unter der Ueberschrift
            // "Druckoptionen" — dort standen dann auch Vorschau und Eckdaten.
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

        // Spoolman Container nur anzeigen wenn verbunden
        const spoolContainer = document.getElementById('schedule-spool-container');
        if ((window.spoolmanManager && window.spoolmanManager.connected)) {
            spoolContainer.style.display = '';

            // Spoolman Selector füllen
            const scheduleSelector = document.getElementById('schedule-spool');
            scheduleSelector.innerHTML = `<option value="">${texts.no_spool_selected}</option>`;

            const mainSelector = document.getElementById('spool-selector');
            if (mainSelector) {
                for (let i = 1; i < mainSelector.options.length; i++) {
                    const opt = mainSelector.options[i];
                    scheduleSelector.innerHTML += `<option value="${opt.value}">${opt.text}</option>`;
                }
            }
            // Edit-Modus oder aktive Spule vorselektieren.
            if (prefill && prefill.spool_id != null) {
                scheduleSelector.value = String(prefill.spool_id);
            } else if (window.activeSpoolId != null) {
                scheduleSelector.value = String(window.activeSpoolId);
            }
            scheduleSelector.onchange = () => this._aktualisierePlanButton();
            const vorgewaehlt = (window.spoolmanManager && window.spoolmanManager.spools || [])
                .find(x => String(x.id) === scheduleSelector.value);
            this._spulKnopfBeschriften(vorgewaehlt || null);

            // …und dann fragen, was die DATEI verlangt. Bisher stand hier
            // stumpf die aktive Spule: eine PETG-Datei bekam die aktive
            // PLA-Spule vorgeschlagen. Der Abgleich laeuft am Server
            // (find_matching_spools) — dieselbe Funktion, die auch der
            // Sofortdruck benutzt, damit es nicht zwei Meinungen gibt.
            if (!(prefill && prefill.spool_id != null)) {
                this._spuleVorschlagen(scheduleSelector);
            }
        } else {
            spoolContainer.style.display = 'none';
        }
        this._materialKarteZeigen();
        this._aktualisierePlanButton();

        // Lade geplante Drucke
        this.loadScheduledPrints();
    }

    /**
     * Die Spulenauswahl oeffnen — dasselbe Fenster wie in der
     * Material-Karte, nur mit der Datei im Gepaeck: dann stehen die
     * passenden Spulen oben und tragen ihr Abzeichen.
     */
    oeffneSpulenwahl() {
        const selector = document.getElementById('schedule-spool');
        window.openSpoolPicker({
            datei: this.scheduledFileName,
            plate: this.scheduledPlate || 1,
            gewaehlt: selector && selector.value ? parseInt(selector.value, 10) : null,
            onWahl: (spule) => {
                if (!spule || !selector) return;
                // Die versteckte Liste bleibt die Wahrheit fuer den
                // Sende-Weg — hier nur nachziehen.
                selector.value = String(spule.id);
                this._spulKnopfBeschriften(spule);
                this._aktualisierePlanButton();
            },
        });
    }

    /** Der Knopf traegt die gewaehlte Spule: Farbpunkt, Name, Material, Rest. */
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
     * Passende Spule vorschlagen und den Hinweis darunter setzen.
     *
     * Drei Faelle, drei Aussagen — raten waere hier das Schlimmste:
     *   genau einer   → auswaehlen, gruener Haken
     *   mehrere       → besten auswaehlen, Zahl nennen
     *   keiner        → nichts anfassen, warnen
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
            .catch(() => { /* ohne Spoolman gibt es nichts vorzuschlagen */ });
    }

    // ========================================
    // closeScheduleModal
    // ========================================
    closeScheduleModal() {
        const texts = window.texts || {};

        this.editingScheduledId = null;
        document.getElementById('schedulePrintModal').style.display = 'none';

        // NEU: Wenn vom Schedule Manager gekommen, diesen neu erstellen
        if (this.cameFromScheduleManager) {
            this.cameFromScheduleManager = false;  // Reset

            // Schedule Manager Modal neu erstellen
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
        // Optionen und Platte kommen aus der Vorbereitung — dieselbe
        // Sammelstelle wie beim Sofortdruck.
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

        // Kombiniere zu lokalem DateTime String OHNE UTC Konvertierung
        const scheduledTimeLocal = `${date} ${time}:00`;

        // Prüfe ob in Zukunft (mit 1 Minute Toleranz)
        const scheduledDateTime = new Date(`${date}T${time}:00`);
        const now = new Date();
        now.setSeconds(0, 0); // Sekunden ignorieren für Vergleich

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

        // Hole print_time und weight aus den gespeicherten SD-Dateien.
        // Bambu liefert extended_meta.print_time_minutes (Minuten),
        // Klipper/Moonraker liefert extended_meta.estimated_time (Sekunden).
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

        // Checkbox-Werte für alle Druckoptionen einsammeln. Backend hat's
        // erwartet (routes/scheduled_prints.py) — aber bisher kam nur
        // timelapse durch, alle anderen wurden stumm auf Config-Defaults
        // gemapped. Jetzt gehen alle 7 Flags mit.
        const useAms = optionen.use_ams ?? false;
        const layerInspect = optionen.layer_inspect ?? true;
        const vibrationCali = optionen.vibration_cali ?? false;
        const manualColorChange = optionen.manual_color_change ?? false;
        // Dreistufig (0 aus, 1 ein, 2 automatisch) — die alten Wahrheitswerte
        // gehen im Gleichklang mit, damit der Zeitplaner im Backend
        // unveraendert damit rechnen kann.
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
            // Vortrocknung. dry_duration in MINUTEN — der Planer rechnet
            // damit den frueheren Einschaltzeitpunkt aus.
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
            print_time: print_time,  // Verwende konvertierte Zeit
            weight: fileData?.weight || null
        };

        // Edit-Modus: alten Eintrag zuerst zentral löschen (räumt auch den
        // Steckdosen-Timer mit ab), dann neu anlegen — gleiche Semantik wie
        // Android (updatePrint = delete + re-add, Timer zieht mit).
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
                // 409 = Filament-Warnungen - Bestätigungsdialog anzeigen
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
                    throw new Error('Confirmation needed'); // Abbruch der Promise-Chain
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
                // Zeit-Konflikt (laufender oder anderer geplanter Druck) — nur
                // eine Warnung, der User darf bewusst knapp planen.
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
                const template = texts.schedule_existing_print_conflict || 'Der geplante Druck "{file}" startet um {start} und dauert ungefähr {duration}.';
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
                // Kritischer Fehler im Modal anzeigen
                const errorDiv = document.getElementById('schedule-error');
                const errorText = document.getElementById('schedule-error-text');
                errorText.textContent = data.error || 'Unbekannter Fehler';
                errorDiv.style.display = 'block';

                // Zeige auch Filament-Warnungen bei kritischem Fehler
                if (data.filament_warnings && data.filament_warnings.length > 0) {
                    errorText.textContent += '\n\n' + texts.filament_details + ':\n';
                    data.filament_warnings.forEach(warning => {
                        errorText.textContent += '• ' + warning.message + '\n';
                    });
                }

                // Nach 10 Sekunden ausblenden
                setTimeout(() => {
                    errorDiv.style.display = 'none';
                }, 10000);
            }
        })
        .catch(error => {
            // Ignoriere "Confirmation needed" - das ist kein echter Fehler
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
    /** Materialbezeichnungen vergleichbar machen: "PLA Basic", "pla-cf",
     *  "PLA+" laufen alle auf PLA hinaus. Ohne das wuerde die Vorauswahl an
     *  Schreibweisen scheitern, die Spoolman und der Slicer verschieden
     *  fuehren. */
    _material(text) {
        return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').trim().split(' ')[0];
    }

    /** Abstand zweier Farben (0 = gleich). Reicht, um Schwarz von Grün zu
     *  trennen — mehr soll es nicht leisten. */
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

    /** Beste Spule fuer ein Filament aus der Datei.
     *
     *  Das Material ist Bedingung, nicht Punktezahl: lieber keine Vorauswahl
     *  als ASA mit einer PETG-Spule. Innerhalb des Materials entscheidet die
     *  Farbe, dann Hersteller und Namensgleichheit, zuletzt der Restbestand.
     *  Schon vergebene Spulen fallen raus — zwei Filamente aus derselben
     *  Spule gehen nicht. */
    _besteSpule(fil, spools, vergeben) {
        const mat = this._material(fil.type);
        const worte = String(fil.name || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 2);
        let beste = null, bestwert = -1;
        spools.forEach(spool => {
            if (vergeben.has(spool.id)) return;
            const f = spool.filament || {};
            if (this._material(f.material) !== mat || !mat) return;
            const abstand = this._farbAbstand(fil.color, f.color_hex);
            let wert = 1000 - Math.min(abstand, 442);          // Farbe zuerst
            const marke = String(f.vendor && f.vendor.name || '').toUpperCase();
            if (marke && worte.includes(marke)) wert += 120;    // gleicher Hersteller
            const name = String(f.name || '').toUpperCase();
            worte.forEach(w => { if (w !== marke && name.includes(w)) wert += 40; });
            wert += Math.min(spool.remaining_weight || 0, 1000) / 100;  // Rest als Stichentscheid
            if (wert > bestwert) { bestwert = wert; beste = spool; }
        });
        return beste;
    }

    async showMultiFilamentSpoolModal(fileData, location, mode = 'print') {
        const texts = window.texts || {};

        // Hole Plate-Info (mit filament_ids pro Plate) parallel zur
        // Spoolman-Abfrage. Wenn das 3MF Multi-Plate ist UND die Platten
        // unterschiedliche Filamente benutzen, blenden wir oben im Modal
        // einen Plate-Selector ein und zeigen nur die wirklich benutzten
        // Filamente. Fuer Single-Plate / wenn plate_details leer sind,
        // laeuft der alte Flow (alle Filamente).
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

        // Helper: welche Filamente sind auf der aktuell gewaehlten Plate?
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

        // Aufbau wie die uebrigen Dialoge (ui-karte): der hier trug bis
        // 21aug26 durchgehend eigene Inline-Stile und war damit die fuenfte
        // Bauform im selben Programm.
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%;'
            + 'background:rgba(0,0,0,0.6); z-index:10000; display:flex;'
            + 'align-items:center; justify-content:center;';

        const content = document.createElement('div');
        content.className = 'modal-panel';
        content.style.cssText = 'position:relative; width:92%; max-width:600px;'
            + 'max-height:85vh; overflow-y:auto; border-radius:12px; padding:0;';

        // Plate-Selector nur zeigen wenn mehrere Platen mit filament_ids da sind
        const showPlateSelector = plateDetails.length > 1;
        if (plateDetails.length >= 1) {
            // Default: erste Plate — auch bei Single-Plate-3MFs mit
            // filament_ids-Info wollen wir filtern (es koennten weniger
            // Filamente wirklich benutzt werden als im Projekt definiert).
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

        // Lade Spulen VOR der Schleife
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
            // Jede Spule nur einmal vorschlagen.
            const vergeben = new Set();
            if (descEl) {
                descEl.textContent = texts.multifilament_description.replace('{count}', visible.length);
            }
            listDiv.innerHTML = '';
            visible.forEach(fil => {
                // Eine Zeile je Filament: links Farbe, Name und Typ,
                // rechts die Spulenwahl. Vorher war jedes Filament ein
                // eigener grauer Kasten mit Ueberschrift darin.
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

                // Fülle Dropdown mit vorher geladenen Spulen
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

                // Vorauswahl: passendes Material, dann naechste Farbe.
                const treffer = this._besteSpule(fil, spools, vergeben);
                if (treffer) {
                    select.value = String(treffer.id);
                    vergeben.add(treffer.id);
                }

                // Warnzeile unter der Wahl. Das Material des Drucks steht
                // klein neben dem Namen — beim Ueberfliegen sieht man eine
                // falsche Spule sonst nicht (21aug26: fast ASA mit PETG
                // gedruckt).
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

            // Plate-Pick speichern damit der nachfolgende Druck-Start die
            // Auswahl automatisch uebernimmt (spart dem User den 2. Plate-
            // Picker) und der Backend-Code das richtige Gcode startet.
            if (selectedPlateIdx !== null) {
                window.pendingPlateOverride = selectedPlateIdx;
            }

            console.log(texts.console_multifilament_mapping, mapping);

            if (mode === 'schedule') {
                // SCHEDULE MODUS: Speichere nur Mapping und öffne Schedule Modal
                window.pendingScheduleMapping = mapping;
                this._aktualisierePlanButton();
                modal.remove();

                this.scheduledFileName = fileData.name;
                this.scheduledFileLocation = location;

                // Öffne Schedule Modal MANUELL
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

                // Vorbereitung zeichnen — dieselbe Ansicht wie sonst auch.
                // Hier kommt der Mehrfarben-Weg an: die Spulenzuordnung ist
                // schon getroffen, es fehlen nur noch Zeit und Optionen.
                if (window.printPrepare) {
                    const self = window.printScheduler;
                    self.prepareHandle = null;
                    // MIT Zielkarten, genau wie der einfarbige Weg weiter
                    // oben. Ohne sie schreibt rendereIn den ganzen Stapel
                    // (Datei, Platte, Filament, Optionen) in EINEN Block —
                    // und weil die vier Karten daneben schon gefuellt waren,
                    // standen die Druckoptionen zweimal im Dialog. Sichtbar
                    // nur bei mehr als einem Filament, weil nur dieser Weg
                    // hier vorbeikommt (28aug26 gemeldet).
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
                // PRINT MODUS: Direkt drucken - OHNE Schedule-Zeug!
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
        // Die Liste stand frueher im Anlege-Dialog und wurde hier gefuellt.
        // Sie hat seit 21aug26 einen eigenen Bildschirm; der Aufruf bedeutet
        // jetzt schlicht "die geplanten Drucke haben sich geaendert":
        // Zaehler auffrischen und, falls die Uebersicht offen steht, sie neu
        // zeichnen. Die vielen Aufrufer bleiben damit unveraendert richtig.
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
                    // Badge anzeigen mit Anzahl
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
                    // Badge verstecken wenn keine geplanten Drucke
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

        showConfirmDialog(texts.confirm_delete_scheduled, function() {
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
    // Zeit-Konflikt: der Companion warnt, wenn der Termin in den laufenden
    // Druck oder in einen anderen geplanten faellt. Bewusst KEINE Blockade —
    // knapp planen ist erlaubt, es soll nur nicht unbemerkt passieren.
    showScheduleConflictDialog(conflict, requestData, scheduledDateTime) {
        const texts = window.texts || {};
        const title = conflict.type === 'running'
            ? (texts.schedule_conflict_running || 'Druck laeuft noch')
            : (texts.schedule_conflict_overlap || 'Termin ueberlappt');
        const message = `\u26a0\ufe0f ${title}:\n\n${conflict.message}\n\n`
            + (texts.schedule_conflict_confirm || 'Trotzdem einplanen?');

        showConfirmDialog(message, () => {
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

        showConfirmDialog(message, () => {
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

                // NEU: Prüfe Drucker-Status und zeige SD-Dateien wenn keine Drucke geplant
                if ((!data.prints || data.prints.length === 0)) {
                    // Klipper: Host (SBC/RPi) ist meist permanent online, auch
                    // wenn der Drucker-Strom aus ist — Files sind immer
                    // verfuegbar. Wir ueberspringen den switch-Check.
                    if (isKlipper) {
                        this.showSDFilesInScheduleManager(container);
                        return;
                    }
                    // Prüfe Drucker-Status
                    // Ohne geplante Drucke gleich die Dateien zum Planen
                    // zeigen — unabhaengig davon, ob der Drucker laeuft.
                    //
                    // Vorher gab es bei laufendem Drucker nur den Hinweis
                    // „Gehe zur SD-Karte": ein Klick schloss dieses Fenster,
                    // oeffnete die normale Dateiliste, und dort musste man je
                    // Datei nochmal auf „Planen". Drei Schritte fuer das, was
                    // man beim Oeffnen von „Geplante Drucke" ohnehin vorhatte.
                    this.showSDFilesInScheduleManager(container);
                    return; // Rest macht showSDFilesInScheduleManager
                }

                if (data.prints && data.prints.length > 0) {
                    // Die Files-Liste immer mit anzeigen. Auch bei Bambu soll
                    // man weitere Drucke planen koennen, waehrend der Drucker
                    // eingeschaltet ist.
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

                    // Geplante Drucke 1:1 mit der SD-Card-Card rendern —
                    // wir holen erst die volle Files-Liste (Klipper: Adapter,
                    // Bambu: /api/mqtt/sdcard mit Metadata) und matchen jede
                    // Plan-Zeile per filename. Bei Klipper greift bei Host-
                    // offline automatisch der Cache aus /api/printer/files.
                    // per_page=all: der Abgleich braucht ALLE Dateien,
                    // nicht die erste Seite der Blaetterleiste.
                    const filesPromise = isKlipper
                        ? window.printerAdapter.listFiles({ per_page: 'all' }).then(r => r.files || [])
                        : apiCall('/api/mqtt/sdcard?per_page=all').then(r => r.json()).then(d => d.files || []);

                    const renderWithFiles = (files) => {
                        window.lastScheduleSDFiles = files || [];
                        const byName = {};
                        (files || []).forEach(f => {
                            if (f && f.name) byName[f.name] = f;
                        });
                        // State fuer Re-Render beim Sort-Wechsel
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
    // renderScheduledPrintsCards — rendert die Cards aus scheduledPrintsState
    // (wird beim Initial-Load UND beim Sort-Wechsel aufgerufen)
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
                    // print_time ist "1h 17min" — parsen zu Minuten.
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

        // Eigene Zeile statt der SD-Karten-Kachel: die trug Dateigroesse,
        // Slicer-Version und Schichthoehe mit — Angaben, die beim Planen
        // niemand braucht und die den Termin untergingen liessen.
        listEl.className = 'sched-liste';
        listEl.innerHTML = prints.map(print =>
            this.geplanterEintragHtml(print, state.byName[print.filename])).join('');
    }

    // ========================================
    // geplanterEintragHtml — eine Zeile der Uebersicht
    // ========================================

    /** Datum als "Fr 21.08. · 07:30" in der Sprache der Oberflaeche. */
    _terminText(datum) {
        const spr = (window.i18nManager && window.i18nManager.currentLanguage) || 'de';
        const tag = datum.toLocaleDateString(spr, { weekday: 'short', day: '2-digit', month: '2-digit' });
        const uhr = datum.toLocaleTimeString(spr, { hour: '2-digit', minute: '2-digit' });
        return `${tag} · ${uhr}`;
    }

    /**
     * Wie lange noch — "in 7 h", "morgen", "in 3 Tagen". Die Zeit ist der
     * Grund, warum der Eintrag existiert; bisher musste man selbst rechnen.
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

        // Vorschau: dieselbe Quelle wie die SD-Liste.
        const bild = (datei && datei.has_thumbnail !== false)
            ? `<img src="/api/sd_thumbnail/${encodeURIComponent(print.filename)}" alt=""
                    onerror="this.style.display='none'">` : '';

        // Zeile 1 der Angaben: was der Druck IST.
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

        // Zeile 2: was EINGESTELLT ist. Bett, Fluss und Duesenversatz zu
        // einem Eintrag gebuendelt — dreimal derselbe Standardwert half nie.
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
        // Der Untertitel behauptete frueher „Drucker ist ausgeschaltet" —
        // diese Liste kommt jetzt aber auch bei laufendem Drucker.
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

        // Lade SD-Dateien
        this.loadSDFilesForScheduling();
    }

    // ========================================
    // loadSDFilesForScheduling
    // ========================================
    loadSDFilesForScheduling() {
        const texts = window.texts || {};

        // Klipper: /api/printer/files liefert das Bambu-kompatible Format
        // bereits inklusive Metadata (filament_type, weight, slicer,
        // estimated_time, layer_count, ...). Direkt durchreichen, NICHT
        // mappen — sonst verlieren wir die Metadaten und die Cards sehen
        // anders aus als im SD-Modal.
        // per_page=all: die Dateiwahl im Planer zeigt den ganzen Bestand.
        const fetchPromise = (window.isKlipperMode && window.isKlipperMode())
            ? window.printerAdapter.listFiles({ per_page: 'all' }).then(r => ({ files: r.files || [] }))
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
                    // Initial-Render ueber sortScheduleSDFiles damit der
                    // Default-Sort (Datum, neueste zuerst) auch greift —
                    // sonst kommen die Files in der Backend-Reihenfolge.
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

        // Identisch zur SD-Modal-Card (Thumbnail, Filament, Layer-Height,
        // Slicer, ...) — nur die Action-Buttons sind auf "Planen" reduziert.
        // Renderer kommt aus dem SDCardManager-Singleton.
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

        // SD-Dateien laden falls nicht vorhanden — bei Klipper unified Files
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
            // Normal weiter
            document.getElementById('scheduleManagerModal').remove();
            this.schedulePrintFromSD(filename, location);
        }
    }

    // ========================================
    // editScheduledPrint — geplanten Druck bearbeiten: Schedule-Modal mit
    // den gespeicherten Werten öffnen, Bestätigen ersetzt den Eintrag.
    // ========================================
    editScheduledPrint(printId) {
        const print = this.scheduledPrintsState?.prints?.find(p => p.id === printId);
        if (!print) return;

        this.cameFromScheduleManager = true;
        // Files-Cache für Metadaten (print_time/weight) sicherstellen —
        // die Manager-Liste hat sie schon geladen.
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

        showConfirmDialog(texts.confirm_delete_scheduled, function() {
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
     * Die Material-Karte haelt zwei Dinge, die beide fehlen koennen: die
     * Spulenwahl (nur mit Spoolman) und das Filament je Duese (nur wenn die
     * Datei welches meldet). Ohne beides bliebe eine leere Karte stehen.
     */
    /**
     * Dateiname als Rueckfall. Im Bambu-Modus zeichnet die Druckvorbereitung
     * gleich darauf eine Datei-Karte mit Vorschau, Name und Eckdaten und
     * blendet diese Zeile wieder aus — sonst stuende der Name doppelt.
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
     * Kann dieser Drucker Filament trocknen? Bevorzugt die Live-Meldung,
     * sonst die Faehigkeitsliste des Servers (die sich ein einmal gesehenes
     * heizendes AMS merkt und den Einstellungs-Haken kennt). Klipper-Direkt
     * hat kein heizendes AMS.
     */
    _kannTrocknen() {
        if (window.isKlipperMode && window.isKlipperMode()) return false;
        const einheiten = (window.lastPrintData?.ams?.units) || [];
        if (einheiten.some(u => u.can_dry)) return true;
        const faehig = window.lastCapabilities
            || window.lastPrintData?.capabilities || {};
        return faehig.ams_drying === true;
    }

    /** Werte des Trocknungs-Blocks fuer die Anfrage. */
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
     * Trocknungs-Block aufbauen: Haken nur zeigen, wenn ein
     * trocknungsfaehiges AMS gemeldet wird, Filamentliste aus den
     * vorhandenen Voreinstellungen, und die errechnete Einschaltzeit
     * anzeigen.
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

        // Filamentliste ZUERST fuellen — sie haengt nicht am Drucker,
        // sondern an den Studio-Voreinstellungen. Vorher stand sie hinter
        // dem Sichtbarkeits-Check und blieb beim Bearbeiten leer, sobald der
        // Drucker aus war.
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

        // Sichtbarkeit aus den Faehigkeiten, nicht aus den Live-AMS-Daten:
        // ein ausgeschalteter Drucker meldet keine Einheiten, und genau dann
        // plant man. capabilities.ams_drying kennt zusaetzlich das einmal
        // gesehene AMS und den Haken "AMS verwenden" aus den Einstellungen.
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
     * Temperatur und Dauer aus der Voreinstellung des gewaehlten Typs.
     * BAMBU_DRY_PRESETS haelt je Typ zwei Paare [Grad, Stunden]: [0] fuer
     * den ruhenden Drucker, [1] waehrend eines Drucks. Vorgetrocknet wird
     * vor dem Druck, also immer [0] — dieselbe Wahl wie im Dialog der
     * Material-Zone.
     *
     * @param {boolean} ueberschreiben Bei der Typwahl gewinnt die
     *        Voreinstellung; beim blossen Aktivieren bleiben eingetragene
     *        Werte (und die eines bearbeiteten Eintrags) stehen.
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
     * Zeigt, wann der Drucker dafuer angehen muss — und warnt, wenn das
     * schon vorbei ist. Kein hartes Verbot: eine kurze Trocknung kann
     * gewollt sein.
     */
    trocknungHinweis() {
        const strahl = document.getElementById('schedule-dry-strahl');
        const box = document.getElementById('schedule-dry-hinweis');
        const an = document.getElementById('schedule-dry-enabled');
        if (!box || !an) return;
        if (strahl) strahl.innerHTML = '';
        if (!an.checked) { box.textContent = ''; return; }

        const texts = window.texts || {};
        const PUFFER = 10;   // Minuten fuers Hochfahren, Homing und Parken
        const std = parseFloat(document.getElementById('schedule-dry-std')?.value) || 0;
        const datum = document.getElementById('schedule-date')?.value;
        const uhr = document.getElementById('schedule-time')?.value;
        if (!std || !datum || !uhr) { box.textContent = ''; return; }

        const druck = new Date(datum + 'T' + uhr);
        const start = new Date(druck.getTime() - (std * 60 + PUFFER) * 60000);
        const trocknung = new Date(start.getTime() + PUFFER * 60000);
        const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' +
                            String(d.getMinutes()).padStart(2, '0');

        // Zu knapp: der Drucker muesste jetzt schon laufen. Kein Verbot —
        // eine kurze Trocknung kann gewollt sein.
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
function editScheduledPrint(printId) { window.printScheduler.editScheduledPrint(printId); }
function deleteScheduledPrint(printId) { window.printScheduler.deleteScheduledPrint(printId); }
function sortScheduleSDFiles() { window.printScheduler.sortScheduleSDFiles(); }
function sortScheduledPrints() { window.printScheduler.renderScheduledPrintsCards(); }
function filterScheduleSDFiles() { window.printScheduler.filterScheduleSDFiles(); }
function displayScheduleSDFiles(files) { window.printScheduler.displayScheduleSDFiles(files); }
