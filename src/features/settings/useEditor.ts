import { t, setLocale, locale } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createSettingsApi } from "@/features/settings/api";
import { ask } from "@tauri-apps/plugin-dialog";
import { beforeRelease, waitForIdle, watchActivity } from "@/shared/lifecycle/activity";
import { computed, onUnmounted, reactive, ref } from "vue";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";
import { DEFAULT_SHORTCUTS, cloneShortcuts } from "@/features/shortcuts/bindings";
import { DEFAULT_ACCENT_COLOR, normalizeAccentColor } from "@/features/settings/appearance/accent";
import { applyAppearance } from "@/features/settings/appearance/apply";

export const categories = {
  general: "常规",
  appearance: "外观",
  playback: "播放",
  library: "媒体库",
  lyrics: "歌词",
  shortcuts: "快捷键",
  advanced: "高级",
  about: "关于",
} as const;

export function useEditor(
  dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null),
) {
  const api = createSettingsApi(invoke);
  const session = ref(0);
  const selectedCategory = ref<keyof typeof categories>("general");
  const isBackingUp = ref(false);
  const isChangingLogging = ref(false);
  const draft = reactive<Settings>({
    locale: locale.value,
    closeBehavior: "tray",
    lightweightOnClose: false,
    startupSplash: true,
    checkUpdatesOnStartup: true,
    themeMode: "system",
    accentColor: DEFAULT_ACCENT_COLOR,
    reducedMotion: false,
    layoutDensity: "regular",
    albumCoverBackground: false,
    playingCoverBackground: false,
    showPlaybackStatistics: true,
    playbackFadeIn: true,
    playbackFadeOut: true,
    replayGain: true,
    replayGainPreamp: 0,
    scanReplayGain: false,
    synchronizationFolders: [],
    albumSortBy: "name",
    albumSortOrder: "ascending",
    neteaseLyricsMode: "original",
    shortcuts: cloneShortcuts(DEFAULT_SHORTCUTS),
    lyricsProviders: ["netease"],
  });
  const normalizedAccentColor = computed(() => normalizeAccentColor(draft.accentColor));
  const isLoading = ref(false);
  const isLoaded = ref(false);
  const isSaving = ref(false);
  const isTauriApp = isTauri();
  let loadRequestSequence = 0;
  let suspensionUpdates = Promise.resolve();
  let loadedDraft = "";
  watchActivity(
    () => isLoading.value || isSaving.value || isBackingUp.value || isChangingLogging.value,
  );

  function snapshot(): Settings {
    return {
      shortcuts: cloneShortcuts(draft.shortcuts),
      locale: draft.locale,
      closeBehavior: draft.closeBehavior,
      lightweightOnClose: draft.lightweightOnClose,
      startupSplash: draft.startupSplash,
      checkUpdatesOnStartup: draft.checkUpdatesOnStartup,
      themeMode: draft.themeMode,
      accentColor: draft.accentColor,
      reducedMotion: draft.reducedMotion,
      layoutDensity: draft.layoutDensity,
      albumCoverBackground: draft.albumCoverBackground,
      playingCoverBackground: draft.playingCoverBackground,
      showPlaybackStatistics: draft.showPlaybackStatistics,
      playbackFadeIn: draft.playbackFadeIn,
      playbackFadeOut: draft.playbackFadeOut,
      replayGain: draft.replayGain,
      replayGainPreamp: draft.replayGainPreamp,
      scanReplayGain: draft.scanReplayGain,
      synchronizationFolders: draft.synchronizationFolders.map((folder) => ({ ...folder })),
      albumSortBy: draft.albumSortBy,
      albumSortOrder: draft.albumSortOrder,
      lyricsProviders: [...draft.lyricsProviders],
      neteaseLyricsMode: draft.neteaseLyricsMode,
    };
  }

  const removeReleaseGuard = beforeRelease(async (signal) => {
    if (!dialogElement.value?.open) return true;
    await waitForIdle(signal);
    if (signal.aborted) return false;
    if (isLoaded.value && JSON.stringify(snapshot()) !== loadedDraft) {
      const discard = await ask(t("放弃未保存的设置并进入轻量模式？"), {
        title: t("设置"),
        kind: "warning",
      });
      if (!discard || signal.aborted) return false;
    }
    close();
    await suspensionUpdates;
    return !signal.aborted;
  });

  function setShortcutsSuspended(suspended: boolean) {
    const update = suspensionUpdates
      .catch(() => {})
      .then(() => invoke<void>("set_shortcuts_suspended", { suspended }));
    suspensionUpdates = update;
    return update;
  }

  function restoreShortcuts() {
    if (!isTauriApp) return;
    void setShortcutsSuspended(false).catch((reason: unknown) => {
      logger.error("settings", "shortcuts_restore_failed", reason);
      notify({ type: "error", message: t("恢复快捷键失败"), key: "settings-shortcuts" });
    });
  }

  function onDialogClosed() {
    if (dialogElement.value?.open) return;
    ++loadRequestSequence;
    isLoading.value = false;
    restoreShortcuts();
  }

  onUnmounted(() => {
    removeReleaseGuard();
    ++loadRequestSequence;
    restoreShortcuts();
  });

  async function show(category?: keyof typeof categories) {
    if (dialogElement.value?.open) {
      if (category) selectedCategory.value = category;
      return;
    }
    selectedCategory.value = category ?? "general";
    session.value++;
    dialogElement.value?.showModal();
    isLoaded.value = false;
    const requestId = ++loadRequestSequence;
    if (!isTauriApp) return;
    isLoading.value = true;
    try {
      await setShortcutsSuspended(true);
      if (requestId !== loadRequestSequence) return;
      const settings = await api.get();
      if (requestId !== loadRequestSequence) return;
      draft.locale = settings.locale;
      draft.closeBehavior = settings.closeBehavior;
      draft.lightweightOnClose = settings.lightweightOnClose;
      draft.startupSplash = settings.startupSplash;
      draft.checkUpdatesOnStartup = settings.checkUpdatesOnStartup;
      draft.themeMode = settings.themeMode;
      draft.accentColor = settings.accentColor;
      draft.reducedMotion = settings.reducedMotion;
      draft.layoutDensity = settings.layoutDensity;
      draft.albumCoverBackground = settings.albumCoverBackground;
      draft.playingCoverBackground = settings.playingCoverBackground;
      draft.showPlaybackStatistics = settings.showPlaybackStatistics;
      draft.playbackFadeIn = settings.playbackFadeIn;
      draft.playbackFadeOut = settings.playbackFadeOut;
      draft.replayGain = settings.replayGain;
      draft.replayGainPreamp = settings.replayGainPreamp;
      draft.scanReplayGain = settings.scanReplayGain;
      draft.synchronizationFolders = settings.synchronizationFolders.map((folder) => ({
        ...folder,
      }));
      draft.albumSortBy = settings.albumSortBy;
      draft.albumSortOrder = settings.albumSortOrder;
      draft.lyricsProviders = settings.lyricsProviders.includes("netease") ? ["netease"] : [];
      draft.neteaseLyricsMode = settings.neteaseLyricsMode;
      draft.shortcuts = cloneShortcuts(settings.shortcuts);
      loadedDraft = JSON.stringify(snapshot());
      isLoaded.value = true;
    } catch (reason) {
      if (requestId === loadRequestSequence) {
        logger.error("settings", "load_failed", reason);
        notify({ type: "error", message: t("读取设置失败"), key: "settings-load" });
        restoreShortcuts();
      }
    } finally {
      if (requestId === loadRequestSequence) isLoading.value = false;
    }
  }

  function close() {
    if (isSaving.value || isBackingUp.value) return;
    dialogElement.value?.close();
    onDialogClosed();
  }

  async function save() {
    if (!isTauriApp || !isLoaded.value || isLoading.value || isSaving.value || isBackingUp.value)
      return;
    const preamp = draft.replayGainPreamp;
    if (!Number.isFinite(preamp) || preamp < -20 || preamp > 20 || (preamp * 2) % 1 !== 0) {
      notify({
        type: "error",
        message: t("前级增益必须为 −20 至 +20 dB，步进 0.5 dB"),
        key: "settings-replay-gain-preamp",
      });
      return;
    }
    const color = normalizedAccentColor.value;
    if (!color) {
      notify({
        type: "error",
        message: t("主题色必须是有效的 #RRGGBB 颜色"),
        key: "settings-accent-color",
      });
      return;
    }
    isSaving.value = true;
    try {
      await api.save({ ...snapshot(), accentColor: color });
      setLocale(draft.locale);
      draft.accentColor = color;
      applyAppearance({
        themeMode: draft.themeMode,
        accentColor: color,
        reducedMotion: draft.reducedMotion,
        layoutDensity: draft.layoutDensity,
      });
      globalThis.window.dispatchEvent(new globalThis.Event(SETTINGS_CHANGED_EVENT));
      dialogElement.value?.close();
      onDialogClosed();
    } catch (reason) {
      logger.error("settings", "save_failed", reason);
      const detail =
        reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
      notify({
        type: "error",
        message: detail ? `${t("保存设置失败")}: ${detail}` : t("保存设置失败"),
        key: "settings-save",
      });
    } finally {
      isSaving.value = false;
    }
  }
  return {
    session,
    draft,
    dialogElement,
    selectedCategory,
    isBackingUp,
    isChangingLogging,
    isTauriApp,
    isLoading,
    isLoaded,
    isSaving,
    show,
    close,
    save,
    onDialogClosed,
  };
}
