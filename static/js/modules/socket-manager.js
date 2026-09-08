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
        this.ANDROID_UPDATE_THROTTLE = 2000; // 2 seconds
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

            // PWA session recovery BEFORE socket initialization
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

        // IMPORTANT: cleanly close old socket connection if one exists
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
            // Wait briefly so the connection closes cleanly
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const socket = io({
            // WebSocket preferred (one persistent connection instead of constant XHR polling),
            // polling only as fallback. Saves a ton of requests in Electron.
            transports: ['websocket', 'polling'],
            upgrade: true,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 10000,
            forceNew: true,  // Always a new connection
            // Authentication with token
            auth: (cb) => {
                const token = localStorage.getItem('access_token');
                cb({ token: token });
            }
        });

        // Safari PWA specific heartbeat
        if (window.isSafariPWA) {
            let heartbeatInterval;

            const startHeartbeat = () => {
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                heartbeatInterval = setInterval(() => {
                    if (socket.connected) {
                        socket.emit('ping');
                        // Also check token validity
                        if (window.authHandler) {
                            window.authHandler.checkAndRefreshToken();
                        }
                    }
                }, 20000); // Every 20 seconds
            };

            const stopHeartbeat = () => {
                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = null;
                }
            };

            socket.on('connect', startHeartbeat);
            socket.on('disconnect', stopHeartbeat);

            // On socket error: session recovery
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

        // Now register all handlers
        socket.on('connect', function() {
            console.log(texts.console_websocket_connected);

            // Fetch a fresh CSRF token. A new socket usually means the
            // server was just restarted, and our previous token may
            // have expired. The first
            // write action (light, outlet) used to run into a 403.
            // It got retried automatically, but each time cost one
            // discarded round-trip plus a WARNING in the server log.
            if (window.authHandler
                && typeof window.authHandler.erneuereCsrfToken === 'function') {
                deferNonCritical(() => window.authHandler.erneuereCsrfToken());
            }

            // Non-critical: these three calls are for banners/badges that only
            // matter after the actual UI render. Deferred to idle so they
            // don't compete with the critical initial paint.
            deferNonCritical(() => loadHMSStatus());
            deferNonCritical(() => loadPowerOffTimerStatus());
            deferNonCritical(() => updateScheduledPrintsBadge());
            // And catch up on whatever was handled elsewhere while
            // disconnected — see gleicheMeldungenAb.
            deferNonCritical(() => gleicheMeldungenAb());

            // Check browser notifications
            if ('Notification' in window) {
                if (Notification.permission === 'default') {
                    console.log(texts.console_browser_notifications_not_allowed);
                } else if (Notification.permission === 'granted') {
                    console.log(texts.console_browser_notifications_enabled);
                }
            }

            // Automatically request permission if not yet set
            // ELECTRON: no browser notifications - Electron uses FCM push
            if (!window.electronAPI && 'Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(function(permission) {
                    console.log('📱 Notification Permission:', permission);
                    if (permission === 'granted') {
                        // Test notification
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
            // Fallback polling takes over the gated 8s interval in app-init
            // (runs whenever socket/printer aren't fully online).
        });

        // Power-off timer WebSocket handler - ONLY ONE!
        socket.on('power_off_timer', function(data) {
            console.log(texts.console_poweroff_timer_event, data);

            const banner = document.getElementById('power-off-banner');
            const bannerCountdown = document.getElementById('power-off-banner-countdown');
            const bannerReason = document.getElementById('power-off-banner-reason');

            if (data.active) {
                window.powerOffTimerActive = true;

                // Show banner
                if (banner) {
                    banner.classList.add('active');
                    if (bannerReason) bannerReason.textContent = data.reason;
                }

                // Update countdown
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
                        // Timer expired - hide banner
                        if (banner) banner.classList.remove('active');
                    }
                };

                updateCountdown();

            } else {
                // Timer deactivated - hide banner
                window.powerOffTimerActive = false;
                if (banner) {
                    banner.classList.remove('active');
                }
            }
        });

        // Filament drying status handler
        socket.on('filament_drying_status', function(data) {
            console.log(texts.console_drying_status, data);

            // Update the card and control visibility together. They hang off
            // FilamentDryingManager.updateStatus() — which used to fetch the
            // state itself every 10 seconds before, even though it already
            // arrives here. Now we just pass the data along instead of
            // asking for it a second time.
            if (window.filamentDryingManager
                && typeof window.filamentDryingManager.updateStatus === 'function') {
                window.filamentDryingManager.updateStatus(data);
            }

            const details = document.getElementById('filament-drying-details');

            // Update global status
            window.isFilamentDrying = data.active;

            if (data.active) {
                // Update details - distinguish between auto-detection and manual drying
                if (data.end_time_formatted) {
                    // Manual drying with end time
                    const temp = Math.round(data.temperature);
                    details.textContent = texts.filament_drying_banner_with_endtime
                        .replace('{temp}', temp)
                        .replace('{time}', data.end_time_formatted);
                } else if (data.bed_temp !== undefined) {
                    // Auto-detection
                    const temp = Math.round(data.bed_temp);
                    const minutes = Math.round(data.elapsed_minutes);
                    details.textContent = texts.filament_drying_banner_auto
                        .replace('{temp}', temp)
                        .replace('{minutes}', minutes);
                }

                // Whether the message stays up is decided by applyDryingBanner:
                // during a print the AMS dries on the side, so a one-time
                // notice is enough.
                if (window.applyDryingBanner) window.applyDryingBanner(data);

                // Hide controls + print status centrally (shared helper in
                // filament-drying.js — identical to the immediate poll, no lag/duplication).
                if (window.applyDryingControlsVisibility) window.applyDryingControlsVisibility(true);
            } else {
                if (window.applyDryingBanner) window.applyDryingBanner(data);

                // Show controls + print status centrally again (shared helper).
                if (window.applyDryingControlsVisibility) window.applyDryingControlsVisibility(false);
            }

            // Update the new filament-drying card
            if (typeof updateDryingStatus === 'function') {
                updateDryingStatus();
            }
        });

        // SD sync status updates
        socket.on('sd_sync_start', function(data) {
            console.log(texts.console_auto_sync_started);
            if (window.sdCardManager) window.sdCardManager.sdSyncInProgress = true;

            // Disable refresh button
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

            // Re-enable refresh button
            const refreshBtn = document.getElementById('sd-refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.style.opacity = '1';
                refreshBtn.style.cursor = 'pointer';
                refreshBtn.innerHTML = window.skIcon('aktualisieren') + '<span>' + texts.refresh + '</span>';
            }

            // Update banner when the modal is open
            if (document.getElementById('sdCardModal').style.display === 'block') {
                const banner = document.getElementById('sync-banner');
                if (banner) {
                    banner.style.background = 'var(--accent-green)';
                    const count = data.changes ? data.changes.downloaded.length : 0;
                    banner.innerHTML = `
                        <span>${texts.sync_completed.replace('{count}', count)}</span>
                    `;

                    // Hide after 3 seconds
                    setTimeout(() => {
                        banner.style.transition = 'opacity 0.5s';
                        banner.style.opacity = '0';
                        setTimeout(() => banner.remove(), 500);
                    }, 3000);
                }

                // If new files came in, refresh the list
                if (data.changes && data.changes.downloaded.length > 0) {
                    skToast(texts.toast_new_files_available.replace('{count}', data.changes.downloaded.length), 'info');
                    // Optional: reload automatically
                    // showSDFiles();
                }
            }
        });

        socket.on('sd_sync_progress', function(data) {
            // Pass the real state through to the refresh button. It used
            // to fill in from a client-side estimate before; now it
            // shows "File N of M" the way the server reports it.
            if (data.manual_sync && window.sdCardManager
                    && typeof window.sdCardManager._syncStand === 'function') {
                window.sdCardManager._syncStand(data.percent || 0, window.texts || {});
            }
            // NEW: also update the loading area on manual sync
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

                    // Show details
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

                    // Show files after 2 seconds
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
            // Save global status
            window.ftpsStatus = data;

            // Refresh-button status - only disable it, no percentage shown in the button
            const refreshBtn = document.getElementById('sd-refresh-btn');
            if (refreshBtn) {
                if (data.active) {
                    refreshBtn.disabled = true;
                    refreshBtn.style.opacity = '0.5';
                    refreshBtn.style.cursor = 'not-allowed';
                    // Show only a generic hint, the percentage belongs in the progress bar
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

            // Optional: toast at start/end of FTPS operations
            if (data.operation !== 'idle' && data.progress === 0) {
                // Operation started
                console.log(`📡 FTPS ${data.operation}: ${data.message}`);
            }
        });

        // Bidirectional sync completed
        socket.on('bidirectional_sync_complete', function(data) {
            const t = window.texts || {};
            skToast((t.toast_sync_done || 'Sync fertig — {down} geladen, {up} gesendet')
                .replace('{down}', data.downloaded).replace('{up}', data.uploaded), 'success');
            // Reload SD files
            if (document.getElementById('sd-modal')?.style.display === 'block') {
                showSDFiles();
            }
        });

        // Bidirectional sync error
        socket.on('bidirectional_sync_error', function(data) {
            const t = window.texts || {};
            skToast((t.toast_sync_error || 'Sync-Fehler: {error}').replace('{error}', data.error), 'error');
        });

        // Scheduled prints changed (created/updated/deleted/started/failed) ->
        // reload the badge right away instead of waiting for the 30s poll.
        // Backend delivers {count, reason} - we use count directly if the
        // manager instance exists, otherwise trigger a full refresh.
        socket.on('scheduled_prints_changed', function(data) {
            try {
                const count = data && typeof data.count === 'number' ? data.count : null;
                const badgeMobile = document.getElementById('scheduled-badge-mobile');
                const badgeDesktop = document.getElementById('scheduled-badge-desktop');
                const badgeZone = document.getElementById('mz-sched-badge');

                if (count !== null) {
                    // Set directly from the event - no extra REST round trip
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
                // If the management list is open, refresh its content too
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
            // Two blocks feed the UI, and they are almost
            // disjoint: handlePrintUpdate covers the print card, progress and
            // chips (42 DOM elements), applyStatus the buttons, the
            // device tab, filament and hardware info (30). Together
            // they only share the HMS banner.
            //
            // applyStatus used to hang solely off the 8-second poll. When that
            // was dropped, 26 elements stopped keeping up — most
            // visibly the light button: the server had the new state within
            // 1.3s, but nothing wrote it in. The push carries
            // the same 95 keys as /api/status, so it now feeds
            // both paths.
            this.handlePrintUpdate(data, 'print_progress');
            if (window.statusManager && typeof window.statusManager.applyStatus === 'function') {
                try { window.statusManager.applyStatus(data); }
                catch (e) { console.error('applyStatus failed:', e); }
            }
        });

        // 'status_update' had a listener here that no server code path
        // ever served — like 'full_status_update'. Removed.

        // Handler for full status requests
        // 'full_status_update' existed here as a listener, but no
        // server code path ever sent it — a half-built rework
        // that wanted exactly what 'print_progress' has done since 20aug26:
        // send the full state. Removed instead of wired up.

        // Spoolman active spool update (from backend after print start)
        socket.on('spoolman_active_spool', function(data) {
            console.log('🧵 Spoolman active spool update:', data);
            if (data.spool_id) {
                window.activeSpoolId = data.spool_id;
                updateSpoolmanDisplay();
            }
        });

        socket.on('mqtt_status', function(data) {
            // Stop timer when status arrives via WebSocket
            if (window.statusManager && window.statusManager.mqttCountdownInterval) {
                clearInterval(window.statusManager.mqttCountdownInterval);
                window.statusManager.mqttCountdownInterval = null;
            }

            // Save MQTT status
            window.lastMqttStatus = data.connected;

            // Klipper-Direct: couple the camera to the printer connection. Printer off
            // → stop snapshot polling (otherwise 404s hammer the dead cam),
            // printer on → reinitialize the camera.
            if (window.cameraManager && typeof window.cameraManager.onPrinterConnectionChange === 'function') {
                window.cameraManager.onPrinterConnectionChange(data.connected);
            }

            // Update cards that depend on printer status
            if (typeof updatePrinterDependentCards === 'function') {
                updatePrinterDependentCards();
            }

            if (data.connected) {
                updateBothButtons('mqtt-btn', 'control-btn active', window.skIcon('funk') + '<span>' + (texts.mqtt_button_connected || 'MQTT') + '</span>');
                console.log(texts.console_mqtt_auto_connect_success);
            } else {
                updateBothButtons('mqtt-btn', 'control-btn', window.skIcon('funk') + '<span>MQTT</span>');
                // Stop timer if still running
                if (window.statusManager && window.statusManager.mqttCountdownInterval) {
                    clearInterval(window.statusManager.mqttCountdownInterval);
                    window.statusManager.mqttCountdownInterval = null;
                }
            }

            // Update filament card visibility
            if (typeof updateFilamentCardVisibility === 'function') {
                updateFilamentCardVisibility();
            }
        });

        // Display Status Update
        socket.on('display_status', function(data) {
            const displayElement = document.getElementById('display-text');
            if (displayElement) {
                displayElement.textContent = data.text;

                // Color depending on status
                if (data.state === 'IDLE') {
                    displayElement.style.color = '#00ff00';  // Green
                } else if (data.state === 'RUNNING') {
                    displayElement.style.color = '#00aaff';  // Blue
                } else if (data.state === 'PAUSE') {
                    displayElement.style.color = '#ffaa00';  // Orange
                } else if (data.state === 'FAILED') {
                    displayElement.style.color = '#ff0000';  // Red
                }
            }
        });

        // === CENTRAL NOTIFICATION HANDLER ===
        socket.on('notification', function(data) {
            console.log(texts.console_unified_notification, data);

            // If already read/dismissed on another device:
            // don't show it again (cross-device read sync, stage 2).
            if (data.id && window.__dismissedNotificationIds
                && window.__dismissedNotificationIds.has(data.id)) {
                console.log('⏭️ Notification already dismissed on another device:', data.id);
                return;
            }

            // ELECTRON APP: the socket does not draw anything -- it wakes.
            //
            // It used to be thrown away here ("Electron gets notifications via
            // FCM push"), so the socket carried a message the app already had
            // and did nothing with it. Meanwhile two ways led into the stack:
            // straight from the push payload, and out of the store. Neither
            // knew about the other, and they only met at the silent duplicate
            // check inside `zeige()`.
            //
            // Now the socket only says "something changed" and the stack
            // fetches from `/api/notifications/recent` -- the same source the
            // page load already uses. One source, one way in.
            //
            // The desktop popup for a closed window stays with main.js and is
            // untouched: there is no renderer then that could fetch.
            if (window.electronAPI) {
                if (window.NotificationStack && window.NotificationStack.holeOffene) {
                    window.NotificationStack.holeOffene();
                } else {
                    console.log('🖥️ [Electron] no stack on this page — nothing to fetch');
                }
                return;
            }

            // The stack, in EVERY client — not just in Electron.
            //
            // The socket says WHEN, the store says WHAT: `holeOffene()` fetches
            // from /api/notifications/recent, the same source a page load uses.
            // Without this the browser got a system banner and the stack inside
            // the app stayed empty until the next page load. Found 08sep26:
            // printer switched on, the phone had it at once over FCM, the web
            // only minutes later — when something else happened to refresh.
            if (window.NotificationStack && window.NotificationStack.holeOffene) {
                window.NotificationStack.holeOffene();
            }

            if ('Notification' in window && Notification.permission === 'granted') {
                // Desktop browser (web only, not Electron!)
                const options = {
                    body: data.message,
                    icon: '/static/icon-192x192.png',
                    tag: data.type || 'general'
                };

                // Special options depending on type
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

                // Mark as read when the user clicks the browser notification
                if (data.id) {
                    const callApi = window.apiCall || ((url, opts) => fetch(url, {...opts, credentials: 'include'}));
                    notif.onclick = function() {
                        callApi(`/api/notifications/${encodeURIComponent(data.id)}/dismiss`, {
                            method: 'POST'
                        }).catch(() => {});
                        notif.close();
                    };
                    // NO onclose reporter.
                    //
                    // The event doesn't say WHY the notification went away.
                    // macOS hides browser notifications after a few seconds
                    // on its own — that would then have been reported to the
                    // server as "read", which cleans it up on all
                    // devices, and the box in Electron would disappear
                    // without anyone actually doing anything.
                    //
                    // The same trap as the DeleteIntent on Android
                    // (NotificationDismissReceiver): a reporter without a reason
                    // can't tell a user's gesture apart from a dismissal
                    // by the system. Only what's proven to be an action gets
                    // reported — the click
                    // on it.
                }
            }
        });

        // Cross-device dismiss: another device has dismissed the notification
        // → remove it locally too (if still visible) and
        // remember it for future echo pushes.
        if (!window.__dismissedNotificationIds) {
            window.__dismissedNotificationIds = new Set();
        }
        function _onDismissFromPeer(data) {
            if (!data || !data.id) return;
            window.__dismissedNotificationIds.add(data.id);
            // Electron: close open custom-notification windows with the same ID
            // on this desktop when another client
            // dismissed/read it. Without this the banner stays stuck until
            // the user clicks it here too.
            try {
                if (window.electronAPI && window.electronAPI.closeNotificationsById) {
                    window.electronAPI.closeNotificationsById(data.id);
                }
            } catch (_) {}
            // Remove the notification from the stack top-right if it comes from
            // this event. Since 27aug26 push notifications land there instead
            // of the external popup — without this line they stayed
            // after being swiped away on the phone.
            let weg = 0;
            try {
                if (window.NotificationStack && window.NotificationStack.entferne) {
                    weg = window.NotificationStack.entferne(data.id) || 0;
                }
            } catch (_) {}
            return weg;
        }
        /**
         * Catch up on what happened during the disconnect.
         *
         * Electron and web learn via the socket that a notification
         * was read elsewhere. If the machine sleeps, the connection
         * drops — and the event never arrives. On waking up the
         * banner would still be showing, even though it had long been
         * gone on the phone (01sep26: read on Android at 16:48, still
         * visible in Electron at 17:23 and dismissed by hand).
         *
         * `connect` also fires after every reconnect, so it's exactly
         * the right moment. Same rule as the socket event:
         * read OR dismissed, on whichever device, counts as gone.
         */
        async function gleicheMeldungenAb() {
            try {
                const ruf = window.apiCall || fetch;
                const antwort = await ruf('/api/notifications/recent?limit=50',
                                          { credentials: 'same-origin' });
                if (!antwort || !antwort.ok) return;
                const { notifications } = await antwort.json();
                let weg = 0;
                for (const n of (notifications || [])) {
                    const gelesen = Object.keys(n.read_by || {}).length > 0;
                    const geklickt = Object.keys(n.dismissed_by || {}).length > 0;
                    if (!gelesen && !geklickt) continue;
                    const kennung = n.event_id || n.id;
                    if (!kennung) continue;
                    // Already cleared in an earlier round? Then don't
                    // send it through the whole chain again. `connect`
                    // fires on EVERY reconnect, and the server reports
                    // the same completed items again — without this line
                    // the same thirty ids would run through IPC to
                    // main.js and back again every time.
                    if (window.__dismissedNotificationIds
                        && window.__dismissedNotificationIds.has(kennung)) continue;
                    weg += _onDismissFromPeer({ id: kennung }) || 0;
                }
                // Counted is what actually left the screen here — not
                // what the server considers done. At startup the
                // stack is empty, and no number belongs here then.
                if (weg) console.log(`🔄 ${weg} Meldung(en) waren anderswo schon erledigt`);
                // Restoring is done by the stack module — it lives on EVERY
                // page, this connector only on the start page.
                if (window.NotificationStack && window.NotificationStack.holeOffene) {
                    window.NotificationStack.holeOffene();
                }
            } catch (_) { /* without reconciliation it falls back to the old behavior */ }
        }

        socket.on('notification_dismissed', _onDismissFromPeer);
        socket.on('notification_read', _onDismissFromPeer);

        // HMS Update Handler
        socket.on('hms_update', function(data) {
            console.log('📡 HMS Update received:', data);
            serverDismissedHMSErrors = data.dismissed_errors || [];

            // Update banner display
            const banner = document.getElementById('hms-error-banner');
            if (!banner) return;

            const currentErrorCode = banner.dataset.errorCode;
            const activeErrors = data.active_errors || [];

            // Hide banner when:
            // 1. No more active errors OR
            // 2. The currently shown error was dismissed
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
                window.socketReconnecting = true;  // Set flag
                console.error(texts.console_socket_not_connected);
                // Manual connect attempt
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

    // stage.* → texts.stage_* (STATUS_CONTRACT §4/§7). Empty/no key → ''.
    translateStageKey(key) {
        if (!key || typeof key !== 'string' || !key.startsWith('stage.')) return '';
        const texts = window.texts || {};
        return texts[key.replace(/\./g, '_')] || key;
    }

    // Stage text to show, built from stage_code + stage_custom (Decision A):
    // known code → translated; manual_setup → "Code · Instruction"; otherwise raw.
    stageLabel(data) {
        const custom = (data.stage_custom || '').trim();
        if (data.stage_code) {
            const t = this.translateStageKey(data.stage_code);
            return custom ? (t + ' · ' + custom) : t;
        }
        return custom;
    }

    /**
     * Printer graphic on the card: fill in badges, switch the glow.
     *
     * Chamber/bed/active nozzle come live from the socket. The two
     * individual nozzles are supplied by /api/status (printerControlManager.lastState)
     * — the poll runs anyway, its cadence is enough for temperatures.
     */
    /** Print actions (Bambu): ⏸/▶/■ depending on state — on the
     *  print card (pcb-*) and in the control overview (ov-*). */
    updatePcbActions(data) {
        const st = data.gcode_state;
        const laufend = st === 'RUNNING' || st === 'PREPARE';
        const pausiert = st === 'PAUSE';
        const zeig = (id, an) => {
            const e = document.getElementById(id);
            if (e) e.style.display = an ? '' : 'none';
        };
        // Print card: small round buttons with wrapper.
        zeig('pcb-actions', laufend || pausiert);
        zeig('pcb-pause', laufend);
        zeig('pcb-resume', pausiert);
        // Control overview: action cards directly in the grid.
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
            // Icon image is in the markup; only swap the text next to the image.
            const txt = mitZiel(data.bed_temp, data.bed_target);
            bed.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = txt; });
            // Gone entirely without a reading — like the chamber one line above.
            // Otherwise a bed icon with "--" sticks around on a powered-off printer.
            bed.style.display = (data.bed_temp != null) ? '' : 'none';
        }

        // Individual nozzles from the /api/status state (keys: 1=left, 0=right)
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
                // Write even WITHOUT values, otherwise the old text stays:
                // on a powered-off printer this used to stick at "L 37° R 37°",
                // while bed and chamber already showed "--" (20aug26).
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

        // Only show the second nozzle if the printer really reports two.
        const zweite = document.getElementById('pv-nozzle-r-col');
        if (zweite) zweite.style.display = dual ? '' : 'none';

        this._zeigeMaschinenbild(data);
        this._zeigeAmsAnbau(data);
        // Hotend rack (H2C). The card hides itself when the
        // printer doesn't report any rack slots.
        if (window.hotendRackCard) window.hotendRackCard.aktualisieren(data);

        // Clicking the preview opens this print's history entry.
        const vorschau = document.getElementById('titelbild-container');
        if (vorschau) {
            // The preview stays up after the print — then the click should
            // keep leading to the most recently finished entry.
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

        // Save status for the next comparison
        const previousState = window.lastPrintState;
        window.lastPrintState = data.gcode_state;
        window.lastPrintData = data;


        // Up to 20aug26 the body sat here as one 535-line block. That very
        // lack of overview is what let it slip that the button- and
        // device-display hung off a completely different source — the bug
        // that surfaced when the poll was switched off.
        //
        // previousState gets passed through: the one value that
        // several sections need in common.
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

    /** Power-off timer: header, settings window, countdown */
    _zeigeAbschaltTimer(data, previousState) {
        const texts = window.texts || {};
        // Process power-off timer (if included in print_progress)
        if (data.power_off_timer) {
            const statusDiv = document.getElementById('power-off-status');
            const headerTimer = document.getElementById('power-off-header');

            if (data.power_off_timer.active) {
                // Settings modal status
                if (statusDiv) {
                    statusDiv.style.display = 'block';
                    const reasonEl = document.getElementById('power-off-reason');
                    if (reasonEl) reasonEl.textContent = data.power_off_timer.reason;
                }

                // Show header timer
                if (headerTimer) {
                    headerTimer.style.display = 'inline-block';
                }

                // Update countdown
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

                        // Change color when time is low
                        if (minutes < 1) {
                            headerTimer.style.color = '#ff4444';  // Red
                        } else if (minutes < 5) {
                            headerTimer.style.color = '#ff9800';  // Orange
                        } else {
                            headerTimer.style.color = '#ffc107';  // Yellow
                        }
                    }

                    if (remaining > 0) {
                        requestAnimationFrame(updateCountdown);
                    }
                };

                updateCountdown();

            } else {
                // Timer deactivated - clean up UI
                if (statusDiv) {
                    statusDiv.style.display = 'none';
                }
                if (headerTimer) {
                    headerTimer.style.display = 'none';
                }
            }
        }
    }

    /** Reset the homing button once homing is done */
    _zeigeHomingKnopf(data, previousState) {
        const texts = window.texts || {};
        // Reset homing button once homing is complete (home_flag > 0)
        if (data.home_flag && data.home_flag > 0) {
            const homingBtnMobile = document.getElementById('homing-btn-mobile');
            const homingBtnDesktop = document.getElementById('homing-btn-desktop');

            // Only reset if the button currently shows "Running..."
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

    /** Progress bar and percentage */
    _zeigeFortschritt(data, previousState) {
        const texts = window.texts || {};
        // ========== Progress Bar + Percentage (HelixScreen-Layout) ==========
        const progressPercentage = document.getElementById('progress-percentage');
        if (progressPercentage) progressPercentage.textContent = Math.round(data.progress) + '%';

        const barFill = document.getElementById('progress-card-bar-fill');
        if (barFill) barFill.style.width = (data.progress || 0) + '%';
    }

    /** Layers, filament used, objects */
    _zeigeSchichten(data, previousState) {
        const texts = window.texts || {};
        // ========== Layer / Filament-Used / Objects ==========
        const layerValue = document.getElementById('layer-value');
        if (layerValue) {
            const layerTxt = `Layer ${data.layer_num || '--'}/${data.total_layers || '--'}`;
            // Append Z height inline when Klipper
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

    /** Time series: elapsed, remaining, end, percent */
    _zeigeZeiten(data, previousState) {
        const texts = window.texts || {};
        // ========== Time series: elapsed · remaining · ETA · % ==========
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
            // ETA = now + remaining time, computed client-side (like Android/KlipperStatusMapper).
            // eta_time from the server is empty in Direct mode → derive it locally
            // from remaining_time (minutes), so it matches the device clock and ticks without a server round trip.
            let _eta = data.eta_time;
            if (!_eta && data.remaining_time > 0) {
                _eta = new Date(Date.now() + data.remaining_time * 60000)
                    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            etaInline.textContent = _eta ? ` ~${_eta}` : '';
        }
    }

    /** Temperature card: nozzle, bed, chamber */
    _zeigeTemperaturen(data, previousState) {
        const texts = window.texts || {};
        // ========== Temperature card (nozzle / bed / chamber) ==========
        const nA = document.getElementById('temp-nozzle-actual');
        const nT = document.getElementById('temp-nozzle-target');
        if (nA) nA.textContent = (data.nozzle_temp != null) ? data.nozzle_temp.toFixed(1) : '--';
        if (nT) nT.textContent = (data.nozzle_target != null) ? Math.round(data.nozzle_target) : '--';

        // Active nozzle (X2D/H2D): 1 = left, 0 = right. Field missing on
        // single-nozzle devices — the badge just stays hidden then.
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
                // Sensor chamber (e.g. AHT20): temp + humidity instead of target (like Android).
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
                // Chamber without a target (no heater, or heater switched off): just the
                // actual value. "/ 0°C" otherwise reads like a fault.
                if (unitEl) unitEl.style.display = '';
                if (tWrap) tWrap.style.display = 'none';
                if (humEl) humEl.style.display = 'none';
            }
        } else if (cRow) {
            cRow.style.display = 'none';
        }
    }

    /** Printer view in display style */
    _zeigeDruckerAnsicht(data, previousState) {
        const texts = window.texts || {};
        // ========== Printer view (X2D display style) ==========
        this.updatePrinterVisual(data);

        // Status pills (Ready / Heating / Cooling / Off)
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

        // Per-fan row
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
        // Separator only visible when both neighbors are present
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
            // These four names exist as keys, ever since the
            // speed window started using them (speed-modal.js) -- before that
            // they sat here hardcoded in German.
            const st = window.texts || {};
            const speedName = Number.isFinite(speedPercent)
                ? (speedPercent <= 75 ? (st.speed_silent || 'Leise')
                    : speedPercent <= 112 ? (st.speed_standard || 'Standard')
                    : speedPercent <= 145 ? (st.speed_sport || 'Sport')
                    : (st.speed_ludicrous || 'Verrückt'))
                : (data.speed_level_text || st.speed_standard || 'Standard');
            speedValue.textContent = `${speedName} (${speedPercent}%)`;
        }
    }

    /** Show the attached AMS next to the printer */
    /** The print card's device image for the configured model.
     *
     *  Until 26aug26 the template hardcoded `x2d.png` — only correct for exactly
     *  one device. The identifier comes from the capabilities (`model_id`), which
     *  the server builds from the profile; the files are named after the identifier
     *  in lowercase.
     */
    _zeigeMaschinenbild(data) {
        const bild = document.getElementById('pv-machine-img');
        if (!bild) return;
        // Straight from the status packet: window.lastPrintData isn't set
        // until further below and still carries the previous one here.
        const caps = (data && data.capabilities) || {};
        const kennung = (caps.model_id || '').toLowerCase();
        if (!kennung) return;              // no model set: leave the old image as is
        const quelle = `/static/img/printers/${kennung}.png`;
        if (bild.dataset.modell === kennung) return;
        bild.dataset.modell = kennung;
        // If the image doesn't exist, keep the current one instead of a
        // broken icon.
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

        // Show the first reported unit. Several side by side would be
        // too narrow next to printer and nozzle — the material zone lists all of them anyway.
        const e = einheiten[0];
        const ht = String(e.model || '').toUpperCase().includes('HT');
        const quelle = ht ? '/static/img/ams/ams_ht.png' : '/static/img/ams/ams.png';
        if (bild && bild.getAttribute('src') !== quelle) {
            bild.setAttribute('src', quelle);
            bild.alt = e.model || 'AMS';
        }

        // Put humidity and temperature underneath — for the AMS HT these are
        // the interesting values, since it heats.
        if (schild) {
            const teile = [];
            if (e.humidity != null) teile.push(Math.round(e.humidity) + '%');
            if (e.temperature != null) teile.push(Math.round(e.temperature) + '\u00b0');
            schild.textContent = teile.join(' \u00b7 ');
            schild.hidden = teile.length === 0;

            // Clicking humidity/temperature opens drying — the same
            // dialog as the button in the material zone. Only for devices
            // that can actually dry (AMS 2 Pro / AMS HT).
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

    /** Bed-mesh heatmap (Klipper) and filename */
    _zeigeBedMesh(data, previousState) {
        const texts = window.texts || {};
        // ============ Bed-mesh heatmap (Klipper) ============
        // Delivered via /api/status (NOT in the SocketIO klipper_state
        // event — too big for a 1Hz push). data.bed_mesh is {matrix, mesh_min,
        // mesh_max, profile_name} or null. If null and we've already
        // rendered: do nothing (cache effect). If explicitly {matrix:null}:
        // hide it.
        if (data.bed_mesh && Array.isArray(data.bed_mesh.matrix)
            && data.bed_mesh.matrix.length > 0) {
            this._renderBedMeshHeatmap(data.bed_mesh);
        }

        const filamentValue = document.getElementById('filament-value');
        // Without a known filament, drop the whole chip instead of showing "--"
        // — same as bed and chamber in the printer image next to it.
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
                        // Full name — the CSS (text-overflow: ellipsis)
                        // only truncates when there's really no room. The hard
                        // 40-character limit was cutting it off despite free width.
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
                // Only toggle the IMAGE, never the container: it holds the
                // space so the printer doesn't shift left
                // while no thumbnail is available yet.
                titelbildImg.onload = () => titelbildImg.style.visibility = '';
                titelbildImg.onerror = () => titelbildImg.style.visibility = 'hidden';
            }
        } else if (data.gcode_state !== 'RUNNING' && data.gcode_state !== 'PREPARE') {
            titelbildImg.style.visibility = 'hidden';
        }

        // If a print is running without a preview image, there'd otherwise be an empty
        // gray box. For prints started directly from Bambu Studio, the 3MF sits in
        // the printer's internal storage — nobody can reach it there, not even
        // the Home Assistant integration. Instead of emptiness, show an icon with
        // the reason next to it.
        if (titelbildContainer) {
            const laeuft = data.gcode_state === 'RUNNING' || data.gcode_state === 'PREPARE';
            const hatBild = !!(newThumbnailData && newThumbnailData !== 'undefined');
            const zeigeLeer = laeuft && !hatBild;
            titelbildContainer.classList.toggle('kein-bild', zeigeLeer);
            // The print card's preview is about 110px — only the icon
            // fits there. The reason is in the tooltip and spelled out in
            // the history.
            // The click still opens the history — both hints
            // live in the tooltip, instead of one overwriting the other.
            const t = window.texts || {};
            const klickHinweis = data.current_print_id
                ? (t.history_open || 'Eintrag in der Historie öffnen') : '';
            const teile = [zeigeLeer ? (t.no_thumbnail_reason || '') : '', klickHinweis]
                .filter(Boolean);
            if (teile.length) titelbildContainer.title = teile.join('\n\n');
            else titelbildContainer.removeAttribute('title');
        }
    }

    /** Status text, pause/resume and filament-change buttons */
    _zeigeStatusUndAktion(data, previousState) {
        const texts = window.texts || {};
        // Status text logic
        const statusElement = document.getElementById('print-status');
        if (statusElement) {
            let statusText = texts.status_ready || 'Bereit';

            // Filament-change transition phase (after clicking "Done", ams_status=0x0107)
            // Takes about 40s while the printer does the final purge + retracts the nozzle.
            // Overrides both the PAUSE and RUNNING status during this time.
            const fcFinishing = data.filament_change_finishing ||
                (window.lastPrintData && window.lastPrintData.filament_change_finishing);

            if (data.gcode_state === 'IDLE') {
                statusText = this.translateStatusKey(data.display_text) || this.translateStatusKey(data.status_text) || texts.status_ready || 'Bereit zum Drucken';
            } else if (fcFinishing) {
                // Print resumes after filament change
                statusText = texts.status_filament_change_resuming || 'Druck wird fortgesetzt…';
                // Reset buttons as for RUNNING (we're coming from PAUSE)
                ['resume-btn-mobile', 'resume-btn-desktop', 'fc-retry-btn-mobile', 'fc-retry-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
                // display = '' → reset to CSS default (flex), not 'block'
                ['pause-btn-mobile', 'pause-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = '';
                });
            } else if (data.gcode_state === 'RUNNING') {
                statusText = this.translateStatusKey(data.status_text) || texts.status_printing || 'Druckt...';
                // Append stage (Soak/QGL/Mesh/Clean/...) from stage_code/stage_custom
                // (STATUS_CONTRACT §7). Producer has already filtered/classified it.
                const _stageR = this.stageLabel(data);
                if (_stageR) statusText = statusText + ' · ' + _stageR;
                // Reset Resume → Pause buttons (after PAUSE/color change)
                ['resume-btn-mobile', 'resume-btn-desktop', 'fc-retry-btn-mobile', 'fc-retry-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });
                // display = '' → reset to CSS default (flex), not 'block'
                ['pause-btn-mobile', 'pause-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = '';
                });
            } else if (data.gcode_state === 'PREPARE') {
                statusText = this.translateStatusKey(data.status_text) || texts.status_preparing || 'Vorbereitung...';
                // Stage from stage_code/stage_custom (STATUS_CONTRACT §7).
                const _stageP = this.stageLabel(data);
                if (_stageP) statusText = statusText + ' · ' + _stageP;
            } else if (data.gcode_state === 'PAUSE') {
                // Multi-color external-spool filament change?
                // Server delivers filament_change_phase:
                //   0 = normal pause
                //   1 = user should change filament → resume button sends load sequence
                //   2 = user should confirm loading → resume button sends ams_control done
                //                                    + retry button (own button) for M620 P255+P254
                // The backend endpoint /api/mqtt/print {command:"resume"} routes
                // automatically based on the phase — the resume button itself only
                // changes icon/text/color.
                const fcPhase = data.filament_change_phase ||
                    (window.lastPrintData && window.lastPrintData.filament_change_phase) || 0;

                if (fcPhase === 1) {
                    statusText = texts.status_filament_change_load || 'Filament wechseln';
                } else if (fcPhase === 2) {
                    statusText = texts.status_filament_change_confirm || 'Filament laden bestätigen';
                } else {
                    statusText = this.translateStatusKey(data.status_text) || texts.status_paused || 'Pausiert';
                }

                // Hide pause button
                ['pause-btn-mobile', 'pause-btn-desktop'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.style.display = 'none';
                });

                // Phase-specific labels for the resume button.
                // Icon + text are set SEPARATELY (icon in icon-span,
                // text in text-span). Translations deliberately contain
                // NO emoji — otherwise a duplicate icon in the button.
                let resumeIcon, resumeLabel, resumeClass;
                if (fcPhase === 1) {
                    resumeIcon = window.skIcon('runter');
                    resumeLabel = texts.filament_change_load || 'Filament laden';
                    resumeClass = 'control-btn info';        // blue
                } else if (fcPhase === 2) {
                    resumeIcon = window.skIcon('haken');
                    resumeLabel = texts.filament_change_done || 'Fertig';
                    resumeClass = 'control-btn success';     // green
                } else {
                    resumeIcon = window.skIcon('start');
                    resumeLabel = texts.resume || 'Fortsetzen';
                    resumeClass = 'control-btn success';     // green
                }

                // Show resume button + set icon/text/color.
                // IMPORTANT: display = '' (CSS reset), not 'block' —
                // .control-btn has `display: flex` as its CSS default, which
                // is needed for icon+text alignment. 'block' would break
                // the flex layout.
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

                // Retry button ONLY visible in phase 2 (its own 6th button).
                ['mobile', 'desktop'].forEach(variant => {
                    const retryBtn = document.getElementById(`fc-retry-btn-${variant}`);
                    if (!retryBtn) return;
                    if (fcPhase === 2) {
                        retryBtn.style.display = '';   // reset to CSS flex
                        const retryText = document.getElementById(`fc-retry-text-${variant}`);
                        if (retryText) retryText.textContent = texts.filament_change_retry || 'Erneut versuchen';
                    } else {
                        retryBtn.style.display = 'none';
                    }
                });
            } else if (data.gcode_state === 'FINISH') {
                // If the print has only just finished, show an in-between status.
                if (previousState === 'RUNNING') {
                    statusText = texts.status_finishing || 'Wird abgeschlossen...';

                    setTimeout(() => {
                        // Check whether the status is still FINISH (and no new print was started)
                        if (window.lastPrintData && window.lastPrintData.gcode_state === 'FINISH') {
                            console.log('⏳ Timeout: resetting the UI to IDLE.');
                            this.handlePrintUpdate({ gcode_state: 'IDLE' }, 'timeout_reset');
                        }
                    }, 45000); // wait 45 seconds
                } else {
                    statusText = texts.status_print_completed || 'Fertig';
                }
            } else if (data.gcode_state === 'FAILED') {
                statusText = texts.status_print_failed || 'Fehler';
            }

            // A command has been sent and the printer is still carrying
            // it out.
            //
            // `gcode_state` has no such in-between value: during a pause in
            // progress it still reads RUNNING, and only once the head has
            // parked does it flip to PAUSE. In between, the button looks as
            // if it did nothing -- so it gets pressed again.
            //
            // The printer does say it though: `print.job.job_state`, turned
            // into `job_phase` by the server (printer_state.JOB_PHASES).
            // Studio reads the same field for exactly this.
            //
            // Without the field (P1/A1 never send it) the phase is null and
            // nothing happens here -- the old behaviour stands.
            const phase = data.job_phase
                || (window.lastPrintData && window.lastPrintData.job_phase) || null;
            const phasenText = {
                pausing: texts.status_pausing,
                resuming: texts.status_resuming,
                stopping: texts.status_stopping,
                starting: texts.status_starting,
                finishing: texts.status_finishing,
            };
            // Which button belongs to which phase. Starting and Finishing
            // are deliberately absent: there is nothing to lock there, the
            // text alone is enough.
            const phasenKnopf = {
                pausing: ['pause-btn-mobile', 'pause-btn-desktop'],
                resuming: ['resume-btn-mobile', 'resume-btn-desktop'],
                stopping: ['stop-btn-mobile', 'stop-btn-desktop'],
            };
            // Always release everything first, then set anew -- otherwise a
            // button would stay locked when the phase ends while the page
            // happens not to be looking.
            Object.values(phasenKnopf).flat().forEach(id => {
                const btn = document.getElementById(id);
                if (btn) btn.classList.remove('control-btn--laeuft');
            });
            if (phase) {
                // The text only when no more specific one is already there:
                // during a filament change the printer also reports
                // "resuming", but "Resuming print" says more than
                // "Resuming". The lock applies either way.
                if (phasenText[phase] && !fcFinishing) statusText = phasenText[phase];
                (phasenKnopf[phase] || []).forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.classList.add('control-btn--laeuft');
                });
            }

            // Status pill (HelixScreen): compact "Status: <State>" WITHOUT stage suffix.
            // ONE source = data.status_text (key, always set by the producer) →
            // translated, no trailing colon/dots appended. status_running is gone
            // (it was the "Running"-vs-"Printing" bug source). STATUS_CONTRACT §7.
            const statusTextElement = document.getElementById('print-status-text');
            if (statusTextElement) {
                // If the outlet is switched off, there's no status —
                // then the pill just stays hidden instead of claiming "Status: Ready" on a
                // printer that's powered off. Android does the
                // same thing (HomeViewModel.isPrinterOn hides the cards).
                // That it's off is already shown by the camera and printer button next to it.
                // Hide the whole pill, not just the text — it carries
                // the status dot and would otherwise be left as an empty gray
                // stub.
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

            // Pause/resume/cancel on the Bambu print card —
            // since the zone redesign the old control card no longer exists.
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

    /** Status dot and drying button */
    _zeigeKartenKnoepfe(data, previousState) {
        const texts = window.texts || {};
        // Disable filament-drying button while a print is running
        const startDryingBtn = document.getElementById('start-drying-btn');
        if (startDryingBtn) {
            // ONLY touch the label: setting textContent on the button
            // would throw away the icon next to it too. Fading and cursor
            // are handled by `.tr-knopf:disabled` in the stylesheet.
            const beschriftung = document.getElementById('start-drying-text');
            const druckt = data.gcode_state === 'RUNNING' || data.gcode_state === 'PREPARE';
            startDryingBtn.disabled = druckt;
            startDryingBtn.title = '';
            if (beschriftung) {
                beschriftung.textContent = druckt ? texts.drying_not_possible : texts.start_drying;
            }
        }

        this.applyHmsBanner(data);

        // Multi-color external-spool: no separate banner — the
        // pause/resume button (handlePrintUpdate above) adjusts its text
        // and behavior depending on filament_change_phase.
    }


    /**
     * Set the HMS banner. ONE version for both paths.
     *
     * Up to 20aug26 it was here nearly twice: once for the socket and once in
     * status-manager.applyStatus for the /api/status poll. Those were the
     * only four DOM elements the two blocks shared — and
     * they promptly diverged (only this version knew about the
     * synthetic Klipper code).
     */
    applyHmsBanner(data) {
        // Drawn in hms-banner.js — the same routine also used by
        // the console, history and settings. Only what exists ONLY on the
        // main page lives here: the acknowledgment list from
        // startup and the notice that it's already there.
        if (!window.HmsBanner) return;
        window.HmsBanner.zeichne(data, {
            geladen: hmsStatusLoaded,
            weggeklickt: (code) => isHMSErrorDismissed(code),
            aufraeumen: () => clearDismissedHMSErrors(),
        });
    }

    /**
     * Renders the Klipper bed_mesh matrix as a 3D isometric surface in
     * the SVG element `#bed-mesh-svg`. Color gradient blue→yellow→red (hue 240°→0°
     * via HSL). Z values are normalized to 0..1 and amplified by a factor
     * so that even small spreads (0.05-0.2 mm) are visible.
     *
     * Iso projection: 30° X + 30° Y. Quads are drawn sorted
     * back-to-front (Painter's Algorithm) so the foreground is in front.
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
        // viewBox 200x140 — wide enough for the tilted grid.
        svg.setAttribute('viewBox', '0 0 200 140');
        const VW = 200, VH = 140;

        // Iso axes (30° tilt, 30° rotation)
        const cos30 = Math.cos(Math.PI / 6);
        const sin30 = Math.sin(Math.PI / 6);

        // Grid span in world coordinates (centered). Derive the aspect ratio from the
        // REAL mesh area (mesh_min/mesh_max), otherwise an adaptive
        // mesh (e.g. wide & flat) would falsely look square like a full mesh.
        const gridSize = 110;                   // longer world axis
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
        const zScale = 25;                      // height scaling
        const cx = VW / 2;                      // world origin on canvas
        // cy centers the mesh. Iso span for gx+gy ∈ [-gridSize, +gridSize]
        // gives a vertical range of ±gridSize*sin30 = ±55px plus a z swing
        // of ±zScale*0.5 = ±12.5px. With VH=140, cy=VH/2 fits perfectly:
        // top  = 70 - 67.5 = +2.5
        // bot  = 70 + 67.5 = 137.5
        // (Previously cy = VH/2+25 → bottom corner @ 162 → clipped).
        const cy = VH / 2;

        const project = (gx, gy, z) => {
            // gx/gy: grid coordinates centered (-gridSize/2 ... +gridSize/2)
            // Iso: sx = (x - y) * cos30; sy = (x + y) * sin30 - z
            const sx = cx + (gx - gy) * cos30;
            const sy = cy + (gx + gy) * sin30 - z * zScale;
            return [sx, sy];
        };

        // Precompute vertices (rows x cols)
        const verts = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < cols; c++) {
                const v = matrix[r][c];
                if (typeof v !== 'number') { row.push(null); continue; }
                // Flip Y — bed Y=0 is at the bottom in world space, SVG Y=0 at the top in pixels.
                // (This is the CORRECT orientation, matching Mainsail.)
                const gx = -worldW / 2 + c * stepX;
                const gy = +worldH / 2 - r * stepY;
                const tz = (v - vmin) / spread;            // 0..1
                const z = tz - 0.5;                         // -0.5..+0.5 (centered)
                const [sx, sy] = project(gx, gy, z);
                row.push({ sx, sy, gx, gy, z, t: tz, v });
            }
            verts.push(row);  // <-- the missing push
        }

        // Build quads (rows-1) x (cols-1), with color = avg(z) and a depth key
        // (gx+gy at the quad midpoint) for the painter's sort.
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
                // Depth key: quads with a high (gx+gy) lie further in FRONT
                // (positive Y points FORWARD in iso), so a smaller key
                // means further BACK — those get drawn first.
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
        // Painter's: back first (smallest depth = furthest back in iso)
        quads.sort((x, y) => x.depth - y.depth);

        // ===== Render =====
        // First, faint grid axes (wireframe floor) as a reference frame.
        const corners = [
            project(-gridSize / 2, +gridSize / 2, -0.5),  // front-left
            project(+gridSize / 2, +gridSize / 2, -0.5),  // front-right
            project(+gridSize / 2, -gridSize / 2, -0.5),  // back-right
            project(-gridSize / 2, -gridSize / 2, -0.5),  // back-left
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

            // IMPORTANT: prevent multiple executions
            if (window.socketReconnectInProgress) {
                console.log('⏸️ Socket reconnect already in progress');
                return;
            }

            // Throttle stays in effect
            if (now - this.lastVisibilityChange < 3000) {
                console.log('⏸️ Visibility change throttled');
                return;
            }
            this.lastVisibilityChange = now;

            if (document.hidden) {
                // Tab hidden - socket/polling cleanup (stream is managed by handler 1)
                console.log('📱 Tab versteckt - Socket Cleanup');

                if (window.statusUpdateInterval) {
                    clearInterval(window.statusUpdateInterval);
                    window.statusUpdateInterval = null;
                }

            } else if (!document.hidden) {
                // Tab visible - reconnect ONLY ONCE
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

                    // Try a normal reconnect
                    window.socket.connect();

                    // Wait LONGER - 3 seconds instead of 2
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    if (!window.socket.connected) {
                        console.log('❌ Reconnect failed - creating a new socket');

                        // Kill the old one COMPLETELY
                        if (window.socket) {
                            window.socket.removeAllListeners();
                            window.socket.offAny();
                            if (window.socket.io) {
                                window.socket.io.opts.reconnection = false;  // Stop reconnection
                                window.socket.io._reconnection = false;
                                window.socket.io.disconnect();
                            }
                            window.socket.disconnect();
                            delete window.socket;  // instead of = null
                            window.socket = null;
                        }

                        // Wait EVEN longer
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // Create a new one
                        window.socket = io({
                            transports: ['websocket', 'polling'],
                            upgrade: true,
                            reconnection: false,  // OFF FOR NOW!
                            timeout: 15000,       // Longer timeout
                            forceNew: true,
                            auth: (cb) => {
                                const token = localStorage.getItem('access_token');
                                console.log('🔑 Token for the new socket:', !!token);
                                cb({ token: token });
                            }
                        });

                        // Wait for connection
                        window.socket.once('connect', () => {
                            console.log('✅ NEW socket connected:', window.socket.id);
                            // Now re-enable reconnection
                            window.socket.io.opts.reconnection = true;
                        });

                        window.socket.once('connect_error', (error) => {
                            console.log('❌ New socket error:', error.message, error.type);
                        });

                        // Check after 5 seconds
                        setTimeout(() => {
                            if (!window.socket.connected) {
                                console.log('❌ New socket not connected after 5s');
                                // Fallback: reload the page
                                showConfirmDialog(texts.confirm_reload_page, function() {
                                    location.reload();
                                });
                            }
                        }, 5000);
                    }
                }

                // Stream is managed by handler 1 (PAGE VISIBILITY) - not here!

                if (!window.statusUpdateInterval) {
                    // Fetch once immediately, so the UI doesn't wait for the
                    // first push right after becoming visible.
                    // After that, only poll as a fallback — the socket
                    // already carries the full state by then (see app-init.js).
                    loadEverything();
                    window.statusUpdateInterval = setInterval(() => {
                        const online = window.socket && window.socket.connected
                                       && window.lastMqttStatus === true;
                        if (!online) loadEverything();
                    }, 8000);
                }

                // Reset flag
                window.socketReconnectInProgress = false;
            }
        });
    }

    _setupSafariPWAFocusHandler() {
        // Safari PWA: ONLY for the camera, NOT for the socket!
        // The old Safari PWA focus handler is gone: dataset.oldSrc was never
        // set anywhere (dead code), and resuming the camera belongs
        // solely to camera-manager (docs/kamera-architektur.md).
    }

    _setupBeforeUnloadHandler() {
        // Browser-close detection - cleanly close the WebSocket
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
