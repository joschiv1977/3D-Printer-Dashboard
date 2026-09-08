/**
 * App shell - the content loading system for SPA-like behaviour.
 * Loads page content dynamically, without a full page reload.
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
     * Initialise the app shell system
     */
    init() {
        // Create the main content container (when it is missing)
        this.ensureMainContainer();

        // The event listener for the browser back/forward buttons
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
     * Makes sure the main content container exists
     */
    ensureMainContainer() {
        let container = document.getElementById(this.mainContentId);
        if (!container) {
            // Look for the main content area
            const body = document.body;

            // Create a container for the dynamic content
            container = document.createElement('div');
            container.id = this.mainContentId;
            container.style.width = '100%';
            container.style.minHeight = '100vh';

            body.appendChild(container);
        }
        return container;
    }

    /**
     * Works out the page name from a URL
     */
    detectPageName(url) {
        if (url.includes('settings.html')) return 'settings';
        if (url.includes('slicer.html')) return 'slicer';
        if (url.includes('maintenance.html')) return 'maintenance';
        if (url.includes('users.html')) return 'users';
        return 'dashboard';
    }

    /**
     * Load a page dynamically
     * @param {string} url - the URL of the page to load
     * @param {boolean} pushState - whether pushState should be called (default: true)
     */
    async loadPage(url, pushState = true) {
        const pageName = this.detectPageName(url);

        // Check the cache
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
            // Show the loading indicator
            this.showLoading();

            // Load the page
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();

            // Extract only the relevant content
            const content = this.extractContent(html, pageName);

            // Store it in the cache
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
     * Extracts the relevant content out of an HTML page
     */
    extractContent(html, pageName) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        let content = { html: '', css: '', scripts: [] };

        // Extract the CSS from the <style> tags
        const styleTags = doc.querySelectorAll('style');
        styleTags.forEach(style => {
            content.css += style.textContent;
        });

        // Extract the content according to the page type
        if (pageName === 'settings') {
            // Settings has an admin-container structure
            const adminContainer = doc.querySelector('.admin-container');
            if (adminContainer) {
                content.html = adminContainer.outerHTML;
            }
        } else if (pageName === 'slicer' || pageName === 'maintenance' || pageName === 'users') {
            // Other pages have a .container structure
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
     * Renders the content into the main container
     */
    renderContent(content) {
        const container = document.getElementById(this.mainContentId);
        if (!container) return;

        // Set the HTML
        container.innerHTML = content.html;

        // Add the CSS (when it is not there already)
        if (content.css) {
            this.injectCSS(content.css);
        }

        // Run the scripts (optional, and carefully!)
        // IMPORTANT: ideally scripts should not sit in page content but be
        // loaded as external modules
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

        // Apply the translations
        if (window.i18nManager) {
            window.i18nManager.applyTranslations();
        }

        // Scroll to top
        window.scrollTo(0, 0);
    }

    /**
     * Inserts the CSS into the head
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
     * Adds content to the cache
     */
    addToCache(url, content) {
        // An LRU cache: drop the oldest when it grows too large
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(url, content);
    }

    /**
     * Empties the cache
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
                        <div style="margin-bottom: 20px;">${window.skIcon ? window.skIcon('sanduhr', 'hd-ic--xl') : ''}</div>
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
        // The loading state is replaced by renderContent
    }

    /**
     * Shows the error message
     */
    showError(message) {
        const container = document.getElementById(this.mainContentId);
        if (container) {
            container.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 100vh;">
                    <div style="text-align: center; max-width: 500px; padding: 20px;">
                        <div style="margin-bottom: 20px;">${window.skIcon ? window.skIcon('warnung', 'hd-ic--xl') : ''}</div>
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

// NOT created automatically - only on request
// window.appShell = new AppShell();

// Exported for manual initialisation
window.AppShell = AppShell;
