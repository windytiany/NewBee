<script setup lang="ts">
import { logger } from "@/shared/logging/logger";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createSettingsApi } from "@/features/settings/api";
import { ref } from "vue";
import { SETTINGS_CHANGED_EVENT } from "@/features/settings/events";
import type { Settings } from "@/features/settings/types";
import { applyTheme, THEMES } from "@/features/settings/theme";
import HelpDialog from "@/shared/components/HelpDialog.vue";

const api = createSettingsApi(invoke);
const detailedLogging = ref(false);
const isChangingLogging = ref(false);
async function changeLogging() {
  if (isChangingLogging.value) return;
  isChangingLogging.value = true;
  error.value = "";
  try {
    await invoke<void>("set_detailed_logging", { enabled: detailedLogging.value });
  } catch (reason) {
    logger.error("settings", "logging_level_change_failed", reason);
    detailedLogging.value = !detailedLogging.value;
    error.value = `切换日志级别失败：${errorMessage(reason)}`;
  } finally {
    isChangingLogging.value = false;
  }
}
async function openLogs() {
  error.value = "";
  try {
    await invoke<void>("open_logs_directory");
  } catch (reason) {
    logger.error("settings", "open_logs_failed", reason);
    error.value = `打开日志目录失败：${errorMessage(reason)}`;
  }
}

const categories = {
  general: "常规",
  appearance: "外观",
  library: "媒体库",
  lyrics: "歌词",
  diagnostics: "诊断",
} as const;
const selectedCategory = ref<keyof typeof categories>("general");
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const closeBehavior = ref<Settings["closeBehavior"]>("tray");
const theme = ref<Settings["theme"]>("spotify");
const albumCoverBackground = ref(false);
const playingCoverBackground = ref(false);
const albumSortBy = ref<Settings["albumSortBy"]>("name");
const albumSortOrder = ref<Settings["albumSortOrder"]>("ascending");
const neteaseEnabled = ref(true);
const neteaseLyricsMode = ref<Settings["neteaseLyricsMode"]>("original");
const isLoading = ref(false);
const isLoaded = ref(false);
const isSaving = ref(false);
const error = ref("");
const isTauriApp = isTauri();
let loadRequestSequence = 0;

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

async function show() {
  if (dialogElement.value?.open) return;
  selectedCategory.value = "general";
  dialogElement.value?.showModal();
  error.value = "";
  isLoaded.value = false;
  const requestId = ++loadRequestSequence;
  if (!isTauriApp) return;
  isLoading.value = true;
  try {
    const settings = await api.get();
    if (requestId !== loadRequestSequence) return;
    closeBehavior.value = settings.closeBehavior;
    theme.value = settings.theme;
    albumCoverBackground.value = settings.albumCoverBackground;
    playingCoverBackground.value = settings.playingCoverBackground;
    albumSortBy.value = settings.albumSortBy;
    albumSortOrder.value = settings.albumSortOrder;
    neteaseEnabled.value = settings.lyricsProviders.includes("netease");
    neteaseLyricsMode.value = settings.neteaseLyricsMode;
    isLoaded.value = true;
  } catch (reason) {
    if (requestId === loadRequestSequence) {
      logger.error("settings", "load_failed", reason);
      error.value = `读取设置失败：${errorMessage(reason)}`;
    }
  } finally {
    if (requestId === loadRequestSequence) isLoading.value = false;
  }
}

function close() {
  if (isSaving.value) return;
  dialogElement.value?.close();
}

async function save() {
  if (!isTauriApp || !isLoaded.value || isLoading.value || isSaving.value) return;
  isSaving.value = true;
  error.value = "";
  try {
    await api.save({
      closeBehavior: closeBehavior.value,
      theme: theme.value,
      albumCoverBackground: albumCoverBackground.value,
      playingCoverBackground: playingCoverBackground.value,
      albumSortBy: albumSortBy.value,
      albumSortOrder: albumSortOrder.value,
      lyricsProviders: neteaseEnabled.value ? ["netease"] : [],
      neteaseLyricsMode: neteaseLyricsMode.value,
    });
    applyTheme(theme.value);
    globalThis.window.dispatchEvent(new globalThis.Event(SETTINGS_CHANGED_EVENT));
    dialogElement.value?.close();
  } catch (reason) {
    logger.error("settings", "save_failed", reason);
    error.value = `保存设置失败：${errorMessage(reason)}`;
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
    class="bg-app-surface m-auto w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel="isSaving && $event.preventDefault()"
    @click.self="close"
    @mousedown.stop
  >
    <form class="flex h-[min(36rem,85dvh)] flex-col" @submit.prevent="save">
      <header class="shrink-0 border-b border-white/10 px-5 py-4">
        <h2 id="settings-dialog-title" class="text-lg font-semibold">设置</h2>
      </header>
      <div
        class="grid min-h-0 flex-1 grid-cols-[7rem_minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)]"
      >
        <nav
          aria-label="设置分类"
          class="bg-app-base/40 overflow-y-auto border-r border-white/10 p-2 sm:p-3"
        >
          <button
            v-for="(label, category) in categories"
            :key="category"
            :aria-current="selectedCategory === category ? 'true' : undefined"
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
            {{ label }}
          </button>
        </nav>
        <section
          id="settings-category-panel"
          aria-labelledby="settings-category-title"
          class="min-w-0 overflow-y-auto p-5 sm:p-6"
        >
          <div class="mb-6 flex items-center gap-2">
            <h3 id="settings-category-title" class="text-base font-semibold">
              {{ categories[selectedCategory] }}
            </h3>
            <HelpDialog :key="selectedCategory" :label="`${categories[selectedCategory]}设置说明`">
              <template v-if="selectedCategory === 'general'">
                <p>缩小到托盘时继续播放，点击托盘图标恢复窗口；直接退出时停止播放并退出。</p>
                <p>托盘菜单中的“退出”始终会退出软件。</p>
              </template>
              <template v-else-if="selectedCategory === 'appearance'">
                <p>
                  专辑详情和播放页的封面背景可分别开关；启用后使用封面生成的模糊背景，关闭后使用默认背景。
                </p>
                <p>保存后立即生效，下次启动时自动恢复。</p>
              </template>
              <template v-else-if="selectedCategory === 'lyrics'">
                <p>按启用的来源顺序获取歌词，无需登录网易云。</p>
                <p>网易云歌词可以选择原始歌词、翻译歌词或双语歌词。</p>
                <p>当前批量操作下载成功后直接覆盖内嵌歌词，不检查是否缺少。</p>
              </template>
              <template v-else-if="selectedCategory === 'diagnostics'">
                <p>日志仅保存在本机，最多保留约 30 MB。分享前请检查文件路径等隐私信息。</p>
                <p>详细日志立即生效，下次启动恢复普通日志。不记录歌词正文或封面数据。</p>
              </template>
              <template v-else>
                <p>按完整发布日期排序，专辑仍只显示年份。</p>
                <p>缺少日期的专辑排在最后，相同日期按名称排序。</p>
                <p>升序为 A → Z 或从旧到新；降序为 Z → A 或从新到旧。</p>
              </template>
            </HelpDialog>
          </div>
          <fieldset
            v-if="selectedCategory === 'appearance'"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          >
            <legend class="sr-only">外观</legend>
            <label class="flex flex-col gap-2 text-sm font-semibold">
              主题
              <select
                v-model="theme"
                class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
              >
                <option v-for="option in THEMES" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
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
              <span class="text-sm font-semibold">专辑详情封面背景</span>
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
              <span class="text-sm font-semibold">播放页封面背景</span>
            </label>
          </fieldset>
          <fieldset
            v-else-if="selectedCategory === 'general'"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          >
            <legend class="sr-only">关闭窗口时的行为</legend>
            <p id="close-behavior-description" class="mb-3 text-sm font-semibold">关闭窗口时</p>
            <label class="flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3">
              <input
                v-model="closeBehavior"
                aria-describedby="close-behavior-description"
                class="accent-app-accent mt-1"
                name="close-behavior"
                type="radio"
                value="tray"
              />
              <span class="text-sm">缩小到托盘</span>
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
              <span class="text-sm">直接退出</span>
            </label>
          </fieldset>
          <fieldset
            v-else-if="selectedCategory === 'lyrics'"
            :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          >
            <legend class="sr-only">歌词来源</legend>
            <h4 class="mb-3 text-sm font-semibold">歌词来源</h4>
            <label class="flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3">
              <input
                v-model="neteaseEnabled"
                type="checkbox"
                name="netease-lyrics"
                class="accent-app-accent mt-1"
              />
              <span class="text-sm">网易云音乐</span>
            </label>
            <label class="mt-5 flex flex-col gap-2 text-sm font-semibold">
              网易云歌词内容
              <select
                v-model="neteaseLyricsMode"
                name="netease-lyrics-mode"
                class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
              >
                <option value="original">原始歌词</option>
                <option value="translated">翻译歌词</option>
                <option value="bilingual">双语歌词</option>
              </select>
            </label>
          </fieldset>
          <fieldset v-else-if="selectedCategory === 'diagnostics'" :disabled="!isTauriApp">
            <legend class="sr-only">诊断日志</legend>
            <button
              type="button"
              class="rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
              @click="openLogs"
            >
              打开日志目录
            </button>
            <label class="mt-5 flex items-center gap-3 text-sm">
              <input
                v-model="detailedLogging"
                :disabled="isChangingLogging"
                type="checkbox"
                class="accent-app-accent"
                @change="changeLogging"
              />
              详细日志（下次启动恢复默认）
            </label>
            <p class="text-app-muted mt-3 text-sm">日志仅保存在本机。分享前请检查路径隐私。</p>
          </fieldset>
          <fieldset v-else :disabled="!isTauriApp || !isLoaded || isLoading || isSaving">
            <legend class="sr-only">专辑排序</legend>
            <h4 class="mb-3 text-sm font-semibold">专辑排序</h4>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="text-app-muted flex flex-col gap-2 text-sm">
                排序依据
                <select
                  v-model="albumSortBy"
                  class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
                >
                  <option value="name">专辑名称</option>
                  <option value="year">发布日期</option>
                </select>
              </label>
              <label class="text-app-muted flex flex-col gap-2 text-sm">
                排序方向
                <select
                  v-model="albumSortOrder"
                  class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
                >
                  <option value="ascending">升序</option>
                  <option value="descending">降序</option>
                </select>
              </label>
            </div>
          </fieldset>
        </section>
      </div>
      <p v-if="isLoading" class="text-app-muted px-5 pb-4 text-sm" role="status">正在读取设置…</p>
      <p v-if="!isTauriApp" class="text-app-muted px-5 pb-4 text-sm">请在桌面应用中修改设置。</p>
      <p v-if="error" class="px-5 pb-4 text-sm text-red-400" role="alert">{{ error }}</p>
      <footer class="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          :disabled="isSaving"
          type="button"
          @click="close"
        >
          取消
        </button>
        <button
          class="bg-app-accent focus-visible:outline-app-accent rounded-full px-5 py-2 text-sm font-semibold text-black hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          type="submit"
        >
          {{ isSaving ? "正在保存…" : "保存" }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
