<script setup lang="ts">
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { SETTINGS_CHANGED_EVENT, type Settings } from "@/settings/types";
import { applyTheme, THEMES } from "@/settings/theme";
import InfoHelp from "@/ui/InfoHelp.vue";

const categories = {
  general: "常规",
  appearance: "外观",
  library: "媒体库",
  lyrics: "歌词",
} as const;
const selectedCategory = ref<keyof typeof categories>("general");
const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const closeBehavior = ref<Settings["closeBehavior"]>("tray");
const theme = ref<Settings["theme"]>("spotify");
const albumCoverBackground = ref(false);
const albumSortBy = ref<Settings["albumSortBy"]>("name");
const albumSortOrder = ref<Settings["albumSortOrder"]>("ascending");
const neteaseEnabled = ref(true);
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
    const settings = await invoke<Settings>("get_settings");
    if (requestId !== loadRequestSequence) return;
    closeBehavior.value = settings.closeBehavior;
    theme.value = settings.theme;
    albumCoverBackground.value = settings.albumCoverBackground;
    albumSortBy.value = settings.albumSortBy;
    albumSortOrder.value = settings.albumSortOrder;
    neteaseEnabled.value = settings.lyricsProviders.includes("netease");
    isLoaded.value = true;
  } catch (reason) {
    if (requestId === loadRequestSequence) {
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
    await invoke("save_settings", {
      settings: {
        closeBehavior: closeBehavior.value,
        theme: theme.value,
        albumCoverBackground: albumCoverBackground.value,
        albumSortBy: albumSortBy.value,
        albumSortOrder: albumSortOrder.value,
        lyricsProviders: neteaseEnabled.value ? ["netease"] : [],
      },
    });
    applyTheme(theme.value);
    globalThis.window.dispatchEvent(new globalThis.Event(SETTINGS_CHANGED_EVENT));
    dialogElement.value?.close();
  } catch (reason) {
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
    class="bg-spotify-surface m-auto w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
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
          class="bg-spotify-base/40 overflow-y-auto border-r border-white/10 p-2 sm:p-3"
        >
          <button
            v-for="(label, category) in categories"
            :key="category"
            :aria-current="selectedCategory === category ? 'true' : undefined"
            aria-controls="settings-category-panel"
            class="focus-visible:outline-spotify-green mb-1 w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="
              selectedCategory === category
                ? 'bg-spotify-green text-black'
                : 'text-spotify-muted hover:bg-white/5 hover:text-white'
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
            <InfoHelp :key="selectedCategory" :label="`${categories[selectedCategory]}设置说明`">
              <template v-if="selectedCategory === 'general'">
                <p>缩小到托盘时继续播放，点击托盘图标恢复窗口；直接退出时停止播放并退出。</p>
                <p>托盘菜单中的“退出”始终会退出软件。</p>
              </template>
              <template v-else-if="selectedCategory === 'appearance'">
                <p>启用专辑封面背景后，展开专辑时使用封面生成的模糊背景；关闭后使用默认背景。</p>
                <p>保存后立即生效，下次启动时自动恢复。</p>
              </template>
              <template v-else-if="selectedCategory === 'lyrics'">
                <p>按启用的来源顺序获取歌词，无需登录网易云。</p>
                <p>当前批量操作下载成功后直接覆盖内嵌歌词，不检查是否缺少。</p>
              </template>
              <template v-else>
                <p>按完整发布日期排序，专辑仍只显示年份。</p>
                <p>缺少日期的专辑排在最后，相同日期按名称排序。</p>
                <p>升序为 A → Z 或从旧到新；降序为 Z → A 或从新到旧。</p>
              </template>
            </InfoHelp>
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
                class="bg-spotify-interactive focus-visible:outline-spotify-green rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
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
                class="accent-spotify-green mt-1"
                name="album-cover-background"
                type="checkbox"
              />
              <span class="text-sm font-semibold">专辑封面背景</span>
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
                class="accent-spotify-green mt-1"
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
                class="accent-spotify-green mt-1"
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
                class="accent-spotify-green mt-1"
              />
              <span class="text-sm">网易云音乐</span>
            </label>
          </fieldset>
          <fieldset v-else :disabled="!isTauriApp || !isLoaded || isLoading || isSaving">
            <legend class="sr-only">专辑排序</legend>
            <h4 class="mb-3 text-sm font-semibold">专辑排序</h4>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="text-spotify-muted flex flex-col gap-2 text-sm">
                排序依据
                <select
                  v-model="albumSortBy"
                  class="bg-spotify-interactive focus-visible:outline-spotify-green rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
                >
                  <option value="name">专辑名称</option>
                  <option value="year">发布日期</option>
                </select>
              </label>
              <label class="text-spotify-muted flex flex-col gap-2 text-sm">
                排序方向
                <select
                  v-model="albumSortOrder"
                  class="bg-spotify-interactive focus-visible:outline-spotify-green rounded-lg border border-white/10 px-3 py-2 text-white focus-visible:outline-2"
                >
                  <option value="ascending">升序</option>
                  <option value="descending">降序</option>
                </select>
              </label>
            </div>
          </fieldset>
        </section>
      </div>
      <p v-if="isLoading" class="text-spotify-muted px-5 pb-4 text-sm" role="status">
        正在读取设置…
      </p>
      <p v-if="!isTauriApp" class="text-spotify-muted px-5 pb-4 text-sm">
        请在桌面应用中修改设置。
      </p>
      <p v-if="error" class="px-5 pb-4 text-sm text-red-400" role="alert">{{ error }}</p>
      <footer class="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-spotify-green rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          :disabled="isSaving"
          type="button"
          @click="close"
        >
          取消
        </button>
        <button
          class="bg-spotify-green focus-visible:outline-spotify-green rounded-full px-5 py-2 text-sm font-semibold text-black hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
          type="submit"
        >
          {{ isSaving ? "正在保存…" : "保存" }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
