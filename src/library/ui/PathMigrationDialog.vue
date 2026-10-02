<script setup lang="ts">
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";
import { notify } from "@/notification/center";

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const oldPath = ref("");
const newPath = ref("");
const isMigrating = ref(false);
const isTauriApp = isTauri();

function show() {
  if (dialogElement.value?.open || isMigrating.value) return;
  oldPath.value = "";
  newPath.value = "";
  dialogElement.value?.showModal();
}

function close() {
  if (isMigrating.value) return;
  dialogElement.value?.close();
}

async function migrate() {
  if (!isTauriApp || isMigrating.value) return;
  const source = oldPath.value.trim();
  const target = newPath.value.trim();
  if (!source || !target || source === target) {
    notify({
      type: "warning",
      message: "请输入不同且非空的原路径和新路径。",
      key: "path-migration",
    });
    return;
  }
  isMigrating.value = true;
  try {
    const count = await invoke<number>("migrate_track_paths", { oldPath: source, newPath: target });
    notify({
      type: count > 0 ? "success" : "info",
      message:
        count > 0
          ? `路径迁移完成：已更新 ${count} 首曲目。`
          : "没有曲目匹配原路径前缀，未修改数据库。",
      key: "path-migration",
    });
    if (count > 0) dialogElement.value?.close();
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    notify({ type: "error", message: `路径迁移失败：${message}`, key: "path-migration" });
  } finally {
    isMigrating.value = false;
  }
}

defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="path-migration-title"
    class="bg-spotify-surface m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel="isMigrating && $event.preventDefault()"
    @click.self="close"
    @mousedown.stop
  >
    <form @submit.prevent="migrate">
      <header class="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <h2 id="path-migration-title" class="text-lg font-semibold">路径迁移</h2>
        <button
          aria-label="关闭路径迁移"
          class="focus-visible:outline-spotify-green text-spotify-muted rounded px-2 py-1 text-sm hover:bg-white/10 hover:text-white focus-visible:outline-2 disabled:opacity-50"
          :disabled="isMigrating"
          type="button"
          @click="close"
        >
          关闭
        </button>
      </header>
      <fieldset :disabled="!isTauriApp || isMigrating" class="space-y-4 px-5 py-5">
        <legend class="sr-only">替换曲目路径前缀</legend>
        <label class="flex flex-col gap-2 text-sm font-semibold">
          原路径
          <input
            v-model="oldPath"
            aria-describedby="path-migration-description"
            autocomplete="off"
            class="bg-spotify-interactive focus-visible:outline-spotify-green placeholder:text-spotify-muted rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
            placeholder="C:\Music\"
            spellcheck="false"
            type="text"
            required
          />
        </label>
        <label class="flex flex-col gap-2 text-sm font-semibold">
          新路径
          <input
            v-model="newPath"
            aria-describedby="path-migration-description"
            autocomplete="off"
            class="bg-spotify-interactive focus-visible:outline-spotify-green placeholder:text-spotify-muted rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
            placeholder="D:\Music\"
            spellcheck="false"
            type="text"
            required
          />
        </label>
        <p id="path-migration-description" class="text-spotify-muted text-xs leading-relaxed">
          按字面前缀匹配，区分大小写，只替换开头，后续路径保持不变。末尾的路径分隔符也参与替换，请在两处保持一致。
          Windows 路径支持普通写法和 \\?\ 写法。路径冲突时整批回滚。
        </p>
        <p class="text-spotify-muted text-xs leading-relaxed">
          仅更新数据库中的曲目路径，不移动或检查实际文件，不修改扫描目录配置。曲目信息、封面和歌单关系保持不变。
        </p>
      </fieldset>
      <p v-if="!isTauriApp" class="text-spotify-muted px-5 pb-4 text-sm">
        请在桌面应用中迁移路径。
      </p>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-spotify-green rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          :disabled="isMigrating"
          type="button"
          @click="close"
        >
          取消
        </button>
        <button
          class="bg-spotify-green focus-visible:outline-spotify-green rounded-full px-5 py-2 text-sm font-semibold text-black hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isTauriApp || isMigrating || !oldPath.trim() || !newPath.trim()"
          type="submit"
        >
          {{ isMigrating ? "正在迁移…" : "迁移路径" }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
