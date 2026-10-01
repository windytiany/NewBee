<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="delete-album-dialog-title"
    aria-describedby="delete-album-dialog-description"
    class="bg-spotify-surface m-auto w-[min(30rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="cancel"
    @cancel.prevent="cancel"
    @mousedown.stop
  >
    <section>
      <header class="border-b border-white/10 px-5 py-4">
        <h2 id="delete-album-dialog-title" class="text-lg font-semibold">从曲库中删除专辑</h2>
      </header>
      <div class="px-5 py-4">
        <p class="font-medium">{{ album.album ?? "未知专辑" }}</p>
        <p class="text-spotify-muted mt-1 text-sm">{{ album.albumArtist ?? "未知演出者" }}</p>
        <p id="delete-album-dialog-description" class="text-spotify-muted mt-3 text-sm leading-6">
          删除此专辑的全部曲目索引，不删除磁盘文件；会从所有歌单和当前队列移除；重新扫描可再次收录。
        </p>
        <p v-if="error" class="mt-3 text-sm text-red-300" role="alert">{{ error }}</p>
      </div>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-spotify-green rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="pending"
          type="button"
          @click="cancel"
        >
          取消
        </button>
        <button
          class="focus-visible:outline-spotify-green rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white hover:bg-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="pending"
          type="button"
          @click="confirm"
        >
          {{ pending ? "正在删除…" : "确认删除" }}
        </button>
      </footer>
    </section>
  </dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { LibraryAlbumSelection } from "@/library/selection";
const props = defineProps<{ album: LibraryAlbumSelection; pending: boolean; error: string }>();
const emit = defineEmits<{ confirm: [album: LibraryAlbumSelection]; cancel: [] }>();
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
function show() {
  if (!dialogElement.value?.open) dialogElement.value?.showModal();
}
function close() {
  if (dialogElement.value?.open) dialogElement.value.close();
}
function cancel() {
  if (props.pending) return;
  close();
  emit("cancel");
}
function confirm() {
  if (!props.pending) emit("confirm", props.album);
}
defineExpose({ show, close });
</script>
