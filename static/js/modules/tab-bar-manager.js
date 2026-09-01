/**
 * Tab Bar Manager - iOS-style floating tab bar navigation
 * Replaces sidebar navigation across all pages
 */
class TabBarManager {
    constructor() {
        this.currentPage = this.detectCurrentPage();
    }

    /**
     * Detect current page from URL
     */
    detectCurrentPage() {
        const path = window.location.pathname;
        if (path === '/' || path.includes('index.html')) return 'dashboard';
        if (path.includes('history.html')) return 'history';
        if (path.includes('settings.html')) return 'settings';
        if (path.includes('slicer.html')) return 'slicer';
        if (path.includes('logs.html')) return 'logs';
        if (path.includes('maintenance.html')) return 'maintenance';
        if (path.includes('bedmesh.html')) return 'bedmesh';
        if (path.includes('mainsail.html')) return 'mainsail';
        if (path.includes('users.html') || path.includes('/users')) return 'users';
        // Seiten ohne eigenen Reiter (z.B. Benachrichtigungen) markierten
        // sonst faelschlich "Home" als aktiv.
        if (path.includes('notifications.html')) return '';
        return 'dashboard';
    }

    /**
     * Generate tab bar HTML
     */
    generateHTML() {
        // Reihenfolge wie Android (Direct-Modus): Home, Konsole, Bed Mesh, Historie,
        // Wartung, Einstellungen. Slicer + Users sind im Direct-Modus ausgeblendet.
        const tabs = [
            { id: 'dashboard', icon: 'fa-solid fa-house', label: 'Home', href: '/', desktopOnly: false },
            { id: 'logs', icon: 'fa-solid fa-terminal', label: 'Konsole', href: '/static/logs.html', desktopOnly: true },
            // Bed Mesh: nur im Klipper-Direct-Modus (per _applyDirectMode eingeblendet).
            { id: 'bedmesh', icon: 'fa-solid fa-mountain', label: 'Bed Mesh', href: '/static/bedmesh.html', desktopOnly: false, directOnly: true },
            { id: 'history', icon: 'fa-solid fa-clock-rotate-left', label: 'History', href: '/static/history.html', desktopOnly: false },
            { id: 'maintenance', icon: 'fa-solid fa-wrench', label: 'Wartung', href: '/static/maintenance.html', desktopOnly: true },
            // Mainsail: nur im Klipper-Direct-Modus. Lädt die Drucker-Web-UI eingebettet
            // in der App (Electron <webview>; im Browser Fallback "im Browser öffnen").
            { id: 'mainsail', icon: 'fa-solid fa-gauge-high', label: 'Mainsail', href: '/static/mainsail.html', desktopOnly: false, directOnly: true },
            // Slicer: im Direct-Modus ausgeblendet (Slicing läuft dort nicht über dieses Backend).
            { id: 'slicer', icon: 'fa-solid fa-cube', label: 'Slicer', href: '/static/slicer.html', desktopOnly: false, hideInDirect: true },
            // Users: im Direct-Modus ausgeblendet (kein Multi-User-Backend).
            { id: 'users', icon: 'fa-solid fa-user-group', label: 'Users', href: '/static/users.html', desktopOnly: false, hideInDirect: true },
            { id: 'settings', icon: 'fa-solid fa-gear', label: '', href: this.getSettingsHref(), desktopOnly: false }
        ];

        const tabItems = tabs.map(tab => {
            const isActive = this.currentPage === tab.id;
            const classes = ['tab-item'];
            if (isActive) classes.push('active');
            if (tab.desktopOnly) classes.push('desktop-only');
            if (tab.directOnly) classes.push('direct-only-tab');
            if (tab.hideInDirect) classes.push('hide-in-direct');

            // i18n data attribute for labels
            const i18nKey = tab.id === 'dashboard' ? 'dashboard' :
                           tab.id === 'maintenance' ? 'maintenance' :
                           tab.id === 'settings' ? '' :  // Kein Label — nur Zahnrad-Icon
                           tab.id === 'bedmesh' ? 'nav_bedmesh' :
                           tab.id === 'users' ? 'users' :
                           tab.id === 'logs' ? 'logs' :
                           tab.id === 'history' ? 'history' : '';

            // direct-only Tabs starten versteckt; _applyDirectMode blendet sie ein.
            const style = tab.directOnly ? ' style="display:none;"' : '';
            return `
                <a class="${classes.join(' ')}" href="${tab.href}" data-tab-id="${tab.id}"${style} ${tab.id === 'settings' && this.currentPage === 'dashboard' ? `onclick="event.preventDefault(); openSettings();"` : ''}>
                    <span class="tab-icon"><i class="${tab.icon}"></i></span>
                    <span class="tab-label" ${i18nKey ? `data-i18n="${i18nKey}"` : ''}>${tab.label}</span>
                </a>
            `;
        }).join('');

        return `
            <nav class="floating-tab-bar" id="floating-tab-bar">
                ${tabItems}
            </nav>
        `;
    }

    /**
     * Get settings href based on current page
     */
    getSettingsHref() {
        if (this.currentPage === 'dashboard') {
            return '#'; // Dashboard uses openSettings() function
        }
        return '/static/settings.html';
    }

    /**
     * Render tab bar into body
     */
    render() {
        // Don't render if already exists
        if (document.getElementById('floating-tab-bar')) {
            return;
        }

        const html = this.generateHTML();
        document.body.insertAdjacentHTML('beforeend', html);

        // Apply translations if i18nManager is already loaded
        if (window.i18nManager) {
            window.i18nManager.applyTranslations();
        }

        // Klipper-Direct: Users raus, Bed Mesh rein (async, sobald Config da).
        this._applyDirectMode();

        // Mainsail-Tab bei offline ausgrauen.
        this.updateMainsailState();
    }

    /**
     * Mainsail-Tab deaktivieren wenn der Drucker offline ist (Mainsail ist dann
     * eh nicht erreichbar) — AUSSER im host_mode "external", wo Mainsail auf
     * dem always-on-Host liegt und durchgehend erreichbar bleibt. Wird bei jedem Status-Wechsel erneut aufgerufen
     * (updatePrinterDependentCards). Ist der Online-Status (noch) unbekannt —
     * z.B. auf Seiten ohne Socket — bleibt der Tab aktiv (die Mainsail-Seite
     * fängt offline selbst ab).
     */
    updateMainsailState() {
        const el = document.querySelector('.tab-item[data-tab-id="mainsail"]');
        if (!el) return;
        // Always-on-Host (host_mode=external): Mainsail laeuft auf dem Host,
        // nicht im Drucker — es bleibt also auch bei ausgeschalteter Steckdose
        // erreichbar. Tab dann NIE ausgrauen.
        if (window.lastHostMode === 'external') {
            el.classList.remove('tab-disabled');
            return;
        }
        // Ohne eingerichtete Steckdose entscheidet die Verbindung -- die
        // Antwort steht in status-manager.js, hier wird sie nur gelesen.
        const online = (typeof window.druckerDa === 'boolean') ? window.druckerDa
            : (window.lastKnownSwitchState === 'on' && window.lastMqttStatus === true);
        const hasInfo = window.lastMqttStatus !== undefined || window.lastKnownSwitchState !== undefined;
        el.classList.toggle('tab-disabled', hasInfo && !online);
    }

    /**
     * Blendet im Klipper-Direct-Modus den Bed-Mesh-Tab ein und den Users-Tab
     * aus. Die /api/config-Abfrage wird global gecacht, damit nicht jede Seite
     * neu fragt. direct_mode kommt nur vom lokalen Adapter (Bambu-Backend: falsy).
     */
    _applyDirectMode() {
        // Dokumentweit: greift Tab-Bar UND Header-Button (.hide-in-direct).
        window.__directCfgPromise = window.__directCfgPromise ||
            fetch('/api/config', { credentials: 'same-origin' }).then(r => r.json()).catch(() => ({}));
        window.__directCfgPromise.then(cfg => {
            const direct = !!(cfg && cfg.direct_mode === true);
            document.querySelectorAll('.direct-only-tab').forEach(el => { el.style.display = direct ? '' : 'none'; });
            document.querySelectorAll('.direct-only').forEach(el => { el.style.display = direct ? '' : 'none'; });
            document.querySelectorAll('.hide-in-direct').forEach(el => { el.style.display = direct ? 'none' : ''; });
            this.updateMainsailState();
        });
    }
}

// Create global instance
window.tabBarManager = new TabBarManager();
