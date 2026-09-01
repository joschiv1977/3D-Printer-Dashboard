/**
 * Hotend-Magazin (H2C) — Karte fuellen.
 *
 * Der H2C druckt an zwei Stellen, aber nur eine davon nimmt Wechsel-Hotends:
 * Bambu Studio gibt ihm `extruder_max_nozzle_count ['1','6']` — Extruder 1
 * traegt eine feste Duese, Extruder 2 bis zu sechs Hotends aus dem Magazin.
 * Der Drucker meldet die Plaetze als Duesen-ids 16-21; der Server trennt sie
 * in `hardware.hotend_rack` ab (services/printer_state.py).
 *
 * Die Karte sagt NICHT, welche Seite die feste und welche die wechselbare
 * ist. Studio nummeriert Extruder 1 und 2, der MQTT-Block nummeriert Duesen
 * 0 und 1 (0 = rechts, 1 = links) — welche Nummer welcher entspricht, steht
 * in keiner Quelle, die wir haben. Belegt ist dagegen, WELCHER Platz
 * aufgesetzt ist: das sagt `tar_id`.
 *
 * Zwei Werte kommen bewusst roh durch, weil ihre Bedeutung in keiner
 * Bambu-Quelle steht, die wir haben:
 *   - der Typ-Code ("SS", "HS", …) wird angezeigt wie gemeldet. Die
 *     Home-Assistant-Integration liest die zweite Stelle als Fluss
 *     (H = High Flow); das ist die Lesart eines Drittanbieters und wird hier
 *     nicht als Tatsache verkauft.
 *   - der Verschleiss steht als Zahl da, ohne Balken. Der Drucker meldet
 *     keinen Maximalwert, ein Balken waere geraten.
 * Beides gehoert an einem echten H2C nachgesehen, dann kann hier mehr stehen.
 */
(function (global) {
    'use strict';

    class HotendRackCard {
        constructor() {
            this._letzteSignatur = null;
        }

        /**
         * Aus dem Status-Paket fuellen.
         * @param {object} daten – die Antwort von /api/status bzw. der Push.
         */
        aktualisieren(daten) {
            const karte = document.getElementById('hotend-rack-card-grid');
            if (!karte) return;

            const magazin = (daten && daten.hardware && daten.hardware.hotend_rack) || {};
            const plaetze = magazin.slots || [];

            // Keine Plaetze gemeldet = kein Magazin. Die Karte verschwindet,
            // statt leer dazustehen; sie taucht nicht am Modellnamen auf.
            if (!plaetze.length) {
                if (karte.style.display !== 'none') {
                    karte.style.display = 'none';
                    this._hoeheAnpassen();
                }
                return;
            }

            if (karte.style.display === 'none') {
                karte.style.display = '';
                this._hoeheAnpassen();
            }

            const t = global.texts || {};
            this._kopf(t, magazin, plaetze);
            this._plaetze(t, magazin, plaetze);
        }

        /** Titel, Zaehler und was gerade aufgesetzt ist. */
        _kopf(t, magazin, plaetze) {
            const setzen = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            const belegt = plaetze.filter(p => p.present).length;
            setzen('hr-title', t.hotend_rack_title || 'Hotend-Magazin');
            setzen('hr-belegt', (t.hotend_rack_occupied || '{n} von {gesamt} belegt')
                .replace('{n}', belegt).replace('{gesamt}', plaetze.length));

            const laeuft = this._wechselLaeuft(magazin);
            const aufNr = this._platzNummer(magazin.tar_id, plaetze);
            const aufPlatz = plaetze.find(p => p.id === magazin.tar_id) || {};

            const feld = document.getElementById('hr-aufgesetzt');
            if (feld) feld.classList.toggle('hr-duese--wechsel', laeuft);

            setzen('hr-auf-wo', t.hotend_rack_mounted_label || 'Aufgesetzt');
            if (laeuft) {
                setzen('hr-auf-was', t.hotend_rack_changing || 'wird gewechselt');
                const vonNr = this._platzNummer(magazin.src_id, plaetze);
                setzen('hr-auf-zu', vonNr && aufNr
                    ? `${this._platzName(t, vonNr)} \u2192 ${this._platzName(t, aufNr)}`
                    : '');
            } else if (aufNr && aufPlatz.present) {
                setzen('hr-auf-was', this._platzName(t, aufNr));
                const teile = [this._durchmesser(aufPlatz.diameter)];
                if (aufPlatz.type) {
                    teile.push((t.hotend_rack_type || 'Typ {code}').replace('{code}', aufPlatz.type));
                }
                setzen('hr-auf-zu', teile.filter(x => x && x !== '\u2013').join(' \u00b7 '));
            } else {
                setzen('hr-auf-was', t.hotend_rack_none_mounted || 'kein Platz aufgesetzt');
                setzen('hr-auf-zu', '');
            }

            this._wechselzeile(t, magazin, plaetze, laeuft);
        }

        /** Die Zeile, die den laufenden Wechsel beschreibt. */
        _wechselzeile(t, magazin, plaetze, laeuft) {
            const zeile = document.getElementById('hr-wechsel');
            if (!zeile) return;
            if (!laeuft) { zeile.style.display = 'none'; return; }
            zeile.style.display = '';

            const titel = document.getElementById('hr-wechsel-titel');
            const detail = document.getElementById('hr-wechsel-detail');
            if (titel) titel.textContent = t.hotend_rack_change_running || 'Hotend-Wechsel laeuft';

            const beschreibe = (id) => {
                const nr = this._platzNummer(id, plaetze);
                if (!nr) return null;
                const platz = plaetze.find(p => p.id === id) || {};
                const dm = this._durchmesser(platz.diameter);
                return dm ? `${this._platzName(t, nr)} (${dm})` : this._platzName(t, nr);
            };
            const von = beschreibe(magazin.src_id);
            const nach = beschreibe(magazin.tar_id);
            if (detail) {
                detail.textContent = (von && nach)
                    ? (t.hotend_rack_change_detail || '{von} zurueck ins Magazin, {nach} wird aufgesetzt')
                        .replace('{von}', von).replace('{nach}', nach)
                    : '';
            }
        }

        /** Das Raster der sechs Plaetze. */
        _plaetze(t, magazin, plaetze) {
            const behaelter = document.getElementById('hr-plaetze');
            if (!behaelter) return;

            const laeuft = this._wechselLaeuft(magazin);
            // Nur neu zeichnen, wenn sich wirklich etwas geaendert hat — sonst
            // baut der 1-Sekunden-Push das Raster dauernd neu auf.
            const signatur = JSON.stringify([plaetze, magazin.src_id, magazin.tar_id, laeuft]);
            if (signatur === this._letzteSignatur) return;
            this._letzteSignatur = signatur;

            behaelter.innerHTML = '';
            plaetze.forEach((platz, index) => {
                const nr = index + 1;
                const feld = document.createElement('div');
                feld.className = 'hr-pl';

                const istZiel = laeuft && platz.id === magazin.tar_id;
                const istAuf = !laeuft && platz.id === magazin.tar_id && platz.present;
                const istQuelle = laeuft && platz.id === magazin.src_id;
                if (istZiel) feld.classList.add('hr-pl--ziel');
                else if (istAuf || istQuelle) feld.classList.add('hr-pl--auf');

                if (istZiel || istAuf || istQuelle) {
                    const marke = document.createElement('span');
                    marke.className = 'hr-marke';
                    marke.innerHTML = istZiel
                        ? '<svg viewBox="0 0 24 24"><path d="M4 12h13m-4-5 5 5-5 5"/></svg>'
                        : '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>';
                    feld.appendChild(marke);
                }

                const nummer = document.createElement('span');
                nummer.className = 'hr-nr';
                nummer.textContent = this._platzName(t, nr);
                feld.appendChild(nummer);

                if (!platz.present) {
                    const leer = document.createElement('span');
                    leer.className = 'hr-leer';
                    leer.textContent = t.hotend_rack_empty || 'frei';
                    feld.appendChild(leer);
                } else {
                    const dm = document.createElement('span');
                    dm.className = 'hr-dm';
                    const wert = this._zahl(platz.diameter);
                    dm.innerHTML = wert !== null
                        ? `${this._komma(wert)}<span>mm</span>`
                        : '–';
                    feld.appendChild(dm);

                    if (platz.type) {
                        const code = document.createElement('span');
                        code.className = 'hr-code';
                        code.textContent = (t.hotend_rack_type || 'Typ {code}')
                            .replace('{code}', platz.type);
                        feld.appendChild(code);
                    }
                    if (platz.wear !== null && platz.wear !== undefined) {
                        const vs = document.createElement('span');
                        vs.className = 'hr-vs';
                        vs.textContent = (t.hotend_rack_wear || 'Verschleiss {wert}')
                            .replace('{wert}', platz.wear);
                        feld.appendChild(vs);
                    }
                }

                behaelter.appendChild(feld);
            });
        }

        /** Laeuft gerade ein Wechsel? `state` != 0 sagt es, und Quelle und
         *  Ziel muessen sich unterscheiden. */
        _wechselLaeuft(magazin) {
            const zustand = magazin.state;
            if (typeof zustand !== 'number' || zustand === 0) return false;
            return magazin.src_id !== magazin.tar_id
                && magazin.src_id !== null && magazin.src_id !== undefined
                && magazin.tar_id !== null && magazin.tar_id !== undefined;
        }

        /** Aus der Duesen-id (16-21) die Platznummer fuer Menschen (1-6). */
        _platzNummer(id, plaetze) {
            const index = plaetze.findIndex(p => p.id === id);
            return index < 0 ? null : index + 1;
        }

        _platzName(t, nr) {
            return (t.hotend_rack_slot || 'Platz {nr}').replace('{nr}', nr);
        }

        _zahl(wert) {
            const n = parseFloat(wert);
            return Number.isFinite(n) ? n : null;
        }

        _komma(n) {
            return String(n).replace('.', ',');
        }

        _durchmesser(wert) {
            const n = this._zahl(wert);
            return n === null ? '–' : `${this._komma(n)} mm`;
        }

        _hoeheAnpassen() {
            setTimeout(() => {
                if (typeof global.adjustGridHeight === 'function') global.adjustGridHeight();
            }, 50);
        }
    }

    global.hotendRackCard = new HotendRackCard();
})(window);
