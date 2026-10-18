<script setup lang="ts">
import { t, setLocale, locale } from "@/shared/i18n/locale";
import { logger } from "@/shared/logging/logger";
import { notify } from "@/shared/notifications/center";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createSettingsApi } from "@/features/settings/api";
import { ask } from "@tauri-apps/plugin-dialog";
import { beforeRelease, waitForIdle, watchActivity } from "@/shared/lifecycle/activity";
import { computed, onUnmounted, ref } from "vue";
import { RotateCcw, Undo2 } from "@lucide/vue";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";
import { BINDING_GROUPS } from "@/features/shortcuts/groups";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  cloneShortcuts,
  formatShortcut,
  allowsGlobalShortcut,
  SHORTCUT_DEFINITIONS,
  shortcutFromEvent,
  type ShortcutAction,
} from "@/features/shortcuts/bindings";
import {
  ACCENT_COLORS,
  DEFAULT_ACCENT_COLOR,
  normalizeAccentColor,
} from "@/features/settings/accent";
import { applyAppearance } from "@/features/settings/appearance";
import BackupOptions from "@/features/backup/components/BackupOptions.vue";
import MonitoringOptions from "@/features/library/monitoring/MonitoringOptions.vue";
import type { MonitoringFolder } from "@/features/library/monitoring/types";

const isBackingUp = ref(false);

const api = createSettingsApi(invoke);
const detailedLogging = ref(false);
const isChangingLogging = ref(false);
async function changeLogging() {
  if (isChangingLogging.value) return;
  isChangingLogging.value = true;
  try {
    await invoke<void>("set_detailed_logging", { enabled: detailedLogging.value });
  } catch (reason) {
    logger.error("settings", "logging_level_change_failed", reason);
    detailedLogging.value = !detailedLogging.value;
    notify({ type: "error", message: t("切换日志级别失败，请查看日志"), key: "settings-logging" });
  } finally {
    isChangingLogging.value = false;
  }
}
async function openLogs() {
  try {
    await invoke<void>("open_logs_directory");
  } catch (reason) {
    logger.error("settings", "open_logs_failed", reason);
    notify({ type: "error", message: t("打开日志目录失败，请查看日志"), key: "settings-logs" });
  }
}

const categories = {
  general: "常规",
  appearance: "外观",
  library: "媒体库",
  monitoring: "监视文件夹",
  lyrics: "歌词",
  shortcuts: "快捷键",
  diagnostics: "诊断",
  backup: "备份",
} as const;
const selectedCategory = ref<keyof typeof categories>("general");
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const selectedLocale = ref<Settings["locale"]>(locale.value);
const closeBehavior = ref<Settings["closeBehavior"]>("tray");
const lightweightOnClose = ref(false);
const accentColor = ref(DEFAULT_ACCENT_COLOR);
const normalizedAccentColor = computed(() => normalizeAccentColor(accentColor.value));
const reducedMotion = ref(false);
const layoutDensity = ref<Settings["layoutDensity"]>("regular");
const albumCoverBackground = ref(false);
const playingCoverBackground = ref(false);
const showPlaybackStatistics = ref(true);
const monitoringFolders = ref<MonitoringFolder[]>([]);
const albumSortBy = ref<Settings["albumSortBy"]>("name");
const albumSortOrder = ref<Settings["albumSortOrder"]>("ascending");
const neteaseEnabled = ref(true);
const neteaseLyricsMode = ref<Settings["neteaseLyricsMode"]>("original");
const shortcuts = ref(cloneShortcuts(DEFAULT_SHORTCUTS));
const selectedShortcutAction = ref<ShortcutAction>("previous");
const shortcutLabels = Object.fromEntries(
  SHORTCUT_ACTIONS.map((action) => [action, SHORTCUT_DEFINITIONS[action].label]),
) as Record<ShortcutAction, string>;
function resetShortcuts() {
  shortcuts.value = cloneShortcuts(DEFAULT_SHORTCUTS);
}

function resetShortcut(action: ShortcutAction) {
  shortcuts.value[action] = { ...DEFAULT_SHORTCUTS[action] };
}

function recordShortcut(
  event: InstanceType<typeof globalThis.KeyboardEvent>,
  action: ShortcutAction = selectedShortcutAction.value,
) {
  if (event.isComposing || event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  if (
    (event.key === "Escape" || event.key === "Backspace" || event.key === "Delete") &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey
  ) {
    shortcuts.value[action].shortcut = "";
    return;
  }
  const shortcut = shortcutFromEvent(event);
  if (shortcut !== null) shortcuts.value[action].shortcut = shortcut;
}

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

function draft(): Settings {
  return {
    shortcuts: cloneShortcuts(shortcuts.value),
    locale: selectedLocale.value,
    closeBehavior: closeBehavior.value,
    lightweightOnClose: lightweightOnClose.value,
    accentColor: accentColor.value,
    reducedMotion: reducedMotion.value,
    layoutDensity: layoutDensity.value,
    albumCoverBackground: albumCoverBackground.value,
    playingCoverBackground: playingCoverBackground.value,
    showPlaybackStatistics: showPlaybackStatistics.value,
    monitoringFolders: monitoringFolders.value.map((folder) => ({ ...folder })),
    albumSortBy: albumSortBy.value,
    albumSortOrder: albumSortOrder.value,
    lyricsProviders: neteaseEnabled.value ? ["netease"] : [],
    neteaseLyricsMode: neteaseLyricsMode.value,
  };
}

const removeReleaseGuard = beforeRelease(async (signal) => {
  if (!dialogElement.value?.open) return true;
  await waitForIdle(signal);
  if (signal.aborted) return false;
  if (isLoaded.value && JSON.stringify(draft()) !== loadedDraft) {
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
    notify({ type: "error", message: t("恢复快捷键失败，请查看日志"), key: "settings-shortcuts" });
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

async function show() {
  if (dialogElement.value?.open) return;
  selectedCategory.value = "general";
  selectedShortcutAction.value = "previous";
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
    selectedLocale.value = settings.locale;
    closeBehavior.value = settings.closeBehavior;
    lightweightOnClose.value = settings.lightweightOnClose ?? false;
    accentColor.value = settings.accentColor;
    reducedMotion.value = settings.reducedMotion;
    layoutDensity.value = settings.layoutDensity;
    albumCoverBackground.value = settings.albumCoverBackground;
    playingCoverBackground.value = settings.playingCoverBackground;
    showPlaybackStatistics.value = settings.showPlaybackStatistics;
    monitoringFolders.value = (settings.monitoringFolders ?? []).map((folder) => ({ ...folder }));
    albumSortBy.value = settings.albumSortBy;
    albumSortOrder.value = settings.albumSortOrder;
    neteaseEnabled.value = settings.lyricsProviders.includes("netease");
    neteaseLyricsMode.value = settings.neteaseLyricsMode;
    shortcuts.value = cloneShortcuts(settings.shortcuts);
    loadedDraft = JSON.stringify(draft());
    isLoaded.value = true;
  } catch (reason) {
    if (requestId === loadRequestSequence) {
      logger.error("settings", "load_failed", reason);
      notify({ type: "error", message: t("读取设置失败，请查看日志"), key: "settings-load" });
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
    await api.save({ ...draft(), accentColor: color });
    setLocale(selectedLocale.value);
    accentColor.value = color;
    applyAppearance({
      accentColor: color,
      reducedMotion: reducedMotion.value,
      layoutDensity: layoutDensity.value,
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
      message: detail ? `${t("保存设置失败")}: ${detail}` : t("保存设置失败，请查看日志"),
      key: "settings-save",
    });
  } finally {
    isSaving.value = false;
  }
}

defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="settings-dialog-title"
    class="sidebar-scrollbars bg-app-surface m-auto w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="close"
    @close="onDialogClosed"
    @click.self="close"
    @mousedown.stop
  >
    <form class="flex h-[min(36rem,85dvh)] flex-col" @submit.prevent="save">
      <header class="shrink-0 border-b border-white/10 px-5 py-4">
        <h2 id="settings-dialog-title" class="text-lg font-semibold">{{ t("设置") }}</h2>
      </header>
      <div
        class="grid min-h-0 flex-1 grid-cols-[7rem_minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)]"
      >
        <nav
          :aria-label="t('设置分类')"
          class="bg-app-base/40 overflow-y-auto border-r border-white/10 p-2 sm:p-3"
        >
          <button
            v-for="(label, category) in categories"
            :id="`settings-category-${category}`"
            :key="category"
            :aria-current="selectedCategory === category ? 'true' : undefined"
            :disabled="isBackingUp"
            aria-controls="settings-category-panel"
            class="focus-visible:outline-app-accent mb-1 w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="
              selectedCategory === category
                ? 'bg-app-accent text-black'
                : 'text-app-muted hover:bg-white/5 hover:text-white'
            "
            type="button"
            @click="selectedCategory = category"
          >
            {{ t(label) }}
          </button>
        </nav>
        <section
          id="settings-category-panel"
          :aria-labelledby="`settings-category-${selectedCategory}`"
          class="min-h-0 min-w-0 p-5 sm:p-6"
          :class="
            selectedCategory === 'shortcuts' || selectedCategory === 'monitoring'
              ? 'flex flex-col overflow-hidden'
              : 'overflow-y-auto'
          "
        >
          <div
            v-if="selectedCategory === 'shortcuts'"
            class="mb-3 flex shrink-0 items-center justify-between gap-2"
          >
            <h3 class="self-start text-sm font-semibold">{{ t("快捷键") }}</h3>
            <button
              type="button"
              :aria-label="t('恢复默认')"
              :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
              class="focus-visible:outline-app-accent ml-auto rounded-lg p-2 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
              @click="resetShortcuts"
            >
              <RotateCcw :size="16" aria-hidden="true" />
            </button>
          </div>
          <fieldset
            v-if="selectedCategory === 'appearance'"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          >
            <legend class="sr-only">{{ t("外观") }}</legend>
            <label class="mb-5 flex flex-col gap-2 text-sm font-semibold">
              {{ t("布局") }}
              <select
                v-model="layoutDensity"
                name="layout-density"
                class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
              >
                <option value="regular">{{ t("常规布局") }}</option>
                <option value="compact">{{ t("紧凑布局") }}</option>
              </select>
            </label>
            <div role="group" aria-labelledby="accent-color-label" class="space-y-3">
              <h4 id="accent-color-label" class="text-sm font-semibold">{{ t("主题色") }}</h4>
              <div class="flex flex-wrap gap-3">
                <button
                  v-for="color in ACCENT_COLORS"
                  :key="color.value"
                  type="button"
                  :aria-label="t(`${color.label}色`)"
                  :aria-pressed="normalizedAccentColor === color.value"
                  :style="{ backgroundColor: color.value }"
                  class="focus-visible:outline-app-accent size-8 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-4"
                  :class="
                    normalizedAccentColor === color.value ? 'border-white' : 'border-transparent'
                  "
                  @click="accentColor = color.value"
                ></button>
              </div>
              <div class="flex items-center gap-3">
                <input
                  v-model="accentColor"
                  type="color"
                  name="accent-color-picker"
                  :aria-label="t('选择自定义主题色')"
                  class="focus-visible:outline-app-accent h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent focus-visible:outline-2"
                />
                <input
                  v-model="accentColor"
                  type="text"
                  autocomplete="off"
                  name="accent-color"
                  :aria-label="t('自定义主题色')"
                  pattern="#[0-9a-fA-F]{6}"
                  maxlength="7"
                  required
                  spellcheck="false"
                  class="bg-app-interactive focus-visible:outline-app-accent w-28 rounded-lg border border-white/10 px-3 py-2 text-sm text-white focus-visible:outline-2"
                />
              </div>
            </div>
            <label
              class="mt-5 flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3"
            >
              <input
                v-model="reducedMotion"
                class="accent-app-accent mt-1"
                name="reduced-motion"
                type="checkbox"
              />
              <span class="text-sm font-semibold">{{ t("减少动态效果") }}</span>
            </label>
            <label
              class="mt-5 flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3"
            >
              <input
                v-model="albumCoverBackground"
                class="accent-app-accent mt-1"
                name="album-cover-background"
                type="checkbox"
              />
              <span class="text-sm font-semibold">{{ t("专辑详情封面背景") }}</span>
            </label>
            <label
              class="mt-2 flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3"
            >
              <input
                v-model="playingCoverBackground"
                class="accent-app-accent mt-1"
                name="playing-cover-background"
                type="checkbox"
              />
              <span class="text-sm font-semibold">{{ t("播放页封面背景") }}</span>
            </label>
          </fieldset>
          <fieldset
            v-else-if="selectedCategory === 'general'"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          >
            <legend class="sr-only">{{ t("关闭窗口时的行为") }}</legend>
            <label class="mb-5 flex flex-col gap-2 text-sm font-semibold">
              {{ t("语言") }}
              <select
                v-model="selectedLocale"
                name="locale"
                class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <p id="close-behavior-description" class="mb-3 text-sm font-semibold">
              {{ t("关闭窗口时") }}
            </p>
            <label class="flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3">
              <input
                v-model="closeBehavior"
                aria-describedby="close-behavior-description"
                class="accent-app-accent mt-1"
                name="close-behavior"
                type="radio"
                value="tray"
              />
              <span class="text-sm">{{ t("缩小到托盘") }}</span>
            </label>
            <label
              class="mt-2 flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3"
            >
              <input
                v-model="closeBehavior"
                aria-describedby="close-behavior-description"
                class="accent-app-accent mt-1"
                name="close-behavior"
                type="radio"
                value="exit"
              />
              <span class="text-sm">{{ t("直接退出") }}</span>
            </label>
            <label class="mt-5 flex cursor-pointer items-start gap-3 text-sm">
              <input
                v-model="lightweightOnClose"
                :disabled="closeBehavior !== 'tray'"
                type="checkbox"
                name="lightweight-on-close"
                class="accent-app-accent mt-1"
              />
              <span>{{ t("关闭到托盘时进入轻量模式") }}</span>
            </label>
          </fieldset>
          <fieldset
            v-else-if="selectedCategory === 'lyrics'"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          >
            <legend class="sr-only">{{ t("歌词来源") }}</legend>
            <h4 class="mb-3 text-sm font-semibold">{{ t("歌词来源") }}</h4>
            <label class="flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3">
              <input
                v-model="neteaseEnabled"
                type="checkbox"
                name="netease-lyrics"
                class="accent-app-accent mt-1"
              />
              <span class="text-sm">{{ t("网易云音乐") }}</span>
            </label>
            <label class="mt-5 flex flex-col gap-2 text-sm font-semibold">
              {{ t("网易云歌词内容") }}
              <select
                v-model="neteaseLyricsMode"
                name="netease-lyrics-mode"
                class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
              >
                <option value="original">{{ t("原始歌词") }}</option>
                <option value="translated">{{ t("翻译歌词") }}</option>
                <option value="bilingual">{{ t("双语歌词") }}</option>
              </select>
            </label>
          </fieldset>
          <fieldset
            v-else-if="selectedCategory === 'shortcuts'"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
            class="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <legend class="sr-only">{{ t("快捷键") }}</legend>
            <div class="min-h-0 overflow-auto rounded-lg border border-white/10">
              <table class="w-full min-w-96 table-fixed text-left text-sm">
                <thead class="text-app-muted bg-app-surface sticky top-0 z-10">
                  <tr>
                    <th scope="col" class="w-32 px-3 py-2 font-medium">{{ t("操作") }}</th>
                    <th scope="col" class="px-3 py-2 font-medium">{{ t("快捷键") }}</th>
                    <th scope="col" class="w-16 px-3 py-2 text-center font-medium">
                      {{ t("全局") }}
                    </th>
                    <th scope="col" class="w-12 px-2 py-2">
                      <span class="sr-only">{{ t("恢复默认") }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody
                  v-for="group in BINDING_GROUPS"
                  :key="group.id"
                  :data-shortcut-group="group.id"
                >
                  <tr>
                    <th
                      colspan="4"
                      scope="rowgroup"
                      class="text-app-muted bg-white/5 px-3 pt-4 pb-2 text-xs font-semibold"
                    >
                      {{ t(group.label) }}
                    </th>
                  </tr>
                  <tr
                    v-for="action in group.actions"
                    :key="action"
                    :data-shortcut-action="action"
                    :class="
                      selectedShortcutAction === action ? 'bg-app-accent/15' : 'hover:bg-white/5'
                    "
                  >
                    <td class="px-3 py-2">{{ t(shortcutLabels[action]) }}</td>
                    <td class="px-1 py-1">
                      <input
                        :aria-label="`${t(shortcutLabels[action])} ${t('快捷键')}`"
                        autocomplete="off"
                        :name="`shortcut-${action}`"
                        :value="formatShortcut(shortcuts[action].shortcut)"
                        data-shortcut-recorder
                        type="text"
                        readonly
                        class="focus-visible:outline-app-accent w-full min-w-0 cursor-pointer rounded-lg bg-transparent px-2 py-1 text-sm text-white focus:bg-white/5 focus-visible:outline-2"
                        @focus="selectedShortcutAction = action"
                        @click="selectedShortcutAction = action"
                        @keydown="recordShortcut($event, action)"
                      />
                    </td>
                    <td class="px-3 py-2 text-center">
                      <input
                        v-if="allowsGlobalShortcut(action)"
                        v-model="shortcuts[action].global"
                        :aria-label="`${t(shortcutLabels[action])} ${t('全局')}`"
                        :name="`shortcuts-global-${action}`"
                        type="checkbox"
                        class="accent-app-accent cursor-pointer"
                      />
                    </td>
                    <td class="px-2 py-1">
                      <button
                        v-if="
                          shortcuts[action].shortcut !== DEFAULT_SHORTCUTS[action].shortcut ||
                          shortcuts[action].global !== DEFAULT_SHORTCUTS[action].global
                        "
                        type="button"
                        :aria-label="`${t('恢复默认')} ${t(shortcutLabels[action])}`"
                        class="text-app-muted focus-visible:outline-app-accent rounded-lg p-2 hover:bg-white/10 hover:text-white focus-visible:outline-2"
                        @click="resetShortcut(action)"
                      >
                        <Undo2 :size="16" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </fieldset>
          <BackupOptions v-else-if="selectedCategory === 'backup'" @busy="isBackingUp = $event" />
          <fieldset v-else-if="selectedCategory === 'diagnostics'" :disabled="!isTauriApp">
            <legend class="sr-only">{{ t("诊断日志") }}</legend>
            <button
              type="button"
              class="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
              @click="openLogs"
            >
              {{ t("打开日志目录") }}
            </button>
            <label class="mt-5 flex items-center gap-3 text-sm">
              <input
                v-model="detailedLogging"
                :disabled="isChangingLogging"
                type="checkbox"
                class="accent-app-accent"
                @change="changeLogging"
              />
              {{ t("详细日志（下次启动恢复默认）") }}
            </label>
          </fieldset>
          <fieldset
            v-else-if="selectedCategory === 'monitoring'"
            class="flex min-h-0 min-w-0 flex-1 flex-col"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          >
            <legend class="sr-only">{{ t("监视文件夹") }}</legend>
            <MonitoringOptions v-model="monitoringFolders">
              <template #heading>
                <h3 class="mr-auto self-start text-sm font-semibold">{{ t("监视文件夹") }}</h3>
              </template>
            </MonitoringOptions>
          </fieldset>
          <fieldset v-else :disabled="!isTauriApp || !isLoaded || isLoading || isSaving">
            <legend class="sr-only">{{ t("媒体库") }}</legend>
            <h4 class="mb-3 text-sm font-semibold">{{ t("专辑排序") }}</h4>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="text-app-muted flex flex-col gap-2 text-sm">
                {{ t("排序依据") }}
                <select
                  v-model="albumSortBy"
                  class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
                >
                  <option value="name">{{ t("专辑名称") }}</option>
                  <option value="year">{{ t("发布日期") }}</option>
                </select>
              </label>
              <label class="text-app-muted flex flex-col gap-2 text-sm">
                {{ t("排序方向") }}
                <select
                  v-model="albumSortOrder"
                  class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
                >
                  <option value="ascending">{{ t("升序") }}</option>
                  <option value="descending">{{ t("降序") }}</option>
                </select>
              </label>
            </div>
            <label class="mt-5 flex items-center gap-3 text-sm">
              <input v-model="showPlaybackStatistics" type="checkbox" class="accent-app-accent" />
              {{ t("显示播放统计") }}
            </label>
          </fieldset>
        </section>
      </div>
      <p v-if="isLoading" class="text-app-muted px-5 pb-4 text-sm" role="status">
        {{ t("正在读取设置…") }}
      </p>
      <footer class="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          :disabled="isSaving || isBackingUp"
          type="button"
          @click="close"
        >
          {{ t("取消") }}
        </button>
        <button
          v-if="selectedCategory !== 'backup'"
          class="bg-app-accent focus-visible:outline-app-accent rounded-full px-5 py-2 text-sm font-semibold text-black hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isTauriApp || !isLoaded || isLoading || isSaving || isBackingUp"
          type="submit"
        >
          {{ isSaving ? t("正在保存…") : t("保存") }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
