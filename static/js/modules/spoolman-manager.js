/**
 * Spoolman Manager
 * Filament spool management, activation, and display
 */
class SpoolmanManager {
    constructor() {
        this.connected = false;
        this.activeSpoolId = null;
    }

    async init() {
        const texts = window.texts || {};
        console.log(texts.console_spoolman_init_start);

        await this.checkStatus();
        if (this.connected) {
            await this.loadSpools();
        }

        setInterval(async () => {
            await this.checkStatus();
            if (this.connected) {
                await this.loadSpools();
            }
        }, 30000);
    }

    async checkStatus() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/spoolman/status');
            const data = await response.json();

            const statusIndicator = document.getElementById('spoolman-connection');
            const spoolmanContent = document.getElementById('spoolman-content');

            // spoolman-card-grid exists only in Klipper mode -- in Bambu mode
            // the block lives in the material zone. The card is therefore NO
            // longer a precondition.
            if (!statusIndicator || !spoolmanContent) return;

            if (data.enabled && data.connected) {
                statusIndicator.classList.add('connected');
                statusIndicator.classList.remove('disconnected');
                this.connected = true;
                spoolmanContent.style.display = 'block';
            } else {
                statusIndicator.classList.add('disconnected');
                statusIndicator.classList.remove('connected');
                this.connected = false;
                if (!data.enabled) {
                    spoolmanContent.style.display = 'none';
                }
            }

            this.activeSpoolId = data.active_spool;
            window.activeSpoolId = data.active_spool;

            if (data.active_spool) {
                const selector = document.getElementById('spool-selector');
                if (selector) {
                    selector.value = data.active_spool;
                }
                this.updateDisplay();
            }

        } catch (error) {
            console.error(texts.console_spoolman_status_error + ':', error);
        }
    }

    async loadSpools() {
        const texts = window.texts || {};
        if (!this.connected) return;

        try {
            const response = await apiCall('/api/spoolman/spools');
            const spools = await response.json();
            // Remembered: the file list shows the active spool in its toolbar
            // and needs more than just the id for that.
            this.spools = spools;
            if (window.sdCardManager) window.sdCardManager.zeigeAktiveSpule();
            this._knopfBeschriften();

            const selector = document.getElementById('spool-selector');
            if (!selector) return;

            while (selector.options.length > 1) {
                selector.remove(1);
            }

            spools.forEach(spool => {
                const option = document.createElement('option');
                option.value = spool.id;

                const vendor = spool.filament?.vendor?.name || '';
                const filamentName = spool.filament?.name || 'Unbekannt';
                const name = vendor ? `${vendor} ${filamentName}` : filamentName;
                const material = spool.filament?.material || 'PLA';
                const remaining = spool.remaining_weight || 0;
                const percentage = spool.remaining_percentage || 0;

                option.textContent = `${name} (${material}) - ${remaining.toFixed(0)}g (${percentage.toFixed(0)}%)`;
                if (spool.status === 'critical') {
                    option.style.color = '#ef4444';
                } else if (spool.status === 'warning') {
                    option.style.color = '#f59e0b';
                }

                const multiColors = spool.filament?.multi_color_hexes;
                if (multiColors && multiColors.length > 0) {
                    const colors = multiColors.split(',').map(c => `#${c.trim()}`);
                    option.style.borderImage = `linear-gradient(to bottom, ${colors.join(', ')}) 1`;
                    option.style.borderLeft = '4px solid';
                } else {
                    const color = spool.filament?.color_hex || '888888';
                    option.style.borderLeft = `4px solid #${color}`;
                }

                selector.appendChild(option);
            });

            if (this.activeSpoolId) {
                selector.value = this.activeSpoolId;
                const activeSpool = spools.find(s => s.id === this.activeSpoolId);
                if (activeSpool) {
                    this.updateActiveInfo(activeSpool);
                }
            }
        } catch (error) {
            console.error(texts.console_error_loading_spools + ':', error);
        }
    }

    createCard(spool) {
        const card = document.createElement('div');
        card.className = 'spool-card';
        if (spool.id === this.activeSpoolId) {
            card.classList.add('active');
        }

        const color = spool.filament?.color_hex || '#888888';
        const vendor = spool.filament?.vendor?.name || '';
        const filamentName = spool.filament?.name || 'Unbekannt';
        const name = vendor ? `${vendor} ${filamentName}` : filamentName;
        const material = spool.filament?.material || 'PLA';
        const remaining = spool.remaining_weight || 0;
        const percentage = spool.remaining_percentage || 0;

        card.innerHTML = `
            <div class="spool-color-indicator" style="background-color:${color}"></div>
            <div class="spool-name">${name}</div>
            <div class="spool-weight">${material} - ${remaining.toFixed(0)}g</div>
            <div class="spool-percentage">${percentage.toFixed(0)}%</div>
        `;

        card.onclick = () => this.activate(spool.id);

        return card;
    }

    updateActiveInfo(spool) {
        const texts = window.texts || {};
        const infoDiv = document.getElementById('active-spool-info');

        if (!infoDiv) {
            console.log(texts.console_active_spool_div_not_found);
            return;
        }

        if (!spool) {
            infoDiv.innerHTML = `<div style="text-align:center; color:#666;">${texts.no_spool_selected}</div>`;
            const spoolInfo = document.getElementById('spool-info');
            if (spoolInfo) {
                spoolInfo.style.display = 'none';
            }
            return;
        }

        const color = spool.filament?.color_hex || '888888';
        const vendor = spool.filament?.vendor?.name || '';
        const filamentName = spool.filament?.name || 'Unbekannt';
        const name = vendor ? `${vendor} ${filamentName}` : filamentName;
        const material = spool.filament?.material || 'PLA';
        const remaining = spool.remaining_weight || 0;
        const percentage = spool.remaining_percentage || 0;

        const colorDot = document.getElementById('spool-color-dot');
        if (colorDot) {
            const multiColors = spool.filament?.multi_color_hexes;
            if (multiColors && multiColors.length > 0) {
                const colors = multiColors.split(',').map(c => `#${c.trim()}`);
                colorDot.style.background = `conic-gradient(${colors.join(', ')})`;
                colorDot.style.backgroundColor = '';
            } else {
                colorDot.style.background = '';
                colorDot.style.backgroundColor = `#${color}`;
            }
        }

        const nameEl = document.getElementById('spool-name');
        if (nameEl) {
            nameEl.textContent = name;
        }
        const remainingEl = document.getElementById('spool-remaining');
        if (remainingEl) {
            remainingEl.textContent = `${remaining.toFixed(0)}g`;
            if (remaining <= 50) {
                remainingEl.style.color = '#ef4444';
            } else if (remaining <= 150) {
                remainingEl.style.color = '#f59e0b';
            } else {
                remainingEl.style.color = '#10b981';
            }
        }
        const detailsEl = document.getElementById('spool-details');
        if (detailsEl) {
            detailsEl.textContent = material;
        }
        const weightEl = document.getElementById('spool-weight');
        if (weightEl) {
            weightEl.textContent = `${remaining.toFixed(0)}g`;
            if (remaining <= 50) {
                weightEl.style.color = '#ef4444';
            } else if (remaining <= 150) {
                weightEl.style.color = '#f59e0b';
            } else {
                weightEl.style.color = 'var(--accent-green)';
            }
        }
        const percentEl = document.getElementById('spool-percent');
        if (percentEl) {
            percentEl.textContent = `${percentage.toFixed(0)}%`;
            if (remaining <= 50) {
                percentEl.style.color = '#ef4444';
            } else {
                percentEl.style.color = 'var(--text-secondary)';
            }
        }

        if (infoDiv) {
            infoDiv.style.display = 'block';
        }
    }

    async activate(spoolId) {
        const texts = window.texts || {};
        if (!spoolId) {
            window.activeSpoolId = null;
            this.activeSpoolId = null;
            this.updateDisplay();
            return;
        }

        try {
            const response = await apiCall(`/api/spoolman/spool/${spoolId}/activate`, {
                method: 'POST'
            });
            const data = await response.json();

            if (data.success) {
                window.activeSpoolId = parseInt(spoolId);
                this.activeSpoolId = parseInt(spoolId);
                this.updateDisplay();
                // If the change happened mid-print, the server booked the
                // share used up to that point onto the old spool -- that wants
                // saying, or the remaining amount looks puzzling.
                if (data.booked_to_previous) {
                    skToast((texts.toast_spool_changed_booked || '')
                        .replace('{g}', Math.round(data.booked_to_previous))
                        || `${Math.round(data.booked_to_previous)} g auf die alte Rolle gebucht`, 'success');
                } else {
                    // With context: "spool activated" alone does not say which one.
                    const gewaehlt = (this.spools || []).find(x => x.id === parseInt(spoolId));
                    const fil = (gewaehlt && gewaehlt.filament) || {};
                    const hersteller = (fil.vendor && fil.vendor.name) || '';
                    const teile = [];
                    if (fil.name) teile.push((hersteller ? hersteller + ' ' : '') + fil.name);
                    if (fil.material) teile.push(fil.material);
                    if (gewaehlt && gewaehlt.remaining_weight != null) {
                        teile.push(Math.round(gewaehlt.remaining_weight) + ' g');
                    }
                    skToast(texts.toast_spool_activated, {
                        detail: teile.join(' · '),
                        farbe: fil.color_hex ? '#' + String(fil.color_hex).replace('#', '') : null,
                    });
                }

                const sdSelector = document.querySelector('#sd-spool-selector');
                if (sdSelector) {
                    sdSelector.value = spoolId;
                }
            } else {
                window.activeSpoolId = null;
                this.activeSpoolId = null;
                document.getElementById('spool-selector').value = '';
                skToast(texts.toast_error_activating, 'error');
            }
        } catch (error) {
            console.error(texts.console_error + ':', error);
            window.activeSpoolId = null;
            this.activeSpoolId = null;
            document.getElementById('spool-selector').value = '';
            skToast(texts.connection_error, 'error');
        }
    }

    /**
     * The button on the material card carries the active spool: a colour dot
     * and the name. Without it you would only see what is loaded after opening
     * the window -- the old dropdown showed it directly.
     */
    _knopfBeschriften() {
        const text = document.getElementById('mz-spulknopf-text');
        const punkt = document.getElementById('mz-spulknopf-punkt');
        if (!text) return;
        const texts = window.texts || {};
        const id = window.activeSpoolId || this.activeSpoolId;
        const spule = (this.spools || []).find(s => s.id === id);
        if (!spule) {
            text.textContent = texts.spool_choose || 'Spule wählen';
            if (punkt) punkt.style.background = 'rgba(128,128,128,0.25)';
            return;
        }
        const fil = spule.filament || {};
        const hersteller = (fil.vendor && fil.vendor.name) || '';
        const rest = Math.round(spule.remaining_weight || 0);
        text.textContent = [
            [hersteller, fil.name].filter(Boolean).join(' '),
            fil.material ? `(${fil.material})` : '',
            `${rest} g`,
        ].filter(Boolean).join(' · ');
        if (punkt && fil.color_hex) {
            punkt.style.background = '#' + String(fil.color_hex).replace('#', '').slice(0, 6);
        }
    }

    updateDisplay() {
        const texts = window.texts || {};
        this._knopfBeschriften();
        const activeInfo = document.getElementById('active-spool-info');
        if (!activeInfo) return;

        const currentSpoolId = window.activeSpoolId || this.activeSpoolId;

        if (!currentSpoolId) {
            activeInfo.innerHTML = `
                <div style="color:var(--text-secondary); font-size:13px; text-align:center;">
                    ${texts.no_spool_selected}
                </div>
            `;
            return;
        }

        apiCall(`/api/spoolman/spool/${currentSpoolId}`)
            .then(response => response.json())
            .then((spool) => {
                if (spool && !spool.error) {
                    let colorStyle = '';
                    const multiHexes = spool.filament?.multi_color_hexes;
                    if (multiHexes && multiHexes.length > 0) {
                        const colors = multiHexes.split(',').map(c => '#' + c.trim());
                        colorStyle = `background:conic-gradient(${colors.join(', ')})`;
                    } else {
                        let color = spool.filament?.color_hex || '888888';
                        color = color.replace('#', '');
                        colorStyle = `background:#${color}`;
                    }

                    const price = spool.price || spool.filament?.price || 0;

                    let lastUsed = texts.never_used;
                    let daysSinceUse = null;
                    if (spool.last_used) {
                        const lastUsedDate = new Date(spool.last_used);
                        const now = new Date();
                        const diffTime = Math.abs(now - lastUsedDate);
                        // floor rather than ceil: a day that has begun is not a
                        // whole one. With ceil the hint read "31" at exactly 30
                        // days and fired a day too early -- the drying switch in
                        // the print preparation uses the same arithmetic.
                        daysSinceUse = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                        lastUsed = lastUsedDate.toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }

                    // The humidity history stands in the spool picker, not
                    // here: on the home page it was just another tile that
                    // nobody was looking for.
                    const dryingHint = ((daysSinceUse && daysSinceUse > 30) ? `
                        <div style="grid-column:1/4; text-align:center; margin-top:8px;
                             padding:6px 10px; background:rgba(255,152,0,0.1);
                             border:1px solid var(--accent-orange); border-radius:6px;">
                            <div style="color:var(--accent-orange); font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px;">
                                <svg class="hd-ic hd-ic--xs" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4.5 4.5 0 1 0 4 0z"/></svg>
                                <span>${texts.should_dry_spool}</span>
                            </div>
                        </div>
                    ` : '');

                    activeInfo.innerHTML = `
                        <div style="display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:15px;">
                            <div style="position:relative; width:32px; height:32px; flex-shrink:0;">
                                <div style="position:absolute; width:32px; height:32px;
                                     border-radius:50%;
                                     ${colorStyle};
                                     border:1.5px solid #222;
                                     box-shadow:0 2px 4px rgba(0,0,0,0.3), inset 0 -2px 4px rgba(0,0,0,0.2);">
                                </div>
                                <div style="position:absolute; top:50%; left:50%;
                                     transform:translate(-50%, -50%);
                                     width:10px; height:10px;
                                     border-radius:50%;
                                     background:var(--bg-secondary);
                                     border:1px solid #222;
                                     box-shadow:inset 0 2px 4px rgba(0,0,0,0.5);">
                                </div>
                            </div>
                            <div>
                                <div style="font-size:11px; color:var(--text-secondary); margin-bottom:2px;">
                                    ${texts.price}
                                </div>
                                <div style="font-size:16px; font-weight:600; color:var(--text-primary);">
                                    ${price > 0 ? price.toFixed(2).replace('.', ',') + ' €' : '—'}
                                </div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:11px; color:var(--text-secondary); margin-bottom:2px;">
                                    ${texts.last_used}
                                </div>
                                <div style="font-size:14px; color:var(--text-primary);">
                                    ${lastUsed}
                                </div>
                            </div>

                            ${dryingHint}
                        </div>
                    `;
                } else {
                    activeInfo.innerHTML = `
                        <div style="color:var(--text-secondary); font-size:13px; text-align:center;">
                            ${texts.spool_load_error}
                        </div>
                    `;
                }
            })
            .catch(error => {
                console.error(texts.console_error_loading_spool_details + ':', error);
                activeInfo.innerHTML = `
                    <div style="color:var(--accent-red); font-size:13px; text-align:center;">
                        ${texts.connection_error}
                    </div>
                `;
            });
    }

    async openWeb() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/config');
            const config = await response.json();

            let spoolmanUrl = config.spoolman?.external_url || config.spoolman?.url;

            if (!spoolmanUrl) {
                skToast('Spoolman URL nicht konfiguriert', 'warning');
                return;
            }

            window.open(spoolmanUrl, '_blank');
        } catch (error) {
            console.error(texts.console_error_opening + ':', error);
            skToast(texts.connection_error || 'Verbindungsfehler', 'error');
        }
    }

    selectFromSD(spoolId) {
        const texts = window.texts || {};
        if (spoolId) {
            apiCall(`/api/spoolman/spool/${spoolId}/activate`, {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    window.activeSpoolId = parseInt(spoolId);
                    const mainSelector = document.getElementById('spool-selector');
                    if (mainSelector) {
                        mainSelector.value = spoolId;
                    }
                    console.log(`✅ Spool ${spoolId} activated`);
                }
            });
        } else {
            window.activeSpoolId = null;
        }
    }

    updateSelection(spoolId) {
        const texts = window.texts || {};
        if (spoolId) {
            apiCall('/api/spoolman/select', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({spool_id: parseInt(spoolId)})
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    window.activeSpoolId = parseInt(spoolId);
                    skToast(texts.toast_spool_selected.replace('{spool}', spoolId), 'success');
                }
            });
        } else {
            window.activeSpoolId = null;
        }
    }
}

// Global singleton
window.spoolmanManager = new SpoolmanManager();

// Backwards compatibility
window.initSpoolman = () => window.spoolmanManager.init();
window.checkSpoolmanStatus = () => window.spoolmanManager.checkStatus();
window.loadSpools = () => window.spoolmanManager.loadSpools();
window.createSpoolCard = (spool) => window.spoolmanManager.createCard(spool);
window.updateActiveSpoolInfo = (spool) => window.spoolmanManager.updateActiveInfo(spool);
window.activateSpool = (id) => window.spoolmanManager.activate(id);
window.updateSpoolmanDisplay = () => window.spoolmanManager.updateDisplay();
window.openSpoolmanWeb = () => window.spoolmanManager.openWeb();
window.selectSpoolFromSD = (id) => window.spoolmanManager.selectFromSD(id);
window.updateSpoolSelection = (id) => window.spoolmanManager.updateSelection(id);
