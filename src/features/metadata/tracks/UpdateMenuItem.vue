<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import { ChevronRight } from "@lucide/vue";
import { t } from "@/shared/i18n/locale";

const props = defineProps<{ disabled?: boolean }>();
const trigger = ref<globalThis.HTMLButtonElement | null>(null);
const submenu = ref<globalThis.HTMLDivElement | null>(null);
const submenuId = useId();
const open = ref(false);
const position = ref({ x: 0, y: 0 });

function close(focus = false) {
  open.value = false;
  if (focus) trigger.value?.focus();
}

async function show(focus = false) {
  if (props.disabled) return;
  open.value = true;
  await nextTick();
  if (!open.value) return;
  const bounds = trigger.value?.getBoundingClientRect();
  const menu = submenu.value?.getBoundingClientRect();
  if (bounds && menu) {
    position.value = {
      x: Math.max(
        0,
        bounds.right + menu.width <= globalThis.innerWidth
          ? bounds.right
          : bounds.left - menu.width,
      ),
      y: Math.max(0, Math.min(bounds.top, globalThis.innerHeight - menu.height)),
    };
  }
  if (focus) {
    submenu.value
      ?.querySelectorAll<globalThis.HTMLElement>(
        '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])',
      )[0]
      ?.focus();
  }
}

function onKeydown(event: globalThis.KeyboardEvent) {
  if (!open.value || !["ArrowLeft", "Escape"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  close(true);
}

function onFocusout(event: globalThis.FocusEvent) {
  const container = event.currentTarget as globalThis.HTMLElement;
  if (
    !(event.relatedTarget instanceof globalThis.Node) ||
    !container.contains(event.relatedTarget)
  ) {
    close();
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
  },
);
</script>

<template>
  <div @pointerleave="close()" @focusout="onFocusout" @keydown="onKeydown">
    <button
      ref="trigger"
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? submenuId : undefined"
      :disabled="disabled"
      class="focus-visible:outline-app-accent flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
      @mouseenter="show()"
      @click.stop="show(true)"
      @keydown.right.stop.prevent="show(true)"
    >
      {{ t("根据曲目更新标签") }}
      <ChevronRight aria-hidden="true" class="size-4" />
    </button>
    <div
      v-if="open"
      :id="submenuId"
      ref="submenu"
      role="menu"
      :aria-label="t('根据曲目更新标签')"
      class="bg-app-interactive fixed z-101 w-56 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    >
      <slot />
    </div>
  </div>
</template>
