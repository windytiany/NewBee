<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="create-playlist-dialog-title"
    class="bg-spotify-surface m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="closeDialog"
    @cancel.prevent="closeDialog"
    @close="resetForm"
    @mousedown.stop
  >
    <form @submit.prevent="createPlaylist">
      <header class="border-b border-white/10 px-5 py-4">
        <h2 id="create-playlist-dialog-title" class="text-lg font-semibold">新建歌单</h2>
      </header>

      <div class="px-5 py-4">
        <label for="create-playlist-name" class="text-sm font-medium text-white/90">
          歌单名称
        </label>
        <input
          id="create-playlist-name"
          ref="nameInput"
          v-model="name"
          autofocus
          class="focus-visible:outline-spotify-green mt-2 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-2"
          :disabled="isCreating"
          :aria-invalid="invalidName || undefined"
          type="text"
          autocomplete="off"
          @input="invalidName = false"
        />
      </div>

      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-spotify-green rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isCreating"
          type="button"
          @click="closeDialog"
        >
          取消
        </button>
        <button
          class="bg-spotify-green focus-visible:outline-spotify-green rounded-full px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isCreating"
          type="submit"
        >
          {{ isCreating ? "正在创建…" : "确认" }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";
import { notify } from "@/notification/center";

const emit = defineEmits<{
  created: [playlistId: number];
}>();

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const nameInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(null);
const name = ref("");
const invalidName = ref(false);
const isCreating = ref(false);

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : "未知错误";
}

function show() {
  if (dialogElement.value?.open) return;

  name.value = "";
  invalidName.value = false;
  dialogElement.value?.showModal();
  nameInput.value?.focus();
}

function closeDialog() {
  if (isCreating.value) return;
  dialogElement.value?.close();
}

function resetForm() {
  name.value = "";
  invalidName.value = false;
}

async function createPlaylist() {
  if (isCreating.value) return;

  const trimmedName = name.value.trim();
  if (!trimmedName) {
    invalidName.value = true;
    notify({ type: "error", message: "歌单名称不能为空。", key: "playlist-name-validation" });
    nameInput.value?.focus();
    return;
  }

  isCreating.value = true;
  invalidName.value = false;
  try {
    const playlistId = await invoke<number>("create_playlist", { name: trimmedName });
    dialogElement.value?.close();
    emit("created", playlistId);
  } catch (cause) {
    notify({
      type: "error",
      message: `创建歌单失败：${errorMessage(cause)}`,
      key: "playlist-create",
    });
  } finally {
    isCreating.value = false;
  }
}

defineExpose({ show });
</script>
