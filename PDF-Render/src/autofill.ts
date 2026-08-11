/**
 * Value builders for the "Auto Fill Data" and "Clear Form" buttons.
 *
 * Deliberately limited to text fields and checkboxes. Radio buttons report their value
 * as the widget's NM (a UUID) and combo boxes need one of their declared options, so
 * guessing values for them would produce writes the PDF rejects. Those stay editable
 * on the page and through the JSON panel.
 */
import { PDF_FORM_FIELD_TYPE } from '@embedpdf/models';
import type { FormFieldInfo } from '@embedpdf/plugin-form/vue';

const RULES: Array<[RegExp, string]> = [
  [/first.*name/i, 'Jane'],
  [/last.*name|surname/i, 'Doe'],
  [/e-?mail/i, 'jane.doe@example.com'],
  [/phone|mobile|tel/i, '+1 (555) 010-2030'],
  [/address/i, '128 Market Street, Suite 400'],
  [/city/i, 'San Francisco'],
  [/state|province/i, 'CA'],
  [/postal|zip/i, '94105'],
  [/start/i, '2026-09-01'],
  [/date/i, '2026-08-11'],
  [/language/i, 'TypeScript, Python, Go'],
  [/framework|tool/i, 'Vue, Node.js, Docker'],
];

const MAX_AUTO_CHECKED = 2;

export function buildAutoFillValues(fields: FormFieldInfo[]): Record<string, string> {
  const values: Record<string, string> = {};
  let checked = 0;

  for (const field of fields) {
    if (field.readOnly) continue;

    if (field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD) {
      const rule = RULES.find(([pattern]) => pattern.test(field.name));
      values[field.name] = rule ? rule[1] : 'Sample value';
      continue;
    }

    if (field.type === PDF_FORM_FIELD_TYPE.CHECKBOX && checked < MAX_AUTO_CHECKED) {
      values[field.name] = 'on';
      checked += 1;
    }
  }

  return values;
}

export function buildClearValues(fields: FormFieldInfo[]): Record<string, string> {
  const values: Record<string, string> = {};

  for (const field of fields) {
    if (field.readOnly) continue;
    if (field.type === PDF_FORM_FIELD_TYPE.TEXTFIELD) values[field.name] = '';
    else if (field.type === PDF_FORM_FIELD_TYPE.CHECKBOX) values[field.name] = 'Off';
  }

  return values;
}
