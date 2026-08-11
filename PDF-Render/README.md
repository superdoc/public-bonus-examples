# PDF Form Filler

A Vue 3 PDF form editor built on [EmbedPDF](https://www.embedpdf.com)'s headless plugins, with a
Node backend that flattens the finished document using [pdf-lib](https://github.com/Hopding/pdf-lib).

- **My Signatures** panel — draw, type or upload a signature, then **drag it onto the page** (or
  click it and click the page), and drag/resize it once placed
- **Fill Mode / Design Mode** — fill fields, or select and move the field widgets themselves
- **Form State (JSON)** — live, editable JSON; typing in it updates the widgets on the page, and
  filling the page updates the JSON
- **Insert new form fields** — drag out a text field, checkbox or image field in Design Mode, and
  **rename** any of them in the right-hand panel
- **Upload PDF**, **zoom in/out**, **Auto Fill Data**, **Clear Form**
- **Download PDF** — the server writes every value and signature into the PDF with pdf-lib and
  returns a flattened file

---

## Quick start

```bash
docker compose watch
```

Then open <http://localhost:8080>. Editing anything under `src/` hot-reloads; editing `server/`
restarts the API. `docker compose watch` syncs files into the container instead of bind-mounting the
project, so the image's `node_modules` is not shadowed by the host's.

Without Docker:

```bash
npm install && npm run gen:sample && npm run dev
```

A sample AcroForm (`public/sample.pdf`) is generated on first run and exercises every supported
field type, so the app has something real to load.

---

## How it works

One Node process serves both the API and the client, on a single port — the shape Cloud Run
expects. In development that same process mounts Vite in middleware mode, so HMR and `/api` share
port 8080; in production it serves the built assets from `dist/client`.

The server is **stateless**: it never stores a PDF. The client keeps the original bytes and posts
them with each download request.

```
Client                                          Server
──────                                          ──────
upload → keep an ArrayBuffer copy ──┐
form edits (page or JSON panel)     │
signatures placed as annotations    ├─ POST /api/flatten ─→ pdf-lib:
fields drawn in Design Mode         │   { pdf, fields[],     · create the designed fields
                                    ┘     designedFields[],  · set values by field type
                                          placements[] }     · draw signatures
                                                             · updateFieldAppearances + flatten
                                    ←──── application/pdf ──┘
```

### Coordinates

`server/geometry.ts` is the only place a y-axis flip happens. EmbedPDF reports annotation rects and
pointer positions in **PDF points with a top-left origin**, relative to the page's unrotated size
and with the MediaBox origin already subtracted; pdf-lib draws in PDF user space (bottom-left
origin). The conversion is the exact inverse of the engine's `convertPagePointToDevicePoint`, and
`npx tsx scripts/verify-geometry.ts` round-trips it against that reference for all four page
rotations and for a non-zero MediaBox origin.

### Dragging a signature onto the page

The drop does not build the annotation itself. The signature plugin's placement tool commits an
annotation centred on the next `pointerdown` it receives, so `SignatureDropZone` arms the tool with
`activateSignaturePlacement()`, hides its own overlay, and synthesises that one pointer event at the
drop point. Stamp-vs-ink handling, default sizing, page clamping and undo history all stay inside
the plugin. The overlay only exists while a drag is in flight, so it never intercepts normal
form filling.

### Why the download payload is more than a `{name: value}` map

`getFormValues()` reports a radio button's value as its appearance-state name, which can be an
export name (`Remote`), an index (`1`), or — when the widget has no `/Opt` — the widget's NM, a
UUID. pdf-lib's `select()` only accepts one of the field's declared options. So each field is sent
with its type and, for choice fields, the option label the client resolved, and the server tries the
raw value, the label, and the index in turn. If none resolve, it leaves the existing selection alone
and reports a warning rather than clearing a value the user never touched.

Warnings come back in an `X-Flatten-Warnings` header and are logged in the browser console; every
field write is isolated so one odd value cannot cost you the whole download.

---

## Verification

```bash
npm run typecheck                                   # client + server
npx tsx scripts/verify-geometry.ts                  # rotation/MediaBox round-trips
node scripts/verify-download.mjs <filled.pdf>       # inspect a downloaded PDF
```

`scripts/verify-download.mjs` asserts the output is really flattened (no AcroForm fields remain),
that the filled values are present as drawn text, and that the signature and designed fields left
content behind.

---

## Deploying to Cloud Run

The image listens on `$PORT` (default 8080) and binds `0.0.0.0`.

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/pdf-render
gcloud run deploy pdf-render \
  --image gcr.io/PROJECT_ID/pdf-render \
  --allow-unauthenticated \
  --memory 1Gi
```

Notes:

- Give it **1Gi** — flattening loads the whole PDF, the images and the output in memory.
- The request body limit is 64 MB (a base64-encoded PDF plus signature images). Cloud Run's own
  limit is 32 MB for non-streamed requests, so very large PDFs will need chunked upload or GCS.
- Nothing is written to disk at runtime and no external hosts are contacted: the pdfium WASM is
  served from the app's own origin and font fallback is disabled.

## Known limitations

- **AcroForm only.** XFA forms are out of scope — pdf-lib cannot write them.
- **The download is flattened**, so the returned PDF is intentionally not re-fillable.
- **Fields added in Design Mode appear in the downloaded PDF but not in the JSON panel** until the
  document is reloaded: the form plugin builds its field index when a document loads and does not
  re-index newly created widgets. The "Fields you added" list in the right panel is the source of
  truth for what the server will create — including renames, which the server uses as the key when
  it creates the field and when it looks up that field's value.
- **A renamed field's name does not survive into the downloaded file**, because flattening discards
  the AcroForm entirely. The name governs how the field is created and addressed up to that point;
  it would become visible in the output only if flattening were turned off.
- **An image form field is a push button with an image appearance** — AcroForm has no image field
  type, and this is what `PDFButton.setImage()` produces.
- **Widget rotation on rotated pages is not set.** Values, signatures and field rectangles are
  placed correctly on rotated pages, but pdf-lib cannot set a widget's `/MK /R`, so a field drawn on
  a rotated page renders its text unrotated.
- Text is written with the standard Helvetica, which only encodes WinAnsi. Common typographic
  characters are mapped and anything else is dropped rather than failing the field; a document
  needing full Unicode would need an embedded font via `@pdf-lib/fontkit`.
