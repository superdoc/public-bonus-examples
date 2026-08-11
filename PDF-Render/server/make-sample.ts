/**
 * Generates `public/sample.pdf` — an AcroForm that exercises every field type the app
 * has to handle (text, multiline text, dropdown, radio group, checkbox), so the viewer,
 * the JSON panel and the flatten endpoint all have something real to work against.
 *
 * Run directly with `npm run gen:sample`; the dev server also calls ensureSamplePdf().
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.11, 0.13, 0.16);
const MUTED = rgb(0.48, 0.53, 0.6);
const ACCENT = rgb(0.23, 0.31, 0.78);
const BORDER = rgb(0.62, 0.67, 0.74);

export async function buildSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Employee Onboarding Form');
  doc.setAuthor('Acme Corporation');

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const layout = new Layout(page, regular, bold);

  /* ---------------------------------------------------------------- header ---- */
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 6, width: PAGE_WIDTH, height: 6, color: ACCENT });

  layout.text('Acme Corporation', { font: bold, size: 15, color: INK });
  layout.text('INNOVATION  •  EXCELLENCE  •  TRUST', { size: 6.5, color: MUTED, gap: 3 });

  layout.textRight('Document No: ACM-2026-0142', { y: 62, size: 7, color: MUTED });
  layout.textRight('Revision: 1.0', { y: 72, size: 7, color: MUTED });
  layout.textRight('Date: March 20, 2026', { y: 82, size: 7, color: MUTED });

  layout.gap(11);
  layout.text('Employee Onboarding Form', { font: bold, size: 13, color: INK });
  layout.gap(4);
  layout.text('Please complete all sections of this form. Fields marked with an asterisk (*) are required.', {
    size: 7.5,
    color: MUTED,
  });
  layout.text('This form demonstrates the supported PDF form field types.', { size: 7.5, color: MUTED, gap: 2 });

  /* ------------------------------------------- 1. personal information ---- */
  layout.section('1. PERSONAL INFORMATION — TEXT FIELDS');

  layout.row(
    [
      { label: 'FIRST NAME *', name: 'First_Name', span: 0.5 },
      { label: 'LAST NAME *', name: 'Last_Name', span: 0.5 },
    ],
    form,
  );
  layout.row(
    [
      { label: 'EMAIL ADDRESS *', name: 'Email_Address', span: 0.62 },
      { label: 'PHONE NUMBER', name: 'Phone_Number', span: 0.38 },
    ],
    form,
  );
  layout.row([{ label: 'HOME ADDRESS', name: 'Home_Address', span: 1, height: 30, multiline: true }], form);
  layout.hint('Street, apt and unit');
  layout.row(
    [
      { label: 'CITY', name: 'City', span: 0.4 },
      { label: 'STATE / PROVINCE', name: 'State', span: 0.3 },
      { label: 'POSTAL CODE', name: 'Postal_Code', span: 0.3 },
    ],
    form,
  );

  /* --------------------------------------------- 2. employment details ---- */
  layout.section('2. EMPLOYMENT DETAILS — COMBO BOX (DROPDOWN)');

  layout.dropdownRow(
    [
      {
        label: 'DEPARTMENT',
        name: 'Department',
        span: 0.5,
        options: ['Engineering', 'Design', 'Marketing', 'Sales', 'Finance', 'People Operations'],
        selected: 'Engineering',
        hint: 'Engineering, Design, Marketing, Sales, Finance, People Ops',
      },
      {
        label: 'EMPLOYMENT TYPE *',
        name: 'Employment_Type',
        span: 0.5,
        options: ['Full-time', 'Part-time', 'Contract', 'Intern'],
        selected: 'Full-time',
        hint: 'Full-time, Part-time, Contract, Intern',
      },
    ],
    form,
  );
  layout.dropdownRow(
    [
      {
        label: 'OFFICE LOCATION',
        name: 'Office_Location',
        span: 0.5,
        options: ['New York', 'San Francisco', 'London', 'Berlin', 'Remote'],
        selected: 'New York',
        hint: 'New York, San Francisco, London, Berlin, Remote',
      },
    ],
    form,
    [{ label: 'START DATE', name: 'Start_Date', span: 0.5 }],
  );

  /* ---------------------------------------------- 3. work preferences ---- */
  layout.section('3. WORK PREFERENCES — RADIO BUTTONS');

  layout.radioColumns(
    {
      label: 'WORK ARRANGEMENT',
      name: 'Work_Arrangement',
      options: ['On-site', 'Remote', 'Hybrid'],
      selected: 'On-site',
    },
    {
      label: 'PREFERRED SHIFT',
      name: 'Preferred_Shift',
      options: ['Morning (8 AM – 4 PM)', 'Standard (9 AM – 5 PM)', 'Flexible'],
      selected: 'Morning (8 AM – 4 PM)',
    },
    form,
  );

  /* ------------------------------------------------ 4. equipment/access ---- */
  layout.section('4. EQUIPMENT & ACCESS — CHECK BOXES');

  layout.checkboxColumns(
    {
      label: 'EQUIPMENT REQUESTED',
      items: [
        { name: 'Equipment_Laptop', caption: 'Laptop' },
        { name: 'Equipment_Monitor', caption: 'External monitor' },
        { name: 'Equipment_Keyboard', caption: 'Keyboard & mouse' },
        { name: 'Equipment_Desk', caption: 'Standing desk' },
      ],
    },
    {
      label: 'SYSTEM ACCESS',
      items: [
        { name: 'Access_Repository', caption: 'Source repository' },
        { name: 'Access_Cloud', caption: 'Cloud console' },
        { name: 'Access_Internal', caption: 'Internal tools' },
        { name: 'Access_VPN', caption: 'VPN' },
      ],
    },
    form,
  );

  /* ------------------------------------------------------ 5. experience ---- */
  layout.section('5. EXPERIENCE — TEXT FIELDS');

  layout.row([{ label: 'PROGRAMMING LANGUAGES', name: 'Programming_Languages', span: 1 }], form);
  layout.row([{ label: 'FRAMEWORKS & TOOLS', name: 'Framework_Tools', span: 1 }], form);

  /* ------------------------------------------------------ 6. signature ---- */
  layout.section('6. ACKNOWLEDGEMENT — SIGNATURE');

  layout.text(
    'I confirm the information above is accurate and complete to the best of my knowledge.',
    { size: 7.5, color: MUTED },
  );
  layout.gap(6);
  layout.signatureArea(form);

  /* ---------------------------------------------------------------- footer ---- */
  page.drawLine({
    start: { x: MARGIN, y: 58 },
    end: { x: PAGE_WIDTH - MARGIN, y: 58 },
    thickness: 0.5,
    color: BORDER,
  });
  page.drawText('Acme Corporation • Confidential', { x: MARGIN, y: 46, size: 6.5, font: regular, color: MUTED });
  page.drawText('Employee Onboarding Form — Page 1 of 1', {
    x: MARGIN,
    y: 37,
    size: 6.5,
    font: regular,
    color: MUTED,
  });
  const formCode = 'FORM-2026-0142';
  page.drawText(formCode, {
    x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(formCode, 6.5),
    y: 46,
    size: 6.5,
    font: regular,
    color: MUTED,
  });
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: 4, color: ACCENT });

  form.updateFieldAppearances(regular);
  return doc.save();
}

/* --------------------------------------------------------------- layout ---- */

interface TextFieldSpec {
  label: string;
  name: string;
  span: number;
  height?: number;
  multiline?: boolean;
}

interface DropdownSpec extends TextFieldSpec {
  options: string[];
  selected?: string;
  hint?: string;
}

type Form = ReturnType<PDFDocument['getForm']>;

/** Top-down cursor over a single page; converts to pdf-lib's bottom-left origin. */
class Layout {
  private top = 42;

  constructor(
    private readonly page: PDFPage,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {}

  private y(offsetFromTop: number): number {
    return PAGE_HEIGHT - offsetFromTop;
  }

  gap(amount: number): void {
    this.top += amount;
  }

  text(
    value: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number } = {},
  ): void {
    const size = opts.size ?? 9;
    this.top += size + (opts.gap ?? 2);
    this.page.drawText(value, {
      x: MARGIN,
      y: this.y(this.top),
      size,
      font: opts.font ?? this.regular,
      color: opts.color ?? INK,
    });
  }

  textRight(value: string, opts: { y: number; size?: number; color?: ReturnType<typeof rgb> }): void {
    const size = opts.size ?? 7;
    this.page.drawText(value, {
      x: PAGE_WIDTH - MARGIN - this.regular.widthOfTextAtSize(value, size),
      y: this.y(opts.y),
      size,
      font: this.regular,
      color: opts.color ?? MUTED,
    });
  }

  section(title: string): void {
    this.top += 13;
    this.page.drawText(title, {
      x: MARGIN,
      y: this.y(this.top),
      size: 8,
      font: this.bold,
      color: ACCENT,
    });
    this.top += 4;
  }

  hint(value: string): void {
    this.top += 8;
    this.page.drawText(value, {
      x: MARGIN,
      y: this.y(this.top),
      size: 5.5,
      font: this.regular,
      color: MUTED,
    });
  }

  /** One row of text fields sharing the content width. */
  row(specs: TextFieldSpec[], form: Form): void {
    const height = Math.max(...specs.map((s) => s.height ?? 18));
    this.top += 13;
    let x = MARGIN;

    for (const spec of specs) {
      const width = CONTENT_WIDTH * spec.span - (specs.length > 1 ? 8 : 0);
      this.page.drawText(spec.label, {
        x,
        y: this.y(this.top),
        size: 5.5,
        font: this.bold,
        color: MUTED,
      });

      const field = form.createTextField(spec.name);
      if (spec.multiline) field.enableMultiline();
      field.addToPage(this.page, {
        x,
        y: this.y(this.top + height + 4),
        width,
        height,
        borderWidth: 0.75,
        borderColor: BORDER,
        backgroundColor: rgb(1, 1, 1),
      });
      // setFontSize needs the /DA entry that addToPage creates.
      field.setFontSize(9);

      x += CONTENT_WIDTH * spec.span;
    }

    this.top += height + 4;
  }

  /** A row of dropdowns, optionally mixed with trailing text fields. */
  dropdownRow(specs: DropdownSpec[], form: Form, trailingText: TextFieldSpec[] = []): void {
    const height = 18;
    this.top += 13;
    let x = MARGIN;
    const total = specs.length + trailingText.length;

    for (const spec of specs) {
      const width = CONTENT_WIDTH * spec.span - (total > 1 ? 8 : 0);
      this.page.drawText(spec.label, {
        x,
        y: this.y(this.top),
        size: 5.5,
        font: this.bold,
        color: MUTED,
      });

      const field = form.createDropdown(spec.name);
      field.setOptions(spec.options);
      if (spec.selected) field.select(spec.selected);
      field.addToPage(this.page, {
        x,
        y: this.y(this.top + height + 4),
        width,
        height,
        borderWidth: 0.75,
        borderColor: BORDER,
        backgroundColor: rgb(1, 1, 1),
      });
      field.setFontSize(9);

      if (spec.hint) {
        this.page.drawText(spec.hint, {
          x,
          y: this.y(this.top + height + 11),
          size: 5,
          font: this.regular,
          color: MUTED,
        });
      }

      x += CONTENT_WIDTH * spec.span;
    }

    for (const spec of trailingText) {
      const width = CONTENT_WIDTH * spec.span - (total > 1 ? 8 : 0);
      this.page.drawText(spec.label, {
        x,
        y: this.y(this.top),
        size: 5.5,
        font: this.bold,
        color: MUTED,
      });

      const field = form.createTextField(spec.name);
      field.addToPage(this.page, {
        x,
        y: this.y(this.top + height + 4),
        width,
        height,
        borderWidth: 0.75,
        borderColor: BORDER,
        backgroundColor: rgb(1, 1, 1),
      });
      field.setFontSize(9);

      x += CONTENT_WIDTH * spec.span;
    }

    this.top += height + 12;
  }

  radioColumns(
    left: { label: string; name: string; options: string[]; selected?: string },
    right: { label: string; name: string; options: string[]; selected?: string },
    form: Form,
  ): void {
    this.top += 13;
    const labelTop = this.top;
    const columnX = [MARGIN, MARGIN + CONTENT_WIDTH / 2];

    for (const [index, group] of [left, right].entries()) {
      const x = columnX[index];
      this.page.drawText(group.label, {
        x,
        y: this.y(labelTop),
        size: 5.5,
        font: this.bold,
        color: MUTED,
      });

      const radio = form.createRadioGroup(group.name);
      let optionTop = labelTop + 12;
      for (const option of group.options) {
        radio.addOptionToPage(option, this.page, {
          x,
          y: this.y(optionTop + 8),
          width: 8,
          height: 8,
          borderWidth: 0.75,
          borderColor: BORDER,
        });
        this.page.drawText(option, {
          x: x + 13,
          y: this.y(optionTop + 7),
          size: 6.5,
          font: this.regular,
          color: INK,
        });
        optionTop += 12;
      }
      if (group.selected) radio.select(group.selected);
    }

    this.top = labelTop + 12 + Math.max(left.options.length, right.options.length) * 12;
  }

  checkboxColumns(
    left: { label: string; items: Array<{ name: string; caption: string }> },
    right: { label: string; items: Array<{ name: string; caption: string }> },
    form: Form,
  ): void {
    this.top += 13;
    const labelTop = this.top;
    const columnX = [MARGIN, MARGIN + CONTENT_WIDTH / 2];

    for (const [index, group] of [left, right].entries()) {
      const x = columnX[index];
      this.page.drawText(group.label, {
        x,
        y: this.y(labelTop),
        size: 5.5,
        font: this.bold,
        color: MUTED,
      });

      let itemTop = labelTop + 12;
      for (const item of group.items) {
        const box = form.createCheckBox(item.name);
        box.addToPage(this.page, {
          x,
          y: this.y(itemTop + 8),
          width: 8,
          height: 8,
          borderWidth: 0.75,
          borderColor: BORDER,
        });
        this.page.drawText(item.caption, {
          x: x + 13,
          y: this.y(itemTop + 7),
          size: 6.5,
          font: this.regular,
          color: INK,
        });
        itemTop += 12;
      }
    }

    this.top = labelTop + 12 + Math.max(left.items.length, right.items.length) * 12;
  }

  /** Signature line plus a date field, leaving room to drop a signature image. */
  signatureArea(form: Form): void {
    this.top += 10;
    const boxHeight = 28;
    const signWidth = CONTENT_WIDTH * 0.58;

    this.page.drawRectangle({
      x: MARGIN,
      y: this.y(this.top + boxHeight),
      width: signWidth,
      height: boxHeight,
      borderWidth: 0.75,
      borderColor: BORDER,
      borderDashArray: [2, 2],
    });
    this.page.drawText('Drop your signature here', {
      x: MARGIN + 8,
      y: this.y(this.top + boxHeight / 2),
      size: 6.5,
      font: this.regular,
      color: MUTED,
    });
    this.page.drawText('SIGNATURE', {
      x: MARGIN,
      y: this.y(this.top - 4),
      size: 5.5,
      font: this.bold,
      color: MUTED,
    });

    const dateX = MARGIN + CONTENT_WIDTH * 0.64;
    this.page.drawText('DATE SIGNED', {
      x: dateX,
      y: this.y(this.top - 4),
      size: 5.5,
      font: this.bold,
      color: MUTED,
    });
    const dateField = form.createTextField('Date_Signed');
    dateField.addToPage(this.page, {
      x: dateX,
      y: this.y(this.top + 22),
      width: CONTENT_WIDTH * 0.36,
      height: 18,
      borderWidth: 0.75,
      borderColor: BORDER,
      backgroundColor: rgb(1, 1, 1),
    });
    dateField.setFontSize(9);

    this.top += boxHeight;
  }
}

/* ------------------------------------------------------------ entrypoints ---- */

export async function ensureSamplePdf(target: string): Promise<void> {
  if (existsSync(target)) return;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await buildSamplePdf());
  console.log(`[sample] wrote ${target}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const target = path.resolve(process.cwd(), 'public/sample.pdf');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await buildSamplePdf());
  console.log(`[sample] wrote ${target}`);
}
