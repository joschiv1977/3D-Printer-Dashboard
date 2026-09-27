/**
 * Every request to this server says which language the page shows: texts the
 * server writes into its answer (an error in a toast) come back in it.
 */
(function () {
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const sameServer = url.startsWith('/api/') || url.startsWith(location.origin + '/api/');
        if (!sameServer) return originalFetch(input, init);
        let lang = 'de';
        try { lang = localStorage.getItem('language') || 'de'; } catch (e) { /* no storage: German, the page's default */ }
        const headers = new Headers((init && init.headers) || (typeof input !== 'string' && input.headers) || {});
        if (!headers.has('X-App-Language')) headers.set('X-App-Language', lang);
        return originalFetch(input, Object.assign({}, init, { headers }));
    };
})();

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

        // The shared dialogs and toasts (confirm-dialog.js) and serverText()
        // read window.texts; the main page sets it itself, every subpage
        // gets it here.
        if (!window.texts) window.texts = this.texts;

        // The texts exist now; the elements only once the page is parsed.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.applyTranslations(), { once: true });
        } else {
            this.applyTranslations();
        }
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
        // Screen-reader labels and image alternatives, the same pattern.
        document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            const t = this.getText(el.getAttribute('data-i18n-aria-label'));
            if (t) el.setAttribute('aria-label', t);
        });
        document.querySelectorAll('[data-i18n-alt]').forEach(el => {
            const t = this.getText(el.getAttribute('data-i18n-alt'));
            if (t) el.setAttribute('alt', t);
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

// The global instance right away -- the language files sit before this script
// on every page, and page scripts read their texts while the page is still
// loading (users.html: const texts = getTexts()).
window.i18nManager = new I18nManager();

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

/**
 * A status text the server sent. With `message_key` it is translated here and
 * `message_args` fill {0}, {1} ...; without one, `message` is shown as it is --
 * the server only sends language-neutral text then ("3 ⬇️ / 0 ⬆️").
 */
window.serverText = function (data) {
    if (!data) return '';
    if (!data.message_key) return data.message || '';
    const text = (window.texts || {})[data.message_key];
    if (!text) {
        console.warn(`serverText: no translation for ${data.message_key} -- showing the server's text`);
        return data.message || '';
    }
    return (data.message_args || []).reduce((s, arg, i) => s.split(`{${i}}`).join(String(arg)), text);
};
