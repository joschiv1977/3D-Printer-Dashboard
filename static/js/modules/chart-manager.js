/**
 * Chart Manager
 * Handles all chart creation, updating, and modal management
 * for sensor charts (stacked, combined, individual)
 */
class ChartManager {
    constructor() {
        const texts = window.texts || {};

        this.currentChart = null;
        this.chartUpdateInterval = null;
        this.costSettings = {
            filament_per_kg: 21,
            power_per_kwh: 0.285
        };
        this.combinedChartType = null;
        this.stackedCharts = { temp: null, fans: null, power: null };

        // Modal schliessen bei Klick ausserhalb
        const chartModal = document.getElementById('chartModal');
        if (chartModal) {
            chartModal.addEventListener('click', (e) => {
                if (e.target === chartModal) {
                    this.closeChartModal();
                }
            });
        }
    }

    calculateCost(stats) {
        const texts = window.texts || {};
        if (stats.print_cost_eur != null && stats.print_cost_eur > 0) {
            return parseFloat(stats.print_cost_eur).toFixed(2);
        }
        const filamentPerKg = this.costSettings.filament_per_kg || 25;
        const powerPerKwh = this.costSettings.power_per_kwh || 0.30;
        const filamentGrams = parseFloat(stats.filament_used_grams) || 0;
        const powerKwh = parseFloat(stats.total_power_kwh) || 0;
        const total = (filamentGrams / 1000) * filamentPerKg + powerKwh * powerPerKwh;
        return isNaN(total) ? "0.00" : total.toFixed(2);
    }

    showAllCharts() {
        const texts = window.texts || {};
        document.getElementById('chartModal').style.display = 'block';
        document.getElementById('chartTitle').textContent = texts.chart_all_sensors || 'Alle Sensoren';
        document.getElementById('chartStats').style.display = 'none';
        document.getElementById('sensorChart').style.display = 'none';
        document.getElementById('stackedChartsContainer').style.display = 'block';

        this.combinedChartType = 'stacked';
        this.createStackedCharts();

        this.chartUpdateInterval = setInterval(() => {
            this.updateStackedCharts();
        }, 8000);
    }

    /** Farbwert aus den Design-Tokens — damit Hell/Dunkel stimmt. */
    _token(name, ersatz) {
        const v = getComputedStyle(document.documentElement)
            .getPropertyValue(name).trim();
        return v || ersatz;
    }

    makeChartOptions(einheit, yMin, yMax, xAchse) {
        const rand = this._token('--border-color', '#404859');
        const text = this._token('--text-secondary', '#8a8f9a');
        const karte = this._token('--bg-card', '#1A1F2E');
        const haupt = this._token('--text-primary', '#E8EAED');
        // Gitter aus der Textfarbe abgeleitet: haelt in beiden Modi Abstand
        // zur Flaeche, ohne eine zweite Token-Reihe zu brauchen.
        const gitter = 'rgba(128,128,128,0.14)';

        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                // Eigene Chip-Legende ueber dem Chart — die von Chart.js
                // zeigte nur Ringe ohne Werte.
                legend: { display: false },
                tooltip: {
                    backgroundColor: karte, titleColor: haupt, bodyColor: haupt,
                    borderColor: rand, borderWidth: 1, padding: 9,
                    boxWidth: 8, boxHeight: 8, usePointStyle: true,
                    callbacks: {
                        label: c => ' ' + c.dataset.label + '  ' +
                            (c.parsed.y != null ? c.parsed.y.toFixed(1) : '--') + ' ' + einheit
                    }
                }
            },
            scales: {
                x: {
                    display: xAchse,
                    grid: { display: false },
                    border: { color: rand },
                    ticks: { color: text, font: { size: 10 }, maxRotation: 0,
                             autoSkip: true, maxTicksLimit: 8 }
                },
                y: {
                    min: yMin, max: yMax,
                    grid: { color: gitter, drawTicks: false },
                    border: { display: false },
                    // Einheit am Tick statt als gedrehter Achsentitel — spart
                    // Breite und liest sich besser.
                    ticks: { color: text, font: { size: 10 }, padding: 8,
                             maxTicksLimit: 5, callback: v => v + ' ' + einheit }
                }
            }
        };
    }

    /** Chip-Legende mit Momentanwert; Klick blendet die Kurve aus.
     *
     *  Baut nur beim ersten Mal auf. Danach wird bloss der Wert ersetzt —
     *  wuerde die Reihe alle paar Sekunden neu entstehen, verloere man mit
     *  jedem Auffrischen die ausgeblendeten Kurven und den Mauszeiger-Fokus.
     */
    _baueChips(behaelterId, chart, einheit) {
        const box = document.getElementById(behaelterId);
        if (!box || !chart) return;

        const wert = ds => {
            const letzte = [...ds.data].reverse().find(v => v != null);
            return (letzte != null ? letzte.toFixed(1) : '--') + ' ' + einheit;
        };

        // Aufbauen, wenn die Reihe noch nicht zu diesem Chart passt.
        if (box.children.length !== chart.data.datasets.length) {
            box.innerHTML = '';
            chart.data.datasets.forEach((ds, i) => {
                const b = document.createElement('button');
                b.className = 'vl-chip';
                b.innerHTML =
                    '<span class="vl-punkt" style="background:' +
                    (ds.borderColor || '#888') + '"></span>' +
                    // Einheit steckt schon im Label — im Chip raus, sie steht
                    // ja direkt beim Wert.
                    (ds.label || '').replace(/\s*\([^)]*\)\s*$/, '') +
                    ' <span class="vl-wert"></span>';
                b.onclick = () => {
                    const m = chart.getDatasetMeta(i);
                    m.hidden = !m.hidden;
                    b.classList.toggle('aus', !!m.hidden);
                    chart.update();
                };
                box.appendChild(b);
            });
        }

        // Werte nachziehen und den Ein-/Aus-Zustand spiegeln.
        chart.data.datasets.forEach((ds, i) => {
            const b = box.children[i];
            if (!b) return;
            const w = b.querySelector('.vl-wert');
            if (w) w.textContent = wert(ds);
            b.classList.toggle('aus', !!chart.getDatasetMeta(i).hidden);
        });
    }

    /**
     * Was der Drucker ausserhalb von Druecken zieht.
     *
     * Die Kurve darueber zeigt Minuten; das hier den Bestand ueber Wochen.
     * Beides gehoert in dieselbe Karte, weil es dieselbe Groesse ist — nur
     * einmal als Verlauf und einmal als Mittel.
     *
     * Faellt die Abfrage aus oder wurde noch nichts aufgezeichnet, bleibt
     * die Zeile weg. Eine leere Ueberschrift waere schlechter als nichts.
     */
    async _zeigeRuhestand() {
        const kasten = document.getElementById('vl-ruhe');
        if (!kasten) return;
        try {
            const r = await apiCall('/api/strom/leerlauf?tage=30');
            const d = await r.json();
            const z = (d && d.zustaende) || {};
            const texte = window.texts || {};
            const namen = {
                leerlauf: texte.chart_idle || 'Leerlauf',
                trocknet: texte.chart_drying || 'Trocknung',
            };
            const teile = Object.keys(namen)
                .filter(k => z[k] && z[k].punkte > 0)
                .map(k => `<span class="vl-ruhe-teil"><b>${namen[k]}</b> `
                    + `${z[k].mittel_w.toLocaleString(undefined,
                        { maximumFractionDigits: 1 })} W</span>`);
            if (!teile.length) { kasten.style.display = 'none'; return; }
            kasten.innerHTML = teile.join('');
            kasten.style.display = '';
        } catch (e) {
            kasten.style.display = 'none';
        }
    }

    /** Nur die letzten N Minuten zeigen (5 s je Punkt). */
    _kuerze(daten, minuten) {
        const punkte = Math.max(1, Math.round(minuten * 60 / 5));
        if (!daten || daten.length <= punkte) return daten;
        return daten.slice(-punkte);
    }

    _zeitwahlAnbinden() {
        const box = document.getElementById('vl-zeitwahl');
        if (!box || box.dataset.bereit) return;
        box.dataset.bereit = '1';
        box.querySelectorAll('button').forEach(b => {
            b.onclick = () => {
                box.querySelectorAll('button').forEach(x => x.classList.remove('an'));
                b.classList.add('an');
                this.zeitraumMinuten = parseInt(b.dataset.minuten, 10) || 60;
                this.createStackedCharts();
            };
        });
    }

    async createStackedCharts() {
        try {
            const response = await apiCall('/api/sensor_history/all');
            const data = await response.json();
            if (!data.datasets || data.datasets.length === 0) return;

            const texts = window.texts || {};

            // Sortiere Datasets nach UNIT (statt Name-Substring) — sonst
            // landen Klipper-Sensoren wie "cartographer_coil" / "ebbcan_temp"
            // / "host_temp" / "mcu_fan" nicht im richtigen Chart.
            const tempData  = data.datasets.filter(d => d.unit === '°C');
            const fanData   = data.datasets.filter(d => d.unit === '%');
            const powerData = data.datasets.filter(d => d.unit === 'W');

            // Leere Sub-Charts ausblenden (Klipper-Direct hat oft keine Lüfter-/Watt-
            // Daten → sonst leere Kästen „Lüfter"/„Leistung").
            const _sec = (id, n) => { const e = document.getElementById(id); if (e) e.style.display = n ? '' : 'none'; };
            _sec('chart-section-temp', tempData.length);
            _sec('chart-section-fans', fanData.length);
            _sec('chart-section-power', powerData.length);

            // Zeitachse gehoert unter das UNTERSTE sichtbare Chart. Sie hing
            // fest an der Leistung — und die wird ausgeblendet, wenn keine
            // Watt-Daten da sind. Dann sah man nirgends, welcher Zeitraum das
            // ueberhaupt ist.
            const zeitAchse = powerData.length ? 'power' : (fanData.length ? 'fans' : 'temp');

            // Translate labels. Unbekannte Klipper-Sensoren (kein Translation-Key)
            // werden via raw sensorType angezeigt; underscore→space + Title-Case
            // damit "cartographer_coil" → "Cartographer Coil".
            const prettify = (key) => key.replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            const tl = ds => ds.map(d => {
                // yAxisID stammt aus dem alten KOMBINIERTEN Chart (Temperatur
                // auf y, Luefter auf y1). Die getrennten Charts haben nur eine
                // y-Achse — bleibt das Feld drin, legt Chart.js fuer 'y1' eine
                // zweite, unkonfigurierte Achse an. Genau das waren die
                // sinnlosen 0…1- und -1…1-Skalen neben der echten.
                const { yAxisID, ...rest } = d;
                return {
                    ...rest,
                    label: (texts['sensor_' + d.sensorType] || prettify(d.sensorType))
                           + ' (' + d.unit + ')',
                    tension: 0.35, borderWidth: 2, pointRadius: 0,
                    // Leicht gefuellt wie im Entwurf — macht mehrere Kurven
                    // uebereinander lesbarer als nackte Linien.
                    fill: true,
                    backgroundColor: (d.borderColor || 'rgb(128,128,128)')
                        .replace('rgb(', 'rgba(').replace(')', ', 0.10)'),
                    spanGaps: true
                };
            });

            // Destroy old charts
            Object.values(this.stackedCharts).forEach(c => c && c.destroy());

            // Zeitraum anwenden (Standard: eine Stunde = der ganze Puffer)
            this._zeitwahlAnbinden();
            const min = this.zeitraumMinuten || 60;
            const labels = this._kuerze(data.labels, min);
            const kurz = ds => ds.map(d => ({ ...d, data: this._kuerze(d.data, min) }));

            // Temperaturen
            const ctxTemp = document.getElementById('chartTemp').getContext('2d');
            this.stackedCharts.temp = new Chart(ctxTemp, {
                type: 'line',
                data: { labels: labels, datasets: kurz(tl(tempData)) },
                options: this.makeChartOptions('°C', 0, undefined, zeitAchse === 'temp')
            });

            // Luefter
            const ctxFans = document.getElementById('chartFans').getContext('2d');
            this.stackedCharts.fans = new Chart(ctxFans, {
                type: 'line',
                data: { labels: labels, datasets: kurz(tl(fanData)) },
                options: this.makeChartOptions('%', 0, 100, zeitAchse === 'fans')
            });

            // Power
            const ctxPower = document.getElementById('chartPower').getContext('2d');
            this.stackedCharts.power = new Chart(ctxPower, {
                type: 'line',
                data: { labels: labels, datasets: kurz(tl(powerData)) },
                options: this.makeChartOptions('W', 0, undefined, zeitAchse === 'power')
            });

            // Chip-Legenden mit Momentanwert
            this._baueChips('vl-chips-temp',  this.stackedCharts.temp,  '\u00b0C');
            this._baueChips('vl-chips-fans',  this.stackedCharts.fans,  '%');
            this._baueChips('vl-chips-power', this.stackedCharts.power, 'W');
            this._zeigeRuhestand();

        } catch (error) {
            console.error('Stacked charts error:', error);
        }
    }

    async updateStackedCharts() {
        if (!this.stackedCharts.temp) return;
        try {
            const response = await apiCall('/api/sensor_history/all');
            const data = await response.json();
            if (!data.datasets) return;

            const tempData  = data.datasets.filter(d => d.unit === '°C');
            const fanData   = data.datasets.filter(d => d.unit === '%');
            const powerData = data.datasets.filter(d => d.unit === 'W');

            const _sec = (id, n) => { const e = document.getElementById(id); if (e) e.style.display = n ? '' : 'none'; };
            _sec('chart-section-temp', tempData.length);
            _sec('chart-section-fans', fanData.length);
            _sec('chart-section-power', powerData.length);

            // Denselben Zeitraum wie beim Aufbau anwenden, sonst springt die
            // Ansicht beim naechsten Auffrischen auf den vollen Puffer zurueck.
            const min = this.zeitraumMinuten || 60;
            const labels = this._kuerze(data.labels, min);
            const kuerze = this._kuerze.bind(this);

            function updateChart(chart, newDatasets) {
                if (!chart) return;
                chart.data.labels = labels;
                newDatasets.forEach((nd, i) => {
                    if (chart.data.datasets[i]) {
                        chart.data.datasets[i].data = kuerze(nd.data, min);
                    }
                });
                chart.update('none');
            }

            updateChart(this.stackedCharts.temp, tempData);
            updateChart(this.stackedCharts.fans, fanData);
            updateChart(this.stackedCharts.power, powerData);

            // Momentanwerte in den Chips mitziehen — ohne die zeigten sie
            // dauerhaft den Wert vom Oeffnen des Fensters.
            this._baueChips('vl-chips-temp',  this.stackedCharts.temp,  '\u00b0C');
            this._baueChips('vl-chips-fans',  this.stackedCharts.fans,  '%');
            this._baueChips('vl-chips-power', this.stackedCharts.power, 'W');
        } catch (error) {
            console.error('Stacked charts update error:', error);
        }
    }

    // NEUE Update-Funktion ohne Animation
    async updateCombinedChart() {
        const texts = window.texts || {};
        if (!this.currentChart) return;

        try {
            const response = await apiCall('/api/sensor_history/all');
            const data = await response.json();

            // Nur Daten updaten, Chart-Struktur bleibt
            this.currentChart.data.labels = data.labels || [];

            // Datasets updaten
            if (data.datasets) {
                data.datasets.forEach((newDataset, index) => {
                    if (this.currentChart.data.datasets[index]) {
                        this.currentChart.data.datasets[index].data = newDataset.data;
                    }
                });
            }

            // Smooth Update mit requestAnimationFrame
            const chart = this.currentChart;
            requestAnimationFrame(() => {
                chart.update('none');
            });

        } catch (error) {
            console.error(texts.console_combined_chart_update_error + ':', error);
        }
    }

    async createCombinedChart() {
        const texts = window.texts || {};
        try {
            const response = await apiCall('/api/sensor_history/all');
            const data = await response.json();

            const ctx = document.getElementById('sensorChart').getContext('2d');

            // Alten Chart zerstoeren falls vorhanden
            if (this.currentChart) {
                this.currentChart.destroy();
            }

            // Keine Daten?
            if (!data.datasets || data.datasets.length === 0) {
                // Canvas Groesse abrufen
                const centerX = ctx.canvas.width / 2;
                const centerY = ctx.canvas.height / 2;

                // Canvas loeschen
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

                // Text Settings
                ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.fillStyle = '#666';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                return;
            }

            // Backend-Keys zu uebersetzten Labels konvertieren
            const translatedDatasets = data.datasets.map(dataset => {
                const sensorKey = 'sensor_' + dataset.sensorType;
                const translatedName = texts[sensorKey] || dataset.sensorType;
                return {
                    ...dataset,
                    label: `${translatedName} (${dataset.unit})`
                };
            });

            this.currentChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.labels || [],
                    datasets: translatedDatasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            labels: {
                                color: '#999',
                                usePointStyle: true,
                                padding: 10,
                                font: {
                                    size: 11
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return context.dataset.label + ': ' + context.parsed.y;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: '#999',
                                maxTicksLimit: 10
                            }
                        },
                        'y-temp': {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {
                                display: true,
                                text: texts.chart_axis_temperature,
                                color: '#999'
                            },
                            grid: {
                                color: 'rgba(255, 255, 255, 0.05)'
                            },
                            ticks: {
                                color: '#999'
                            }
                        },
                        'y-percent': {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            title: {
                                display: true,
                                text: texts.chart_axis_fan,
                                color: '#999'
                            },
                            grid: {
                                drawOnChartArea: false,
                            },
                            ticks: {
                                color: '#999',
                                max: 100
                            }
                        },
                        'y-power': {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            offset: true,
                            title: {
                                display: true,
                                text: texts.chart_label_power,
                                color: '#999'
                            },
                            grid: {
                                drawOnChartArea: false,
                            },
                            ticks: {
                                color: '#999'
                            }
                        }
                    }
                }
            });

        } catch (error) {
            console.error(texts.console_combined_chart_error + ':', error);
        }
    }

    closeChartModal() {
        document.getElementById('chartModal').style.display = 'none';

        // Stats wieder anzeigen fuer normale Charts
        document.getElementById('chartStats').style.display = 'flex';
        document.getElementById('sensorChart').style.display = 'block';
        document.getElementById('stackedChartsContainer').style.display = 'none';

        // Stats zuruecksetzen
        document.getElementById('statMin').textContent = 'Min: --';
        document.getElementById('statMax').textContent = 'Max: --';
        document.getElementById('statAvg').textContent = 'Ø: --';

        // Chart-Typ zuruecksetzen
        this.combinedChartType = null;

        // Einzel-Chart zerstoeren
        if (this.currentChart) {
            this.currentChart.destroy();
            this.currentChart = null;
        }

        // Gestapelte Charts zerstoeren
        Object.keys(this.stackedCharts).forEach(key => {
            if (this.stackedCharts[key]) {
                this.stackedCharts[key].destroy();
                this.stackedCharts[key] = null;
            }
        });

        if (this.chartUpdateInterval) {
            clearInterval(this.chartUpdateInterval);
            this.chartUpdateInterval = null;
        }
    }

    async createSensorChart(sensorType, unit) {
        const texts = window.texts || {};
        try {
            const response = await apiCall(`/api/sensor_history/${sensorType}`);
            const data = await response.json();

            const ctx = document.getElementById('sensorChart').getContext('2d');

            // Alten Chart zerstoeren falls vorhanden
            if (this.currentChart) {
                this.currentChart.destroy();
            }

            // Farben basierend auf Sensor-Typ
            const colors = {
                'nozzle_temp': 'rgb(255, 99, 132)',  // Rot
                'bed_temp': 'rgb(54, 162, 235)',     // Blau
                'fan_speed': 'rgb(75, 192, 192)',    // Tuerkis
                'power': 'rgb(255, 206, 86)'         // Gelb
            };

            const mainColor = colors[sensorType] || 'rgb(75, 192, 192)';

            // Min/Max/Avg Linien als zusaetzliche Datasets
            const datasets = [{
                label: texts.chart_label_current,
                data: data.data || [],
                borderColor: mainColor,
                backgroundColor: mainColor.replace('rgb', 'rgba').replace(')', ', 0.2)'),
                tension: 0.4,
                fill: true,
                pointRadius: 2,
                pointHoverRadius: 5
            }];

            // Min-Linie hinzufuegen
            if (data.min !== null) {
                datasets.push({
                    label: `Min: ${data.min}${unit}`,
                    data: new Array(data.data.length).fill(data.min),
                    borderColor: 'rgba(54, 162, 235, 0.5)',
                    borderDash: [5, 5],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0
                });
            }

            // Max-Linie hinzufuegen
            if (data.max !== null) {
                datasets.push({
                    label: `Max: ${data.max}${unit}`,
                    data: new Array(data.data.length).fill(data.max),
                    borderColor: 'rgba(255, 99, 132, 0.5)',
                    borderDash: [5, 5],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0
                });
            }

            // Durchschnittslinie hinzufuegen
            if (data.avg) {
                datasets.push({
                    label: `Ø: ${data.avg}${unit}`,
                    data: new Array(data.data.length).fill(data.avg),
                    borderColor: 'rgba(255, 206, 86, 0.5)',
                    borderDash: [10, 5],
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0
                });
            }

            // Markiere Min/Max Punkte
            if (data.minIndex >= 0 && data.data.length > 0) {
                datasets[0].pointBackgroundColor = datasets[0].data.map((_, i) =>
                    i === data.minIndex ? 'blue' : mainColor
                );
                datasets[0].pointRadius = datasets[0].data.map((_, i) =>
                    i === data.minIndex ? 6 : 2
                );
            }

            if (data.maxIndex >= 0 && data.data.length > 0) {
                if (!datasets[0].pointBackgroundColor) {
                    datasets[0].pointBackgroundColor = datasets[0].data.map(() => mainColor);
                }
                datasets[0].pointBackgroundColor = datasets[0].pointBackgroundColor.map((color, i) =>
                    i === data.maxIndex ? 'red' : color
                );
                datasets[0].pointRadius = datasets[0].pointRadius.map((radius, i) =>
                    i === data.maxIndex ? 6 : radius
                );
            }

            this.currentChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.labels || [],
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: 300,
                        easing: 'linear'
                    },
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    },
                    elements: {
                        line: {
                            tension: 0.2,
                            borderWidth: 2
                        },
                        point: {
                            radius: 1,
                            hitRadius: 10,
                            hoverRadius: 4
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        decimation: {
                            enabled: true,
                            algorithm: 'lttb',
                            samples: 50
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (context.parsed.y !== null) {
                                        label += ': ' + context.parsed.y + unit;
                                    }
                                    if (context.datasetIndex === 0) {
                                        if (context.parsed.y === data.min) {
                                            label += ' (MIN)';
                                        } else if (context.parsed.y === data.max) {
                                            label += ' (MAX)';
                                        }
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)',
                                drawOnChartArea: false
                            },
                            ticks: {
                                color: '#999',
                                maxTicksLimit: 6,
                                maxRotation: 0
                            }
                        },
                        y: {
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            },
                            ticks: {
                                color: '#999',
                                callback: function(value) {
                                    return value + unit;
                                }
                            },
                            suggestedMin: data.min ? data.min - 5 : undefined,
                            suggestedMax: data.max ? data.max + 5 : undefined
                        }
                    }
                }
            });

            // Zeige Stats in separater Zeile
            if (data.min !== null && data.max !== null) {
                document.getElementById('statMin').innerHTML = `<span style="color:#3498db;">▼</span> Min: ${data.min}${unit}`;
                document.getElementById('statMax').innerHTML = `<span style="color:#e74c3c;">▲</span> Max: ${data.max}${unit}`;
                document.getElementById('statAvg').innerHTML = `<span style="color:#f39c12;">—</span> Ø: ${data.avg}${unit}`;
            }

        } catch (error) {
            console.error(texts.console_chart_error + ':', error);
        }
    }

    async updateSensorChart(sensorType, unit) {
        const texts = window.texts || {};
        if (!this.currentChart) return;

        try {
            const response = await apiCall(`/api/sensor_history/${sensorType}`);
            const data = await response.json();

            // Nur updaten wenn neue Daten
            if (JSON.stringify(this.currentChart.data.datasets[0].data) !== JSON.stringify(data.data)) {
                this.currentChart.data.labels = data.labels || [];
                this.currentChart.data.datasets[0].data = data.data || [];

                // Smooth Update mit requestAnimationFrame
                const chart = this.currentChart;
                requestAnimationFrame(() => {
                    chart.update('none');
                });
            }
        } catch (error) {
            console.error(texts.console_chart_update_error + ':', error);
        }
    }
}

window.chartManager = new ChartManager();

// Backwards compatibility - all functions called from HTML onclick handlers:
window.showAllCharts = () => window.chartManager.showAllCharts();
window.closeChartModal = () => window.chartManager.closeChartModal();
window.createSensorChart = (sensorType, unit) => window.chartManager.createSensorChart(sensorType, unit);
window.updateSensorChart = (sensorType, unit) => window.chartManager.updateSensorChart(sensorType, unit);
window.createCombinedChart = () => window.chartManager.createCombinedChart();
window.updateCombinedChart = () => window.chartManager.updateCombinedChart();
window.createStackedCharts = () => window.chartManager.createStackedCharts();
window.updateStackedCharts = () => window.chartManager.updateStackedCharts();
window.makeChartOptions = (yLabel, yMin, yMax, showXLabels) => window.chartManager.makeChartOptions(yLabel, yMin, yMax, showXLabels);
window.calculateCost = (stats) => window.chartManager.calculateCost(stats);
