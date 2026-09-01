/**
 * Confirm Dialog Manager
 * Custom confirmation dialog replacing native confirm()
 */
/**
 * Ein Fenster ueber alles legen, was gerade sichtbar ist.
 *
 * Feste z-index-Zahlen gehen schief, sobald ein Dialog aus einem Dialog
 * aufgeht: die Bestaetigung stand auf 9999, der Fach-Dialog auf 10050 —
 * also lag die Frage dahinter und war nicht zu sehen.
 */
window.skNachVorn = function (el, mindestens) {
    let oben = mindestens || 1000;
    document.querySelectorAll('body *').forEach(k => {
        if (k === el || el.contains(k)) return;
        const st = getComputedStyle(k);
        if (st.position !== 'fixed' || st.display === 'none' || st.visibility === 'hidden') return;
        const z = parseInt(st.zIndex, 10);
        if (!isNaN(z) && z > oben) oben = z;
    });
    el.style.zIndex = String(oben + 10);
    return el;
};

class ConfirmDialogManager {
    show(message, onConfirm, onCancel) {
        // Remove any existing confirm dialog
        const existing = document.getElementById('customConfirmDialog');
        if (existing) existing.remove();

        const texts = window.texts || {};

        const modal = document.createElement('div');
        modal.id = 'customConfirmDialog';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:block; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999;';

        modal.innerHTML = `
            <div class="modal-panel sd-modal-panel" style="max-width:420px;">
                <div class="sd-modal-header">
                    <h2 class="sd-modal-title">${texts.confirm_title || 'Bestätigung'}</h2>
                    <div class="sd-header-actions">
                        <button class="sd-close-btn" id="confirm-close-btn">&times;</button>
                    </div>
                </div>
                <div class="sd-modal-body">
                    <div style="color:var(--text-primary); font-size:14px; line-height:1.6; white-space:pre-wrap;">${message}</div>
                    <div class="temp-actions" style="margin-top:20px;">
                        <button class="temp-btn temp-btn--cancel" id="confirm-cancel-btn">${texts.cancel || 'Abbrechen'}</button>
                        <button class="temp-btn temp-btn--apply" id="confirm-ok-btn" style="background:rgba(244,67,54,0.12); border-color:rgba(244,67,54,0.25); color:#c62828;">${texts.confirm_ok || 'OK'}</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        window.skNachVorn(modal, 9999);

        const closeDialog = (result) => {
            modal.remove();
            if (result && onConfirm) onConfirm();
            else if (!result && onCancel) onCancel();
        };

        document.getElementById('confirm-ok-btn').addEventListener('click', () => closeDialog(true));
        document.getElementById('confirm-cancel-btn').addEventListener('click', () => closeDialog(false));
        document.getElementById('confirm-close-btn').addEventListener('click', () => closeDialog(false));
        modal.addEventListener('click', (e) => { if (e.target === modal) closeDialog(false); });

        // Focus Cancel button
        document.getElementById('confirm-cancel-btn').focus();
    }
}

// Global singleton
window.confirmDialogManager = new ConfirmDialogManager();

// Backwards compatibility
window.showConfirmDialog = (message, onConfirm, onCancel) => window.confirmDialogManager.show(message, onConfirm, onCancel);

// Promise-Variante (statt nativem confirm): `if (!await skConfirm(msg)) return;`
// SELBSTSTÄNDIG (eigene Inline-Styles) → funktioniert auf JEDER Seite, auch ohne
// das App-CSS (Unterseiten wie settings/slicer/maintenance laden es nicht).
window.skConfirm = (message, opts) => new Promise((resolve) => {
    const o = opts || {};
    const texts = window.texts || {};
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    const panel = document.createElement('div');
    panel.style.cssText = "background:#1f2733;color:#f3f5f8;border-radius:16px;max-width:420px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.45);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;";
    const title = document.createElement('div');
    title.style.cssText = 'padding:16px 18px 0;font-size:16px;font-weight:800;';
    title.textContent = o.title || texts.confirm_title || 'Bestätigung';
    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 18px 0;white-space:pre-wrap;word-break:break-word;color:#cdd5df;';
    body.textContent = String(message == null ? '' : message);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;padding:18px;';
    const mkBtn = (label, bg, fg, border) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `padding:9px 16px;border-radius:9px;border:1px solid ${border};background:${bg};color:${fg};font-weight:700;font-size:13px;cursor:pointer;`;
        return b;
    };
    const cancel = mkBtn(o.cancelText || texts.cancel || 'Abbrechen', 'transparent', '#cdd5df', 'rgba(255,255,255,.18)');
    const ok = mkBtn(o.okText || texts.confirm_ok || 'OK', o.danger ? '#dc2626' : '#2196f3', '#fff', 'transparent');
    row.appendChild(cancel); row.appendChild(ok);
    panel.appendChild(title); panel.appendChild(body); panel.appendChild(row);
    ov.appendChild(panel); document.body.appendChild(ov);
    if (window.skNachVorn) window.skNachVorn(ov, 2147483640);
    const done = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
    document.addEventListener('keydown', onKey);
    ok.focus();
});

// Selbststaendiger Toast (ersetzt natives alert()). Bringt eigenes CSS mit
// und laeuft daher auf JEDER Seite gleich — auch auf den Unterseiten
// (settings, logs, slicer), die das App-CSS nicht laden.
//
// Aufbau seit 21aug26 nach dem freigegebenen Entwurf: oben rechts statt unten
// mittig, Typ an Farbstreifen und Symbol erkennbar, zweite Zeile fuer den
// Bezug ("Spule aktiviert" allein sagt nicht welche), optionale Handlung
// daneben, Restzeit als Balken, Stapel statt Ueberschreiben.
//
// skToast(text)                      — wie bisher
// skToast(text, 'success')           — Typ erzwingen
// skToast(text, 'success', 6000)     — Dauer in ms (Rueckwaertskompatibel)
// skToast(text, 'success', { detail, farbe, aktion: {text, onClick}, dauer })
(function () {
    'use strict';

    const TOENE = {
        success: { strich: '#4CAF50', flaeche: 'rgba(76,175,80,.15)',  text: '#2e7d32',
                   pfad: '<path d="m5 13 4 4L19 7"/>' },
        error:   { strich: '#E5534B', flaeche: 'rgba(229,83,75,.15)',  text: '#E5534B',
                   pfad: '<path d="M6 6l12 12M18 6L6 18"/>' },
        warning: { strich: '#FF9800', flaeche: 'rgba(255,152,0,.16)',  text: '#b26a00',
                   pfad: '<path d="M12 9v5M12 17.5v.5"/><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>' },
        info:    { strich: '#2196F3', flaeche: 'rgba(33,150,243,.14)', text: '#1668a8',
                   pfad: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>' },
    };

    function stelleCssBereit() {
        if (document.getElementById('sk-toast-css')) return;
        const st = document.createElement('style');
        st.id = 'sk-toast-css';
        st.textContent = `
#sk-toast-host{position:fixed;top:18px;right:18px;z-index:2147483600;display:flex;
  flex-direction:column;gap:9px;width:376px;max-width:calc(100vw - 28px);pointer-events:none}
.sk-toast{position:relative;display:flex;gap:11px;align-items:flex-start;padding:11px 12px;
  background:var(--bg-card,#1f2733);color:var(--text-primary,#f3f5f8);
  border:1px solid var(--border-color,rgba(255,255,255,.12));border-radius:12px;
  box-shadow:0 6px 20px rgba(0,0,0,.22);overflow:hidden;pointer-events:auto;cursor:default;
  font:500 13.5px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  opacity:0;transform:translateX(12px);transition:opacity .18s,transform .18s}
.sk-toast.sk-an{opacity:1;transform:translateX(0)}
.sk-toast::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--sk-strich)}
.sk-toast-ic{width:26px;height:26px;border-radius:50%;flex:none;display:grid;place-items:center;
  background:var(--sk-flaeche);color:var(--sk-text)}
.sk-toast-ic svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;
  stroke-linecap:round;stroke-linejoin:round}
.sk-toast-text{flex:1;min-width:0}
.sk-toast-titel{font-weight:640;margin-bottom:1px;word-break:break-word}
.sk-toast-detail{font-size:12px;color:var(--text-secondary,#b9c2cd);display:flex;align-items:center;
  gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sk-toast-punkt{width:9px;height:9px;border-radius:50%;flex:none;border:1px solid rgba(128,128,128,.35)}
.sk-toast-akt{border:0;background:none;color:#2196F3;font:inherit;font-size:12px;font-weight:600;
  cursor:pointer;padding:2px 4px;border-radius:6px;flex:none;align-self:center}
.sk-toast-akt:hover{background:rgba(33,150,243,.12)}
.sk-toast-zu{border:0;background:none;color:var(--text-secondary,#b9c2cd);cursor:pointer;
  font-size:15px;line-height:1;padding:0 2px;flex:none}
.sk-toast-balken{position:absolute;left:0;bottom:0;height:2px;background:var(--sk-strich);opacity:.4;
  width:100%}
`;
        document.head.appendChild(st);
    }

    function hole(text) { return (window.texts || {})[text]; }

    window.skToast = function (message, type, drittes) {
        // Aufruf-Varianten: drittes darf Zahl (Dauer) oder Objekt sein.
        const o = (drittes && typeof drittes === 'object') ? drittes : {};
        const dauer = (typeof drittes === 'number' ? drittes : o.dauer) || 4000;

        // Typ aus fuehrendem Status-Emoji ableiten und das Emoji entfernen —
        // der Toast bringt sein eigenes Symbol mit. So bleibt jeder alte
        // Aufruf skToast('…', 'success') unveraendert richtig.
        let msg = String(message == null ? '' : message);
        const m = msg.match(/^\s*(✅|✔️?|⚠️?|❌|⛔|🚫|ℹ️?|🖨️?|📹|🌡️?|🔌|💧|⏹️?|🎨|📥|🧵)\s*/u);
        if (m) {
            const zeichen = m[1];
            if (!type) {
                type = /✅|✔/.test(zeichen) ? 'success'
                     : /⚠/.test(zeichen) ? 'warning'
                     : /❌|⛔|🚫/.test(zeichen) ? 'error' : 'info';
            }
            msg = msg.slice(m[0].length);
        }
        if (!type) type = 'info';
        const ton = TOENE[type] || TOENE.info;

        stelleCssBereit();
        let host = document.getElementById('sk-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'sk-toast-host';
            document.body.appendChild(host);
        }

        const el = document.createElement('div');
        el.className = 'sk-toast';
        el.style.setProperty('--sk-strich', ton.strich);
        el.style.setProperty('--sk-flaeche', ton.flaeche);
        el.style.setProperty('--sk-text', ton.text);

        const sicher = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const punkt = o.farbe
            ? `<span class="sk-toast-punkt" style="background:${sicher(o.farbe)}"></span>` : '';
        const detail = o.detail
            ? `<div class="sk-toast-detail">${punkt}${sicher(o.detail)}</div>` : '';
        const aktion = (o.aktion && o.aktion.text)
            ? `<button class="sk-toast-akt">${sicher(o.aktion.text)}</button>` : '';

        el.innerHTML = `
            <span class="sk-toast-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ton.pfad}</svg></span>
            <div class="sk-toast-text">
                <div class="sk-toast-titel">${sicher(msg)}</div>
                ${detail}
            </div>
            ${aktion}
            <button class="sk-toast-zu" aria-label="${sicher(hole('cancel') || 'Schliessen')}">×</button>
            <div class="sk-toast-balken"></div>`;

        // Neueste oben — man liest von oben.
        host.insertBefore(el, host.firstChild);
        requestAnimationFrame(() => el.classList.add('sk-an'));

        const balken = el.querySelector('.sk-toast-balken');
        let ende = Date.now() + dauer;
        let uhr = null;

        const schliessen = () => {
            if (uhr) clearTimeout(uhr);
            el.classList.remove('sk-an');
            setTimeout(() => el.remove(), 200);
        };
        const laufen = () => {
            const rest = Math.max(0, ende - Date.now());
            balken.style.transition = `width ${rest}ms linear`;
            requestAnimationFrame(() => { balken.style.width = '0%'; });
            uhr = setTimeout(schliessen, rest);
        };
        const anhalten = () => {
            if (uhr) { clearTimeout(uhr); uhr = null; }
            const breite = balken.getBoundingClientRect().width;
            const gesamt = el.getBoundingClientRect().width || 1;
            balken.style.transition = 'none';
            balken.style.width = `${(breite / gesamt) * 100}%`;
        };

        laufen();
        // Mit der Maus darauf haelt die Zeit an — sonst verschwindet die
        // Meldung genau dann, wenn man sie liest.
        el.addEventListener('mouseenter', anhalten);
        el.addEventListener('mouseleave', () => {
            const anteil = parseFloat(balken.style.width) || 0;
            ende = Date.now() + (anteil / 100) * dauer;
            laufen();
        });

        el.querySelector('.sk-toast-zu').addEventListener('click', schliessen);
        if (aktion) {
            el.querySelector('.sk-toast-akt').addEventListener('click', () => {
                schliessen();
                if (typeof o.aktion.onClick === 'function') o.aktion.onClick();
            });
        }
        return { schliessen };
    };
})();

/**
 * Erfolgs- und Fehlermeldungen der Unterseiten.
 *
 * Vorher hatte jede Seite ihren eigenen Weg: Wartung und Benutzer zeigten
 * einen Balken im Seitenfluss, der den Inhalt verschob; lief die Seite in
 * der Electron-App, uebernahm deren window.showToast und blendete einen
 * Dialog MITTEN ins Bild, den man wegklicken musste — fuer ein "erledigt
 * markiert". Jetzt ueberall derselbe Stapel oben rechts wie bei allen
 * anderen Meldungen.
 *
 * Bewusst ein eigener Name: window.showSuccess/showToast belegt die
 * Electron-App selbst, je nach Ladereihenfolge gewinnt mal die eine, mal
 * die andere Fassung.
 */
(function () {
    'use strict';

    function melde(text, art, titel) {
        if (typeof window.skToast === 'function') {
            window.skToast(String(text || ''), art, titel ? { detail: '' } : undefined);
            return;
        }
        // Ohne Toast-System (sollte nicht vorkommen): wenigstens die Konsole.
        console[art === 'error' ? 'error' : 'log'](text);
    }

    window.skHinweis = {
        erfolg: (text) => melde(text, 'success'),
        fehler: (text) => melde(text, 'error'),
        info:   (text) => melde(text, 'info')
    };
})();
