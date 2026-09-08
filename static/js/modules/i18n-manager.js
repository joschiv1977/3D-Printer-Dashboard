/**
 * The i18n manager - handles the internationalisation for the whole app.
 * Shared by every page.
 */
class I18nManager {
    constructor() {
        this.currentLang = null;
        this.texts = {};
        this.translationsMap = {};
        this.init();
    }

    init() {
        // Load the language from the URL or from localStorage
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = urlParams.get('lang');

        this.currentLang = urlLang || localStorage.getItem('language') || 'de';

        // Build the translations map (it expects the language files to be loaded already)
        this.translationsMap = {
            'de': typeof translations_de !== 'undefined' ? translations_de : {},
            'en': typeof translations_en !== 'undefined' ? translations_en : {},
            'fr': typeof translations_fr !== 'undefined' ? translations_fr : {},
            'es': typeof translations_es !== 'undefined' ? translations_es : {},
            'it': typeof translations_it !== 'undefined' ? translations_it : {}
        };

        this.texts = this.translationsMap[this.currentLang] || this.translationsMap['en'] || {};

        // Apply the translations
        this.applyTranslations();
    }

    /**
     * Switch the language
     * @param {string} lang - the language code (de, en, fr, es, it)
     */
    switchLanguage(lang) {
        localStorage.setItem('language', lang);
        location.reload();
    }

    /**
     * Fetch a translated text
     * @param {string} key - the translation key
     * @param {string} fallback - the fallback text
     */
    getText(key, fallback = '') {
        return this.texts && this.texts[key] ? this.texts[key] : fallback;
    }

    /**
     * Applies the translations to the elements carrying data-i18n
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
        // The placeholders in the search fields: they otherwise stood there in
        // German whatever the language.
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const t = this.getText(el.getAttribute('data-i18n-placeholder'));
            if (t) el.setAttribute('placeholder', t);
        });
        // The tooltips (title). hms-banner.js has always set data-i18n-title,
        // only nobody evaluated it here -- so the tooltip stayed German. The
        // same pattern as above, one attribute further.
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const t = this.getText(el.getAttribute('data-i18n-title'));
            if (t) el.setAttribute('title', t);
        });
    }

    /**
     * Returns the current language
     */
    getCurrentLang() {
        return this.currentLang;
    }

    /**
     * Returns every translation
     */
    getAllTexts() {
        return this.texts;
    }
}

// Create the global instance (after the DOM has loaded)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.i18nManager = new I18nManager();
    });
} else {
    window.i18nManager = new I18nManager();
}

// Backwards compatibility: the old functions are kept
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
