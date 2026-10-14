import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { t } from "@/shared/i18n/locale";
import {
  pictureMimeType,
  readClipboardCover,
  readCover,
  saveCover,
  selectCover,
} from "@/features/artwork/transfer";

export type PictureStorage = "embedded" | "linked";
type PictureInput = { data: Uint8Array; path?: string; clipboard?: boolean };
type Addition = PictureInput & { mimeType: string; pictureType: number; url: string };

export function useAddition(options: {
  enabled: () => boolean;
  context: () => unknown;
  pictureType: () => number;
  add: (
    data: Uint8Array,
    mimeType: string,
    pictureType: number,
    path?: string,
  ) => Promise<string | undefined>;
  failed: (error: unknown) => void;
  busy: (value: boolean) => void;
}) {
  const pending = shallowRef<Addition | null>(null);
  const working = ref(false);
  const active = computed(() => working.value || pending.value !== null);
  let generation = 0;
  const MAX_PICTURE_BYTES = 20 * 1024 * 1024;
  watch(active, options.busy, { flush: "sync" });

  function release() {
    if (pending.value) globalThis.URL.revokeObjectURL(pending.value.url);
    pending.value = null;
  }
  function reset() {
    ++generation;
    release();
    working.value = false;
  }
  watch(() => [options.context(), options.enabled()], reset, { flush: "sync" });
  onScopeDispose(() => {
    reset();
    options.busy(false);
  });
  function cancel() {
    if (!working.value) reset();
  }
  async function read(load: () => Promise<PictureInput | null>) {
    if (!options.enabled() || active.value) return;
    const current = ++generation;
    const pictureType = options.pictureType();
    working.value = true;
    try {
      const input = await load();
      if (!input || current !== generation) return;
      if (!input.data.length || input.data.length > MAX_PICTURE_BYTES)
        throw new Error(t("封面为空或超过 20 MiB。"));
      const mimeType = await pictureMimeType(Array.from(input.data));
      if (current !== generation) return;
      const url = globalThis.URL.createObjectURL(
        new globalThis.Blob([Uint8Array.from(input.data)], { type: mimeType }),
      );
      pending.value = { ...input, mimeType, pictureType, url };
    } catch (error) {
      if (current === generation) options.failed(error);
    } finally {
      if (current === generation) working.value = false;
    }
  }
  async function confirm(storage: PictureStorage) {
    const entry = pending.value;
    if (!entry || working.value || !options.enabled()) return;
    const current = generation;
    working.value = true;
    try {
      let path: string | undefined;
      if (storage === "linked") {
        path = entry.path;
        if (!path && entry.clipboard) {
          path = await saveCover(Array.from(entry.data), () => current === generation);
          if (!path || current !== generation) return;
        }
        if (!path) throw new Error(t("无法取得拖入图片路径"));
      }
      if (current !== generation) return;
      const key = await options.add(entry.data, entry.mimeType, entry.pictureType, path);
      if (key && current === generation) release();
    } catch (error) {
      if (current === generation) options.failed(error);
    } finally {
      if (current === generation) working.value = false;
    }
  }
  return {
    pending,
    working,
    active,
    cancel,
    confirm,
    select: () => read(selectCover),
    paste: () =>
      read(async () => ({ data: Uint8Array.from(await readClipboardCover()), clipboard: true })),
    dropPath: (path: string) => read(async () => ({ path, data: await readCover(path) })),
    dropFile: (file: File) =>
      read(async () => {
        if (!file.size || file.size > MAX_PICTURE_BYTES)
          throw new Error(t("封面为空或超过 20 MiB。"));
        return { data: new Uint8Array(await file.arrayBuffer()) };
      }),
  };
}
