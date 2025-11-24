/**
 * I18n Manager - Verwaltet Internationalisierung für die gesamte App
 * Wird von allen Seiten gemeinsam genutzt
 */
class I18nManager {
    constructor() {
        this.currentLang = null;
        this.texts = {};
        this.translationsMap = {};
        this.init();
    }

    init() {
        // Sprache aus URL oder localStorage laden
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = urlParams.get('lang');

        this.currentLang = urlLang || localStorage.getItem('language') || 'de';

        // Translations Map erstellen (erwartet dass Sprachdateien bereits geladen sind)
        this.translationsMap = {
            'de': typeof translations_de !== 'undefined' ? translations_de : {},
            'en': typeof translations_en !== 'undefined' ? translations_en : {},
            'fr': typeof translations_fr !== 'undefined' ? translations_fr : {},
            'es': typeof translations_es !== 'undefined' ? translations_es : {},
            'it': typeof translations_it !== 'undefined' ? translations_it : {}
        };

        this.texts = this.translationsMap[this.currentLang] || this.translationsMap['en'] || {};

        // Übersetzungen anwenden
        this.applyTranslations();
    }

    /**
     * Wechselt die Sprache
     * @param {string} lang - Sprachcode (de, en, fr, es, it)
     */
    switchLanguage(lang) {
        localStorage.setItem('language', lang);
        location.reload();
    }

    /**
     * Holt einen übersetzten Text
     * @param {string} key - Übersetzungsschlüssel
     * @param {string} fallback - Fallback-Text
     */
    getText(key, fallback = '') {
        return this.texts && this.texts[key] ? this.texts[key] : fallback;
    }

    /**
     * Wendet Übersetzungen auf Elemente mit data-i18n an
     */
    applyTranslations() {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.getText(key);
            if (translation) {
                el.textContent = translation;
            }
        });
    }

    /**
     * Gibt die aktuelle Sprache zurück
     */
    getCurrentLang() {
        return this.currentLang;
    }

    /**
     * Gibt alle Übersetzungen zurück
     */
    getAllTexts() {
        return this.texts;
    }
}

// Globale Instanz erstellen (nach DOM-Load)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.i18nManager = new I18nManager();
    });
} else {
    window.i18nManager = new I18nManager();
}

// Backwards Compatibility: Alte Funktionen behalten
window.switchLanguage = (lang) => {
    if (window.i18nManager) {
        window.i18nManager.switchLanguage(lang);
    } else {
        localStorage.setItem('language', lang);
        location.reload();
    }
};

window.getText = (key, fallback = '') => {
    if (window.i18nManager) {
        return window.i18nManager.getText(key, fallback);
    }
    return fallback;
};
