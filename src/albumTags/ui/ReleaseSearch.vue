<script setup lang="ts">
import { computed } from "vue";
import type { createAlbumTagEditor } from "@/albumTags/editor";
const props = defineProps<{ editor: ReturnType<typeof createAlbumTagEditor>; disabled: boolean }>();
const state = props.editor.state;
const candidates = computed(() =>
  [...state.candidates].sort((a, b) => {
    const rank = (candidate: typeof a) =>
      (candidate.title.toLocaleLowerCase() === state.album.trim().toLocaleLowerCase() ? 100 : 0) +
      (candidate.artist?.toLocaleLowerCase() === state.artist.trim().toLocaleLowerCase() ? 50 : 0) -
      Math.abs(candidate.trackCount - state.tracks.length);
    return rank(b) - rank(a);
  }),
);
</script>

<template>
  <section aria-label="搜索发行版本" class="space-y-3">
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="editor.search()">
      <label class="min-w-40 flex-1 space-y-1 text-sm"
        >专辑艺术家
        <input
          v-model="state.artist"
          :disabled="disabled || state.searching"
          class="mt-1 w-full rounded border border-white/15 bg-black/20 px-3 py-2"
        />
      </label>
      <label class="min-w-40 flex-1 space-y-1 text-sm"
        >专辑名
        <input
          v-model="state.album"
          :disabled="disabled || state.searching"
          class="mt-1 w-full rounded border border-white/15 bg-black/20 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        :disabled="disabled || state.searching"
        class="bg-spotify-green rounded px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
      >
        {{ state.searching ? "搜索中…" : "搜索" }}
      </button>
    </form>
    <form class="flex items-end gap-3" @submit.prevent="editor.loadDirect()">
      <label class="flex-1 text-sm"
        >MusicBrainz 发行版本链接或 ID
        <input
          v-model="state.directId"
          :disabled="disabled"
          placeholder="https://musicbrainz.org/release/…"
          class="mt-1 w-full rounded border border-white/15 bg-black/20 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        :disabled="disabled || state.loadingRelease"
        class="rounded border border-white/20 px-4 py-2 text-sm disabled:opacity-50"
      >
        加载
      </button>
    </form>
    <p class="text-spotify-muted text-xs">仅发送搜索条件，不上传音频、本地路径或文件名。</p>
    <div
      v-if="state.candidates.length"
      class="max-h-48 overflow-auto rounded border border-white/10"
    >
      <table class="w-full text-left text-sm">
        <thead class="bg-spotify-interactive sticky top-0">
          <tr>
            <th class="p-2">发行版本</th>
            <th>艺术家</th>
            <th>日期 / 国家</th>
            <th>介质 / 碟数 / 曲数</th>
            <th>状态</th>
            <th class="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="candidate in candidates"
            :key="candidate.id"
            :class="state.selected?.summary.id === candidate.id ? 'bg-white/10' : ''"
            class="border-t border-white/10"
          >
            <td class="p-2">
              {{ candidate.title
              }}<span v-if="candidate.disambiguation" class="text-spotify-muted block text-xs">{{
                candidate.disambiguation
              }}</span>
            </td>
            <td class="p-2">{{ candidate.artist ?? "—" }}</td>
            <td class="p-2 whitespace-nowrap">
              {{ candidate.releaseDate ?? "—" }} / {{ candidate.country ?? "—" }}
            </td>
            <td class="p-2">
              {{ candidate.formats.join(" + ") || "—" }} / {{ candidate.discCount }} 碟 /
              <span :class="candidate.trackCount !== state.tracks.length ? 'text-amber-200' : ''"
                >{{ candidate.trackCount }} 首</span
              >
            </td>
            <td class="p-2">{{ candidate.status ?? "—" }}</td>
            <td class="p-2">
              <button
                type="button"
                :disabled="disabled || state.loadingRelease"
                class="rounded px-3 py-1 hover:bg-white/10 disabled:opacity-50"
                @click="editor.selectRelease(candidate.id)"
              >
                选择
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="state.candidates.length" class="text-spotify-muted text-xs">
      已加载 {{ state.candidates.length }} / {{ state.count }} 个版本；本地
      {{ state.tracks.length }} 首。
    </p>
    <button
      v-if="state.offset + 25 < state.count"
      type="button"
      :disabled="disabled || state.searching"
      class="rounded border border-white/20 px-3 py-1 text-sm disabled:opacity-50"
      @click="editor.loadMore()"
    >
      加载更多
    </button>
    <p
      v-if="state.hasSearched && !state.searching && !state.candidates.length"
      role="status"
      class="text-spotify-muted text-sm"
    >
      没有找到发行版本，请调整搜索条件或输入发行版本链接。
    </p>
    <p v-if="state.loadingRelease" role="status" class="text-spotify-muted text-sm">
      正在加载发行版本…
    </p>
  </section>
</template>
