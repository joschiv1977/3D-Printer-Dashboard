/**
 * The filament amount hint
 *
 * During a running print the companion compares the weight recorded in the
 * gcode (`filament_weight_total`) with what is left on the active Spoolman
 * spool and puts the result into its status snapshot as `filament_amount`.
 *
 * The hint exists above all for prints that go straight from the slicer to the
 * printer: no pre-check runs there, and the file only becomes visible once it
 * is already printing. The preparation takes up to 20 minutes, though -- enough
 * time to swap the spool and keep the print.
 *
 * PURELY INFORMATIONAL. Nothing here interferes with the print, there is no
 * abort. Too little filament is not an error -- the print may run anyway.
 *
 * Klipper direct only: with the Bambu backend there is no companion, and
 * nothing is asked there at all (see _isDirectMode).
 */
class FilamentAmountManager {
    constructor() {
        this.POLL_MS = 30000;
        // Dismissed once per file, it stays dismissed -- the value no longer
        // changes during a print, and coming back would be pure noise.
        this.dismissed = null;

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
     * 30 seconds. So it does not ask in the first place.
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
        try {
            const res = await this._call('/api/companion/status');
            if (!res.ok) { this.hide(); return; }
            const snap = await res.json();
            const fa = snap && snap.filament_amount;
            if (fa && fa.filename !== this.dismissed) {
                this.show(fa);
            } else {
                this.hide();
            }
        } catch (e) {
            this.hide();
        }
    }

    show(fa) {
        const banner = document.getElementById('filament-amount-banner');
        const title = document.getElementById('filament-amount-title');
        const message = document.getElementById('filament-amount-message');
        if (!banner || !message) return;

        const t = (key, fallback) =>
            (typeof getText === 'function' && getText(key)) || fallback;

        // "tight": it is enough on paper, but no longer with a reserve. Spoolman
        // only extrapolates what is left, so the buffer is not a luxury.
        const tight = !!fa.tight;
        if (title) {
            title.textContent = tight
                ? t('filament_amount_tight_title', 'Filament wird knapp')
                : t('filament_amount_short_title', 'Filament reicht vermutlich nicht');
        }

        const needed = Math.round(Number(fa.needed_g) || 0);
        const remaining = Math.round(Number(fa.remaining_g) || 0);
        const delta = Math.abs(Math.round(Number(fa.short_g) || 0));
        let text = (tight
            ? t('filament_amount_tight_message',
                'Druck braucht {needed} g, auf der Rolle sind {remaining} g — nur {delta} g Puffer.')
            : t('filament_amount_short_message',
                'Druck braucht {needed} g, auf der Rolle sind {remaining} g — {delta} g fehlen.'))
            .replace('{needed}', needed)
            .replace('{remaining}', remaining)
            .replace('{delta}', delta);

        if (fa.spool_name) text += ' (' + fa.spool_name + ')';
        if (!fa.final) {
            text += ' ' + t('filament_amount_prep_hint',
                'Die Vorbereitung läuft noch — ein Rollenwechsel jetzt wird berücksichtigt.');
        }

        message.textContent = text;
        banner.classList.add('active');
    }

    hide() {
        const banner = document.getElementById('filament-amount-banner');
        if (banner) banner.classList.remove('active');
    }

    dismiss() {
        const el = document.getElementById('filament-amount-message');
        // Remember the file from the state last shown, so the same print does
        // not pop up again on the next poll.
        this._call('/api/companion/status')
            .then(r => (r.ok ? r.json() : null))
            .then(snap => {
                const fa = snap && snap.filament_amount;
                this.dismissed = (fa && fa.filename) || (el ? el.textContent : '') || true;
            })
            .catch(() => { this.dismissed = true; });
        this.hide();
    }
}

const filamentAmountManager = new FilamentAmountManager();

function dismissFilamentAmountBanner() {
    filamentAmountManager.dismiss();
}
