// =============================================
// Socket Manager - Socket.IO connection & event handling
// Extracted from index.html
// =============================================

class SocketManager {
    constructor() {
        // State - do NOT auto-connect in constructor
        this.lastValidGcodeState = 'IDLE';
        this.lastAndroidUpdateTime = 0;
        this.androidUpdateTimeout = null;
        this.ANDROID_UPDATE_THROTTLE = 2000; // 2 Sekunden
        this.lastVisibilityChange = 0;
    }

    init() {
        this._initSocket();
        this._setupVisibilityHandler();
        this._setupSafariPWAFocusHandler();
        this._setupBeforeUnloadHandler();
    }

    async _initSocket() {
        const texts = window.texts || {};

        try {
            // Safari PWA Detection
            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                          window.navigator.standalone === true;
            const isSafariPWA = window.isSafari && window.isPWA;

            // PWA Session Recovery VOR Socket-Initialisierung
            if (window.isSafariPWA && window.authHandler) {
                console.log(texts.console_safari_pwa_session_recovery);
                const sessionValid = await window.authHandler.restorePWASession();
                if (!sessionValid) {
                    console.log(texts.console_pwa_session_recovery_failed);
                    window.authHandler.redirectToLogin();
                    return;
                }
            }

            // Warm-up Request
            const warmupController = new AbortController();
            const warmupTimeout = setTimeout(() => warmupController.abort(), 2000);

            await apiCall('/api/health', {
                method: 'GET',
                signal: warmupController.signal,
                cache: 'no-cache',
                credentials: 'same-origin'
            });

            clearTimeout(warmupTimeout);
            console.log(texts.console_connection_warmup_success);
        } catch (error) {
            console.log(texts.console_warmup_timeout_not_critical);
        }

        console.log(texts.console_initialize_websocket);
        console.log(`📱 Safari: ${window.isSafari}, PWA: ${window.isPWA}`);

        // WICHTIG: Alte Socket-Verbindung sauber schließen falls vorhanden
        if (window.socket) {
            console.log('🧹 Cleaning up old socket connection');
            try {
                window.socket.removeAllListeners();
                window.socket.disconnect();
                window.socket.close();
            } catch(e) {
                console.log('⚠️ Error cleaning up old socket:', e);
            }
            window.socket = null;
            // Kurz warten damit Verbindung sauber geschlossen wird
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const socket = io({
            // WebSocket bevorzugt (eine persistente Verbindung statt XHR-Dauerpolling),
            // Polling nur als Fallback. Spart in Electron massig Requests.
            transports: ['websocket', 'polling'],
            upgrade: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 10000,
            forceNew: true,  // Immer neue Verbindung
            // Authentifizierung mit Token
            auth: (cb) => {
                const token = localStorage.getItem('access_token');
                cb({ token: token });
            }
        });

        // Safari PWA spezifischer Heartbeat
        if (window.isSafariPWA) {
            let heartbeatInterval;

            const startHeartbeat = () => {
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                heartbeatInterval = setInterval(() => {
                    if (socket.connected) {
                        socket.emit('ping');
                        // Prüfe auch Token-Gültigkeit
                        if (window.authHandler) {
                            window.authHandler.checkAndRefreshToken();
                        }
                    }
                }, 20000); // Alle 20 Sekunden
            };

            const stopHeartbeat = () => {
                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = null;
                }
            };

            socket.on('connect', startHeartbeat);
            socket.on('disconnect', stopHeartbeat);

            // Bei Socket-Fehler: Session Recovery
            socket.on('connect_error', async (error) => {
                console.log(texts.console_socket_connection_error, error.message);
                if (error.message.includes('unauthorized') || error.message.includes('401')) {
                    console.log(texts.console_attempting_session_recovery);
                    const recovered = await window.authHandler.restorePWASession();
                    if (!recovered) {
                        window.authHandler.redirectToLogin();
                    }
                }
            });
        }

        // Window-global
        window.socket = socket;

        // Jetzt alle Handler registrieren
        socket.on('connect', function() {
            console.log(texts.console_websocket_connected);

            // Frischen CSRF-Token holen. Ein neuer Socket heisst in aller
            // Regel: der Server wurde neu gestartet, und unser Token von
            // vorher kann verfallen sein. Die erste
            // schreibende Aktion (Licht, Steckdose) lief bisher ins 403.
            // Sie wurde zwar automatisch wiederholt, kostete aber je einen
            // verworfenen Umlauf plus eine WARNING im Server-Log.
            if (window.authHandler
                && typeof window.authHandler.erneuereCsrfToken === 'function') {
                deferNonCritical(() => window.authHandler.erneuereCsrfToken());
            }

            // Non-Critical: Diese drei Calls sind für Banner/Badges die erst
            // nach dem eigentlichen UI-Render relevant sind. Auf Idle verschoben
            // damit sie nicht mit dem kritischen Initial-Paint konkurrieren.
            deferNonCritical(() => loadHMSStatus());
            deferNonCritical(() => loadPowerOffTimerStatus());
            deferNonCritical(() => updateScheduledPrintsBadge());

            // Browser Notifications prüfen
            if ('Notification' in window) {
                if (Notification.permission === 'default') {
                    console.log(texts.console_browser_notifications_not_allowed);
                } else if (Notification.permission === 'granted') {
                    console.log(texts.console_browser_notifications_enabled);
                }
            }

            // Permission automatisch anfragen wenn noch nicht gesetzt
            // ELECTRON: Keine Browser-Notifications - Electron nutzt FCM Push
            if (!window.electronAPI && 'Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(function(permission) {
                    console.log('📱 Notification Permission:', permission);
                    if (permission === 'granted') {
                        // Test-Notification
                        new Notification(texts.notifications_enabled || 'Benachrichtigungen aktiviert', {
                            body: 'Du erhältst jetzt Updates vom 3D Drucker',
                            icon: '/static/icon-192x192.png'
                        });
                    }
                });
            }
        });

        socket.on('disconnect', function() {
            console.log(texts.console_websocket_disconnected);
            // Fallback-Polling übernimmt das gegatete 8s-Interval in app-init
            // (läuft, sobald Socket/Drucker nicht voll-online sind).
        });

        // Power-Off Timer WebSocket Handler - NUR EINER!
        socket.on('power_off_timer', function(data) {
            console.log(texts.console_poweroff_timer_event, data);

            const banner = document.getElementById('power-off-banner');
            const bannerCountdown = document.getElementById('power-off-banner-countdown');
            const bannerReason = document.getElementById('power-off-banner-reason');

            if (data.active) {
                window.powerOffTimerActive = true;

                // Banner anzeigen
                if (banner) {
                    banner.classList.add('active');
                    if (bannerReason) bannerReason.textContent = data.reason;
                }

                // Countdown updaten
                const updateCountdown = () => {
                    const remaining = Math.max(0, data.end_time - (Date.now() / 1000));
                    const minutes = Math.floor(remaining / 60);
                    const seconds = Math.floor(remaining % 60);
                    const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                    if (bannerCountdown) {
                        bannerCountdown.textContent = timeString;
                    }

                    if (remaining > 0 && window.powerOffTimerActive) {
                        requestAnimationFrame(updateCountdown);
                    } else if (remaining <= 0) {
                        // Timer abgelaufen - Banner ausblenden
                        if (banner) banner.classList.remove('active');
                    }
                };

                updateCountdown();

            } else {
                // Timer deaktiviert - Banner ausblenden
                window.powerOffTimerActive = false;
                if (banner) {
                    banner.classList.remove('active');
                }
            }
        });

        // Filament-Trocknung Status Handler
        socket.on('filament_drying_status', function(data) {
            console.log(texts.console_drying_status, data);

            // Karte und Steuerungs-Sichtbarkeit mitziehen. Die haengen an
            // FilamentDryingManager.updateStatus() — das holte den Stand
            // frueher alle 10 Sekunden selbst, obwohl er hier schon
            // ankommt. Jetzt reichen wir die Daten weiter, statt sie ein
            // zweites Mal zu erfragen.
            if (window.filamentDryingManager
                && typeof window.filamentDryingManager.updateStatus === 'function') {
                window.filamentDryingManager.updateStatus(data);
            }

            const details = document.getElementById('filament-drying-details');

            // Global Status aktualisieren
            window.isFilamentDrying = data.active;

            if (data.active) {
                // Details aktualisieren - unterscheide zwischen Auto-Erkennung und manueller Trocknung
                if (data.end_time_formatted) {
                    // Manuelle Trocknung mit Endzeit
                    const temp = Math.round(data.temperature);
                    details.textContent = texts.filament_drying_banner_with_endtime
                        .replace('{temp}', temp)
                        .replace('{time}', data.end_time_formatted);
                } else if (data.bed_temp !== undefined) {
                    // Auto-Erkennung
                    const temp = Math.round(data.bed_temp);
                    const minutes = Math.round(data.elapsed_minutes);
                    details.textContent = texts.filament_drying_banner_auto
                        .replace('{temp}', temp)
                        .replace('{minutes}', minutes);
                }

                // Ob die Meldung stehen bleibt, entscheidet applyDryingBanner:
                // waehrend eines Drucks trocknet das AMS nebenbei, dann genuegt
                // ein einmaliger Hinweis.
                if (window.applyDryingBanner) window.applyDryingBanner(data);

                // Steuerung + Print-Status zentral ausblenden (geteilter Helfer in
                // filament-drying.js — identisch zum sofortigen Poll, kein Lag/Dopplung).
                if (window.applyDryingControlsVisibility) window.applyDryingControlsVisibility(true);
            } else {
                if (window.applyDryingBanner) window.applyDryingBanner(data);

                // Steuerung + Print-Status zentral wieder anzeigen (geteilter Helfer).
                if (window.applyDryingControlsVisibility) window.applyDryingControlsVisibility(false);
            }

            // Neue Filament-Trocknen Card aktualisieren
            if (typeof updateDryingStatus === 'function') {
                updateDryingStatus();
            }
        });

        // SD-Sync Status Updates
        socket.on('sd_sync_start', function(data) {
            console.log(texts.console_auto_sync_started);
            if (window.sdCardManager) window.sdCardManager.sdSyncInProgress = true;

            // Deaktiviere Refresh-Button
            const refreshBtn = document.getElementById('sd-refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = true;
                refreshBtn.style.opacity = '0.5';
                refreshBtn.style.cursor = 'not-allowed';
                refreshBtn.innerHTML = window.skIcon('sanduhr') + '<span>' + (texts.sync_running || 'Sync läuft…') + '</span>';
            }
        });
        socket.on('sd_sync_complete', function(data) {
            console.log(texts.console_auto_sync_completed);
            if (window.sdCardManager) window.sdCardManager.sdSyncInProgress = false;

            // Aktiviere Refresh-Button wieder
            const refreshBtn = document.getElementById('sd-refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.style.opacity = '1';
                refreshBtn.style.cursor = 'pointer';
                refreshBtn.innerHTML = window.skIcon('aktualisieren') + '<span>' + texts.refresh + '</span>';
            }

            // Update Banner wenn Modal offen
            if (document.getElementById('sdCardModal').style.display === 'block') {
                const banner = document.getElementById('sync-banner');
                if (banner) {
                    banner.style.background = 'var(--accent-green)';
                    const count = data.changes ? data.changes.downloaded.length : 0;
                    banner.innerHTML = `
                        <span>${texts.sync_completed.replace('{count}', count)}</span>
                    `;

                    // Nach 3 Sekunden ausblenden
                    setTimeout(() => {
                        banner.style.transition = 'opacity 0.5s';
                        banner.style.opacity = '0';
                        setTimeout(() => banner.remove(), 500);
                    }, 3000);
                }

                // Wenn neue Dateien da sind, Liste aktualisieren
                if (data.changes && data.changes.downloaded.length > 0) {
                    skToast(texts.toast_new_files_available.replace('{count}', data.changes.downloaded.length), 'info');
                    // Optional: Automatisch neu laden
                    // showSDFiles();
                }
            }
        });

        socket.on('sd_sync_progress', function(data) {
            // NEU: Bei manuellem Sync auch Loading-Bereich updaten
            if (data.manual_sync) {
                const loadingDiv = document.getElementById('sd-loading');
                if (loadingDiv && loadingDiv.style.display !== 'none') {
                    loadingDiv.innerHTML = `
                        <div style="margin-bottom: 15px;">
                            <div style="background: var(--bg-primary); border-radius: 8px; padding: 3px; margin-bottom: 8px;">
                                <div style="background: var(--accent-blue); height: 20px; border-radius: 6px;
                                            width: ${data.percent || 0}%; transition: width 0.3s ease;
                                            display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">
                                    ${Math.round(data.percent || 0)}%
                                </div>
                            </div>
                            <p style="color: var(--text-secondary); text-align: center; margin: 0; font-size: 13px;">
                                ${data.message || 'Lade Dateien...'}
                            </p>
                        </div>
                    `;
                }
            }
            const progressDiv = document.getElementById('sync-progress');
            const statusText = document.getElementById('sync-status');
            const progressBar = document.getElementById('sync-progress-bar');
            const detailsText = document.getElementById('sync-details');

            if (progressDiv) {
                progressDiv.style.display = 'block';

                if (data.status === 'scanning') {
                    statusText.textContent = data.message;
                    progressBar.style.width = '10%';
                } else if (data.status === 'downloading') {
                    statusText.textContent = data.message;
                    progressBar.style.width = data.percent + '%';

                    // Details anzeigen
                    if (data.message.includes('/')) {
                        detailsText.textContent = data.message;
                    }
                } else if (data.status === 'cleaning') {
                    statusText.textContent = data.message;
                    progressBar.style.width = '95%';
                } else if (data.status === 'complete') {
                    statusText.textContent = data.message;
                    progressBar.style.width = '100%';
                    progressBar.style.background = 'var(--accent-green)';

                    // Nach 2 Sekunden Dateien anzeigen
                    setTimeout(() => {
                        showSDFiles();
                    }, 2000);
                } else if (data.status === 'error') {
                    statusText.textContent = data.message;
                    progressBar.style.background = 'var(--accent-red)';
                }
            }
        });

        // FTPS Status Updates (Upload/Download/Sync)
        socket.on('ftps_status', function(data) {
            // Globalen Status speichern
            window.ftpsStatus = data;

            // Aktualisieren-Button Status - nur deaktivieren, keine Prozentanzeige im Button
            const refreshBtn = document.getElementById('sd-refresh-btn');
            if (refreshBtn) {
                if (data.active) {
                    refreshBtn.disabled = true;
                    refreshBtn.style.opacity = '0.5';
                    refreshBtn.style.cursor = 'not-allowed';
                    // Nur generischen Hinweis zeigen, Prozent gehört in den Fortschrittsbalken
                    const operation = data.operation || '';
                    let btnText = 'FTPS aktiv...';
                    if (operation === 'upload') btnText = texts.uploading || 'Upload läuft...';
                    else if (operation === 'download') btnText = 'Download läuft...';
                    else if (operation === 'sync') btnText = 'Sync läuft...';
                    refreshBtn.innerHTML = window.skIcon('sanduhr') + `<span>${btnText}</span>`;
                } else {
                    refreshBtn.disabled = false;
                    refreshBtn.style.opacity = '1';
                    refreshBtn.style.cursor = 'pointer';
                    refreshBtn.innerHTML = window.skIcon('aktualisieren') + '<span>' + (texts.refresh || 'Aktualisieren') + '</span>';
                }
            }

            // Optional: Toast bei Start/Ende von FTPS-Operationen
            if (data.operation !== 'idle' && data.progress === 0) {
                // Operation gestartet
                console.log(`📡 FTPS ${data.operation}: ${data.message}`);
            }
        });

        // Bidirektionaler Sync abgeschlossen
        socket.on('bidirectional_sync_complete', function(data) {
            const t = window.texts || {};
            skToast((t.toast_sync_done || 'Sync fertig — {down} geladen, {up} gesendet')
                .replace('{down}', data.downloaded).replace('{up}', data.uploaded), 'success');
            // SD-Dateien neu laden
            if (document.getElementById('sd-modal')?.style.display === 'block') {
                showSDFiles();
            }
        });

        // Bidirektionaler Sync Fehler
        socket.on('bidirectional_sync_error', function(data) {
            const t = window.texts || {};
            skToast((t.toast_sync_error || 'Sync-Fehler: {error}').replace('{error}', data.error), 'error');
        });

        // Geplante Drucke geaendert (created/updated/deleted/started/failed) ->
        // Badge sofort neu laden statt auf 30s-Polling zu warten.
        // Backend liefert {count, reason} - wir nutzen count direkt wenn die
        // Manager-Instanz da ist, sonst loesen wir das volle Refresh aus.
        socket.on('scheduled_prints_changed', function(data) {
            try {
                const count = data && typeof data.count === 'number' ? data.count : null;
                const badgeMobile = document.getElementById('scheduled-badge-mobile');
                const badgeDesktop = document.getElementById('scheduled-badge-desktop');
                const badgeZone = document.getElementById('mz-sched-badge');

                if (count !== null) {
                    // Direkt aus Event setzen - keine extra REST-Runde
                    if (count > 0) {
                        if (badgeMobile) { badgeMobile.textContent = count; badgeMobile.style.display = 'flex'; }
                        if (badgeDesktop) { badgeDesktop.textContent = count; badgeDesktop.style.display = 'flex'; }
                        if (badgeZone) { badgeZone.textContent = count; badgeZone.style.display = 'flex'; }
                    } else {
                        if (badgeMobile) badgeMobile.style.display = 'none';
                        if (badgeDesktop) badgeDesktop.style.display = 'none';
                        if (badgeZone) badgeZone.style.display = 'none';
                    }
                }
                // Wenn die Verwaltungs-Liste offen ist, Inhalt mit-refreshen
                if (window.printScheduler && typeof window.printScheduler.loadScheduledPrints === 'function') {
                    const mgr = document.getElementById('scheduleManagerModal');
                    if (mgr && mgr.style.display === 'block') {
                        window.printScheduler.loadScheduledPrints();
                    }
                }
            } catch (e) {
                console.warn('scheduled_prints_changed handler failed', e);
            }
        });

        // Print Progress Updates
        socket.on('print_progress', (data) => {
            // Zwei Bloecke versorgen die Oberflaeche, und sie sind fast
            // disjunkt: handlePrintUpdate deckt Druckkarte, Fortschritt und
            // Chips ab (42 DOM-Elemente), applyStatus die Knoepfe, den
            // Geraete-Tab, Filament- und Hardware-Angaben (30). Gemeinsam
            // haben sie nur das HMS-Banner.
            //
            // applyStatus haing frueher allein am 8-Sekunden-Poll. Als der
            // wegfiel, hoerten 26 Elemente auf, sich nachzufuehren — am
            // sichtbarsten der Licht-Knopf: der Server hatte den neuen Stand
            // binnen 1,3 s, aber niemand trug ihn ein. Der Push traegt
            // dieselben 95 Schluessel wie /api/status, also speist er jetzt
            // beide Wege.
            this.handlePrintUpdate(data, 'print_progress');
            if (window.statusManager && typeof window.statusManager.applyStatus === 'function') {
                try { window.statusManager.applyStatus(data); }
                catch (e) { console.error('applyStatus failed:', e); }
            }
        });

        // 'status_update' hatte hier einen Zuhoerer, den kein Server-Codepfad
        // je bedient hat — wie 'full_status_update'. Entfernt.

        // Handler für vollständige Status-Anfragen
        // 'full_status_update' gab es hier als Zuhoerer, aber kein
        // Server-Codepfad hat es je gesendet — ein halb gebauter Umbau,
        // der genau das wollte, was 'print_progress' seit 20aug26 tut:
        // den vollen Stand schicken. Entfernt statt angeschlossen.

        // Spoolman active spool update (from backend after print start)
        socket.on('spoolman_active_spool', function(data) {
            console.log('🧵 Spoolman active spool update:', data);
            if (data.spool_id) {
                window.activeSpoolId = data.spool_id;
                updateSpoolmanDisplay();
            }
        });

        socket.on('mqtt_status', function(data) {
            // Stoppe Timer wenn Status über WebSocket kommt
            if (window.statusManager && window.statusManager.mqttCountdownInterval) {
                clearInterval(window.statusManager.mqttCountdownInterval);
                window.statusManager.mqttCountdownInterval = null;
            }

            // Speichere MQTT Status
            window.lastMqttStatus = data.connected;

            // Klipper-Direct: Kamera an die Drucker-Verbindung koppeln. Drucker aus
            // → Snapshot-Polling stoppen (sonst 404-Dauerfeuer gegen die tote Cam),
            // Drucker an → Kamera neu initialisieren.
            if (window.cameraManager && typeof window.cameraManager.onPrinterConnectionChange === 'function') {
                window.cameraManager.onPrinterConnectionChange(data.connected);
            }

            // Cards aktualisieren die vom Drucker-Status abhängen
            if (typeof updatePrinterDependentCards === 'function') {
                updatePrinterDependentCards();
            }

            if (data.connected) {
                updateBothButtons('mqtt-btn', 'control-btn active', window.skIcon('funk') + '<span>' + (texts.mqtt_button_connected || 'MQTT') + '</span>');
                console.log(texts.console_mqtt_auto_connect_success);
            } else {
                updateBothButtons('mqtt-btn', 'control-btn', window.skIcon('funk') + '<span>MQTT</span>');
                // Timer stoppen falls noch laufend
                if (window.statusManager && window.statusManager.mqttCountdownInterval) {
                    clearInterval(window.statusManager.mqttCountdownInterval);
                    window.statusManager.mqttCountdownInterval = null;
                }
            }

            // Update Filament Card Sichtbarkeit
            if (typeof updateFilamentCardVisibility === 'function') {
                updateFilamentCardVisibility();
            }
        });

        // Display Status Update
        socket.on('display_status', function(data) {
            const displayElement = document.getElementById('display-text');
            if (displayElement) {
                displayElement.textContent = data.text;

                // Farbe je nach Status
                if (data.state === 'IDLE') {
                    displayElement.style.color = '#00ff00';  // Grün
                } else if (data.state === 'RUNNING') {
                    displayElement.style.color = '#00aaff';  // Blau
                } else if (data.state === 'PAUSE') {
                    displayElement.style.color = '#ffaa00';  // Orange
                } else if (data.state === 'FAILED') {
                    displayElement.style.color = '#ff0000';  // Rot
                }
            }
        });

        // === ZENTRALER NOTIFICATION HANDLER ===
        socket.on('notification', function(data) {
            console.log(texts.console_unified_notification, data);

            // Wenn bereits auf einem anderen Gerät gelesen/weggeklickt:
            // nicht nochmal anzeigen (Cross-Device-Read-Sync, Stage 2).
            if (data.id && window.__dismissedNotificationIds
                && window.__dismissedNotificationIds.has(data.id)) {
                console.log('⏭️ Notification already dismissed on another device:', data.id);
                return;
            }

            // ELECTRON-APP: Keine WebSocket-Notifications anzeigen!
            // Electron bekommt Notifications via FCM Push (@eneris/push-receiver)
            // Die Desktop-Notification wird dort in main.js angezeigt.
            if (window.electronAPI) {
                console.log('🖥️ [Electron] WebSocket notification ignored - using FCM instead');
                return;
            }

            if ('Notification' in window && Notification.permission === 'granted') {
                // Desktop Browser (nur Web, nicht Electron!)
                const options = {
                    body: data.message,
                    icon: '/static/icon-192x192.png',
                    tag: data.type || 'general'
                };

                // Spezielle Optionen je nach Typ
                if (data.type === 'print_finish' || data.type === 'success') {
                    options.requireInteraction = true;
                    options.vibrate = [200, 100, 200];
                } else if (data.type === 'error' || data.type === 'print_failed') {
                    options.requireInteraction = true;
                    options.vibrate = [500, 200, 500, 200, 500];
                } else if (data.type === 'milestone') {
                    options.vibrate = [100, 50, 100];
                }

                const notif = new Notification(data.title, options);

                // Markiere als gelesen wenn User auf die Browser-Notification klickt
                if (data.id) {
                    const callApi = window.apiCall || ((url, opts) => fetch(url, {...opts, credentials: 'include'}));
                    notif.onclick = function() {
                        callApi(`/api/notifications/${encodeURIComponent(data.id)}/dismiss`, {
                            method: 'POST'
                        }).catch(() => {});
                        notif.close();
                    };
                    notif.onclose = function() {
                        callApi(`/api/notifications/${encodeURIComponent(data.id)}/read`, {
                            method: 'POST'
                        }).catch(() => {});
                    };
                }
            }
        });

        // Cross-Device Dismiss: ein anderes Gerät hat die Notification
        // weggeklickt → lokal auch entfernen (falls noch sichtbar) und
        // für zukünftige Echo-Pushes merken.
        if (!window.__dismissedNotificationIds) {
            window.__dismissedNotificationIds = new Set();
        }
        function _onDismissFromPeer(data) {
            if (!data || !data.id) return;
            window.__dismissedNotificationIds.add(data.id);
            // Electron: offene Custom-Notification-Windows mit gleicher ID
            // auf diesem Desktop schließen, wenn ein anderer Client
            // dismissed/read hat. Ohne das bleibt das Banner hängen bis
            // der User hier auch nochmal klickt.
            try {
                if (window.electronAPI && window.electronAPI.closeNotificationsById) {
                    window.electronAPI.closeNotificationsById(data.id);
                }
            } catch (_) {}
            // Meldung im Stapel oben rechts wegnehmen, wenn sie von diesem
            // Ereignis stammt. Seit 27aug26 landen Push-Meldungen dort statt
            // im externen Popup — ohne diese Zeile blieben sie stehen,
            // nachdem sie auf dem Handy weggewischt wurden.
            try {
                if (window.MeldungsStapel && window.MeldungsStapel.entferne) {
                    window.MeldungsStapel.entferne(data.id);
                }
            } catch (_) {}
        }
        socket.on('notification_dismissed', _onDismissFromPeer);
        socket.on('notification_read', _onDismissFromPeer);

        // HMS Update Handler
        socket.on('hms_update', function(data) {
            console.log('📡 HMS Update received:', data);
            serverDismissedHMSErrors = data.dismissed_errors || [];

            // Banner-Anzeige aktualisieren
            const banner = document.getElementById('hms-error-banner');
            if (!banner) return;

            const currentErrorCode = banner.dataset.errorCode;
            const activeErrors = data.active_errors || [];

            // Banner ausblenden wenn:
            // 1. Keine aktiven Fehler mehr ODER
            // 2. Der aktuell angezeigte Fehler dismissed wurde
            if (activeErrors.length === 0) {
                banner.classList.remove('active');
                console.log('🧹 HMS Banner hidden - no active errors');
            } else if (currentErrorCode && serverDismissedHMSErrors.includes(currentErrorCode)) {
                banner.classList.remove('active');
                console.log(`🔕 HMS Banner hidden - error ${currentErrorCode} was dismissed`);
            }
        });

        setTimeout(() => {
            if (!socket.connected && !window.socketReconnecting) {
                window.socketReconnecting = true;  // Flag setzen
                console.error(texts.console_socket_not_connected);
                // Manueller Connect-Versuch
                socket.connect();
                setTimeout(() => { window.socketReconnecting = false; }, 1000);
            }
        }, 3000);
    }

    formatTime(minutes) {
        if (!minutes || minutes < 0) return '--:--';

        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        if (hours > 0) {
            return `${hours}h ${mins}m`;
        } else {
            return `${mins}m`;
        }
    }

    translateStatusKey(key) {
        const texts = window.texts || {};
        if (!key) return key;
        // If key starts with "status.", convert to frontend format (status.printing -> status_printing)
        if (typeof key === 'string' && key.startsWith('status.')) {
            const frontendKey = key.replace(/\./g, '_');
            return texts[frontendKey] || key;
        }
        return key;
    }

    // stage.* → texts.stage_* (STATUS_CONTRACT §4/§7). Leerer/kein Key → ''.
    translateStageKey(key) {
        if (!key || typeof key !== 'string' || !key.startsWith('stage.')) return '';
        const texts = window.texts || {};
        return texts[key.replace(/\./g, '_')] || key;
    }

    // Anzuzeigender Stage-Text aus stage_code + stage_custom (Decision A):
    // bekannter Code → übersetzt; manual_setup → "Code · Anweisung"; sonst roh.
    stageLabel(data) {
        const custom = (data.stage_custom || '').trim();
        if (data.stage_code) {
            const t = this.translateStageKey(data.stage_code);
            return custom ? (t + ' · ' + custom) : t;
        }
        return custom;
    }

    /**
     * Drucker-Grafik in der Karte: Plaketten fuellen, Glut schalten.
     *
     * Kammer/Bett/aktive Duese kommen live aus dem Socket. Die beiden
     * Einzel-Duesen liefert /api/status (printerControlManager.lastState)
     * — der Poll laeuft ohnehin, fuer Temperaturen reicht der Takt.
     */
    /** Druck-Aktionen (Bambu): ⏸/▶/■ je nach Zustand — auf der
     *  Druckkarte (pcb-*) und in der Steuerungs-Uebersicht (ov-*). */
    updatePcbActions(data) {
        const st = data.gcode_state;
        const laufend = st === 'RUNNING' || st === 'PREPARE';
        const pausiert = st === 'PAUSE';
        const zeig = (id, an) => {
            const e = document.getElementById(id);
            if (e) e.style.display = an ? '' : 'none';
        };
        // Druckkarte: kleine runde Knoepfe mit Wrapper.
        zeig('pcb-actions', laufend || pausiert);
        zeig('pcb-pause', laufend);
        zeig('pcb-resume', pausiert);
        // Steuerungs-Uebersicht: Aktions-Karten direkt im Grid.
        zeig('ov-pause', laufend);
        zeig('ov-resume', pausiert);
        zeig('ov-stop', laufend || pausiert);
    }

    updatePrinterVisual(data) {
        const wrap = document.getElementById('printer-visual');
        if (!wrap || wrap.offsetParent === null) return;

        const grad = (v) => (v != null ? Math.round(v) + '°' : '--');
        const mitZiel = (ist, soll) =>
            grad(ist) + ((soll != null && soll > 0) ? ' / ' + grad(soll) : '');

        const chamber = document.getElementById('pv-chamber');
        if (chamber) {
            const txt = mitZiel(data.chamber_temp, data.chamber_target);
            chamber.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = txt; });
            chamber.style.display = (data.chamber_temp != null) ? '' : 'none';
        }

        const bed = document.getElementById('pv-bed');
        if (bed) {
            // Icon-Bild steht im Markup; nur den Text hinter dem Bild tauschen.
            const txt = mitZiel(data.bed_temp, data.bed_target);
            bed.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = txt; });
            // Ohne Messwert ganz weg — wie die Kammer eine Zeile darueber.
            // Sonst klebt am ausgeschalteten Drucker ein Bett-Symbol mit "--".
            bed.style.display = (data.bed_temp != null) ? '' : 'none';
        }

        // Einzel-Duesen aus dem /api/status-Zustand (Schluessel: 1=links, 0=rechts)
        const st = (window.printerControlManager && window.printerControlManager.lastState) || {};
        const temps = st.nozzle_temps || {};
        const ziele = st.nozzle_targets || {};
        const lesen = (k) => temps[k] != null ? temps[k] : temps[String(k)];
        const ziel = (k) => ziele[k] != null ? ziele[k] : ziele[String(k)];
        const dual = [lesen(0), lesen(1)].filter(v => v != null).length > 1;

        const kopf = document.getElementById('pv-toolhead');
        const trenner = document.querySelector('#printer-visual .pv-divider');
        if (kopf) kopf.style.display = dual ? '' : 'none';
        if (trenner) trenner.style.display = dual ? '' : 'none';

        const setzeSeite = (id, key, tipId) => {
            const el = document.getElementById(id);
            if (el) {
                // Auch OHNE Werte schreiben, sonst bleibt der alte Text stehen:
                // beim ausgeschalteten Drucker klebten hier "L 37° R 37°",
                // waehrend Bett und Kammer laengst auf "--" standen (20aug26).
                el.textContent = (key === 1 ? 'L ' : 'R ') + mitZiel(lesen(key), ziel(key));
                el.classList.toggle('pv-active', dual && data.active_nozzle === key);
            }
            if (tipId) {
                const tip = document.getElementById(tipId);
                if (tip) tip.classList.toggle('pv-hot', (lesen(key) || 0) > 50);
            }
        };
        setzeSeite('pv-nozzle-l', 1, null);
        setzeSeite('pv-nozzle-r', 0, null);

        // Zweite Duese nur zeigen, wenn der Drucker wirklich zwei meldet.
        const zweite = document.getElementById('pv-nozzle-r-col');
        if (zweite) zweite.style.display = dual ? '' : 'none';

        this._zeigeMaschinenbild(data);
        this._zeigeAmsAnbau(data);
        // Hotend-Magazin (H2C). Die Karte blendet sich selbst aus, wenn der
        // Drucker keine Magazinplaetze meldet.
        if (window.hotendRackCard) window.hotendRackCard.aktualisieren(data);

        // Klick auf die Vorschau oeffnet den Historien-Eintrag dieses Drucks.
        const vorschau = document.getElementById('titelbild-container');
        if (vorschau) {
            // Nach dem Druck bleibt die Vorschau stehen — dann soll der Klick
            // weiter in den zuletzt beendeten Eintrag fuehren.
            const id = data.history_print_id || data.current_print_id;
            if (id) {
                vorschau.style.cursor = 'pointer';
                vorschau.title = (window.texts && window.texts.history_open)
                    || 'Eintrag in der Historie oeffnen';
                vorschau.onclick = () => {
                    window.location.href = '/static/history.html?print=' + id;
                };
            } else {
                vorschau.style.cursor = '';
                vorschau.title = '';
                vorschau.onclick = null;
            }
        }

    }

    handlePrintUpdate(data, source) {
        const texts = window.texts || {};

        // Status speichern für nächsten Vergleich
        const previousState = window.lastPrintState;
        window.lastPrintState = data.gcode_state;
        window.lastPrintData = data;


        // Der Rumpf lag bis 20aug26 als 535 Zeilen am Stueck hier. Genau
        // diese Unuebersichtlichkeit liess uebersehen, dass Knopf- und
        // Geraete-Anzeige an einer ganz anderen Quelle hingen — der Fehler,
        // der beim Abschalten des Polls sichtbar wurde.
        //
        // previousState wird durchgereicht: die einzige Groesse, die
        // mehrere Abschnitte gemeinsam brauchen.
        this._zeigeAbschaltTimer(data, previousState);
        this._zeigeHomingKnopf(data, previousState);
        if (window.skTeileKnopfZeigen) window.skTeileKnopfZeigen(data);
        this._zeigeFortschritt(data, previousState);
        this._zeigeSchichten(data, previousState);
        this._zeigeZeiten(data, previousState);
        this._zeigeTemperaturen(data, previousState);
        this._zeigeDruckerAnsicht(data, previousState);
        this._zeigeBedMesh(data, previousState);
        this._zeigeStatusUndAktion(data, previousState);
        this._zeigeKartenKnoepfe(data, previousState);
    }

    /** Abschalt-Timer: Kopfzeile, Einstellungs-Fenster, Countdown */
    _zeigeAbschaltTimer(data, previousState) {
        const texts = window.texts || {};
        // Power-Off Timer verarbeiten (falls im print_progress enthalten)
        if (data.power_off_timer) {
            const statusDiv = document.getElementById('power-off-status');
            const headerTimer = document.getElementById('power-off-header');

            if (data.power_off_timer.active) {
                // Settings Modal Status
                if (statusDiv) {
                    statusDiv.style.display = 'block';
                    const reasonEl = document.getElementById('power-off-reason');
                    if (reasonEl) reasonEl.textContent = data.power_off_timer.reason;
                }

                // Header Timer anzeigen
                if (headerTimer) {
                    headerTimer.style.display = 'inline-block';
                }

                // Countdown updaten
                const updateCountdown = () => {
                    const remaining = Math.max(0, data.power_off_timer.end_time - (Date.now() / 1000));
                    const minutes = Math.floor(remaining / 60);
                    const seconds = Math.floor(remaining % 60);
                    const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                    // Update Settings Modal
                    const modalCountdown = document.getElementById('power-off-countdown');
                    if (modalCountdown) {
                        modalCountdown.textContent = timeString;
                    }

                    // Update Header Timer
                    const headerCountdown = document.getElementById('header-countdown');
                    if (headerCountdown) {
                        headerCountdown.textContent = timeString;

                        // Farbe ändern wenn wenig Zeit
                        if (minutes < 1) {
                            headerTimer.style.color = '#ff4444';  // Rot
                        } else if (minutes < 5) {
                            headerTimer.style.color = '#ff9800';  // Orange
                        } else {
                            headerTimer.style.color = '#ffc107';  // Gelb
                        }
                    }

                    if (remaining > 0) {
                        requestAnimationFrame(updateCountdown);
                    }
                };

                updateCountdown();

            } else {
                // Timer deaktiviert - UI aufräumen
                if (statusDiv) {
                    statusDiv.style.display = 'none';
                }
                if (headerTimer) {
                    headerTimer.style.display = 'none';
                }
            }
        }
    }

    /** Homing-Knopf zuruecksetzen, wenn das Homing durch ist */
    _zeigeHomingKnopf(data, previousState) {
        const texts = window.texts || {};
        // Homing-Button zurücksetzen wenn Homing abgeschlossen (home_flag > 0)
        if (data.home_flag && data.home_flag > 0) {
            const homingBtnMobile = document.getElementById('homing-btn-mobile');
            const homingBtnDesktop = document.getElementById('homing-btn-desktop');

            // Nur zurücksetzen wenn Button aktuell auf "Läuft..." steht
            if (homingBtnMobile && homingBtnMobile.disabled) {
                homingBtnMobile.disabled = false;
                homingBtnMobile.innerHTML = window.skIcon('haus') + '<span>' + (texts.homing || 'Homing') + '</span>';
            }
            if (homingBtnDesktop && homingBtnDesktop.disabled) {
                homingBtnDesktop.disabled = false;
                homingBtnDesktop.innerHTML = window.skIcon('haus') + '<span>' + (texts.homing || 'Homing') + '</span>';
            }
        }
    }

    /** Fortschrittsbalken und Prozentzahl */
    _zeigeFortschritt(data, previousState) {
        const texts = window.texts || {};
        // ========== Progress Bar + Percentage (HelixScreen-Layout) ==========
        const progressPercentage = document.getElementById('progress-percentage');
        if (progressPercentage) progressPercentage.textContent = Math.round(data.progress) + '%';

        const barFill = document.getElementById('progress-card-bar-fill');
        if (barFill) barFill.style.width = (data.progress || 0) + '%';
    }

    /** Schichten, verbrauchtes Filament, Objekte */
    _zeigeSchichten(data, previousState) {
        const texts = window.texts || {};
        // ========== Layer / Filament-Used / Objects ==========
        const layerValue = document.getElementById('layer-value');
        if (layerValue) {
            const layerTxt = `Layer ${data.layer_num || '--'}/${data.total_layers || '--'}`;
            // Z-Hoehe inline anhaengen wenn Klipper
            const z = data.z_position;
            layerValue.textContent = (z != null)
                ? `${layerTxt} (${z.toFixed(1)}mm)`
                : layerTxt;
        }

        const objectsInfo = document.getElementById('objects-info');
        const objectsValue = document.getElementById('objects-value');
        if (objectsInfo && objectsValue) {
            if (data.objects_total && data.objects_total > 1) {
                objectsValue.textContent = `${data.objects_current || 0}/${data.objects_total}`;
                objectsInfo.style.display = '';
            } else {
                objectsInfo.style.display = 'none';
            }
        }
    }

    /** Zeit-Reihe: vergangen, verbleibend, Ende, Prozent */
    _zeigeZeiten(data, previousState) {
        const texts = window.texts || {};
        // ========== Time-Reihe: elapsed · remaining · ETA · % ==========
        const elapsedValue = document.getElementById('elapsed-value');
        if (elapsedValue) {
            const sec = data.elapsed_seconds;
            if (sec && sec > 0) {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                elapsedValue.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
            } else {
                elapsedValue.textContent = '0m';
            }
        }

        const timeValue = document.getElementById('time-value');
        if (timeValue) {
            if (data.remaining_time > 0) {
                const hours = Math.floor(data.remaining_time / 60);
                const minutes = data.remaining_time % 60;
                timeValue.textContent = `${hours}h ${String(minutes).padStart(2, '0')}m`;
            } else {
                timeValue.textContent = '--m';
            }
        }
        const etaInline = document.getElementById('eta-value-inline');
        if (etaInline) {
            // ETA = jetzt + Restzeit, client-seitig berechnet (wie Android/KlipperStatusMapper).
            // eta_time vom Server ist im Direct-Modus leer → aus remaining_time (Minuten) lokal
            // ableiten, dann stimmt's mit der Geräte-Uhr und tickt ohne Server-Roundtrip.
            let _eta = data.eta_time;
            if (!_eta && data.remaining_time > 0) {
                _eta = new Date(Date.now() + data.remaining_time * 60000)
                    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            etaInline.textContent = _eta ? ` ~${_eta}` : '';
        }
    }

    /** Temperatur-Karte: Duese, Bett, Kammer */
    _zeigeTemperaturen(data, previousState) {
        const texts = window.texts || {};
        // ========== Temperature-Card (Düse / Bett / Chamber) ==========
        const nA = document.getElementById('temp-nozzle-actual');
        const nT = document.getElementById('temp-nozzle-target');
        if (nA) nA.textContent = (data.nozzle_temp != null) ? data.nozzle_temp.toFixed(1) : '--';
        if (nT) nT.textContent = (data.nozzle_target != null) ? Math.round(data.nozzle_target) : '--';

        // Aktive Duese (X2D/H2D): 1 = links, 0 = rechts. Feld fehlt bei
        // Einzelduesen-Geraeten — dann bleibt das Badge unsichtbar.
        const seite = document.getElementById('temp-nozzle-side');
        if (seite) {
            if (data.active_nozzle != null) {
                seite.style.display = '';
                seite.textContent = ' (' + (data.active_nozzle === 1
                    ? (texts.temp_nozzle_left || 'Links')
                    : (texts.temp_nozzle_right || 'Rechts')) + ')';
            } else {
                seite.style.display = 'none';
            }
        }

        const bA = document.getElementById('temp-bed-actual');
        const bT = document.getElementById('temp-bed-target');
        if (bA) bA.textContent = (data.bed_temp != null) ? data.bed_temp.toFixed(1) : '--';
        if (bT) bT.textContent = (data.bed_target != null) ? Math.round(data.bed_target) : '--';

        const cRow = document.getElementById('temp-chamber-row');
        if (cRow && data.chamber_temp != null) {
            cRow.style.display = '';
            const cA = document.getElementById('temp-chamber-actual');
            if (cA) cA.textContent = data.chamber_temp.toFixed(1);
            const unitEl = document.getElementById('temp-chamber-unit');
            const tWrap = document.getElementById('temp-chamber-target-wrap');
            const humEl = document.getElementById('temp-chamber-humidity');
            if (data.chamber_humidity != null) {
                // Sensor-Kammer (z.B. AHT20): Temp + Luftfeuchte statt Ziel (wie Android).
                if (unitEl) unitEl.style.display = '';
                if (tWrap) tWrap.style.display = 'none';
                if (humEl) { humEl.style.display = ''; humEl.innerHTML = ' ' + window.skIcon('tropfen', 'hd-ic--xs') + ' ' + Math.round(data.chamber_humidity) + '%'; }
            } else if (data.chamber_target > 0) {
                if (unitEl) unitEl.style.display = 'none';
                if (tWrap) tWrap.style.display = '';
                if (humEl) humEl.style.display = 'none';
                const cT = document.getElementById('temp-chamber-target');
                if (cT) cT.textContent = Math.round(data.chamber_target);
            } else {
                // Kammer ohne Ziel (keine oder ausgeschaltete Heizung): nur der
                // Istwert. "/ 0°C" liest sich sonst wie ein Defekt.
                if (unitEl) unitEl.style.display = '';
                if (tWrap) tWrap.style.display = 'none';
                if (humEl) humEl.style.display = 'none';
            }
        } else if (cRow) {
            cRow.style.display = 'none';
        }
    }

    /** Drucker-Ansicht im Display-Stil */
    _zeigeDruckerAnsicht(data, previousState) {
        const texts = window.texts || {};
        // ========== Drucker-Ansicht (X2D-Display-Stil) ==========
        this.updatePrinterVisual(data);

        // Status-Pills (Bereit / Heizt / Kühlt / Aus)
        const setPill = (id, status) => {
            const el = document.getElementById(id);
            if (!el) return;
            const labels = {
                ready:   (texts.heater_ready   || 'Bereit'),
                heating: (texts.heater_heating || 'Heizt'),
                cooling: (texts.heater_cooling || 'Kühlt'),
                off:     (texts.heater_off     || 'Aus'),
            };
            const cls = ['is-ready','is-heating','is-cooling','is-off'];
            cls.forEach(c => el.classList.remove(c));
            if (status && labels[status]) {
                el.textContent = labels[status];
                el.classList.add('is-' + status);
                el.style.display = '';
            } else {
                el.style.display = 'none';
            }
        };
        setPill('nozzle-status-pill',  data.nozzle_status);
        setPill('bed-status-pill',     data.bed_status);
        setPill('chamber-status-pill', data.chamber_status);

        // Per-Fan-Reihe
        const setFan = (cellId, valueId, pct) => {
            const cell = document.getElementById(cellId);
            const val = document.getElementById(valueId);
            if (!cell || !val) return;
            if (pct != null) {
                val.textContent = Math.round(pct) + '%';
                cell.style.display = '';
            } else {
                cell.style.display = 'none';
            }
        };
        setFan('fan-part-info',   'fan-part-value',   data.part_fan_percent);
        setFan('fan-hotend-info', 'fan-hotend-value', data.hotend_fan_percent);
        setFan('fan-aux-info',    'fan-aux-value',    data.aux_fan_percent);
        // Separator nur sichtbar wenn beide Nachbarn da sind
        const sep1 = document.getElementById('fan-sep-1');
        if (sep1) sep1.style.display = (data.hotend_fan_percent != null) ? '' : 'none';
        const sep2 = document.getElementById('fan-sep-2');
        if (sep2) sep2.style.display = (data.aux_fan_percent != null && data.hotend_fan_percent != null) ? '' : 'none';
        setFan('fan-chamber-info', 'fan-chamber-value', data.chamber_fan_percent);
        const sep3 = document.getElementById('fan-sep-3');
        if (sep3) sep3.style.display = (data.chamber_fan_percent != null && data.aux_fan_percent != null) ? '' : 'none';

        const speedValue = document.getElementById('speed-value');
        if (speedValue) {
            const speedPercent = data.speed_percent != null ? Number(data.speed_percent) : 100;
            const speedName = Number.isFinite(speedPercent)
                ? (speedPercent <= 75 ? 'Leise'
                    : speedPercent <= 112 ? 'Standard'
                    : speedPercent <= 145 ? 'Sport' : 'Verrückt')
                : (data.speed_level_text || 'Standard');
            speedValue.textContent = `${speedName} (${speedPercent}%)`;
        }
    }

    /** Angebautes AMS neben dem Drucker einblenden */
    /** Das Geraetebild der Druckkarte zum eingestellten Modell.
     *
     *  Bis 26aug26 stand im Template fest `x2d.png` — richtig nur fuer genau
     *  ein Geraet. Die Kennung kommt aus den Faehigkeiten (`model_id`), die
     *  der Server aus dem Profil bildet; die Dateien heissen wie die Kennung
     *  in Kleinschreibung.
     */
    _zeigeMaschinenbild(data) {
        const bild = document.getElementById('pv-machine-img');
        if (!bild) return;
        // Direkt aus dem Status-Paket: window.lastPrintData wird erst weiter
        // unten gesetzt und traegt hier noch das vorige.
        const caps = (data && data.capabilities) || {};
        const kennung = (caps.model_id || '').toLowerCase();
        if (!kennung) return;              // kein Modell gesetzt: altes Bild stehen lassen
        const quelle = `/static/img/printers/${kennung}.png`;
        if (bild.dataset.modell === kennung) return;
        bild.dataset.modell = kennung;
        // Gibt es das Bild nicht, bleibt das bisherige stehen statt eines
        // kaputten Symbols.
        const probe = new Image();
        probe.onload = () => { bild.src = quelle; };
        probe.src = quelle;
    }

    _zeigeAmsAnbau(data) {
        const behaelter = document.getElementById('pv-ams');
        if (!behaelter) return;
        const bild = document.getElementById('pv-ams-img');
        const schild = document.getElementById('pv-ams-badge');

        const einheiten = (data.ams && data.ams.units) || [];
        if (!einheiten.length) {
            behaelter.hidden = true;
            return;
        }

        // Erste gemeldete Einheit zeigen. Mehrere nebeneinander waeren neben
        // Drucker und Duese zu schmal — die Material-Zone listet ohnehin alle.
        const e = einheiten[0];
        const ht = String(e.model || '').toUpperCase().includes('HT');
        const quelle = ht ? '/static/img/ams/ams_ht.png' : '/static/img/ams/ams.png';
        if (bild && bild.getAttribute('src') !== quelle) {
            bild.setAttribute('src', quelle);
            bild.alt = e.model || 'AMS';
        }

        // Feuchte und Temperatur druntersetzen — beim AMS HT die
        // interessanten Werte, weil es heizt.
        if (schild) {
            const teile = [];
            if (e.humidity != null) teile.push(Math.round(e.humidity) + '%');
            if (e.temperature != null) teile.push(Math.round(e.temperature) + '\u00b0');
            schild.textContent = teile.join(' \u00b7 ');
            schild.hidden = teile.length === 0;

            // Klick auf Feuchte/Temperatur oeffnet die Trocknung — denselben
            // Dialog wie der Knopf in der Material-Zone. Nur bei Geraeten,
            // die wirklich trocknen koennen (AMS 2 Pro / AMS HT).
            if (e.can_dry) {
                schild.classList.add('pv-badge--click');
                schild.title = (window.texts && window.texts.mz_dry) || 'Trocknen';
                schild.onclick = (ev) => {
                    ev.stopPropagation();
                    if (typeof window.amsDryStart === 'function') window.amsDryStart(e.id);
                };
            } else {
                schild.classList.remove('pv-badge--click');
                schild.onclick = null;
                schild.title = '';
            }
        }

        behaelter.hidden = false;
    }

    /** Bed-Mesh-Heatmap (Klipper) und Dateiname */
    _zeigeBedMesh(data, previousState) {
        const texts = window.texts || {};
        // ============ Bed-Mesh-Heatmap (Klipper) ============
        // Wird ueber /api/status mitgeliefert (NICHT im SocketIO klipper_state-
        // Event — zu gross fuer 1Hz push). data.bed_mesh ist {matrix, mesh_min,
        // mesh_max, profile_name} oder null. Falls null und wir haben schon
        // gerendert: nichts tun (cache effect). Falls explicit {matrix:null}:
        // verstecken.
        if (data.bed_mesh && Array.isArray(data.bed_mesh.matrix)
            && data.bed_mesh.matrix.length > 0) {
            this._renderBedMeshHeatmap(data.bed_mesh);
        }

        const filamentValue = document.getElementById('filament-value');
        // Ohne bekanntes Filament den ganzen Chip weglassen statt "--"
        // anzuzeigen — wie Bett und Kammer im Drucker-Bild daneben.
        const filamentChip = document.getElementById('filament-info');
        if (filamentChip) {
            const bekannt = !!(data.filament_display
                || (data.is_multifilament_print && data.filament_count > 1));
            filamentChip.style.display = bekannt ? '' : 'none';
        }
        if (filamentValue) {
            if (data.is_multifilament_print && data.filament_count > 1) {
                filamentValue.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(102,126,234,0.2);padding:1px 6px;border-radius:6px;font-size:11px;">${texts.multifilament_count ? texts.multifilament_count.replace('{count}', data.filament_count) : data.filament_count + ' Farben'}</span>`;
            } else if (data.filament_display) {
                let html = '';
                if (data.filament_color) {
                    html += `<span style="display:inline-block;width:8px;height:8px;background:${data.filament_color};border-radius:50%;margin-right:4px;border:1px solid rgba(255,255,255,0.2);"></span>`;
                }
                html += data.filament_display;
                filamentValue.innerHTML = html;
            } else {
                filamentValue.textContent = '--';
            }
        }

        const fileInfo = document.getElementById('file-info');
        if (fileInfo) {
            if (!window.currentPrintFilename) window.currentPrintFilename = '';
            if ((data.gcode_state === 'PREPARE' && previousState === 'IDLE') ||
                (data.gcode_state === 'RUNNING' && previousState === 'PREPARE') ||
                (!window.currentPrintFilename && data.filename)) {
                let newFilename = data.filename || data.filename_display || data.display_text || '';
                if (newFilename) {
                    window.currentPrintFilename = newFilename;
                    // Check if filename is a translation key (starts with "status.")
                    let displayText = newFilename;
                    if (newFilename.startsWith('status.')) {
                        // Extract translation key (e.g., "status.no_print_active" -> "no_print_active")
                        const translationKey = newFilename.replace('status.', '');
                        // Use translated text if available
                        if (typeof texts !== 'undefined' && texts[translationKey]) {
                            displayText = texts[translationKey];
                        } else if (typeof texts !== 'undefined' && texts.no_print_active) {
                            displayText = texts.no_print_active;
                        } else {
                            // Hardcoded fallback
                            displayText = translationKey === 'no_print_active' ? 'Kein Druck aktiv' : '';
                        }
                    } else {
                        // Voller Name — das CSS (text-overflow: ellipsis)
                        // kuerzt nur, wenn wirklich kein Platz ist. Die harte
                        // 40-Zeichen-Grenze schnitt trotz freier Breite ab.
                        displayText = newFilename;
                    }
                    fileInfo.textContent = displayText;
                }
            }
            if (data.gcode_state === 'IDLE') window.currentPrintFilename = '';
        }
        const titelbildImg = document.getElementById('titelbild');
        const titelbildContainer = document.getElementById('titelbild-container');
        if (!window.currentThumbnailUrl) window.currentThumbnailUrl = '';
        let newThumbnailData = data.thumbnail_base64 || data.thumbnail_url;
        if (newThumbnailData && newThumbnailData !== 'undefined') {
            const newSrc = data.thumbnail_base64 ? imageDataUrl(data.thumbnail_base64) : newThumbnailData;
            if (newSrc !== window.currentThumbnailUrl) {
                titelbildImg.src = newSrc;
                window.currentThumbnailUrl = newSrc;
                // Nur das BILD schalten, nie den Container: der haelt den
                // Platz frei, damit der Drucker nicht nach links rutscht,
                // solange kein Thumbnail da ist.
                titelbildImg.onload = () => titelbildImg.style.visibility = '';
                titelbildImg.onerror = () => titelbildImg.style.visibility = 'hidden';
            }
        } else if (data.gcode_state !== 'RUNNING' && data.gcode_state !== 'PREPARE') {
            titelbildImg.style.visibility = 'hidden';
        }

        // Laeuft ein Druck ohne Vorschaubild, steht dort sonst ein leerer
        // grauer Kasten. Bei Drucken direkt aus Bambu Studio liegt die 3MF im
        // internen Speicher des Druckers — dort kommt niemand heran, auch
        // nicht die Home-Assistant-Integration. Statt Leere ein Symbol mit
        // dem Grund daneben.
        if (titelbildContainer) {
            const laeuft = data.gcode_state === 'RUNNING' || data.gcode_state === 'PREPARE';
            const hatBild = !!(newThumbnailData && newThumbnailData !== 'undefined');
            const zeigeLeer = laeuft && !hatBild;
            titelbildContainer.classList.toggle('kein-bild', zeigeLeer);
            // Die Vorschau der Druckkarte ist rund 110px gross — dort passt
            // nur das Symbol. Der Grund steht im Tooltip und ausfuehrlich in
            // der Historie.
            // Der Klick oeffnet weiterhin die Historie — beide Hinweise
            // stehen im Tooltip, statt dass einer den anderen ueberschreibt.
            const t = window.texts || {};
            const klickHinweis = data.current_print_id
                ? (t.history_open || 'Eintrag in der Historie öffnen') : '';
            const teile = [zeigeLeer ? (t.no_thumbnail_reason || '') : '', klickHinweis]
                .filter(Boolean);
            if (teile.length) titelbildContainer.title = teile.join('\n\n');
            else titelbildContainer.removeAttribute('title');
        }
    }

    /** Status-Text, Pause/Fortsetzen und Filament-Wechsel-Knoepfe */
    _zeigeStatusUndAktion(data, previousState) {
        const texts = window.texts || {};
        // Status-Text Logik
        const statusElement = document.getElementById('print-status');
        if (statusElement) {
            let statusText = texts.status_ready || 'Bereit';

            // Filament-Change-Übergangs-Phase (nach "Fertig"-Klick, ams_status=0x0107)
            // Dauert ca. 40s während Drucker letzten Purge macht + Düse zurückfährt.
            // Überschreibt sowohl PAUSE- als auch RUNNING-Status während dieser Zeit.
            const fcFinishing = data.filament_change_finishing ||
                (window.lastPrintData && window.lastPrintData.filament_change_finishing);

            if (data.gcode_state === 'IDLE') {
                statusText = this.translateStatusKey(data.display_text) || this.translateStatusKey(data.status_text) || texts.status_ready || 'Bereit zum Drucken';
            } else if (fcFinishing) {
                // Druck wird nach Filament-Wechsel fortgesetzt
                statusText = texts.status_filament_change_resuming || 'Druck wird fortgesetzt…';
                // Buttons wie bei RUNNING zurücksetzen (wir kommen aus PAUSE)
                ['resume-btn-mobile', 'resume-btn-desktop', 'fc-retry-btn-mobile', 'fc-retry-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
                // display = '' → reset auf CSS-default (flex), nicht 'block'
                ['pause-btn-mobile', 'pause-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = '';
                });
            } else if (data.gcode_state === 'RUNNING') {
                statusText = this.translateStatusKey(data.status_text) || texts.status_printing || 'Druckt...';
                // Stage (Soak/QGL/Mesh/Clean/...) aus stage_code/stage_custom anhängen
                // (STATUS_CONTRACT §7). Producer hat schon gefiltert/klassifiziert.
                const _stageR = this.stageLabel(data);
                if (_stageR) statusText = statusText + ' · ' + _stageR;
                // Resume → Pause Buttons zurücksetzen (nach PAUSE/Farbwechsel)
                ['resume-btn-mobile', 'resume-btn-desktop', 'fc-retry-btn-mobile', 'fc-retry-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
                // display = '' → reset auf CSS-default (flex), nicht 'block'
                ['pause-btn-mobile', 'pause-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = '';
                });
            } else if (data.gcode_state === 'PREPARE') {
                statusText = this.translateStatusKey(data.status_text) || texts.status_preparing || 'Vorbereitung...';
                // Stage aus stage_code/stage_custom (STATUS_CONTRACT §7).
                const _stageP = this.stageLabel(data);
                if (_stageP) statusText = statusText + ' · ' + _stageP;
            } else if (data.gcode_state === 'PAUSE') {
                // Multi-Color External-Spool Filament-Change?
                // Server liefert filament_change_phase:
                //   0 = normale Pause
                //   1 = User soll Filament wechseln → Resume-Button sendet Load-Sequence
                //   2 = User soll Laden bestätigen → Resume-Button sendet ams_control done
                //                                    + Retry-Button (eigener Button) für M620 P255+P254
                // Der Backend-Endpoint /api/mqtt/print {command:"resume"} routet
                // automatisch anhand der Phase — der Resume-Button selbst wechselt
                // nur Icon/Text/Farbe.
                const fcPhase = data.filament_change_phase ||
                    (window.lastPrintData && window.lastPrintData.filament_change_phase) || 0;

                if (fcPhase === 1) {
                    statusText = texts.status_filament_change_load || 'Filament wechseln';
                } else if (fcPhase === 2) {
                    statusText = texts.status_filament_change_confirm || 'Filament laden bestätigen';
                } else {
                    statusText = this.translateStatusKey(data.status_text) || texts.status_paused || 'Pausiert';
                }

                // Pause-Button ausblenden
                ['pause-btn-mobile', 'pause-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });

                // Phase-spezifische Labels für den Resume-Button.
                // Icons + Text werden SEPARAT gesetzt (Icon in icon-span,
                // Text in text-span). Translations enthalten absichtlich
                // KEIN Emoji — sonst doppeltes Icon im Button.
                let resumeIcon, resumeLabel, resumeClass;
                if (fcPhase === 1) {
                    resumeIcon = window.skIcon('runter');
                    resumeLabel = texts.filament_change_load || 'Filament laden';
                    resumeClass = 'control-btn info';        // blau
                } else if (fcPhase === 2) {
                    resumeIcon = window.skIcon('haken');
                    resumeLabel = texts.filament_change_done || 'Fertig';
                    resumeClass = 'control-btn success';     // grün
                } else {
                    resumeIcon = window.skIcon('start');
                    resumeLabel = texts.resume || 'Fortsetzen';
                    resumeClass = 'control-btn success';     // grün
                }

                // Resume-Button anzeigen + Icon/Text/Farbe setzen.
                // WICHTIG: display = '' (CSS-Reset), nicht 'block' —
                // .control-btn hat als CSS-Default `display: flex`, was
                // für Icon+Text-Alignment nötig ist. 'block' würde das
                // Flex-Layout zerstören.
                ['mobile', 'desktop'].forEach(variant => {
                    const btn = document.getElementById(`resume-btn-${variant}`);
                    if (!btn) return;
                    btn.style.display = '';
                    btn.className = resumeClass;
                    const icon = document.getElementById(`resume-icon-${variant}`);
                    if (icon) icon.innerHTML = resumeIcon;
                    const text = document.getElementById(`resume-text-${variant}`);
                    if (text) text.textContent = resumeLabel;
                });

                // Retry-Button NUR in Phase 2 sichtbar (eigener 6. Button).
                ['mobile', 'desktop'].forEach(variant => {
                    const retryBtn = document.getElementById(`fc-retry-btn-${variant}`);
                    if (!retryBtn) return;
                    if (fcPhase === 2) {
                        retryBtn.style.display = '';   // Reset auf CSS-flex
                        const retryText = document.getElementById(`fc-retry-text-${variant}`);
                        if (retryText) retryText.textContent = texts.filament_change_retry || 'Erneut versuchen';
                    } else {
                        retryBtn.style.display = 'none';
                    }
                });
            } else if (data.gcode_state === 'FINISH') {
                // Wenn der Druck gerade erst fertig wurde, zeige einen Zwischenstatus.
                if (previousState === 'RUNNING') {
                    statusText = 'Wird abgeschlossen...';

                    setTimeout(() => {
                        // Prüfe, ob der Status immer noch FINISH ist (und kein neuer Druck gestartet wurde)
                        if (window.lastPrintData && window.lastPrintData.gcode_state === 'FINISH') {
                            console.log('⏳ Timeout: resetting the UI to IDLE.');
                            this.handlePrintUpdate({ gcode_state: 'IDLE' }, 'timeout_reset');
                        }
                    }, 45000); // 45 Sekunden warten
                } else {
                    statusText = texts.status_print_completed || 'Fertig';
                }
            } else if (data.gcode_state === 'FAILED') {
                statusText = texts.status_print_failed || 'Fehler';
            }

            // Status-Pill (HelixScreen): kompaktes "Status: <State>" OHNE Stage-Suffix.
            // EINE Quelle = data.status_text (Key, vom Producer immer gesetzt) →
            // übersetzt, ohne angehängten Doppelpunkt/Punkte. status_running entfällt
            // (war die "Läuft"-vs-"Druckt"-Bug-Quelle). STATUS_CONTRACT §7.
            const statusTextElement = document.getElementById('print-status-text');
            if (statusTextElement) {
                // Steht die Steckdose auf aus, gibt es keinen Status —
                // dann bleibt die Pille weg statt "Status: Bereit" an einem
                // ausgeschalteten Drucker zu behaupten. Android macht das
                // genauso (HomeViewModel.isPrinterOn blendet die Karten aus).
                // Dass er aus ist, sagen daneben schon Kamera und Drucker-Knopf.
                // Die ganze Pille ausblenden, nicht nur den Text — sie traegt
                // den Statuspunkt und bliebe sonst als leerer grauer Stummel
                // stehen.
                const pille = document.getElementById('print-status') || statusTextElement;
                if (data.switch === 'off') {
                    pille.style.display = 'none';
                } else {
                    pille.style.display = '';
                    const label = (this.translateStatusKey(data.status_text) || texts.status_ready || 'Ready')
                                  .replace(/[:.\s]+$/, '');
                    const prefix = texts.status || 'Status';
                    statusTextElement.textContent = `${prefix}: ${label}`;
                }
            }

            // Pause/Fortsetzen/Abbrechen auf der Bambu-Druckkarte —
            // seit dem Zonen-Umbau gibt es die alte Steuerungs-Card nicht mehr.
            this.updatePcbActions(data);

            // Update status dot color
            const statusDot = document.getElementById('status-dot');
            if (statusDot) {
                statusDot.className = 'status-dot';
                if (data.gcode_state === 'RUNNING') statusDot.classList.add('status-running');
                else if (data.gcode_state === 'PAUSE') statusDot.classList.add('status-paused');
                else if (data.gcode_state === 'FAILED') statusDot.classList.add('status-failed');
                else if (data.gcode_state === 'PREPARE') statusDot.classList.add('status-preparing');
                else statusDot.classList.add('status-idle');
            }
        }
    }

    /** Statuspunkt und Trocknen-Knopf */
    _zeigeKartenKnoepfe(data, previousState) {
        const texts = window.texts || {};
        // Filament Trocknen Button deaktivieren während Druck läuft
        const startDryingBtn = document.getElementById('start-drying-btn');
        if (startDryingBtn) {
            // NUR die Beschriftung anfassen: textContent auf dem Knopf
            // wuerde das Zeichen daneben mit wegwerfen. Blass und Zeiger
            // macht `.tr-knopf:disabled` im Stylesheet.
            const beschriftung = document.getElementById('start-drying-text');
            const druckt = data.gcode_state === 'RUNNING' || data.gcode_state === 'PREPARE';
            startDryingBtn.disabled = druckt;
            startDryingBtn.title = '';
            if (beschriftung) {
                beschriftung.textContent = druckt ? texts.drying_not_possible : texts.start_drying;
            }
        }

        this.applyHmsBanner(data);

        // Multi-Color External-Spool: Kein separates Banner — der
        // Pause/Resume-Button (handlePrintUpdate oben) passt seinen Text
        // und sein Verhalten je nach filament_change_phase an.
    }


    /**
     * HMS-Banner setzen. EINE Fassung fuer beide Wege.
     *
     * Stand bis 20aug26 zweimal fast gleich da: hier fuer den Socket und in
     * status-manager.applyStatus fuer den /api/status-Poll. Das waren die
     * einzigen vier DOM-Elemente, die sich die beiden Bloecke teilten — und
     * prompt liefen sie auseinander (nur diese Fassung kannte den
     * synthetischen Klipper-Code).
     */
    applyHmsBanner(data) {
        // Gezeichnet wird in hms-banner.js — dieselbe Routine, die auch
        // Konsole, Historie und Einstellungen benutzen. Hier stehen nur die
        // Dinge, die es NUR auf der Hauptseite gibt: die Quittungsliste vom
        // Start und der Hinweis, dass sie schon da ist.
        if (!window.HmsBanner) return;
        window.HmsBanner.zeichne(data, {
            geladen: hmsStatusLoaded,
            weggeklickt: (code) => isHMSErrorDismissed(code),
            aufraeumen: () => clearDismissedHMSErrors(),
        });
    }

    /**
     * Rendert die Klipper bed_mesh-Matrix als 3D-Isometric-Surface im
     * SVG-Element `#bed-mesh-svg`. Color-Gradient blau→gelb→rot (Hue 240°→0°
     * via HSL). Z-Werte werden auf 0..1 normalisiert und mit Faktor verstärkt
     * damit auch kleine Spreads (0.05-0.2 mm) sichtbar sind.
     *
     * Iso-Projektion: 30° X + 30° Y. Quads werden back-to-front sortiert
     * gezeichnet (Painter's Algorithm) damit Vordergrund vorne ist.
     *
     * @param {{matrix: number[][], mesh_min?: number[], mesh_max?: number[],
     *          profile_name?: string}} bedMesh
     */
    _renderBedMeshHeatmap(bedMesh) {
        const container = document.getElementById('bed-mesh-info');
        const svg = document.getElementById('bed-mesh-svg');
        const rangeLabel = document.getElementById('bed-mesh-range');
        if (!container || !svg) return;

        const matrix = bedMesh.matrix;
        if (!Array.isArray(matrix) || matrix.length === 0
            || !Array.isArray(matrix[0])) {
            container.style.display = 'none';
            return;
        }

        const rows = matrix.length;
        const cols = matrix[0].length;
        let vmin = Infinity, vmax = -Infinity;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = matrix[r][c];
                if (typeof v !== 'number') continue;
                if (v < vmin) vmin = v;
                if (v > vmax) vmax = v;
            }
        }
        if (!isFinite(vmin) || !isFinite(vmax)) {
            container.style.display = 'none';
            return;
        }
        const spread = Math.max(vmax - vmin, 0.05);

        // ======= Iso-Projektion =======
        // viewBox 200x140 — breit genug fuer das gekippte Grid.
        svg.setAttribute('viewBox', '0 0 200 140');
        const VW = 200, VH = 140;

        // Iso-Achsen (30° Kippen, 30° Rotation)
        const cos30 = Math.cos(Math.PI / 6);
        const sin30 = Math.sin(Math.PI / 6);

        // Grid-Spannweite in Welt-Koordinaten (centered). Seitenverhältnis aus dem
        // ECHTEN Mesh-Bereich (mesh_min/mesh_max) ableiten, sonst wirkt ein adaptives
        // Mesh (z.B. breit & flach) fälschlich quadratisch wie ein Voll-Mesh.
        const gridSize = 110;                   // längere Welt-Achse
        let worldW = gridSize, worldH = gridSize;   // X (cols) / Y (rows)
        const _mn = bedMesh.mesh_min, _mx = bedMesh.mesh_max;
        if (Array.isArray(_mn) && Array.isArray(_mx) && _mn.length >= 2 && _mx.length >= 2) {
            const spanX = Math.abs(_mx[0] - _mn[0]);
            const spanY = Math.abs(_mx[1] - _mn[1]);
            const maxSpan = Math.max(spanX, spanY);
            if (spanX > 0 && spanY > 0 && maxSpan > 0) {
                worldW = gridSize * (spanX / maxSpan);
                worldH = gridSize * (spanY / maxSpan);
            }
        }
        const stepX = worldW / (cols - 1);
        const stepY = worldH / (rows - 1);
        const zScale = 25;                      // Hoehen-Skalierung
        const cx = VW / 2;                      // Welt-Origin auf Canvas
        // cy zentriert den Mesh. Iso-Span fuer gx+gy ∈ [-gridSize, +gridSize]
        // gibt vertikalen Range von ±gridSize*sin30 = ±55px plus z-Swing
        // von ±zScale*0.5 = ±12.5px. Mit VH=140 passt cy=VH/2 perfekt:
        // top  = 70 - 67.5 = +2.5
        // bot  = 70 + 67.5 = 137.5
        // (Vorher cy = VH/2+25 → bottom-Corner @ 162 → clipped).
        const cy = VH / 2;

        const project = (gx, gy, z) => {
            // gx/gy: Grid-Koordinaten centered (-gridSize/2 ... +gridSize/2)
            // Iso: sx = (x - y) * cos30; sy = (x + y) * sin30 - z
            const sx = cx + (gx - gy) * cos30;
            const sy = cy + (gx + gy) * sin30 - z * zScale;
            return [sx, sy];
        };

        // Vertices vorberechnen (rows x cols)
        const verts = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const v = matrix[r][c];
                if (typeof v !== 'number') { row.push(null); continue; }
                // Y umkehren — Bed Y=0 unten in Welt, SVG Y=0 oben in Pixel.
                // (Das ist die KORREKTE Orientierung, deckt sich mit Mainsail.)
                const gx = -worldW / 2 + c * stepX;
                const gy = +worldH / 2 - r * stepY;
                const tz = (v - vmin) / spread;            // 0..1
                const z = tz - 0.5;                         // -0.5..+0.5 (centered)
                const [sx, sy] = project(gx, gy, z);
                row.push({ sx, sy, gx, gy, z, t: tz, v });
            }
            verts.push(row);  // <-- der fehlende push
        }

        // Quads bauen (rows-1) x (cols-1), mit Color = Avg(z) und Tiefen-Key
        // (gx+gy am Quad-Mittelpunkt) fuer Painter's Sort.
        const quads = [];
        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                const a = verts[r][c];
                const b = verts[r][c + 1];
                const d = verts[r + 1][c + 1];
                const e = verts[r + 1][c];
                if (!a || !b || !d || !e) continue;
                const avgT = (a.t + b.t + d.t + e.t) / 4;
                const hue = 240 - avgT * 240;
                // Tiefen-Key: Quads mit hohem (gx+gy) liegen weiter VORN
                // (positive Y zeigt nach VORNE in Iso), also kleinere Key
                // = weiter HINTEN — die zeichnen wir zuerst.
                const depth = (a.gx + a.gy + d.gx + d.gy) / 2;
                quads.push({
                    points: `${a.sx.toFixed(2)},${a.sy.toFixed(2)} `
                          + `${b.sx.toFixed(2)},${b.sy.toFixed(2)} `
                          + `${d.sx.toFixed(2)},${d.sy.toFixed(2)} `
                          + `${e.sx.toFixed(2)},${e.sy.toFixed(2)}`,
                    hue,
                    depth,
                    avgV: (a.v + b.v + d.v + e.v) / 4,
                });
            }
        }
        // Painter's: hinten zuerst (kleinste depth = ganz hinten in Iso)
        quads.sort((x, y) => x.depth - y.depth);

        // ===== Render =====
        // Zuerst dezente Grid-Axes (Drahtgitter-Boden) als Reference-Frame.
        const corners = [
            project(-gridSize / 2, +gridSize / 2, -0.5),  // links vorne
            project(+gridSize / 2, +gridSize / 2, -0.5),  // rechts vorne
            project(+gridSize / 2, -gridSize / 2, -0.5),  // rechts hinten
            project(-gridSize / 2, -gridSize / 2, -0.5),  // links hinten
        ];
        const floorPath = corners.map((p, i) =>
            (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z';

        let svgInner = `<path d="${floorPath}" `
            + `fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)" stroke-width="0.5"/>`;

        // Quads
        for (const q of quads) {
            svgInner += `<polygon points="${q.points}" `
                + `fill="hsl(${q.hue.toFixed(0)}, 75%, 55%)" `
                + `stroke="rgba(0,0,0,0.18)" stroke-width="0.3">`
                + `<title>z=${q.avgV.toFixed(3)} mm</title></polygon>`;
        }

        svg.innerHTML = svgInner;
        container.style.display = '';
        if (rangeLabel) {
            const spreadShown = (vmax - vmin).toFixed(3);
            const profile = bedMesh.profile_name
                ? ` · ${bedMesh.profile_name}` : '';
            rangeLabel.textContent =
                `Δ ${spreadShown} mm  (${vmin.toFixed(3)} … ${vmax.toFixed(3)})${profile}`;
        }
    }

    reconnectWebSocket() {
        console.log('📱 Reconnecting WebSocket...');
        if (window.socket) {
            if (!window.socket.connected) {
                window.socket.connect();
                console.log('✅ WebSocket reconnect triggered');
            } else {
                console.log('ℹ️ WebSocket already connected');
            }
        }
    }

    _setupVisibilityHandler() {
        const texts = window.texts || {};

        // Safari PWA Detection
        const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

        document.addEventListener('visibilitychange', async () => {
            const now = Date.now();

            // WICHTIG: Verhindere mehrfache Ausführung
            if (window.socketReconnectInProgress) {
                console.log('⏸️ Socket reconnect already in progress');
                return;
            }

            // Throttle bleibt
            if (now - this.lastVisibilityChange < 3000) {
                console.log('⏸️ Visibility change throttled');
                return;
            }
            this.lastVisibilityChange = now;

            if (document.hidden) {
                // Tab versteckt - Socket/Polling Cleanup (Stream wird von Handler 1 verwaltet)
                console.log('📱 Tab versteckt - Socket Cleanup');

                if (window.statusUpdateInterval) {
                    clearInterval(window.statusUpdateInterval);
                    window.statusUpdateInterval = null;
                }

            } else if (!document.hidden) {
                // Tab sichtbar - NUR EINMAL reconnecten
                window.socketReconnectInProgress = true;

                console.log('📱 Tab visible again');

                // Token refresh
                if (window.isSafariPWA && window.authHandler) {
                    try {
                        const refreshed = await window.authHandler.refreshToken();
                        if (!refreshed) {
                            window.authHandler.redirectToLogin();
                            window.socketReconnectInProgress = false;
                            return;
                        }
                    } catch (error) {
                        console.error(texts.console_token_refresh_error + ':', error);
                        window.socketReconnectInProgress = false;
                        return;
                    }
                }

                if (window.socket && !window.socket.connected) {
                    console.log('🔄 Socket reconnect...');

                    // Versuche normalen reconnect
                    window.socket.connect();

                    // LÄNGER warten - 3 Sekunden statt 2
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    if (!window.socket.connected) {
                        console.log('❌ Reconnect failed - creating a new socket');

                        // Alte KOMPLETT killen
                        if (window.socket) {
                            window.socket.removeAllListeners();
                            window.socket.offAny();
                            if (window.socket.io) {
                                window.socket.io.opts.reconnection = false;  // Reconnection stoppen
                                window.socket.io._reconnection = false;
                                window.socket.io.disconnect();
                            }
                            window.socket.disconnect();
                            delete window.socket;  // Statt = null
                            window.socket = null;
                        }

                        // NOCH länger warten
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // Neue erstellen
                        window.socket = io({
                            transports: ['websocket', 'polling'],
                            upgrade: true,
                            reconnection: false,  // ERSTMAL AUS!
                            timeout: 15000,       // Längerer Timeout
                            forceNew: true,
                            auth: (cb) => {
                                const token = localStorage.getItem('access_token');
                                console.log('🔑 Token for the new socket:', !!token);
                                cb({ token: token });
                            }
                        });

                        // Warte auf Verbindung
                        window.socket.once('connect', () => {
                            console.log('✅ NEW socket connected:', window.socket.id);
                            // Jetzt reconnection wieder aktivieren
                            window.socket.io.opts.reconnection = true;
                        });

                        window.socket.once('connect_error', (error) => {
                            console.log('❌ New socket error:', error.message, error.type);
                        });

                        // Nach 5 Sekunden prüfen
                        setTimeout(() => {
                            if (!window.socket.connected) {
                                console.log('❌ New socket not connected after 5s');
                                // Fallback: Seite neu laden
                                showConfirmDialog(texts.confirm_reload_page, function() {
                                    location.reload();
                                });
                            }
                        }, 5000);
                    }
                }

                // Stream wird von Handler 1 (PAGE VISIBILITY) verwaltet - nicht hier!

                if (!window.statusUpdateInterval) {
                    // Einmal sofort holen, damit die Oberflaeche nach dem
                    // Sichtbarwerden nicht auf den ersten Push wartet.
                    // Danach nur noch als Rueckfall pollen — der Socket
                    // traegt inzwischen den vollen Stand (siehe app-init.js).
                    loadEverything();
                    window.statusUpdateInterval = setInterval(() => {
                        const online = window.socket && window.socket.connected
                                       && window.lastMqttStatus === true;
                        if (!online) loadEverything();
                    }, 8000);
                }

                // Flag zurücksetzen
                window.socketReconnectInProgress = false;
            }
        });
    }

    _setupSafariPWAFocusHandler() {
        // Safari PWA: NUR für Kamera, NICHT für Socket!
        // Der alte Safari-PWA-Focus-Handler ist raus: dataset.oldSrc wurde
        // nirgends gesetzt (toter Code), und Kamera-Wiederaufnahme gehoert
        // allein dem camera-manager (docs/kamera-architektur.md).
    }

    _setupBeforeUnloadHandler() {
        // Browser-Close Detection - WebSocket sauber schließen
        window.addEventListener('beforeunload', function(event) {
            console.log('🔌 Browser schließt - WebSocket cleanup');
            if (window.socket && window.socket.connected) {
                window.socket.removeAllListeners();
                window.socket.disconnect();
            }
        });
    }
}

// Create global instance
window.socketManager = new SocketManager();

// Global wrappers for backward compatibility
function handlePrintUpdate(data, source) {
    window.socketManager.handlePrintUpdate(data, source);
}

function formatTime(minutes) {
    return window.socketManager.formatTime(minutes);
}

function translateStatusKey(key) {
    return window.socketManager.translateStatusKey(key);
}

function reconnectWebSocket() {
    window.socketManager.reconnectWebSocket();
}
