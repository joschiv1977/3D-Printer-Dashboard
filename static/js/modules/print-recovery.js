/**
 * Power loss recovery
 *
 * During every print the companion records the byte-exact state
 * (`virtual_sdcard.file_position` plus the position, temperatures, offsets and
 * profiles). If the power fails or Klipper crashes, that state stays behind --
 * and as soon as Klipper is back up and nothing is printing, this banner offers
 * to resume. On resuming, X and Y are homed (the position really reached cannot
 * be reconstructed after a crash, the move queue runs up to 2s ahead) and Z
 * comes from the snapshot through SET_KINEMATIC_POSITION.
 *
 * Klipper direct only -- with the Bambu backend there is no companion that
 * could record the state. Nothing is asked there in the first place (see
 * _isDirectMode).
 */
class PrintRecoveryManager {
    constructor() {
        this.state = null;
        this.busy = false;
        this.POLL_MS = 20000;

        document.addEventListener('DOMContentLoaded', () => {
            const start = () => {
                this._isDirectMode().then(direct => {
                    if (!direct) return;   // Bambu-Backend: kein Companion
                    this.refresh();
                    setInterval(() => this.refresh(), this.POLL_MS);
                });
            };
            if (typeof deferNonCritical === 'function') {
                deferNonCritical(start);
            } else {
                start();
            }
        });
    }

    /**
     * Is the UI running against the local direct adapter? Only there is there a
     * companion. With the Bambu backend the endpoint does not exist at all --
     * the request ran into a 404 that Flask logs with a full traceback, every
     * 20 seconds. So it does not ask in the first place.
     *
     * Uses the same document-wide cached /api/config call as
     * tab-bar-manager._applyDirectMode() -- one query for the whole page.
     */
    _isDirectMode() {
        window.__directCfgPromise = window.__directCfgPromise ||
            fetch('/api/config', { credentials: 'same-origin' })
                .then(r => r.json()).catch(() => ({}));
        return window.__directCfgPromise.then(cfg => !!(cfg && cfg.direct_mode === true));
    }

    _call(url, opts) {
        const fn = window.apiCall
            || ((u, o) => fetch(u, { ...(o || {}), credentials: 'include' }));
        return fn(url, opts);
    }

    async refresh() {
        // Do not interfere while a resume is running: the companion only
        // answers after homing and heating, which takes minutes.
        if (this.busy) return;
        try {
            const res = await this._call('/api/recovery');
            if (!res.ok) { this.hide(); return; }
            const data = await res.json();
            this.state = data;
            if (data && data.available) {
                this.show(data);
            } else {
                this.hide();
            }
        } catch (e) {
            this.hide();
        }
    }

    show(data) {
        const banner = document.getElementById('recovery-banner');
        const message = document.getElementById('recovery-banner-message');
        if (!banner || !message) return;

        const name = (data.filename || '').split('/').pop();
        const pct = Number(data.progress || 0).toFixed(0);
        let text = (getText('recovery_banner_message') || '{file} — abgebrochen bei {percent}%')
            .replace('{file}', name)
            .replace('{percent}', pct);
        if (data.layer) {
            text += (getText('recovery_banner_layer') || ' (Schicht {layer})')
                .replace('{layer}', data.layer);
        }
        if (data.was_paused) {
            text += ' ' + (getText('recovery_was_paused')
                || 'Der Druck war pausiert — wird danach sofort wieder pausiert.');
        }
        if (Array.isArray(data.warnings) && data.warnings.length) {
            text += ' ' + data.warnings.join(' ');
        }
        message.textContent = text;
        banner.classList.add('active');
    }

    hide() {
        const banner = document.getElementById('recovery-banner');
        if (banner) banner.classList.remove('active');
    }

    async resume() {
        if (this.busy || !this.state || !this.state.available) return;
        const name = (this.state.filename || '').split('/').pop();
        const pct = Number(this.state.progress || 0).toFixed(0);
        let warn = (Array.isArray(this.state.warnings) && this.state.warnings.length)
            ? '\n\n' + this.state.warnings.join('\n') : '';
        if (this.state.was_paused) {
            warn += '\n\n' + (getText('recovery_was_paused')
                || 'Der Druck war pausiert — wird danach sofort wieder pausiert.');
        }
        const question = (getText('recovery_confirm')
            || 'Druck "{file}" bei {percent}% fortsetzen?\n\nDer Drucker homet X und Y, heizt auf, faehrt zurueck zur Abbruchstelle und druckt weiter.')
            .replace('{file}', name)
            .replace('{percent}', pct) + warn;

        window.showConfirmDialog(question, async () => {
            this.busy = true;
            const btn = document.querySelector('.recovery-resume-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = getText('recovery_resuming') || 'Wird fortgesetzt …';
            }
            try {
                const res = await this._call('/api/recovery/resume', { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (data.success) {
                    this.hide();
                } else {
                    alert((getText('recovery_failed') || 'Fortsetzen fehlgeschlagen')
                        + ': ' + (data.error || res.status));
                }
            } catch (e) {
                alert((getText('recovery_failed') || 'Fortsetzen fehlgeschlagen')
                    + ': ' + (e.message || e));
            } finally {
                this.busy = false;
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = getText('recovery_banner_resume') || 'Fortsetzen';
                }
            }
        });
    }

    dismiss() {
        window.showConfirmDialog(
            getText('recovery_discard_confirm')
                || 'Gespeicherten Stand verwerfen? Der Druck kann danach nicht mehr fortgesetzt werden.',
            async () => {
                try {
                    await this._call('/api/recovery/dismiss', { method: 'POST' });
                } catch (e) { /* Banner trotzdem weg */ }
                this.state = null;
                this.hide();
            });
    }
}

window.printRecoveryManager = new PrintRecoveryManager();
window.resumeInterruptedPrint = () => window.printRecoveryManager.resume();
window.dismissRecoveryBanner = () => window.printRecoveryManager.dismiss();
