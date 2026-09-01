<div align="center">

# 🖨️ 3D Printer Dashboard

**Steuerung und Überwachung für Bambu Lab- und Klipper-Drucker**
**— Web, Desktop, iOS und Android, ein Server hinter allem**

[![Python 3.13](https://img.shields.io/badge/Python-3.13-2563eb?style=flat-square&logo=python&logoColor=white)](https://www.python.org/downloads/)
[![Plattform](https://img.shields.io/badge/Plattform-aarch64-64748b?style=flat-square&logo=linux&logoColor=white)](#-plattformen)
[![Drucker](https://img.shields.io/badge/Bambu%20Lab-13%20Modelle-10b981?style=flat-square)](#unterstützte-drucker)
[![Klipper](https://img.shields.io/badge/Klipper-Moonraker-10b981?style=flat-square)](#-betriebsarten)
[![Sprachen](https://img.shields.io/badge/Sprachen-5-7c3aed?style=flat-square)](#-sprachen)
[![iOS](https://img.shields.io/badge/iOS-16.1+-000000?style=flat-square&logo=apple&logoColor=white)](#-ios)
[![Android](https://img.shields.io/badge/Android-8+-3DDC84?style=flat-square&logo=android&logoColor=white)](#-apps)

**[Einrichtung](#-einrichten--schritt-für-schritt) · [Funktionen](#-was-es-kann) · [Screenshots](#-die-oberfläche) · [Wenn etwas klemmt](#-wenn-etwas-klemmt)**

🇬🇧 **[English version](README.md)**

<img src="docs/screenshots/dashboard.png" width="720" alt="Übersicht"/>

</div>

---

## Was dieses Repo ist

Das ist der **Verteilstand**. Hier liegt der fertig gebaute Server samt
Weboberfläche und Installer — du übersetzt nichts selbst. Der Quelltext liegt in
einem privaten Repo.

| Was mitkommt | |
|---|---|
| **149** übersetzte Module | `dist_aarch64/`, gebaut für Python 3.13 |
| **765** Slicer-Profile | damit eine frische Installation sofort schneiden kann |
| **4** Bambu-Wurzelzertifikate | damit die Druckerverbindung wirklich geprüft wird |
| **Weboberfläche** | fünf Sprachen, je 2313 Texte |
| **~130 MB** | das ganze Repo |

---

## 🚀 Einrichten — Schritt für Schritt

Hier wird nichts vorausgesetzt. Jeder Schritt sagt, was zu sehen sein muss; steht
etwas anderes da, hilft der Abschnitt [Wenn etwas klemmt](#-wenn-etwas-klemmt).

### Vorher

Du brauchst:

- einen 64-Bit-Linux-Rechner — üblich ist ein **Raspberry Pi 4 oder 5**
- **Python 3.13** (Debian 13 bringt es mit; nachsehen mit `python3 --version`)
- vom Drucker: **IP-Adresse**, **Seriennummer** und **Zugangscode**
  → am Drucker unter *Einstellungen → Netzwerk*. Der Zugangscode hat 8 Zeichen und
  enthält Buchstaben, nicht nur Ziffern
- einen Lizenzschlüssel (siehe [Lizenz](#-lizenz))

### Schritt 1 — Installer starten

Diese Zeile in ein Terminal auf dem Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/joschiv1977/3D-Printer-Dashboard/main/quick-install.sh | bash
```

Lieber vorher hineinsehen? Ist die bessere Angewohnheit:

```bash
curl -fsSL https://raw.githubusercontent.com/joschiv1977/3D-Printer-Dashboard/main/quick-install.sh -o quick-install.sh
less quick-install.sh
bash quick-install.sh
```

**Was zu sehen sein muss:** erst die Plattformerkennung (`aarch64`, Python 3.13),
dann der Download, dann der Installer mit einem Block je Schritt. Auf einem Pi
dauert das 10–20 Minuten; die Bauwerkzeuge für numpy und Pillow sind der langsame
Teil.

**Zwei Fragen kommen**, beide mit Vorgabe *nein*, beide gefahrlos zu überspringen:
Cloudflare-Tunnel (Zugang von außen) und Firebase (Push-Nachrichten). Beides lässt
sich später nachholen.

**Am Ende** nennt der Installer die Adresse deines Servers.

### Schritt 2 — Oberfläche öffnen

```
https://<ip-deines-pi>:5555
```

Der Browser warnt wegen des Zertifikats. Das gehört so — es ist selbst signiert,
825 Tage gültig, und es ist dein eigener Rechner. Warnung wegklicken.

### Schritt 3 — der Assistent, fünf Schritte

<img src="docs/screenshots/login.png" width="270" align="right" alt="Anmeldung"/>

**1 · Lizenz**
Schlüssel eintragen. Die Hardware-Kennung, die du zum Anfordern brauchst, steht auf
derselben Seite, mit Kopierknopf.

**2 · Passwort**
Das Startpasswort liegt auf dem Pi in `data/initial_password.txt`:

```bash
sudo cat /opt/printer-web-app/data/initial_password.txt
```

Es enthält keine verwechselbaren Zeichen — keine `0`/`O`, keine `1`/`l`/`I` — und
kommt in Fünfergruppen, damit es sich vom Bildschirm abtippen lässt. Die Datei
löscht sich selbst, sobald du dein eigenes gesetzt hast.

Dein neues Passwort braucht mindestens 12 Zeichen mit Groß- und Kleinbuchstaben,
einer Ziffer und einem Sonderzeichen.

**3 · Drucker**
Bambu oder Klipper. Die Modellliste kommt vom Server und bleibt damit aktuell. Für
Bambu trägst du IP, Seriennummer und Zugangscode ein; das Feld für den Zugangscode
nimmt **8 Zeichen** — Buchstaben eingeschlossen.

**4 · Steckdose**
Meross, Home Assistant oder **keine**. „Keine" ist eine vollwertige Antwort, keine
Lücke: die Oberfläche entscheidet dann anhand der Verbindung, ob der Drucker da
ist — nicht anhand eines Schalters, den es nicht gibt.

**5 · Abschluss**
Den Rest macht der Server, sichtbar: Slicer-Profile, Wartungsplan für das gewählte
Modell, Erreichbarkeitstest des Druckers, Warmstart des Kamera-Relais. Jede Aufgabe
meldet sich einzeln; keine kann den Abschluss blockieren. Ein Drucker, der gerade
aus ist, hält keine Installation auf.

Danach startet der Server einmal neu, und du landest auf der Anmeldeseite.

> **Ein Neuladen während des Assistenten wirft dich nicht auf Anfang.** Was du
> getippt hast, bleibt stehen — außer Passwörtern und Zugangscodes, die tippst du
> mit Absicht neu.

### Schritt 4 — fertig

Anmelden als `admin` mit dem Passwort, das du gerade gesetzt hast.

---

## ✨ Was es kann

### 🎮 Druckersteuerung

<img src="docs/screenshots/control-overview.png" width="260" align="right" alt="Steuerung"/>

- ⚡ **Live-Überwachung** über MQTT, unter 100 ms Verzögerung
- 🌡️ **Temperaturen** für Düse, Bett und Kammer
- 💨 **Lüfter** — Bauteil, Aux, Kammer
- 💡 **Kammerlicht** mit Abschaltuhr
- 🎯 **Entwicklermodus** für G-Code und Achsensteuerung direkt
- 🔌 **Strom** — Abschaltautomatik, Home Assistant, Meross

Der Steuerungsdialog hat fünf Reiter: Übersicht, Achsen, Extruder, Filament, Gerät.

<div align="center">
<a href="docs/screenshots/control-axes.png"><img src="docs/screenshots/control-axes.png" width="200"/></a>
<a href="docs/screenshots/control-extruder.png"><img src="docs/screenshots/control-extruder.png" width="200"/></a>
<a href="docs/screenshots/control-filament.png"><img src="docs/screenshots/control-filament.png" width="200"/></a>
<a href="docs/screenshots/control-device.png"><img src="docs/screenshots/control-device.png" width="200"/></a>
</div>

### 📊 Überwachung & Auswertung

<div align="center">
<a href="docs/screenshots/history-detail.png"><img src="docs/screenshots/history-detail.png" width="200"/></a>
<a href="docs/screenshots/history-chart.png"><img src="docs/screenshots/history-chart.png" width="200"/></a>
<a href="docs/screenshots/history-events.png"><img src="docs/screenshots/history-events.png" width="200"/></a>
<a href="docs/screenshots/history-statistics.png"><img src="docs/screenshots/history-statistics.png" width="200"/></a>
</div>

- 📈 **Sensorverlauf** — Temperaturen, Lüfter, Strom, live
- 📚 **Druck-Historie** — Kosten getrennt nach Filament und Strom, und welche Düse
  wann gedruckt hat
- 🗺️ **Bett-Mesh** — wird je Druck aufgenommen und bleibt beim Druck
- 🎬 **Zeitraffer** — automatisch aufgezeichnet und umgewandelt, in den Apps
  offline zwischengespeichert
- ♻️ **Stromausfall-Wiederaufnahme** — ein Druck übersteht einen Stromausfall. Am
  Gerät nachgemessen: 0,0 mm Versatz. Der Maßstab ist eine Chance statt eines
  Totalverlusts, keine unsichtbare Naht
- 🧪 **Kalibrierungen sind keine Drucke** — Systemläufe werden als solche
  gekennzeichnet und bleiben aus Statistik und Filamentabrechnung heraus
- 📸 **Livebild** — WebRTC über go2rtc, das H.264 des Druckers unverändert
  durchgereicht, ohne Transkodieren. MJPEG bleibt als Rückfall. Bambu-Modelle
  benutzen zwei verschiedene Protokolle (Port 6000 bei P1/A1, RTSPS bei
  X1/X2D/H2) — die Quelle wird beim Drucker erfragt, nie am Modell geraten

### 🧵 Filament

- 🔌 **Spoolman** — automatische Verwaltung, auch offline
- 🎨 **Mehrfarbdruck / AMS** — Spulen hängen an der Düse, an der sie wirklich sitzen
- 🔥 **Trocknen** — vor einem geplanten Druck, während eines Drucks oder direkt aus
  dem AMS; die Profile folgen der Studio-Empfehlung
- 💡 **Spulenvorschlag** — angeboten wird die Spule, die zur Datei passt, nicht
  einfach die aktive
- 💰 **Kosten** — Filament und Strom, je Druck
- 📦 **3MF-Auswertung** — Gewicht wird automatisch ausgelesen

```
Trocknungsprofile        PLA  50 °C ·  6 h      ABS  70 °C · 12 h
                         PETG 65 °C ·  6 h      ASA  70 °C · 12 h
                         TPU  55 °C ·  8 h      PA   80 °C · 16 h
```

### 🔧 Wartung

<img src="docs/screenshots/maintenance.png" width="380" align="right" alt="Wartung"/>

Die Wartung beobachtet den Zustand des Druckers und erinnert dich, **bevor** etwas
schiefgeht.

**Automatisch mitgezählt:** Druckstunden, Anzahl der Drucke, Filament in Gramm und
Kalendertage.

**Intervalle** können auf jedem davon beruhen — „Düse nach 100 h reinigen", „Bett
nach 50 Drucken nivellieren", „nach 2 kg schmieren", „Lüfter alle 30 Tage".

**Fertige Pläne** je Modell, geladen im letzten Schritt des Assistenten. Der
X2D-Plan hat 19 Aufgaben und vier Grundwerte.

| Dringlichkeit | Erinnerung |
|---|---|
| 🔴 Kritisch | 14, 7, 3, 1 Tage vorher und am Tag selbst |
| 🟠 Hoch | 7, 3, 1 Tage vorher und am Tag selbst |
| 🟡 Mittel | 7, 1 Tage vorher und am Tag selbst |
| 🟢 Niedrig | 3 Tage vorher und am Tag selbst |

Kategorien: 🧹 Reinigung · 💧 Schmierung · 🔍 Sichtprüfung · 🔧 Austausch ·
⚙️ Allgemein. Jede Aufgabe hat eine Checkliste, einen Verlauf und ihr eigenes
Intervall — und eigene lassen sich anlegen.

### 📅 Planung & SD-Karte

<div align="center">
<a href="docs/screenshots/scheduled-prints.png"><img src="docs/screenshots/scheduled-prints.png" width="300"/></a>
<a href="docs/screenshots/schedule-create.png"><img src="docs/screenshots/schedule-create.png" width="300"/></a>
<a href="docs/screenshots/sdcard.png"><img src="docs/screenshots/sdcard.png" width="300"/></a>
<a href="docs/screenshots/print-options.png"><img src="docs/screenshots/print-options.png" width="300"/></a>
</div>

Zeitgesteuerte Druckaufträge mit Überschneidungsprüfung, und die SD-Karte des
Druckers mit Druckoptionen, Mehrfarb-Zuordnung und Vorschaubildern.

### 🔪 Slicer

<img src="docs/screenshots/slicer.png" width="380" align="right" alt="Slicer"/>

OrcaSlicer läuft auf dem Server. STL oder STEP hineinziehen, Drucker, Düse und
Qualität wählen — das Ergebnis geht direkt auf die SD-Karte.

Die 765 Profile liegen diesem Repo bei, damit eine frische Installation sofort
schneiden kann — kein Warten auf 965 Einzeldownloads von GitHub. Der Aktualisierer
vergleicht danach nur noch.

### 🔔 Benachrichtigungen

- 📱 **Firebase Cloud Messaging** mit Vorschaubild
- 🌐 **Web-Push** im Browser
- 🎯 **Auslöser** — Start, 25/50/75/100 %, Ende, Fehler
- 🔕 **Ruhezeiten**

### 🏠 Smart Home

Home Assistant über MQTT-Auto-Discovery, alle Sensoren als Entitäten, dazu
Steuerungs-Entitäten. Meross-Steckdosen direkt, über das LAN, ohne Cloud.

### 🔐 Sicherheit

<img src="docs/screenshots/users.png" width="300" align="right" alt="Benutzer"/>

- 🔑 **JWT** mit Zugriffs- und Erneuerungstoken
- 👥 **Mehrere Benutzer** mit Rollen
- 🛡️ **Ratenbegrenzung** gegen Durchprobieren
- 🚫 **Pfadschutz** bei jedem Dateizugriff
- 🔒 **Gerätetoken** für die mobilen Apps
- 🪪 **Lizenz** — Ed25519-signiert, offline geprüft, an den Rechner gebunden

---

## 🖥️ Die Oberfläche

Die ganze App ist aus denselben Teilen gebaut: Karten mit Überschrift und
Hinweiszeile, Zeilen mit Bezeichnung links und Wert rechts, und unten ein Dock.
Zustand steht nie in der Farbe allein — daneben steht immer ein Zeichen oder ein
Wort.

| | | | | | | |
|---|---|---|---|---|---|---|
| 🏠 **Start** | ⌨️ **Konsole** | 🕐 **Historie** | 🔧 **Wartung** | 📦 **Slicer** | 👥 **Benutzer** | ⚙️ **Einstellungen** |

**Dialoge** — Lüfter, Geschwindigkeit, Temperaturen, Filament bearbeiten, Spule
wählen und der Sensorverlauf:

<div align="center">
<a href="docs/screenshots/dialog-fans.png"><img src="docs/screenshots/dialog-fans.png" width="190"/></a>
<a href="docs/screenshots/dialog-speed.png"><img src="docs/screenshots/dialog-speed.png" width="190"/></a>
<a href="docs/screenshots/dialog-temperature.png"><img src="docs/screenshots/dialog-temperature.png" width="190"/></a>
<a href="docs/screenshots/dialog-filament-edit.png"><img src="docs/screenshots/dialog-filament-edit.png" width="190"/></a>
<a href="docs/screenshots/dialog-spool-select.png"><img src="docs/screenshots/dialog-spool-select.png" width="190"/></a>
<a href="docs/screenshots/dialog-sensors.png"><img src="docs/screenshots/dialog-sensors.png" width="190"/></a>
</div>

**Einstellungen und Konsole:**

<div align="center">
<a href="docs/screenshots/settings-connection.png"><img src="docs/screenshots/settings-connection.png" width="240"/></a>
<a href="docs/screenshots/settings-system.png"><img src="docs/screenshots/settings-system.png" width="240"/></a>
<a href="docs/screenshots/console.png"><img src="docs/screenshots/console.png" width="240"/></a>
</div>

**Hell, dunkel oder wie das System** — überall, ein Schalter.

---

## 🔀 Betriebsarten

Der Server spricht mit zwei Druckerfamilien. Die Betriebsart gilt je Drucker; beide
laufen nebeneinander.

| Betriebsart | Drucker | Weg |
|---|---|---|
| **Bambu** | Bambu Lab, 13 Modelle | MQTT über TLS + FTPS |
| **Klipper — auf dem Drucker** | Klipper/Moonraker | Moonraker HTTP + WebSocket |
| **Klipper — eigener Rechner** | Klipper/Moonraker | Moonraker HTTP + WebSocket |

Mehrere Klipper-Drucker gleichzeitig, jeder mit eigener `base_url` und optionalem
API-Schlüssel.

Neben Klipper läuft auf dem Drucker ein kleiner **Companion**-Dienst. Er übernimmt,
was nur der Drucker selbst wissen kann: Druck-Historie samt Stromverbrauch,
Wartungszählung, Bett-Mesh je Druck, Trocknung, Push und iOS Live Activities.

### Unterstützte Drucker

**Bambu Lab** — jedes Modell mit eigenem Fähigkeitsprofil (Düsenzahl,
Kammerheizung, Abluft, Werkzeugmodul):

| | | |
|---|---|---|
| P1P | X1 Carbon | H2S |
| P1S | X1E | H2D |
| P2S | A1 | H2D Pro |
| A2L | A1 mini | H2C |
| X2D (Doppeldüse) | | |

Die Fähigkeiten kommen aus dem, was der Drucker über MQTT meldet; das Datenblatt
füllt nur die Lücken, bis er es tut. Meldet ein Drucker etwas anderes, gewinnt er.

**Klipper** — alles, was über Moonraker erreichbar ist.

> Mit Absicht nicht unterstützt: Klipper zusammen mit Wear OS.

---

## 📱 Apps

Fünf Clients, ein Server. Web und Desktop bekommen ihre Daten über einen Socket
geschoben; die mobilen Apps fragen bewusst alle fünf Sekunden nach — das übersteht
wackelige Mobilfunknetze deutlich besser.

| Client | Gebaut mit | Anmerkung |
|---|---|---|
| **Web** | Vanilla JS, Socket.IO | Jeder Browser, nichts zu installieren |
| **Desktop** | Electron | Derselbe Funktionsumfang wie Web, alles vorab zwischengespeichert |
| **iOS** | Swift, UIKit + SwiftUI | Live Activities, Dynamic Island, Widgets, eingebautes WireGuard |
| **Android** | Kotlin, Jetpack Compose | Layouts für Telefon und Tablet, Android 16 Live Updates |
| **macOS-Server-App** | Swift | Startet und überwacht den Server selbst |

### 🍎 iOS

**Live Activities** bringen den Druck auf den Sperrbildschirm und, ab iPhone 14
Pro, in die Dynamic Island — per Push gestartet, sobald der Druck beginnt, und
einmal pro Sekunde aktualisiert (Apples Grenze).

**Widgets** auf dem Startbildschirm in drei Größen mit Fortschritt, Temperaturen
und Vorschaubild.

Dazu Siri-Kurzbefehle, Hintergrundaktualisierung, haptische Rückmeldung,
Offline-Zwischenspeicher und eine Themenverwaltung, die dem System folgt.

> Die Apps werden hier nicht verteilt. Dieses Repo ist der Server.

---

## 🌍 Sprachen

🇩🇪 Deutsch · 🇬🇧 Englisch · 🇪🇸 Spanisch · 🇫🇷 Französisch · 🇮🇹 Italienisch

Je 2313 Texte, gleiche Schlüsselmengen, nachgeprüft. Umschaltbar schon auf der
Anmeldeseite, bevor du dich anmeldest.

---

## 🔧 Was der Installer tut

In dieser Reihenfolge. Jeder Schritt sagt, was er gefunden und was er übersprungen
hat.

1. **Systempakete** — Python 3.13 mit `venv` und `dev`, Bauwerkzeuge, Bild- und
   GPIO-Bibliotheken
2. **OrcaSlicer** — aktuelle Fassung, zum Schneiden auf dem Server
3. **Docker** — nur, wenn es noch nicht da ist
4. **Spoolman** — **eine vorhandene Installation bleibt unangetastet.** Läuft ein
   Container namens `spoolman`, oder antwortet etwas auf Port 7912, tritt der
   Schritt zur Seite und die Konfiguration übernimmt diese Instanz
5. **Anwendungsverzeichnis** — `/opt/printer-web-app`, dann die Dateien
6. **go2rtc** — das Kamera-Relais, passend zur Architektur
7. **Python-Umgebung** — ein venv mit den Laufzeit-Abhängigkeiten
8. **Konfiguration** — ein erkanntes Spoolman wird eingetragen
9. **TLS-Zertifikat** — selbst signiert, 825 Tage
10. **Cloudflare-Tunnel** und **Firebase** — freiwillig, beide fragen, Vorgabe nein
11. **systemd-Einheit** — `printer-web-app.service`, startet beim Hochfahren

### 💻 Plattformen

Übersetzte Module tragen Python-Fassung und Architektur im Dateinamen, und CPython
lädt **nur** bei genauer Übereinstimmung — ein Modul für 3.13 wird von 3.12 nicht
einmal *gefunden*. Der Installer liest die nötige Fassung aus den mitgelieferten
Dateinamen und hält mit einer Anleitung an, wenn sie fehlt.

| Architektur | Stand |
|---|---|
| `aarch64` — Raspberry Pi 4/5, ARM64-Bretter | liegt bei, Python 3.13 |
| `x86_64`, `armv7l` | zurzeit nicht gebaut — sag Bescheid, wenn du eine brauchst |

### Zwei Einzelheiten, die man kennen sollte

**go2rtc ist kein systemd-Dienst.** Der Server startet und stoppt es selbst,
passend zum Druckerstrom, und schreibt vorher seine Konfiguration mit der aktuellen
RTSP-Adresse des Geräts.

**`SuccessExitStatus=42`** steht in der Einheit. Der Neustart-Knopf in der
Weboberfläche beendet den Server mit Code 42; ohne diese Zeile zählt systemd jeden
davon als Fehlschlag und startet den Dienst nach fünf in Folge gar nicht mehr.

---

## 🛠️ Betrieb

```bash
sudo systemctl status printer-web-app     # läuft er?
sudo journalctl -u printer-web-app -f     # was sagt er?
sudo systemctl restart printer-web-app    # neu starten
cd /opt/printer-web-app && sudo ./manage.sh   # Menü: Update, Sicherung, Logs
```

**Aktualisieren:** `sudo ./manage.sh` → *Update*, oder den Installer noch einmal
laufen lassen. Er erkennt eine vorhandene Installation.

---

## 🐛 Wenn etwas klemmt

<details>
<summary><b>Der Server startet nicht</b></summary>

```bash
sudo journalctl -u printer-web-app -n 50
```

Häufigste Ursache ist eine Python-Fassung, die nicht zu den übersetzten Modulen
passt. Der Installer benennt das ausdrücklich. Nachsehen mit `python3 --version` —
es muss 3.13 sein.
</details>

<details>
<summary><b>Im Browser kommt nichts an / keine Gestaltung</b></summary>

Die statischen Dateien liegen im Verteilstand; ein halber Download zeigt sich als
Seite ohne Gestaltung. Installer noch einmal laufen lassen.
</details>

<details>
<summary><b>Der Zugangscode wird abgelehnt</b></summary>

Er hat **8 Zeichen** und enthält Buchstaben, nicht nur Ziffern. Zu finden am
Drucker unter *Einstellungen → Netzwerk*. Ihn dort neu erzeugen zu lassen ist
harmlos.
</details>

<details>
<summary><b>Keine Verbindung zum Drucker</b></summary>

1. `ping <drucker-ip>` — ist er überhaupt erreichbar?
2. Seriennummer vollständig? Sie hat 15 Zeichen, z. B. `01P09C4C1700729`
3. Entwickler- bzw. LAN-Modus am Drucker eingeschaltet?
4. Firewall: `sudo ufw allow 8883/tcp`
</details>

<details>
<summary><b>Kein Kamerabild</b></summary>

Ohne einen Drucker, der antwortet, hat die Kamera nichts zu zeigen — die Karte sagt
das, statt das letzte Standbild einzufrieren. Mit go2rtc ist der Modus WebRTC,
sonst MJPEG. `curl -s http://127.0.0.1:1984/api/streams` zeigt, ob das Relais einen
Strom hat.
</details>

<details>
<summary><b>Spoolman nach der Installation weg</b></summary>

Sollte nicht passieren — der Installer lässt eine laufende Instanz in Ruhe. Falls
doch: `docker ps -a` und das Log des Spoolman-Schritts sagen, was war.
</details>

<details>
<summary><b>Alles zurücksetzen und neu anfangen</b></summary>

```bash
sudo systemctl stop printer-web-app
sudo systemctl disable printer-web-app
sudo rm -f /etc/systemd/system/printer-web-app.service
sudo systemctl daemon-reload
sudo rm -rf /opt/printer-web-app
```

Docker, Spoolman und Home Assistant bleiben davon unberührt. Danach wieder bei
Schritt 1 anfangen.
</details>

Vollständiges Protokoll der Installation: `/tmp/printer-app-install.log`

---

## 🔐 Lizenz

Der Server braucht einen Lizenzschlüssel. Geprüft wird **offline**: das Token ist
mit Ed25519 signiert und trägt einen Hash der Hardware-Kennung des Rechners, zu dem
es gehört. Seit dem 01.09.2026 wird diese Bindung auf jeder Plattform geprüft,
nicht mehr nur auf macOS.

Die Lizenzseite deiner Installation zeigt die Hardware-Kennung mit Kopierknopf
und sagt dir, wohin damit. Die Adresse steht hier mit Absicht nicht.

Umzug auf einen anderen Rechner: Lizenz unter *Einstellungen → System & Lizenz*
lösen, dann auf dem neuen aktivieren.

---

## 🏗️ Gebaut mit

**Server** — Python (Flask, Socket.IO), SQLite für Konten, Sitzungen, Historie und
Wartung, MQTT zum Drucker, FTPS für die SD-Karte, ffmpeg für Zeitraffer, go2rtc für
die Kamera, Cython für die mitgelieferten Module.

**Clients** — Swift mit SwiftUI/UIKit und ActivityKit/WidgetKit auf iOS, Kotlin mit
Jetpack Compose auf Android, Electron auf dem Desktop, Vanilla JS mit Socket.IO im
Browser.

**Anbindungen** — Moonraker, Spoolman, Home Assistant, Meross, Firebase Cloud
Messaging, WireGuard.

---

## 📋 Voraussetzungen

| | Minimal | Empfohlen |
|---|---|---|
| **Python** | muss zum Bau passen | 3.13 |
| **RAM** | 512 MB | 2 GB+ |
| **Platte** | 2 GB | 10 GB+ mit Zeitraffern |
| **CPU** | 1 Kern @ 1 GHz | 2+ Kerne @ 1,5 GHz |
| **iOS** | — | 16.1+ für Live Activities |

---

<div align="center">

**Version 2.1.4** · 🇬🇧 [English version](README.md)

Für die 3D-Druck-Gemeinde gemacht

</div>
