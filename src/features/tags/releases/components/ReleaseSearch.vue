<script setup lang="ts">
import { computed } from "vue";
import type { createReleaseEditor } from "@/features/tags/releases/useEditor";
const props = defineProps<{ editor: ReturnType<typeof createReleaseEditor>; disabled: boolean }>();
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
function scrollResult(event: InstanceType<typeof globalThis.WheelEvent>) {
  if (event.ctrlKey || event.deltaY === 0) return;
  const viewport = event.currentTarget as InstanceType<typeof globalThis.HTMLDivElement>;
  const height = viewport.querySelector("[data-release-row]")?.getBoundingClientRect().height;
  if (!height) return;
  event.preventDefault();
  event.stopPropagation();
  const position = viewport.scrollTop / height;
  const next = (event.deltaY > 0 ? Math.floor(position) + 1 : Math.ceil(position) - 1) * height;
  viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, next));
}
</script>

<template>
  <section aria-label="搜索发行版本" class="space-y-1">
    <form
      class="grid grid-cols-[1fr_1fr_80px] items-center gap-[8px]"
      @submit.prevent="editor.search()"
    >
      <label class="text-app-muted flex min-w-0 items-center gap-2 text-xs whitespace-nowrap">
        <span class="shrink-0">专辑艺术家</span>
        <input
          v-model="state.artist"
          :disabled="disabled || state.searching"
          autofocus
          class="focus:border-app-accent h-6 w-full min-w-0 rounded border border-white/15 bg-black/20 px-2 text-xs text-white focus:outline-none"
        />
      </label>
      <label class="text-app-muted flex min-w-0 items-center gap-2 text-xs whitespace-nowrap">
        <span class="shrink-0">专辑</span>
        <input
          v-model="state.album"
          :disabled="disabled || state.searching"
          class="focus:border-app-accent h-6 w-full min-w-0 rounded border border-white/15 bg-black/20 px-2 text-xs text-white focus:outline-none"
        />
      </label>
      <button
        type="submit"
        :disabled="disabled || state.searching"
        class="bg-app-accent h-6 rounded px-3 text-xs font-semibold text-black disabled:opacity-50"
      >
        {{ state.searching ? "查找中…" : "查找" }}
      </button>
    </form>
    <div
      class="box-content h-[164px] max-h-[28dvh] overflow-auto overscroll-contain rounded border border-white/10"
      :aria-busy="state.searching"
      @wheel="scrollResult"
    >
      <table class="w-full min-w-[760px] table-fixed text-left text-xs leading-[18px]">
        <thead class="bg-app-interactive text-app-muted sticky top-0 z-10 leading-[16px]">
          <tr class="h-[24px]">
            <th class="w-[110px] truncate px-2 font-normal">状态 / 介质</th>
            <th class="w-[54px] truncate px-2 font-normal">国家</th>
            <th class="w-[90px] truncate px-2 font-normal">日期</th>
            <th class="truncate px-2 font-normal">专辑</th>
            <th class="w-[116px] truncate px-2 font-normal">专辑艺术家</th>
            <th class="w-[88px] truncate px-2 font-normal">碟 / 曲目</th>
            <th class="w-[104px] truncate px-2 font-normal">源</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="candidate in candidates"
            :key="candidate.id"
            data-release-row
            :aria-selected="state.selected?.summary.id === candidate.id"
            :class="
              state.selected?.summary.id === candidate.id
                ? 'bg-app-accent/15 text-white'
                : 'hover:bg-white/5'
            "
            class="h-[28px] cursor-pointer border-t border-white/5"
            @click="!disabled && !state.loadingRelease && editor.selectRelease(candidate.id)"
          >
            <td
              class="truncate px-2"
              :title="[candidate.status, ...candidate.formats].filter(Boolean).join(' · ')"
            >
              {{ [candidate.status, ...candidate.formats].filter(Boolean).join(" · ") || "—" }}
            </td>
            <td class="truncate px-2" :title="candidate.country ?? ''">
              {{ candidate.country ?? "—" }}
            </td>
            <td class="truncate px-2" :title="candidate.releaseDate ?? ''">
              {{ candidate.releaseDate ?? "—" }}
            </td>
            <td class="px-2">
              <button
                type="button"
                :disabled="disabled || state.loadingRelease"
                :aria-pressed="state.selected?.summary.id === candidate.id"
                :title="[candidate.title, candidate.disambiguation].filter(Boolean).join(' · ')"
                class="block w-full truncate text-left hover:underline disabled:opacity-50"
                @click.stop="editor.selectRelease(candidate.id)"
              >
                {{ candidate.title
                }}<span v-if="candidate.disambiguation" class="text-app-muted ml-1"
                  >({{ candidate.disambiguation }})</span
                >
              </button>
            </td>
            <td class="truncate px-2" :title="candidate.artist ?? ''">
              {{ candidate.artist ?? "—" }}
            </td>
            <td
              class="truncate px-2"
              :class="candidate.trackCount !== state.tracks.length ? 'text-amber-200' : ''"
            >
              {{ candidate.discCount }} / {{ candidate.trackCount }}
            </td>
            <td class="text-app-muted truncate px-2" title="MusicBrainz">MusicBrainz</td>
          </tr>
          <tr v-if="!candidates.length && (state.searching || state.hasSearched)">
            <td colspan="7" role="status" class="text-app-muted px-2 py-2 text-center">
              {{ state.searching ? "查找中…" : "无结果" }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="text-app-muted flex items-center justify-between gap-2 text-xs">
      <p role="status">
        {{ state.loadingRelease ? "加载中…" : `本地 ${state.tracks.length} 首`
        }}<span v-if="state.hasSearched"> · {{ state.candidates.length }} / {{ state.count }}</span>
      </p>
      <button
        v-if="state.offset + 25 < state.count"
        type="button"
        :disabled="disabled || state.searching"
        class="text-white hover:underline disabled:opacity-50"
        @click="editor.loadMore()"
      >
        更多
      </button>
      <details class="relative ml-auto">
        <summary class="cursor-pointer hover:text-white">链接 / ID</summary>
        <form
          class="bg-app-surface absolute top-full right-0 z-20 mt-1 flex gap-1 rounded border border-white/15 p-2 shadow-xl"
          @submit.prevent="editor.loadDirect()"
        >
          <input
            v-model="state.directId"
            aria-label="MusicBrainz 发行版本链接或 ID"
            :disabled="disabled || state.loadingRelease"
            placeholder="https://musicbrainz.org/release/…"
            class="w-64 rounded border border-white/15 bg-black/20 px-2 py-1 text-white"
          />
          <button
            type="submit"
            :disabled="disabled || state.loadingRelease"
            class="rounded border border-white/15 px-2 py-1 text-white disabled:opacity-50"
          >
            加载
          </button>
        </form>
      </details>
    </div>
  </section>
</template>
