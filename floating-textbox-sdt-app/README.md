# SuperDoc: floating text box with an inline SDT

**Live demo:** https://claude.ai/artifact/AoetPs8ivCmzMrwivsaMUQ  
**Source:** https://github.com/superdoc/public-bonus-examples/tree/main/floating-textbox-sdt-app

A small Vite + vanilla JS example built on `superdoc` 2.x. It lets you:

- **Add a floating text box** (side panel, top-right button) to the page currently in view. The box is *In Front of Text*
  (`wp:wrapNone`), positioned relative to the page, has a **transparent background**
  (`a:noFill`) with a thin outline, zero text insets, and contains one paragraph whose only
  content is an **inline plain-text content control** (`w:sdt` with `w:text`).
- **Edit the SDT value** from the right side panel (live, through the Document API).
- **Move and resize the text box** from the panel. The SDT is the sole content of the box
  with zero insets, and the app adds a per-SDT CSS rule so the control's rendered chrome
  fills the whole box, so the rendered SDT size always equals the text box size. The panel
  shows both numbers.
- Open any `.docx` and download the edited result.

## Run

```bash
npm install
npm run dev
```

Then open the printed URL. `public/sample.docx` is a three-page document; scroll to any page
and click **Add floating SDT** at the top-right of the side panel.

## How it works

SuperDoc's browser Document API (`superdoc.activeEditor.doc`) can list content controls and
set a text control's value, including controls that live inside a text box story, but it has
no operation that creates, moves, or resizes a text box (`textboxes.*` reports
`CAPABILITY_UNAVAILABLE`, and `doc.get()` does not project drawings). The app therefore works
at two levels:

| Task | Mechanism |
|---|---|
| Find the page in view | `.superdoc-page[data-page-index]` elements under the middle of the editor viewport |
| Find a paragraph on that page | `doc.blocks.list()` + `superdoc.ui.viewport.getRect()` (its rects carry `pageIndex`) |
| Insert / move / resize / remove the box | `activeEditor.exportDocx()` → patch `word/document.xml` (`src/docx-textboxes.js`) → `superdoc.replaceFile()` |
| Change the SDT value | `doc.contentControls.text.setValue({ target: { kind: 'inline', nodeType: 'sdt', nodeId }, value })` |
| Keep the SDT the size of the box | zero `wps:bodyPr` insets + generated CSS on `.superdoc-structured-content-inline[data-sdt-id]` |

Body paragraphs exported by SuperDoc carry `w14:paraId` values equal to the block ids returned
by `doc.blocks.list()`, which is how the patch finds the anchor paragraph.

## Files

- `src/main.js`: SuperDoc setup, page detection, side panel, actions.
- `src/docx-textboxes.js`: DOCX package I/O and the XML for the text box run; list / insert /
  set geometry / make transparent / remove.
- `public/sample.docx`: generated three-page sample.

## Hosted demo (claude.ai Artifact)

The demo is published as a claude.ai Artifact at https://claude.ai/artifact/AoetPs8ivCmzMrwivsaMUQ (the header's **GitHub** button links back to this folder). To rebuild and republish after a change:

```bash
npm run build:artifact
```

`make-artifact-page.py` turns `dist-artifact/index.html` into `dist-artifact/artifact.html` (a page
fragment with the theme tokens and the sample DOCX embedded as base64, because the artifact host
does not serve `.docx` files) and escapes the U+FFFD characters that the SuperDoc bundles contain
inside template literals (the host rejects text files containing that character). Publish
`artifact.html` as the page and every file under `dist-artifact/assets/` as supporting files at the
same relative paths.
