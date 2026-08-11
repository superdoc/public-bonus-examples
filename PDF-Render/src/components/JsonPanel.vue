<script setup lang="ts">
/**
 * Live form state as editable JSON. Typing here calls `setFormValues()`, which updates
 * the widgets on the page; clicking fields on the page updates the text here.
 *
 * Also lists the fields the user drew in Design mode, whose names are editable — the
 * name is what the server creates the field with, so it is worth getting right before
 * downloading.
 */
import { reactive, ref } from 'vue';
import { designedFields, removeDesignedField, renameDesignedField, setStatus } from '@/state';
import type { UseFormJson } from '@/composables/useFormJson';

const props = defineProps<{ form: UseFormJson }>();

const form = props.form;

/** Draft names keyed by the field's *current* name; absent means "not being edited". */
const drafts = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const justSaved = ref<string | null>(null);

function nameFor(current: string): string {
  return drafts[current] ?? current;
}

function onNameInput(current: string, value: string): void {
  drafts[current] = value;
  delete errors[current];
}

function commitName(current: string): void {
  const next = (drafts[current] ?? current).trim();

  if (next === current) {
    delete drafts[current];
    delete errors[current];
    return;
  }

  // The document's own field names are off limits: two widgets sharing a name are two
  // views of the same PDF field, not two fields.
  const taken = form.getFields().map((field) => field.name);
  const error = renameDesignedField(current, next, taken);

  if (error) {
    // Revert the input so the panel never shows a name the field does not actually have
    // — this list is what tells the user which fields the server will create.
    errors[current] = error;
    delete drafts[current];
    window.setTimeout(() => {
      if (errors[current] === error) delete errors[current];
    }, 4000);
    return;
  }

  const field = designedFields.value.find((candidate) => candidate.name === next);
  if (field?.annotationId) form.renameWidget(field.annotationId, next);

  delete drafts[current];
  delete errors[current];
  justSaved.value = next;
  setStatus('success', `Renamed to "${next}".`);
  window.setTimeout(() => {
    if (justSaved.value === next) justSaved.value = null;
  }, 1200);
}

function cancelName(current: string): void {
  delete drafts[current];
  delete errors[current];
}
</script>

<template>
  <aside class="panel">
    <header>
      <h2 class="panel__title">Form State (JSON)</h2>
      <p class="panel__hint">
        Fill the form on the left to see the state update here — or edit this JSON to update the PDF.
      </p>
    </header>

    <textarea
      class="editor"
      :class="{ 'editor--invalid': !!form.parseError.value }"
      spellcheck="false"
      :value="form.text.value"
      @input="form.onInput(($event.target as HTMLTextAreaElement).value)"
      @focus="form.onFocus()"
      @blur="form.onBlur()"
    ></textarea>

    <p v-if="form.parseError.value" class="error">{{ form.parseError.value }}</p>
    <p v-else class="meta">{{ form.fieldCount.value }} fields</p>

    <section v-if="designedFields.length" class="designed">
      <h3 class="designed__title">Fields you added</h3>
      <ul class="designed__list">
        <li v-for="field in designedFields" :key="field.name" class="designed__item">
          <div class="designed__row">
            <input
              class="designed__name"
              :class="{ 'designed__name--invalid': !!errors[field.name], 'designed__name--saved': justSaved === field.name }"
              :value="nameFor(field.name)"
              spellcheck="false"
              aria-label="Field name"
              @input="onNameInput(field.name, ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
              @keydown.esc.prevent="cancelName(field.name); ($event.target as HTMLInputElement).blur()"
              @blur="commitName(field.name)"
            />
            <span class="designed__kind">{{ field.kind }} · p{{ field.pageIndex + 1 }}</span>
            <button class="btn btn--ghost btn--tiny" type="button" @click="removeDesignedField(field.name)">
              Remove
            </button>
          </div>
          <p v-if="errors[field.name]" class="designed__error">{{ errors[field.name] }}</p>
        </li>
      </ul>
      <p class="designed__note">
        Names are editable — this is the name the field gets in the downloaded PDF. Removing one here
        only removes it from the download, not from the preview.
      </p>
    </section>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 340px;
  flex: none;
  padding: 16px;
  background: #fff;
  border-left: 1px solid var(--border);
  overflow-y: auto;
}

.panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel__hint {
  margin: 4px 0 0;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--muted);
}

.editor {
  flex: 1;
  min-height: 320px;
  resize: vertical;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  color: #0f172a;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 8px;
  tab-size: 2;
}

.editor:focus {
  outline: 2px solid rgba(37, 99, 235, 0.35);
  outline-offset: -1px;
  background: #fff;
}

.editor--invalid {
  border-color: #f87171;
  background: #fef2f2;
}

.error {
  margin: 0;
  font-size: 11px;
  color: #b91c1c;
}

.meta {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}

.designed {
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.designed__title {
  margin: 0 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.designed__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.designed__row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 6px;
}

.designed__name {
  min-width: 0;
  padding: 3px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  color: var(--ink);
  background: #f8fafc;
  border: 1px solid transparent;
  border-radius: 5px;
}

.designed__name:hover {
  border-color: var(--border);
}

.designed__name:focus {
  outline: none;
  background: #fff;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.designed__name--invalid {
  border-color: #f87171;
  background: #fef2f2;
}

.designed__name--saved {
  border-color: #6ee7b7;
  background: #ecfdf5;
}

.designed__kind {
  color: var(--muted);
  font-size: 10.5px;
  white-space: nowrap;
}

.designed__error {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: #b91c1c;
}

.designed__note {
  margin: 8px 0 0;
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--muted);
}
</style>
