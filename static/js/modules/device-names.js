/* ==========================================================================
   Geraete-Namen  (05sep26)
   --------------------------------------------------------------------------
   Wie ein Geraet heisst, steht ab jetzt an EINER Stelle.

   Die Regel gab es schon, aber nur eingebaut in die Geraeteliste unter
   Benutzer. Der Meldungs-Verlauf kannte sie nicht und schrieb statt des
   Namens die Plattform: "gelesen auf Desktop". Mit zwei Rechnern sagt das
   nichts mehr, und der Server weiss die ganze Zeit, welcher es war -- die
   Kennung in `read_by` ist genau die aus `/api/auth/sessions`.

   Benutzung:
       geraeteNamen.nameVon(eintrag)        // aus einem Sitzungseintrag
       await geraeteNamen.laden()           // Tabelle holen (einmal)
       geraeteNamen.name('electron_f3d9…')  // Name oder Plattform-Rueckfall
   ========================================================================== */
(function () {
    'use strict';

    // What Electron reports when it has nothing better: the platform triple.
    // Then the hostname says more than the model.
    const GENERISCH = /^(darwin|win32|linux)-(arm64|x64|ia32)$/i;

    /**
     * The name of one session entry.
     *
     * "Electron App on macOS" and "Mac mini (M4, 2024)" are the same machine,
     * named differently: the model wins, and the platform is shown as a chip
     * beside it. A browser session has no model worth showing, so there the
     * name is what the server made of the user agent.
     */
    function nameVon(eintrag) {
        if (!eintrag) return '';
        const name = eintrag.device_name || '';
        const modell = eintrag.device_model || '';
        if (eintrag.type === 'web') return name || modell || '';
        if (modell && !GENERISCH.test(modell)) return modell;
        return name || modell || '';
    }

    // The platform, when there is no name -- the old behaviour, kept as the
    // fallback. A device that has been logged out is gone from the session
    // list, but its notifications stay in the history.
    function plattform(kennung) {
        if (!kennung) return '?';
        if (kennung.startsWith('ios_')) return 'iOS';
        if (kennung.startsWith('electron_')) return 'Desktop';
        if (kennung.startsWith('android_')) return 'Android';
        if (kennung.startsWith('web_') || kennung.startsWith('web:')) return 'Web';
        if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(kennung)) {
            return 'iOS';
        }
        return kennung.split(/[:_-]/)[0];
    }

    let tabelle = null;      //: Kennung -> Name
    let laeuft = null;       //: the running request, so ten callers make one call

    /** Fetch the table once. Repeat calls get the same promise. */
    function laden() {
        if (tabelle) return Promise.resolve(tabelle);
        if (laeuft) return laeuft;
        const ruf = window.apiCall
            || ((url, opt) => fetch(url, Object.assign({ credentials: 'include' }, opt)));
        laeuft = ruf('/api/auth/sessions')
            .then(a => (a && a.ok) ? a.json() : null)
            .then(daten => {
                // A flat list, one entry per session -- see list_sessions in
                // services/auth_system.py.
                const neu = {};
                for (const eintrag of (Array.isArray(daten) ? daten : [])) {
                    const name = nameVon(eintrag);
                    if (!name) continue;
                    // Both identifiers point at the same name. An Electron
                    // client appears twice -- registration and window -- and
                    // whichever of the two marked the message is the one that
                    // ends up in `read_by`.
                    for (const kennung of [eintrag.device_id, eintrag.session_id,
                                           eintrag.verknuepftes_geraet]) {
                        if (kennung) neu[String(kennung)] = name;
                    }
                }
                tabelle = neu;
                return tabelle;
            })
            .catch(() => { tabelle = {}; return tabelle; })
            .finally(() => { laeuft = null; });
        return laeuft;
    }

    /** The name for this id -- platform as the fallback. */
    function name(kennung) {
        if (!kennung) return '?';
        const treffer = tabelle && tabelle[String(kennung)];
        return treffer || plattform(kennung);
    }

    /** Forget the table -- after a device was logged out or renamed. */
    function vergiss() { tabelle = null; }

    window.deviceNames = { nameVon, name, plattform, laden, vergiss };
})();
