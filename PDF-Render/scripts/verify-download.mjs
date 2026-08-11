/**
 * Verifies a flattened PDF produced by POST /api/flatten.
 *
 * Checks the things that actually matter and are easy to get wrong:
 *  - the form really is flattened (no AcroForm fields left)
 *  - the filled values are present as page text
 *  - the signature and any designed fields left content behind (page size growth +
 *    embedded XObjects)
 *
 * Usage: node scripts/verify-download.mjs <filled.pdf> [original.pdf]
 */
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

const [, , filledPath, originalPath = 'public/sample.pdf'] = process.argv;
if (!filledPath) {
  console.error('usage: node scripts/verify-download.mjs <filled.pdf> [original.pdf]');
  process.exit(2);
}

const filledBytes = await readFile(filledPath);
const filled = await PDFDocument.load(filledBytes, { ignoreEncryption: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
};

/* ------------------------------------------------------------------ flatten ---- */
let remaining = -1;
try {
  remaining = filled.getForm().getFields().length;
} catch {
  remaining = 0;
}
check('form is flattened', remaining === 0, `${remaining} field(s) remaining`);

/* -------------------------------------------------------------------- text ---- */
// pdf-lib cannot extract text, so read the decompressed content streams directly and
// look for the literal strings the flattened appearances draw.
const page = filled.getPage(0);
const contentText = await extractPageText(page);

const expected = [
  'Jane',
  'Doe',
  'jane.doe@example.com',
  'San Francisco',
  'TypeScript, Python, Go',
  'Design',
  'Contract',
];
for (const needle of expected) {
  check(`value present: ${needle}`, contentText.includes(needle));
}

/* ------------------------------------------------------- embedded resources ---- */
const resources = page.node.Resources();
const xObjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
const xObjectCount = xObjects ? xObjects.entries().length : 0;
check('page has embedded XObjects (flattened appearances + signature)', xObjectCount > 0, `${xObjectCount} found`);

/* ---------------------------------------------------------------- size grew ---- */
try {
  const originalBytes = await readFile(originalPath);
  check(
    'output larger than original (content was added)',
    filledBytes.length > originalBytes.length,
    `${originalBytes.length} -> ${filledBytes.length} bytes`,
  );
} catch {
  check('original available for size comparison', false, `could not read ${originalPath}`);
}

/* ------------------------------------------------------------------- report ---- */
let failed = 0;
for (const { name, pass, detail } of results) {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Collects the literal strings drawn anywhere in the document.
 *
 * Flattening moves field values into form XObjects that can nest arbitrarily, so rather
 * than walking the resource tree this decodes every stream in the file. That is more
 * than "page 0" strictly needs, but this document is one page and the check only cares
 * whether the value survived into the output.
 */
async function extractPageText(pdfPage) {
  const { inflateSync, inflateRawSync } = await import('node:zlib');
  const context = pdfPage.doc.context;
  let text = '';

  for (const [, object] of context.enumerateIndirectObjects()) {
    const raw = object?.contents;
    if (!raw) continue;

    let bytes = Buffer.from(raw);
    const filter = object.dict?.get?.(PDFName.of('Filter'));
    if (filter && String(filter).includes('FlateDecode')) {
      try {
        bytes = inflateSync(bytes);
      } catch {
        try {
          bytes = inflateRawSync(bytes);
        } catch {
          continue;
        }
      }
    }
    text += bytes.toString('latin1');
  }

  // Text operands come in two flavours: literal strings in parentheses, and hex strings
  // in angle brackets (which is what pdf-lib emits). Decode both so a plain includes()
  // can find the values.
  const literals = text.replace(/\\([()\\])/g, '$1');
  const hexDecoded = literals.replace(/<([0-9A-Fa-f\s]+)>/g, (_match, hex) => {
    const compact = hex.replace(/\s+/g, '');
    if (compact.length % 2 !== 0) return _match;
    return Buffer.from(compact, 'hex').toString('latin1');
  });

  return hexDecoded;
}
