<template>
  <dialog
    ref="dialog"
    :aria-label="t('添加图片')"
    class="bg-app-surface m-auto w-[34rem] max-w-[calc(100vw-2rem)] rounded-md border border-white/20 p-5 text-white shadow-xl backdrop:bg-black/60"
    @cancel.prevent.stop="cancel"
    @keydown.esc.stop
  >
    <form @submit.prevent="confirm">
      <h2 class="mb-5 text-base font-semibold">{{ t("添加图片") }}</h2>
      <div class="grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-5 max-[480px]:grid-cols-1">
        <div class="min-w-0 space-y-4">
          <fieldset :disabled="working" class="space-y-3">
            <legend class="mb-3 text-sm">{{ t("保存方式") }}</legend>
            <label class="flex items-center gap-2 text-sm">
              <input
                :checked="storage === 'embedded'"
                type="radio"
                name="artwork-storage"
                value="embedded"
                class="accent-app-accent"
                autofocus
                @change="storage = 'embedded'"
              />
              {{ t("内嵌到音频") }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input
                :checked="storage === 'linked'"
                type="radio"
                name="artwork-storage"
                value="linked"
                class="accent-app-accent"
                @change="storage = 'linked'"
              />
              {{ t("关联路径") }}
            </label>
          </fieldset>
          <label v-if="path" class="block space-y-1.5 text-sm">
            <span>{{ t("图片路径") }}</span>
            <input
              :value="path"
              readonly
              class="bg-app-surface w-full rounded-sm border border-white/25 px-2 py-1.5"
            />
          </label>
        </div>
        <div
          class="flex aspect-square w-36 items-center justify-center border border-white/20 bg-black/10"
        >
          <img :src="url" :alt="t('封面')" class="max-h-full max-w-full object-contain" />
        </div>
      </div>
      <div class="mt-6 flex justify-end gap-2">
        <button
          type="submit"
          :disabled="working || storage === null"
          class="focus-visible:outline-app-accent rounded-sm border border-white/20 bg-white/5 px-5 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
        >
          {{ t("确定") }}
        </button>
        <button
          type="button"
          :disabled="working"
          class="focus-visible:outline-app-accent rounded-sm border border-white/20 bg-white/5 px-5 py-1.5 text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-40"
          @click="cancel"
        >
          {{ t("取消") }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from "vue";
import type { PictureStorage } from "@/features/artwork/collection/useAddition";
import { t } from "@/shared/i18n/locale";
const props = defineProps<{ url: string; path?: string; working: boolean }>();
const emit = defineEmits<{ confirm: [storage: PictureStorage]; cancel: [] }>();
const dialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const storage = ref<PictureStorage | null>(null);
function confirm() {
  if (!props.working && storage.value) emit("confirm", storage.value);
}
function cancel() {
  if (!props.working) emit("cancel");
}
onMounted(() => dialog.value?.showModal());
onScopeDispose(() => dialog.value?.close());
</script>
