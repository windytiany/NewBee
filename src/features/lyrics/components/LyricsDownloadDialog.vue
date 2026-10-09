<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useLyricsConfirmation } from "@/features/lyrics/download/confirmation";

const confirmation = useLyricsConfirmation();
const state = confirmation.state;
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
watch(
  () => state.open,
  async (open) => {
    await nextTick();
    const dialog = dialogElement.value;
    if (open && !dialog?.open) dialog?.showModal();
    else if (!open && dialog?.open) dialog.close();
  },
  { immediate: true },
);
function toggle(id: number, event: InstanceType<typeof globalThis.Event>) {
  confirmation.select(
    id,
    (event.target as InstanceType<typeof globalThis.HTMLInputElement>).checked,
  );
}
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="lyrics-download-title"
    class="bg-app-surface m-auto max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="confirmation.close()"
    @mousedown.stop
  >
    <header class="border-b border-white/10 px-5 py-4">
      <h2 id="lyrics-download-title" class="text-lg font-semibold">更新缺少的歌词</h2>
    </header>
    <div class="space-y-4 px-5 py-5">
      <p v-if="state.loading" role="status" class="text-app-muted text-sm">加载中…</p>
      <template v-if="!state.loading && !state.error">
        <div class="flex items-center gap-3 text-sm">
          <button
            type="button"
            class="focus-visible:outline-app-accent rounded px-2 py-1 hover:bg-white/10 focus-visible:outline-2"
            @click="confirmation.selectAll(true)"
          >
            全选
          </button>
          <button
            type="button"
            class="focus-visible:outline-app-accent rounded px-2 py-1 hover:bg-white/10 focus-visible:outline-2"
            @click="confirmation.selectAll(false)"
          >
            全不选
          </button>
          <span class="text-app-muted" aria-live="polite"
            >已选 {{ state.selected.length }} / {{ state.targets.length }} 首</span
          >
        </div>
        <div class="max-h-[50vh] overflow-y-auto rounded border border-white/10">
          <table class="w-full text-left text-sm">
            <thead class="bg-app-surface sticky top-0">
              <tr>
                <th scope="col" class="px-3 py-2">选择</th>
                <th scope="col" class="px-3 py-2">曲名</th>
                <th scope="col" class="px-3 py-2">歌手</th>
                <th scope="col" class="px-3 py-2">歌词状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="track in state.targets" :key="track.id" class="border-t border-white/10">
                <td class="px-3 py-2">
                  <input
                    type="checkbox"
                    :aria-label="`选择 ${track.title || '未知曲目'}`"
                    :checked="state.selected.includes(track.id)"
                    class="accent-app-accent"
                    @change="toggle(track.id, $event)"
                  />
                </td>
                <td class="px-3 py-2 break-words">{{ track.title || "未知曲目" }}</td>
                <td class="text-app-muted px-3 py-2 break-words">
                  {{ track.artist || "未知歌手" }}
                </td>
                <td class="px-3 py-2">
                  {{
                    track.noLyrics ? "已标记为无歌词" : track.hasLyrics ? "已有歌词" : "歌词缺失"
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
    <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        class="focus-visible:outline-app-accent rounded px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline-2"
        @click="confirmation.close()"
      >
        取消
      </button>
      <button
        type="button"
        :disabled="!confirmation.canConfirm.value"
        class="focus-visible:outline-app-accent bg-app-accent rounded px-5 py-2 text-sm font-semibold text-black focus-visible:outline-2 disabled:opacity-50"
        @click="confirmation.confirm()"
      >
        开始更新
      </button>
    </footer>
  </dialog>
</template>
