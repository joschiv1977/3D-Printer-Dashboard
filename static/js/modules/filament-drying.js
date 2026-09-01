/**
 * Filament Drying Manager
 * Controls filament drying feature with material selection, progress tracking
 */
class FilamentDryingManager {
    /** Der Server fuehrt je Material einen farbigen Kreis als Emoji. In der
     *  Oberflaeche steht dafuer ein echter Punkt — dieselbe Sprache wie die
     *  Farbpunkte an den AMS-Faechern. Im Auswahlfeld (<option>) geht kein
     *  Markup, dort bleibt der Name allein. */
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

        // Beim Laden initialisieren — Drying-Card ist non-critical, deferren
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof deferNonCritical === 'function') {
                deferNonCritical(() => {
                    this.initMaterialSelector();
                    this.updateUI();
                    // Einmal beim Laden holen, danach fuettert der Socket
                    // (socket-manager: 'filament_drying_status' ruft
                    // updateStatus(daten) auf).
                    this.updateStatus();
                    // Netz fuer den Fall, dass ein Push verlorengeht — und
                    // nur waehrend wirklich getrocknet wird. Ohne laufende
                    // Trocknung gibt es hier nichts nachzufragen.
                    setInterval(() => {
                        if (window.isFilamentDrying) this.updateStatus();
                    }, 60000);
                });
            }
        });
    }

    // Filament Card Sichtbarkeit basierend auf Drucker-Status und Feature-Flag
    updateCardVisibility() {
        const card = document.getElementById('filament-drying-card-grid');
        const content = document.getElementById('filament-drying-content');
        if (!card || !content) return;

        const prevDisplay = card.style.display;

        // Drucker ist online wenn: Switch ist ON UND MQTT verbunden
        // Siehe status-manager.js: ohne eingerichtete Steckdose entscheidet
        // die Verbindung. Vorher blieb diese Karte auf einer Anlage ohne Dose
        // fuer immer verborgen, obwohl sie in den Einstellungen an war.
        const switchOn = window.lastKnownSwitchState === 'on';
        const mqttConnected = window.lastMqttStatus === true;
        const printerOnline = (typeof window.druckerDa === 'boolean')
            ? window.druckerDa
            : (switchOn && mqttConnected);

        if (window.cardDryingHiddenBySettings || !printerOnline || !this.filamentDryingEnabled) {
            card.style.display = 'none';
        } else {
            // Alles OK - Card und Content anzeigen
            card.style.display = '';
            // '' statt 'block': die Karte ist im Stylesheet ein flex mit
            // zwoelf Punkten Abstand. Ein Inline-Stil schlaegt jede Regel —
            // damit stand sie auf block, `gap` war wirkungslos und alle
            // Zeilen klebten aneinander (27aug26 am lebenden Objekt
            // gemessen: 623 → 623, 652 → 652).
            content.style.display = '';
        }

        // Grid-Höhe anpassen wenn sich Sichtbarkeit geändert hat
        if (prevDisplay !== card.style.display) {
            setTimeout(() => { if (typeof adjustGridHeight === 'function') adjustGridHeight(); }, 50);
        }
    }

    // Material-Liste laden
    async loadMaterials() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/filament/dry/materials');
            const data = await response.json();

            if (data.success) {
                // Check ob Drucker geschlossenes Gehäuse hat
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

                // Dropdown füllen
                selector.innerHTML = `<option value="">${texts.select_filament}</option>`;
                data.materials.forEach(material => {
                    const option = document.createElement('option');
                    option.value = material.name;
                    // NUR der Name. Grad und Dauer stehen direkt darunter in
                    // den beiden Kaestchen — in der Auswahl waren sie ein
                    // zweites Mal da und sprengten dabei die Breite: aus
                    // "ABS (90-100°C, 12h)" wurde "ABS (90-100°C, 12"
                    // (27aug26). Die Spanne bleibt als Kurzhinweis erhalten.
                    option.textContent = material.name;
                    option.title = `${material.temp_min}-${material.temp_max}°C · ${material.duration_hours}h`;
                    selector.appendChild(option);
                });

                // Feature Status speichern (nur wenn has_chamber)
                this.filamentDryingEnabled = data.enabled && data.has_chamber;

                // Card Sichtbarkeit aktualisieren (berücksichtigt Drucker-Status)
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
                // Material-Info anzeigen
                const tempAvg = Math.round((this.selectedMaterial.temp_min + this.selectedMaterial.temp_max) / 2);
                // Die Voreinstellung FUELLT die Felder — sie sind aenderbar.
                // Die empfohlene Spanne haengt als Kurzhinweis am Feld.
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
                // '' statt 'block': die Zeile ist im Stylesheet ein flex —
                // 'block' haette Beschriftung und Felder untereinander gestellt.
                materialInfo.style.display = '';

                // Button nur aktivieren wenn KEIN Druck läuft
                const isPrinting = window.lastPrintData &&
                                  (window.lastPrintData.gcode_state === 'RUNNING' ||
                                   window.lastPrintData.gcode_state === 'PREPARE');
                if (!isPrinting) {
                    startBtn.disabled = false;
                    startBtn.style.opacity = '';
                    // NUR die Beschriftung setzen: textContent auf dem Knopf
                    // wuerde das Zeichen daneben mit wegwerfen.
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

    // Trocknung starten
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
                    // Was in den Feldern steht — der Server stutzt es in den
                    // Rahmen, den das Druckbett hergibt.
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
                // so. "Drying started" would be a lie, it only begins
                // erst danach an (30aug26 am Geraet gesehen).
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

    // Trocknung stoppen
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

    // Status aktualisieren
    /**
     * @param {Object} [daten] Status aus dem Socket. Ohne Angabe wird geholt.
     *
     * Der Server pusht den Trocknungsstand ohnehin (Ereignis
     * 'filament_drying_status', und seit 20aug26 steckt er zusaetzlich als
     * `filament_drying` in jedem print_progress). Das Holen hier lief
     * trotzdem alle 10 Sekunden weiter — auch wenn gar nicht getrocknet
     * wurde, und es zog ueber _applyControlsVisibility noch einen
     * /api/status-Aufruf hinterher.
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
            // Steuerung/Print-Status SOFORT passend setzen (nicht erst beim nächsten
            // Live-Socket-Update) — fixt: Steuerung blitzt beim Öffnen auf, bis ein
            // filament_drying_status-Event kam, und ist nach Reopen wieder da.
            this._applyControlsVisibility(status.active);

            if (status.active) {
                // Card anzeigen
                selectionDiv.style.display = 'none';
                activeDiv.style.display = '';   // siehe oben: flex aus dem Stylesheet
                indicator.style.background = 'var(--accent-green)';

                // Banner Details aktualisieren (der Helfer entscheidet danach,
                // ob die Meldung ueberhaupt stehen bleibt).
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

    // Steuerung (Dev-Control-Card) + Print-Status zur Trocknung ein-/ausblenden.
    // Genutzt vom sofortigen Poll (updateStatus) UND vom Live-Socket-Handler
    // (socket-manager) → eine Logik, kein Lag, keine Dopplung.
    _applyControlsVisibility(active) {
        // GANZE Dev-Control-Card (Karte + Buttons) über checkDeveloperMode steuern: das
        // liest window.isFilamentDrying (vorher gesetzt) und blendet via hideDevCards()/
        // showDevCards() die KOMPLETTE Karte aus/ein. Vorher wurde nur .control-grid
        // versteckt → leere Karten-Hülle (Rahmen/Titel) blieb bei Trocknung stehen.
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
 * Die Trocknungs-Meldung steht, solange getrocknet wird.
 *
 * Hier geht es NUR um die manuelle Trocknung ueber das Druckbett — die
 * blockiert Homing, Parken und den Druckstart, das muss im Bild stehen.
 *
 * Bis 27aug26 stand hier ein Sonderweg fuer "das AMS trocknet nebenbei
 * waehrend eines Drucks". Der gehoerte nie hierher: die AMS-Trocknung
 * laeuft ueber die Materialkarte, zeigt ihren Stand dort und sperrt gar
 * nichts. Diese Karte hatte nur deshalb damit zu tun, weil der Server ihre
 * Trocknung ans AMS umleitete — das tut er nicht mehr.
 */
window.applyDryingBanner = function (status) {
    const el = document.getElementById('filament-drying-banner');
    if (!el) return;
    el.classList.toggle('active', !!(status && status.active));
};

window.updateDryingUI = () => window.filamentDryingManager.updateUI();
window.formatDuration = (s) => window.filamentDryingManager._formatDuration(s);
