/**
 * Round-trip test for server/geometry.ts.
 *
 * The reference is EmbedPDF's own forward transform (`convertPagePointToDevicePoint` in
 * @embedpdf/engines): PDF user space -> the top-left "device" space its annotation rects
 * use. Our job is the exact inverse, so feeding a known PDF point through the engine's
 * formula and back through ours must return the original point, for every rotation and
 * for a MediaBox whose origin is not (0, 0).
 *
 * Run: npx tsx scripts/verify-geometry.ts
 */
import { devicePointToPdf, deviceRectToPdf, type PageFrame } from '../server/geometry.js';

/** Verbatim port of the engine's forward transform. */
function pdfPointToDevice(point: { x: number; y: number }, frame: PageFrame) {
  const DW = frame.width;
  const DH = frame.height;
  const px = point.x - frame.originX;
  const py = point.y - frame.originY;

  switch (frame.quarterTurns) {
    case 1:
      return { x: py, y: px };
    case 2:
      return { x: DW - px, y: py };
    case 3:
      return { x: DW - py, y: DH - px };
    default:
      return { x: px, y: DH - py };
  }
}

const frames: Array<{ label: string; frame: PageFrame }> = [];
for (const quarterTurns of [0, 1, 2, 3]) {
  frames.push({
    label: `letter rot=${quarterTurns * 90}`,
    frame: { originX: 0, originY: 0, width: 612, height: 792, quarterTurns },
  });
  frames.push({
    label: `offset mediabox rot=${quarterTurns * 90}`,
    frame: { originX: 20, originY: -35, width: 500, height: 700, quarterTurns },
  });
}

const samplePoints = [
  { x: 0, y: 0 },
  { x: 100, y: 200 },
  { x: 612, y: 792 },
  { x: 56.25, y: 733.5 },
];

let failures = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

for (const { label, frame } of frames) {
  for (const point of samplePoints) {
    const pdfPoint = { x: point.x + frame.originX, y: point.y + frame.originY };
    const device = pdfPointToDevice(pdfPoint, frame);
    const back = devicePointToPdf(device, frame);

    const ok = near(back.x, pdfPoint.x) && near(back.y, pdfPoint.y);
    if (!ok) {
      failures += 1;
      console.log(
        `FAIL  ${label}: pdf(${pdfPoint.x},${pdfPoint.y}) -> device(${device.x},${device.y}) -> pdf(${back.x},${back.y})`,
      );
    }
  }
  console.log(`PASS  point round-trip: ${label}`);
}

/* A rect's converted size must swap for 90/270 and be preserved otherwise. */
for (const { label, frame } of frames) {
  const rect = { origin: { x: 40, y: 60 }, size: { width: 180, height: 24 } };
  const converted = deviceRectToPdf(rect, frame);
  const swaps = frame.quarterTurns === 1 || frame.quarterTurns === 3;
  const expectedWidth = swaps ? rect.size.height : rect.size.width;
  const expectedHeight = swaps ? rect.size.width : rect.size.height;

  const ok = near(converted.width, expectedWidth) && near(converted.height, expectedHeight);
  if (!ok) {
    failures += 1;
    console.log(
      `FAIL  ${label}: rect size ${converted.width}x${converted.height}, expected ${expectedWidth}x${expectedHeight}`,
    );
  } else {
    console.log(`PASS  rect size: ${label} -> ${converted.width}x${converted.height}`);
  }

  // And it must stay inside the page box.
  const inside =
    converted.x >= frame.originX - 1e-6 &&
    converted.y >= frame.originY - 1e-6 &&
    converted.x + converted.width <= frame.originX + Math.max(frame.width, frame.height) + 1e-6;
  if (!inside) {
    failures += 1;
    console.log(`FAIL  ${label}: rect fell outside the page box (${JSON.stringify(converted)})`);
  }
}

console.log(failures === 0 ? '\nAll geometry checks passed' : `\n${failures} geometry check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
