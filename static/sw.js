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
                        return new Response('Page unavailable (offline)', {   // bewusst englisch:
                            // a service worker runs without the language
                            // files, and this is the body of a 503 answer,
                            // not a control.
                            status: 503,
                            headers: { 'Content-Type': 'text/html' }
                        });
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
