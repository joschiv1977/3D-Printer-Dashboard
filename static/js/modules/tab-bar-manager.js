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
        if (path.includes('users.html') || path.includes('/users')) return 'users';
        return 'dashboard';
    }

    /**
     * Generate tab bar HTML
     */
    generateHTML() {
        const tabs = [
            { id: 'dashboard', icon: 'fa-solid fa-house', label: 'Home', href: '/', desktopOnly: false },
            { id: 'slicer', icon: 'fa-solid fa-cube', label: 'Slicer', href: '/static/slicer.html', desktopOnly: false },
            { id: 'logs', icon: 'fa-solid fa-list', label: 'Logs', href: '/static/logs.html', desktopOnly: true },
            { id: 'history', icon: 'fa-solid fa-clock-rotate-left', label: 'History', href: '/static/history.html', desktopOnly: false },
            { id: 'maintenance', icon: 'fa-solid fa-wrench', label: 'Wartung', href: '/static/maintenance.html', desktopOnly: true },
            { id: 'users', icon: 'fa-solid fa-user-group', label: 'Users', href: '/static/users.html', desktopOnly: false },
            { id: 'settings', icon: 'fa-solid fa-gear', label: 'Settings', href: this.getSettingsHref(), desktopOnly: false }
        ];

        const tabItems = tabs.map(tab => {
            const isActive = this.currentPage === tab.id;
            const classes = ['tab-item'];
            if (isActive) classes.push('active');
            if (tab.desktopOnly) classes.push('desktop-only');

            // i18n data attribute for labels
            const i18nKey = tab.id === 'dashboard' ? 'dashboard' :
                           tab.id === 'maintenance' ? 'maintenance' :
                           tab.id === 'settings' ? 'settings' :
                           tab.id === 'users' ? 'users' :
                           tab.id === 'logs' ? 'logs' :
                           tab.id === 'history' ? 'history' : '';

            return `
                <a class="${classes.join(' ')}" href="${tab.href}" ${tab.id === 'settings' && this.currentPage === 'dashboard' ? `onclick="event.preventDefault(); openSettings();"` : ''}>
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
    }
}

// Create global instance
window.tabBarManager = new TabBarManager();

// Backwards Compatibility: Keep old sidebar functions as no-ops
window.sidebarManager = {
    toggle: () => {},
    render: () => { window.tabBarManager.render(); },
    openOnHover: () => {},
    closeOnLeave: () => {},
    keepOpen: () => {},
    togglePin: () => {}
};
window.toggleSidebar = () => {};
window.openSidebarOnHover = () => {};
window.closeSidebarOnLeave = () => {};
window.keepSidebarOpen = () => {};
window.toggleSidebarPin = () => {};
