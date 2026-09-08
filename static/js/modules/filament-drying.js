/**
 * Filament Drying Manager
 * Controls filament drying feature with material selection, progress tracking
 */
class FilamentDryingManager {
    /** The server carries a coloured circle as an emoji per material. The
     *  interface shows a real dot instead -- the same language as the colour
     *  dots on the AMS trays. Inside an <option> no markup works, so the name
     *  stands alone there. */
    materialFarbe(emoji) {
        return {
            '🟢': '#22c55e', '🔵': '#3b82f6', '🟡': '#eab308', '🟠': '#f97316',
            '🔴': '#ef4444', '🟣': '#a855f7', '🟤': '#92400e', '⚫': '#3f3f46',
            '⚪': '#d4d4d8',
        }[emoji] || 'var(--text-secondary)';
    }

    constructor() {
        this.dryingMaterials = [];
        this.selectedMaterial = null;
        this.filamentDryingEnabled = false;

        // Initialise on load -- the drying card is non-critical, so defer it
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof deferNonCritical === 'function') {
                deferNonCritical(() => {
                    this.initMaterialSelector();
                    this.updateUI();
                    // Fetch once on load, after that the socket feeds it
                    // (socket-manager: 'filament_drying_status' calls
                    // updateStatus(daten)).
                    this.updateStatus();
                    // A net in case a push is lost -- and only while drying
                    // really runs. Without a running dry there is nothing to
                    // ask about here.
                    setInterval(() => {
                        if (window.isFilamentDrying) this.updateStatus();
                    }, 60000);
                });
            }
        });
    }

    // Card visibility, based on the printer state and the feature flag
    updateCardVisibility() {
        const card = document.getElementById('filament-drying-card-grid');
        const content = document.getElementById('filament-drying-content');
        if (!card || !content) return;

        const prevDisplay = card.style.display;

        // The printer is online when the switch is ON AND MQTT is connected.
        // See status-manager.js: without a configured socket the connection
        // decides. This card used to stay hidden forever on a rig without a
        // socket, although it was switched on in the settings.
        const switchOn = window.lastKnownSwitchState === 'on';
        const mqttConnected = window.lastMqttStatus === true;
        const printerOnline = (typeof window.druckerDa === 'boolean')
            ? window.druckerDa
            : (switchOn && mqttConnected);

        if (window.cardDryingHiddenBySettings || !printerOnline || !this.filamentDryingEnabled) {
            card.style.display = 'none';
        } else {
            // All good -- show the card and its content
            card.style.display = '';
            // '' instead of 'block': in the stylesheet the card is a flex with
            // twelve points of gap. An inline style beats every rule -- it
            // stood on block, `gap` did nothing and all the rows stuck
            // together.
            content.style.display = '';
        }

        // Adjust the grid height when the visibility changed
        if (prevDisplay !== card.style.display) {
            setTimeout(() => { if (typeof adjustGridHeight === 'function') adjustGridHeight(); }, 50);
        }
    }

    // Load the material list
    async loadMaterials() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/filament/dry/materials');
            const data = await response.json();

            if (data.success) {
                // Check whether the printer has an enclosed chamber
                if (data.has_chamber === false) {
                    console.log(`Filament drying not available: ${data.message || 'closed printers only'}`);
                    this.filamentDryingEnabled = false;
                    this.updateCardVisibility();
                    return;
                }

                this.dryingMaterials = data.materials;
                // Does the printer dry by itself? Then our homing and
                // parking falls away — it does that in its own routine.
                this.nativ = !!data.nativ;
                this.letzteTrocknung = data.letzte_trocknung || null;
                const homingZeile = document.getElementById('skip-homing-checkbox')
                    ?.closest('.tr-schalter-zeile');
                if (homingZeile) homingZeile.hidden = this.nativ;
                this.zeigeNativHinweis();
                const selector = document.getElementById('material-selector');

                // Fill the dropdown
                selector.innerHTML = `<option value="">${texts.select_filament}</option>`;
                data.materials.forEach(material => {
                    const option = document.createElement('option');
                    option.value = material.name;
                    // The name ONLY. Degrees and duration stand right below
                    // in the two boxes -- in the picker they were there a
                    // second time and blew the width: "ABS (90-100°C, 12h)"
                    // became "ABS (90-100°C, 12". The range stays as a hint.
                    option.textContent = material.name;
                    option.title = `${material.temp_min}-${material.temp_max}°C · ${material.duration_hours}h`;
                    selector.appendChild(option);
                });

                // Store the feature state (only when has_chamber)
                this.filamentDryingEnabled = data.enabled && data.has_chamber;

                // Update the card visibility (it accounts for the printer state)
                this.updateCardVisibility();
            }
        } catch (error) {
            console.error((texts && texts.console_error_loading_materials) || '❌ Error while loading the materials' + ':', error);
        }
    }

    /**
     * The hint for the native path.
     *
     * The device does not report the presets from the printer menu —
     * checked in the recording on 30aug26. What it does give away is the command
     * itself: if somebody starts on the display, we overhear degrees and hours.
     * Those stand here and can be taken over with one tap.
     */
    zeigeNativHinweis() {
        const texts = window.texts || {};
        const zeile = document.getElementById('drying-native-hint');
        const text = document.getElementById('drying-native-text');
        const knopf = document.getElementById('drying-native-uebernehmen');
        if (!zeile || !text || !knopf) return;
        zeile.hidden = !this.nativ;
        if (!this.nativ) return;
        text.textContent = texts.drying_native_hint || '';
        const letzte = this.letzteTrocknung;
        const gewaehlt = this.selectedMaterial || {};
        const gleich = letzte && gewaehlt.native_temp
            && letzte.temp === gewaehlt.native_temp
            && letzte.stunden === gewaehlt.native_hours;
        // The button shows what really ran on the display last — but only
        // when that differs from the values out of the menu.
        knopf.hidden = !(letzte && letzte.temp && letzte.stunden) || !!gleich;
        if (knopf.hidden) return;
        knopf.textContent = `${letzte.temp} °C · ${letzte.stunden} h`;
        knopf.onclick = () => {
            const grad = document.getElementById('material-temp');
            const dauer = document.getElementById('material-duration');
            if (grad) grad.value = letzte.temp;
            if (dauer) dauer.value = letzte.stunden;
        };
    }

    // Material-Auswahl Handler
    initMaterialSelector() {
        const texts = window.texts || {};
        const selector = document.getElementById('material-selector');
        if (!selector) return;

        selector.addEventListener('change', () => {
            const materialName = selector.value;
            this.selectedMaterial = this.dryingMaterials.find(m => m.name === materialName);

            const startBtn = document.getElementById('start-drying-btn');
            const materialInfo = document.getElementById('material-info');

            if (this.selectedMaterial) {
                // Show the material info
                const tempAvg = Math.round((this.selectedMaterial.temp_min + this.selectedMaterial.temp_max) / 2);
                // The default FILLS the fields -- they stay editable.
                // The recommended range hangs off the field as a hint.
                const tempFeld = document.getElementById('material-temp');
                // If the printer dries by itself, ITS values apply — read off
                // the display (30aug26). Otherwise our default from the
                // middle of the recommended range.
                const nativGrad = this.nativ && this.selectedMaterial.native_temp;
                const nativStunden = this.nativ && this.selectedMaterial.native_hours;
                tempFeld.value = nativGrad || tempAvg;
                tempFeld.title = nativGrad
                    ? `${texts.drying_native_values || ''} ${nativGrad}°C`
                    : `${this.selectedMaterial.temp_min}-${this.selectedMaterial.temp_max}°C`;
                document.getElementById('material-duration').value =
                    nativStunden || this.selectedMaterial.duration_hours;
                // '' instead of 'block': in the stylesheet the row is a flex --
                // 'block' would have put label and fields underneath each other.
                materialInfo.style.display = '';

                // Enable the button only when NO print is running
                const isPrinting = window.lastPrintData &&
                                  (window.lastPrintData.gcode_state === 'RUNNING' ||
                                   window.lastPrintData.gcode_state === 'PREPARE');
                if (!isPrinting) {
                    startBtn.disabled = false;
                    startBtn.style.opacity = '';
                // Set the LABEL only: textContent on the button would throw
                // the glyph beside it away with it.
                    const beschriftung = document.getElementById('start-drying-text');
                    if (beschriftung) beschriftung.textContent = texts.start_drying;
                }
            } else {
                materialInfo.style.display = 'none';
                startBtn.disabled = true;
                startBtn.style.opacity = '';   // blass macht jetzt :disabled
            }
        });
    }

    // Start the drying
    async start() {
        const texts = window.texts || {};
        if (!this.selectedMaterial) {
            skToast(texts.toast_select_material, 'error');
            return;
        }

        await this.starteMit(null);
    }

    /**
     * The actual start. `ignoriere` carries the prompts the
     * printer raised on the first attempt — it then accepts the
     * command (recorded on the device 30aug26: refused with `err_index`,
     * accepted with `err_ignored`).
     */
    async starteMit(ignoriere) {
        const texts = window.texts || {};
        try {
            const skipHoming = document.getElementById('skip-homing-checkbox').checked;
            const response = await apiCall('/api/filament/dry/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    material: this.selectedMaterial.name,
                    skip_positioning: skipHoming,
                    // Whatever stands in the fields -- the server trims it to
                    // the range the print bed allows.
                    temp: Number(document.getElementById('material-temp').value) || undefined,
                    hours: Number(document.getElementById('material-duration').value) || undefined,
                    ignoriere: ignoriere || undefined
                })
            });

            const result = await response.json();

            // The printer asks for something instead of refusing — show it and
            // offer to override it.
            if (!result.success && result.aufforderung && !ignoriere) {
                const weiter = await window.skConfirm(result.aufforderung.text, {
                    title: texts.drying_prompt_title,
                    okText: texts.drying_prompt_ok,
                });
                if (weiter) {
                    await this.starteMit([result.aufforderung.index]);
                }
                return;
            }

            if (result.success) {
                const currentLang = window.currentLang || 'de';
                const positioningText = skipHoming ? (window.currentLang === 'de' ? ' (ohne Homing)' : ' (without homing)') : '';
                // On the native path the preparation runs first — and we say
                // so. "Drying started" would be a lie, it only begins after
                // that.
                const meldung = this.nativ
                    ? (texts.toast_drying_prepare || texts.toast_drying_started)
                    : texts.toast_drying_started;
                skToast(meldung.replace('{material}', this.selectedMaterial.name) + positioningText, 'success');
                this.updateUI();
            } else {
                skToast(texts.error + ': ' + result.error, 'error');
            }
        } catch (error) {
            console.error(texts.console_start_drying_error + ':', error);
            skToast(texts.toast_error_starting, 'error');
        }
    }

    // Stop the drying
    async stop() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/filament/dry/stop', {
                method: 'POST'
            });

            const result = await response.json();

            if (result.success) {
                skToast(texts.toast_drying_stopped, 'success');
                this.updateUI();
            } else {
                skToast(texts.error + ': ' + result.error, 'error');
            }
        } catch (error) {
            console.error(texts.console_stop_drying_error + ':', error);
            skToast(texts.toast_error_stopping, 'error');
        }
    }

    // Refresh the status
    /**
     * @param {Object} [daten] status from the socket. Without it, fetched.
     *
     * The server pushes the drying state anyway (the event
     * 'filament_drying_status', and it additionally sits as `filament_drying`
     * in every print_progress). The fetch here nevertheless ran every 10
     * seconds -- even when nothing was drying, and it dragged another
     * /api/status call along through _applyControlsVisibility.
     */
    async updateStatus(daten) {
        const texts = window.texts || {};
        try {
            const status = daten || await apiCall('/api/filament/dry/status')
                .then(r => r.json());

            // UI Update - Card
            const selectionDiv = document.getElementById('material-selection');
            const activeDiv = document.getElementById('drying-active');
            const indicator = document.getElementById('drying-status-indicator');

            // UI Update - Banner
            const details = document.getElementById('filament-drying-details');

            // Global Status aktualisieren
            window.isFilamentDrying = status.active;
            // Set the controls and print state to match IMMEDIATELY (not only
            // on the next live socket update) -- fixes the controls flashing
            // on open until a filament_drying_status event arrived.
            this._applyControlsVisibility(status.active);

            if (status.active) {
                // Show the card
                selectionDiv.style.display = 'none';
                activeDiv.style.display = '';   // siehe oben: flex aus dem Stylesheet
                indicator.style.background = 'var(--accent-green)';

                // Update the banner details (the helper then decides whether
                // the message stays at all).
                if (status.end_time_formatted) {
                    const temp = Math.round(status.temperature);
                    details.textContent = texts.filament_drying_banner_with_endtime
                        .replace('{temp}', temp)
                        .replace('{time}', status.end_time_formatted);
                } else if (status.bed_temp !== undefined) {
                    const temp = Math.round(status.bed_temp);
                    const minutes = Math.round(status.elapsed_minutes || (status.elapsed_seconds / 60));
                    details.textContent = texts.filament_drying_banner_auto
                        .replace('{temp}', temp)
                        .replace('{minutes}', minutes);
                }
                window.applyDryingBanner(status);

                // Card: Farbpunkt des Materials
                const material = this.dryingMaterials.find(m => m.name === status.material);
                const punkt = document.getElementById('drying-material-punkt');
                if (punkt) punkt.style.background = material
                    ? this.materialFarbe(material.emoji) : 'var(--text-secondary)';

                // Card: Infos aktualisieren
                document.getElementById('drying-material-name').textContent = status.material;
                document.getElementById('drying-temp').textContent = `${status.temperature}°C`;

                // Card: Zeit formatieren
                const elapsed = this._formatDuration(status.elapsed_seconds);
                const total = this._formatDuration(status.duration_hours * 3600);
                document.getElementById('drying-elapsed').textContent = elapsed;
                document.getElementById('drying-total').textContent = total;

                // Card: Progress
                document.getElementById('drying-progress-percent').textContent = `${Math.round(status.progress)}%`;
                document.getElementById('drying-progress-bar').style.width = `${status.progress}%`;

            } else {
                // Card ausblenden
                selectionDiv.style.display = '';   // siehe oben: flex aus dem Stylesheet
                activeDiv.style.display = 'none';
                indicator.style.background = 'var(--text-secondary)';

                window.applyDryingBanner(status);
            }
        } catch (error) {
            console.error(texts.console_update_drying_status_error + ':', error);
        }
    }

    // Show or hide the controls (dev control card) and the print state for
    // drying. Used by the immediate poll (updateStatus) AND by the live socket
    // handler (socket-manager) -> one logic, no lag, no duplication.
    _applyControlsVisibility(active) {
        // Steer the WHOLE dev control card (card plus buttons) through
        // checkDeveloperMode: it reads window.isFilamentDrying (set before)
        // and hides or shows the COMPLETE card via hideDevCards()/showDevCards().
        // Hiding only .control-grid left an empty card shell (frame and title).
        if (typeof checkDeveloperMode === 'function') checkDeveloperMode();
        const printStatus = document.getElementById('print-status-container');
        if (printStatus) printStatus.style.display = active ? 'none' : '';
    }

    // Zeit formatieren (Sekunden -> HH:MM)
    _formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }

    // Initialisierung
    async updateUI() {
        await this.loadMaterials();
        await this.updateStatus();
    }
}

// Global singleton
window.filamentDryingManager = new FilamentDryingManager();

// Backwards compatibility
window.updateFilamentCardVisibility = () => window.filamentDryingManager.updateCardVisibility();
window.loadDryingMaterials = () => window.filamentDryingManager.loadMaterials();
window.initDryingMaterialSelector = () => window.filamentDryingManager.initMaterialSelector();
window.startFilamentDrying = () => window.filamentDryingManager.start();
window.stopFilamentDrying = () => window.filamentDryingManager.stop();
window.updateDryingStatus = () => window.filamentDryingManager.updateStatus();
window.applyDryingControlsVisibility = (active) => window.filamentDryingManager._applyControlsVisibility(active);

/**
 * The drying message stands while drying runs.
 *
 * This is ONLY about the manual drying over the print bed -- that blocks
 * homing, parking and the print start, and that has to be visible.
 *
 * A special path for "the AMS dries alongside a print" used to stand here.
 * It never belonged: the AMS drying runs through the material card, shows
 * its state there and blocks nothing. This card only had anything to do with
 * it because the server redirected its drying to the AMS -- which it no
 * longer does.
 */
window.applyDryingBanner = function (status) {
    const el = document.getElementById('filament-drying-banner');
    if (!el) return;
    el.classList.toggle('active', !!(status && status.active));
};

window.updateDryingUI = () => window.filamentDryingManager.updateUI();
window.formatDuration = (s) => window.filamentDryingManager._formatDuration(s);
