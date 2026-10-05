<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, onScopeDispose, ref, watch } from "vue";
import type { TrackDetails } from "@/library/model";
import { SETTINGS_CHANGED_EVENT, type Settings } from "@/settings/types";
import { formatTrackDuration } from "@/library/formatTrack";
import { createLyricsSearch } from "@/lyricsDownload/search";
import { searchQuery } from "@/lyricsDownload/model";
import type { LyricsContent, LyricsSearchResults } from "@/lyricsDownload/model";

const props = defineProps<{ track: TrackDetails; modified: boolean; disabled: boolean }>();
const emit = defineEmits<{ apply: [text: string] }>();
const searchDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const replaceDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const enabled = ref(false);
const settingsError = ref("");
const pendingText = ref<string | null>(null);
const preparing = ref(false);
let settingsGeneration = 0;
let alive = true;
const search = createLyricsSearch({
  search: (query, provider, offset) =>
    invoke<LyricsSearchResults>("search_lyrics_candidates", { query, provider, offset }),
  preview: (candidate) =>
    invoke<LyricsContent>("get_candidate_lyrics", {
      provider: candidate.provider,
      candidateId: candidate.id,
    }),
  automatic: (trackId) => invoke<LyricsContent>("find_track_lyrics", { trackId }),
  apply: (text) => {
    if (!alive || props.disabled) return;
    if (props.modified) pendingText.value = text;
    else apply(text);
  },
});
const state = search.state;
const busy = computed(() => props.disabled || !enabled.value || preparing.value || state.automatic);

async function loadSettings() {
  const generation = ++settingsGeneration;
  settingsError.value = "";
  enabled.value = false;
  try {
    const settings = await invoke<Settings>("get_settings");
    if (!alive || generation !== settingsGeneration) return;
    enabled.value = settings.lyricsProviders.includes("netease");
    if (!enabled.value) settingsError.value = "请先在设置中启用歌词来源。";
  } catch (error) {
    if (alive && generation === settingsGeneration)
      settingsError.value = `读取歌词设置失败：${String(error)}`;
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
function confirmReplace() {
  if (pendingText.value !== null && !props.disabled) apply(pendingText.value);
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
  <div class="mb-3 space-y-2">
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        :disabled="busy"
        class="focus-visible:outline-spotify-green rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="automatic"
      >
        {{ state.automatic ? "正在获取…" : "自动获取" }}
      </button>
      <button
        type="button"
        :disabled="busy"
        class="focus-visible:outline-spotify-green rounded border border-white/20 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="openSearch"
      >
        手动搜索
      </button>
    </div>
    <p v-if="settingsError || state.error" role="status" class="text-sm text-amber-200">
      {{ settingsError || state.error }}
    </p>
  </div>

  <dialog
    ref="searchDialog"
    aria-labelledby="lyrics-search-title"
    class="bg-spotify-surface m-auto max-h-[90dvh] w-[min(64rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-5 text-white shadow-xl backdrop:bg-black/60"
    @cancel.prevent="closeSearch"
    @mousedown.stop
  >
    <h2 id="lyrics-search-title" class="mb-4 text-lg font-semibold">搜索歌词</h2>
    <form class="mb-4 flex flex-wrap gap-2" @submit.prevent="search.search()">
      <input
        v-model="state.query"
        aria-label="歌词搜索关键词"
        placeholder="歌名、歌手或其他关键词"
        type="text"
        maxlength="1024"
        autofocus
        class="focus-visible:outline-spotify-green min-w-48 flex-1 rounded border border-white/20 bg-black/20 px-3 py-2 text-sm focus-visible:outline-2"
      />
      <select
        v-model="state.provider"
        aria-label="歌词来源"
        class="bg-spotify-interactive focus-visible:outline-spotify-green rounded border border-white/20 px-3 py-2 text-sm focus-visible:outline-2"
      >
        <option :value="null">所有已启用来源</option>
        <option value="netease">网易云音乐</option>
      </select>
      <button
        type="submit"
        :disabled="state.searching || props.disabled"
        class="focus-visible:outline-spotify-green rounded border border-white/20 px-4 py-2 text-sm focus-visible:outline-2 disabled:opacity-50"
      >
        {{ state.searching ? "搜索中…" : "搜索" }}
      </button>
    </form>
    <p v-if="state.error" role="status" class="mb-3 text-sm text-amber-200">{{ state.error }}</p>
    <div class="grid gap-4 md:grid-cols-2">
      <div class="max-h-96 overflow-y-auto rounded border border-white/10">
        <ul aria-label="歌词候选曲目">
          <li v-for="candidate in state.candidates" :key="`${candidate.provider}:${candidate.id}`">
            <button
              type="button"
              :aria-pressed="
                state.selected?.id === candidate.id &&
                state.selected?.provider === candidate.provider
              "
              :disabled="props.disabled"
              class="focus-visible:outline-spotify-green w-full space-y-1 px-3 py-3 text-left text-sm hover:bg-white/10 focus-visible:outline-2"
              :class="state.selected?.id === candidate.id ? 'bg-white/10' : ''"
              @click="search.select(candidate)"
            >
              <span class="block font-semibold">{{ candidate.title }}</span>
              <span class="text-spotify-muted block"
                >{{ candidate.artists.join(" / ") }} · {{ candidate.album }}</span
              >
              <span class="text-spotify-muted block"
                >{{ formatTrackDuration(candidate.durationMs) ?? "-" }} · 网易云音乐</span
              >
            </button>
          </li>
        </ul>
        <button
          v-if="state.nextOffset !== null"
          type="button"
          :disabled="state.searching"
          class="focus-visible:outline-spotify-green w-full px-3 py-3 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          @click="search.loadMore()"
        >
          加载更多
        </button>
      </div>
      <div class="min-w-0">
        <p v-if="state.previewing" role="status" class="mb-2 text-sm">正在加载歌词…</p>
        <textarea
          :value="state.preview"
          readonly
          aria-label="候选歌词预览"
          placeholder="选择曲目以预览歌词"
          class="focus-visible:outline-spotify-green min-h-80 w-full resize-y rounded border border-white/10 bg-black/20 p-3 font-mono text-sm focus-visible:outline-2"
        />
      </div>
    </div>
    <footer class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        class="focus-visible:outline-spotify-green rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
        @click="closeSearch"
      >
        取消
      </button>
      <button
        type="button"
        :disabled="props.disabled || state.previewing || !state.preview.trim()"
        class="bg-spotify-green focus-visible:outline-spotify-green rounded px-4 py-2 text-sm font-semibold text-black focus-visible:outline-2 disabled:opacity-50"
        @click="search.usePreview"
      >
        使用此歌词
      </button>
    </footer>
  </dialog>

  <dialog
    ref="replaceDialog"
    role="alertdialog"
    aria-labelledby="lyrics-replace-title"
    aria-describedby="lyrics-replace-description"
    class="bg-spotify-surface m-auto w-[min(24rem,calc(100vw-2rem))] max-w-none space-y-4 rounded-xl border border-white/10 p-5 text-white shadow-xl backdrop:bg-black/60"
    @cancel.prevent="pendingText = null"
    @mousedown.stop
  >
    <h2 id="lyrics-replace-title" class="text-lg font-semibold">替换未保存的歌词？</h2>
    <p id="lyrics-replace-description" class="text-spotify-muted text-sm">
      文本框中的歌词修改将被替换，仍需保存才会写入文件。
    </p>
    <footer class="flex justify-end gap-2">
      <button
        type="button"
        autofocus
        class="focus-visible:outline-spotify-green rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
        @click="pendingText = null"
      >
        取消
      </button>
      <button
        type="button"
        :disabled="props.disabled"
        class="bg-spotify-green focus-visible:outline-spotify-green rounded px-4 py-2 text-sm font-semibold text-black focus-visible:outline-2 disabled:opacity-50"
        @click="confirmReplace"
      >
        替换
      </button>
    </footer>
  </dialog>
</template>
