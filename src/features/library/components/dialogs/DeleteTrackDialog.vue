<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="delete-track-dialog-title"
    aria-describedby="delete-track-dialog-description"
    class="bg-app-surface m-auto w-[min(30rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="cancelDialog"
    @cancel.prevent="cancelDialog"
    @mousedown.stop
  >
    <section>
      <header class="border-b border-white/10 px-5 py-4">
        <h2 id="delete-track-dialog-title" class="text-lg font-semibold">从曲库中删除曲目</h2>
      </header>

      <div class="px-5 py-4">
        <p class="font-medium">{{ props.track.title ?? "未知曲目" }}</p>
        <p id="delete-track-dialog-description" class="text-app-muted mt-3 text-sm leading-6">
          不删除磁盘文件；会从所有歌单和当前队列移除；重新扫描可再次收录。
        </p>
      </div>

      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.isDeleting"
          type="button"
          @click="cancelDialog"
        >
          取消
        </button>
        <button
          class="focus-visible:outline-app-accent rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.isDeleting"
          type="button"
          @click="confirmDeletion"
        >
          {{ props.isDeleting ? "正在删除…" : "确认删除" }}
        </button>
      </footer>
    </section>
  </dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { TrackSummary } from "@/features/library/types";

const props = defineProps<{
  track: TrackSummary;
  isDeleting: boolean;
}>();

const emit = defineEmits<{
  confirm: [trackId: number];
  cancel: [];
}>();

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);

function show() {
  if (!dialogElement.value?.open) dialogElement.value?.showModal();
}

function close() {
  if (dialogElement.value?.open) dialogElement.value.close();
}

function cancelDialog() {
  if (props.isDeleting) return;
  close();
  emit("cancel");
}

function confirmDeletion() {
  if (props.isDeleting) return;
  emit("confirm", props.track.id);
}

defineExpose({ show, close });
</script>
