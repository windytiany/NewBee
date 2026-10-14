<script setup lang="ts">
import type { MetadataTarget } from "@/features/metadata/types";
import { t } from "@/shared/i18n/locale";
import { computed, onScopeDispose, ref, watch } from "vue";
import { createMappingDrag } from "@/features/metadata/releases/mapping/drag";
import type { MappingDragPreview } from "@/features/metadata/releases/mapping/drag";
import type { createReleaseEditor } from "@/features/metadata/releases/useEditor";
import type { AlbumField } from "@/features/metadata/releases/types";
import { TAG_FIELDS } from "@/features/metadata/draft";
import { formatTrackDuration } from "@/features/tracks/format";
const props = defineProps<{ editor: ReturnType<typeof createReleaseEditor>; disabled: boolean }>();
const state = props.editor.state;
const dragPreview = ref<MappingDragPreview | null>(null);
const drag = createMappingDrag({
  canStart: () => !props.disabled,
  preview: (preview) => {
    dragPreview.value = preview;
  },
  drop: (id, target) => {
    props.editor.move(id, target);
    expanded.value = null;
    selectedIndex.value = state.rows.findIndex((row) => row.trackId === id);
  },
});
onScopeDispose(drag.cancel);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) drag.cancel();
  },
);
const expanded = ref<number | null>(null);
const selectedIndex = ref<number | null>(null);
watch(
  () => state.selected,
  () => {
    selectedIndex.value = null;
    expanded.value = null;
  },
);
const mappedIds = computed(() =>
  state.rows.flatMap((row) => (row.source === null || row.trackId === null ? [] : [row.trackId])),
);
const allIncluded = computed(
  () => mappedIds.value.length > 0 && mappedIds.value.every((id) => state.included.includes(id)),
);
const local = (id: MetadataTarget | null) => state.tracks.find(({ track }) => track.id === id);
const filename = (path: string) => path.split(/[\\/]/).pop() ?? path;
function toggleAll() {
  const include = !allIncluded.value;
  for (const id of mappedIds.value)
    if (state.included.includes(id) !== include) props.editor.toggleTrack(id);
}
function shift(direction: number) {
  const index = selectedIndex.value;
  if (index === null) return;
  const id = state.rows[index]?.trackId;
  const target = index + direction;
  if (id === null || id === undefined || target < 0 || target >= state.rows.length) return;
  props.editor.move(id, target);
  expanded.value = null;
  selectedIndex.value = state.rows.findIndex((row) => row.trackId === id);
}
function detachSelected() {
  const id = selectedIndex.value === null ? null : state.rows[selectedIndex.value]?.trackId;
  if (id === null || id === undefined) return;
  props.editor.move(id, null);
  selectedIndex.value = state.rows.findIndex((row) => row.trackId === id);
  expanded.value = null;
}
function startRowDrag(
  trackId: MetadataTarget | null,
  event: InstanceType<typeof globalThis.PointerEvent>,
) {
  if (
    trackId === null ||
    (event.target as InstanceType<typeof globalThis.HTMLElement>).closest(
      "button, input, select, a",
    )
  )
    return;
  drag.start(trackId, event);
}
function choose(index: number, event: InstanceType<typeof globalThis.Event>) {
  const value = (event.target as InstanceType<typeof globalThis.HTMLSelectElement>).value;
  const previous = state.rows[index]?.trackId;
  const target = state.tracks.find(({ track }) => String(track.id) === value);
  if (target) props.editor.move(target.track.id, index);
  else if (previous !== null && previous !== undefined) props.editor.move(previous, null);
}
function input(index: number, field: AlbumField, event: InstanceType<typeof globalThis.Event>) {
  props.editor.setValue(
    index,
    field,
    (event.target as InstanceType<typeof globalThis.HTMLInputElement>).value,
  );
}
function titleDiffers(index: number) {
  const row = state.rows[index];
  return (
    row?.trackId !== null &&
    row?.values.title !== undefined &&
    row.values.title !== local(row.trackId)?.track.title
  );
}
function durationDiffers(index: number) {
  const row = state.rows[index];
  const duration = local(row?.trackId ?? null)?.track.durationMs;
  return (
    row?.source?.durationMs != null &&
    duration != null &&
    Math.abs(row.source.durationMs - duration) > 2000
  );
}
</script>

<template>
  <section
    :aria-label="t('曲目对应关系')"
    class="flex min-h-0 flex-col gap-1"
    @click.capture="drag.suppressClick($event)"
  >
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-1 text-xs">
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="font-semibold">{{ t("曲目对照") }}</h3>
        <label
          v-for="field in TAG_FIELDS.filter(({ key }) =>
            ['artist', 'artistSort', 'title', 'trackNumber', 'trackTotal'].includes(key),
          )"
          :key="field.key"
          class="flex items-center gap-1.5"
        >
          <input
            type="checkbox"
            :checked="state.fields.includes(field.key)"
            :disabled="disabled || !state.selected"
            class="accent-app-accent"
            @change="editor.toggleField(field.key)"
          />{{ t(field.label) }}
        </label>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          :disabled="
            disabled ||
            selectedIndex === null ||
            !state.rows[selectedIndex]?.source ||
            state.rows[selectedIndex]?.trackId == null
          "
          class="rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-30"
          @click="detachSelected()"
        >
          {{ t("解除对应") }}
        </button>
        <button
          type="button"
          :aria-label="t('上移本地曲目')"
          :disabled="
            disabled ||
            selectedIndex === null ||
            selectedIndex === 0 ||
            state.rows[selectedIndex]?.trackId == null
          "
          class="rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-30"
          @click="shift(-1)"
        >
          ↑
        </button>
        <button
          type="button"
          :aria-label="t('下移本地曲目')"
          :disabled="
            disabled ||
            selectedIndex === null ||
            selectedIndex >= state.rows.length - 1 ||
            state.rows[selectedIndex]?.trackId == null
          "
          class="rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-30"
          @click="shift(1)"
        >
          ↓
        </button>
      </div>
    </div>
    <div
      data-album-tag-scroll
      class="max-h-[min(240px,36dvh)] shrink-0 overflow-auto rounded border border-white/10"
    >
      <table class="w-full min-w-[800px] table-fixed text-left text-xs [&_td]:py-1 [&_th]:py-1">
        <thead class="bg-app-interactive text-app-muted sticky top-0 z-10">
          <tr>
            <th class="w-8 px-2 py-2">
              <input
                type="checkbox"
                :aria-label="t('选择全部对应曲目')"
                :checked="allIncluded"
                :indeterminate="!allIncluded && mappedIds.some((id) => state.included.includes(id))"
                :disabled="disabled || !mappedIds.length"
                class="accent-app-accent"
                @change="toggleAll()"
              />
            </th>
            <th class="w-12 py-2 font-normal">{{ t("曲号") }}</th>
            <th class="w-[17%] px-2 py-2 font-normal">{{ t("艺术家") }}</th>
            <th class="w-[23%] px-2 py-2 font-normal">{{ t("标题") }}</th>
            <th class="w-14 px-2 py-2 font-normal">{{ t("时间") }}</th>
            <th class="w-[22%] px-2 py-2 font-normal">{{ t("原始标题") }}</th>
            <th class="w-14 px-2 py-2 font-normal">{{ t("时间") }}</th>
            <th class="px-2 py-2 font-normal">{{ t("文件名") }}</th>
          </tr>
        </thead>
        <tbody>
          <template
            v-for="(row, index) in state.rows"
            :key="`${state.selected?.summary.id}-${index}`"
          >
            <tr
              v-if="
                row.source &&
                state.rows.findIndex(
                  (candidate) => candidate.source?.discNumber === row.source?.discNumber,
                ) === index
              "
              class="bg-white/5"
            >
              <th colspan="8" class="text-app-muted px-2 py-1.5 font-normal">
                {{
                  t("第 {disc} 碟 · {count} 首", {
                    disc: row.source.discNumber,
                    count: row.source.trackTotal,
                  })
                }}
              </th>
            </tr>
            <tr
              :data-album-tag-slot="index"
              class="border-t border-white/5 select-none hover:bg-white/5"
              :class="[
                dragPreview?.target === index
                  ? 'ring-app-accent bg-white/10 ring-1 ring-inset'
                  : selectedIndex === index
                    ? 'bg-white/10'
                    : '',
                row.trackId !== null && !disabled
                  ? 'cursor-grab touch-none active:cursor-grabbing'
                  : '',
              ]"
              :data-local-track-id="row.trackId"
              @pointerdown="startRowDrag(row.trackId, $event)"
              @click="selectedIndex = index"
            >
              <td class="px-2 py-2">
                <input
                  v-if="row.source && row.trackId !== null"
                  type="checkbox"
                  :aria-label="
                    t('保存 {title}', { title: local(row.trackId)?.track.title ?? row.trackId })
                  "
                  :checked="state.included.includes(row.trackId)"
                  :disabled="disabled"
                  class="accent-app-accent"
                  @change="editor.toggleTrack(row.trackId)"
                />
              </td>
              <td class="text-app-muted py-2">
                {{ row.source ? (row.values.trackNumber ?? row.source.trackNumber) : "" }}
              </td>
              <td class="truncate px-2 py-2" :title="row.values.artist">
                {{ row.source ? (row.values.artist ?? "—") : "" }}
              </td>
              <td class="px-2 py-2">
                <button
                  v-if="row.source"
                  type="button"
                  class="block w-full truncate text-left hover:underline"
                  :aria-label="t('查看差异 / 编辑新值：{title}', { title: row.source.title })"
                  :aria-expanded="expanded === index"
                  @click="expanded = expanded === index ? null : index"
                >
                  {{ row.values.title ?? row.source.title }}
                </button>
              </td>
              <td class="text-app-muted px-2 py-2">
                {{ row.source ? (formatTrackDuration(row.source.durationMs) ?? "—") : "" }}
              </td>
              <td class="px-2 py-2">
                <button
                  v-if="row.trackId !== null"
                  type="button"
                  :disabled="disabled"
                  class="block w-full cursor-grab touch-none truncate text-left select-none active:cursor-grabbing"
                  :class="titleDiffers(index) ? 'text-amber-200' : 'text-app-muted'"
                  :title="local(row.trackId)?.track.title ?? ''"
                  @pointerdown.stop="drag.start(row.trackId, $event)"
                  @click="selectedIndex = index"
                >
                  {{ local(row.trackId)?.track.title ?? t("无标题") }}
                </button>
              </td>
              <td
                class="px-2 py-2"
                :class="durationDiffers(index) ? 'text-amber-200' : 'text-app-muted'"
              >
                {{
                  row.trackId !== null
                    ? (formatTrackDuration(local(row.trackId)?.track.durationMs ?? null) ?? "—")
                    : ""
                }}
              </td>
              <td class="text-app-muted truncate px-2 py-2" :title="local(row.trackId)?.track.path">
                {{ filename(local(row.trackId)?.track.path ?? "") }}
              </td>
            </tr>
            <tr v-if="expanded === index && row.source" class="bg-black/10">
              <td colspan="8" class="p-3">
                <select
                  :aria-label="
                    t('第 {disc} 碟第 {count} 首对应文件', {
                      disc: row.source.discNumber,
                      count: row.source.trackNumber,
                    })
                  "
                  :value="row.trackId ?? ''"
                  :disabled="disabled"
                  class="bg-app-interactive mb-2 w-full rounded border border-white/15 p-1 text-xs disabled:opacity-50"
                  @change="choose(index, $event)"
                >
                  <option value="">{{ t("无对应文件") }}</option>
                  <option v-for="{ track } in state.tracks" :key="track.id" :value="track.id">
                    {{ filename(track.path) }}
                  </option>
                </select>
                <div class="grid gap-3 md:grid-cols-3">
                  <div v-for="field in TAG_FIELDS" :key="field.key" class="space-y-1 text-xs">
                    <label :for="`match-${index}-${field.key}`">{{ t(field.label) }}</label>
                    <p class="text-app-muted break-all">
                      {{
                        t("原值：{value}", {
                          value:
                            row.trackId !== null
                              ? ({ ...local(row.trackId)?.track, ...local(row.trackId)?.values }[
                                  field.key
                                ] ?? t("（空）"))
                              : t("无对应文件"),
                        })
                      }}
                    </p>
                    <input
                      :id="`match-${index}-${field.key}`"
                      autocomplete="off"
                      :value="row.values[field.key] ?? ''"
                      :placeholder="row.values[field.key] === undefined ? t('保留本地') : ''"
                      :disabled="disabled || !state.fields.includes(field.key)"
                      class="w-full rounded border border-white/15 bg-black/20 px-2 py-1 disabled:opacity-50"
                      @input="input(index, field.key, $event)"
                    />
                    <div class="flex gap-3">
                      <button
                        type="button"
                        :disabled="disabled"
                        class="hover:underline disabled:opacity-50"
                        @click="editor.setValue(index, field.key, undefined)"
                      >
                        {{ t("保留本地") }}
                      </button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr
            v-for="{ track } in !state.selected ? state.tracks : []"
            :key="track.id"
            class="text-app-muted border-t border-white/5"
          >
            <td></td>
            <td></td>
            <td colspan="3"></td>
            <td class="truncate px-2 py-2">{{ track.title }}</td>
            <td class="px-2 py-2">{{ formatTrackDuration(track.durationMs) ?? "—" }}</td>
            <td class="truncate px-2 py-2" :title="track.path">{{ filename(track.path) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-if="dragPreview"
      class="bg-app-interactive pointer-events-none fixed z-100 max-w-80 truncate rounded border border-white/20 px-3 py-2 text-sm shadow-xl"
      :style="{ left: `${dragPreview.x + 12}px`, top: `${dragPreview.y + 12}px` }"
    >
      {{ filename(local(dragPreview.trackId)?.track.path ?? "") }}
    </div>
  </section>
</template>
