<template>
  <div @dragover.prevent @drop.prevent="dropPicture">
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      :disabled="locked || !ready"
      @change="selectPicture"
    />
    <p v-if="busy || importing" role="status" class="text-app-muted mb-4 text-sm">
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
        type="button"
        :aria-label="t('添加图片')"
        :disabled="locked || !ready"
        class="focus-visible:outline-app-accent text-app-muted flex aspect-square items-center justify-center border border-white/25 hover:border-white/50 hover:bg-white/5 hover:text-white focus-visible:outline-2 disabled:opacity-40"
        @click="fileInput?.click()"
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
      <div class="space-y-1 max-[640px]:col-start-2">
        <button
          type="button"
          :disabled="locked || !ready"
          class="focus-visible:outline-app-accent w-full rounded-sm border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
          @click="fileInput?.click()"
        >
          {{ t("添加图片") }}
        </button>
        <button
          type="button"
          :disabled="locked || !ready"
          class="focus-visible:outline-app-accent w-full rounded-sm border border-white/15 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
          @click="pastePicture"
        >
          {{ t("粘贴封面") }}
        </button>
      </div>
    </div>
    <label class="inline-flex items-center gap-2 border-t border-white/15 pt-4 text-sm">
      <input
        type="checkbox"
        :checked="embedArtwork"
        :disabled="locked || !ready"
        class="accent-app-accent size-3.5"
        @change="changeEmbedding"
      />
      {{ t("嵌入音频文件") }}
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { t } from "@/shared/i18n/locale";
import type {
  CollectionDraft,
  CommonPicture,
  DisplaySelection,
} from "@/features/artwork/collection/types";
import ArtworkPreview from "@/features/artwork/collection/ArtworkPreview.vue";
import { pictureTypes, pictureTypeLabel } from "@/features/artwork/collection/presentation";
import { pictureMimeType, readClipboardCover } from "@/features/artwork/transfer";
const props = defineProps<{
  draft: CollectionDraft;
  pictures: CommonPicture[];
  display: DisplaySelection;
  ready: boolean;
  disabled: boolean;
  importing: boolean;
  embedArtwork: boolean;
  addPicture: (
    data: Uint8Array,
    mimeType: string,
    pictureType: number,
  ) => Promise<string | undefined>;
}>();
const emit = defineEmits<{
  type: [key: string, value: number];
  delete: [key: string];
  display: [key: string];
  embed: [value: boolean];
  failed: [error: unknown];
  busy: [value: boolean];
}>();
const fileInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(null);
const busy = ref(false);
const importType = ref(3);
const locked = computed(() => props.disabled || props.importing || busy.value);
const MAX_PICTURE_BYTES = 20 * 1024 * 1024;
let generation = 0;
watch(
  () => [props.draft, props.disabled, props.ready],
  () => {
    ++generation;
  },
  { flush: "sync" },
);
onScopeDispose(() => {
  ++generation;
  emit("busy", false);
});
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
function changeEmbedding(event: InstanceType<typeof globalThis.Event>) {
  if (!locked.value && props.ready)
    emit("embed", (event.target as InstanceType<typeof globalThis.HTMLInputElement>).checked);
}
async function importPicture(read: () => Promise<Uint8Array>) {
  if (locked.value || !props.ready) return;
  const current = generation;
  const pictureType = importType.value;
  busy.value = true;
  emit("busy", true);
  try {
    const data = await read();
    if (current !== generation) return;
    if (!data.length || data.length > MAX_PICTURE_BYTES)
      throw new Error(t("封面为空或超过 20 MiB。"));
    const mimeType = await pictureMimeType(Array.from(data));
    if (current !== generation) return;
    await props.addPicture(data, mimeType, pictureType);
  } catch (error) {
    if (current === generation) emit("failed", error);
  } finally {
    busy.value = false;
    emit("busy", false);
  }
}
function importFile(file: InstanceType<typeof globalThis.File>) {
  return importPicture(async () => {
    if (!file.size || file.size > MAX_PICTURE_BYTES) throw new Error(t("封面为空或超过 20 MiB。"));
    return new Uint8Array(await file.arrayBuffer());
  });
}
function selectPicture(event: InstanceType<typeof globalThis.Event>) {
  const input = event.target as InstanceType<typeof globalThis.HTMLInputElement>;
  const file = input.files?.[0];
  input.value = "";
  if (file) void importFile(file);
}
function dropPicture(event: InstanceType<typeof globalThis.DragEvent>) {
  const file = event.dataTransfer?.files[0];
  if (file) void importFile(file);
}
function pastePicture() {
  void importPicture(async () => Uint8Array.from(await readClipboardCover()));
}
</script>
