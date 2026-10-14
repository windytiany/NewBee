import { onScopeDispose, ref, shallowRef, watch } from "vue";
import type { DraftPicture } from "@/features/artwork/collection/types";
import { createArtworkCollectionApi } from "@/features/artwork/collection/api";

export function usePicture(
  picture: () => DraftPicture | null,
  readPicture = createArtworkCollectionApi().picture,
) {
  const url = ref<string | null>(null);
  const data = shallowRef<number[] | null>(null);
  const status = ref<"empty" | "loading" | "ready" | "error">("empty");
  const error = ref<string | null>(null);
  let generation = 0;
  function release() {
    if (url.value) globalThis.URL.revokeObjectURL(url.value);
    url.value = null;
    data.value = null;
  }
  watch(
    picture,
    async (entry) => {
      const current = ++generation;
      release();
      error.value = null;
      status.value = entry ? "loading" : "empty";
      if (!entry) return;
      try {
        const bytes =
          entry.picture.source === "embedded"
            ? Uint8Array.from(entry.picture.data)
            : entry.picture.source === "linked"
              ? Uint8Array.from(await createArtworkCollectionApi().readFile(entry.picture.path))
              : new Uint8Array(await readPicture(entry.picture.artworkId));
        if (current !== generation) return;
        if (!bytes.length) throw new Error("图片内容为空");
        url.value = globalThis.URL.createObjectURL(
          new globalThis.Blob([bytes], { type: entry.mimeType }),
        );
        data.value = Array.from(bytes);
        status.value = "ready";
      } catch (failure) {
        if (current !== generation) return;
        error.value = failure instanceof Error ? failure.message : String(failure);
        status.value = "error";
      }
    },
    { immediate: true, flush: "sync" },
  );
  onScopeDispose(() => {
    ++generation;
    release();
  });
  return { url, data, status, error };
}
