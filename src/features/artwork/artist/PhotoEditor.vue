<template>
  <div class="relative shrink-0">
    <div
      ref="photoElement"
      :role="props.artist === null ? undefined : 'button'"
      :tabindex="props.artist === null ? undefined : 0"
      :aria-label="t('演出者照片')"
      :aria-haspopup="props.artist === null ? undefined : 'menu'"
      :aria-expanded="props.artist === null ? undefined : !!contextMenu"
      :aria-busy="pending"
      class="focus-visible:outline-app-accent h-full w-full rounded-full focus-visible:outline-2"
      @contextmenu.prevent.stop="openContextMenu"
      @keydown="onKeydown"
    >
      <ArtistPhoto :artist="props.artist" class="h-full w-full" />
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      hidden
      :disabled="pending || props.artist === null"
      @change="replacePhoto"
    />
    <div
      v-if="contextMenu"
      ref="menuElement"
      role="menu"
      :aria-label="t('演出者照片')"
      class="bg-app-interactive fixed z-100 w-44 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      @pointerdown.stop
    >
      <button
        ref="firstMenuItemElement"
        type="button"
        role="menuitem"
        :disabled="pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:text-white/30 disabled:hover:bg-transparent"
        @click.stop="selectPhoto"
      >
        {{ t("选择照片") }}
      </button>
      <button
        type="button"
        role="menuitem"
        :disabled="pending || !clipboardAvailable"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:text-white/30 disabled:hover:bg-transparent"
        @click.stop="pastePhoto"
      >
        {{ t("粘贴照片") }}
      </button>
      <button
        type="button"
        role="menuitem"
        :disabled="pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-white/10 focus-visible:outline-2 disabled:text-white/30 disabled:hover:bg-transparent"
        @click.stop="searchPhoto"
      >
        {{ t("Google 图片搜索") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import ArtistPhoto from "@/features/artwork/artist/ArtistPhoto.vue";
import { saveArtistPhoto, searchArtistPhoto } from "@/features/artwork/artist/api";
import { refreshArtistPhoto } from "@/features/artwork/artist/usePhoto";
import { hasClipboardCover, readClipboardCover } from "@/features/artwork/transfer";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { t } from "@/shared/i18n/locale";

const props = defineProps<{ artist: string | null }>();
const photoElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const fileInput = ref<InstanceType<typeof globalThis.HTMLInputElement> | null>(null);
const menuElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const firstMenuItemElement = ref<InstanceType<typeof globalThis.HTMLElement> | null>(null);
const {
  request: contextMenu,
  position: menuPosition,
  open: openMenu,
  close: closeMenu,
} = useContextMenu<null>({ menuElement, firstMenuItemElement, fallbackFocusElement: photoElement });
const clipboardAvailable = ref(false);
const pending = ref(false);
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
let generation = 0;
let menuGeneration = 0;
let pickerArtist: string | null = null;

function reportFailure(error: unknown, message: string) {
  logger.error("artwork.artist", "action_failed", error);
  notify({ type: "error", message, key: "artist-photo-action" });
}

watch(
  contextMenu,
  (request) => {
    const current = ++menuGeneration;
    clipboardAvailable.value = false;
    if (!request) return;
    void hasClipboardCover().then(
      (available) => {
        if (current === menuGeneration) clipboardAvailable.value = available;
      },
      (error: unknown) => {
        if (current === menuGeneration) reportFailure(error, t("读取剪贴板失败，请查看日志"));
      },
    );
  },
  { flush: "sync" },
);
watch(
  () => props.artist,
  () => {
    ++generation;
    pickerArtist = null;
    closeMenu();
  },
  { flush: "sync" },
);
onScopeDispose(() => {
  ++generation;
  ++menuGeneration;
});

function openContextMenu(event: InstanceType<typeof globalThis.MouseEvent>) {
  if (props.artist === null || pending.value || !photoElement.value) return;
  openMenu({ x: event.clientX, y: event.clientY, trigger: photoElement.value, payload: null });
}
function onKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  if (props.artist === null || pending.value || !photoElement.value) return;
  if (
    event.key !== "ContextMenu" &&
    !(event.shiftKey && event.key === "F10") &&
    event.key !== "Enter" &&
    event.key !== " "
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = photoElement.value.getBoundingClientRect();
  openMenu({ x: bounds.left, y: bounds.bottom, trigger: photoElement.value, payload: null });
}
function selectPhoto() {
  if (props.artist === null || pending.value) return;
  pickerArtist = props.artist;
  closeMenu(true);
  fileInput.value?.click();
}
async function savePhoto(artist: string, load: () => Promise<number[]>) {
  const current = ++generation;
  pending.value = true;
  try {
    const data = await load();
    if (current !== generation) return;
    if (!data.length || data.length > MAX_PHOTO_BYTES)
      throw new Error(t("照片为空或超过 20 MiB。"));
    await saveArtistPhoto(artist, data);
    refreshArtistPhoto(artist);
  } catch (error) {
    reportFailure(error, t("保存演出者照片失败，请查看日志"));
  } finally {
    pending.value = false;
  }
}
async function replacePhoto(event: InstanceType<typeof globalThis.Event>) {
  const input = event.target as InstanceType<typeof globalThis.HTMLInputElement>;
  const file = input.files?.[0];
  const artist = pickerArtist;
  pickerArtist = null;
  input.value = "";
  if (!file || artist === null || pending.value) return;
  if (!file.size || file.size > MAX_PHOTO_BYTES) {
    reportFailure(new Error(t("照片为空或超过 20 MiB。")), t("照片为空或超过 20 MiB。"));
    return;
  }
  await savePhoto(artist, async () => Array.from(new Uint8Array(await file.arrayBuffer())));
}
async function pastePhoto() {
  const artist = props.artist;
  if (artist === null || pending.value || !clipboardAvailable.value) return;
  closeMenu(true);
  await savePhoto(artist, readClipboardCover);
}
async function searchPhoto() {
  const artist = props.artist;
  if (artist === null || pending.value) return;
  closeMenu(true);
  pending.value = true;
  try {
    await searchArtistPhoto(artist);
  } catch (error) {
    reportFailure(error, t("打开图片搜索失败，请查看日志"));
  } finally {
    pending.value = false;
  }
}
</script>
