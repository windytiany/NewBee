<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { Copy, Maximize, Minus, X } from "@lucide/vue";
const props = defineProps<{ maximized: boolean }>();
const emit = defineEmits<{ minimize: []; maximize: []; close: [] }>();
</script>

<template>
  <div :aria-label="t('窗口控制')" class="flex h-full shrink-0 items-center" role="group">
    <button
      :aria-label="t('最小化窗口')"
      class="text-app-muted focus-visible:outline-app-accent grid h-full w-10 place-items-center transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
      :title="t('最小化')"
      type="button"
      @click.stop="emit('minimize')"
    >
      <Minus aria-hidden="true" class="size-4" />
    </button>
    <button
      :aria-label="props.maximized ? t('还原窗口') : t('最大化窗口')"
      class="text-app-muted focus-visible:outline-app-accent grid h-full w-10 place-items-center transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2"
      :title="props.maximized ? t('还原') : t('最大化')"
      type="button"
      @click.stop="emit('maximize')"
    >
      <Copy v-if="props.maximized" aria-hidden="true" class="size-3.5" />
      <Maximize v-else aria-hidden="true" class="size-3.5" />
    </button>
    <button
      :aria-label="t('关闭窗口')"
      class="text-app-muted focus-visible:outline-app-accent grid h-full w-11 place-items-center transition-colors hover:bg-red-500 hover:text-white focus-visible:outline-2"
      :title="t('关闭')"
      type="button"
      @click.stop="emit('close')"
    >
      <X aria-hidden="true" class="size-4" />
    </button>
  </div>
</template>
