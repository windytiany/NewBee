<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { createMappingDrag } from "@/albumTags/dragMapping";
import type { MappingDragPreview } from "@/albumTags/dragMapping";
import type { createAlbumTagEditor } from "@/albumTags/editor";
import type { AlbumField } from "@/albumTags/model";
import { METADATA_FIELDS } from "@/metadata/model";
import { formatTrackDuration } from "@/library/formatTrack";
const props = defineProps<{ editor: ReturnType<typeof createAlbumTagEditor>; disabled: boolean }>();
const state = props.editor.state;
const dragPreview = ref<MappingDragPreview | null>(null);
const drag = createMappingDrag({
  canStart: () => !props.disabled,
  preview: (preview) => {
    dragPreview.value = preview;
  },
  drop: (id, target) => props.editor.move(id, target),
});
onScopeDispose(drag.cancel);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) drag.cancel();
  },
);
const expanded = ref<number | null>(null);
const unmatched = computed(() =>
  state.tracks.filter(({ track }) => !state.rows.some((row) => row.trackId === track.id)),
);
const local = (id: number | null) => state.tracks.find(({ track }) => track.id === id);
const filename = (path: string) => path.split(/[\\/]/).pop() ?? path;
function choose(index: number, event: InstanceType<typeof globalThis.Event>) {
  const value = (event.target as InstanceType<typeof globalThis.HTMLSelectElement>).value;
  const previous = state.rows[index]?.trackId;
  if (value) props.editor.move(Number(value), index);
  else if (previous !== null && previous !== undefined) props.editor.move(previous, null);
}
function input(index: number, field: AlbumField, event: InstanceType<typeof globalThis.Event>) {
  props.editor.setValue(
    index,
    field,
    (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
  );
}
</script>

<template>
  <section aria-label="曲目对应关系" class="space-y-3">
    <h3 class="font-semibold">曲目对应关系</h3>
    <p class="text-spotify-muted text-xs">
      拖拽右侧本地曲目到来源位置，已有对应时交换。也可使用下拉框；跨碟调整不会立即写入文件。
    </p>
    <div class="overflow-x-auto rounded border border-white/10">
      <table class="w-full table-fixed text-left text-sm">
        <thead class="bg-spotify-interactive">
          <tr>
            <th class="w-12 p-2">保存</th>
            <th class="w-[40%] p-2">MusicBrainz 曲目</th>
            <th class="p-2">本地曲目 / 文件</th>
          </tr>
        </thead>
        <tbody>
          <template
            v-for="(row, index) in state.rows"
            :key="`${state.selected?.summary.id}-${index}`"
          >
            <tr
              v-if="
                index === 0 || state.rows[index - 1]?.source.discNumber !== row.source.discNumber
              "
              class="bg-white/5"
            >
              <th colspan="3" class="p-2">
                第 {{ row.source.discNumber }} 碟 · {{ row.source.trackTotal }} 首
              </th>
            </tr>
            <tr class="border-t border-white/10">
              <td class="p-2 align-top">
                <input
                  v-if="row.trackId !== null"
                  type="checkbox"
                  :aria-label="`保存 ${local(row.trackId)?.track.title ?? row.trackId}`"
                  :checked="state.included.includes(row.trackId)"
                  :disabled="disabled"
                  @change="editor.toggleTrack(row.trackId)"
                />
              </td>
              <td class="space-y-1 p-2 align-top">
                <p>{{ row.source.trackNumber }}. {{ row.source.title }}</p>
                <p class="text-spotify-muted text-xs">
                  {{ row.source.artist ?? "署名缺失" }} ·
                  {{ formatTrackDuration(row.source.durationMs) ?? "—" }}
                </p>
                <button
                  type="button"
                  class="text-xs underline"
                  :aria-expanded="expanded === index"
                  @click="expanded = expanded === index ? null : index"
                >
                  {{ expanded === index ? "收起字段" : "查看差异 / 编辑新值" }}
                </button>
              </td>
              <td
                class="p-2 align-top"
                :data-album-tag-slot="index"
                :class="
                  dragPreview?.target === index
                    ? 'ring-spotify-green bg-white/10 ring-1 ring-inset'
                    : ''
                "
              >
                <div
                  v-if="row.trackId !== null"
                  class="cursor-grab touch-none space-y-1 rounded p-1 select-none active:cursor-grabbing"
                  :data-local-track-id="row.trackId"
                  @pointerdown="drag.start(row.trackId, $event)"
                >
                  <p>
                    {{ local(row.trackId)?.track.discNumber ?? "—" }}-{{
                      local(row.trackId)?.track.trackNumber ?? "—"
                    }}. {{ local(row.trackId)?.track.title ?? "无标题" }}
                  </p>
                  <p class="text-spotify-muted text-xs">
                    {{ local(row.trackId)?.track.artist ?? "—" }} ·
                    {{ formatTrackDuration(local(row.trackId)?.track.durationMs ?? null) ?? "—" }}
                  </p>
                  <p
                    class="text-spotify-muted truncate text-xs"
                    :title="local(row.trackId)?.track.path"
                  >
                    {{ filename(local(row.trackId)?.track.path ?? "") }}
                  </p>
                  <p v-if="local(row.trackId)?.issue" class="text-xs text-amber-200">
                    {{ local(row.trackId)?.issue }}
                  </p>
                </div>
                <p v-else class="text-spotify-muted p-1 text-xs">
                  无对应文件，不保存。可拖入曲目。
                </p>
                <select
                  :aria-label="`第 ${row.source.discNumber} 碟第 ${row.source.trackNumber} 首对应文件`"
                  :value="row.trackId ?? ''"
                  :disabled="disabled"
                  class="bg-spotify-interactive mt-2 w-full rounded border border-white/15 p-1 text-xs disabled:opacity-50"
                  @change="choose(index, $event)"
                >
                  <option value="">解除对应</option>
                  <option v-for="{ track } in state.tracks" :key="track.id" :value="track.id">
                    {{ filename(track.path) }}
                  </option>
                </select>
              </td>
            </tr>
            <tr v-if="expanded === index" class="bg-black/10">
              <td colspan="3" class="p-3">
                <div class="grid gap-3 md:grid-cols-2">
                  <div v-for="field in METADATA_FIELDS" :key="field.key" class="space-y-1 text-xs">
                    <label :for="`match-${index}-${field.key}`"
                      >{{ field.label
                      }}{{ state.fields.includes(field.key) ? "（将覆盖）" : "（不覆盖）" }}</label
                    >
                    <p
                      v-if="
                        row.trackId !== null &&
                        !local(row.trackId)?.writableFields.includes(field.key)
                      "
                      class="text-amber-200"
                    >
                      本地文件不支持写入此字段，保存时将报告该曲目失败。
                    </p>
                    <p class="text-spotify-muted break-all">
                      原值：{{
                        row.trackId !== null
                          ? (local(row.trackId)?.track[field.key] ?? "（空）")
                          : "无对应文件"
                      }}
                    </p>
                    <input
                      :id="`match-${index}-${field.key}`"
                      :value="row.values[field.key] ?? ''"
                      :placeholder="row.values[field.key] === undefined ? '保留本地' : ''"
                      :disabled="disabled || !state.fields.includes(field.key)"
                      class="w-full rounded border border-white/15 bg-black/20 px-2 py-1 disabled:opacity-50"
                      @input="input(index, field.key, $event)"
                    />
                    <div class="flex gap-3">
                      <button
                        type="button"
                        :disabled="disabled"
                        class="hover:underline"
                        @click="editor.setValue(index, field.key, '')"
                      >
                        清空</button
                      ><button
                        type="button"
                        :disabled="disabled"
                        class="hover:underline"
                        @click="editor.setValue(index, field.key, undefined)"
                      >
                        保留本地
                      </button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div
      class="min-h-20 rounded border border-dashed border-white/20 p-3"
      data-album-tag-slot="unmatched"
      :class="
        dragPreview && dragPreview.target === null ? 'ring-spotify-green bg-white/10 ring-1' : ''
      "
    >
      <h4 class="text-spotify-muted text-sm">
        未匹配本地曲目（{{ unmatched.length }}）· 拖到这里解除对应，这些文件不会修改
      </h4>
      <div class="mt-2 flex flex-wrap gap-2">
        <div
          v-for="{ track, issue } in unmatched"
          :key="track.id"
          class="bg-spotify-interactive max-w-full cursor-grab touch-none rounded px-3 py-2 text-xs select-none"
          :title="track.path"
          :data-local-track-id="track.id"
          @pointerdown="drag.start(track.id, $event)"
        >
          {{ filename(track.path)
          }}<span v-if="issue" class="ml-2 text-amber-200">{{ issue }}</span>
        </div>
      </div>
    </div>
    <div
      v-if="dragPreview"
      class="bg-spotify-interactive pointer-events-none fixed z-100 max-w-80 truncate rounded border border-white/20 px-3 py-2 text-sm shadow-xl"
      :style="{ left: `${dragPreview.x + 12}px`, top: `${dragPreview.y + 12}px` }"
    >
      {{ filename(local(dragPreview.trackId)?.track.path ?? "") }}
    </div>
  </section>
</template>
