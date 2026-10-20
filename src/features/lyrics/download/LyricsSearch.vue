<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { invoke } from "@tauri-apps/api/core";
import { computed, onScopeDispose, ref, watch } from "vue";
import type { EditorTrack } from "@/features/metadata/types";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import { formatTrackDuration } from "@/features/tracks/format";
import { createLyricsSearch } from "@/features/lyrics/download/search";
import { searchQuery } from "@/features/lyrics/download/query";
import { createLyricsApi } from "@/features/lyrics/api";
import { createSettingsApi } from "@/features/settings/api";

const api = createLyricsApi(invoke);
const settingsApi = createSettingsApi(invoke);

const props = defineProps<{ track: EditorTrack; modified: boolean; disabled: boolean }>();
const emit = defineEmits<{ apply: [text: string]; mark: [] }>();
const searchDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const replaceDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const enabled = ref(false);
const pendingText = ref<string | null>(null);
const pendingMark = ref(false);
const preparing = ref(false);
let settingsGeneration = 0;
let alive = true;
const search = createLyricsSearch({
  search: api.search,
  preview: api.preview,
  automatic: api.automatic,
  apply: (text) => {
    if (!alive || props.disabled) return;
    pendingMark.value = false;
    if (props.modified) pendingText.value = text;
    else apply(text);
  },
  mark: () => {
    if (!alive || props.disabled) return;
    if (props.modified) {
      pendingMark.value = true;
      pendingText.value = "";
    } else mark();
  },
});
const state = search.state;
const busy = computed(() => props.disabled || !enabled.value || preparing.value || state.automatic);

async function loadSettings() {
  const generation = ++settingsGeneration;
  enabled.value = false;
  try {
    const settings = await settingsApi.get();
    if (!alive || generation !== settingsGeneration) return;
    enabled.value = settings.lyricsProviders.includes("netease");
    if (!enabled.value)
      notify({
        type: "warning",
        message: t("请先在设置中启用歌词来源。"),
        key: "lyrics-provider-disabled",
      });
  } catch (error) {
    if (alive && generation === settingsGeneration) {
      logger.warn("lyrics", "settings_failed", error);
      notify({
        type: "warning",
        message: t("读取歌词设置失败，请查看日志"),
        key: "lyrics-settings-failed",
      });
    }
  }
}
function closeSearch() {
  search.invalidate();
  searchDialog.value?.close();
}
function apply(text: string) {
  pendingText.value = null;
  replaceDialog.value?.close();
  closeSearch();
  emit("apply", text);
}
function mark() {
  if (typeof props.track.id === "string") {
    pendingText.value = null;
    closeSearch();
    notify({ type: "info", message: t("此曲目为纯音乐。"), key: "lyrics-instrumental" });
    return;
  }
  pendingText.value = null;
  pendingMark.value = false;
  replaceDialog.value?.close();
  closeSearch();
  emit("mark");
}
function confirmReplace() {
  if (pendingText.value === null || props.disabled) return;
  if (pendingMark.value) mark();
  else apply(pendingText.value);
}
async function withProvider(action: () => Promise<void>) {
  if (preparing.value || state.automatic || props.disabled) return;
  preparing.value = true;
  try {
    await loadSettings();
    if (alive && !props.disabled && enabled.value) await action();
  } finally {
    preparing.value = false;
  }
}
function openSearch() {
  return withProvider(async () => {
    search.reset(searchQuery(props.track));
    searchDialog.value?.showModal();
    await search.search();
  });
}
function automatic() {
  return withProvider(() => search.automatic(props.track.id));
}
watch(pendingText, (text) => {
  if (text !== null && !replaceDialog.value?.open) replaceDialog.value?.showModal();
  else if (text === null && replaceDialog.value?.open) replaceDialog.value.close();
});
globalThis.window?.addEventListener(SETTINGS_CHANGED_EVENT, loadSettings);
onScopeDispose(() => {
  alive = false;
  settingsGeneration++;
  search.invalidate();
  globalThis.window?.removeEventListener(SETTINGS_CHANGED_EVENT, loadSettings);
});
void loadSettings();
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      type="button"
      :disabled="busy"
      class="focus-visible:outline-app-accent rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      @click="automatic"
    >
      {{ state.automatic ? t("正在获取…") : t("自动获取") }}
    </button>
    <button
      type="button"
      :disabled="busy"
      class="focus-visible:outline-app-accent rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      @click="openSearch"
    >
      {{ t("手动搜索") }}
    </button>
  </div>

  <dialog
    ref="searchDialog"
    aria-labelledby="lyrics-search-title"
    class="bg-app-surface m-auto max-h-[90dvh] w-[min(64rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-5 text-white shadow-xl backdrop:bg-black/60"
    @cancel.prevent="closeSearch"
    @mousedown.stop
  >
    <h2 id="lyrics-search-title" class="mb-4 text-lg font-semibold">{{ t("搜索歌词") }}</h2>
    <form class="mb-4 flex flex-wrap gap-2" @submit.prevent="search.search()">
      <input
        v-model="state.query"
        autocomplete="off"
        :aria-label="t('歌词搜索关键词')"
        :placeholder="t('歌名、歌手或其他关键词')"
        type="text"
        maxlength="1024"
        autofocus
        class="focus-visible:outline-app-accent min-w-48 flex-1 rounded border border-white/20 bg-black/20 px-3 py-2 text-sm focus-visible:outline-2"
      />
      <select
        v-model="state.provider"
        :aria-label="t('歌词来源')"
        class="bg-app-interactive focus-visible:outline-app-accent rounded border border-white/20 px-3 py-2 text-sm focus-visible:outline-2"
      >
        <option :value="null">{{ t("所有已启用来源") }}</option>
        <option value="netease">{{ t("网易云音乐") }}</option>
      </select>
      <button
        type="submit"
        :disabled="state.searching || props.disabled"
        class="focus-visible:outline-app-accent rounded border border-white/20 px-4 py-2 text-sm focus-visible:outline-2 disabled:opacity-50"
      >
        {{ state.searching ? t("搜索中…") : t("搜索") }}
      </button>
    </form>
    <div class="grid gap-4 md:grid-cols-2">
      <div class="max-h-96 overflow-y-auto rounded border border-white/10">
        <p v-if="!state.searching && !state.candidates.length" class="text-app-muted p-3 text-sm">
          {{ t("暂无候选曲目") }}
        </p>
        <ul :aria-label="t('歌词候选曲目')">
          <li v-for="candidate in state.candidates" :key="`${candidate.provider}:${candidate.id}`">
            <button
              type="button"
              :aria-pressed="
                state.selected?.id === candidate.id &&
                state.selected?.provider === candidate.provider
              "
              :disabled="props.disabled"
              class="focus-visible:outline-app-accent w-full space-y-1 px-3 py-3 text-left text-sm hover:bg-white/10 focus-visible:outline-2"
              :class="state.selected?.id === candidate.id ? 'bg-white/10' : ''"
              @click="search.select(candidate)"
            >
              <span class="block font-semibold">{{ candidate.title }}</span>
              <span class="text-app-muted block"
                >{{ candidate.artists.join(" / ") }} · {{ candidate.album }}</span
              >
              <span class="text-app-muted block"
                >{{ formatTrackDuration(candidate.durationMs) ?? "-" }} ·
                {{ t("网易云音乐") }}</span
              >
            </button>
          </li>
        </ul>
        <button
          v-if="state.nextOffset !== null"
          type="button"
          :disabled="state.searching"
          class="focus-visible:outline-app-accent w-full px-3 py-3 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          @click="search.loadMore()"
        >
          {{ t("加载更多") }}
        </button>
      </div>
      <div class="min-w-0">
        <p v-if="state.previewing" role="status" class="mb-2 text-sm">{{ t("正在加载歌词…") }}</p>
        <textarea
          :value="state.preview"
          autocomplete="off"
          readonly
          :aria-label="t('候选歌词预览')"
          :placeholder="t('选择曲目以预览歌词')"
          class="focus-visible:outline-app-accent min-h-80 w-full resize-y rounded border border-white/10 bg-black/20 p-3 font-mono text-sm focus-visible:outline-2"
        />
      </div>
    </div>
    <footer class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
        @click="closeSearch"
      >
        {{ t("取消") }}
      </button>
      <button
        type="button"
        :disabled="
          props.disabled ||
          state.previewing ||
          (!state.preview.trim() && !state.previewInstrumental)
        "
        class="bg-app-accent focus-visible:outline-app-accent text-app-on-accent rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 disabled:opacity-50"
        @click="search.usePreview"
      >
        {{ state.previewInstrumental ? t("标记为无歌词") : t("使用此歌词") }}
      </button>
    </footer>
  </dialog>

  <dialog
    ref="replaceDialog"
    role="alertdialog"
    aria-labelledby="lyrics-replace-title"
    aria-describedby="lyrics-replace-description"
    class="bg-app-surface m-auto w-[min(24rem,calc(100vw-2rem))] max-w-none space-y-4 rounded-xl border border-white/10 p-5 text-white shadow-xl backdrop:bg-black/60"
    @cancel.prevent="pendingText = null"
    @mousedown.stop
  >
    <h2 id="lyrics-replace-title" class="text-lg font-semibold">{{ t("替换未保存的歌词？") }}</h2>
    <p id="lyrics-replace-description" class="text-app-muted text-sm">
      {{ t("文本框中的歌词修改将被替换，仍需保存才会写入文件。") }}
    </p>
    <footer class="flex justify-end gap-2">
      <button
        type="button"
        autofocus
        class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
        @click="pendingText = null"
      >
        {{ t("取消") }}
      </button>
      <button
        type="button"
        :disabled="props.disabled"
        class="bg-app-accent focus-visible:outline-app-accent text-app-on-accent rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 disabled:opacity-50"
        @click="confirmReplace"
      >
        {{ t("替换") }}
      </button>
    </footer>
  </dialog>
</template>
