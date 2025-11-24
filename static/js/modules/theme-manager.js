/**
 * Theme Manager - Verwaltet Dark/Light Mode für die gesamte App
 * Wird von allen Seiten gemeinsam genutzt
 */
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'auto';
        this.init();
    }

    init() {
        this.applyTheme();
        this.updateIcons();

        // Event Listener für System-Theme-Änderungen
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (this.theme === 'auto') {
                    this.applyTheme();
                }
            });
        }
    }

    /**
     * Wechselt zwischen Dark/Light/Auto Mode
     */
    toggleTheme() {
        const themes = ['auto', 'dark', 'light'];
        const currentIndex = themes.indexOf(this.theme);
        const nextIndex = (currentIndex + 1) % themes.length;
        this.theme = themes[nextIndex];

        localStorage.setItem('theme', this.theme);
        this.applyTheme();
        this.updateIcons();

        return this.theme;
    }

    /**
     * Wendet das aktuelle Theme an
     */
    applyTheme() {
        const body = document.body;

        if (this.theme === 'auto') {
            // System-Präferenz verwenden
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            body.classList.toggle('dark-mode', prefersDark);
        } else if (this.theme === 'dark') {
            body.classList.add('dark-mode');
        } else {
            body.classList.remove('dark-mode');
        }
    }

    /**
     * Aktualisiert Theme-Icons
     */
    updateIcons() {
        const iconText = this.theme === 'auto' ? '🌓' : (this.theme === 'dark' ? '🌙' : '☀️');
        const labelText = this.theme === 'auto' ? 'Auto (System)' : (this.theme === 'dark' ? 'Dark Mode' : 'Light Mode');

        const headerIcon = document.getElementById('theme-icon');
        const sidebarIcon = document.getElementById('theme-icon-sidebar');
        const settingsIcon = document.getElementById('theme-icon-settings');
        const settingsLabel = document.getElementById('theme-label-settings');

        if (headerIcon) headerIcon.textContent = iconText;
        if (sidebarIcon) sidebarIcon.textContent = iconText;
        if (settingsIcon) settingsIcon.textContent = iconText;
        if (settingsLabel) settingsLabel.textContent = `Aktuell: ${labelText}`;
    }

    /**
     * Gibt den aktuellen Theme-Status zurück
     */
    getCurrentTheme() {
        return this.theme;
    }

    /**
     * Gibt zurück ob Dark Mode aktiv ist
     */
    isDarkMode() {
        if (this.theme === 'auto') {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return this.theme === 'dark';
    }
}

// Globale Instanz erstellen
window.themeManager = new ThemeManager();

// Backwards Compatibility: Alte Funktionen behalten
window.toggleDarkMode = () => window.themeManager.toggleTheme();
window.applyStoredTheme = () => window.themeManager.applyTheme();
