<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { ref } from "vue";
import { usePathRemapping } from "@/features/remapping/usePathRemapping";

const dialogElement = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const { oldPath, newPath, isRemapping, isTauriApp, remap: remapPaths } = usePathRemapping();

function show() {
  if (dialogElement.value?.open || isRemapping.value) return;
  oldPath.value = "";
  newPath.value = "";
  dialogElement.value?.showModal();
}

function close() {
  if (isRemapping.value) return;
  dialogElement.value?.close();
}

async function remap() {
  if (await remapPaths()) dialogElement.value?.close();
}

defineExpose({ show });
</script>

<template>
  <dialog
    ref="dialogElement"
    aria-labelledby="path-remapping-title"
    class="bg-app-surface m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel="isRemapping && $event.preventDefault()"
    @click.self="close"
    @mousedown.stop
  >
    <form @submit.prevent="remap">
      <header class="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div class="flex items-center gap-2">
          <h2 id="path-remapping-title" class="text-lg font-semibold">{{ t("路径重映射") }}</h2>
        </div>
      </header>
      <fieldset :disabled="!isTauriApp || isRemapping" class="space-y-4 px-5 py-5">
        <legend class="sr-only">{{ t("替换路径前缀") }}</legend>
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
          :disabled="isRemapping"
          type="button"
          @click="close"
        >
          {{ t("取消") }}
        </button>
        <button
          class="bg-app-accent focus-visible:outline-app-accent text-app-on-accent rounded-full px-5 py-2 text-sm font-semibold hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isTauriApp || isRemapping || !oldPath.trim() || !newPath.trim()"
          type="submit"
        >
          {{ isRemapping ? t("正在重映射…") : t("重映射") }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
