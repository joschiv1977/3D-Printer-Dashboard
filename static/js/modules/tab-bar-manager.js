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
        if (path.includes('notifications.html')) return 'notifications';
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
            // Messages: the one entry to what came in and what is still
            // waiting for an answer. Until 17sep26 the list existed but
            // nothing linked to it -- "later" on a question meant "gone until
            // you happen to look at the material card".
            { id: 'notifications', icon: 'fa-solid fa-bell', label: 'Meldungen', href: '/static/notifications.html', desktopOnly: false },
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
                           tab.id === 'notifications' ? 'tab_notifications' :
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
                    <span class="tab-icon"><i class="${tab.icon}"></i>${tab.id === 'notifications'
                        ? '<span class="tab-badge" id="tab-meldungen-zahl" hidden></span>' : ''}</span>
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
        this.zaehleMeldungen();
    }

    /**
     * The number on the bell: open questions plus messages nobody has dealt
     * with. The server counts it and sends it WITH THE STATUS (`inbox`), so
     * it arrives over the socket like everything else and the apps only draw
     * it -- three surfaces cannot come to different totals.
     *
     * Until 18sep26 this asked a route of its own, and only when something
     * happened on this page: on the phone the badge then stood still until a
     * tab was switched.
     */
    showMessages(inbox) {
        const feld = document.getElementById('tab-meldungen-zahl');
        if (!feld || !inbox) return;
        const zahl = Math.max(0, parseInt(inbox.total || 0, 10));
        feld.textContent = zahl > 99 ? '99+' : String(zahl);
        feld.hidden = zahl === 0;
        // Open questions are the loud kind: they wait for an answer.
        feld.classList.toggle('tab-badge--frage', (inbox.questions || 0) > 0);
    }

    /**
     * Ask now: on page load, and the moment a message arrives or is dealt
     * with. The status carries the same number, but when the printer idles
     * it is pushed rarely -- the bell then lagged far behind the toast that
     * had long appeared (18sep26). The count route answers the same thing
     * in one small request. noDedup: two messages within two seconds must
     * not get the answer from before the second one.
     */
    zaehleMeldungen() {
        if (!window.apiCall) return;
        window.apiCall('/api/notifications/count', { noDedup: true })
            .then(r => r.json())
            .then(d => this.showMessages(d))
            .catch(() => {});
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
