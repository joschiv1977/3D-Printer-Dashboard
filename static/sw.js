const CACHE_NAME = 'printer-app-v6';
const STATIC_CACHE = 'static-v6';
const API_CACHE = 'api-cache-v6';

// The files to pre-cache
const STATIC_FILES = [
    '/static/auth-handler.js',
    '/static/icon-192x192.png',
    '/favicon.ico'
];

// Install Event
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker');

    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
            console.log('[SW] Caching static files');
            return cache.addAll(STATIC_FILES);
        }).catch(err => {
            console.error('[SW] Cache failed:', err);
        })
    );

    self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker');

    event.waitUntil(
        // Delete the old caches
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME &&
                        cacheName !== STATIC_CACHE &&
                        cacheName !== API_CACHE) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return clients.claim();
        })
    );
});

// The fetch event, with an auth check
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skipped for external requests
    if (url.origin !== location.origin) {
        return;
    }

    // API Requests - Auth required
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request.clone()).then(response => {
                // Bei 401 - Unauthorized
                if (response.status === 401) {
                    // Delete the auth-related caches
                    caches.delete(API_CACHE);

                    // Send a message to every client
                    clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'AUTH_EXPIRED',
                                timestamp: Date.now()
                            });
                        });
                    });

                    return response;
                }

                // Cache successful API responses (GET only)
                if (event.request.method === 'GET' && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(API_CACHE).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }

                return response;
            }).catch(() => {
                // Offline - try the cache
                return caches.match(event.request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Return offline response
                    return new Response(JSON.stringify({
                        error: 'Offline',
                        message: 'Keine Internetverbindung'
                    }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                });
            })
        );
        return;
    }

    // Static files - cache first (BUT NOT HTML!)
    if (url.pathname.startsWith('/static/')) {
        // ALWAYS load HTML files fresh from the server (network first).
        // cache:'no-store' forces past the HTTP cache -- without it the SW
        // fetch helped itself from the browser cache and served old pages
        // despite a reload.
        if (url.pathname.endsWith('.html')) {
            event.respondWith(
                fetch(event.request, { cache: 'no-store' }).then(fetchResponse => {
                    // Cache only successful responses, as the fallback
                    if (fetchResponse.status === 200) {
                        const responseClone = fetchResponse.clone();
                        caches.open(STATIC_CACHE).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return fetchResponse;
                }).catch(() => {
                    // Offline - try the cache
                    return caches.match(event.request).then(cachedResponse => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }
                        // Fallback: a valid error response (never null/undefined!)
                        return offlineSeite();
                    });
                })
            );
            return;
        }

        // Other static files (JS, CSS, images) - network first.
        // Cache-first served a file FOR EVER once it had been loaded -- with no
        // version change and no re-check. Safari and WebViews do not bypass the
        // service worker even on a hard reload, so changes never arrived there.
        // The server sits on the LAN, the trip over the network is cheap; the
        // cache stays as the offline fallback.
        event.respondWith(
            fetch(event.request).then(fetchResponse => {
                if (fetchResponse.status === 200) {
                    const responseClone = fetchResponse.clone();
                    caches.open(STATIC_CACHE).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return fetchResponse;
            }).catch(() => {
                return caches.match(event.request).then(cachedResponse => {
                    if (cachedResponse) return cachedResponse;
                    return new Response('', { status: 503 });
                });
            })
        );
        return;
    }

    // HTML Pages - Network First
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match('/static/offline.html');
            })
        );
    }
});

// The push event, with validation
self.addEventListener('push', (event) => {
    console.log('[SW] Push received:', event);

    // Ignore a push without data
    if (!event.data) {
        console.error('[SW] push without data - ignored');
        return;
    }

    const notificationPromise = (async () => {
        try {
            const data = event.data.json();

            // Validiere Struktur
            if (!data.notification_type) {
                console.error('[SW] Invalid push structure');
                return;
            }

            // Basis Notification Daten
            let notificationData = {
                title: '3D Drucker',
                body: data.body || 'Status Update',
                icon: '/static/icon-192x192.png',
                badge: '/static/favicon-32x32.png',
                vibrate: [100, 50, 100],
                tag: data.tag || 'printer-notification',
                renotify: true,
                requireInteraction: false,
                timestamp: Date.now(),
                data: {
                    url: data.url || '/',
                    notification_type: data.notification_type,
                    timestamp: Date.now()
                }
            };

            // Handle verschiedene Notification Types
            switch(data.notification_type) {
                case 'print_started':
                    notificationData.title = '🖨️ Druck gestartet';
                    notificationData.actions = [
                        { action: 'view', title: 'Anzeigen' },
                        { action: 'close', title: 'OK' }
                    ];
                    break;

                case 'print_completed':
                    notificationData.title = '✅ Druck abgeschlossen';
                    notificationData.requireInteraction = true;
                    notificationData.actions = [
                        { action: 'view', title: 'Details' },
                        { action: 'poweroff', title: 'Ausschalten' }
                    ];
                    break;

                case 'print_failed':
                    notificationData.title = '❌ Druck fehlgeschlagen';
                    notificationData.requireInteraction = true;
                    break;

                case 'filament_low':
                    notificationData.title = '⚠️ Filament niedrig';
                    notificationData.body = data.body || 'Filament bald leer!';
                    break;

                default:
                    console.warn('[SW] Unknown notification type:', data.notification_type);
            }

            // Add the image when there is one
            if (data.image) {
                notificationData.image = data.image;
            }

            return self.registration.showNotification(
                notificationData.title,
                notificationData
            );

        } catch (error) {
            console.error('[SW] Push parse error:', error);

            // Fallback notification
            return self.registration.showNotification('3D Drucker', {
                body: event.data.text(),
                icon: '/static/icon-192x192.png',
                badge: '/static/favicon-32x32.png'
            });
        }
    })();

    event.waitUntil(notificationPromise);
});

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked:', event.action);

    event.notification.close();

    const notificationData = event.notification.data || {};
    let targetUrl = notificationData.url || '/';

    // Handle Actions
    if (event.action === 'poweroff') {
        targetUrl = '/?action=poweroff';
    } else if (event.action === 'view') {
        targetUrl = '/?tab=status';
    }

    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(clientList => {
            // Look for an existing window
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    // Sende Message an Client
                    client.postMessage({
                        type: 'NOTIFICATION_CLICKED',
                        action: event.action,
                        data: notificationData
                    });
                    return client.focus();
                }
            }

            // No window found - open a new one
            return clients.openWindow(new URL(targetUrl, self.location.origin).href);
        })
    );
});

// The message handler for the auth status
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);

    if (event.data.type === 'AUTH_STATUS') {
        if (!event.data.authenticated) {
            // The user logged out - delete the push subscription
            self.registration.pushManager.getSubscription().then(subscription => {
                if (subscription) {
                    subscription.unsubscribe().then(() => {
                        console.log('[SW] Push subscription removed');
                    });
                }
            });

            // Delete the auth caches
            caches.delete(API_CACHE);
        }
    }

    // Skip waiting when an update is available
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Periodische Cleanup
setInterval(() => {
    // Delete the old cache entries
    caches.open(API_CACHE).then(cache => {
        cache.keys().then(requests => {
            requests.forEach(request => {
                cache.match(request).then(response => {
                    if (response) {
                        const cacheTime = response.headers.get('sw-cache-time');
                        if (cacheTime) {
                            const age = Date.now() - parseInt(cacheTime);
                            // Delete cache entries older than 1 hour
                            if (age > 3600000) {
                                cache.delete(request);
                            }
                        }
                    }
                });
            });
        });
    });
}, 15 * 60 * 1000); // Alle 15 Minuten

// Error Handler
self.addEventListener('error', (event) => {
    console.error('[SW] Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('[SW] Unhandled rejection:', event.reason);
});

console.log('[SW] Service Worker loaded');

/**
 * The page for an HTML page that is neither reachable nor cached.
 *
 * It was the bare text "Page unavailable (offline)" -- a dead end: nothing
 * reloaded, and a reload by hand while the server was still away gave the
 * same text again (seen 14sep26 in the Dashboard after a server restart).
 * Now it looks like the rest of the app (the tokens of design-tokens.css, a
 * card like .es-karte, the spinner of .sd-sync-kreisel), asks /login every
 * two seconds and reloads the page the moment the server answers. /login is
 * public and not routed through this worker (only /api and /static are), so
 * a failed fetch is a real "away" and any answer, the redirect of a signed-in
 * visitor included, a real "back". Not /health: that does not exist (the
 * system routes sit under /api), and every recovery left a 404 in the log.
 *
 * A service worker has no language files; the page reads the app's own
 * choices (language, theme) from localStorage -- it is the same origin.
 */
function offlineSeite() {
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>3D Printer Dashboard</title>
<style>
  :root {
    --bg-primary: #F3F3F7; --bg-card: #FFFFFF; --text-primary: #1a1f2e;
    --text-secondary: #5a6270; --border-color: #D3D3D3; --accent-blue: #2196f3;
    --shadow-card: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg-primary: #0F1419; --bg-card: #1A1F2E; --text-primary: #E8EAED;
      --text-secondary: #B8BCC8; --border-color: #404859;
      --shadow-card: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
  }
  :root[data-theme="dark"] {
    --bg-primary: #0F1419; --bg-card: #1A1F2E; --text-primary: #E8EAED;
    --text-secondary: #B8BCC8; --border-color: #404859;
    --shadow-card: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg-primary); color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', system-ui, Roboto, sans-serif;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 0 16px;
  }
  .karte {
    width: 100%; max-width: 380px; background: var(--bg-card);
    border: 1px solid var(--border-color); border-radius: 16px;
    box-shadow: var(--shadow-card); padding: 26px 24px 22px; text-align: center;
  }
  .kreisel {
    width: 30px; height: 30px; margin: 0 auto 16px; border-radius: 50%;
    border: 3px solid rgba(128, 128, 128, 0.25); border-top-color: var(--accent-blue);
    animation: dreh .8s linear infinite;
  }
  @keyframes dreh { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .kreisel { animation-duration: 2.4s; } }
  .titel { font-size: 18px; font-weight: 600; margin-bottom: 6px; }
  .text { font-size: 14px; line-height: 1.45; color: var(--text-secondary); }
  .adresse { margin-top: 12px; font-size: 12px; color: var(--text-secondary); opacity: .8; word-break: break-all; }
</style>
</head>
<body>
  <div class="karte">
    <div class="kreisel" aria-hidden="true"></div>
    <div class="titel" id="titel"></div>
    <div class="text" id="text"></div>
    <div class="adresse" id="adresse"></div>
  </div>
<script>
  (function () {
    var TEXTE = {
      de: ['Server nicht erreichbar — neuer Versuch …', 'Die Seite lädt von selbst neu, sobald der Server wieder da ist.'],
      en: ['Server not reachable — trying again …', 'The page reloads by itself as soon as the server is back.'],
      es: ['Servidor no accesible: reintentando …', 'La página se recarga sola en cuanto el servidor vuelva.'],
      fr: ['Serveur injoignable — nouvel essai …', 'La page se recharge d’elle-même dès que le serveur revient.'],
      it: ['Server non raggiungibile: nuovo tentativo …', 'La pagina si ricarica da sola appena il server torna.']
    };
    var sprache = 'de', theme = 'auto';
    try {
      sprache = localStorage.getItem('language') || (navigator.language || 'de').slice(0, 2);
      theme = localStorage.getItem('theme') || 'auto';
    } catch (e) {}
    if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
    var t = TEXTE[sprache] || TEXTE.en;
    document.documentElement.lang = TEXTE[sprache] ? sprache : 'en';
    document.getElementById('titel').textContent = t[0];
    document.getElementById('text').textContent = t[1];
    document.getElementById('adresse').textContent = location.host;
    document.title = t[0];
    function frage() {
      fetch('/login', { cache: 'no-store', redirect: 'manual' })
        .then(function () { location.reload(); })
        .catch(function () { setTimeout(frage, 2000); });
    }
    setTimeout(frage, 2000);
  })();
</script>
</body>
</html>`;
    return new Response(html, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}
