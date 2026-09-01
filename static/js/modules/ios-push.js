/**
 * iOS Push Notification Manager
 * Handles Web Push setup for iOS PWA mode
 */
class IOSPushManager {
    constructor() {
        // Inject CSS animation for install hint
        const style = document.createElement('style');
        style.textContent = `
        @keyframes slideUp {
            from { transform: translateY(100px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }`;
        document.head.appendChild(style);

        // Setup on DOM ready
        document.addEventListener('DOMContentLoaded', () => {
            // Warte auf Auth Handler Initialisierung
            if (typeof authHandler !== 'undefined') {
                // Check ob eingeloggt
                const checkAuthAndSetupPush = async () => {
                    const token = localStorage.getItem('access_token');
                    if (token) {
                        // Warte kurz bis alles geladen ist
                        setTimeout(() => {
                            this.setup();
                        }, 1000);
                    }
                };
                checkAuthAndSetupPush();
            }

            // Listen für Login Events
            window.addEventListener('user-logged-in', () => {
                console.log('[Push] User logged in - Setup Push');
                this.setup();
            });

            // Listen für Logout Events
            window.addEventListener('user-logged-out', () => {
                console.log('[Push] User logged out - Cleanup Push');
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.ready.then(reg => {
                        reg.pushManager.getSubscription().then(sub => {
                            if (sub) sub.unsubscribe();
                        });
                    });
                }
            });
        });
    }

    async setup() {
        // ZUERST AUTH CHECK!
        const token = localStorage.getItem('access_token');
        if (!token) {
            console.log('[Push] not logged in - skipping push setup');
            return;
        }

        // Validiere Token
        try {
            const authCheck = await apiCall('/api/auth/keepalive', {method: 'POST'});
            if (!authCheck.ok) {
                console.log('[Push] token invalid - skipping push setup');
                return;
            }
        } catch (error) {
            console.log('[Push] auth check failed:', error);
            return;
        }

        // Check if iOS and PWA
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone;

        if (!isIOS) return; // Nur für iOS

        if (!isPWA) {
            // Zeige Install-Hinweis für iOS
            if (!localStorage.getItem('ios_install_dismissed')) {
                this.showInstallHint();
            }
            return;
        }

        const texts = window.texts || {};

        // Register the service worker only where the browser calls the origin
        // secure -- see templates/index.html for why the host allowlist went.
        const _swValidSSL = window.isSecureContext;
        if ('serviceWorker' in navigator && 'PushManager' in window && _swValidSSL) {
            try {
                const registration = await navigator.serviceWorker.register('/static/sw.js');
                console.log('[Push] SW registered for iOS');

                // Check ob bereits subscribed
                const existingSubscription = await registration.pushManager.getSubscription();
                if (existingSubscription) {
                    console.log('[Push] Already subscribed');
                    return;
                }

                // Push Permission
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    // Subscribe
                    const subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: this._urlBase64ToUint8Array(window.JINJA_CONFIG.vapidPublicKey)
                    });

                    // An Server MIT AUTH senden
                    const response = await apiCall('/api/webpush/subscribe', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            subscription: subscription,
                            device_info: {
                                platform: 'iOS PWA',
                                userAgent: navigator.userAgent
                            }
                        })
                    });

                    if (response.ok) {
                        this.showNotification('Push aktiviert', 'success');
                    } else {
                        throw new Error('Subscribe failed');
                    }
                } else if (permission === 'denied') {
                    console.log('[Push] Permission denied by user');
                    this.showNotification('Push blockiert', 'error');
                }
            } catch (error) {
                console.error((texts.console_push_setup_failed || 'Push setup failed') + ':', error);
                // Cleanup bei Fehler
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (sub) await sub.unsubscribe();
            }
        }
    }

    showInstallHint() {
        const hint = document.createElement('div');
        hint.innerHTML = `
            <div style="position:fixed; bottom:20px; left:20px; right:20px;
                        background:var(--bg-card); border-radius:12px; padding:15px;
                        box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:9999;
                        animation: slideUp 0.3s ease-out;">
                <h3 style="margin:0 0 10px 0;">Als App installieren</h3>
                <p style="margin:0 0 10px 0; color:var(--text-secondary);">
                    Für Push-Benachrichtigungen auf iOS:
                </p>
                <ol style="margin:0 0 10px 0; padding-left:20px;">
                    <li>Tippe auf das Teilen-Symbol</li>
                    <li>${(window.texts||{}).ios_add_home || 'Wähle „Zum Home-Bildschirm"'}</li>
                    <li>${(window.texts||{}).ios_tap_add || 'Tippe auf „Hinzufügen"'}</li>
                </ol>
                <button onclick="this.parentElement.remove(); localStorage.setItem('ios_install_dismissed', 'true')"
                        style="background:var(--accent-green); color:white; border:none;
                               padding:8px 16px; border-radius:6px; cursor:pointer;">
                    Verstanden
                </button>
            </div>
        `;
        document.body.appendChild(hint);
    }

    showNotification(message, type) {
        // Einfache Console Notification
        console.log(`[Push] ${type || 'info'}: ${message}`);

        // Optional: Browser Notification falls verfügbar
        // ELECTRON: Keine Browser-Notifications - Electron nutzt FCM Push
        if (!window.electronAPI && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(message, {
                icon: '/static/icon-192x192.png'
            });
        }
    }

    _urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
}

// Global singleton
window.iosPushManager = new IOSPushManager();

// Backwards compatibility
window.setupIOSPush = () => window.iosPushManager.setup();
window.showIOSInstallHint = () => window.iosPushManager.showInstallHint();
window.showNotification = (msg, type) => window.iosPushManager.showNotification(msg, type);
window.urlBase64ToUint8Array = (b64) => window.iosPushManager._urlBase64ToUint8Array(b64);
