/**
 * SD Card Manager
 * Handles SD card file browsing, upload, delete, rename, sorting/filtering,
 * print options popovers and sync status. The zoom-on-hover effect
 * across the whole surface is handled by thumb-preview.js.
 */
class SDCardManager {
    constructor() {
        const texts = window.texts || {};

        // Track whether auto-sync is running
        this.sdSyncInProgress = false;


        // Auto-close for print-options dropdowns
        this._initAutoCloseDropdowns();

        // Close popovers when clicking outside
        this._initPopoverCloseHandler();
    }

    // ========================================
    // showSDFiles — open modal + load file list
    // ========================================
    showSDFiles(forceRefresh = false) {
        // Klipper branch: lean file list via printerAdapter, without
        // Bambu-specific AMS/plate/spool picker. Bambu logic below
        // stays completely untouched.
        if (window.isKlipperMode && window.isKlipperMode()) {
            return this._showKlipperFiles();
        }
        const texts = window.texts || {};

        // Copy Spoolman spool HTML from the main selector
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

        // The dialog always opens in the live system. The archive is a
        // detour, not a state you'd expect to land back in next time it opens.
        window.sdArchivAktiv = false;
        if (typeof window.sdArchivKnopfSetzen === 'function') window.sdArchivKnopfSetzen();
        document.getElementById('sdCardModal').style.display = 'block';

        // Remove old upload status if present
        const oldStatus = document.getElementById('upload-status');
        if (oldStatus) {
            oldStatus.remove();
        }

        // During auto-sync: show info banner at the TOP
        if (this.sdSyncInProgress && !forceRefresh) {
            const modalContent = document.querySelector('#sdCardModal > div');

            // Remove old banner if present
            const existingBanner = document.getElementById('sync-banner');
            if (existingBanner) {
                existingBanner.remove();
            }

            // Create new banner
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
                <span>${(window.texts||{}).sd_bg_sync || 'Hintergrund-Sync läuft … neue Dateien kommen von selbst dazu'}</span>
            `;

            // Insert banner after the heading
            const h2 = modalContent.querySelector('h2');
            if (h2 && h2.nextSibling) {
                modalContent.insertBefore(syncBanner, h2.nextSibling);
            }

            // Disable ONLY the refresh button
            const refreshBtn = document.getElementById('sd-refresh-btn');
            if (refreshBtn) {
                refreshBtn.disabled = true;
                refreshBtn.style.opacity = '0.5';
                refreshBtn.innerHTML = window.skIcon('sanduhr') + '<span>' + (texts.sync_running || 'Sync läuft…') + '</span>';
            }

            // Show NO loading indicator - load cache directly!
            document.getElementById('sd-loading').style.display = 'none';
            // Disable ONLY the refresh button
            const syncRefreshBtn = document.getElementById('sd-refresh-btn');  // Different name!
            if (syncRefreshBtn) {
                syncRefreshBtn.disabled = true;
                syncRefreshBtn.style.opacity = '0.5';
                syncRefreshBtn.innerHTML = window.skIcon('sanduhr') + '<span>' + (texts.sync_running || 'Sync läuft…') + '</span>';
            }

        }

        // Extended animation only on force refresh
        let progressInterval = null;
        let startTime = null;

        if (forceRefresh) {
            // The sync status shows up in the HEADER, not in the list.
            //
            // It used to sit as a block in the middle of #sd-loading: it
            // appeared, pushed the whole list down, disappeared, and
            // everything slid back up. At two seconds long, that was just
            // jitter. Now a thin thread runs under the header
            // and the refresh button fills up — the feedback
            // sits right where you clicked, and covers nothing.
            //
            // Only when there's no list at all yet (first open) does
            // the sync get the whole area: nothing there to push out of the way.
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

            // The progress comes from the server, via `sd_sync_progress` — a
            // real number from "file N of M", not guessed.
            //
            // Until 02sep26 this was an estimate: a random step every 200 ms
            // up to 90%. It looked smooth and was made up out of
            // thin air — and it hid the fact that the server only moved its
            // progress at all during an actual download. Once everything is
            // already mirrored, that never happens; Android reads the same
            // value and so showed nothing at all.
            this._syncStand(0, texts);

            startTime = Date.now();

        } else if (!this.sdSyncInProgress) {
            // Normal loading — the feedback sits in the button, not above
            // the list. The block there used to push the whole content down.
            this._kopfLaedt(texts);
            document.getElementById('sd-loading').style.display = 'none';
            document.getElementById('sd-error').style.display = 'none';
        }

        // Load files (cache or force refresh)
        // On open and on refresh, always page 1 with the
        // current controls — search/sort are preserved.
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
                // Check for FTPS conflict (409)
                if (response.status === 409) {
                    return response.json().then(data => {
                        // FTPS is busy - show message
                        if (progressInterval) clearInterval(progressInterval);
                        document.getElementById('sd-loading').style.display = 'none';
                        this._syncKopfAus();

                        skToast(data.message || (window.texts||{}).ftps_busy || 'FTPS ist beschäftigt — bitte warten', 'warning');

                        // Still show cached files if available —
                        // the server also sends page, page count and
                        // total count even in a conflict.
                        if (data.files && data.files.length > 0) {
                            this.baueWerkzeugleiste();
                            this.zeigeSeite(data);
                        }
                        return null;  // Prevent further processing
                    });
                }
                return response.json();
            })
            .then(data => {
                if (!data) return;  // Was a 409 conflict

                // On force refresh: set progress to 100% and update status
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

                    // Leave it at 100 briefly, then remove.
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
                // One place for both cases: zeigeSeite renders the
                // list OR the empty-state message and sets the pagination bar.
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
                // Release the button — whether it worked or not.
                // Only if no sync is still running: that keeps the button
                // busy longer than this one request and cleans up itself.
                if (!this.sdSyncInProgress) this._syncKopfAus();
                // Load print defaults AFTER rendering
                this.loadPrintDefaults();
            });
    }

    // ========================================
    /**
     * Is the printer currently off?
     *
     * The file list itself doesn't need it — it comes from the server's
     * file mirror. Printing, deleting and syncing with the
     * printer do need it though; those get locked then.
     *
     * An unknown state (no status loaded yet) does NOT count as off —
     * otherwise everything would be locked for no reason right after loading.
     */
    druckerAus() {
        return window.lastKnownSwitchState === 'off';
    }

    /**
     * Syncing and uploading need the printer — both go over
     * FTPS. With the printer off, they get locked instead of running into
     * timeouts. The list itself stays readable.
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

        // Uploading stays possible with the printer off. The route says so
        // itself: it writes into the cache and does NOT touch FTPS. What
        // carries the file up is the sync at power-on
        // (_start_auto_sync_if_needed), the same one that carries a file
        // sliced while the printer was off. Locking it here only prevented
        // the preparation, never a failed transfer -- and Android and iOS
        // never locked it.
        const marke = document.querySelector('label[for="sd-file-upload"]');
        if (marke) {
            marke.title = aus ? (texts.sd_upload_offline_hint || '') : '';
        }
    }

    // applySDFilters — reads the controls and fetches page 1
    //
    // No longer searches, filters or sorts itself. The server does that
    // (routes/sdcard.py::_seitenweise), and over the whole set
    // rather than just the 25 visible files — otherwise you wouldn't find a
    // file that's on page 7.
    //
    // Any change to search, sort or filter jumps back to
    // page 1: the result set is different, "page 4" in it would be arbitrary.
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
     * Fetches a page from the server and renders it.
     *
     * Without force_refresh — paging and searching should NEVER open a connection
     * to the printer. The server answers that from its local
     * file mirror; FTPS runs only on the refresh button.
     */
    ladeSeite() {
        const a = this.sdAbfrage || (this.sdAbfrage = { page: 1, per_page: 25, sort: 'date' });
        const p = new URLSearchParams();
        p.set('page', a.page);
        p.set('per_page', a.per_page);
        if (a.sort) p.set('sort', a.sort);
        if (a.search) p.set('search', a.search);
        if (a.only_new) p.set('only_new', 'true');
        // Printer off: only read the mirror. Without this the server
        // tries an FTPS connection on an empty cache and runs into timeouts.
        if (this.druckerAus()) p.set('cache_only', 'true');

        // Track the running request: type quickly and responses can
        // arrive out of order. Only the latest one counts.
        const marke = (this._sdMarke = (this._sdMarke || 0) + 1);

        // The archive is a different source with the same shape — same
        // paging, same search, same sorting, same pager bar. It used to have
        // a fetch of its own that handed everything over as one page; that
        // was fine at six files and stopped being fine as it grew.
        const quelle = window.sdArchivAktiv
            ? '/api/sd/archiv?' + p.toString()
            : '/api/mqtt/sdcard?' + p.toString();

        return apiCall(quelle)
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
     * Renders a server response: list, counter, pagination bar.
     * One place for both modes (Bambu as well as Klipper).
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

        // What you can currently click sits in lastSDFiles — other
        // modules look up the clicked file there. In addition
        // we remember every file ever seen (sdDateiFinden), so a
        // lookup still works even after paging.
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

    /** Remembers every file seen, for lookups across page boundaries. */
    _merkeDateien(dateien) {
        if (!window.sdGesehen) window.sdGesehen = new Map();
        (dateien || []).forEach(f => {
            if (f && f.name) window.sdGesehen.set(f.name, f);
            if (f && f.path) window.sdGesehen.set(f.path, f);
        });
    }

    /** Counter in the toolbar: hits for search/filter, otherwise the total. */
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
     * Pagination bar below the list.
     *
     * Shows at most seven buttons: first, last, the current one each with
     * one neighbor, with ellipsis dots in between. With just a single
     * page, the bar stays invisible — with nineteen files there
     * shouldn't be anything there.
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

    /** Page change — just loads more, scrolls to the top of the list. */
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
     * Toolbar for the file list. Used to sit twice, word-for-word, in the code (Bambu
     * and Klipper paths) and had already drifted apart — now there's one
     * place. Idempotent: if it's already there, nothing happens.
     *
     * Search sits up front, because with a handful of files you search rather than
     * sort. The checkbox used to be named like an entry in the sort list
     * ("Newest first"), but it filters — hence "Only new".
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
            <!-- Which spool is active right now. It used to be a dropdown in
                 EVERY file card, everywhere with the same value -- here it
                 stands once, where it belongs. -->
            <button class="sd-aktive-spule" id="sd-aktive-spule" style="display:none;"
                    onclick="openSpoolmanFromSD()"></button>
        `;
        const behaelter = document.getElementById('sd-files-container');
        if (behaelter) {
            behaelter.insertBefore(leiste, document.getElementById('sd-files-list'));
        }
    }

    // ========================================
    // createSDFileCardHTML — one row of the file list
    //
    // Layout from 21aug26. Before, every file carried a data sheet of eleven
    // fields in two columns, a spool picker spanning the full width,
    // and three equally-sized colored buttons — a wall with nine files.
    // Now: preview, name, the four facts you actually search by (duration,
    // weight, filament, date), everything else behind "Details".
    //
    // opts.mode:
    //   'full' (default) — print, schedule, delete
    //   'schedule-pick'  — only "schedule" (pick a file for a plan)
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

        // Corrupt files (aborted upload, not a valid ZIP) can
        // only be deleted.
        const isCorrupt = file.corrupt === true;
        // A plain Studio or MakerWorld project carries no
        // print job: the archive is missing every `Metadata/plate_N.gcode`,
        // and that's exactly what the print command points at. The server checks this and sets
        // `nicht_geschnitten` ONLY on a clear no — without a readable copy
        // the field stays absent and everything behaves as before.
        const ungeschnitten = file.nicht_geschnitten === true;
        const isPrintable = !isCorrupt && !ungeschnitten
            && (file.name.endsWith('.3mf') || file.name.endsWith('.gcode'));
        const printState = String((window.lastPrintData || {}).gcode_state || '').toUpperCase();
        const printActive = ['RUNNING', 'PAUSE', 'PREPARE'].includes(printState);
        // With the printer off, the list stays readable, but printing
        // and deleting don't work — both touch the printer.
        const druckerAus = window.lastKnownSwitchState === 'off';
        const printDisabled = (printActive || druckerAus) ? ' disabled aria-disabled="true"' : '';
        const deleteDisabled = druckerAus ? ' disabled aria-disabled="true"' : '';
        const meta = file.extended_meta || {};
        const mdata = file.metadata || {};

        // --- Print time: Bambu delivers minutes, Klipper seconds ----------
        const dauerText = () => {
            let min = null;
            if (meta.print_time_minutes) min = meta.print_time_minutes;
            else if (meta.estimated_time) min = Math.round(meta.estimated_time / 60);
            if (min == null) return file.print_time || '';
            return min < 60 ? `${min} min`
                            : `${Math.floor(min / 60)} h ${min % 60} min`;
        };

        // --- The four facts you actually search a file by -----------
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
        // Spool recommendation. It arrives afterward, batched (one call for the
        // whole list instead of one per row) — this just reserves its spot here.
        if (!file.is_multifilament && (file.filament_material || file.filament_type)) {
            fakten.push(`<span class="sd-spulwahl" data-datei="${e(file.name)}"></span>`);
        }

        // --- Everything else: present, just collapsed ---------------------
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

        // --- Badges: new / already printed / corrupt ----------------------
        const marken = [];
        if (isCorrupt) {
            marken.push(`<span class="sd-marke sd-marke--korrupt">${e(texts.corrupt_file || 'Korrupte Datei')}</span>`);
        }
        if (ungeschnitten) {
            marken.push(`<span class="sd-marke sd-marke--ungeschnitten" title="${
                e(texts.file_unsliced_hint || 'Diese Datei enthält keinen Druckauftrag. In Bambu Studio öffnen, schneiden und erneut senden.')
            }">${e(texts.file_unsliced || 'Nicht geschnitten')}</span>`);
        } else if (!file.printed) {
            marken.push(`<span class="sd-marke sd-marke--neu">${e(texts.new_badge || 'Neu')}</span>`);
        }
        if (file.print_count > 0) {
            marken.push(`<span class="sd-marke sd-marke--gedruckt">${ic(IC_DRUCKER)}` +
                e((texts.times_printed || '{count}× gedruckt').replace('{count}', file.print_count)) + '</span>');
        }
        // Where the file comes from. The printer has two storage locations, and the same
        // file can exist on both — when deleting you need to know
        // which one is meant. The internal storage wasn't visible at all until 29aug26,
        // because FTPS only shows the stick.
        if (file.speicher) {
            const intern = file.speicher === 'intern';
            marken.push(`<span class="sd-marke sd-marke--speicher">` +
                e(intern ? (texts.storage_internal || 'Intern')
                         : (texts.storage_usb || 'USB-Stick')) + '</span>');
        }

        // Spool picker only in the expanded row, and only with Spoolman.
        // It used to sit in EVERY card, spanning the full width.
        // In the archive, the same card has different buttons: restore instead
        // of archive, and the trash icon deletes for good.
        const imArchiv = file.archiviert === true || file.location === 'archiv';
        const zeigeSpule = mode === 'full'
            && window.spoolmanManager && window.spoolmanManager.connected;

        // --- Actions: printing carries color, the rest are icons -------
        let aktionen;
        if (mode === 'schedule-pick') {
            // From the archive it takes one step more: fetch it back first,
            // otherwise the plan points at a file the sync deliberately never
            // carries onto the printer.
            const planen = imArchiv
                ? `schedulePrintFromArchive('${safeFilename}')`
                : `schedulePrintFromScheduleManager('${safeFilename}', '${fileLocation}')`;
            aktionen = isPrintable ? `
                <button class="sd-btn-haupt" onclick="${planen}"
                        title="${e(imArchiv ? (texts.sched_archive_pick
                                    || 'Aus dem Archiv holen und einplanen')
                                  : (texts.schedule || 'Planen'))}">
                    ${ic(IC_ZEIT)}${e(texts.schedule || 'Planen')}</button>` : '';
        } else {
            aktionen = `
                ${isPrintable ? `
                        <button class="sd-btn-haupt sd-print-action"${printDisabled} onclick="${imArchiv ? `sdArchivHolenUndDrucken('${safeFilename}', this)` : `startPrintFromSD('${safeFilename}', '${fileLocation}', this)`}"
                            title="${e(druckerAus ? (texts.sd_printer_off || 'Drucker ist aus')
                                : printActive ? (texts.print_blocked_active || 'Bei aktivem Druck kein Start möglich')
                                : (texts.print_now || texts.print || 'Drucken'))}">
                        ${ic(IC_DRUCKER)}${e(texts.print || 'Drucken')}</button>
                    <button class="sd-iknopf" onclick="schedulePrintFromSD('${safeFilename}', '${fileLocation}')"
                            title="${e(texts.schedule || 'Planen')}">${ic(IC_ZEIT)}</button>
                ` : ''}
                ${imArchiv ? `
                    <button class="sd-iknopf" onclick="sdArchivZurueckholen('${safeFilename}')"
                            title="${e(texts.sd_archive_restore || 'Zurück ins Live-System')}">
                        <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
                    </button>` : `
                    <button class="sd-iknopf" onclick="sdArchivAblegen('${safeFilename}', '${fileLocation}')"
                            title="${e(texts.sd_archive_put || 'Ins Archiv legen')}">
                        <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v3H3zM5 10v9h14v-9M10 14h4"/></svg>
                    </button>`}
                <button class="sd-iknopf sd-iknopf--rot"${imArchiv ? '' : deleteDisabled} onclick="${imArchiv ? `sdArchivLoeschen('${safeFilename}')` : `deleteFileFromSD('${safeFilename}', '${fileLocation}')`}"
                        title="${e(imArchiv ? (texts.sd_archive_delete || 'Endgültig löschen')
                                  : druckerAus ? (texts.sd_printer_off || 'Drucker ist aus')
                                  : (texts.delete_file || 'Löschen'))}">
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
     * Show the active spool in the toolbar. The source is the same
     * state as in the material zone (spoolmanManager); a click leads
     * there, so you can switch it.
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
     * Show sync — in the refresh button, nowhere else.
     *
     * Until 02sep26 a two-pixel-thin thread also ran alongside, under the
     * header. Two indicators for the same thing: the thread was too quiet
     * to carry it alone, and next to the button it was simply redundant.
     */
    _syncKopfAn() {
        const knopf = document.getElementById('sd-refresh-btn');
        if (knopf) {
            knopf.classList.add('sd-refresh--laeuft');
            knopf.disabled = true;
        }
    }

    /**
     * The brief load from the cache — also in the button.
     *
     * A block used to sit above the list for this. It pushed the whole
     * content down, even though the list was usually already there: it said
     * nothing you couldn't already see, and cost space and calm for it.
     */
    _kopfLaedt(texts) {
        const knopf = document.getElementById('sd-refresh-btn');
        if (!knopf) return;
        knopf.classList.add('sd-refresh--laeuft');
        knopf.disabled = true;
        const text = knopf.querySelector('span:not(.sd-refresh-fuell)');
        if (text) text.textContent = (texts && texts.sd_loading_short) || 'Lädt…';
    }

    /** Set progress — button fill and remaining time in one. */
    _syncStand(prozent, texts) {
        const p = Math.max(0, Math.min(100, prozent));
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

    /** Back to the idle state. */
    _syncKopfAus() {
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
        // ONE box for the whole list; a line separates the rows.
        container.className = 'sd-liste';
        container.innerHTML = '';
        this.zeigeAktiveSpule();
        files.forEach(file => {
            container.insertAdjacentHTML('beforeend', this.createSDFileCardHTML(file));
        });
        this._spulenEmpfehlungen(files);
    }

    /**
     * Adds, per row, which spool matches the file.
     *
     * ONE call for the whole list — with fourteen files that would be fourteen
     * requests for a single screen. The matching itself runs on the server
     * (find_matching_spools), so the list, scheduling and instant print share the
     * same opinion.
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
                    // Only say WHICH spool matches. "No matching spool"
                    // doesn't belong here: in the overview you're looking at
                    // fourteen files, of which you don't even want to print
                    // thirteen — that warning belongs at scheduling and at
                    // starting, where it actually changes something.
                    if (!treffer.spool_id) { el.remove(); return; }
                    el.textContent = treffer.count > 1
                        ? (texts.spool_match_row_many || '{n} passende Spulen')
                            .replace('{n}', treffer.count)
                        : (texts.spool_match_row || 'Passend: {spool}')
                            .replace('{spool}', treffer.display || '');
                    el.title = treffer.display || '';
                });
            })
            .catch(() => { /* without Spoolman the row stays as it is */ });
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

            // Klipper-Direct: timelapse default = CURRENT Moonraker state
            // (the plugin only has one global switch — the checkbox here
            // OVERWRITES it on startup; without this sync, every
            // start with an unchecked box flipped the Mainsail setting to off).
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
        // Check whether auto-sync is running
        if (this.sdSyncInProgress) {
            skToast(texts.toast_wait_sync, 'info');
            return;
        }

        // Otherwise a normal refresh
        this.showSDFiles(true);
    }

    // ========================================
    // handleFileUpload
    // ========================================
    handleFileUpload(input) {
        const texts = window.texts || {};
        const file = input.files[0];
        if (!file) return;

        // Reset input for reuse
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

        // Sanitized filename for comparison with backend (secure_filename replaces spaces with _)
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
                // Backend returns the sanitized filename
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

        // Klipper: lean delete via unified Files-API
        if (window.isKlipperMode && window.isKlipperMode()) {
            const doDelete = () => window.printerAdapter.deleteFile(filename).then(r => {
                if (r.ok) {
                    skToast((texts.toast_file_deleted || 'Datei gelöscht') + ': ' + filename, 'success');
                    self.showSDFiles(true);  // Refresh the list
                } else {
                    skToast(r.error || texts.toast_error_deleting || 'Fehler beim Löschen', 'error');
                }
            });
            const msg = (texts.confirm_delete_file || 'Datei wirklich löschen') + '?\n' + filename;
            if (window.showConfirmDialog) window.showConfirmDialog({ text: msg, knopf: texts.confirm_ok, gefaehrlich: true }, doDelete);
            else if (window.skConfirm) window.skConfirm(msg, { danger: true })
                .then(ja => { if (ja) doDelete(); });
            return;
        }

        // First check whether there are scheduled prints
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

                showConfirmDialog({ text: confirmMessage, knopf: texts.confirm_ok, gefaehrlich: true }, function() {
                    self.doDeleteFile(filename, location, checkData);
                });
            })
            .catch(error => {
                console.error(texts.console_error_checking + ':', error);
                showConfirmDialog({ text: texts.confirm_delete_file_warning.replace('{filename}', filename), knopf: texts.confirm_ok, gefaehrlich: true }, function() {
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

                // Messages go through the toast system top-right, like
                // everywhere else. There used to be a dedicated box here in the
                // middle of the screen — right in the dialog, with hardcoded German text.
                skToast((texts.sd_deleting_file || 'Deleting {filename}…')
                    .replace('{filename}', filename), 'info');

                // If there are scheduled prints, delete those first
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
                            // Refresh the lists if visible
                            if (typeof loadScheduledPrints === 'function') {
                                loadScheduledPrints();
                            }
                            if (typeof loadScheduleManagerList === 'function' && document.getElementById('scheduleManagerModal')) {
                                loadScheduleManagerList();
                            }
                        }

                        // Now delete the file
                        deleteSdFile();
                    });
                } else {
                    // No scheduled prints, delete directly
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
                            // WITH force: the loading indicator then sits in
                            // the refresh button, exactly like a manual
                            // refresh. Without force, the spinner appeared instead
                            // at the top of the dialog — and the deleted file
                            // would have kept showing up from the cache.
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
                        // On poor quality, automatically request a full status
                        requestFullStatus();
                    }
                }
            });
    }

    // ========================================
    // closeSDModal
    // ========================================
    closeSDModal() {
        // Remove upload status on close
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

        // Detect extension (compound extensions first)
        let ext = '';
        const lowerName = filename.toLowerCase();
        if (lowerName.endsWith('.gcode.3mf')) ext = filename.slice(-10);
        else if (lowerName.endsWith('.gcode')) ext = filename.slice(-6);
        else if (lowerName.endsWith('.3mf')) ext = filename.slice(-4);

        const baseName = filename.slice(0, filename.length - ext.length);
        const originalHTML = nameEl.innerHTML;
        const originalTitle = nameEl.title;

        // Create inline edit
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

        // Enter → save
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                self._commitRename(nameEl, input, ext, filename, originalHTML, originalTitle);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                self._cancelRename(nameEl, originalHTML, originalTitle);
            }
        });

        // Blur → save (with delay for Enter race)
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

        // Empty or unchanged → cancel
        if (!newBaseName || newBaseName + ext === oldFilename) {
            this._cancelRename(nameEl, originalHTML, originalTitle);
            return;
        }

        const newFilename = newBaseName + ext;

        // Check for invalid characters
        if (/[\\\/\:\*\?\"\<\>\|]/.test(newBaseName)) {
            input.classList.add('sd-rename-input--error');
            setTimeout(() => input.classList.remove('sd-rename-input--error'), 1000);
            input.focus();
            return;
        }

        // Loading state
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
                // Update name element
                const safeNew = newFilename.replace(/'/g, "\\'");
                nameEl.textContent = newFilename;
                nameEl.title = newFilename;
                nameEl.setAttribute('ondblclick', `startRenameFile(this, '${safeNew}')`);

                // Update card attributes
                const card = nameEl.closest('.sd-zeile') || nameEl.closest('.sd-file-card');
                if (card) {
                    card.setAttribute('data-filename', newFilename);
                    const location = 'root';

                    // Rewrite actions. Since the 21aug26 rebuild,
                    // print carries .sd-btn-haupt and the rest .sd-iknopf — searching
                    // for the old onclick still matches both forms.
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

                    // Update thumbnail
                    const thumbImg = card.querySelector('img.sd-thumb');
                    if (thumbImg) {
                        thumbImg.src = `/api/sd_thumbnail/${encodeURIComponent(newFilename)}`;
                    }

                    // Update data-file attributes
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
    // Auto-close for print-options dropdowns
    // ========================================
    _initAutoCloseDropdowns() {
        document.addEventListener('click', function(e) {
            // Find all open details
            const openDetails = document.querySelectorAll('details[open]');

            openDetails.forEach(detail => {
                // If the click was NOT inside the details element, close it
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
    // Klipper file browser (lean variant)
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

        // Cache Spoolman spools too — same code as the Bambu path
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

        // Backend delivers Klipper files in a Bambu-compatible format
        // (`name`, `size`, `metadata`, `extended_meta`, `weight`, `slicer`,
        // `sort_timestamp`, ...). → we use the same displaySDFiles
        // path AND the same sort toolbar as Bambu.
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

            // The adapter delivers the same header (total/page/pages) as
            // the Bambu server — same render path, same pagination bar.
            this.zeigeSeite(r);
            // Load print-option defaults (timelapse = current Moonraker
            // state). The Bambu path does this in loadSDFiles().finally —
            // this Klipper path never did → the timelapse checkbox was
            // ALWAYS unchecked in direct mode (the actual root of the bug).
            this.loadPrintDefaults();

            // Two-step, like the history view: render the cache immediately (above),
            // then pull fresh history in the background and update the new/printed
            // badges — without a loading state or rebuild. Fixes: a file just
            // printed still showed as "new" until you'd first opened the
            // history view.
            window.printerAdapter.listFiles({ ..._abf(), fresh: true }).then(r2 => {
                if (r2 && r2.ok && Array.isArray(r2.files)) {
                    this.zeigeSeite(r2);
                }
            }).catch(() => {});
        });
    }

    // _displayKlipperFiles / _enrichKlipperCards / _enrichOneKlipperCard
    // are REMOVED — Klipper now runs through the same Bambu
    // render path (applySDFilters → displaySDFiles → createSDFileCardHTML)
    // with metadata that the Klipper files sync has already baked
    // into the file list. The old functions fired an
    // /api/printer/files/metadata call per card, which produced 16
    // "metadata lookup failed" lines in the log with the host offline.
}

// Klipper-specific helpers (print start without AMS/plate wizard,
// delete via unified Files-API). Bambu equivalents are
// startPrintFromSD/deleteFileFromSD above in the class.
// Confirmation via the styled in-app modal (showConfirmDialog) instead of the native
// confirm(); falls back to confirm() if that module isn't loaded.
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
            // Reload the list
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
// Archive — files that stay here, but not on the printer
// ========================================
// The toggle above swaps the source of the list, nothing else: the
// cards are the same, only the buttons change (see imArchiv).

window.sdArchivAktiv = false;

/** Label of the header button — on open and after every toggle. */
window.sdArchivKnopfSetzen = function() {
    const texts = window.texts || {};
    const knopf = document.getElementById('sd-archiv-schalter');
    if (!knopf) return;
    const an = window.sdArchivAktiv === true;
    knopf.classList.toggle('sd-header-btn--an', an);
    knopf.title = texts.sd_archive_hint || '';
    const label = document.getElementById('sd-archiv-schalter-text');
    if (label) label.textContent = an
        ? (texts.sd_archive_live || 'Live')
        : (texts.sd_archive || 'Archiv');
};

window.sdArchivUmschalten = function() {
    window.sdArchivAktiv = !window.sdArchivAktiv;
    window.sdArchivKnopfSetzen();
    if (window.sdArchivAktiv) window.sdArchivLaden();
    else window.sdCardManager.showSDFiles();
};

window.sdArchivLaden = function() {
    // Back to page one: what stood on page 3 of the live list says nothing
    // about the archive.
    const verwalter = window.sdCardManager;
    verwalter.sdAbfrage = verwalter.sdAbfrage || { per_page: 25, sort: 'date' };
    verwalter.sdAbfrage.page = 1;
    return verwalter.ladeSeite();
};

/**
 * Take the affected row out of the list, instead of reloading everything.
 *
 * Reloading the list triggers a sync with the printer. Anyone
 * archiving several files in a row would trigger a sync per
 * click — and that would promptly bring the just-archived file back, because
 * it was still sitting on the printer (02sep26, 22 files doubled up). On top of that,
 * the UI lagged behind every click.
 *
 * The row is gone anyway as soon as the server says "success" — so we
 * take it out immediately and leave the printer alone.
 */
function sdZeileEntfernen(name) {
    const liste = document.getElementById('sd-files-list');
    if (!liste) return;
    const zeile = liste.querySelector(`.sd-zeile[data-filename="${CSS.escape(name)}"]`);
    if (zeile) {
        const traeger = zeile.closest('.sd-file-item') || zeile;
        traeger.remove();
    }
    const kopf = window.sdCardManager.sdKopf;
    if (kopf && typeof kopf.total === 'number' && kopf.total > 0) {
        kopf.total -= 1;
        window.sdCardManager.zaehlerSchreiben();
    }
    // Also from the remembered list, so a lookup no longer
    // finds the file where it no longer exists.
    if (Array.isArray(window.lastSDFiles)) {
        window.lastSDFiles = window.lastSDFiles.filter(f => f && f.name !== name);
    }
}

function sdArchivRuf(pfad, name, erfolgstext) {
    const texts = window.texts || {};
    return apiCall(pfad, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ filename: name })
    })
        .then(r => r.json())
        .then(daten => {
            if (!daten || !daten.success) {
                skToast((daten && daten.error) || (texts.toast_error || 'Fehler'), 'error');
                return false;
            }
            skToast(erfolgstext, 'success');
            sdZeileEntfernen(name);
            return true;
        })
        .catch(() => {
            skToast(texts.connection_failed || 'Verbindungsfehler', 'error');
            return false;
        });
}

window.sdArchivAblegen = function(name, ort) {
    const texts = window.texts || {};
    return apiCall('/api/sd/archiv/ablegen', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ filename: name, location: ort || 'root' })
    })
        .then(r => r.json())
        .then(daten => {
            if (!daten || !daten.success) {
                skToast((daten && daten.error) || (texts.toast_error || 'Fehler'), 'error');
                return;
            }
            // The printer loses the file on the next sync — even
            // if it's currently off. That's worth saying, otherwise someone
            // will wonder why it's still sitting there.
            skToast(texts.sd_archive_done || 'Ins Archiv gelegt — verschwindet beim nächsten Abgleich vom Drucker', 'success');
            sdZeileEntfernen(name);
        })
        .catch(() => skToast(texts.connection_failed || 'Verbindungsfehler', 'error'));
};

window.sdArchivZurueckholen = function(name) {
    const texts = window.texts || {};
    return sdArchivRuf('/api/sd/archiv/zurueckholen', name,
        texts.sd_archive_restored || 'Zurückgeholt — wandert beim nächsten Abgleich auf den Drucker');
};

window.sdArchivLoeschen = function(name) {
    const texts = window.texts || {};
    const frage = (texts.sd_archive_delete_confirm
        || 'Endgültig löschen? Aus dem Archiv gibt es kein Zurück.');
    if (!confirm(frage)) return;
    return sdArchivRuf('/api/sd/archiv/loeschen', name,
        texts.file_deleted_ok || 'Datei gelöscht');
};

/** Print from the archive: restore, upload, start. */
window.sdArchivHolenUndDrucken = async function(name, knopf) {
    const texts = window.texts || {};
    if (knopf) knopf.disabled = true;
    try {
        const antwort = await apiCall('/api/sd/archiv/zurueckholen', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ filename: name })
        });
        const daten = await antwort.json();
        if (!daten || !daten.success) {
            skToast((daten && daten.error) || (texts.toast_error || 'Fehler'), 'error');
            return;
        }
        // Back to the live view, then the normal path — that loads the
        // file onto the printer itself if needed. `sdArchivUmschalten` flips
        // the state, so it's called here exactly once.
        if (window.sdArchivAktiv) window.sdArchivUmschalten();
        startPrintFromSD(name, 'root', knopf);
    } finally {
        if (knopf) knopf.disabled = false;
    }
};

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

// Search is debounced: otherwise every keystroke would hit the server. 300 ms is
// short enough to feel instant, and long enough that a typed
// word results in one request instead of seven.
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

// Page change from the pagination bar.
window.sdSeiteWechseln = function(n) { window.sdCardManager.geheZuSeite(n); };

/**
 * Look up a file by name (or path).
 *
 * Since the list is paginated, lastSDFiles only holds the
 * visible page. Other modules (print preparation, scheduler, print start)
 * look up the clicked file there — that always hits the
 * current page, but after a page change, a lookup for
 * a previously seen file would otherwise come up empty. Hence the additional stock
 * of all pages loaded so far.
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
 * Spool picker directly from the file list. The chip used to close the list
 * and jump to the material zone — you'd land on the main page and have
 * to click back. The picker belongs where you already are.
 */
window.openSpoolmanFromSD = async function() {
    const texts = window.texts || {};
    const sm = window.spoolmanManager;
    if (!sm || !sm.connected) return;

    // Fetch a fresh list if the cache is empty (dialog opened before the
    // material zone has loaded for the first time).
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
        // Update the chip in the toolbar immediately — activate() doesn't know
        // about the file list.
        if (window.sdCardManager) window.sdCardManager.zeigeAktiveSpule();
    };
};

/** Expand and collapse the details and spool picker of a file row. */
window.sdZeileUmschalten = function(knopf) {
    const zeile = knopf.closest('.sd-zeile');
    if (zeile) zeile.classList.toggle('offen');
};
window.displaySDFiles = function(files) { window.sdCardManager.displaySDFiles(files); };
