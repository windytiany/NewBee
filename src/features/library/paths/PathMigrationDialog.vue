<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { ref } from "vue";
import { usePathMigration } from "@/features/library/paths/usePathMigration";
import HelpDialog from "@/shared/components/HelpDialog.vue";

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const { oldPath, newPath, isMigrating, isTauriApp, migrate: migratePaths } = usePathMigration();

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
  if (await migratePaths()) dialogElement.value?.close();
}

defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="path-migration-title"
    class="bg-app-surface m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel="isMigrating && $event.preventDefault()"
    @click.self="close"
    @mousedown.stop
  >
    <form @submit.prevent="migrate">
      <header class="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div class="flex items-center gap-2">
          <h2 id="path-migration-title" class="text-lg font-semibold">{{ t("路径迁移") }}</h2>
          <HelpDialog :label="t('路径迁移说明')">
            <p>
              {{
                t(
                  "仅更新数据库中的曲目路径，不移动或检查实际文件，不修改扫描目录配置。 曲目信息、封面和歌单关系保持不变。",
                )
              }}
            </p>
            <p>
              {{
                t(
                  "按字面前缀匹配，区分大小写，只替换开头，后续路径保持不变。 末尾的路径分隔符也参与替换，请在两处保持一致。 Windows 路径支持普通写法和 \\\\?\\ 写法。路径冲突时整批回滚。",
                )
              }}
            </p>
          </HelpDialog>
        </div>
      </header>
      <fieldset :disabled="!isTauriApp || isMigrating" class="space-y-4 px-5 py-5">
        <legend class="sr-only">{{ t("替换曲目路径前缀") }}</legend>
        <label class="flex flex-col gap-2 text-sm font-semibold">
          {{ t("原路径") }}
          <input
            v-model="oldPath"
            autocomplete="off"
            class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
            spellcheck="false"
            type="text"
          />
        </label>
        <label class="flex flex-col gap-2 text-sm font-semibold">
          {{ t("新路径") }}
          <input
            v-model="newPath"
            autocomplete="off"
            class="bg-app-interactive focus-visible:outline-app-accent rounded-lg border border-white/10 px-3 py-2 font-normal text-white focus-visible:outline-2"
            spellcheck="false"
            type="text"
          />
        </label>
      </fieldset>
      <footer class="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button
          class="focus-visible:outline-app-accent rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
          :disabled="isMigrating"
          type="button"
          @click="close"
        >
          {{ t("取消") }}
        </button>
        <button
          class="bg-app-accent focus-visible:outline-app-accent rounded-full px-5 py-2 text-sm font-semibold text-black hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isTauriApp || isMigrating || !oldPath.trim() || !newPath.trim()"
          type="submit"
        >
          {{ isMigrating ? t("正在迁移…") : t("迁移路径") }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
