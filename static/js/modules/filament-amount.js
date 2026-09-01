/**
 * Filament-Mengen-Hinweis
 *
 * Der Companion vergleicht waehrend eines laufenden Drucks das im Gcode
 * hinterlegte Gewicht (`filament_weight_total`) mit der Restmenge der aktiven
 * Spoolman-Rolle und legt das Ergebnis als `filament_amount` in seinen
 * Status-Snapshot.
 *
 * Der Hinweis existiert vor allem fuer Drucke, die direkt aus dem Slicer an den
 * Drucker gehen: dort laeuft kein Vorab-Check, die Datei wird erst sichtbar wenn
 * sie schon druckt. Die Vorbereitung dauert aber bis zu 20 Minuten — genug Zeit,
 * die Rolle zu tauschen und den Druck zu behalten.
 *
 * REIN INFORMATIV. Nichts hier greift in den Druck ein, es gibt keinen Abbruch.
 * Zu wenig Filament ist kein Fehler — der Druck darf trotzdem laufen.
 *
 * Nur Klipper-Direct: beim Bambu-Backend gibt es keinen Companion, dort wird
 * gar nicht erst gefragt (siehe _isDirectMode).
 */
class FilamentAmountManager {
    constructor() {
        this.POLL_MS = 30000;
        // Pro Datei einmal weggeklickt bleibt es weg — der Wert aendert sich
        // waehrend eines Drucks nicht mehr, ein Wiederauftauchen waere nur Laerm.
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
     * Laeuft die UI gegen den lokalen Direct-Adapter? Nur dort gibt es einen
     * Companion. Beim Bambu-Backend existiert der Endpoint gar nicht — die
     * Anfrage lief in einen 404, den Flask mit vollem Traceback protokolliert,
     * und das alle 30 Sekunden. Also erst gar nicht fragen.
     *
     * Nutzt denselben dokumentweit gecachten /api/config-Abruf wie
     * tab-bar-manager._applyDirectMode() — eine Abfrage fuer die ganze Seite.
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

        // "knapp": reicht rechnerisch noch, aber nicht mehr mit Reserve. Spoolman
        // rechnet die Restmenge selbst nur hoch, darum ist der Puffer kein Luxus.
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
        // Datei aus dem zuletzt gezeigten Zustand merken, damit derselbe Druck
        // nicht beim naechsten Poll wieder aufpoppt.
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
