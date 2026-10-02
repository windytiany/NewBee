<script setup lang="ts">
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { SETTINGS_CHANGED_EVENT, type Settings } from "@/settings/types";
import { applyTheme, THEMES } from "@/settings/theme";

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const closeBehavior = ref<Settings["closeBehavior"]>("tray");
const theme = ref<Settings["theme"]>("spotify");
const albumSortBy = ref<Settings["albumSortBy"]>("name");
const albumSortOrder = ref<Settings["albumSortOrder"]>("ascending");
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
    albumSortBy.value = settings.albumSortBy;
    albumSortOrder.value = settings.albumSortOrder;
    isLoaded.value = true;
  } catch (reason) {
    if (requestId === loadRequestSequence) {
      error.value = `读取配置失败：${errorMessage(reason)}`;
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
        albumSortBy: albumSortBy.value,
        albumSortOrder: albumSortOrder.value,
      },
    });
    applyTheme(theme.value);
    globalThis.window.dispatchEvent(new globalThis.Event(SETTINGS_CHANGED_EVENT));
    dialogElement.value?.close();
  } catch (reason) {
    error.value = `保存配置失败：${errorMessage(reason)}`;
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
    class="bg-spotify-surface m-auto max-h-[85vh] w-[min(28rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel="isSaving && $event.preventDefault()"
    @click.self="close"
    @mousedown.stop
  >
    <form @submit.prevent="save">
      <header class="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <h2 id="settings-dialog-title" class="text-lg font-semibold">配置</h2>
        <button
          aria-label="关闭配置"
          class="focus-visible:outline-spotify-green text-spotify-muted rounded px-2 py-1 text-sm hover:bg-white/10 hover:text-white focus-visible:outline-2 disabled:opacity-50"
          :disabled="isSaving"
          type="button"
          @click="close"
        >
          关闭
        </button>
      </header>
      <fieldset :disabled="!isTauriApp || !isLoaded || isLoading || isSaving" class="px-5 py-5">
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
        <p class="text-spotify-muted mt-3 text-xs">保存后立即生效，下次启动时自动恢复。</p>
      </fieldset>
      <fieldset
        :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
        class="border-t border-white/10 px-5 py-5"
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
          <span>
            <span class="block text-sm">缩小到托盘</span>
            <span class="text-spotify-muted mt-1 block text-xs"
              >继续播放音乐，点击托盘图标恢复窗口。</span
            >
          </span>
        </label>
        <label class="mt-2 flex cursor-pointer items-start gap-3 rounded-lg bg-white/5 px-3 py-3">
          <input
            v-model="closeBehavior"
            aria-describedby="close-behavior-description"
            class="accent-spotify-green mt-1"
            name="close-behavior"
            type="radio"
            value="exit"
          />
          <span>
            <span class="block text-sm">直接退出</span>
            <span class="text-spotify-muted mt-1 block text-xs">停止播放并退出软件。</span>
          </span>
        </label>
        <p class="text-spotify-muted mt-3 text-xs">托盘菜单中的“退出”始终会退出软件。</p>
      </fieldset>
      <fieldset
        :disabled="!isTauriApp || !isLoaded || isLoading || isSaving"
        class="border-t border-white/10 px-5 py-5"
      >
        <legend class="sr-only">Library 专辑排序</legend>
        <h3 class="mb-3 text-sm font-semibold">Library 专辑排序</h3>
        <div class="grid grid-cols-2 gap-3">
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
              <option value="ascending">升序（A → Z / 从旧到新）</option>
              <option value="descending">降序（Z → A / 从新到旧）</option>
            </select>
          </label>
        </div>
        <p class="text-spotify-muted mt-3 text-xs">
          按完整发布日期排序，专辑仍只显示年份。缺少日期的专辑排在最后，相同日期按名称排序。
        </p>
      </fieldset>
      <p v-if="isLoading" class="text-spotify-muted px-5 pb-4 text-sm" role="status">
        正在读取配置…
      </p>
      <p v-if="!isTauriApp" class="text-spotify-muted px-5 pb-4 text-sm">
        请在桌面应用中修改配置。
      </p>
      <p v-if="error" class="px-5 pb-4 text-sm text-red-400" role="alert">{{ error }}</p>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
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
