# ADR 0037: The vision lane: pages read from their images

- **Status:** accepted (2026-11-20, T-121)
- **Deciders:** Kumar

## Context
- **Every AI call was text only,** so:
  - a scanned PDF was refused at upload ("needs OCR");
  - charts and image tables inside documents were invisible;
  - PowerPoint decks and images couldn't be uploaded.
- **Diligence evidence often lives in pixels:** revenue bridges, cohort charts, scanned leases, image tables.

## Decision
1. **Images in AI calls.**
   - `ModelMessage` can carry images.
   - Bedrock sends them as Converse image blocks (verified in `@aws-sdk/client-bedrock-runtime` 3.1149).
   - Other transports refuse with `UNSUPPORTED`, which passes the job to the next lane. They gain image support only when their SDK shapes are verified.
   - An image must carry its document's data classification: people data (HR, compensation and so on) is refused before any call, and an unclassified image is refused too.
2. **One vision prompt,** `document.vision@1` (job type `vision`). It returns a structured reading of one page: the kind of page, a transcription, tables, chart series as strings, and a summary.
   - Numbers are copied, never calculated (rule 3).
   - "Unreadable" is a valid answer.
3. **Reading becomes page text.** The reading is stored as the page's text:
   - `text_source = VISION`, or `TEXT_AND_VISION` when added to a text page under "From the page image:";
   - so extraction, Q&A, consistency checks and citations work unchanged;
   - findings stay drafts until a person accepts them, and the library tells reviewers to check against the original.
4. **Where it applies:**
   - scanned PDFs (every page, up to 60);
   - image uploads (PNG, JPEG);
   - PowerPoint (`.pptx`, a page per slide, newly accepted; slides with pictures are read);
   - pictures inside Word and Excel files (as extra pages);
   - text-PDF pages that hold pictures and little text (likely charts or image tables).
   - **Legacy `.doc`, `.xls` and `.ppt`** stay refused, with a "save as" message. Converting them would need LibreOffice on the server.
5. **Rendering:** `pdfjs-dist` renders PDF pages through `@napi-rs/canvas` (MIT; its prebuilt binary covers the Debian x64 server image). It's already pdfjs's optional dependency for Node, and is now an explicit dependency. Pages are rendered at about 1,600 px on the long side, and images over 3.5 MB are scaled down.
6. **Background, never silent:**
   - Reading runs after upload, page by page, as the uploader.
   - The document shows progress, done, partial (which pages, and why) or failed, with **Read again**.
7. **Seller uploads are read too.** Page updates and AI runs are buyer-side only under RLS, so the reading is written through SECURITY DEFINER functions (`app_vision_*`):
   - they check the caller may see the document and either uploaded it or is on the buyer side;
   - they change only the reading columns;
   - they record only the vision prompt's run.
8. **The model:** the vision job's chain (Gemini Pro, then Claude Balanced) gives **Claude Sonnet 5.5 on Bedrock** where Google isn't connected. A specialist vision model can be chosen in the routing diagram once it's in the catalog and its health check passes.

## Consequences
- **Scans and decks become first-class evidence,** with one extra model call per page read. That cost is metered under job type `vision`.
- **Not covered:** video stays "not yet", and legacy Office formats need re-saving.
