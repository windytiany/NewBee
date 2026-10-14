<template>
  <div @dragover.prevent @drop.prevent="dropPicture">
    <p v-if="working || importing" role="status" class="text-app-muted mb-4 text-sm">
      {{ t("正在导入图片…") }}
    </p>
    <p v-if="!ready" role="alert" class="mb-4 text-sm text-red-400">
      {{ t("图片集合加载失败") }}
    </p>
    <p v-else-if="!pictures.length" role="status" class="text-app-muted mb-4 text-sm">
      {{ draft.tracks.length > 1 ? t("无共有图片") : t("暂无封面") }}
    </p>
    <ul>
      <li
        v-for="entry in pictures"
        :key="entry.key"
        class="border-b border-white/15 py-6 first:pt-0"
      >
        <ArtworkPreview
          :selection="{ mixed: false, picture: findPicture(entry.key) }"
          :disabled="locked || !ready"
          exportable
          class="grid grid-cols-[11.5rem_minmax(0,1fr)_6.5rem] items-start gap-x-6 gap-y-3 max-[640px]:grid-cols-[8rem_minmax(0,1fr)]"
          @failed="emit('failed', $event)"
        >
          <template #details>
            <div class="min-w-0 space-y-6">
              <p class="text-app-muted text-sm">
                {{ entry.storage === "embedded" ? t("内嵌") : t("关联") }}
              </p>
              <p v-if="entry.error" role="status" class="text-sm text-red-400">
                {{ t("路径不可用") }}
              </p>
              <label class="block space-y-1.5 text-sm">
                <span>{{ t("用途类型") }}</span>
                <select
                  :value="entry.pictureType === null ? '' : entry.pictureType"
                  :disabled="locked || !ready"
                  class="bg-app-surface focus-visible:outline-app-accent w-full rounded-sm border border-white/25 px-2 py-1.5 focus-visible:outline-2 disabled:opacity-50"
                  @change="changeType(entry.key, $event)"
                >
                  <option v-if="entry.pictureType === null" value="" disabled>
                    {{ t("多个值") }}
                  </option>
                  <option
                    v-else-if="!pictureTypes.includes(entry.pictureType)"
                    :value="entry.pictureType"
                    disabled
                  >
                    {{ pictureTypeLabel(entry.pictureType) }}
                  </option>
                  <option v-for="type in pictureTypes" :key="type" :value="type">
                    {{ pictureTypeLabel(type) }}
                  </option>
                </select>
              </label>
              <label class="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="artwork-display"
                  :checked="!display.mixed && display.picture?.key === entry.key"
                  :disabled="locked || !ready"
                  class="accent-app-accent size-3.5"
                  @change="emit('display', entry.key)"
                />
                {{ t("展示图片") }}
              </label>
            </div>
          </template>
          <template #actions="{ save, disabled: exportDisabled }">
            <div class="space-y-1 max-[640px]:col-start-2">
              <button
                type="button"
                :disabled="locked || !ready"
                class="focus-visible:outline-app-accent w-full rounded-sm border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
                @click="emit('delete', entry.key)"
              >
                {{ t("删除") }}
              </button>
              <button
                type="button"
                :disabled="exportDisabled"
                class="focus-visible:outline-app-accent w-full rounded-sm border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
                @click="save"
              >
                {{ t("保存封面") }}
              </button>
            </div>
          </template>
        </ArtworkPreview>
      </li>
    </ul>
    <div
      class="grid grid-cols-[11.5rem_minmax(0,1fr)_6.5rem] items-start gap-x-6 gap-y-3 py-6 max-[640px]:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <button
        ref="additionElement"
        type="button"
        :aria-label="t('添加图片')"
        aria-haspopup="menu"
        :aria-expanded="!!contextMenu"
        :disabled="locked || !ready"
        class="focus-visible:outline-app-accent flex aspect-square w-full items-center justify-center border border-white/25 bg-white/5 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
        @click="selectPicture"
        @contextmenu.prevent.stop="openContextMenu"
        @keydown="onAdditionKeydown"
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <label class="block min-w-0 space-y-1.5 text-sm">
        <span>{{ t("用途类型") }}</span>
        <select
          :value="importType"
          :disabled="locked || !ready"
          class="bg-app-surface focus-visible:outline-app-accent w-full rounded-sm border border-white/25 px-2 py-1.5 focus-visible:outline-2 disabled:opacity-50"
          @change="changeImportType"
        >
          <option v-for="type in pictureTypes" :key="type" :value="type">
            {{ pictureTypeLabel(type) }}
          </option>
        </select>
      </label>
      <button
        type="button"
        :disabled="locked || !ready"
        class="focus-visible:outline-app-accent rounded-sm border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40 max-[640px]:col-start-2"
        @click="selectPicture"
      >
        {{ t("添加") }}
      </button>
    </div>
    <div
      v-if="contextMenu"
      ref="menuElement"
      role="menu"
      :aria-label="t('封面')"
      class="bg-app-interactive fixed z-100 w-40 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      @pointerdown.stop
    >
      <button
        ref="firstMenuItemElement"
        type="button"
        role="menuitem"
        :disabled="locked || !ready"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
        @click="pastePicture"
      >
        {{ t("粘贴封面") }}
      </button>
    </div>
    <AdditionDialog
      v-if="pending"
      :url="pending.url"
      :path="pending.path"
      :working="working"
      @confirm="confirm"
      @cancel="cancel"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import AdditionDialog from "@/features/artwork/collection/AdditionDialog.vue";
import { useAddition } from "@/features/artwork/collection/useAddition";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import { t } from "@/shared/i18n/locale";
import type {
  CollectionDraft,
  CommonPicture,
  DisplaySelection,
} from "@/features/artwork/collection/types";
import { usePictureDrop } from "@/features/artwork/collection/useDrop";
import ArtworkPreview from "@/features/artwork/collection/ArtworkPreview.vue";
import { pictureTypes, pictureTypeLabel } from "@/features/artwork/collection/presentation";
const props = defineProps<{
  draft: CollectionDraft;
  pictures: CommonPicture[];
  display: DisplaySelection;
  ready: boolean;
  disabled: boolean;
  importing: boolean;
  addPicture: (
    data: Uint8Array,
    mimeType: string,
    pictureType: number,
    path?: string,
  ) => Promise<string | undefined>;
}>();
const emit = defineEmits<{
  type: [key: string, value: number];
  delete: [key: string];
  display: [key: string];
  failed: [error: unknown];
  busy: [value: boolean];
}>();
const importType = ref(3);
const { pending, working, active, cancel, confirm, select, paste, dropPath, dropFile } =
  useAddition({
    enabled: () => props.ready && !props.disabled,
    context: () => props.draft,
    pictureType: () => importType.value,
    add: (...args) => props.addPicture(...args),
    failed: (error) => emit("failed", error),
    busy: (value) => emit("busy", value),
  });
const locked = computed(() => props.disabled || props.importing || active.value);
const pendingPath = usePictureDrop(
  () => !locked.value && props.ready,
  () => {},
  (error) => emit("failed", error),
);
watch(
  pendingPath,
  (path) => {
    if (!path) return;
    pendingPath.value = null;
    void dropPath(path);
  },
  { flush: "sync" },
);
const additionElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const menuElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const firstMenuItemElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const {
  request: contextMenu,
  position: menuPosition,
  open: openMenu,
  close: closeMenu,
} = useContextMenu<null>({
  menuElement,
  firstMenuItemElement,
  fallbackFocusElement: additionElement,
});
watch(locked, (value) => {
  if (value) closeMenu();
});
function openContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (locked.value || !props.ready || !additionElement.value) return;
  openMenu({ x: event.clientX, y: event.clientY, trigger: additionElement.value, payload: null });
}
function onAdditionKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (locked.value || !props.ready || !additionElement.value) return;
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = additionElement.value.getBoundingClientRect();
  openMenu({ x: bounds.left, y: bounds.bottom, trigger: additionElement.value, payload: null });
}
function selectPicture() {
  if (locked.value || !props.ready) return;
  void select();
}
function pastePicture() {
  if (locked.value || !props.ready) return;
  closeMenu(true);
  void paste();
}
function findPicture(key: string) {
  return props.draft.tracks[0]?.pictures.find((entry) => entry.key === key) ?? null;
}
function changeType(key: string, event: InstanceType<typeof globalThis.Event>) {
  if (locked.value || !props.ready) return;
  const value = Number((event.target as InstanceType<typeof globalThis.HTMLSelectElement>).value);
  if (pictureTypes.includes(value)) emit("type", key, value);
}
function changeImportType(event: InstanceType<typeof globalThis.Event>) {
  if (locked.value || !props.ready) return;
  const value = Number((event.target as InstanceType<typeof globalThis.HTMLSelectElement>).value);
  if (pictureTypes.includes(value)) importType.value = value;
}
function dropPicture(event: InstanceType<typeof globalThis.DragEvent>) {
  if (isTauri() || locked.value || !props.ready) return;
  const file = event.dataTransfer?.files[0];
  if (file) void dropFile(file);
}
</script>
