<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { useLoudnessConfirmation } from "@/features/loudness/confirmation";
import { t } from "@/shared/i18n/locale";

const confirmation = useLoudnessConfirmation();
const state = confirmation.state;
const dialogElement = ref<globalThis.HTMLDialogElement | null>(null);
watch(
  state,
  async () => {
    await nextTick();
    const dialog = dialogElement.value;
    if (state.value && !dialog?.open) dialog?.showModal();
    else if (!state.value && dialog?.open) dialog.close();
  },
  { immediate: true },
);
onUnmounted(() => confirmation.resolve(false));
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="loudness-confirmation-title"
    aria-describedby="loudness-confirmation-message"
    class="bg-app-surface m-auto w-[min(30rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="confirmation.resolve(false)"
    @click.self="confirmation.resolve(false)"
    @mousedown.stop
  >
    <header class="border-b border-white/10 px-5 py-4">
      <h2 id="loudness-confirmation-title" class="text-lg font-semibold">
        {{ state ? t(state.title) : "" }}
      </h2>
    </header>
    <div class="px-5 py-4">
      <p id="loudness-confirmation-message" class="text-app-muted text-sm leading-6">
        {{ state ? t(state.message) : "" }}
      </p>
    </div>
    <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        autofocus
        class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2"
        @click="confirmation.resolve(false)"
      >
        {{ t("取消") }}
      </button>
      <button
        type="button"
        :disabled="!state"
        class="bg-app-accent focus-visible:outline-app-accent text-app-on-accent rounded-full px-5 py-2 text-sm font-semibold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        @click="confirmation.resolve(true)"
      >
        {{ t("确认") }}
      </button>
    </footer>
  </dialog>
</template>
