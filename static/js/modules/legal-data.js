/**
 * The central legal and licence data (web and Electron). The single source of
 * truth for the "legal" section: the trademark disclaimer, the list of bundled
 * third-party components and their licence texts. Android uses the Google OSS
 * plugin (auto-generated), iOS mirrors this list -- maintain the content here
 * and follow up there.
 */
window.LEGAL_DATA = {
  // The trademarks mentioned (descriptive use) -- listed in the disclaimer.
  trademarks: ['Bambu Lab', 'Klipper', 'Mainsail', 'Moonraker', 'Spoolman', 'Meross', 'Sovol'],

  // The list of components no longer stands here.
  //
  // Maintained by hand it held nineteen entries, all from the Electron world --
  // the Python server with 115 packages, Android with 60, iOS and the three
  // bundled programs were missing entirely. A list somebody has to maintain
  // runs behind reality.
  //
  // It is generated now: `scripts/collect_licenses.py --schreibe` reads the
  // installed packages, the build.gradle, the pbxproj, the package.json and the
  // programs themselves, and writes static/lizenzen.json. The dialog loads that
  // file.

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
