<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="rename-playlist-dialog-title"
    class="bg-app-surface m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="cancelDialog"
    @cancel.prevent="cancelDialog"
    @mousedown.stop
  >
    <form @submit.prevent="renamePlaylist">
      <header class="border-b border-white/10 px-5 py-4">
        <h2 id="rename-playlist-dialog-title" class="text-lg font-semibold">
          {{ t("重命名歌单") }}
        </h2>
      </header>

      <div class="px-5 py-4">
        <label for="rename-playlist-name" class="text-sm font-medium text-white/90">
          {{ t("歌单名称") }}
        </label>
        <input
          id="rename-playlist-name"
          ref="nameInput"
          v-model="name"
          class="focus-visible:outline-app-accent mt-2 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-2"
          :aria-invalid="validationError ? 'true' : undefined"
          :disabled="props.isPending"
          type="text"
          autocomplete="off"
          @input="validationError = ''"
        />
      </div>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.isPending"
          type="button"
          @click="cancelDialog"
        >
          {{ t("取消") }}
        </button>
        <button
          class="bg-app-accent focus-visible:outline-app-accent rounded-full px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#fff] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="props.isPending"
          type="submit"
        >
          {{ props.isPending ? t("正在保存…") : t("确认") }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { ref } from "vue";
import type { PlaylistSummary } from "@/features/playlist/types";

const props = defineProps<{
  playlist: PlaylistSummary;
  isPending: boolean;
}>();

const emit = defineEmits<{
  confirm: [playlistId: number, name: string];
  cancel: [];
}>();

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const nameInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(null);
const name = ref("");
const validationError = ref("");

function show() {
  if (!dialogElement.value || dialogElement.value.open) return;

  name.value = props.playlist.name;
  validationError.value = "";
  dialogElement.value.showModal();
  nameInput.value?.focus();
  nameInput.value?.select();
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

function renamePlaylist() {
  if (props.isPending) return;

  const trimmedName = name.value.trim();
  if (!trimmedName) {
    validationError.value = t("请输入歌单名称");
    notify({ type: "warning", message: validationError.value, key: "playlist-name" });

    nameInput.value?.focus();
    return;
  }

  if (trimmedName === props.playlist.name) {
    cancelDialog();
    return;
  }

  emit("confirm", props.playlist.id, trimmedName);
}

defineExpose({ show, close });
</script>
