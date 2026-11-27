# Pactlab Rinse — third-party notices

Pactlab Rinse bundles the components below. This file ships inside the app (`THIRD-PARTY-NOTICES.md`
in its resources).

## Converters (bundled per build)

Which converters a given build holds is recorded in that build's `SIGNING.json` (`converters`) and in
`vendor/BUNDLED.json` inside the app. Each bundled converter's own licence files are copied, unchanged,
from its official distribution into `vendor/notices/` inside the app; a converter whose licence files are
not in its distribution is not bundled.

| Component | Use in Rinse | Licence | Source |
|---|---|---|---|
| LibreOffice (headless) | Office documents to PDF, on the seller's machine | Mozilla Public License 2.0 (MPL-2.0), https://www.mozilla.org/MPL/2.0/ | https://www.libreoffice.org/ |
| Tesseract OCR | Text from scanned images, on the seller's machine | Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0 | https://github.com/tesseract-ocr/tesseract |

The source code of LibreOffice is available from https://www.libreoffice.org/download/source-code/.
Rinse runs these programs unmodified, as separate processes.

## Libraries in the window and the engine

The notices of the JavaScript libraries compiled into the window and the engine (React, pdf.js,
pdf-lib, fflate and their dependencies) are written beside each bundle by the build
(`main.js.LEGAL.txt`, `rinse-engine.cjs.LEGAL.txt`). The engine runs on Node.js (MIT licence,
https://github.com/nodejs/node/blob/main/LICENSE), which ships with its own notices.
