<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, onScopeDispose, ref, watch } from "vue";
import type { createReleaseEditor } from "@/features/metadata/releases/useEditor";
import type { AlbumField } from "@/features/metadata/releases/types";
import { TAG_FIELDS } from "@/features/metadata/draft";
const props = defineProps<{ editor: ReturnType<typeof createReleaseEditor>; disabled: boolean }>();
const state = props.editor.state;
const sharedKeys: AlbumField[] = [
  "albumArtist",
  "album",
  "albumArtistSort",
  "discSubtitle",
  "label",
  "discNumber",
  "discTotal",
  "releaseDate",
  "originalReleaseDate",
];
const sharedFields = sharedKeys.map((key) => TAG_FIELDS.find((field) => field.key === key)!);
const coverUrl = ref<string | null>(null);
watch(
  () => state.cover,
  (cover) => {
    const previous = coverUrl.value;
    coverUrl.value = cover
      ? globalThis.URL.createObjectURL(
          new globalThis.Blob([Uint8Array.from(cover.data)], { type: cover.mimeType }),
        )
      : null;
    if (previous) globalThis.URL.revokeObjectURL(previous);
  },
  { immediate: true },
);
onScopeDispose(() => {
  if (coverUrl.value) globalThis.URL.revokeObjectURL(coverUrl.value);
});
function common(field: AlbumField) {
  const values = state.rows.filter((row) => row.source !== null).map((row) => row.values[field]);
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}
const original = computed(() =>
  Object.fromEntries(
    sharedFields.map(({ key }) => [
      key,
      [
        ...new Set(
          state.tracks.map(({ track, values }) =>
            String({ ...track, ...values }[key] ?? t("（空）")),
          ),
        ),
      ].join(" / "),
    ]),
  ),
);
function input(field: AlbumField, event: InstanceType<typeof globalThis.Event>) {
  props.editor.setSharedValue(
    field,
    (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
  );
}
function changeCover(event: InstanceType<typeof globalThis.Event>) {
  void props.editor.selectCover(
    (event.target as InstanceType<typeof globalThis.HTMLSelectElement>).value,
  );
}
</script>

<template>
  <section
    :aria-label="t('覆盖字段及封面')"
    class="grid min-w-0 grid-cols-[80px_minmax(0,1fr)] gap-[8px]"
  >
    <div class="min-w-0 space-y-1">
      <div
        class="flex aspect-square items-center justify-center overflow-hidden rounded border border-white/10 bg-black/20"
      >
        <img
          v-if="coverUrl"
          :src="coverUrl"
          :alt="t('所选发行版本的正面封面')"
          class="size-full object-contain"
        />
        <span v-else class="text-app-muted px-3 text-center text-xs">{{
          state.loadingCover ? t("封面加载中…") : t("暂无封面")
        }}</span>
      </div>
      <label class="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          :checked="state.writeCover"
          :disabled="disabled || !state.cover || state.loadingCover"
          class="accent-app-accent"
          @change="editor.toggleCover()"
        />{{ t("替换封面") }}
      </label>
      <p v-if="state.writeCover" class="text-app-muted text-xs">{{ t("将移除全部旧图片。") }}</p>
      <select
        v-if="state.covers.length > 1"
        :aria-label="t('选择正面封面')"
        :value="state.coverId"
        :disabled="disabled || state.loadingCover"
        class="bg-app-interactive w-full rounded border border-white/15 p-1 text-xs"
        @change="changeCover"
      >
        <option v-for="(cover, index) in state.covers" :key="cover.id" :value="cover.id">
          {{ t("封面 {count} {comment}", { count: index + 1, comment: cover.comment }) }}
        </option>
      </select>
    </div>
    <div class="grid min-w-0 grid-cols-3 content-start gap-1">
      <div
        v-for="field in sharedFields"
        :key="field.key"
        class="grid min-w-0 items-center gap-1 text-xs"
        :class="
          ['albumArtist', 'album'].includes(field.key)
            ? 'col-span-3 grid-cols-[5.5rem_minmax(0,1fr)]'
            : 'grid-cols-[auto_minmax(0,1fr)]'
        "
      >
        <label :for="`album-tag-${field.key}`" class="flex items-center gap-1 whitespace-nowrap">
          <input
            type="checkbox"
            :aria-label="t('覆盖{field}', { field: t(field.label) })"
            :checked="state.fields.includes(field.key)"
            :disabled="disabled || !state.selected"
            class="accent-app-accent"
            @change="editor.toggleField(field.key)"
          />{{ t(field.label) }}
        </label>
        <input
          :id="`album-tag-${field.key}`"
          :value="common(field.key) ?? ''"
          :disabled="disabled || !state.fields.includes(field.key) || !state.selected"
          :placeholder="state.selected && common(field.key) === undefined ? '—' : ''"
          :title="t('原值：{value}', { value: original[field.key] ?? '' })"
          class="focus:border-app-accent h-[24px] w-full min-w-0 rounded border border-white/15 bg-black/20 px-2 text-xs focus:outline-none disabled:opacity-50"
          @input="input(field.key, $event)"
        />
      </div>
    </div>
  </section>
</template>
