import { t } from "@/shared/i18n/locale";
import { notify } from "@/shared/notifications/center";
import { logger } from "@/shared/logging/logger";
import { invoke } from "@tauri-apps/api/core";
import { computed, reactive } from "vue";
import { createLibraryApi } from "@/features/library/api";
import type { LibraryAlbumSelection } from "@/features/library/types";
import { createLyricsApi } from "@/features/lyrics/api";
import type { LyricsDownloadTarget } from "@/features/lyrics/types";
import { useLyricsBatch } from "@/features/lyrics/download/batch";

export type LyricsConfirmationOptions = {
  targets: (ids: number[]) => Promise<LyricsDownloadTarget[]>;
  loadAlbum: (album: LibraryAlbumSelection) => Promise<number[]>;
  running: () => boolean;
  start: (ids: number[]) => Promise<void>;
};

export function createLyricsConfirmation(options: LyricsConfirmationOptions) {
  const state = reactive({
    open: false,
    loading: false,
    error: "",
    targets: [] as LyricsDownloadTarget[],
    selected: [] as number[],
  });
  let generation = 0;
  const busy = computed(() => state.open || options.running());
  const canConfirm = computed(
    () =>
      state.open &&
      !state.loading &&
      !state.error &&
      state.selected.length > 0 &&
      !options.running(),
  );

  async function open(load: () => Promise<number[]>) {
    if (busy.value) return;
    const version = ++generation;
    Object.assign(state, { open: true, loading: true, error: "", targets: [], selected: [] });
    try {
      const ids = [...new Set(await load())];
      if (!state.open || version !== generation) return;
      if (!ids.length) throw new Error(t("没有可下载歌词的曲目。"));
      const targets = await options.targets(ids);
      if (!state.open || version !== generation) return;
      if (
        targets.length !== ids.length ||
        new Set(targets.map(({ id }) => id)).size !== ids.length ||
        targets.some(({ id }) => !ids.includes(id))
      ) {
        throw new Error(t("返回的曲目与下载目标不匹配。"));
      }
      state.targets = targets;
      state.selected = targets.flatMap(({ id, hasLyrics, noLyrics }) =>
        !hasLyrics && !noLyrics ? [id] : [],
      );
    } catch (error) {
      if (state.open && version === generation) {
        state.error = error instanceof Error ? error.message : String(error);
        logger.warn("lyrics", "download_targets_failed", error);
        notify({ type: "warning", message: t("读取歌词下载目标失败") });
      }
    } finally {
      if (version === generation) state.loading = false;
    }
  }
  function close() {
    ++generation;
    state.open = false;
    state.loading = false;
  }
  function select(id: number, checked: boolean) {
    if (state.loading || !state.targets.some((target) => target.id === id)) return;
    state.selected = checked
      ? [...new Set([...state.selected, id])]
      : state.selected.filter((selected) => selected !== id);
  }
  function selectAll(checked: boolean) {
    if (state.loading) return;
    state.selected = checked ? state.targets.map(({ id }) => id) : [];
  }
  async function confirm() {
    if (!canConfirm.value) return;
    const selected = new Set(state.selected);
    const ids = state.targets.flatMap(({ id }) => (selected.has(id) ? [id] : []));
    close();
    await options.start(ids);
  }
  return {
    state,
    busy,
    canConfirm,
    close,
    select,
    selectAll,
    confirm,
    openTracks: (ids: readonly number[]) => {
      const snapshot = [...ids];
      return open(() => Promise.resolve(snapshot));
    },
    openAlbum: (album: LibraryAlbumSelection) => open(() => options.loadAlbum(album)),
  };
}

let sharedConfirmation: ReturnType<typeof createLyricsConfirmation> | null = null;
export function useLyricsConfirmation() {
  if (sharedConfirmation) return sharedConfirmation;
  const api = createLyricsApi(invoke);
  const library = createLibraryApi(invoke);
  const batch = useLyricsBatch();
  sharedConfirmation = createLyricsConfirmation({
    targets: api.targets,
    loadAlbum: async (album) => (await library.listAlbumTracks(album)).map(({ id }) => id),
    running: () => batch.state.running,
    start: batch.startTracks,
  });
  return sharedConfirmation;
}
