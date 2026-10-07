<template>
  <dialog
    ref="dialogElement"
    :aria-labelledby="`${dialogId}-title`"
    class="bg-app-surface m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @click.self="closeDialog"
    @cancel.prevent="closeDialog"
    @close="resetForm"
    @mousedown.stop
  >
    <form @submit.prevent="createPlaylist">
      <header class="border-b border-white/10 px-5 py-4">
        <h2 :id="`${dialogId}-title`" class="text-lg font-semibold">新建歌单</h2>
      </header>

      <div class="px-5 py-4">
        <label :for="`${dialogId}-name`" class="text-sm font-medium text-white/90">
          歌单名称
        </label>
        <input
          :id="`${dialogId}-name`"
          ref="nameInput"
          v-model="name"
          autofocus
          class="focus-visible:outline-app-accent mt-2 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-2"
          :disabled="isCreating || creation.playlistId.value !== null"
          :aria-invalid="invalidName || undefined"
          type="text"
          autocomplete="off"
          @input="invalidName = false"
        />
      </div>

      <p v-if="error" role="alert" class="px-5 pb-4 text-sm text-red-400">{{ error }}</p>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isCreating"
          type="button"
          @click="closeDialog"
        >
          取消
        </button>
        <button
          class="bg-app-accent focus-visible:outline-app-accent rounded-full px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
import { createPlaylistApi } from "@/features/playlist/api";
import { ref, useId } from "vue";
import { logger } from "@/shared/logging/logger";
import { usePlaylistCreation } from "@/features/playlist/composables/useCreation";

const dialogId = `create-playlist-${useId()}`;
const creation = usePlaylistCreation(createPlaylistApi(invoke));
let loadTrackIds: () => Promise<readonly number[]> = async () => [];

const emit = defineEmits<{
  created: [playlistId: number];
}>();

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const nameInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(null);
const name = ref("");
const error = ref("");
const invalidName = ref(false);
const isCreating = ref(false);

function show(loadTracks: () => Promise<readonly number[]> = async () => []) {
  if (dialogElement.value?.open || isCreating.value) return;

  creation.reset();
  loadTrackIds = loadTracks;
  name.value = "";
  invalidName.value = false;
  error.value = "";
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
  error.value = "";
}

async function createPlaylist() {
  if (isCreating.value) return;

  const trimmedName = name.value.trim();
  if (!trimmedName) {
    invalidName.value = true;
    error.value = "请输入歌单名称";
    nameInput.value?.focus();
    return;
  }

  isCreating.value = true;
  invalidName.value = false;
  error.value = "";
  try {
    const playlistId = await creation.create(trimmedName, loadTrackIds);
    dialogElement.value?.close();
    emit("created", playlistId);
  } catch (cause) {
    logger.error("playlist", "create_failed", cause);
    if (creation.playlistId.value === null) {
      error.value = "创建歌单失败，请重试或查看日志";
    } else {
      emit("created", creation.playlistId.value);
      error.value = `歌单已创建，已添加 ${creation.addedCount.value} 首，剩余歌曲添加失败，请重试或查看日志`;
    }
  } finally {
    isCreating.value = false;
  }
}

defineExpose({ show });
</script>
