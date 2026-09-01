// Globaler Auth Handler für automatisches Token Management
// SECURITY: Verwendet ausschließlich HttpOnly Cookies (kein localStorage für Tokens)
class AuthHandler {
    constructor() {
        this.refreshInterval = null;
        this.activityTimeout = null;
        this.isRefreshing = false;

        // === GET REQUEST DEDUPLICATION ===
        // Kurz-lebiger Cache für GET-Requests. Beim Page-Startup feuern
        // manche Endpoints (z.B. /api/status, /api/config) 2-4x parallel/kurz
        // hintereinander von verschiedenen Init-Codepaths. Der Cache hält die
        // fetch-Promise für STARTUP_DEDUP_TTL_MS und gibt bei weiteren Calls
        // einen Clone zurück. Danach wird normal gefetched.
        // Opt-out pro Call via { noDedup: true } in options.
        this._pendingGets = new Map();  // url → Promise<Response>
        this.STARTUP_DEDUP_TTL_MS = 2000;

        // Prüfe ob CSRF Token in sessionStorage fehlt (z.B. nach Tab-Neustart)
        this.ensureCsrfToken();

        // Token alle 10 Minuten refreshen (vor den 480 Min Ablauf)
        this.startTokenRefresh();

        // Activity tracking
        this.trackUserActivity();
    }

    async ensureCsrfToken() {
        // Wenn sessionStorage leer ist aber localStorage ein Token hat,
        // könnte das Token serverseitig abgelaufen sein -> proaktiv refreshen
        const sessionCsrf = sessionStorage.getItem('csrf_token');
        const localCsrf = localStorage.getItem('csrf_token');

        if (!sessionCsrf && localCsrf) {
            console.log('🔄 CSRF token only in localStorage - refreshing proactively...');
            await this.refreshToken();
        } else if (!sessionCsrf && !localCsrf) {
            // Kein Token vorhanden - versuche Refresh (falls Cookie noch gültig)
            console.log('🔄 No CSRF token found - trying a refresh...');
            await this.refreshToken();
        }
    }

    /**
     * Holt einen frischen CSRF-Token, ohne die Sitzung anzufassen.
     *
     * Nach einem Serverneustart kann der Browser noch einen Token halten,
     * den der Server nicht mehr kennt — die erste schreibende Aktion lief
     * deshalb ins
     * 403 (20aug26 siebenmal im Log). Sie wurde zwar automatisch wiederholt
     * und klappte dann, kostete aber je einen verworfenen Umlauf.
     *
     * Bewusst NICHT refreshToken(): der rotiert den Refresh-Token und
     * loescht alle CSRF-Token des Nutzers — zwei offene Tabs koennten sich
     * damit gegenseitig abmelden.
     */
    async erneuereCsrfToken(sofort = false) {
        // Hoechstens einmal pro Minute. Der Aufruf haengt am Socket-Connect,
        // und der kann stuermen: am 20aug26 verband sich der Socket mehrmals
        // pro SEKUNDE neu, jeder Connect holte einen Token — nach 60 Aufrufen
        // griff die Anmelde-Sperre ("Too many attempts. Please wait 5
        // minutes.") und die Oberflaeche stand.
        //
        // Fuer den eigentlichen Zweck reicht das voellig: nach einem
        // Serverneustart genuegt EIN frischer Token. Alles Weitere faengt
        // ohnehin die 403-Wiederholung in apiCall ab.
        // Der Zeitstempel MUSS das Neuladen ueberleben: bei jedem Reload
        // entsteht eine neue AuthHandler-Instanz, ein Feld am Objekt waere
        // also sofort wieder leer — und genau Reloads waren der Ausloeser
        // (Seite mehrfach neu geladen beim Testen).
        const jetzt = Date.now();
        const zuletzt = parseInt(localStorage.getItem('csrf_geholt') || '0', 10);
        if (!sofort && zuletzt && jetzt - zuletzt < 60000) return true;
        localStorage.setItem('csrf_geholt', String(jetzt));
        try {
            const r = await fetch('/api/auth/csrf', {
                method: 'POST', credentials: 'include'
            });
            if (!r.ok) return false;
            const d = await r.json();
            if (!d.csrf_token) return false;
            sessionStorage.setItem('csrf_token', d.csrf_token);
            localStorage.setItem('csrf_token', d.csrf_token);
            return true;
        } catch (e) {
            return false;
        }
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
        const msg = 'Sie waren 60 Minuten inaktiv. Möchten Sie angemeldet bleiben?';
        const onResult = (stay) => {
            if (stay) { this.refreshToken(); this.resetInactivityTimer(); }
            else { this.logout(); }
        };
        if (window.skConfirm) window.skConfirm(msg).then(onResult);
        else onResult(confirm(msg));
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
        const method = (options.method || 'GET').toUpperCase();
        const shouldDedup = method === 'GET' && !options.noDedup;

        // GET-Dedup: Wenn bereits eine fetch-Promise für diese URL läuft
        // (oder in den letzten 2 Sekunden lief), geben wir einen Clone zurück.
        if (shouldDedup && this._pendingGets.has(url)) {
            try {
                const cached = await this._pendingGets.get(url);
                return cached.clone();
            } catch (_) {
                // Gecachter Request ist gefehlt → normal weitermachen (fällt durch)
            }
        }

        const fetchPromise = this._doApiCall(url, options);

        if (shouldDedup) {
            // In Cache ablegen. Nach TTL wieder löschen, damit nachfolgende
            // Calls frische Daten holen.
            this._pendingGets.set(url, fetchPromise);
            fetchPromise
                .catch(() => {})
                .finally(() => {
                    setTimeout(() => {
                        if (this._pendingGets.get(url) === fetchPromise) {
                            this._pendingGets.delete(url);
                        }
                    }, this.STARTUP_DEDUP_TTL_MS);
                });
            // Der erste Caller bekommt auch einen Clone, damit der "Original"-
            // Response im Cache für spätere Poolers weiter klonbar bleibt.
            try {
                const r = await fetchPromise;
                return r.clone();
            } catch (e) {
                throw e;
            }
        }

        return fetchPromise;
    }

    async _doApiCall(url, options = {}) {
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

        // Stabile Web-Device-ID für Notification-Read/Dismiss:
        // Ohne diese würde der Server als Fallback die letzten 12 Zeichen
        // des access_token-Cookies nehmen — der rotiert aber bei jedem
        // Refresh, also wäre `is_dismissed_here` nach einer Rotation wieder
        // false und dismissed Notifications blinken erneut als ungelesen auf.
        // Einmal pro Browser generieren, in localStorage cachen, immer mitsenden.
        let webDeviceId = localStorage.getItem('web_device_id');
        if (!webDeviceId) {
            const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
            webDeviceId = `web_${rnd}`;
            localStorage.setItem('web_device_id', webDeviceId);
        }
        options.headers['X-Device-Id'] = webDeviceId;

        // CSRF Token für POST, PUT, DELETE (nur wenn kein Device Token vorhanden)
        const schreibend = !!options.method
            && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase());
        let token = csrfToken;

        // Kein Token im Speicher? Dann erst einen holen, statt die Anfrage
        // ohne Kopfzeile loszuschicken und am 403 zu scheitern. In der
        // Electron-App war der sessionStorage nach einem Fensterwechsel leer,
        // in localStorage stand ein Token von vor dem Serverneustart — die
        // Geraeteliste der Steckdose kam deshalb nie an (21aug26).
        if (!deviceToken && schreibend && !token) {
            await this.erneuereCsrfToken(true);
            token = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token');
        }

        if (!deviceToken && token && schreibend) {
            options.headers['X-CSRF-Token'] = token;
        }

        let response = await fetch(url, {
            ...options,
            credentials: 'include'  // WICHTIG: Sendet Cookies automatisch mit
        });

        // Bei 401 oder 403 (CSRF invalid) einmal Token refreshen und wiederholen
        // 403 mit CSRF-Fehler = Token abgelaufen, Refresh liefert einen neuen
        if ((response.status === 401 || response.status === 403) && !options._retry) {
            // 403 heisst fast immer: CSRF-Token veraltet. Den zu erneuern ist
            // billig und laesst die Sitzung in Ruhe; erst wenn das nichts
            // bringt, den Refresh-Token rotieren.
            let refreshed = false;
            if (response.status === 403 && schreibend && !deviceToken) {
                refreshed = await this.erneuereCsrfToken(true);
            }
            if (!refreshed) refreshed = await this.refreshToken();
            if (refreshed) {
                // Neuer Versuch mit refreshtem Cookie und neuem CSRF Token
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

// Die Instanz selbst freigeben. Mehrere Stellen in socket-manager.js fragen
// window.authHandler ab (PWA-Sitzungswiederherstellung, checkAndRefreshToken,
// seit 20aug26 auch das Erneuern des CSRF-Tokens) — die Zuweisung fehlte
// aber, alle Abfragen liefen also gegen undefined und die Zweige waren
// stumm tot. Die Pruefungen dort sind mit && abgesichert, deshalb ist es
// nie aufgefallen.
window.authHandler = authHandler;
