<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="delete-playlist-dialog-title"
    aria-describedby="delete-playlist-dialog-description"
    class="bg-app-surface m-auto w-[min(30rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="cancelDialog"
    @cancel.prevent="cancelDialog"
    @mousedown.stop
  >
    <section>
      <header class="border-b border-white/10 px-5 py-4">
        <h2 id="delete-playlist-dialog-title" class="text-lg font-semibold">删除歌单</h2>
      </header>

      <div class="px-5 py-4">
        <p class="font-medium">{{ props.playlist.name }}</p>
        <p id="delete-playlist-dialog-description" class="text-app-muted mt-3 text-sm leading-6">
          删除此歌单无法撤销。不会删除曲库歌曲或磁盘文件，也不会改变当前播放队列。
        </p>
      </div>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          ref="cancelButton"
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.isPending"
          type="button"
          @click="cancelDialog"
        >
          取消
        </button>
        <button
          class="focus-visible:outline-app-accent rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.isPending"
          type="button"
          @click="confirmDeletion"
        >
          {{ props.isPending ? "正在删除…" : "确认删除" }}
        </button>
      </footer>
    </section>
  </dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { PlaylistSummary } from "@/features/playlist/types";

const props = defineProps<{
  playlist: PlaylistSummary;
  isPending: boolean;
}>();

const emit = defineEmits<{
  confirm: [playlistId: number];
  cancel: [];
}>();

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const cancelButton = ref<InstanceType<typeof globalThis.HTMLButtonElement> | null>(null);

function show() {
  if (!dialogElement.value || dialogElement.value.open) return;

  dialogElement.value.showModal();
  cancelButton.value?.focus();
}

function close() {
  if (props.isPending) return;
  if (dialogElement.value?.open) dialogElement.value.close();
}

function cancelDialog() {
  if (props.isPending) return;
  close();
  emit("cancel");
}

function confirmDeletion() {
  if (props.isPending) return;
  emit("confirm", props.playlist.id);
}

defineExpose({ show, close });
</script>
