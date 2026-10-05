<script setup lang="ts">
import { Copy, Maximize, Minus, X } from "@lucide/vue";
const props = defineProps<{ maximized: boolean }>();
const emit = defineEmits<{ minimize: []; maximize: []; close: [] }>();
</script>

<template>
  <div
    aria-label="Window controls"
    class="absolute inset-y-0 right-0 flex h-full items-center"
    role="group"
  >
    <button
      aria-label="Minimize window"
      class="text-app-muted focus-visible:outline-app-accent grid h-full w-10 place-items-center transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
      title="Minimize"
      type="button"
      @click.stop="emit('minimize')"
    >
      <Minus aria-hidden="true" class="size-4" />
    </button>
    <button
      :aria-label="props.maximized ? 'Restore window' : 'Maximize window'"
      class="text-app-muted focus-visible:outline-app-accent grid h-full w-10 place-items-center transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
      :title="props.maximized ? 'Restore' : 'Maximize'"
      type="button"
      @click.stop="emit('maximize')"
    >
      <Copy v-if="props.maximized" aria-hidden="true" class="size-3.5" />
      <Maximize v-else aria-hidden="true" class="size-3.5" />
    </button>
    <button
      aria-label="Close window"
      class="text-app-muted focus-visible:outline-app-accent grid h-full w-11 place-items-center transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-2"
      title="Close"
      type="button"
      @click.stop="emit('close')"
    >
      <X aria-hidden="true" class="size-4" />
    </button>
  </div>
</template>
