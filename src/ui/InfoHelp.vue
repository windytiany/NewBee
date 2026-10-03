<template>
  <button
    type="button"
    :aria-label="props.label"
    aria-haspopup="dialog"
    :aria-expanded="isOpen"
    :aria-controls="isOpen ? dialogId : undefined"
    class="focus-visible:outline-spotify-green text-spotify-muted inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/10 hover:text-white focus-visible:outline-2"
    @click="show"
  >
    <Info aria-hidden="true" class="size-4" />
  </button>
  <dialog
    v-if="isOpen"
    :id="dialogId"
    ref="dialogElement"
    :aria-labelledby="`${dialogId}-title`"
    class="bg-spotify-surface m-auto max-h-[80vh] w-[min(28rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/50"
    @cancel.prevent="close"
    @close="isOpen = false"
    @click.self="close"
    @mousedown.stop
  >
    <header class="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
      <h2 :id="`${dialogId}-title`" class="text-base font-semibold">{{ props.label }}</h2>
      <button
        type="button"
        autofocus
        aria-label="关闭说明"
        class="focus-visible:outline-spotify-green text-spotify-muted inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/10 hover:text-white focus-visible:outline-2"
        @click="close"
      >
        <X aria-hidden="true" class="size-4" />
      </button>
    </header>
    <div class="text-spotify-muted space-y-3 px-5 py-4 text-sm leading-relaxed">
      <slot />
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { Info, X } from "@lucide/vue";
import { nextTick, ref, useId } from "vue";

const props = defineProps<{ label: string }>();
const dialogId = `info-help-${useId()}`;
const isOpen = ref(false);
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);

async function show() {
  if (isOpen.value) return;
  isOpen.value = true;
  await nextTick();
  dialogElement.value?.showModal();
}

function close() {
  dialogElement.value?.close();
  isOpen.value = false;
}
</script>
