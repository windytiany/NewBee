<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useReleaseEditor } from "@/features/tags/releases/useEditor";
import { TAG_FIELDS } from "@/features/tags/draft";
import ReleaseSearch from "@/features/tags/releases/components/ReleaseSearch.vue";
import TagFields from "@/features/tags/releases/components/TagFields.vue";
import TrackMapping from "@/features/tags/releases/components/TrackMapping.vue";
const editor = useReleaseEditor();
const state = editor.state;
const dialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const discardDialog = ref<InstanceType<typeof globalThis.HTMLDialogElement> | null>(null);
const disabled = computed(
  () => state.loading || state.saving || state.confirmSave || state.confirmDiscard,
);
const failed = computed(() => state.results.filter((result) => !result.databaseUpdated));
const pendingFields = computed(() => {
  const keys = new Set(
    state.patches.flatMap((patch) => patch.changes.map((change) => change.field)),
  );
  return [
    ...TAG_FIELDS.flatMap((field) => (keys.has(field.key) ? [field.label] : [])),
    ...(state.patches.some((patch) => patch.writeCover) ? ["正面封面"] : []),
  ];
});
watch(
  () => [state.open, state.confirmDiscard],
  async () => {
    await nextTick();
    if (!state.confirmDiscard && discardDialog.value?.open) discardDialog.value.close();
    if (state.open && !dialog.value?.open) dialog.value?.showModal();
    else if (!state.open && dialog.value?.open) dialog.value.close();
    if (state.open && state.confirmDiscard && !discardDialog.value?.open)
      discardDialog.value?.showModal();
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
      <h2 id="album-tags-title" class="text-sm font-semibold">根据专辑更新标签</h2>
    </header>
    <div
      v-if="state.open"
      class="flex max-h-[calc(100dvh_-_52px)] flex-col gap-[8px] overflow-y-auto p-[8px]"
    >
      <p v-if="state.loading" role="status" class="text-app-muted text-sm">读取本地曲目中…</p>
      <p v-if="state.error" role="alert" class="text-sm whitespace-pre-wrap text-red-200">
        {{ state.error }}
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
            class="bg-app-accent rounded px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
            @click="editor.prepareSave()"
          >
            应用
          </button>
          <button
            type="button"
            :disabled="state.saving"
            class="rounded border border-white/15 px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
            @click="editor.requestClose()"
          >
            取消
          </button>
          <button
            v-if="failed.length"
            type="button"
            :disabled="disabled"
            class="rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-50"
            @click="editor.retryFailed()"
          >
            仅重试失败项
          </button>
          <p
            v-if="state.selected && state.selected.summary.trackCount !== state.tracks.length"
            class="text-xs text-amber-200"
          >
            来源 {{ state.selected.summary.trackCount }} 首 / 本地 {{ state.tracks.length }} 首
          </p>
        </div>
      </div>
      <div v-if="state.saving" role="status" aria-live="polite" class="shrink-0 text-xs">
        <p>正在保存 {{ state.completed }} / {{ state.total }}</p>
        <progress :value="state.completed" :max="state.total" class="w-full"></progress>
      </div>
      <section
        v-if="state.results.length"
        aria-label="逐曲保存结果"
        class="max-h-20 shrink-0 overflow-auto text-xs"
      >
        <p>{{ state.results.length - failed.length }} 首成功，{{ failed.length }} 首失败。</p>
        <p
          v-for="result in state.results"
          :key="result.trackId"
          :class="result.databaseUpdated ? 'text-app-muted' : 'text-red-200'"
          class="break-all"
        >
          {{ result.path }}：{{ result.error ?? "保存成功" }}
        </p>
      </section>
      <section
        v-if="state.confirmSave"
        aria-label="确认覆盖标签"
        class="flex shrink-0 items-center justify-between gap-2 rounded border border-amber-200/30 px-2 py-1 text-xs"
      >
        <p class="min-w-0 truncate">
          {{ state.patches.length }} 首 · {{ pendingFields.join("、") }}
        </p>
        <div class="flex shrink-0 gap-2">
          <button
            type="button"
            class="rounded px-2 py-1 hover:bg-white/10"
            @click="state.confirmSave = false"
          >
            返回核对</button
          ><button
            type="button"
            class="bg-app-accent rounded px-2 py-1 font-semibold text-black"
            @click="editor.save()"
          >
            确认写入
          </button>
        </div>
      </section>
      <TrackMapping
        :editor="editor"
        :disabled="disabled || state.loadingRelease"
        class="shrink-0"
      />
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
    <h2 id="album-tags-discard-title" class="font-semibold">丢弃调整？</h2>
    <div class="flex justify-end gap-3">
      <button
        type="button"
        autofocus
        class="rounded px-3 py-2 hover:bg-white/10"
        @click="state.confirmDiscard = false"
      >
        取消</button
      ><button type="button" class="rounded bg-red-500 px-3 py-2" @click="editor.confirmDiscard()">
        丢弃调整
      </button>
    </div>
  </dialog>
</template>
