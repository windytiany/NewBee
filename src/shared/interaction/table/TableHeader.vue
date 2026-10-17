<script setup lang="ts">
import type { TableColumn, TableSort } from "@/shared/interaction/table/useTable";
defineProps<{ columns: readonly TableColumn[]; sort: TableSort | null }>();
const emit = defineEmits<{
  sort: [key: string];
  resize: [key: string, event: globalThis.PointerEvent | globalThis.KeyboardEvent];
}>();
</script>

<template>
  <div
    data-table-header
    data-item-interaction
    role="row"
    class="bg-app-base/95 text-app-muted grid grid-cols-[var(--table-columns)] items-center gap-3 border-b border-white/10 py-2 text-xs backdrop-blur-sm sm:grid-cols-[var(--table-desktop-columns)]"
  >
    <div
      v-for="(column, index) in columns"
      :key="column.key"
      :data-table-column="column.key"
      role="columnheader"
      :aria-sort="sort?.key === column.key ? sort.direction : 'none'"
      class="relative min-w-0"
      :class="column.desktopOnly ? 'hidden sm:block' : ''"
    >
      <button
        type="button"
        :data-table-sort="column.key"
        class="focus-visible:bg-app-track flex w-full min-w-0 items-center gap-1 rounded-sm text-left outline-none hover:text-white"
        :class="column.right ? 'justify-end' : ''"
        @click="emit('sort', column.key)"
      >
        <span class="truncate">{{ column.label }}</span>
        <span v-if="sort?.key === column.key" aria-hidden="true" class="shrink-0">{{
          sort.direction === "ascending" ? "↑" : "↓"
        }}</span>
      </button>
      <span
        v-if="
          index < columns.length - 1 &&
          column.resizable !== false &&
          columns[index + 1]?.resizable !== false
        "
        role="separator"
        aria-orientation="vertical"
        :aria-label="column.label"
        :data-table-resize="column.key"
        tabindex="0"
        :class="columns[index + 1]?.desktopOnly ? 'hidden sm:block' : ''"
        class="focus-visible:bg-app-accent/50 absolute -top-2 -right-2 h-[calc(100%+1rem)] w-2 cursor-col-resize touch-none rounded-sm outline-none hover:bg-white/20"
        @pointerdown.stop="emit('resize', column.key, $event)"
        @keydown.stop="emit('resize', column.key, $event)"
        @click.stop.prevent
        @dblclick.stop.prevent
      ></span>
    </div>
  </div>
</template>
