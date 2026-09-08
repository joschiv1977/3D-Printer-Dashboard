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
        // Pages without a tab of their own (notifications, say) otherwise
        // wrongly marked "home" as active.
        if (path.includes('notifications.html')) return '';
        return 'dashboard';
    }

    /**
     * Generate tab bar HTML
     */
    generateHTML() {
        // The same order as Android (direct mode): home, console, bed mesh,
        // history, maintenance, settings. Slicer and users are hidden in direct
        // mode.
        const tabs = [
            { id: 'dashboard', icon: 'fa-solid fa-house', label: 'Home', href: '/', desktopOnly: false },
            { id: 'logs', icon: 'fa-solid fa-terminal', label: 'Konsole', href: '/static/logs.html', desktopOnly: true },
            // Bed mesh: only in Klipper direct mode (shown by _applyDirectMode).
            { id: 'bedmesh', icon: 'fa-solid fa-mountain', label: 'Bed Mesh', href: '/static/bedmesh.html', desktopOnly: false, directOnly: true },
            { id: 'history', icon: 'fa-solid fa-clock-rotate-left', label: 'History', href: '/static/history.html', desktopOnly: false },
            { id: 'maintenance', icon: 'fa-solid fa-wrench', label: 'Wartung', href: '/static/maintenance.html', desktopOnly: true },
            // Mainsail: only in Klipper direct mode. It loads the printer web UI
            // embedded in the app (an Electron <webview>; in a browser the
            // fallback is "open in the browser").
            { id: 'mainsail', icon: 'fa-solid fa-gauge-high', label: 'Mainsail', href: '/static/mainsail.html', desktopOnly: false, directOnly: true },
            // Slicer: hidden in direct mode (slicing does not run through this
            // backend there).
            { id: 'slicer', icon: 'fa-solid fa-cube', label: 'Slicer', href: '/static/slicer.html', desktopOnly: false, hideInDirect: true },
            // Users: hidden in direct mode (there is no multi-user backend).
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

            // The direct-only tabs start hidden; _applyDirectMode shows them.
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

        // Klipper-Direct: users out, bed mesh in (async, as soon as the config is there).
        this._applyDirectMode();

        // Mainsail-Tab bei offline ausgrauen.
        this.updateMainsailState();
    }

    /**
     * Disable the Mainsail tab while the printer is offline (Mainsail is
     * unreachable then anyway) -- EXCEPT in host_mode "external", where
     * Mainsail sits on the always-on host and stays reachable throughout.
     * Called again on every state change (updatePrinterDependentCards). While
     * the online state is (still) unknown -- on pages without a socket, for
     * instance -- the tab stays enabled (the Mainsail page catches being
     * offline itself).
     */
    updateMainsailState() {
        const el = document.querySelector('.tab-item[data-tab-id="mainsail"]');
        if (!el) return;
        // An always-on host (host_mode=external): Mainsail runs on the host,
        // not in the printer -- so it stays reachable even with the socket
        // switched off. The tab is then NEVER greyed out.
        if (window.lastHostMode === 'external') {
            el.classList.remove('tab-disabled');
            return;
        }
        // Without a socket set up, the connection decides -- the answer lives
        // in status-manager.js, here it is only read.
        const online = (typeof window.druckerDa === 'boolean') ? window.druckerDa
            : (window.lastKnownSwitchState === 'on' && window.lastMqttStatus === true);
        const hasInfo = window.lastMqttStatus !== undefined || window.lastKnownSwitchState !== undefined;
        el.classList.toggle('tab-disabled', hasInfo && !online);
    }

    /**
     * In Klipper direct mode this shows the bed mesh tab and hides the users
     * tab. The /api/config query is cached globally, so not every page asks
     * again. direct_mode comes only from the local adapter (from the Bambu
     * backend it is falsy).
     */
    _applyDirectMode() {
        // Document-wide: this covers the tab bar AND the header button (.hide-in-direct).
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
