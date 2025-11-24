/**
 * Sidebar Manager - Verwaltet die Sidebar für die gesamte App
 * Wird von allen Seiten gemeinsam genutzt
 */
class SidebarManager {
    constructor() {
        this.sidebarHoverTimeout = null;
        this.sidebarCloseTimeout = null;
        this.currentPage = this.detectCurrentPage();
    }

    /**
     * Erkennt die aktuelle Seite anhand der URL
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
     * Generiert die Sidebar-HTML
     */
    generateHTML() {
        return `
            <!-- Sidebar Overlay -->
            <div class="sidebar-overlay" id="sidebar-overlay" onclick="window.sidebarManager.toggle()"></div>

            <!-- Sidebar -->
            <div class="sidebar" id="sidebar" onmouseenter="window.sidebarManager.keepOpen()" onmouseleave="window.sidebarManager.closeOnLeave()">
                <div class="sidebar-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                        <button class="menu-toggle" onclick="window.sidebarManager.toggle()" style="margin: 0;">☰</button>
                        <img src="/static/made-in-germany.png" alt="Made in Germany">
                    </div>
                    <h2>Menu</h2>
                </div>
                <div class="sidebar-menu">
                    <!-- Dashboard Link (immer anzeigen) -->
                    <div class="sidebar-item ${this.currentPage === 'dashboard' ? 'active' : ''}" onclick="window.location.href='/'">
                        <span class="sidebar-icon">🏠</span>
                        <span data-i18n="dashboard">Dashboard</span>
                    </div>

                    <!-- Logs Link (immer zu logs.html) -->
                    <div class="sidebar-item ${this.currentPage === 'logs' ? 'active' : ''}" onclick="window.location.href='/static/logs.html'">
                        <span class="sidebar-icon">📋</span>
                        <span data-i18n="logs">Logs</span>
                    </div>

                    <!-- History Link (immer zu history.html) -->
                    <div class="sidebar-item ${this.currentPage === 'history' ? 'active' : ''}" onclick="window.location.href='/static/history.html'">
                        <span class="sidebar-icon">📊</span>
                        <span data-i18n="history">History</span>
                    </div>

                    <div class="sidebar-item ${this.currentPage === 'slicer' ? 'active' : ''}" onclick="window.location.href='/static/slicer.html'">
                        <span class="sidebar-icon">🔪</span>
                        <span>Slicer</span>
                    </div>
                    <div class="sidebar-item ${this.currentPage === 'maintenance' ? 'active' : ''}" onclick="window.location.href='/static/maintenance.html'">
                        <span class="sidebar-icon">🔧</span>
                        <span data-i18n="maintenance">Wartung</span>
                    </div>
                    <div class="sidebar-item ${this.currentPage === 'users' ? 'active' : ''}" onclick="window.location.href='/static/users.html'">
                        <span class="sidebar-icon">👤</span>
                        <span data-i18n="users">Users</span>
                    </div>
                    ${this.currentPage === 'dashboard' ? `
                    <div class="sidebar-item" onclick="openSettings(); window.sidebarManager.toggle();">
                        <span class="sidebar-icon">⚙️</span>
                        <span data-i18n="settings">Settings</span>
                    </div>
                    ` : `
                    <div class="sidebar-item ${this.currentPage === 'settings' ? 'active' : ''}" onclick="window.location.href='/static/settings.html'">
                        <span class="sidebar-icon">⚙️</span>
                        <span data-i18n="settings">Settings</span>
                    </div>
                    `}
                </div>

                <!-- Pin Button (nur Desktop > 768px) -->
                <div class="sidebar-pin-container" id="sidebar-pin-container">
                    <button class="sidebar-pin-btn" id="sidebar-pin-btn" onclick="window.sidebarManager.togglePin()" title="Pin sidebar">
                        <span id="pin-icon">📌</span>
                        <span data-i18n="sidebar_pin">Pin Sidebar</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Rendert die Sidebar in den Body
     */
    render() {
        // Prüfe ob Sidebar bereits existiert
        const existingSidebar = document.getElementById('sidebar');
        if (existingSidebar) {
            return; // Sidebar existiert bereits
        }

        // Füge Sidebar am Anfang des Body ein
        const html = this.generateHTML();
        document.body.insertAdjacentHTML('afterbegin', html);

        // Prüfe ob Sidebar gepinnt werden soll (nur Desktop)
        this.checkPinnedState();

        // Wende Übersetzungen an (falls i18nManager bereits geladen)
        if (window.i18nManager) {
            window.i18nManager.applyTranslations();
        }
    }

    /**
     * Toggle Sidebar
     */
    toggle() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        if (!sidebar || !overlay) return;

        sidebar.classList.toggle('mobile-open');
        overlay.classList.toggle('active');

        // Verhindere Body-Scroll wenn Sidebar offen ist
        if (sidebar.classList.contains('mobile-open')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }

    /**
     * Öffnet Sidebar beim Hover (mit Delay)
     */
    openOnHover() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        // Don't open if already open or opening
        if (sidebar.classList.contains('mobile-open') || this.sidebarHoverTimeout) {
            return;
        }

        // Clear any pending close timeout
        if (this.sidebarCloseTimeout) {
            clearTimeout(this.sidebarCloseTimeout);
            this.sidebarCloseTimeout = null;
        }

        // Open sidebar with slight delay
        this.sidebarHoverTimeout = setTimeout(() => {
            const overlay = document.getElementById('sidebar-overlay');
            sidebar.classList.add('mobile-open');
            overlay.classList.add('active');
            this.sidebarHoverTimeout = null;
        }, 200);
    }

    /**
     * Schließt Sidebar beim Leave (mit Delay)
     */
    closeOnLeave() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        // Don't close if not open or already closing
        if (!sidebar.classList.contains('mobile-open') || this.sidebarCloseTimeout) {
            return;
        }

        // Clear any pending open timeout
        if (this.sidebarHoverTimeout) {
            clearTimeout(this.sidebarHoverTimeout);
            this.sidebarHoverTimeout = null;
        }

        // Close sidebar with slight delay
        this.sidebarCloseTimeout = setTimeout(() => {
            const overlay = document.getElementById('sidebar-overlay');
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
            this.sidebarCloseTimeout = null;
        }, 300);
    }

    /**
     * Hält die Sidebar offen beim Hover
     */
    keepOpen() {
        if (this.sidebarCloseTimeout) {
            clearTimeout(this.sidebarCloseTimeout);
            this.sidebarCloseTimeout = null;
        }
    }

    /**
     * Toggle Pin (nur Desktop)
     */
    togglePin() {
        if (window.innerWidth <= 768) {
            return;
        }

        const sidebar = document.getElementById('sidebar');
        const body = document.body;
        const pinIcon = document.getElementById('pin-icon');
        if (!sidebar || !pinIcon) return;

        const isPinned = sidebar.classList.contains('pinned');

        if (isPinned) {
            // Unpin
            sidebar.classList.remove('pinned');
            body.classList.remove('sidebar-pinned');
            pinIcon.textContent = '📌';
            localStorage.setItem('sidebar-pinned', 'false');

            // Schließe Sidebar nach Unpin
            sidebar.classList.remove('mobile-open');
            document.getElementById('sidebar-overlay').classList.remove('active');
        } else {
            // Pin
            sidebar.classList.add('pinned');
            body.classList.add('sidebar-pinned');
            pinIcon.textContent = '📍';
            localStorage.setItem('sidebar-pinned', 'true');
        }
    }

    /**
     * Prüft ob Sidebar gepinnt sein soll (beim Laden)
     */
    checkPinnedState() {
        if (window.innerWidth <= 768) {
            return;
        }

        const isPinned = localStorage.getItem('sidebar-pinned') === 'true';
        if (isPinned) {
            const sidebar = document.getElementById('sidebar');
            const body = document.body;
            const pinIcon = document.getElementById('pin-icon');

            if (sidebar && pinIcon) {
                sidebar.classList.add('pinned', 'mobile-open');
                body.classList.add('sidebar-pinned');
                pinIcon.textContent = '📍';
            }
        }
    }
}

// Globale Instanz erstellen
window.sidebarManager = new SidebarManager();

// Backwards Compatibility: Alte Funktionen behalten
window.toggleSidebar = () => window.sidebarManager.toggle();
window.openSidebarOnHover = () => window.sidebarManager.openOnHover();
window.closeSidebarOnLeave = () => window.sidebarManager.closeOnLeave();
window.keepSidebarOpen = () => window.sidebarManager.keepOpen();
window.toggleSidebarPin = () => window.sidebarManager.togglePin();
