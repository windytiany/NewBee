<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, nextTick, ref, watch } from "vue";
import { useReleaseEditor } from "@/features/metadata/releases/useEditor";
import { TAG_FIELDS } from "@/features/metadata/draft";
import ReleaseSearch from "@/features/metadata/releases/ReleaseSearch.vue";
import TagFields from "@/features/metadata/releases/TagFields.vue";
import TrackMapping from "@/features/metadata/releases/TrackMapping.vue";
const editor = useReleaseEditor();
const state = editor.state;
const dialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const discardDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const saveDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const disabled = computed(
  () => state.loading || state.saving || state.confirmSave || state.confirmDiscard,
);
const pendingFields = computed(() => {
  const keys = new Set(
    state.patches.flatMap((patch) => patch.changes.map((change) => change.field)),
  );
  return [
    ...TAG_FIELDS.flatMap((field) => (keys.has(field.key) ? [t(field.label)] : [])),
    ...(state.patches.some((patch) => patch.writeCover) ? [t("正面封面")] : []),
  ];
});
watch(
  () => [state.open, state.confirmDiscard, state.confirmSave],
  async () => {
    await nextTick();
    if ((!state.open || !state.confirmSave) && saveDialog.value?.open) saveDialog.value.close();
    if ((!state.open || !state.confirmDiscard) && discardDialog.value?.open)
      discardDialog.value.close();
    if (state.open && !dialog.value?.open) dialog.value?.showModal();
    else if (!state.open && dialog.value?.open) dialog.value.close();
    if (state.open && state.confirmDiscard && !discardDialog.value?.open)
      discardDialog.value?.showModal();
    if (state.open && state.confirmSave && !saveDialog.value?.open) saveDialog.value?.showModal();
  },
  { immediate: true },
);
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="album-tags-title"
    class="bg-app-surface m-auto h-fit max-h-[calc(100dvh-16px)] w-[min(1040px,calc(100vw-16px))] max-w-none overflow-hidden rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="editor.requestClose()"
    @mousedown.stop
  >
    <header class="flex h-[36px] items-center justify-between gap-2 border-b border-white/10 px-2">
      <h2 id="album-tags-title" class="text-sm font-semibold">{{ t("根据专辑更新标签") }}</h2>
    </header>
    <div
      v-if="state.open"
      class="flex max-h-[calc(100dvh_-_52px)] flex-col gap-[8px] overflow-y-auto p-[8px]"
    >
      <p v-if="state.loading" role="status" class="text-app-muted text-sm">
        {{ t("读取本地曲目中…") }}
      </p>
      <ReleaseSearch :editor="editor" :disabled="disabled" class="shrink-0" />
      <div
        class="grid shrink-0 grid-cols-[minmax(0,1fr)_80px] gap-[8px] border-y border-white/10 py-[8px]"
      >
        <TagFields :editor="editor" :disabled="disabled || state.loadingRelease" />
        <div class="flex flex-col gap-1">
          <button
            type="button"
            :disabled="
              disabled ||
              state.loadingRelease ||
              !state.selected ||
              !state.rows.some(
                (row) =>
                  row.source !== null &&
                  row.trackId !== null &&
                  state.included.includes(row.trackId),
              )
            "
            class="bg-app-accent text-app-on-accent rounded px-3 py-1 text-xs font-semibold disabled:opacity-50"
            @click="editor.prepareSave()"
          >
            {{ t("应用") }}
          </button>
          <button
            type="button"
            :disabled="state.saving"
            class="rounded border border-white/15 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
            @click="editor.requestClose()"
          >
            {{ t("取消") }}
          </button>
        </div>
      </div>
      <div v-if="state.saving" role="status" aria-live="polite" class="shrink-0 text-xs">
        <p>{{ t("正在保存 {count} / {total}", { count: state.completed, total: state.total }) }}</p>
        <progress :value="state.completed" :max="state.total" class="w-full"></progress>
      </div>
      <TrackMapping
        :editor="editor"
        :disabled="disabled || state.loadingRelease"
        class="shrink-0"
      />
    </div>
  </dialog>
  <dialog
    ref="saveDialog"
    role="alertdialog"
    :aria-label="t('确认覆盖标签')"
    aria-labelledby="album-tags-save-title"
    class="bg-app-surface m-auto w-[min(24rem,calc(100vw-2rem))] max-w-none space-y-4 rounded-xl border border-white/10 p-5 text-white backdrop:bg-black/50"
    @cancel.prevent="state.confirmSave = false"
    @mousedown.stop
  >
    <h2 id="album-tags-save-title" class="font-semibold">{{ t("确认覆盖标签") }}</h2>
    <p class="text-sm">
      {{
        t("{count} 首 · {fields}", {
          count: state.patches.length,
          fields: pendingFields.join(" / "),
        })
      }}
    </p>
    <div class="flex justify-end gap-3">
      <button
        type="button"
        autofocus
        class="rounded px-3 py-2 hover:bg-white/10"
        @click="state.confirmSave = false"
      >
        {{ t("返回") }}
      </button>
      <button
        type="button"
        class="bg-app-accent text-app-on-accent rounded px-3 py-2 font-semibold"
        @click="editor.save()"
      >
        {{ t("确认") }}
      </button>
    </div>
  </dialog>
  <dialog
    ref="discardDialog"
    role="alertdialog"
    aria-labelledby="album-tags-discard-title"
    class="bg-app-surface m-auto w-[min(24rem,calc(100vw-2rem))] max-w-none space-y-4 rounded-xl border border-white/10 p-5 text-white backdrop:bg-black/50"
    @cancel.prevent="state.confirmDiscard = false"
    @mousedown.stop
  >
    <h2 id="album-tags-discard-title" class="font-semibold">{{ t("丢弃调整？") }}</h2>
    <div class="flex justify-end gap-3">
      <button
        type="button"
        autofocus
        class="rounded px-3 py-2 hover:bg-white/10"
        @click="state.confirmDiscard = false"
      >
        {{ t("取消") }}</button
      ><button type="button" class="rounded bg-red-500 px-3 py-2" @click="editor.confirmDiscard()">
        {{ t("丢弃") }}
      </button>
    </div>
  </dialog>
</template>
