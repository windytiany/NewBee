<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import type { createAlbumTagEditor } from "@/albumTags/editor";
import type { AlbumField } from "@/albumTags/model";
import { METADATA_FIELDS } from "@/metadata/model";
const props = defineProps<{ editor: ReturnType<typeof createAlbumTagEditor>; disabled: boolean }>();
const state = props.editor.state;
const sharedKeys: AlbumField[] = ["album", "albumArtist", "releaseDate", "discTotal"];
const sharedFields = METADATA_FIELDS.filter(({ key }) => sharedKeys.includes(key));
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
);
onScopeDispose(() => {
  if (coverUrl.value) globalThis.URL.revokeObjectURL(coverUrl.value);
});
function common(field: AlbumField) {
  const values = state.rows.map((row) => row.values[field]);
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}
const original = computed(() =>
  Object.fromEntries(
    sharedFields.map(({ key }) => [
      key,
      [...new Set(state.tracks.map(({ track }) => String(track[key] ?? "（空）")))].join(" / "),
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
  <section aria-label="覆盖字段及封面" class="space-y-4 rounded border border-white/10 p-4">
    <h3 class="font-semibold">覆盖字段</h3>
    <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <label v-for="field in METADATA_FIELDS" :key="field.key" class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="state.fields.includes(field.key)"
          :disabled="disabled"
          @change="editor.toggleField(field.key)"
        />{{ field.label }}
      </label>
    </div>
    <p class="text-spotify-muted text-xs">
      来源缺失时保留本地值。输入留空或点击“清空”表示明确删除；“保留本地”不写该字段。
    </p>
    <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_14rem]">
      <div class="space-y-3">
        <div
          v-for="field in sharedFields"
          :key="field.key"
          class="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-2 text-sm"
        >
          <label :for="`album-tag-${field.key}`" class="py-2">{{ field.label }}</label>
          <div class="min-w-0 space-y-1">
            <input
              :id="`album-tag-${field.key}`"
              :value="common(field.key) ?? ''"
              :disabled="disabled || !state.fields.includes(field.key)"
              :placeholder="common(field.key) === undefined ? '来源缺失或多个值，保留本地' : ''"
              class="w-full rounded border border-white/15 bg-black/20 px-3 py-2 disabled:opacity-50"
              @input="input(field.key, $event)"
            />
            <p class="text-spotify-muted text-xs break-all">原值：{{ original[field.key] }}</p>
            <div class="flex gap-3 text-xs">
              <button
                type="button"
                :disabled="disabled"
                class="hover:underline disabled:opacity-50"
                @click="editor.setSharedValue(field.key, '')"
              >
                清空</button
              ><button
                type="button"
                :disabled="disabled"
                class="hover:underline disabled:opacity-50"
                @click="editor.setSharedValue(field.key, undefined)"
              >
                保留本地
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="space-y-2">
        <img
          v-if="coverUrl"
          :src="coverUrl"
          alt="所选发行版本的正面封面"
          class="mx-auto size-40 rounded object-contain"
        />
        <label class="flex items-center gap-2 text-sm"
          ><input
            type="checkbox"
            :checked="state.writeCover"
            :disabled="disabled || !state.cover"
            @change="editor.toggleCover()"
          />替换内嵌正面封面</label
        >
        <select
          v-if="state.covers.length"
          aria-label="选择正面封面"
          :value="state.coverId"
          :disabled="disabled || state.loadingCover"
          class="bg-spotify-interactive w-full rounded border border-white/15 p-2 text-sm"
          @change="changeCover"
        >
          <option v-for="(cover, index) in state.covers" :key="cover.id" :value="cover.id">
            封面 {{ index + 1 }} {{ cover.comment }}
          </option>
        </select>
        <p v-if="state.loadingCover" role="status" class="text-spotify-muted text-xs">
          封面加载中…
        </p>
        <p v-if="state.coverError" role="status" class="text-xs text-amber-200">
          {{ state.coverError }}
        </p>
        <button
          v-if="state.coverError"
          type="button"
          :disabled="disabled || state.loadingCover"
          class="text-xs underline disabled:opacity-50"
          @click="editor.retryCovers()"
        >
          重试封面
        </button>
        <p class="text-spotify-muted text-xs">
          仅替换参与保存曲目的正面封面，保留其他内嵌图片，不创建目录图片。M4A
          不保存图片角色，替换第一张图片并保留其余图片。
        </p>
      </div>
    </div>
  </section>
</template>
