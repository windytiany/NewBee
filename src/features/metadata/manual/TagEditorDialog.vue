<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="metadata-editor-title"
    class="bg-app-surface m-auto h-[min(37rem,90vh)] w-[min(48rem,calc(100vw-2rem))] max-w-none grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-white/15 p-0 text-white shadow-2xl backdrop:bg-black/70 open:grid"
    @cancel.prevent="requestClose"
    @mousedown.stop
  >
    <header class="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
      <h2 id="metadata-editor-title" class="text-lg font-semibold">
        {{ state.mode === "album" ? t("编辑专辑") : t("编辑曲目") }}
      </h2>
      <span v-if="multiple" class="text-app-muted text-sm">{{
        t("{count} 首曲目", { count: state.tracks.length })
      }}</span>
    </header>

    <div class="flex border-b border-white/10 px-5" role="tablist" :aria-label="t('元数据编辑')">
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
        {{ t("属性") }}
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
        {{ t("标签") }}
      </button>
      <button
        id="metadata-tab-additional"
        ref="additionalTab"
        type="button"
        role="tab"
        aria-controls="metadata-panel-additional"
        :aria-selected="activeTab === 'additional'"
        :tabindex="activeTab === 'additional' ? 0 : -1"
        :class="
          activeTab === 'additional'
            ? 'border-app-accent text-white'
            : 'text-app-muted border-transparent'
        "
        class="focus-visible:outline-app-accent border-b-2 px-5 py-3 text-sm hover:text-white focus-visible:outline-2"
        @click="activeTab = 'additional'"
        @keydown="onTabKeydown"
      >
        {{ t("更多标签") }}
      </button>
      <button
        id="metadata-tab-artwork"
        ref="artworkTab"
        type="button"
        role="tab"
        aria-controls="metadata-panel-artwork"
        :aria-selected="activeTab === 'artwork'"
        :tabindex="activeTab === 'artwork' ? 0 : -1"
        :class="
          activeTab === 'artwork'
            ? 'border-app-accent text-white'
            : 'text-app-muted border-transparent'
        "
        class="focus-visible:outline-app-accent border-b-2 px-5 py-3 text-sm hover:text-white focus-visible:outline-2"
        @click="activeTab = 'artwork'"
        @keydown="onTabKeydown"
      >
        {{ t("封面") }}
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
        {{ t("歌词") }}
      </button>
    </div>

    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-5">
      <p v-if="state.loading" role="status" class="text-app-muted text-sm">{{ t("加载中…") }}</p>

      <PropertiesPanel
        v-if="singleTrack"
        v-show="activeTab === 'properties'"
        :track="singleTrack"
      />

      <form
        v-show="activeTab === 'tags' || activeTab === 'additional'"
        id="metadata-editor-form"
        autocomplete="off"
        @submit.prevent="prepareSave"
      >
        <FieldsPanel
          v-for="tab in fieldTabs"
          v-show="activeTab === tab"
          :key="tab"
          :tab="tab"
          :draft="state.draft"
          :mode="state.mode"
          :ready="!state.loading && state.tracks.length > 0"
          :open="state.open"
          :disabled="state.saving || state.confirmDiscard"
          :preview-disabled="
            state.saving ||
            state.confirmDiscard ||
            selectingArtwork ||
            state.importingArtwork ||
            activeTab !== 'tags'
          "
          :display="displayPicture"
          @change="editor.changeField"
          @failed="editor.artworkSelectionFailed"
        />
      </form>

      <section
        v-show="activeTab === 'artwork'"
        id="metadata-panel-artwork"
        role="tabpanel"
        aria-labelledby="metadata-tab-artwork"
      >
        <CollectionEditor
          v-if="state.open && !state.loading"
          :draft="state.artwork"
          :pictures="pictures"
          :display="displayPicture"
          :ready="artworkReady"
          :disabled="state.saving || state.confirmDiscard || activeTab !== 'artwork'"
          :importing="state.importingArtwork"
          :add-picture="editor.addPicture"
          @type="editor.changePictureType"
          @delete="editor.deletePicture"
          @display="editor.setDisplayPicture"
          @failed="editor.artworkSelectionFailed"
          @busy="selectingArtwork = $event"
        />
      </section>
      <p v-if="state.error" role="alert" class="text-sm text-red-400">{{ state.error }}</p>
      <section
        v-show="activeTab === 'lyrics'"
        id="metadata-panel-lyrics"
        :class="singleTrack ? 'flex min-h-0 flex-1 flex-col' : undefined"
        role="tabpanel"
        aria-labelledby="metadata-tab-lyrics"
      >
        <div
          v-if="multiple && state.tracks.every(({ track }) => typeof track.id === 'number')"
          class="mb-4 space-y-2 text-sm"
        >
          <label for="metadata-lyrics-action" class="block">{{ t("无歌词标记") }}</label>
          <select
            id="metadata-lyrics-action"
            :value="state.lyricsAction"
            :disabled="state.loading || state.saving || state.confirmDiscard"
            class="bg-app-surface focus-visible:outline-app-accent w-full rounded border border-white/15 px-3 py-2 focus-visible:outline-2 disabled:opacity-50"
            @change="changeLyricsAction"
          >
            <option value="keep">{{ t("保持原样") }}</option>
            <option value="mark">{{ t("全部标记为“无歌词”") }}</option>
            <option value="unmark">{{ t("全部取消标记") }}</option>
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
            <label
              v-if="typeof singleTrack.id === 'number'"
              class="text-app-muted inline-flex shrink-0 items-center gap-2 text-xs"
            >
              <input
                id="metadata-no-lyrics"
                type="checkbox"
                :checked="lyricsMarked"
                :disabled="state.loading || state.saving || state.confirmDiscard"
                class="accent-app-accent size-3.5"
                @change="toggleLyricsMark"
              />
              {{ t("标记为无歌词") }}
            </label>
          </template>
        </LyricsEditor>
      </section>

      <div v-if="state.saving" role="status" class="space-y-2 text-sm" aria-live="polite">
        <p>
          {{
            multiple
              ? t("正在保存 {count} / {total}", { count: state.completed, total: state.total })
              : t("保存中…")
          }}
        </p>
        <progress :value="state.completed" :max="state.total" class="w-full"></progress>
      </div>
    </div>

    <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        :disabled="state.saving || state.importingArtwork || selectingArtwork"
        @click="requestClose"
      >
        {{ t("取消") }}
      </button>
      <button
        type="submit"
        form="metadata-editor-form"
        class="focus-visible:outline-app-accent bg-app-accent text-app-on-accent rounded px-5 py-2 text-sm font-semibold focus-visible:outline-2 disabled:opacity-50"
        :disabled="!canSave"
      >
        {{ t("保存") }}
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
    <h2 id="metadata-discard-title" class="text-lg font-semibold">{{ t("丢弃修改？") }}</h2>
    <p id="metadata-discard-description" class="text-app-muted text-sm">
      {{ t("未保存的修改将丢失。") }}
    </p>
    <div class="flex justify-end gap-2">
      <button
        type="button"
        autofocus
        class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
        @click="state.confirmDiscard = false"
      >
        {{ t("取消") }}
      </button>
      <button
        type="button"
        class="focus-visible:outline-app-accent rounded bg-red-500 px-4 py-2 text-sm focus-visible:outline-2"
        @click="editor.close()"
      >
        {{ t("丢弃") }}
      </button>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, nextTick, ref, watch } from "vue";
import { useTagEditor } from "@/features/metadata/manual/useEditor";
import type { LyricsMarkAction } from "@/features/metadata/types";
import PropertiesPanel from "@/features/metadata/manual/PropertiesPanel.vue";
import FieldsPanel from "@/features/metadata/manual/FieldsPanel.vue";
import CollectionEditor from "@/features/artwork/collection/CollectionEditor.vue";
import { collectionChanged } from "@/features/artwork/collection/model";
import LyricsEditor from "@/features/lyrics/LyricsEditor.vue";
import { useLyricsBatch } from "@/features/lyrics/download/batch";

const editor = useTagEditor();
const state = editor.state;
const { artworkReady, pictures, displayPicture } = editor;
const selectingArtwork = ref(false);
const batch = useLyricsBatch();
const fieldTabs = ["tags", "additional"] as const;
type EditorTab = "properties" | (typeof fieldTabs)[number] | "lyrics" | "artwork";
const activeTab = ref<EditorTab>("tags");
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const discardDialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const propertiesTab = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const tagsTab = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const additionalTab = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
const artworkTab = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);
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
const canSave = computed(
  () =>
    !state.loading &&
    !state.saving &&
    !state.importingArtwork &&
    !selectingArtwork.value &&
    !batch.state.running &&
    !state.confirmDiscard &&
    state.tracks.length > 0 &&
    ((artworkReady.value && state.artwork.tracks.some(collectionChanged)) ||
      state.lyricsAction !== "keep" ||
      state.draft.some((field) => field.writable && !field.mixed)),
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
function prepareSave() {
  if (canSave.value) editor.prepareSave();
}
function requestClose() {
  if (!selectingArtwork.value) editor.requestClose();
}
function changeLyricsAction(event: InstanceType<typeof globalThis.Event>) {
  const action = (event.target as InstanceType<typeof globalThis.HTMLSelectElement>).value;
  if (["keep", "mark", "unmark"].includes(action))
    editor.changeLyricsAction(action as LyricsMarkAction);
}
function toggleLyricsMark(event: InstanceType<typeof globalThis.Event>) {
  const checked = (event.target as InstanceType<typeof globalThis.HTMLInputElement>).checked;
  editor.changeLyricsAction(checked ? "mark" : "unmark");
}
function onTabKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  const tabs: EditorTab[] = singleTrack.value
    ? ["properties", "tags", "additional", "artwork", "lyrics"]
    : ["tags", "additional", "artwork", "lyrics"];
  const index = tabs.indexOf(activeTab.value);
  let nextIndex: number;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
  else return;
  event.preventDefault();
  activeTab.value = tabs[nextIndex] ?? "tags";
  const buttons = {
    properties: propertiesTab,
    tags: tagsTab,
    additional: additionalTab,
    lyrics: lyricsTab,
    artwork: artworkTab,
  };
  buttons[activeTab.value].value?.focus();
}
</script>
