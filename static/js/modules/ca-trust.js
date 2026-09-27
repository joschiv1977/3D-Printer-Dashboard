/**
 * "Trust this device" -- the server's own root certificate, once per device.
 *
 * The server signs its certificate itself (services/cert_manager.py). A
 * browser that does not trust that CA shows a warning, and even after
 * clicking through it refuses the service worker: "An SSL certificate error
 * occurred when fetching the script". The dashboard then has no offline mode
 * and no web push.
 *
 * check() finds that out the same way: it registers the service worker and
 * looks at the error. render() puts the card into a container -- status, the
 * download (/ca.crt, and /ca.mobileconfig for Apple devices) and the steps for
 * the system it detected. Used by the setup wizard and the settings page.
 */
/* global module */
(function () {
    'use strict';

    const SYSTEMS = ['macos', 'ios', 'windows', 'android', 'linux'];

    /** Which system the browser runs on -- iPadOS reports itself as a Mac with touch. */
    function detectSystem() {
        const ua = navigator.userAgent || '';
        const platform = (navigator.userAgentData && navigator.userAgentData.platform)
            || navigator.platform || '';
        if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1)) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        if (/Mac/i.test(platform) || /Macintosh/.test(ua)) return 'macos';
        if (/Win/i.test(platform) || /Windows/.test(ua)) return 'windows';
        if (/Linux|X11|CrOS/i.test(platform + ' ' + ua)) return 'linux';
        return 'windows';
    }

    /**
     * Does this browser trust the server's certificate?
     * true, false, or null when it cannot be told (no HTTPS, no service worker).
     */
    async function check() {
        if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
        try {
            await navigator.serviceWorker.register('/static/sw.js');
            return true;
        } catch (e) {
            if (e && e.name === 'SecurityError') return false;
            return null;
        }
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    /**
     * Fill `container` with the card body. `t(key, fallback)` is the page's
     * translation function.
     */
    async function render(container, t) {
        if (!container) return;
        container.textContent = '';

        const status = el('div', 'ca-trust-status', t('ca_trust_checking', 'Wird geprüft …'));
        container.appendChild(status);
        container.appendChild(el('div', 'ca-trust-why',
            t('ca_trust_why', 'Der Server stellt sein Zertifikat selbst aus. Vertraut ein Gerät ihm einmal, verschwindet die Warnung im Browser, und das Dashboard läuft auch offline.')));

        const buttons = el('div', 'ca-trust-buttons');
        const crt = el('a', 'es-knopf', t('ca_trust_download', 'Zertifikat laden'));
        crt.href = '/ca.crt';
        const profile = el('a', 'es-knopf', t('ca_trust_download_profile', 'Profil laden'));
        profile.href = '/ca.mobileconfig';
        buttons.append(crt, profile);
        container.appendChild(buttons);

        const pickerLabel = el('label', 'ca-trust-picker', t('ca_trust_guide_for', 'Anleitung für'));
        const picker = document.createElement('select');
        SYSTEMS.forEach(name => {
            const option = el('option', null, t('ca_trust_os_' + name, name));
            option.value = name;
            picker.appendChild(option);
        });
        pickerLabel.appendChild(picker);
        container.appendChild(pickerLabel);

        const stepList = el('ol', 'ca-trust-steps');
        container.appendChild(stepList);
        container.appendChild(el('div', 'ca-trust-note',
            t('ca_trust_firefox', 'Firefox hat einen eigenen Speicher: Einstellungen → Datenschutz & Sicherheit → Zertifikate anzeigen → Zertifizierungsstellen → Importieren.')));

        const showSteps = (system) => {
            stepList.textContent = '';
            String(t('ca_trust_steps_' + system, '')).split('|').filter(Boolean)
                .forEach(step => stepList.appendChild(el('li', null, step.trim())));
            // The profile is what an iPhone or iPad installs; everywhere else the certificate.
            profile.style.display = system === 'ios' ? '' : 'none';
            crt.style.display = system === 'ios' ? 'none' : '';
        };
        picker.addEventListener('change', () => showSteps(picker.value));
        picker.value = detectSystem();
        showSteps(picker.value);

        const recheck = el('button', 'es-knopf', t('ca_trust_recheck', 'Erneut prüfen'));
        recheck.type = 'button';
        recheck.addEventListener('click', () => render(container, t));
        container.appendChild(recheck);

        const result = await check();
        status.className = 'ca-trust-status ' + (result === true ? 'ca-trust-ok'
            : result === false ? 'ca-trust-missing' : 'ca-trust-unknown');
        status.textContent = result === true
            ? t('ca_trust_ok', 'Dieses Gerät vertraut dem Server.')
            : result === false
                ? t('ca_trust_missing', 'Dieses Gerät vertraut dem Server noch nicht.')
                : t('ca_trust_unknown', 'Ob dieses Gerät dem Server vertraut, lässt sich hier nicht prüfen.');
        return result;
    }

    const api = { check, detectSystem, render };
    if (typeof window !== 'undefined') window.CaTrust = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
