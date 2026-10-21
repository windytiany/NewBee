<template>
  <section :id="`metadata-panel-${tab}`" role="tabpanel" :aria-labelledby="`metadata-tab-${tab}`">
    <div v-if="ready" class="flex items-start gap-5">
      <ArtworkPreview
        v-if="tab === 'tags' && open"
        :selection="display"
        :disabled="previewDisabled"
        exportable
        export-menu
        class="w-36 shrink-0"
        @failed="emit('failed', $event)"
      />
      <div class="min-w-0 flex-1 space-y-4">
        <div
          v-for="row in rows[tab]"
          :key="row[0]?.key"
          class="grid gap-4"
          :class="row.length === 2 ? 'grid-cols-2' : 'grid-cols-1'"
        >
          <div
            v-for="(field, index) in row"
            :key="field.key"
            class="grid min-w-0 items-center gap-3"
            :class="
              tab === 'additional'
                ? 'grid-cols-[11rem_minmax(0,1fr)]'
                : index === 1
                  ? 'grid-cols-[auto_minmax(0,1fr)]'
                  : 'grid-cols-[5rem_minmax(0,1fr)]'
            "
          >
            <label :for="`metadata-${field.key}`" class="text-sm whitespace-nowrap">{{
              index === 1 && mode !== "album" ? t("共") : t(field.label)
            }}</label>
            <input
              :id="`metadata-${field.key}`"
              autocomplete="off"
              :aria-label="t(field.label)"
              :value="field.value"
              :readonly="!field.writable"
              :disabled="disabled"
              :placeholder="field.mixed ? t('多个值') : ''"
              :inputmode="field.type === 'number' ? 'numeric' : 'text'"
              class="focus-visible:outline-app-accent w-full rounded border border-white/15 bg-black/20 px-3 py-2 text-sm read-only:text-white/50 focus-visible:outline-2 disabled:opacity-50"
              type="text"
              @input="editField(field, $event)"
              @keydown="clearMixedValue(field, $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/shared/i18n/locale";
import type { DraftField, TagField, EditMode } from "@/features/metadata/types";
import type { DisplaySelection } from "@/features/artwork/collection/types";
import ArtworkPreview from "@/features/artwork/collection/ArtworkPreview.vue";
const props = defineProps<{
  tab: "tags" | "additional";
  draft: DraftField[];
  mode: EditMode;
  ready: boolean;
  open: boolean;
  disabled: boolean;
  previewDisabled: boolean;
  display: DisplaySelection;
}>();
const emit = defineEmits<{
  change: [field: DraftField, value: string];
  failed: [error: unknown];
}>();
const numberPairs = new Map<TagField, TagField>([
  ["trackNumber", "trackTotal"],
  ["discNumber", "discTotal"],
]);
const additionalFields = new Set<TagField>([
  "artistSort",
  "albumArtistSort",
  "discSubtitle",
  "label",
  "originalReleaseDate",
]);
const rows = computed(() => {
  const rows: Record<"tags" | "additional", DraftField[][]> = { tags: [], additional: [] };
  const grouped = new Set<TagField>();
  for (const field of props.draft) {
    if (field.key === "lyrics" || grouped.has(field.key)) continue;
    const row = [field];
    const pairedKey =
      props.mode === "album" && field.key === "trackTotal"
        ? "discTotal"
        : numberPairs.get(field.key);
    const paired = props.draft.find((entry) => entry.key === pairedKey);
    if (paired) {
      row.push(paired);
      grouped.add(paired.key);
    }
    rows[additionalFields.has(field.key) ? "additional" : "tags"].push(row);
  }
  return rows;
});
function editField(field: DraftField, event: InstanceType<typeof globalThis.Event>) {
  emit("change", field, (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value);
}
function clearMixedValue(field: DraftField, event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (!field.mixed || !field.writable || !["Backspace", "Delete"].includes(event.key)) return;
  event.preventDefault();
  emit("change", field, "");
}
</script>
