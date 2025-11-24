/**
 * App Shell - Content Loading System für SPA-ähnliches Verhalten
 * Lädt Seiten-Content dynamisch ohne Full Page Reload
 */
class AppShell {
    constructor() {
        this.mainContentId = 'app-main-content';
        this.currentPage = null;
        this.cache = new Map();
        this.cacheEnabled = true;
        this.maxCacheSize = 5;
    }

    /**
     * Initialisiert das App Shell System
     */
    init() {
        // Erstelle Main Content Container (falls nicht vorhanden)
        this.ensureMainContainer();

        // Event Listener für Browser Back/Forward
        window.addEventListener('popstate', (event) => {
            if (event.state && event.state.page) {
                this.loadPage(event.state.url, false); // false = kein pushState
            }
        });

        // Initial State setzen
        const currentUrl = window.location.href;
        window.history.replaceState({ page: this.detectPageName(currentUrl), url: currentUrl }, '', currentUrl);
    }

    /**
     * Stellt sicher dass der Main Content Container existiert
     */
    ensureMainContainer() {
        let container = document.getElementById(this.mainContentId);
        if (!container) {
            // Suche nach dem Haupt-Content-Bereich
            const body = document.body;

            // Erstelle einen Container für den dynamischen Content
            container = document.createElement('div');
            container.id = this.mainContentId;
            container.style.width = '100%';
            container.style.minHeight = '100vh';

            body.appendChild(container);
        }
        return container;
    }

    /**
     * Erkennt den Seitennamen aus einer URL
     */
    detectPageName(url) {
        if (url.includes('settings.html')) return 'settings';
        if (url.includes('slicer.html')) return 'slicer';
        if (url.includes('maintenance.html')) return 'maintenance';
        if (url.includes('users.html')) return 'users';
        return 'dashboard';
    }

    /**
     * Lädt eine Seite dynamisch
     * @param {string} url - URL der zu ladenden Seite
     * @param {boolean} pushState - Ob pushState aufgerufen werden soll (default: true)
     */
    async loadPage(url, pushState = true) {
        const pageName = this.detectPageName(url);

        // Prüfe Cache
        if (this.cacheEnabled && this.cache.has(url)) {
            const cachedContent = this.cache.get(url);
            this.renderContent(cachedContent);
            this.currentPage = pageName;

            if (pushState) {
                window.history.pushState({ page: pageName, url: url }, '', url);
            }

            return;
        }

        try {
            // Zeige Loading-Indikator
            this.showLoading();

            // Lade Seite
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();

            // Extrahiere nur den relevanten Content
            const content = this.extractContent(html, pageName);

            // Cache speichern
            if (this.cacheEnabled) {
                this.addToCache(url, content);
            }

            // Content rendern
            this.renderContent(content);

            // Update current page
            this.currentPage = pageName;

            // Update Browser History
            if (pushState) {
                window.history.pushState({ page: pageName, url: url }, '', url);
            }

            // Verstecke Loading-Indikator
            this.hideLoading();

        } catch (error) {
            console.error('Error loading page:', error);
            this.showError('Fehler beim Laden der Seite. Bitte versuche es erneut.');
            this.hideLoading();
        }
    }

    /**
     * Extrahiert den relevanten Content aus einer HTML-Seite
     */
    extractContent(html, pageName) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        let content = { html: '', css: '', scripts: [] };

        // Extrahiere CSS aus <style> Tags
        const styleTags = doc.querySelectorAll('style');
        styleTags.forEach(style => {
            content.css += style.textContent;
        });

        // Extrahiere Content basierend auf Seitentyp
        if (pageName === 'settings') {
            // Settings hat eine admin-container Struktur
            const adminContainer = doc.querySelector('.admin-container');
            if (adminContainer) {
                content.html = adminContainer.outerHTML;
            }
        } else if (pageName === 'slicer' || pageName === 'maintenance' || pageName === 'users') {
            // Andere Seiten haben eine .container Struktur
            const container = doc.querySelector('.container');
            if (container) {
                content.html = container.outerHTML;
            }
        }

        // Extrahiere inline Scripts (vorsichtig!)
        const scriptTags = doc.querySelectorAll('script:not([src])');
        scriptTags.forEach(script => {
            if (script.textContent.trim()) {
                content.scripts.push(script.textContent);
            }
        });

        return content;
    }

    /**
     * Rendert den Content in den Main Container
     */
    renderContent(content) {
        const container = document.getElementById(this.mainContentId);
        if (!container) return;

        // Setze HTML
        container.innerHTML = content.html;

        // Füge CSS hinzu (falls nicht bereits vorhanden)
        if (content.css) {
            this.injectCSS(content.css);
        }

        // Führe Scripts aus (optional und vorsichtig!)
        // WICHTIG: Scripts sollten idealerweise nicht in Seiten-Content sein
        // sondern als externe Module geladen werden
        if (content.scripts && content.scripts.length > 0) {
            console.warn('⚠️ Content contains inline scripts. Consider moving to external modules.');
            // content.scripts.forEach(scriptCode => {
            //     try {
            //         eval(scriptCode);
            //     } catch (error) {
            //         console.error('Error executing script:', error);
            //     }
            // });
        }

        // Wende Übersetzungen an
        if (window.i18nManager) {
            window.i18nManager.applyTranslations();
        }

        // Scroll to top
        window.scrollTo(0, 0);
    }

    /**
     * Fügt CSS in den Head ein
     */
    injectCSS(css) {
        const styleId = 'app-shell-dynamic-styles';
        let styleTag = document.getElementById(styleId);

        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            document.head.appendChild(styleTag);
        }

        styleTag.textContent = css;
    }

    /**
     * Fügt Content zum Cache hinzu
     */
    addToCache(url, content) {
        // LRU Cache: Entferne älteste wenn zu groß
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(url, content);
    }

    /**
     * Leert den Cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Zeigt Loading-Indikator
     */
    showLoading() {
        const container = document.getElementById(this.mainContentId);
        if (container) {
            container.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 100vh;">
                    <div style="text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 20px;">⏳</div>
                        <div style="font-size: 18px; color: var(--text-secondary);">Laden...</div>
                    </div>
                </div>
            `;
        }
    }

    /**
     * Versteckt Loading-Indikator
     */
    hideLoading() {
        // Loading wird durch renderContent ersetzt
    }

    /**
     * Zeigt Fehler-Nachricht
     */
    showError(message) {
        const container = document.getElementById(this.mainContentId);
        if (container) {
            container.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 100vh;">
                    <div style="text-align: center; max-width: 500px; padding: 20px;">
                        <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                        <div style="font-size: 18px; color: var(--text-primary); margin-bottom: 10px;">
                            ${message}
                        </div>
                        <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: var(--accent-blue); color: white; border: none; border-radius: 5px; cursor: pointer;">
                            Seite neu laden
                        </button>
                    </div>
                </div>
            `;
        }
    }
}

// NICHT automatisch erstellen - nur wenn explizit gewünscht
// window.appShell = new AppShell();

// Export für manuelle Initialisierung
window.AppShell = AppShell;
