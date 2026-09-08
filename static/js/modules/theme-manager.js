/**
 * The theme manager - handles dark and light mode for the whole app.
 * Shared by every page.
 */
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'auto';
        this.init();
    }

    init() {
        this.applyTheme();
        this.updateIcons();

        // The event listener for changes of the system theme
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (this.theme === 'auto') {
                    this.applyTheme();
                }
            });
        }
    }

    /**
     * Cycles between the dark, light and auto modes
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
     * Applies the current theme
     */
    applyTheme() {
        const body = document.body;

        if (this.theme === 'auto') {
            // Use the system preference
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
        const symbol = this.theme === 'auto' ? 'halbmond' : (this.theme === 'dark' ? 'mond' : 'sonne');
        const iconText = (typeof window.skIcon === 'function') ? window.skIcon(symbol) : '';
        const labelText = this.theme === 'auto' ? 'Auto (System)' : (this.theme === 'dark' ? 'Dark Mode' : 'Light Mode');

        const headerIcon = document.getElementById('theme-icon');
        const sidebarIcon = document.getElementById('theme-icon-sidebar'); // Legacy
        const settingsIcon = document.getElementById('theme-icon-settings');
        const settingsLabel = document.getElementById('theme-label-settings');

        if (headerIcon) headerIcon.innerHTML = iconText;
        if (sidebarIcon) sidebarIcon.innerHTML = iconText;
        if (settingsIcon) settingsIcon.innerHTML = iconText;
        if (settingsLabel) settingsLabel.textContent = `Aktuell: ${labelText}`;

        // Update meta theme-color for PWA
        const darkMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');
        const lightMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
        if (darkMeta) darkMeta.content = '#0F1419';
        if (lightMeta) lightMeta.content = '#F3F3F7';
    }

    /**
     * Returns the current theme state
     */
    getCurrentTheme() {
        return this.theme;
    }

    /**
     * Returns whether dark mode is active
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

// Backwards compatibility: the old functions are kept
window.toggleDarkMode = () => window.themeManager.toggleTheme();
window.applyStoredTheme = () => window.themeManager.applyTheme();
