// Global auth handler for automatic token management
// SECURITY: Uses exclusively HttpOnly cookies (no localStorage for tokens)
class AuthHandler {
    constructor() {
        this.refreshInterval = null;
        this.activityTimeout = null;
        this.isRefreshing = false;

        // === GET REQUEST DEDUPLICATION ===
        // Short-lived cache for GET requests. On page startup some endpoints
        // (e.g. /api/status, /api/config) fire 2-4x in parallel/in quick
        // succession from different init code paths. The cache holds the
        // fetch promise for STARTUP_DEDUP_TTL_MS and returns a clone on
        // further calls. After that it fetches normally.
        // Opt out per call via { noDedup: true } in options.
        this._pendingGets = new Map();  // url → Promise<Response>
        this.STARTUP_DEDUP_TTL_MS = 2000;

        // Check whether the CSRF token is missing from sessionStorage (e.g. after a tab restart)
        this.ensureCsrfToken();

        // Refresh the token every 10 minutes (before the 480-minute expiry)
        this.startTokenRefresh();

        // Activity tracking
        this.trackUserActivity();
    }

    async ensureCsrfToken() {
        // If sessionStorage is empty but localStorage has a token,
        // that token may have expired server-side -> refresh it proactively
        const sessionCsrf = sessionStorage.getItem('csrf_token');
        const localCsrf = localStorage.getItem('csrf_token');

        if (!sessionCsrf && localCsrf) {
            console.log('🔄 CSRF token only in localStorage - refreshing proactively...');
            await this.refreshToken();
        } else if (!sessionCsrf && !localCsrf) {
            // No token present - try a refresh (in case the cookie is still valid)
            console.log('🔄 No CSRF token found - trying a refresh...');
            await this.refreshToken();
        }
    }

    /**
     * Fetches a fresh CSRF token without touching the session.
     *
     * After a server restart the browser can still hold a token the server no
     * longer knows — so the first write action runs into a
     * 403. It gets retried automatically and then succeeds, but each
     * time costs one wasted round trip.
     *
     * Deliberately NOT refreshToken(): that rotates the refresh token and
     * deletes all of the user's CSRF tokens — two open tabs could log each
     * other out that way.
     */
    async erneuereCsrfToken(sofort = false) {
        // At most once a minute. The call hangs off the socket connect,
        // which can storm — repeated reconnects each fetch a token, and
        // enough calls trip the login rate limit ("Too many attempts. Please wait 5
        // minutes.") and freeze the UI.
        //
        // For the actual purpose that's completely enough: after a server
        // restart, ONE fresh token suffices. Everything else is caught by the
        // 403 retry in apiCall anyway.
        // The timestamp MUST survive a reload: every reload creates a new
        // AuthHandler instance, so a field on the object would immediately be
        // empty again — and reloads are exactly what triggers repeated fetches.
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

        // SECURITY: Check whether a cookie is present
        // HttpOnly cookies cannot be read, but the browser sends them automatically
        // We simply make a test request
        try {
            const response = await fetch('/api/auth/me', {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                console.log('✅ PWA Session restored (Cookie valid)');
                return true;
            } else if (response.status === 401) {
                // Try a refresh
                console.log('🔄 PWA Cookie expired - attempting refresh...');
                return await this.refreshToken();
            }
        } catch (e) {
            console.error('PWA session check failed:', e);
        }

        // Fallback: try a refresh
        console.log('🔄 No valid PWA session - attempting refresh...');
        return await this.refreshToken();
    }

    async refreshToken() {
        // Prevent multiple concurrent refreshes
        if (this.isRefreshing) {
            // Wait for the ongoing refresh
            return new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (!this.isRefreshing) {
                        clearInterval(checkInterval);
                        // Check whether the refresh succeeded via a test request
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

                // Store the CSRF token (not sensitive)
                if (data.csrf_token) {
                    sessionStorage.setItem('csrf_token', data.csrf_token);
                    localStorage.setItem('csrf_token', data.csrf_token);
                }

                console.log('✅ Token refreshed successfully (via Cookie)');
                return true;
            } else if (response.status === 401) {
                // Refresh token expired -> go to login
                console.log('❌ Refresh token expired');
                this.redirectToLogin();
                return false;
            }
        } catch (error) {
            console.error('Token refresh error:', error);

            // On a network error in PWA: check whether the cookie is still there
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

        // Check every 10 minutes
        this.refreshInterval = setInterval(() => {
            this.checkAndRefreshToken();
        }, 10 * 60 * 1000);
    }

    async checkAndRefreshToken() {
        // SECURITY: We can't read HttpOnly cookies
        // Instead make a test request to check the status
        try {
            const response = await fetch('/api/auth/me', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-cache'
            });

            if (response.status === 401) {
                // Token expired or invalid
                console.log('🔄 Token expired - attempting refresh...');
                const refreshed = await this.refreshToken();
                if (!refreshed) {
                    this.redirectToLogin();
                }
            } else if (!response.ok) {
                console.warn('Token check failed:', response.status);
            }
            // On 200 OK: all good, nothing to do
        } catch (error) {
            console.error('Token check error:', error);
            // On a network error: don't redirect to login
        }
    }

    trackUserActivity() {
        // Reset inactivity timer on user activity
        ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => {
                this.resetInactivityTimer();
            });
        });

        // Start the initial timer
        this.resetInactivityTimer();
    }

    resetInactivityTimer() {
        clearTimeout(this.activityTimeout);

        // Warn after 60 minutes of inactivity
        this.activityTimeout = setTimeout(() => {
            this.showInactivityWarning();
        }, 60 * 60 * 1000);
    }

    showInactivityWarning() {
        const msg = (window.texts || {}).session_idle_ask
            || 'Du warst 60 Minuten inaktiv. Angemeldet bleiben?';
        const onResult = (stay) => {
            if (stay) { this.refreshToken(); this.resetInactivityTimer(); }
            else { this.logout(); }
        };
        if (window.skConfirm) window.skConfirm(msg).then(onResult);
        else onResult(confirm(msg));
    }

    async logout() {
        // Service worker cleanup in the background (do NOT wait!)
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

        // Continue immediately with logout (don't wait on the service worker!)
        try {
            // Logout API call - server deletes cookies
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('Logout API error:', error);
        }

        // Remove ALL auth data (except tokens - those are HttpOnly)
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        localStorage.removeItem('csrf_token');
        sessionStorage.removeItem('csrf_token');
        sessionStorage.clear();

        // Go straight to the login page
        this.redirectToLogin();
    }

    redirectToLogin() {
        clearInterval(this.refreshInterval);
        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
    }

    async apiCall(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const shouldDedup = method === 'GET' && !options.noDedup;

        // GET dedup: if a fetch promise for this URL is already running
        // (or ran in the last 2 seconds), we return a clone.
        if (shouldDedup && this._pendingGets.has(url)) {
            try {
                const cached = await this._pendingGets.get(url);
                return cached.clone();
            } catch (_) {
                // The cached request failed → continue normally (falls through)
            }
        }

        const fetchPromise = this._doApiCall(url, options);

        if (shouldDedup) {
            // Store it in the cache. Remove it again after the TTL so subsequent
            // calls fetch fresh data.
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
            // The first caller also gets a clone, so the "original"
            // response stays cloneable in the cache for later callers.
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

        // SECURITY: We no longer use an Authorization header
        // The token is sent automatically as an HttpOnly cookie

        // CSRF token for POST, PUT, DELETE
        const csrfToken = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token');

        // Extract the device token from the URL (for Android/iOS WebView)
        const urlParams = new URLSearchParams(window.location.search);
        const deviceToken = urlParams.get('device_token');

        if (deviceToken) {
            options.headers['X-Device-Token'] = deviceToken;
        }

        // Stable web device ID for notification read/dismiss:
        // without this, the server would fall back to the last 12 characters
        // of the access_token cookie — but that rotates on every
        // refresh, so `is_dismissed_here` would go back to false after a
        // rotation, and dismissed notifications would flash as unread again.
        // Generate once per browser, cache in localStorage, always send it.
        let webDeviceId = localStorage.getItem('web_device_id');
        if (!webDeviceId) {
            const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
            webDeviceId = `web_${rnd}`;
            localStorage.setItem('web_device_id', webDeviceId);
        }
        options.headers['X-Device-Id'] = webDeviceId;

        // CSRF token for POST, PUT, DELETE (only when there's no device token)
        const schreibend = !!options.method
            && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase());
        let token = csrfToken;

        // No token in memory? Then fetch one first, instead of sending the
        // request without a header and failing at 403.
        if (!deviceToken && schreibend && !token) {
            await this.erneuereCsrfToken(true);
            token = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token');
        }

        if (!deviceToken && token && schreibend) {
            options.headers['X-CSRF-Token'] = token;
        }

        let response = await fetch(url, {
            ...options,
            credentials: 'include'  // IMPORTANT: sends cookies automatically
        });

        // On 401 or 403 (CSRF invalid), refresh the token once and retry
        // 403 with a CSRF error = token expired, refresh provides a new one
        if ((response.status === 401 || response.status === 403) && !options._retry) {
            // 403 almost always means: the CSRF token is stale. Renewing it is
            // cheap and leaves the session alone; only rotate the refresh
            // token if that doesn't help.
            let refreshed = false;
            if (response.status === 403 && schreibend && !deviceToken) {
                refreshed = await this.erneuereCsrfToken(true);
            }
            if (!refreshed) refreshed = await this.refreshToken();
            if (refreshed) {
                // New attempt with the refreshed cookie and new CSRF token
                const newCsrf = sessionStorage.getItem('csrf_token') || localStorage.getItem('csrf_token');

                // Re-add the device token if present
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

// Initialize globally
const authHandler = new AuthHandler();

// Wrapper for easy use
window.apiCall = (url, options) => authHandler.apiCall(url, options);

// Expose the instance itself. Several places in socket-manager.js check
// window.authHandler (PWA session recovery, checkAndRefreshToken, and
// renewing the CSRF token).
window.authHandler = authHandler;
