<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useAlbumTagEditor } from "@/albumTags/editor";
import { METADATA_FIELDS } from "@/metadata/model";
import ReleaseSearch from "@/albumTags/ui/ReleaseSearch.vue";
import AlbumTagFields from "@/albumTags/ui/AlbumTagFields.vue";
import TrackMapping from "@/albumTags/ui/TrackMapping.vue";
const editor = useAlbumTagEditor();
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
    ...METADATA_FIELDS.flatMap((field) => (keys.has(field.key) ? [field.label] : [])),
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
    class="bg-spotify-surface m-auto max-h-[92vh] w-[min(72rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-white/10 p-0 text-white shadow-2xl backdrop:bg-black/70"
    @cancel.prevent="editor.requestClose()"
    @mousedown.stop
  >
    <header class="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
      <h2 id="album-tags-title" class="text-lg font-semibold">根据专辑更新标签</h2>
      <button
        type="button"
        :disabled="state.saving"
        aria-label="关闭标签更新窗口"
        class="rounded px-3 py-1 hover:bg-white/10 disabled:opacity-50"
        @click="editor.requestClose()"
      >
        关闭
      </button>
    </header>
    <div v-if="state.open" class="space-y-5 p-5">
      <p v-if="state.loading" role="status" class="text-spotify-muted text-sm">读取本地曲目中…</p>
      <p v-if="state.error" role="alert" class="text-sm whitespace-pre-wrap text-red-200">
        {{ state.error }}
      </p>
      <ReleaseSearch :editor="editor" :disabled="disabled" />
      <template v-if="state.selected">
        <p class="text-sm">
          已选择：{{ state.selected.summary.artist }} · {{ state.selected.summary.title }} ·
          {{ state.selected.summary.releaseDate ?? "日期缺失" }} ·
          {{ state.selected.summary.country ?? "国家缺失"
          }}<span
            v-if="state.selected.summary.trackCount !== state.tracks.length"
            class="ml-2 text-amber-200"
            >来源 {{ state.selected.summary.trackCount }} 首 / 本地
            {{ state.tracks.length }} 首</span
          >
        </p>
        <AlbumTagFields :editor="editor" :disabled="disabled || state.loadingRelease" />
        <TrackMapping :editor="editor" :disabled="disabled || state.loadingRelease" />
      </template>
      <div v-if="state.saving" role="status" aria-live="polite" class="space-y-2 text-sm">
        <p>正在保存 {{ state.completed }} / {{ state.total }}</p>
        <progress :value="state.completed" :max="state.total" class="w-full"></progress>
      </div>
      <section v-if="state.results.length" aria-label="逐曲保存结果" class="space-y-2 text-sm">
        <p>{{ state.results.length - failed.length }} 首成功，{{ failed.length }} 首失败。</p>
        <p
          v-for="result in state.results"
          :key="result.trackId"
          :class="result.databaseUpdated ? 'text-spotify-muted' : 'text-red-200'"
          class="break-all"
        >
          {{ result.path }}：{{ result.error ?? "保存成功" }}
        </p>
      </section>
      <section
        v-if="state.confirmSave"
        aria-label="确认覆盖标签"
        class="space-y-3 rounded border border-amber-200/30 p-4 text-sm"
      >
        <p>将向 {{ state.patches.length }} 首曲目写入实际改动：{{ pendingFields.join("、") }}。</p>
        <p class="text-amber-200">
          将覆盖音频文件中的所选标签。保存后不可撤销，也不会生成永久备份；部分失败不会回滚已成功曲目。
        </p>
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="rounded px-3 py-2 hover:bg-white/10"
            @click="state.confirmSave = false"
          >
            返回核对</button
          ><button
            type="button"
            class="bg-spotify-green rounded px-3 py-2 font-semibold text-black"
            @click="editor.save()"
          >
            确认写入
          </button>
        </div>
      </section>
    </div>
    <footer class="flex justify-end gap-3 border-t border-white/10 px-5 py-4">
      <button
        type="button"
        :disabled="state.saving"
        class="rounded px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
        @click="editor.requestClose()"
      >
        取消
      </button>
      <button
        v-if="failed.length"
        type="button"
        :disabled="disabled"
        class="rounded border border-white/20 px-4 py-2 text-sm disabled:opacity-50"
        @click="editor.retryFailed()"
      >
        仅重试失败项
      </button>
      <button
        type="button"
        :disabled="disabled || state.loadingRelease || !state.selected"
        class="bg-spotify-green rounded px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
        @click="editor.prepareSave()"
      >
        保存
      </button>
    </footer>
  </dialog>
  <dialog
    ref="discardDialog"
    role="alertdialog"
    aria-labelledby="album-tags-discard-title"
    aria-describedby="album-tags-discard-description"
    class="bg-spotify-surface m-auto w-[min(24rem,calc(100vw-2rem))] max-w-none space-y-4 rounded-xl border border-white/10 p-5 text-white backdrop:bg-black/50"
    @cancel.prevent="state.confirmDiscard = false"
    @mousedown.stop
  >
    <h2 id="album-tags-discard-title" class="font-semibold">丢弃调整？</h2>
    <p id="album-tags-discard-description" class="text-spotify-muted text-sm">
      未保存的字段、封面选择和曲目对应调整将丢失。已写入文件的改动不会撤销。
    </p>
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
