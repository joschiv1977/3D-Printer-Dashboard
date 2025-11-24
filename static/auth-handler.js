// Globaler Auth Handler für automatisches Token Management
// SECURITY: Verwendet ausschließlich HttpOnly Cookies (kein localStorage für Tokens)
class AuthHandler {
    constructor() {
        this.refreshInterval = null;
        this.activityTimeout = null;
        this.isRefreshing = false;

        // Token alle 10 Minuten refreshen (vor den 480 Min Ablauf)
        this.startTokenRefresh();

        // Activity tracking
        this.trackUserActivity();
    }

    async restorePWASession() {
        const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;

        if (!isPWA) return true;

        console.log('🔄 PWA Session Recovery...');

        // SECURITY: Prüfe ob Cookie vorhanden ist
        // HttpOnly Cookies können nicht gelesen werden, aber Browser sendet sie automatisch
        // Wir machen einfach einen Test-Request
        try {
            const response = await fetch('/api/auth/me', {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                console.log('✅ PWA Session restored (Cookie valid)');
                return true;
            } else if (response.status === 401) {
                // Versuche Refresh
                console.log('🔄 PWA Cookie expired - attempting refresh...');
                return await this.refreshToken();
            }
        } catch (e) {
            console.error('PWA session check failed:', e);
        }

        // Fallback: Versuche Refresh
        console.log('🔄 No valid PWA session - attempting refresh...');
        return await this.refreshToken();
    }

    async refreshToken() {
        // Verhindere mehrfache gleichzeitige Refreshes
        if (this.isRefreshing) {
            // Warte auf laufenden Refresh
            return new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (!this.isRefreshing) {
                        clearInterval(checkInterval);
                        // Prüfe ob Refresh erfolgreich war durch Test-Request
                        fetch('/api/auth/me', { credentials: 'include' })
                            .then(r => resolve(r.ok))
                            .catch(() => resolve(false));
                    }
                }, 100);
            });
        }

        this.isRefreshing = true;

        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            if (response.ok) {
                const data = await response.json();

                // CSRF Token speichern (ist nicht sensitive)
                if (data.csrf_token) {
                    sessionStorage.setItem('csrf_token', data.csrf_token);
                    localStorage.setItem('csrf_token', data.csrf_token);
                }

                console.log('✅ Token refreshed successfully (via Cookie)');
                return true;
            } else if (response.status === 401) {
                // Refresh token abgelaufen -> zum Login
                console.log('❌ Refresh token expired');
                this.redirectToLogin();
                return false;
            }
        } catch (error) {
            console.error('Token refresh error:', error);

            // Bei Netzwerkfehler in PWA: Prüfe ob Cookie noch da ist
            if (window.matchMedia('(display-mode: standalone)').matches) {
                try {
                    const testResponse = await fetch('/api/auth/me', {
                        credentials: 'include',
                        cache: 'no-cache'
                    });
                    if (testResponse.ok) {
                        console.log('📱 PWA: Cookie still valid');
                        return true;
                    }
                } catch (e) {
                    console.error('PWA cookie test failed');
                }
            }
            return false;
        } finally {
            this.isRefreshing = false;
        }
    }

    startTokenRefresh() {
        // Initial check
        this.checkAndRefreshToken();

        // Check alle 10 Minuten
        this.refreshInterval = setInterval(() => {
            this.checkAndRefreshToken();
        }, 10 * 60 * 1000);
    }

    async checkAndRefreshToken() {
        // SECURITY: Wir können HttpOnly Cookies nicht lesen
        // Mache stattdessen Test-Request um Status zu prüfen
        try {
            const response = await fetch('/api/auth/me', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-cache'
            });

            if (response.status === 401) {
                // Token abgelaufen oder ungültig
                console.log('🔄 Token expired - attempting refresh...');
                const refreshed = await this.refreshToken();
                if (!refreshed) {
                    this.redirectToLogin();
                }
            } else if (!response.ok) {
                console.warn('Token check failed:', response.status);
            }
            // Bei 200 OK: Alles gut, nichts zu tun
        } catch (error) {
            console.error('Token check error:', error);
            // Bei Netzwerkfehler: Nicht zum Login redirecten
        }
    }

    trackUserActivity() {
        // Reset inactivity timer bei User-Aktivität
        ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => {
                this.resetInactivityTimer();
            });
        });

        // Initial timer starten
        this.resetInactivityTimer();
    }

    resetInactivityTimer() {
        clearTimeout(this.activityTimeout);

        // Nach 60 Minuten Inaktivität warnen
        this.activityTimeout = setTimeout(() => {
            this.showInactivityWarning();
        }, 60 * 60 * 1000);
    }

    showInactivityWarning() {
        if (confirm('Sie waren 60 Minuten inaktiv. Möchten Sie angemeldet bleiben?')) {
            this.refreshToken();
            this.resetInactivityTimer();
        } else {
            this.logout();
        }
    }

    async logout() {
        // ServiceWorker cleanup im Hintergrund (NICHT warten!)
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
                return reg.pushManager.getSubscription();
            }).then(sub => {
                if (sub) {
                    return sub.unsubscribe();
                }
            }).catch(error => {
                console.warn('ServiceWorker cleanup failed (non-blocking):', error);
            });
        }

        // Sofort weitermachen mit Logout (nicht auf ServiceWorker warten!)
        try {
            // Logout API Call - Server löscht Cookies
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('Logout API error:', error);
        }

        // ALLE Auth-Daten entfernen (außer Token - die sind HttpOnly)
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        localStorage.removeItem('csrf_token');
        sessionStorage.removeItem('csrf_token');
        sessionStorage.clear();

        // Sofort zur Login-Seite
        this.redirectToLogin();
    }

    redirectToLogin() {
        clearInterval(this.refreshInterval);
        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
    }

    async apiCall(url, options = {}) {
        // Ensure headers object exists
        options.headers = options.headers || {};

        // SECURITY: Wir verwenden KEINE Authorization Header mehr
        // Token wird automatisch als HttpOnly Cookie mitgesendet

        // CSRF Token für POST, PUT, DELETE
        const csrfToken = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token');

        // Device Token aus URL extrahieren (für Android/iOS WebView)
        const urlParams = new URLSearchParams(window.location.search);
        const deviceToken = urlParams.get('device_token');

        if (deviceToken) {
            options.headers['X-Device-Token'] = deviceToken;
        }

        // CSRF Token für POST, PUT, DELETE (nur wenn kein Device Token vorhanden)
        if (!deviceToken && csrfToken && options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase())) {
            options.headers['X-CSRF-Token'] = csrfToken;
        }

        let response = await fetch(url, {
            ...options,
            credentials: 'include'  // WICHTIG: Sendet Cookies automatisch mit
        });

        // Bei 401 einmal Token refreshen und wiederholen
        if (response.status === 401 && !options._retry) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                // Neuer Versuch mit refreshtem Cookie
                const newCsrf = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token');

                // Device Token wieder hinzufügen falls vorhanden
                if (deviceToken) {
                    options.headers['X-Device-Token'] = deviceToken;
                }

                if (!deviceToken && newCsrf && options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase())) {
                    options.headers['X-CSRF-Token'] = newCsrf;
                }

                options._retry = true;
                response = await fetch(url, {
                    ...options,
                    credentials: 'include'
                });
            }
        }

        return response;
    }
}

// Global initialisieren
const authHandler = new AuthHandler();

// Wrapper für einfache Verwendung
window.apiCall = (url, options) => authHandler.apiCall(url, options);
