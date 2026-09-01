/**
 * Zentrale Rechts-/Lizenz-Daten (Web/Electron). Single Source of Truth für den
 * „Rechtliches"-Bereich: Marken-Disclaimer, Liste der gebündelten Drittanbieter-
 * Komponenten + Lizenztexte. Android nutzt das Google-OSS-Plugin (auto-generiert),
 * iOS spiegelt diese Liste — Inhalte hier pflegen, dort nachziehen.
 */
window.LEGAL_DATA = {
  // Genannte Marken (descriptive use) — werden im Disclaimer aufgezählt.
  trademarks: ['Bambu Lab', 'Klipper', 'Mainsail', 'Moonraker', 'Spoolman', 'Meross', 'Sovol'],

  // Die Liste der Komponenten steht NICHT mehr hier.
  //
  // Von Hand gepflegt umfasste sie neunzehn Eintraege, alle aus der
  // Electron-Welt — der Python-Server mit 115 Paketen, Android mit 60,
  // iOS und die drei mitgelieferten Programme fehlten vollstaendig
  // (nachgezaehlt 31aug26). Eine Liste, die jemand pflegen muss, laeuft
  // der Wirklichkeit hinterher.
  //
  // Sie wird jetzt erzeugt: `scripts/lizenzen_sammeln.py --schreibe`
  // liest die installierten Pakete, die build.gradle, die pbxproj, die
  // package.json und die Programme selbst und schreibt
  // static/lizenzen.json. Der Dialog laedt diese Datei.

  // Standard-Lizenztexte (einmal, da viele Komponenten dieselbe nutzen).
  licenseTexts: {
    'MIT': `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,

    'Apache-2.0': `Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

Der vollständige Lizenztext liegt unter der oben genannten URL.`,

    'BSD-3-Clause': `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES.`,

    'BSD-2-Clause': `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.`,

    'SIL OFL-1.1': `This Font Software is licensed under the SIL Open Font License, Version 1.1. The full license is available at https://scripts.sil.org/OFL and is also available with a FAQ at the same address.`,

    'CC-BY-4.0': `This work is licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0). To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/`,
  },
};
