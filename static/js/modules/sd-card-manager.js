/**
 * SD Card Manager
 * Handles SD card file browsing, upload, delete, rename, sorting/filtering,
 * print options popovers and sync status. Die Vergroesserung beim
 * Ueberfahren macht thumb-preview.js fuer die ganze Oberflaeche.
 */
class SDCardManager {
    constructor() {
        const texts = window.texts || {};

        // Track ob Auto-Sync läuft
        this.sdSyncInProgress = false;


        // Auto-Close für Print-Options Dropdowns
        this._initAutoCloseDropdowns();

        // Close popovers when clicking outside
        this._initPopoverCloseHandler();
    }

    // ========================================
    // showSDFiles — open modal + load file list
    // ========================================
    showSDFiles(forceRefresh = false) {
        // Klipper-Branch: schlanke Datei-Liste via printerAdapter, ohne
        // Bambu-spezifische AMS/Plate/Spool-Picker. Bambu-Logik unten
        // bleibt 1:1 unangetastet.
        if (window.isKlipperMode && window.isKlipperMode()) {
            return this._showKlipperFiles();
        }
        const texts = window.texts || {};

        // Spoolman Spulen HTML aus dem Haupt-Selector kopieren
        if (window.spoolmanManager && window.spoolmanManager.connected) {
            window.spoolmanSpoolsHtml = '';
            const mainSelector = document.getElementById('spool-selector');
            if (mainSelector && mainSelector.options.length > 1) {
                for (let i = 1; i < mainSelector.options.length; i++) {
                    const opt = mainSelector.options[i];
                    const selected = opt.value == window.activeSpoolId ? 'selected' : '';
                    window.spoolmanSpoolsHtml += `<option value="${opt.value}" ${selected}>${opt.text}</option>`;
                }
            }
        }

        document.getElementById('sdCardModal').style.display = 'block';

        // Alte Upload-Status entfernen falls vorhanden
        const oldStatus = document.getElementById('upload-status');
        if (oldStatus) {
            oldStatus.remove();
        }

        // Bei Auto-Sync: Zeige Info-Banner OBEN
        if (this.sdSyncInProgress && !forceRefresh) {
            const modalContent = document.querySelector('#sdCardModal > div');

            // Entferne altes Banner falls vorhanden
            const existingBanner = document.getElementById('sync-banner');
            if (existingBanner) {
                existingBanner.remove();
            }

            // Erstelle neues Banner
            const syncBanner = document.createElement('div');
            syncBanner.id = 'sync-banner';
            syncBanner.style.cssText = `
                background: linear-gradient(90deg, var(--accent-green), var(--accent-blue));
                color: white;
                padding: 10px 15px;
                border-radius: 8px;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 13px;
            `;
            syncBanner.innerHTML = `
                <div class="loading" style="width:16px; height:16px;"></div>
                <span>Hintergrund-Sync läuft... Neue Dateien werden automatisch hinzugefügt</span>
            `;

            // Füge Banner nach der Überschrift ein
            const h2 = modalContent.querySelector('h2');
            if (h2 && h2.nextSibling) {
                modalContent.insertBefore(syncBanner, h2.nextSibling);
            }

            // Deaktiviere NUR den Aktualisieren-Button
            const refreshBtn = document.getElementById('sd-refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = true;
                refreshBtn.style.opacity = '0.5';
                refreshBtn.innerHTML = window.skIcon('sanduhr') + '<span>' + (texts.sync_running || 'Sync läuft…') + '</span>';
            }

            // KEIN Loading anzeigen - direkt Cache laden!
            document.getElementById('sd-loading').style.display = 'none';
            // Deaktiviere NUR den Aktualisieren-Button
            const syncRefreshBtn = document.getElementById('sd-refresh-btn');  // Anderer Name!
            if (syncRefreshBtn) {
                syncRefreshBtn.disabled = true;
                syncRefreshBtn.style.opacity = '0.5';
                syncRefreshBtn.innerHTML = window.skIcon('sanduhr') + '<span>' + (texts.sync_running || 'Sync läuft…') + '</span>';
            }

        }

        // Erweiterte Animation nur bei Force Refresh
        let progressInterval = null;
        let startTime = null;

        if (forceRefresh) {
            // Der Abgleich zeigt sich im KOPF, nicht in der Liste.
            //
            // Vorher stand er als Block in #sd-loading mittendrin: er
            // erschien, schob die ganze Liste nach unten, verschwand, und
            // alles rutschte zurueck. Bei zwei Sekunden Dauer war das nur
            // Gezappel. Jetzt laeuft ein duenner Faden unter der Kopfzeile
            // und der Aktualisieren-Knopf fuellt sich — die Rueckmeldung
            // sitzt da, wo man gedrueckt hat, und verdeckt nichts.
            //
            // Nur wenn noch GAR keine Liste da ist (erstes Oeffnen), bekommt
            // der Abgleich die Flaeche: dort schiebt er nichts weg.
            const listeDa = document.querySelectorAll('#sd-files-list .sd-zeile,'
                + ' #sd-files-list .sd-file-card').length > 0;
            document.getElementById('sd-error').style.display = 'none';

            if (listeDa) {
                document.getElementById('sd-loading').style.display = 'none';
                this._syncKopfAn();
            } else {
                document.getElementById('sd-loading').style.display = 'block';
                document.getElementById('sd-loading').innerHTML = `
                    <div class="sd-sync-gross">
                        <span class="sd-sync-kreisel"></span>
                        <div class="sd-sync-titel">${texts.syncing_with_printer}</div>
                        <div class="sd-sync-balken"><i id="refresh-progress-bar"></i></div>
                        <div class="sd-sync-rest" id="refresh-status">${texts.connecting_to_printer}</div>
                    </div>`;
            }

            // Fortschritt schaetzen — der Drucker meldet keinen.
            let progress = 0;
            progressInterval = setInterval(() => {
                if (progress >= 90) return;
                progress = Math.min(progress + Math.random() * 15, 90);
                this._syncStand(progress, texts);
            }, 200);

            startTime = Date.now();

        } else if (!this.sdSyncInProgress) {
            // Normales Laden - zeige kurz Loading
            document.getElementById('sd-loading').style.display = 'block';
            document.getElementById('sd-loading').innerHTML = `
                <div class="loading"></div>
                <p style="color:var(--text-secondary); margin-top:10px;">${texts.loading_from_cache}</p>
            `;
            document.getElementById('sd-error').style.display = 'none';
        }

        // Lade Dateien (Cache oder Force Refresh)
        // Beim Oeffnen und beim Aktualisieren immer Seite 1 mit den
        // aktuellen Bedienelementen — Suche/Sortierung bleiben erhalten.
        if (!this.sdAbfrage) this.sdAbfrage = { page: 1, per_page: 25, sort: 'date' };
        this.sdAbfrage.page = 1;
        const _p = new URLSearchParams();
        _p.set('page', 1);
        _p.set('per_page', this.sdAbfrage.per_page || 25);
        if (this.sdAbfrage.sort) _p.set('sort', this.sdAbfrage.sort);
        if (this.sdAbfrage.search) _p.set('search', this.sdAbfrage.search);
        if (this.sdAbfrage.only_new) _p.set('only_new', 'true');
        if (forceRefresh) _p.set('force_refresh', 'true');
        else if (this.druckerAus()) _p.set('cache_only', 'true');

        apiCall('/api/mqtt/sdcard?' + _p.toString())
            .then(response => {
                // Prüfe auf FTPS-Konflikt (409)
                if (response.status === 409) {
                    return response.json().then(data => {
                        // FTPS ist beschäftigt - zeige Meldung
                        if (progressInterval) clearInterval(progressInterval);
                        document.getElementById('sd-loading').style.display = 'none';
                        this._syncKopfAus();

                        skToast(data.message || 'FTPS beschäftigt - bitte warten', 'warning');

                        // Zeige trotzdem Cache-Dateien wenn vorhanden —
                        // der Server schickt auch im Konfliktfall Seite,
                        // Seitenzahl und Gesamtzahl mit.
                        if (data.files && data.files.length > 0) {
                            this.baueWerkzeugleiste();
                            this.zeigeSeite(data);
                        }
                        return null;  // Verhindere weitere Verarbeitung
                    });
                }
                return response.json();
            })
            .then(data => {
                if (!data) return;  // War ein 409 Konflikt

                // Bei Force Refresh: Progress auf 100% und Status updaten
                if (forceRefresh && progressInterval) {
                    clearInterval(progressInterval);

                    const progressBar = document.getElementById('refresh-progress-bar');
                    if (progressBar) progressBar.style.width = '100%';

                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    const statusElement = document.getElementById('refresh-status');
                    if (statusElement) {
                        statusElement.textContent = texts.updated_in.replace('{duration}', duration);
                    }
                    this._syncStand(100, texts);

                    // Kurz auf 100 stehen lassen, dann weg.
                    setTimeout(() => {
                        document.getElementById('sd-loading').style.display = 'none';
                        this._syncKopfAus();
                        skToast(texts.files_updated.replace('{count}', data.files.length).replace('{duration}', duration), 'success');
                    }, 600);

                } else {
                    // Normales Laden - sofort ausblenden
                    document.getElementById('sd-loading').style.display = 'none';
                }

                document.getElementById('sd-files-container').style.display = 'block';
                this.baueWerkzeugleiste();
                // Eine Stelle fuer beide Faelle: zeigeSeite zeichnet die
                // Liste ODER den Leer-Hinweis und setzt die Blaetterleiste.
                this.zeigeSeite(data);
            })
            .catch(error => {
                if (progressInterval) {
                    clearInterval(progressInterval);
                }
                console.error(texts.console_sd_card_error + ':', error);
                document.getElementById('sd-loading').style.display = 'none';
                document.getElementById('sd-error').style.display = 'block';
            })
            .finally(() => {
                // Lade Print-Defaults NACH dem Rendering
                this.loadPrintDefaults();
            });
    }

    // ========================================
    /**
     * Ist der Drucker gerade aus?
     *
     * Die Dateiliste selbst braucht ihn nicht — sie kommt aus dem
     * Dateispiegel des Servers. Drucken, Loeschen und der Abgleich mit dem
     * Drucker brauchen ihn sehr wohl; die werden dann gesperrt.
     *
     * Unbekannter Zustand (noch kein Status geladen) gilt NICHT als aus —
     * sonst waere direkt nach dem Laden alles grundlos gesperrt.
     */
    druckerAus() {
        return window.lastKnownSwitchState === 'off';
    }

    /**
     * Abgleichen und Hochladen brauchen den Drucker — beide laufen ueber
     * FTPS. Bei ausgeschaltetem Drucker werden sie gesperrt, statt in
     * Zeitueberschreitungen zu laufen. Die Liste selbst bleibt lesbar.
     */
    setzeKopfKnoepfe() {
        const texts = window.texts || {};
        const aus = this.druckerAus();
        const grund = texts.sd_printer_off || 'Drucker ist aus';

        const abgleich = document.getElementById('sd-refresh-btn');
        if (abgleich && !abgleich.classList.contains('sd-refresh--laeuft')) {
            abgleich.disabled = aus;
            abgleich.title = aus ? grund : (texts.sd_refresh || '');
            abgleich.style.opacity = aus ? '0.45' : '';
        }

        // Das Hochladen haengt an einem <label>; ein label kennt kein
        // disabled, also das Eingabefeld sperren und das Label abdunkeln.
        const feld = document.getElementById('sd-file-upload');
        if (feld) feld.disabled = aus;
        const marke = document.querySelector('label[for="sd-file-upload"]');
        if (marke) {
            marke.style.opacity = aus ? '0.45' : '';
            marke.style.pointerEvents = aus ? 'none' : '';
            marke.title = aus ? grund : '';
        }
    }

    // applySDFilters — liest die Bedienelemente und holt Seite 1
    //
    // Sucht, filtert und sortiert NICHT mehr selbst. Das macht der Server
    // (routes/sdcard.py::_seitenweise), und zwar ueber den ganzen Bestand
    // statt nur ueber die 25 sichtbaren Dateien — sonst faende man eine
    // Datei auf Seite 7 nicht.
    //
    // Jede Aenderung an Suche, Sortierung oder Filter springt zurueck auf
    // Seite 1: das Ergebnis ist ein anderes, "Seite 4" darin waere Zufall.
    // ========================================
    applySDFilters() {
        const suchFeld = document.getElementById('sd-search-input');
        const suchHuelle = document.getElementById('sd-search-wrap');
        const suche = suchFeld ? suchFeld.value.trim() : '';
        if (suchHuelle) suchHuelle.classList.toggle('has-value', suche.length > 0);

        this.sdAbfrage = {
            search: suche,
            sort: document.getElementById('sd-sort-select')?.value || 'date',
            only_new: !!document.getElementById('sd-filter-new')?.checked,
            page: 1,
            per_page: this.sdAbfrage?.per_page || 25,
        };
        this.ladeSeite();
    }

    /**
     * Holt eine Seite vom Server und zeichnet sie.
     *
     * Ohne force_refresh — Blaettern und Suchen sollen NIE eine Verbindung
     * zum Drucker aufmachen. Der Server beantwortet das aus seinem lokalen
     * Dateispiegel; FTPS laeuft nur beim Aktualisieren-Knopf.
     */
    ladeSeite() {
        const a = this.sdAbfrage || (this.sdAbfrage = { page: 1, per_page: 25, sort: 'date' });
        const p = new URLSearchParams();
        p.set('page', a.page);
        p.set('per_page', a.per_page);
        if (a.sort) p.set('sort', a.sort);
        if (a.search) p.set('search', a.search);
        if (a.only_new) p.set('only_new', 'true');
        // Drucker aus: nur den Spiegel lesen. Ohne das versucht der Server
        // bei leerem Cache eine FTPS-Verbindung und laeuft in Timeouts.
        if (this.druckerAus()) p.set('cache_only', 'true');

        // Laufende Abfrage merken: tippt man schnell, koennen Antworten in
        // falscher Reihenfolge eintreffen. Nur die juengste zaehlt.
        const marke = (this._sdMarke = (this._sdMarke || 0) + 1);

        return apiCall('/api/mqtt/sdcard?' + p.toString())
            .then(r => r.json())
            .then(daten => {
                if (marke !== this._sdMarke) return;
                this.zeigeSeite(daten);
            })
            .catch(fehler => {
                console.error('SD page not loaded:', fehler);
            });
    }

    /**
     * Zeichnet eine Server-Antwort: Liste, Zaehler, Blaetterleiste.
     * Eine Stelle fuer beide Betriebsarten (Bambu wie Klipper).
     */
    zeigeSeite(daten) {
        const texts = window.texts || {};
        const dateien = (daten && daten.files) || [];
        this.sdKopf = {
            total: daten?.total ?? dateien.length,
            page: daten?.page ?? 1,
            pages: daten?.pages ?? 1,
            per_page: daten?.per_page ?? dateien.length ?? 25,
        };
        if (this.sdAbfrage) this.sdAbfrage.page = this.sdKopf.page;

        // Was man gerade anklicken kann, steht in lastSDFiles — andere
        // Module schlagen darin die geklickte Datei nach. Zusaetzlich
        // merken wir jede je gesehene Datei (sdDateiFinden), damit ein
        // Nachschlag auch nach dem Blaettern noch greift.
        window.lastSDFiles = dateien;
        this._merkeDateien(dateien);

        const behaelter = document.getElementById('sd-files-container');
        if (behaelter) behaelter.style.display = 'block';

        const liste = document.getElementById('sd-files-list');
        if (!dateien.length) {
            if (liste) {
                liste.className = 'sd-file-list';
                const nichts = texts.no_files_found || 'Keine Dateien gefunden';
                liste.innerHTML = `<p style="text-align:center; color:var(--text-secondary); padding:20px;">${nichts}</p>`;
            }
            this.zeichneBlaettern();
            this.zaehlerSchreiben();
            this.setzeKopfKnoepfe();
            return;
        }

        this.displaySDFiles(dateien);
        this.zaehlerSchreiben();
        this.zeichneBlaettern();
        this.setzeKopfKnoepfe();
    }

    /** Merkt jede gesehene Datei fuer Nachschlaege ueber Seitengrenzen. */
    _merkeDateien(dateien) {
        if (!window.sdGesehen) window.sdGesehen = new Map();
        (dateien || []).forEach(f => {
            if (f && f.name) window.sdGesehen.set(f.name, f);
            if (f && f.path) window.sdGesehen.set(f.path, f);
        });
    }

    /** Zaehler in der Werkzeugleiste: Treffer bei Suche/Filter, sonst gesamt. */
    zaehlerSchreiben() {
        const el = document.getElementById('sd-file-count');
        if (!el) return;
        const texts = window.texts || {};
        const gesamt = this.sdKopf?.total ?? 0;
        const gefiltert = !!(this.sdAbfrage?.search || this.sdAbfrage?.only_new);
        const muster = gefiltert
            ? (gesamt === 1 ? texts.sd_ein_treffer : texts.sd_treffer)
            : (gesamt === 1 ? texts.sd_datei_gesamt : texts.sd_dateien_gesamt);
        el.textContent = (muster || '{count}').replace('{count}', gesamt);
    }

    /**
     * Blaetterleiste unter der Liste.
     *
     * Zeigt hoechstens sieben Knoepfe: erste, letzte, die aktuelle mit je
     * einem Nachbarn, dazwischen Auslassungspunkte. Bei einer einzigen
     * Seite bleibt die Leiste unsichtbar — bei neunzehn Dateien soll da
     * nichts stehen.
     */
    zeichneBlaettern() {
        const texts = window.texts || {};
        const k = this.sdKopf || { page: 1, pages: 1, total: 0 };
        let leiste = document.getElementById('sd-blaettern');
        const behaelter = document.getElementById('sd-files-container');
        if (!leiste) {
            if (!behaelter) return;
            leiste = document.createElement('div');
            leiste.id = 'sd-blaettern';
            leiste.className = 'sd-blaettern';
            behaelter.appendChild(leiste);
        }
        leiste.classList.toggle('sd-blaettern--eine', k.pages <= 1);
        if (k.pages <= 1) { leiste.innerHTML = ''; return; }

        const nummern = [];
        const dazu = (n) => { if (!nummern.includes(n)) nummern.push(n); };
        dazu(1);
        for (let n = k.page - 1; n <= k.page + 1; n++) if (n >= 1 && n <= k.pages) dazu(n);
        dazu(k.pages);
        nummern.sort((a, b) => a - b);

        const stand = (texts.sd_seite_von || 'Seite {page} von {pages}')
            .replace('{page}', `<b>${k.page}</b>`)
            .replace('{pages}', `<b>${k.pages}</b>`);
        const gesamtText = ((k.total === 1 ? texts.sd_datei_gesamt : texts.sd_dateien_gesamt) || '{count}')
            .replace('{count}', k.total);

        let knoepfe = `<button ${k.page <= 1 ? 'disabled' : ''} title="${texts.sd_seite_zurueck || ''}"
                onclick="sdSeiteWechseln(${k.page - 1})">&lsaquo;</button>`;
        let vorher = 0;
        for (const n of nummern) {
            if (vorher && n - vorher > 1) knoepfe += '<span class="sd-seiten-punkte">…</span>';
            knoepfe += `<button class="${n === k.page ? 'an' : ''}" ${n === k.page ? 'disabled' : ''}
                onclick="sdSeiteWechseln(${n})">${n}</button>`;
            vorher = n;
        }
        knoepfe += `<button ${k.page >= k.pages ? 'disabled' : ''} title="${texts.sd_seite_vor || ''}"
                onclick="sdSeiteWechseln(${k.page + 1})">&rsaquo;</button>`;

        leiste.innerHTML = `
            <span class="sd-blaettern-stand">${stand} · ${gesamtText}</span>
            <span class="sd-blaettern-luecke"></span>
            <div class="sd-seiten">${knoepfe}</div>`;
    }

    /** Seitenwechsel — laedt nur nach, scrollt an den Listenanfang. */
    geheZuSeite(n) {
        if (!this.sdAbfrage) return;
        const k = this.sdKopf || { pages: 1 };
        const ziel = Math.max(1, Math.min(k.pages || 1, Number(n) || 1));
        if (ziel === this.sdAbfrage.page) return;
        this.sdAbfrage.page = ziel;
        this.ladeSeite().then(() => {
            const liste = document.getElementById('sd-files-list');
            if (liste && liste.scrollIntoView) {
                liste.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    /**
     * Werkzeugleiste der Dateiliste. Lag zweimal wortgleich im Code (Bambu-
     * und Klipper-Pfad) und war schon auseinandergelaufen — jetzt eine
     * Stelle. Idempotent: ist sie da, passiert nichts.
     *
     * Suche steht vorn, weil man bei einer Handvoll Dateien sucht statt zu
     * sortieren. Der Haken hiess frueher wie ein Eintrag der Sortierliste
     * ("Neue zuerst"), filtert aber — daher "Nur neue".
     */
    baueWerkzeugleiste() {
        if (document.getElementById('sd-sort-options')) return;
        const texts = window.texts || {};
        const leiste = document.createElement('div');
        leiste.id = 'sd-sort-options';
        leiste.className = 'sd-toolbar';
        leiste.innerHTML = `
            <div class="sd-search-wrap" id="sd-search-wrap">
                <span class="sd-search-icon"><svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
                <input type="text" class="sd-search-input" id="sd-search-input"
                       placeholder="${texts.search_placeholder || 'Datei suchen'}"
                       oninput="searchSDFiles()">
                <button class="sd-search-clear" onclick="clearSDSearch()" title="Clear">&times;</button>
            </div>
            <select id="sd-sort-select" class="sd-sort-select" onchange="sortSDFiles()">
                <option value="date">${texts.sort_by_date}</option>
                <option value="new">${texts.sort_by_new}</option>
                <option value="printed">${texts.sort_by_printed}</option>
                <option value="name">${texts.sort_by_name}</option>
            </select>
            <label class="sd-filter-check">
                <input type="checkbox" id="sd-filter-new" onchange="filterSDFiles()">
                <span>${texts.sd_only_new || 'Nur neue'}</span>
            </label>
            <span class="sd-file-count" id="sd-file-count"></span>
            <!-- Welche Spule gerade aktiv ist. Stand frueher als
                 Auswahlfeld in JEDER Dateikarte, ueberall mit demselben
                 Wert — hier steht es einmal, wo es hingehoert. -->
            <button class="sd-aktive-spule" id="sd-aktive-spule" style="display:none;"
                    onclick="openSpoolmanFromSD()"></button>
        `;
        const behaelter = document.getElementById('sd-files-container');
        if (behaelter) {
            behaelter.insertBefore(leiste, document.getElementById('sd-files-list'));
        }
    }

    // ========================================
    // createSDFileCardHTML — eine Zeile der Dateiliste
    //
    // Aufbau vom 21aug26. Vorher trug jede Datei ein Datenblatt aus elf
    // Angaben in zwei Spalten, eine Spulen-Auswahl ueber die volle Breite
    // und drei gleich grosse farbige Knoepfe — bei neun Dateien eine Wand.
    // Jetzt: Vorschau, Name, die vier Angaben nach denen man sucht (Dauer,
    // Gewicht, Filament, Datum), alles Weitere hinter "Details".
    //
    // opts.mode:
    //   'full' (default) — Drucken, Planen, Loeschen
    //   'schedule-pick'  — nur "Planen" (Datei fuer einen Plan auswaehlen)
    // ========================================
    createSDFileCardHTML(file, opts) {
        const texts = window.texts || {};
        const mode = (opts && opts.mode) || 'full';

        const safeFilename = file.name.replace(/'/g, "\\'");
        const fileLocation = file.location || 'cache';
        const e = (v) => String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const ic = (pfad) => `<svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true">${pfad}</svg>`;
        const IC_ZEIT = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
        const IC_GEWICHT = '<path d="M12 3v10M7 21h10M6 13h12l-2 8H8z"/>';
        const IC_DRUCKER = '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>';

        // Korrupte Dateien (abgebrochener Upload, kein gueltiges ZIP) kann
        // man nur loeschen.
        const isCorrupt = file.corrupt === true;
        const isPrintable = !isCorrupt && (file.name.endsWith('.3mf') || file.name.endsWith('.gcode'));
        const printState = String((window.lastPrintData || {}).gcode_state || '').toUpperCase();
        const printActive = ['RUNNING', 'PAUSE', 'PREPARE'].includes(printState);
        // Bei ausgeschaltetem Drucker bleibt die Liste lesbar, aber Drucken
        // und Loeschen gehen nicht — beides fasst den Drucker an.
        const druckerAus = window.lastKnownSwitchState === 'off';
        const printDisabled = (printActive || druckerAus) ? ' disabled aria-disabled="true"' : '';
        const deleteDisabled = druckerAus ? ' disabled aria-disabled="true"' : '';
        const meta = file.extended_meta || {};
        const mdata = file.metadata || {};

        // --- Druckzeit: Bambu liefert Minuten, Klipper Sekunden ----------
        const dauerText = () => {
            let min = null;
            if (meta.print_time_minutes) min = meta.print_time_minutes;
            else if (meta.estimated_time) min = Math.round(meta.estimated_time / 60);
            if (min == null) return file.print_time || '';
            return min < 60 ? `${min} min`
                            : `${Math.floor(min / 60)} h ${min % 60} min`;
        };

        // --- Die vier Angaben, nach denen man eine Datei sucht -----------
        const fakten = [];
        const dauer = dauerText();
        if (dauer) fakten.push(ic(IC_ZEIT) + e(dauer));
        if (file.weight) fakten.push(ic(IC_GEWICHT) + e(file.weight) + ' g');
        if (file.is_multifilament) {
            fakten.push('<span class="sd-multi-badge">' +
                e((texts.multifilament_count || '{count} Filamente')
                    .replace('{count}', file.filament_count)) + '</span>');
        } else {
            const material = file.filament_material || file.filament_type;
            if (material) {
                const punkt = file.filament_color
                    ? `<span class="sd-filament-dot" style="background:${e(file.filament_color)};"></span>` : '';
                fakten.push(punkt + e(material));
            }
        }
        if (file.date) fakten.push(e(file.date));
        // Spulen-Empfehlung. Sie kommt gesammelt nach (ein Aufruf fuer die
        // ganze Liste statt einer je Zeile) und traegt hier nur ihren Platz.
        if (!file.is_multifilament && (file.filament_material || file.filament_type)) {
            fakten.push(`<span class="sd-spulwahl" data-datei="${e(file.name)}"></span>`);
        }

        // --- Alles Weitere: da, nur zusammengeklappt ---------------------
        const detail = (label, wert) => wert
            ? `<span>${e(label)} <b>${e(wert)}</b></span>` : '';
        const details = [
            detail(texts.sd_detail_nozzle || 'Düse',
                   mdata.nozzle_diameter ? mdata.nozzle_diameter + ' mm' : ''),
            detail(texts.sd_detail_layer || 'Schicht',
                   meta.layer_height ? meta.layer_height + ' mm' : ''),
            detail(texts.sd_detail_infill || 'Füllung',
                   meta.infill_density ? meta.infill_density + ' %' : ''),
            detail(texts.sd_detail_plate || 'Platte', meta.bed_type),
            detail(texts.sd_detail_support || 'Stützen',
                   meta.support_used ? (texts.yes || 'ja') : ''),
            detail(texts.sd_detail_layers || 'Schichten',
                   mdata.layer_count ? mdata.layer_count : ''),
            detail(texts.sd_detail_size || 'Größe',
                   file.size ? formatFileSize(file.size) : ''),
            detail(texts.sd_detail_slicer || 'Slicer', file.slicer),
        ].filter(Boolean).join('');

        // --- Marken: neu / schon gedruckt / korrupt ----------------------
        const marken = [];
        if (isCorrupt) {
            marken.push(`<span class="sd-marke sd-marke--korrupt">${e(texts.corrupt_file || 'Korrupte Datei')}</span>`);
        } else if (!file.printed) {
            marken.push(`<span class="sd-marke sd-marke--neu">${e(texts.new_badge || 'Neu')}</span>`);
        }
        if (file.print_count > 0) {
            marken.push(`<span class="sd-marke sd-marke--gedruckt">${ic(IC_DRUCKER)}` +
                e((texts.times_printed || '{count}× gedruckt').replace('{count}', file.print_count)) + '</span>');
        }
        // Woher die Datei kommt. Der Drucker hat zwei Speicher, und dieselbe
        // Datei kann auf beiden liegen — beim Loeschen muss man wissen,
        // welche gemeint ist. Der interne Speicher war bis 29aug26 gar nicht
        // sichtbar, weil FTPS nur den Stick zeigt.
        if (file.speicher) {
            const intern = file.speicher === 'intern';
            marken.push(`<span class="sd-marke sd-marke--speicher">` +
                e(intern ? (texts.storage_internal || 'Intern')
                         : (texts.storage_usb || 'USB-Stick')) + '</span>');
        }

        // Spulen-Auswahl nur in der geoeffneten Zeile und nur mit Spoolman.
        // Sie stand vorher in JEDER Karte ueber die volle Breite.
        const zeigeSpule = mode === 'full'
            && window.spoolmanManager && window.spoolmanManager.connected;

        // --- Aktionen: Drucken traegt Farbe, der Rest sind Symbole -------
        let aktionen;
        if (mode === 'schedule-pick') {
            aktionen = isPrintable ? `
                <button class="sd-btn-haupt" onclick="schedulePrintFromScheduleManager('${safeFilename}', '${fileLocation}')">
                    ${ic(IC_ZEIT)}${e(texts.schedule || 'Planen')}</button>` : '';
        } else {
            aktionen = `
                ${isPrintable ? `
                        <button class="sd-btn-haupt sd-print-action"${printDisabled} onclick="startPrintFromSD('${safeFilename}', '${fileLocation}', this)"
                            title="${e(druckerAus ? (texts.sd_printer_off || 'Drucker ist aus')
                                : printActive ? (texts.print_blocked_active || 'Bei aktivem Druck kein Start möglich')
                                : (texts.print_now || texts.print || 'Drucken'))}">
                        ${ic(IC_DRUCKER)}${e(texts.print || 'Drucken')}</button>
                    <button class="sd-iknopf" onclick="schedulePrintFromSD('${safeFilename}', '${fileLocation}')"
                            title="${e(texts.schedule || 'Planen')}">${ic(IC_ZEIT)}</button>
                ` : ''}
                <button class="sd-iknopf sd-iknopf--rot"${deleteDisabled} onclick="deleteFileFromSD('${safeFilename}', '${fileLocation}')"
                        title="${e(druckerAus ? (texts.sd_printer_off || 'Drucker ist aus') : (texts.delete_file || 'Löschen'))}">
                    <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>
                </button>`;
        }

        const hatBild = file.has_thumbnail || file.name.endsWith('.3mf');
        const aufklappbar = details || zeigeSpule;

        return `
            <div class="sd-zeile${isCorrupt ? ' sd-zeile--korrupt' : ''}" data-filename="${e(file.name)}">
                <div class="sd-zeile-bild${hatBild ? ' sd-file-thumb--has-img' : ''}">
                    ${hatBild
                        ? `<img class="sd-thumb" src="/api/sd_thumbnail/${encodeURIComponent(file.name)}"
                                onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'; this.parentElement.classList.remove('sd-file-thumb--has-img');"
                                onload="this.style.display='block'; this.nextElementSibling.style.display='none';">
                           <div class="sd-zeile-platzhalter" style="display:none;">${window.skIcon('wuerfel')}</div>`
                        : `<div class="sd-zeile-platzhalter">${window.skIcon('wuerfel')}</div>`}
                </div>

                <div class="sd-zeile-text">
                    <div class="sd-zeile-name" title="${e(file.name)}"${mode === 'full' && file.speicher !== 'intern' ? ` ondblclick="startRenameFile(this, '${safeFilename}')"` : ''}>${e(file.name)}</div>
                    <div class="sd-zeile-fakten">${fakten.map(f => `<span>${f}</span>`).join('')}</div>
                    <div class="sd-zeile-marken">
                        ${marken.join('')}
                        ${aufklappbar ? `<button class="sd-mehr" onclick="sdZeileUmschalten(this)">
                            <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>${e(texts.sd_details || 'Details')}</button>` : ''}
                    </div>
                    ${details ? `<div class="sd-zeile-details">${details}</div>` : ''}
                    ${zeigeSpule ? `
                        <div class="sd-zeile-spule">
                            <span>${e(texts.schedule_spool_label || 'Spule')}</span>
                            <select class="sd-spool-select" onchange="selectSpoolFromSD(this.value)">
                                <option value="">${e(texts.no_spool || 'Keine Spule')}</option>
                                ${window.spoolmanSpoolsHtml || ''}
                            </select>
                        </div>` : ''}
                </div>

                <div class="sd-zeile-akt">${aktionen}</div>
            </div>`;
    }

    // ========================================
    // displaySDFiles — render file cards into container
    // ========================================
    /**
     * Aktive Spule in der Werkzeugleiste zeigen. Quelle ist derselbe
     * Zustand wie in der Material-Zone (spoolmanManager); ein Klick fuehrt
     * dorthin, damit man sie wechseln kann.
     */
    zeigeAktiveSpule() {
        const chip = document.getElementById('sd-aktive-spule');
        if (!chip) return;
        const texts = window.texts || {};
        const sm = window.spoolmanManager;
        if (!sm || !sm.connected) { chip.style.display = 'none'; return; }

        const spule = (sm.spools || []).find(s => s.id === sm.activeSpoolId);
        if (!spule) {
            chip.style.display = '';
            chip.className = 'sd-aktive-spule sd-aktive-spule--leer';
            chip.textContent = texts.no_spool_selected || 'Keine Spule gewählt';
            return;
        }
        const fil = spule.filament || {};
        const hersteller = (fil.vendor && fil.vendor.name) || '';
        const farbe = String(fil.color_hex || '888888').replace('#', '');
        const rest = spule.remaining_weight != null
            ? ` · ${Math.round(spule.remaining_weight)} g` : '';
        chip.style.display = '';
        chip.className = 'sd-aktive-spule';
        chip.innerHTML = `<span class="sd-filament-dot" style="background:#${farbe};"></span>`
            + `<span>${hersteller ? hersteller + ' ' : ''}${fil.name || ''}${rest}</span>`;
        chip.title = texts.sd_active_spool || 'Aktive Spule';
    }

    /**
     * Abgleich im Kopf anzeigen: duenner Faden unter der Kopfzeile, und der
     * Aktualisieren-Knopf wird zur Anzeige. Verdeckt nichts und schiebt
     * nichts — die Liste steht still.
     */
    _syncKopfAn() {
        const kopf = document.querySelector('#sdCardModal .sd-modal-header');
        if (kopf && !document.getElementById('sd-sync-faden')) {
            const faden = document.createElement('span');
            faden.id = 'sd-sync-faden';
            faden.className = 'sd-sync-faden';
            faden.innerHTML = '<i></i>';
            kopf.appendChild(faden);
        }
        const knopf = document.getElementById('sd-refresh-btn');
        if (knopf) {
            knopf.classList.add('sd-refresh--laeuft');
            knopf.disabled = true;
        }
    }

    /** Stand setzen — Faden, Knopffuellung und Restzeit in einem. */
    _syncStand(prozent, texts) {
        const p = Math.max(0, Math.min(100, prozent));
        const faden = document.querySelector('#sd-sync-faden > i');
        if (faden) faden.style.width = p + '%';
        const balken = document.getElementById('refresh-progress-bar');
        if (balken) balken.style.width = p + '%';
        const knopf = document.getElementById('sd-refresh-btn');
        if (knopf && knopf.classList.contains('sd-refresh--laeuft')) {
            let fuell = knopf.querySelector('.sd-refresh-fuell');
            if (!fuell) {
                fuell = document.createElement('span');
                fuell.className = 'sd-refresh-fuell';
                knopf.insertBefore(fuell, knopf.firstChild);
            }
            fuell.style.width = p + '%';
            const text = knopf.querySelector('span:not(.sd-refresh-fuell)');
            if (text) text.textContent = (texts && texts.sd_syncing_short) || 'Gleiche ab…';
        }
    }

    /** Zurueck in den Ruhezustand. */
    _syncKopfAus() {
        const faden = document.getElementById('sd-sync-faden');
        if (faden) faden.remove();
        const knopf = document.getElementById('sd-refresh-btn');
        if (knopf) {
            knopf.classList.remove('sd-refresh--laeuft');
            knopf.disabled = false;
            const fuell = knopf.querySelector('.sd-refresh-fuell');
            if (fuell) fuell.remove();
            const text = knopf.querySelector('span:not(.sd-refresh-fuell)');
            if (text) text.textContent = (window.texts || {}).refresh || 'Aktualisieren';
        }
    }

    displaySDFiles(files) {
        const container = document.getElementById('sd-files-list');
        // EIN Kasten fuer die ganze Liste; die Zeilen trennt eine Linie.
        container.className = 'sd-liste';
        container.innerHTML = '';
        this.zeigeAktiveSpule();
        files.forEach(file => {
            container.insertAdjacentHTML('beforeend', this.createSDFileCardHTML(file));
        });
        this._spulenEmpfehlungen(files);
    }

    /**
     * Traegt je Zeile nach, welche Spule zur Datei passt.
     *
     * EIN Aufruf fuer die ganze Liste — bei vierzehn Dateien waeren vierzehn
     * Anfragen fuer einen Bildschirm. Der Abgleich selbst laeuft am Server
     * (find_matching_spools), damit Liste, Planen und Sofortdruck dieselbe
     * Meinung haben.
     */
    _spulenEmpfehlungen(files) {
        if (!(window.spoolmanManager && window.spoolmanManager.connected)) return;
        const texts = window.texts || {};
        const nutzlast = (files || [])
            .filter(f => f && f.name && !f.is_multifilament
                         && (f.filament_material || f.filament_type))
            .map(f => ({
                name: f.name,
                material: f.filament_material || f.filament_type,
                color: f.filament_color,
            }));
        if (!nutzlast.length) return;

        window.apiCall('/api/spoolman/match_files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: nutzlast }),
        })
            .then(r => r.json())
            .then(karte => {
                document.querySelectorAll('.sd-spulwahl').forEach(el => {
                    const treffer = karte[el.dataset.datei];
                    if (!treffer) { el.remove(); return; }
                    // Nur sagen, WELCHE Spule passt. „Keine passende Spule"
                    // gehoert hier nicht hin: in der Uebersicht steht man vor
                    // vierzehn Dateien, von denen man dreizehn gar nicht
                    // drucken will — die Warnung kommt beim Planen und beim
                    // Starten, wo sie etwas aendert.
                    if (!treffer.spool_id) { el.remove(); return; }
                    el.textContent = treffer.count > 1
                        ? (texts.spool_match_row_many || '{n} passende Spulen')
                            .replace('{n}', treffer.count)
                        : (texts.spool_match_row || 'Passend: {spool}')
                            .replace('{spool}', treffer.display || '');
                    el.title = treffer.display || '';
                });
            })
            .catch(() => { /* ohne Spoolman bleibt die Zeile wie sie ist */ });
    }

    // ========================================
    // loadPrintDefaults — Load defaults from config
    // ========================================
    async loadPrintDefaults() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/config');
            const config = await response.json();
            this._printDefaults = config.print_defaults || {};

            // Klipper-Direkt: Timelapse-Default = AKTUELLER Moonraker-Zustand
            // (das Plugin hat nur einen globalen Schalter — der Haken hier
            // ÜBERSCHREIBT ihn beim Start; ohne diesen Abgleich kippte jeder
            // Start mit leerem Haken das Mainsail-Setting auf aus).
            this._timelapseDefault = null;
            if (window.isKlipperMode && window.isKlipperMode()) {
                try {
                    const tlr = await apiCall('/api/timelapse/settings');
                    const tls = await tlr.json();
                    if (tls && typeof tls.enabled === 'boolean') {
                        this._timelapseDefault = tls.enabled;
                    }
                } catch (_) { /* best-effort */ }
            }

        } catch (error) {
            console.error(texts.console_error_loading_print_defaults + ':', error);
        }
    }

    // ========================================
    // handleSDRefresh
    // ========================================
    handleSDRefresh() {
        const texts = window.texts || {};
        // Prüfe ob Auto-Sync läuft
        if (this.sdSyncInProgress) {
            skToast(texts.toast_wait_sync, 'info');
            return;
        }

        // Sonst normaler Refresh
        this.showSDFiles(true);
    }

    // ========================================
    // handleFileUpload
    // ========================================
    handleFileUpload(input) {
        const texts = window.texts || {};
        const file = input.files[0];
        if (!file) return;

        // Input zurücksetzen für erneute Verwendung
        input.value = '';

        const uploadStatus = document.createElement('div');
        uploadStatus.id = 'upload-status';
        uploadStatus.style.cssText = 'background:var(--bg-secondary); border-radius:8px; padding:15px; margin:15px 0;';
        const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
        uploadStatus.innerHTML = `
            <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="font-weight:500; color:var(--text-primary);">${file.name}</div>
                    <div id="upload-progress-percent" style="font-weight:600; color:var(--accent-green); font-size:14px;">0%</div>
                </div>
                <div style="background:var(--border-color); height:8px; border-radius:4px; overflow:hidden;">
                    <div id="upload-progress-bar" style="background:var(--accent-green); height:100%; width:0%; transition:width 0.3s ease;"></div>
                </div>
                <div id="upload-progress-text" style="color:var(--text-secondary); font-size:12px; margin-top:5px;">Verbinde mit Drucker... (${fileSizeMB} MB)</div>
            </div>
        `;

        const filesContainer = document.getElementById('sd-files-container');
        filesContainer.parentNode.insertBefore(uploadStatus, filesContainer);

        const self = this;

        // Progress Updates
        function onUploadProgress(data) {
            if (data.filename === file.name || data.filename === sanitizedFilename) {
                const progressBar = document.getElementById('upload-progress-bar');
                const progressText = document.getElementById('upload-progress-text');
                if (!progressBar || !progressText) return;

                progressBar.style.width = data.progress + '%';

                const percentEl = document.getElementById('upload-progress-percent');
                if (percentEl) percentEl.textContent = data.progress + '%';

                if (data.status === 'uploading') {
                    if (data.progress >= 95 && !data.speed) {
                        progressText.textContent = texts.upload_verifying || 'Upload wird geprüft…';
                    } else {
                        let info = `Hochladen... ${data.progress}%`;
                        if (data.speed) info += ` · ${data.speed} KB/s`;
                        if (data.eta !== undefined && data.eta > 0) info += ` · ~${data.eta}s`;
                        progressText.textContent = info;
                    }
                } else if (data.status === 'complete' && data.verified) {
                    if (percentEl) percentEl.textContent = '100%';
                    progressBar.style.background = 'var(--accent-green)';
                    progressText.textContent = texts.upload_verified || 'Upload erfolgreich und geprüft';
                    socket.off('upload_progress', onUploadProgress);
                    setTimeout(() => {
                        uploadStatus.remove();
                        self.showSDFiles();
                    }, 2000);
                } else if (data.status === 'incomplete') {
                    progressBar.style.background = 'var(--accent-yellow)';
                    progressText.textContent = texts.upload_incomplete || 'Upload unvollständig — bitte erneut versuchen';
                    socket.off('upload_progress', onUploadProgress);
                    setTimeout(() => uploadStatus.remove(), 5000);
                } else if (data.status === 'error') {
                    progressBar.style.background = 'var(--accent-red)';
                    progressText.textContent = texts.upload_failed || 'Upload fehlgeschlagen';
                    socket.off('upload_progress', onUploadProgress);
                    setTimeout(() => uploadStatus.remove(), 5000);
                }
            }
        }
        socket.on('upload_progress', onUploadProgress);

        // Sanitized filename für Vergleich mit Backend (secure_filename ersetzt Leerzeichen durch _)
        let sanitizedFilename = file.name;

        const formData = new FormData();
        formData.append('file', file);

        apiCall('/api/mqtt/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Backend gibt den sanitized Dateinamen zurück
                if (data.filename) sanitizedFilename = data.filename;
            }
        });
    }

    // ========================================
    // deleteFileFromSD
    // ========================================
    deleteFileFromSD(filename, location) {
        const texts = window.texts || {};
        const self = this;

        // Klipper: schlanker Delete via unified Files-API
        if (window.isKlipperMode && window.isKlipperMode()) {
            const doDelete = () => window.printerAdapter.deleteFile(filename).then(r => {
                if (r.ok) {
                    skToast((texts.toast_file_deleted || 'Datei gelöscht') + ': ' + filename, 'success');
                    self.showSDFiles(true);  // Liste refreshen
                } else {
                    skToast(r.error || texts.toast_error_deleting || 'Fehler beim Löschen', 'error');
                }
            });
            const msg = (texts.confirm_delete_file || 'Datei wirklich löschen') + '?\n' + filename;
            if (window.showConfirmDialog) window.showConfirmDialog(msg, doDelete);
            else if (window.skConfirm) window.skConfirm(msg, { danger: true })
                .then(ja => { if (ja) doDelete(); });
            return;
        }

        // Erst prüfen ob es geplante Drucke gibt
        apiCall(`/api/check_scheduled_for_file/${encodeURIComponent(filename)}`)
            .then(response => response.json())
            .then(checkData => {
                let confirmMessage = `${texts.confirm_delete_file}\n\n${texts.confirm_delete_file_name.replace('{filename}', filename)}`;

                if (checkData.count > 0) {
                    const warningText = checkData.count === 1
                        ? texts.confirm_scheduled_warning_single.replace('{count}', checkData.count)
                        : texts.confirm_scheduled_warning_plural.replace('{count}', checkData.count);
                    const deleteText = checkData.count === 1
                        ? texts.confirm_will_be_deleted_single
                        : texts.confirm_will_be_deleted_plural;
                    confirmMessage += `\n\n${warningText}\n${deleteText}`;
                }

                confirmMessage += `\n\n${texts.confirm_cannot_undo}`;

                showConfirmDialog(confirmMessage, function() {
                    self.doDeleteFile(filename, location, checkData);
                });
            })
            .catch(error => {
                console.error(texts.console_error_checking + ':', error);
                showConfirmDialog(texts.confirm_delete_file_warning.replace('{filename}', filename), function() {
                    self.doDeleteFile(filename, location, { count: 0 });
                });
            });
    }

    // ========================================
    // doDeleteFile
    // ========================================
    doDeleteFile(filename, location, checkData) {
        const texts = window.texts || {};
        const self = this;

                // Meldungen laufen ueber das Toast-System oben rechts wie
                // ueberall sonst. Vorher stand hier ein eigener Kasten in der
                // Bildschirmmitte — mitten im Dialog, mit fest deutschem Text.
                skToast((texts.sd_deleting_file || 'Deleting {filename}…')
                    .replace('{filename}', filename), 'info');

                // Wenn es geplante Drucke gibt, diese zuerst löschen
                if (checkData.count > 0) {
                    apiCall('/api/delete_scheduled_for_file', {
                        method: 'DELETE',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ filename: filename })
                    })
                    .then(response => response.json())
                    .then(deleteScheduledData => {
                        if (deleteScheduledData.success) {
                            console.log(`✅ ${deleteScheduledData.deleted} ${texts.scheduled_prints} gelöscht`);
                            // Aktualisiere die Listen falls sichtbar
                            if (typeof loadScheduledPrints === 'function') {
                                loadScheduledPrints();
                            }
                            if (typeof loadScheduleManagerList === 'function' && document.getElementById('scheduleManagerModal')) {
                                loadScheduleManagerList();
                            }
                        }

                        // Jetzt die Datei löschen
                        deleteSdFile();
                    });
                } else {
                    // Keine geplanten Drucke, direkt löschen
                    deleteSdFile();
                }

                function deleteSdFile() {
                    apiCall('/api/mqtt/delete', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            filename: filename,
                            location: location || 'cache'
                        })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            let meldung = texts.file_deleted_ok || 'Datei gelöscht';
                            if (checkData.count > 0) {
                                meldung += ' · ' + (texts.scheduled_removed
                                    || '{count} geplante Drucke entfernt')
                                    .replace('{count}', checkData.count);
                            }
                            skToast(meldung, 'success');
                            // MIT Force: dann sitzt die Ladeanzeige im
                            // Aktualisieren-Knopf, genau wie beim Aktualisieren
                            // von Hand. Ohne Force erschien stattdessen der
                            // Spinner oben im Dialog — und die geloeschte Datei
                            // haette aus dem Zwischenspeicher weiter dringestanden.
                            self.showSDFiles(true);
                        } else {
                            skToast(data.error || texts.toast_error_deleting
                                || 'Fehler beim Löschen', 'error');
                        }
                    })
                    .catch(error => {
                        skToast(texts.connection_failed || 'Verbindungsfehler', 'error');
                    });
                }
    }

    // ========================================
    // checkDataQuality
    // ========================================
    checkDataQuality() {
        const texts = window.texts || {};
        apiCall('/api/debug/data_quality')
            .then(response => response.json())
            .then(data => {
                if (data.completeness_percent) {
                    const message = `Datenqualität: ${data.completeness_percent}%\n` +
                                   `Vorhanden: ${data.present_fields}\n` +
                                   `Fehlend: ${data.missing_fields.length}\n` +
                                   `Null: ${data.null_fields.length}\n` +
                                   `${data.recommendation}`;

                    console.log(texts.console_data_quality, data);
                    window.skToast(message);

                    if (data.completeness_percent < 80) {
                        // Bei schlechter Qualität automatisch Full Status anfordern
                        requestFullStatus();
                    }
                }
            });
    }

    // ========================================
    // closeSDModal
    // ========================================
    closeSDModal() {
        // Upload-Status entfernen beim Schließen
        const uploadStatus = document.getElementById('upload-status');
        if (uploadStatus) {
            uploadStatus.remove();
        }

        document.getElementById('sdCardModal').style.display = 'none';
    }

    // ========================================
    // startRenameFile
    // ========================================
    startRenameFile(nameEl, filename) {
        // Prevent double-triggering
        if (nameEl.querySelector('.sd-rename-input')) return;

        // Extension erkennen (compound extensions zuerst)
        let ext = '';
        const lowerName = filename.toLowerCase();
        if (lowerName.endsWith('.gcode.3mf')) ext = filename.slice(-10);
        else if (lowerName.endsWith('.gcode')) ext = filename.slice(-6);
        else if (lowerName.endsWith('.3mf')) ext = filename.slice(-4);

        const baseName = filename.slice(0, filename.length - ext.length);
        const originalHTML = nameEl.innerHTML;
        const originalTitle = nameEl.title;

        // Inline-Edit erstellen
        nameEl.innerHTML = '';
        nameEl.classList.add('sd-file-name--editing');

        const container = document.createElement('div');
        container.className = 'sd-rename-container';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sd-rename-input';
        input.value = baseName;
        input.setAttribute('data-original-name', filename);
        input.setAttribute('data-extension', ext);

        const extSpan = document.createElement('span');
        extSpan.className = 'sd-rename-ext';
        extSpan.textContent = ext;

        container.appendChild(input);
        container.appendChild(extSpan);
        nameEl.appendChild(container);

        input.focus();
        input.select();

        const self = this;

        // Enter → speichern
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                self._commitRename(nameEl, input, ext, filename, originalHTML, originalTitle);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                self._cancelRename(nameEl, originalHTML, originalTitle);
            }
        });

        // Blur → speichern (mit Delay für Enter-Race)
        input.addEventListener('blur', function() {
            setTimeout(() => {
                if (nameEl.classList.contains('sd-file-name--editing')) {
                    self._commitRename(nameEl, input, ext, filename, originalHTML, originalTitle);
                }
            }, 150);
        });
    }

    _cancelRename(nameEl, originalHTML, originalTitle) {
        nameEl.classList.remove('sd-file-name--editing');
        nameEl.innerHTML = originalHTML;
        nameEl.title = originalTitle;
    }

    _commitRename(nameEl, input, ext, oldFilename, originalHTML, originalTitle) {
        const newBaseName = input.value.trim();

        // Leer oder unverändert → abbrechen
        if (!newBaseName || newBaseName + ext === oldFilename) {
            this._cancelRename(nameEl, originalHTML, originalTitle);
            return;
        }

        const newFilename = newBaseName + ext;

        // Ungültige Zeichen prüfen
        if (/[\\\/\:\*\?\"\<\>\|]/.test(newBaseName)) {
            input.classList.add('sd-rename-input--error');
            setTimeout(() => input.classList.remove('sd-rename-input--error'), 1000);
            input.focus();
            return;
        }

        // Loading-State
        nameEl.classList.remove('sd-file-name--editing');
        nameEl.classList.add('sd-file-name--renaming');
        nameEl.innerHTML = `<span class="sd-rename-loading">${newFilename}</span>`;

        this.renameFileOnSD(oldFilename, newFilename, nameEl, originalHTML, originalTitle);
    }

    // ========================================
    // renameFileOnSD
    // ========================================
    renameFileOnSD(oldFilename, newFilename, nameEl, originalHTML, originalTitle) {
        const self = this;
        apiCall('/api/mqtt/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_filename: oldFilename,
                new_filename: newFilename
            })
        })
        .then(response => response.json())
        .then(data => {
            nameEl.classList.remove('sd-file-name--renaming');

            if (data.success) {
                // Name-Element updaten
                const safeNew = newFilename.replace(/'/g, "\\'");
                nameEl.textContent = newFilename;
                nameEl.title = newFilename;
                nameEl.setAttribute('ondblclick', `startRenameFile(this, '${safeNew}')`);

                // Card-Attribute updaten
                const card = nameEl.closest('.sd-zeile') || nameEl.closest('.sd-file-card');
                if (card) {
                    card.setAttribute('data-filename', newFilename);
                    const location = 'root';

                    // Aktionen umschreiben. Seit dem Umbau 21aug26 traegt
                    // Drucken .sd-btn-haupt und der Rest .sd-iknopf — nach
                    // dem alten onclick zu suchen trifft beide Bauformen.
                    const knopf = (teil) => card.querySelector(`button[onclick^="${teil}"]`);
                    const printBtn = knopf('startPrintFromSD');
                    if (printBtn) {
                        printBtn.setAttribute('onclick', `startPrintFromSD('${safeNew}', '${location}', this)`);
                    }

                    const scheduleBtn = knopf('schedulePrintFromSD');
                    if (scheduleBtn) {
                        scheduleBtn.setAttribute('onclick', `schedulePrintFromSD('${safeNew}', '${location}')`);
                    }

                    const deleteBtn = knopf('deleteFileFromSD');
                    if (deleteBtn) {
                        deleteBtn.setAttribute('onclick', `deleteFileFromSD('${safeNew}', '${location}')`);
                    }

                    // Thumbnail updaten
                    const thumbImg = card.querySelector('img.sd-thumb');
                    if (thumbImg) {
                        thumbImg.src = `/api/sd_thumbnail/${encodeURIComponent(newFilename)}`;
                    }

                    // data-file Attribute updaten
                    card.querySelectorAll('[data-file]').forEach(el => {
                        if (el.getAttribute('data-file') === oldFilename) {
                            el.setAttribute('data-file', newFilename);
                        }
                    });
                }

                // Toast
                const msg = data.printer_offline
                    ? `${oldFilename} → ${newFilename} (${texts.local || 'lokal'})`
                    : `${oldFilename} → ${newFilename}`;
                self.showRenameToast(msg, 'success');
            } else {
                self._cancelRename(nameEl, originalHTML, originalTitle);
                self.showRenameToast(data.error || texts.rename_failed || 'Umbenennen fehlgeschlagen', 'error');
            }
        })
        .catch(error => {
            nameEl.classList.remove('sd-file-name--renaming');
            self._cancelRename(nameEl, originalHTML, originalTitle);
            console.error('Rename error:', error);
            self.showRenameToast(texts.rename_failed || 'Umbenennen fehlgeschlagen', 'error');
        });
    }

    // ========================================
    // showRenameToast
    // ========================================
    showRenameToast(message, type) {
        const existing = document.querySelectorAll('.sd-rename-toast');
        existing.forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = 'sd-rename-toast';
        const isError = type === 'error';
        toast.style.cssText = `
            position: fixed; bottom: 20px; left: 50%;
            transform: translateX(-50%) scale(0.95);
            background: ${isError ? 'rgba(220,53,69,0.15)' : 'rgba(76,175,80,0.15)'};
            color: ${isError ? '#f44336' : '#4caf50'};
            padding: 12px 24px; border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.15); z-index: 999999;
            font-size: 14px; font-weight: 500;
            border: 1px solid ${isError ? 'rgba(220,53,69,0.25)' : 'rgba(76,175,80,0.25)'};
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            opacity: 0; transition: all 0.2s ease-out;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) scale(1)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ========================================
    // formatFileSize
    // ========================================
    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    // ========================================
    // Auto-Close für Print-Options Dropdowns
    // ========================================
    _initAutoCloseDropdowns() {
        document.addEventListener('click', function(e) {
            // Finde alle offenen Details
            const openDetails = document.querySelectorAll('details[open]');

            openDetails.forEach(detail => {
                // Wenn der Klick NICHT innerhalb des Details war, schließe es
                if (!detail.contains(e.target)) {
                    detail.removeAttribute('open');
                }
            });
        });
    }

    // ========================================
    // Close popovers when clicking outside
    // ========================================
    _initPopoverCloseHandler() {
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.sd-popover') && !e.target.closest('.sd-action-btn--settings')) {
                document.querySelectorAll('.sd-popover.active').forEach(p => p.classList.remove('active'));
            }
        });
    }

    // ========================================
    // Klipper-File-Browser (schlanke Variante)
    // ========================================
    _showKlipperFiles() {
        document.getElementById('sdCardModal').style.display = 'block';
        const wrapper = document.getElementById('sd-files-container');
        const loading = document.getElementById('sd-loading');
        const error = document.getElementById('sd-error');
        const container = document.getElementById('sd-files-list');
        if (loading) loading.style.display = 'block';
        if (error) error.style.display = 'none';
        if (wrapper) wrapper.style.display = 'none';
        if (container) container.innerHTML = '';

        // Spoolman-Spulen mit-cachen — derselbe Code wie der Bambu-Pfad
        if (window.spoolmanManager && window.spoolmanManager.connected) {
            window.spoolmanSpoolsHtml = '';
            const mainSelector = document.getElementById('spool-selector');
            if (mainSelector && mainSelector.options.length > 1) {
                for (let i = 1; i < mainSelector.options.length; i++) {
                    const opt = mainSelector.options[i];
                    const selected = opt.value == window.activeSpoolId ? 'selected' : '';
                    window.spoolmanSpoolsHtml += `<option value="${opt.value}" ${selected}>${opt.text}</option>`;
                }
            }
        }

        const texts = window.texts || {};

        // Backend liefert Klipper-Files im Bambu-kompatiblen Format
        // (`name`, `size`, `metadata`, `extended_meta`, `weight`, `slicer`,
        // `sort_timestamp`, ...). → wir nutzen den gleichen displaySDFiles-
        // Pfad UND die gleiche Sortier-Toolbar wie Bambu.
        if (!this.sdAbfrage) this.sdAbfrage = { page: 1, per_page: 25, sort: 'date' };
        this.sdAbfrage.page = 1;
        const _abf = () => ({
            page: this.sdAbfrage.page,
            per_page: this.sdAbfrage.per_page || 25,
            sort: this.sdAbfrage.sort,
            search: this.sdAbfrage.search,
            only_new: this.sdAbfrage.only_new,
        });
        window.printerAdapter.listFiles(_abf()).then(r => {
            if (loading) loading.style.display = 'none';
            if (!r.ok) {
                if (error) {
                    error.style.display = 'block';
                    error.textContent = r.error || texts.sd_load_error || 'Fehler beim Laden';
                }
                return;
            }
            if (wrapper) wrapper.style.display = '';

            this.baueWerkzeugleiste();

            // Der Adapter liefert denselben Kopf (total/page/pages) wie
            // der Bambu-Server — gleicher Zeichenweg, gleiche Leiste.
            this.zeigeSeite(r);
            // Print-Option-Defaults laden (Timelapse = aktueller Moonraker-
            // Zustand). Der Bambu-Pfad macht das in loadSDFiles().finally —
            // dieser Klipper-Pfad hat das nie getan → Timelapse-Haken war
            // im Direct-Modus IMMER leer (die eigentliche Wurzel des Bugs).
            this.loadPrintDefaults();

            // Zwei-Schritt wie die History-Ansicht: sofort Cache rendern (oben),
            // dann History im Hintergrund frisch ziehen und die neu/gedruckt-
            // Badges aktualisieren — ohne Loading/Neu-Aufbau. Löst: gerade
            // gedruckte Datei stand noch als "neu" drin, bis man erst die
            // History-Ansicht geöffnet hatte.
            window.printerAdapter.listFiles({ ..._abf(), fresh: true }).then(r2 => {
                if (r2 && r2.ok && Array.isArray(r2.files)) {
                    this.zeigeSeite(r2);
                }
            }).catch(() => {});
        });
    }

    // _displayKlipperFiles / _enrichKlipperCards / _enrichOneKlipperCard
    // sind ENTFERNT — Klipper laeuft jetzt ueber den gleichen Bambu-
    // Render-Pfad (applySDFilters → displaySDFiles → createSDFileCardHTML)
    // mit Metadata, die der Klipper-Files-Sync schon in die Files-Liste
    // gebacken hat. Die alten Funktionen feuerten pro Card einen
    // /api/printer/files/metadata-Call, was bei offline Host 16 mal
    // "metadata lookup failed" im Log produziert hat.
}

// Klipper-spezifische Helper (Print-Start ohne AMS/Plate-Wizard,
// Delete via unified Files-API). Bambu-Aequivalente sind
// startPrintFromSD/deleteFileFromSD oben in der Klasse.
// Bestätigung über das gestylte In-App-Modal (showConfirmDialog) statt nativem
// confirm(); Fallback auf confirm() falls das Modul mal nicht geladen ist.
function _skConfirm(msg, onYes) {
    if (window.showConfirmDialog) window.showConfirmDialog(msg, onYes);
    else if (window.skConfirm) window.skConfirm(msg).then(ja => { if (ja) onYes(); });
}
window.klipperFileStartPrint = function (path, btn) {
    const txt = window.texts || {};
    _skConfirm((txt.confirm_start_print || 'Druck starten') + ': ' + path + '?', async () => {
        const r = await window.printerAdapter.action('start_print', { filename: path });
        if (r.ok) {
            skToast((txt.toast_print_started || 'Druck gestartet') + ': ' + path, 'success');
            document.getElementById('sdCardModal').style.display = 'none';
        } else {
            skToast(r.error || txt.toast_error_starting || 'Fehler beim Starten', 'error');
        }
    });
};
window.klipperFileDelete = function (path) {
    const txt = window.texts || {};
    _skConfirm((txt.confirm_delete_file || 'Datei wirklich löschen') + '?\n' + path, async () => {
        const r = await window.printerAdapter.deleteFile(path);
        if (r.ok) {
            skToast((txt.toast_file_deleted || 'Datei gelöscht') + ': ' + path, 'success');
            // Liste neu laden
            if (window.sdCardManager) window.sdCardManager.showSDFiles(true);
        } else {
            skToast(r.error || txt.toast_error_deleting || 'Fehler beim Löschen', 'error');
        }
    });
};

// ========================================
// Create singleton instance
// ========================================
window.sdCardManager = new SDCardManager();

// ========================================
// Backwards compatibility — global function wrappers
// ========================================
function showSDFiles(forceRefresh = false) { window.sdCardManager.showSDFiles(forceRefresh); }
function closeSDModal() { window.sdCardManager.closeSDModal(); }
function handleSDRefresh() { window.sdCardManager.handleSDRefresh(); }
function handleFileUpload(input) { window.sdCardManager.handleFileUpload(input); }
function deleteFileFromSD(filename, location) { window.sdCardManager.deleteFileFromSD(filename, location); }
function formatFileSize(bytes) { return window.sdCardManager.formatFileSize(bytes); }
function loadPrintDefaults() { return window.sdCardManager.loadPrintDefaults(); }
function checkDataQuality() { window.sdCardManager.checkDataQuality(); }

// startRenameFile is used from ondblclick in HTML
window.startRenameFile = function(nameEl, filename) { window.sdCardManager.startRenameFile(nameEl, filename); };

// Filter/sort/search helpers used from onchange/oninput in HTML
window.sortSDFiles = function() { window.sdCardManager.applySDFilters(); };
window.filterSDFiles = function() { window.sdCardManager.applySDFilters(); };

// Suche entprellt: jeder Tastendruck fragt sonst den Server. 300 ms sind
// kurz genug, dass es sofort wirkt, und lang genug, dass ein getipptes
// Wort eine Anfrage ergibt statt sieben.
let _sdSuchUhr = null;
window.searchSDFiles = function() {
    clearTimeout(_sdSuchUhr);
    _sdSuchUhr = setTimeout(() => window.sdCardManager.applySDFilters(), 300);
};
window.clearSDSearch = function() {
    clearTimeout(_sdSuchUhr);
    const input = document.getElementById('sd-search-input');
    if (input) { input.value = ''; input.focus(); }
    window.sdCardManager.applySDFilters();
};

// Seitenwechsel aus der Blaetterleiste.
window.sdSeiteWechseln = function(n) { window.sdCardManager.geheZuSeite(n); };

/**
 * Datei nach Name (oder Pfad) nachschlagen.
 *
 * Seit die Liste seitenweise kommt, steht in lastSDFiles nur noch die
 * sichtbare Seite. Andere Module (Druckvorbereitung, Planer, Druckstart)
 * schlagen darin die angeklickte Datei nach — das trifft zwar immer die
 * aktuelle Seite, aber nach einem Seitenwechsel waere ein Nachschlag auf
 * eine vorher gesehene Datei sonst leer. Darum zusaetzlich der Vorrat
 * aller bisher geladenen Seiten.
 */
window.sdDateiFinden = function(name) {
    if (!name) return null;
    const seite = (window.lastSDFiles || []).find(f => f && (f.name === name || f.path === name));
    if (seite) return seite;
    return (window.sdGesehen && window.sdGesehen.get(name)) || null;
};


// createSDFileCardHTML and displaySDFiles used by other code (e.g. schedule manager)
window.createSDFileCardHTML = function(file, opts) { return window.sdCardManager.createSDFileCardHTML(file, opts); };

/**
 * Spulenwahl direkt aus der Dateiliste. Vorher schloss der Chip die Liste
 * und sprang zur Material-Zone — man landete auf der Hauptseite und musste
 * sich zurueckklicken. Die Wahl gehoert dorthin, wo man gerade ist.
 */
window.openSpoolmanFromSD = async function() {
    const texts = window.texts || {};
    const sm = window.spoolmanManager;
    if (!sm || !sm.connected) return;

    // Frische Liste holen, falls der Cache leer ist (Dialog vor dem ersten
    // Laden der Material-Zone geoeffnet).
    let spulen = sm.spools || [];
    if (!spulen.length) {
        try {
            spulen = await (await apiCall('/api/spoolman/spools')).json() || [];
            sm.spools = spulen;
        } catch (e) {
            console.warn('Spools not loaded:', e);
            return;
        }
    }

    const e = (v) => String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const farbe = (v) => {
        const c = String(v || '').replace('#', '');
        return c ? `#${c}` : '#888';
    };

    const zeile = (sp) => {
        const fil = sp.filament || {};
        const hersteller = (fil.vendor && fil.vendor.name) || '';
        const rest = sp.remaining_weight != null ? `${Math.round(sp.remaining_weight)} g` : '';
        const aktiv = sp.id === sm.activeSpoolId;
        return `
            <label class="ui-zeile ui-zeile--klick fm-option" data-spool-id="${sp.id}">
                <input type="radio" name="sd-spule" class="fm-radio"${aktiv ? ' checked' : ''}>
                <span class="mf-punkt" style="background:${farbe(fil.color_hex)};"></span>
                <span class="ui-zeile-name">
                    <span class="mf-name">${e(hersteller ? hersteller + ' ' : '')}${e(fil.name || '—')}</span>
                    <span class="mf-typ">${e(fil.material || '')}${rest ? ' · ' + e(rest) : ''}</span>
                </span>
                ${aktiv ? `<span class="sched-marke">${e(texts.fm_current || 'aktuell aktiv')}</span>` : ''}
            </label>`;
    };

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%;'
        + 'background:rgba(0,0,0,0.6); z-index:10001; display:flex;'
        + 'align-items:center; justify-content:center;';
    const panel = document.createElement('div');
    panel.className = 'modal-panel';
    panel.style.cssText = 'position:relative; width:92%; max-width:520px;'
        + 'max-height:82vh; overflow-y:auto; border-radius:12px; padding:0;';
    panel.innerHTML = `
        <div class="sd-modal-header">
            <h2 class="sd-modal-title">
                <svg class="hd-ic hd-ic--lg" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/></svg>
                <span>${e(texts.sd_active_spool || 'Aktive Spule')}</span>
            </h2>
        </div>
        <div class="ui-koerper" style="padding:16px 20px 20px;">
            <div class="ui-karte">${spulen.map(zeile).join('')}</div>
        </div>
        <div class="ui-fuss">
            <button class="modal-btn modal-btn-cancel" id="sds-abbruch">${e(texts.cancel || 'Abbrechen')}</button>
            <button class="modal-btn modal-btn-success" id="sds-ok">${e(texts.ams_edit_save || 'Übernehmen')}</button>
        </div>`;
    modal.appendChild(panel);
    document.body.appendChild(modal);

    let gewaehlt = sm.activeSpoolId || null;
    panel.querySelectorAll('.fm-option').forEach(el => {
        el.addEventListener('change', () => {
            gewaehlt = parseInt(el.dataset.spoolId, 10);
        });
    });
    const zu = () => modal.remove();
    modal.addEventListener('click', (ev) => { if (ev.target === modal) zu(); });
    panel.querySelector('#sds-abbruch').onclick = zu;
    panel.querySelector('#sds-ok').onclick = async () => {
        zu();
        if (!gewaehlt || gewaehlt === sm.activeSpoolId) return;
        await sm.activate(gewaehlt);
        // Chip in der Werkzeugleiste sofort nachziehen — activate() kennt
        // die Dateiliste nicht.
        if (window.sdCardManager) window.sdCardManager.zeigeAktiveSpule();
    };
};

/** Details und Spulen-Auswahl einer Dateizeile auf- und zuklappen. */
window.sdZeileUmschalten = function(knopf) {
    const zeile = knopf.closest('.sd-zeile');
    if (zeile) zeile.classList.toggle('offen');
};
window.displaySDFiles = function(files) { window.sdCardManager.displaySDFiles(files); };
