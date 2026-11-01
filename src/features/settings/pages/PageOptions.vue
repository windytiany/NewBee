<script setup lang="ts">
import { ref } from "vue";
import { GripVertical } from "@lucide/vue";
import { pageLabel, type PageName, type PageSetting } from "@/app/pages";
import { t } from "@/shared/i18n/locale";

const props = defineProps<{ disabled: boolean }>();
const items = defineModel<PageSetting[]>({ required: true });
const list = ref<InstanceType<typeof globalThis.HTMLUListElement> | null>(null);
type Pointer = InstanceType<typeof globalThis.PointerEvent>;
const dragged = ref<PageName | null>(null);
let pointerId: number | null = null;
let beforeDrag: PageSetting[] = [];

function start(event: Pointer, name: PageName) {
  if (props.disabled || event.button !== 0 || !event.isPrimary) return;
  beforeDrag = items.value.map((page) => ({ ...page }));
  event.preventDefault();
  list.value?.setPointerCapture(event.pointerId);
  pointerId = event.pointerId;
  dragged.value = name;
}

function move(event: Pointer) {
  if (event.pointerId !== pointerId || !dragged.value) return;
  const row = globalThis.document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest<InstanceType<typeof globalThis.HTMLElement>>("[data-page-setting]");
  const target = items.value.findIndex((page) => page.name === row?.dataset.pageSetting);
  const source = items.value.findIndex((page) => page.name === dragged.value);
  if (!row || target < 0 || source === target) return;
  const bounds = row.getBoundingClientRect();
  const middle = bounds.top + bounds.height / 2;
  if ((source < target && event.clientY < middle) || (source > target && event.clientY > middle))
    return;
  const [item] = items.value.splice(source, 1);
  if (item) items.value.splice(target, 0, item);
}

function finish(event: Pointer) {
  if (event.pointerId !== pointerId) return;
  pointerId = null;
  dragged.value = null;
}

function cancel() {
  if (pointerId === null) return;
  pointerId = null;
  dragged.value = null;
  items.value = beforeDrag;
}

function moveBy(name: PageName, delta: number) {
  if (props.disabled || dragged.value) return;
  const source = items.value.findIndex((page) => page.name === name);
  const target = source + delta;
  if (target < 0 || target >= items.value.length) return;
  const [item] = items.value.splice(source, 1);
  if (item) items.value.splice(target, 0, item);
}
</script>

<template>
  <fieldset :disabled="disabled">
    <legend class="mb-4 text-sm font-semibold">{{ t("页面") }}</legend>
    <ul
      ref="list"
      class="space-y-2"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="cancel"
      @lostpointercapture="cancel"
    >
      <li
        v-for="page in items"
        :key="page.name"
        :data-page-setting="page.name"
        class="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-3"
        :class="dragged === page.name ? 'ring-app-accent ring-1' : ''"
      >
        <button
          type="button"
          class="focus-visible:outline-app-accent text-app-muted cursor-grab touch-none rounded p-1 focus-visible:outline-2 active:cursor-grabbing disabled:cursor-not-allowed"
          :aria-label="`${t('调整顺序')}: ${pageLabel(page.name)}`"
          @pointerdown="start($event, page.name)"
          @keydown.up.prevent="moveBy(page.name, -1)"
          @keydown.down.prevent="moveBy(page.name, 1)"
        >
          <GripVertical :size="18" aria-hidden="true" />
        </button>
        <label class="flex flex-1 items-center justify-between gap-3 text-sm">
          <span>{{ pageLabel(page.name) }}</span>
          <input
            v-model="page.enabled"
            type="checkbox"
            class="accent-app-accent disabled:opacity-50"
            :disabled="page.name === 'Library' || dragged !== null"
          />
        </label>
      </li>
    </ul>
  </fieldset>
</template>
