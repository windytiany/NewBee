<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="metadata-editor-title"
    class="bg-app-surface m-auto max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="editor.requestClose()"
    @mousedown.stop
  >
    <header class="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
      <h2 id="metadata-editor-title" class="text-lg font-semibold">
        {{ state.mode === "album" ? "编辑专辑" : "编辑曲目" }}
      </h2>
      <span v-if="multiple" class="text-app-muted text-sm">{{ state.tracks.length }} 首曲目</span>
    </header>

    <div class="flex border-b border-white/10 px-5" role="tablist" aria-label="元数据编辑">
      <button
        v-if="singleTrack"
        id="metadata-tab-properties"
        ref="propertiesTab"
        type="button"
        role="tab"
        aria-controls="metadata-panel-properties"
        :aria-selected="activeTab === 'properties'"
        :tabindex="activeTab === 'properties' ? 0 : -1"
        :class="
          activeTab === 'properties'
            ? 'border-app-accent text-white'
            : 'text-app-muted border-transparent'
        "
        class="focus-visible:outline-app-accent border-b-2 px-5 py-3 text-sm hover:text-white focus-visible:outline-2"
        @click="activeTab = 'properties'"
        @keydown="onTabKeydown"
      >
        属性
      </button>
      <button
        id="metadata-tab-tags"
        ref="tagsTab"
        type="button"
        role="tab"
        aria-controls="metadata-panel-tags"
        :aria-selected="activeTab === 'tags'"
        :tabindex="activeTab === 'tags' ? 0 : -1"
        :class="
          activeTab === 'tags'
            ? 'border-app-accent text-white'
            : 'text-app-muted border-transparent'
        "
        class="focus-visible:outline-app-accent border-b-2 px-5 py-3 text-sm hover:text-white focus-visible:outline-2"
        @click="activeTab = 'tags'"
        @keydown="onTabKeydown"
      >
        标签
      </button>
      <button
        id="metadata-tab-lyrics"
        ref="lyricsTab"
        type="button"
        role="tab"
        aria-controls="metadata-panel-lyrics"
        :aria-selected="activeTab === 'lyrics'"
        :tabindex="activeTab === 'lyrics' ? 0 : -1"
        :class="
          activeTab === 'lyrics'
            ? 'border-app-accent text-white'
            : 'text-app-muted border-transparent'
        "
        class="focus-visible:outline-app-accent border-b-2 px-5 py-3 text-sm hover:text-white focus-visible:outline-2"
        @click="activeTab = 'lyrics'"
        @keydown="onTabKeydown"
      >
        歌词
      </button>
    </div>

    <div class="space-y-4 px-5 py-5">
      <p v-if="state.loading" role="status" class="text-app-muted text-sm">加载中…</p>

      <section
        v-if="singleTrack"
        v-show="activeTab === 'properties'"
        id="metadata-panel-properties"
        role="tabpanel"
        aria-labelledby="metadata-tab-properties"
      >
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-4 text-sm">
          <template v-for="property in properties" :key="property.label">
            <dt class="text-app-muted">{{ property.label }}</dt>
            <dd class="break-all">{{ property.value }}</dd>
          </template>
        </dl>
      </section>

      <section
        v-show="activeTab === 'tags'"
        id="metadata-panel-tags"
        role="tabpanel"
        aria-labelledby="metadata-tab-tags"
      >
        <div v-if="!state.loading && state.tracks.length" class="flex items-start gap-5">
          <TrackArtwork
            v-if="singleTrack"
            :track-id="singleTrack.id"
            class="hidden size-36 shrink-0 rounded-md sm:block"
            alt=""
          >
            <div class="bg-app-interactive h-full"></div>
          </TrackArtwork>
          <form
            id="metadata-editor-form"
            class="min-w-0 flex-1 space-y-4"
            @submit.prevent="editor.prepareSave()"
          >
            <div
              v-for="row in fieldRows"
              :key="row[0]?.key"
              class="grid gap-4"
              :class="row.length === 2 ? 'grid-cols-2' : 'grid-cols-1'"
            >
              <div
                v-for="(field, index) in row"
                :key="field.key"
                class="grid min-w-0 items-center gap-3"
                :class="
                  index === 1 ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-[5rem_minmax(0,1fr)]'
                "
              >
                <label :for="`metadata-${field.key}`" class="text-sm">{{
                  row.length === 2 && index === 1 ? "共" : field.label
                }}</label>
                <input
                  :id="`metadata-${field.key}`"
                  :aria-label="field.label"
                  :value="field.value"
                  :readonly="!field.writable"
                  :disabled="state.saving || state.confirmDiscard"
                  :placeholder="field.mixed ? '多个值' : ''"
                  :inputmode="field.type === 'number' ? 'numeric' : 'text'"
                  class="focus-visible:outline-app-accent w-full rounded border border-white/15 bg-black/20 px-3 py-2 text-sm read-only:text-white/50 focus-visible:outline-2 disabled:opacity-50"
                  type="text"
                  @input="editField(field, $event)"
                  @keydown="clearMixedValue(field, $event)"
                />
              </div>
            </div>
          </form>
        </div>
      </section>

      <section
        v-show="activeTab === 'lyrics'"
        id="metadata-panel-lyrics"
        role="tabpanel"
        aria-labelledby="metadata-tab-lyrics"
      >
        <div v-if="multiple" class="mb-4 space-y-2 text-sm">
          <label for="metadata-lyrics-action" class="block">无歌词标记</label>
          <select
            id="metadata-lyrics-action"
            :value="state.lyricsAction"
            :disabled="state.loading || state.saving || state.confirmDiscard"
            class="bg-app-surface focus-visible:outline-app-accent w-full rounded border border-white/15 px-3 py-2 focus-visible:outline-2 disabled:opacity-50"
            @change="changeLyricsAction"
          >
            <option value="keep">保持原样</option>
            <option value="mark">全部标记为“无歌词”</option>
            <option value="unmark">全部取消标记</option>
          </select>
        </div>
        <LyricsEditor
          v-if="state.open && singleTrack && lyricsField"
          :key="singleTrack.id"
          :track="singleTrack"
          :model-value="lyricsField.value"
          :original-value="lyricsField.originalValue"
          :writable="lyricsField.writable"
          :disabled="state.saving || state.confirmDiscard"
          input-id="metadata-lyrics"
          form="metadata-editor-form"
          @update:model-value="editor.changeField(lyricsField, $event)"
          @mark="editor.changeLyricsAction('mark')"
        >
          <template #mark>
            <label class="text-app-muted inline-flex shrink-0 items-center gap-2 text-xs">
              <input
                id="metadata-no-lyrics"
                type="checkbox"
                :checked="lyricsMarked"
                :disabled="state.loading || state.saving || state.confirmDiscard"
                class="accent-app-accent size-3.5"
                @change="toggleLyricsMark"
              />
              标记为无歌词
            </label>
          </template>
        </LyricsEditor>
      </section>

      <div v-if="state.saving" role="status" class="space-y-2 text-sm" aria-live="polite">
        <p>{{ multiple ? `正在保存 ${state.completed} / ${state.total}` : "保存中…" }}</p>
        <progress :value="state.completed" :max="state.total" class="w-full"></progress>
      </div>
    </div>

    <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        :disabled="state.saving"
        @click="editor.requestClose()"
      >
        取消
      </button>
      <button
        type="submit"
        form="metadata-editor-form"
        class="focus-visible:outline-app-accent bg-app-accent rounded px-5 py-2 text-sm font-semibold text-black focus-visible:outline-2 disabled:opacity-50"
        :disabled="!canSave"
      >
        保存
      </button>
    </footer>
  </dialog>

  <dialog
    ref="discardDialogElement"
    role="alertdialog"
    aria-labelledby="metadata-discard-title"
    aria-describedby="metadata-discard-description"
    class="bg-app-surface m-auto w-[min(24rem,calc(100vw-2rem))] max-w-none space-y-4 rounded-xl border border-white/10 p-5 text-white shadow-2xl backdrop:bg-black/50"
    @cancel.prevent="state.confirmDiscard = false"
    @mousedown.stop
  >
    <h2 id="metadata-discard-title" class="text-lg font-semibold">丢弃修改？</h2>
    <p id="metadata-discard-description" class="text-app-muted text-sm">未保存的修改将丢失。</p>
    <div class="flex justify-end gap-2">
      <button
        type="button"
        autofocus
        class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
        @click="state.confirmDiscard = false"
      >
        取消
      </button>
      <button
        type="button"
        class="focus-visible:outline-app-accent rounded bg-red-500 px-4 py-2 text-sm focus-visible:outline-2"
        @click="editor.close()"
      >
        丢弃
      </button>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useTagEditor } from "@/features/tags/manual/useEditor";
import type { DraftField, LyricsMarkAction, TagField } from "@/features/tags/types";
import TrackArtwork from "@/features/artwork/components/TrackArtwork.vue";
import { formatTrackDuration } from "@/features/library/format";
import { formatPathForDisplay } from "@/shared/filesystem/pathPresentation";
import LyricsEditor from "@/features/lyrics/components/LyricsEditor.vue";
import { useLyricsBatch } from "@/features/lyrics/download/batch";

const editor = useTagEditor();
const state = editor.state;
const batch = useLyricsBatch();
type EditorTab = "properties" | "tags" | "lyrics";
const activeTab = ref<EditorTab>("tags");
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const discardDialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const propertiesTab = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const tagsTab = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const lyricsTab = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const lyricsField = computed(() => state.draft.find((field) => field.key === "lyrics"));
const multiple = computed(() => state.tracks.length > 1);
const lyricsMarked = computed(
  () =>
    state.lyricsAction === "mark" ||
    (state.lyricsAction === "keep" &&
      !!state.tracks[0]?.noLyrics &&
      !lyricsField.value?.value.trim()),
);
const singleTrack = computed(() => (state.tracks.length === 1 ? state.tracks[0]?.track : null));
const properties = computed(() => {
  const track = singleTrack.value;
  if (!track) return [];
  return [
    { label: "位置", value: formatPathForDisplay(track.path) },
    { label: "时长", value: formatTrackDuration(track.durationMs) ?? "-" },
    { label: "编码", value: track.codec ?? "-" },
    { label: "采样率", value: track.sampleRateHz === null ? "-" : `${track.sampleRateHz} Hz` },
    { label: "码率", value: track.bitrateKbps === null ? "-" : `${track.bitrateKbps} kbps` },
    { label: "声道", value: track.channels ?? "-" },
  ];
});
const numberPairs = new Map<TagField, TagField>([
  ["trackNumber", "trackTotal"],
  ["discNumber", "discTotal"],
]);
const fieldRows = computed(() => {
  const rows: DraftField[][] = [];
  const grouped = new Set<TagField>();
  for (const field of state.draft) {
    if (field.key === "lyrics" || grouped.has(field.key)) continue;
    const row = [field];
    const totalKey = numberPairs.get(field.key);
    const total = state.draft.find((entry) => entry.key === totalKey);
    if (total) {
      row.push(total);
      grouped.add(total.key);
    }
    rows.push(row);
  }
  return rows;
});
const canSave = computed(
  () =>
    !state.loading &&
    !state.saving &&
    !batch.state.running &&
    !state.confirmDiscard &&
    state.tracks.length > 0 &&
    (state.lyricsAction !== "keep" || state.draft.some((field) => field.writable && !field.mixed)),
);
watch(
  () => [state.open, state.confirmDiscard],
  async () => {
    await nextTick();
    const dialog = dialogElement.value;
    const discardDialog = discardDialogElement.value;
    const confirmDiscard = state.open && state.confirmDiscard;
    if (!confirmDiscard && discardDialog?.open) discardDialog.close();
    if (state.open && !dialog?.open) {
      activeTab.value = "tags";
      dialog?.showModal();
    } else if (!state.open && dialog?.open) dialog.close();
    if (confirmDiscard && !discardDialog?.open) discardDialog?.showModal();
  },
  { immediate: true },
);
function changeLyricsAction(event: InstanceType<typeof globalThis.Event>) {
  const action = (event.target as InstanceType<typeof globalThis.HTMLSelectElement>).value;
  if (["keep", "mark", "unmark"].includes(action))
    editor.changeLyricsAction(action as LyricsMarkAction);
}
function toggleLyricsMark(event: InstanceType<typeof globalThis.Event>) {
  const checked = (event.target as InstanceType<typeof globalThis.HTMLInputElement>).checked;
  editor.changeLyricsAction(checked ? "mark" : "unmark");
}
function editField(field: DraftField, event: InstanceType<typeof globalThis.Event>) {
  editor.changeField(
    field,
    (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
  );
}
function clearMixedValue(field: DraftField, event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (!field.mixed || !field.writable || !["Backspace", "Delete"].includes(event.key)) return;
  event.preventDefault();
  editor.changeField(field, "");
}
function onTabKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  const tabs: EditorTab[] = singleTrack.value
    ? ["properties", "tags", "lyrics"]
    : ["tags", "lyrics"];
  const index = tabs.indexOf(activeTab.value);
  let nextIndex: number;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
  else return;
  event.preventDefault();
  activeTab.value = tabs[nextIndex] ?? "tags";
  const buttons = { properties: propertiesTab, tags: tagsTab, lyrics: lyricsTab };
  buttons[activeTab.value].value?.focus();
}
</script>
