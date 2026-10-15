<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from "vue";
import { useTagEditor } from "@/features/metadata/manual/useEditor";
import { useReleaseEditor } from "@/features/metadata/releases/useEditor";
import { useInbox } from "@/features/inbox/useInbox";
import { formatAddedDate } from "@/features/inbox/format";
import { usePlaybackSession } from "@/features/playback/session";
import SidePane from "@/shared/components/SidePane.vue";
import ArtistList from "@/features/artists/navigation/ArtistList.vue";
import TrackRow from "@/features/tracks/presentation/TrackRow.vue";
import EditMenuItem from "@/features/metadata/manual/components/EditMenuItem.vue";
import ReleaseMenuItem from "@/features/metadata/releases/components/ReleaseMenuItem.vue";
import DownloadMenuItem from "@/features/lyrics/download/DownloadMenuItem.vue";
import SkipMenuItem from "@/features/playback/queue/components/SkipMenuItem.vue";
import AppendMenuItem from "@/features/playlist/tracks/AppendMenuItem.vue";
import CreatePlaylistDialog from "@/features/playlist/creation/CreatePlaylistDialog.vue";
import { reportPlaylistChanged } from "@/features/playlist/events";
import { useItemSelection } from "@/shared/interaction/item/useSelection";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import { vPersistentScroll } from "@/shared/interaction/scroll/persistence";
import { t } from "@/shared/i18n/locale";
import { useTable } from "@/shared/interaction/table/useTable";
import TableHeader from "@/shared/interaction/table/TableHeader.vue";
import { trackColumns, trackColumnValue } from "@/features/tracks/table/columns";
const props = defineProps<{ active: boolean }>();
const inbox = useInbox(toRef(props, "active"));
const state = inbox.state;
const tagEditor = useTagEditor();
const releaseEditor = useReleaseEditor();
const scanBlocked = computed(
  () => state.pending || state.loading || tagEditor.state.open || releaseEditor.state.open,
);
function scan(trackIds?: readonly number[]) {
  if (!scanBlocked.value) return inbox.reread(trackIds);
}
const columns = computed(() =>
  trackColumns([
    { key: "addedAt", label: t("添加日期"), width: "minmax(0,1fr)", desktopOnly: true },
  ]),
);
const table = useTable({
  columns: () => columns.value,
  rows: () => inbox.visibleTracks.value,
  value: (track, key, index) =>
    key === "addedAt" ? track.addedAt : trackColumnValue(track, key, index),
});
const tracks = table.rows;
const tableStyle = table.style;
const trackNumbers = computed(
  () => new Map(inbox.visibleTracks.value.map((track, index) => [track.id, index + 1])),
);
const artists = inbox.artists;
const playback = usePlaybackSession().state;
const scope = computed(() => JSON.stringify(["inbox", state.grouping, state.artist]));
const selection = useItemSelection(scope);
const keys = computed(() => tracks.value.map((track) => String(track.id)));
watch(keys, (keys) => selection.syncVisibleItems(keys), { immediate: true });
const root = ref<globalThis.HTMLElement | null>(null);
const list = ref<globalThis.HTMLOListElement | null>(null);
const menuElement = ref<globalThis.HTMLElement | null>(null);
const createPlaylistDialog = ref<InstanceType<typeof CreatePlaylistDialog> | null>(null);
const menu = useContextMenu<{ itemKey: string | null; trackIds: number[] }>({
  menuElement,
  fallbackFocusElement: root,
});
const request = menu.request;
const position = menu.position;
const trackIds = computed(() => request.value?.payload.trackIds ?? []);
function createPlaylist(ids: number[]) {
  createPlaylistDialog.value?.show(async () => ids);
}
const keyboard = createItemKeyboard({
  getItemKeys: () => (state.loading || state.pending ? [] : keys.value),
  itemSelector: "button[data-track-select]",
  onFocus: (key) => {
    if (!selection.isFocused(key)) selection.focusItem(key);
  },
  onMove: (key, event) => selection.selectItem(key, keys.value, event),
  onSelectAll: (keys) => selection.selectAll(keys),
  onActivate: (key) => {
    void inbox.play(Number(key), keys.value.map(Number));
  },
});
function open(request: {
  itemKey: string;
  x: number;
  y: number;
  trigger: globalThis.HTMLButtonElement;
}) {
  if (state.pending || state.loading) return;
  const trackIds = selection.contextMenuTargets(request.itemKey, keys.value).map(Number);
  if (!trackIds.length) return;
  menu.open({ ...request, payload: { itemKey: request.itemKey, trackIds } });
}
function emptyMenu(event: globalThis.MouseEvent) {
  event.preventDefault();
  menu.open({
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as globalThis.HTMLElement,
    payload: { itemKey: null, trackIds: [] },
  });
}
async function action(kind: "next" | "end" | "ingest" | "remove" | "refresh" | "reread") {
  const targets = [...trackIds.value];
  const index = Math.max(
    0,
    keys.value.findIndex((key) => targets.includes(Number(key))),
  );
  const removing = kind === "remove" || kind === "ingest";
  menu.close(!removing);
  if (kind === "next") await inbox.addNext(targets);
  else if (kind === "end") await inbox.addEnd(targets);
  else if (kind === "ingest") await inbox.ingest(targets);
  else if (kind === "remove") await inbox.remove(targets);
  else await scan(kind === "reread" ? targets : undefined);
  if (removing) {
    await nextTick();
    const buttons = list.value?.querySelectorAll<globalThis.HTMLButtonElement>(
      "button[data-track-select]",
    );
    if (buttons?.length) buttons[Math.min(index, buttons.length - 1)]?.focus();
    else root.value?.focus();
  }
}
watch(
  () => props.active,
  (active) => {
    if (!active) {
      menu.close();
    }
  },
);
watch(keys, (keys) => {
  if (trackIds.value.some((id) => !keys.includes(String(id)))) menu.close(true);
});
</script>

<template>
  <div v-show="active" class="contents">
    <SidePane side="left" class="col-start-1 row-start-1 max-md:hidden">
      <ArtistList
        :artists="artists"
        :grouping="state.grouping"
        :selected-artist="state.artist"
        :is-loading="state.loading"
        :error="state.error"
        scope="inbox"
        :show-photos="false"
        all-artists
        @select="state.artist = $event"
        @select-grouping="inbox.selectGrouping"
        @select-all="state.artist = null"
      />
    </SidePane>
    <section
      ref="root"
      v-persistent-scroll="scope"
      data-local-drop="Inbox"
      tabindex="-1"
      :aria-label="t('Inbox')"
      class="sidebar-scrollbars bg-app-base col-start-1 row-start-1 h-full min-h-0 min-w-0 overflow-y-auto px-5 pb-6 text-white outline-none sm:px-8 md:col-start-3"
      @contextmenu="emptyMenu"
      @keydown.f5.prevent="scan()"
    >
      <div class="min-w-0" :style="tableStyle">
        <TableHeader
          :columns="columns"
          :sort="table.sort.value"
          class="sticky top-0 z-10 px-4"
          @sort="table.toggle"
          @resize="table.resize"
        />
        <p v-if="state.loading" role="status" class="text-app-muted py-4 text-sm">
          {{ t("加载中…") }}
        </p>
        <p v-else-if="state.error" role="alert" class="py-4 text-sm">{{ state.error }}</p>
        <p v-else-if="!tracks.length" class="text-app-muted py-4 text-sm">{{ t("无曲目") }}</p>
        <ol v-else ref="list" @keydown="keyboard.onKeydown" @focusin="keyboard.onFocusin">
          <TrackRow
            v-for="track in tracks"
            :key="track.id"
            :item-key="String(track.id)"
            :track="track"
            :number="trackNumbers.get(track.id) ?? 0"
            :focused="selection.isFocused(String(track.id))"
            :selected="selection.isSelected(String(track.id))"
            :current="playback.activeQueueRowKey.value === `inbox:${track.id}`"
            :menu-open="request?.payload.itemKey === String(track.id)"
            menu-id="inbox-context-menu"
            @select="selection.selectItem(String(track.id), keys, $event)"
            @play="inbox.play(track.id, keys.map(Number))"
            @context-menu="open"
          >
            <template #before-duration>
              <span class="text-app-muted hidden truncate text-xs tabular-nums sm:block">{{
                formatAddedDate(track.addedAt)
              }}</span>
            </template>
          </TrackRow>
        </ol>
      </div>
    </section>
    <div
      v-if="request"
      id="inbox-context-menu"
      ref="menuElement"
      data-item-interaction
      class="bg-app-interactive fixed z-100 w-56 rounded-md p-1 shadow-xl ring-1 ring-white/10"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      role="menu"
      :aria-label="t('曲目操作')"
      @pointerdown.stop
    >
      <button
        role="menuitem"
        type="button"
        :disabled="!trackIds.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('next')"
      >
        {{ t("添加为下一首") }}
      </button>
      <button
        role="menuitem"
        type="button"
        :disabled="!trackIds.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('end')"
      >
        {{ t("添加到队尾") }}
      </button>
      <SkipMenuItem :track-ids="trackIds" :disabled="state.pending" @close="menu.close(true)" />
      <div class="my-1 border-t border-white/10" role="separator" />
      <AppendMenuItem
        :track-ids="trackIds"
        :disabled="state.pending"
        @create="createPlaylist"
        @close="menu.close(true)"
      />
      <button
        role="menuitem"
        type="button"
        :disabled="!trackIds.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('ingest')"
      >
        {{ t("添加到音乐库") }}
      </button>
      <div class="my-1 border-t border-white/10" role="separator" />
      <EditMenuItem
        :track-ids="trackIds"
        :disabled="!trackIds.length || state.pending"
        @close="menu.close(true)"
      />
      <ReleaseMenuItem
        :track-ids="trackIds"
        :disabled="!trackIds.length || state.pending"
        @close="menu.close(true)"
      />
      <DownloadMenuItem
        :track-ids="trackIds"
        :disabled="!trackIds.length || state.pending"
        @close="menu.close(true)"
      />
      <button
        role="menuitem"
        type="button"
        :disabled="scanBlocked"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action(trackIds.length ? 'reread' : 'refresh')"
      >
        {{ t("重新读取标签") }}
      </button>
      <div class="my-1 border-t border-white/10" role="separator" />
      <button
        role="menuitem"
        type="button"
        :disabled="!trackIds.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('remove')"
      >
        {{ t("从 Inbox 移除") }}
      </button>
    </div>
    <CreatePlaylistDialog ref="createPlaylistDialog" @created="reportPlaylistChanged" />
  </div>
</template>
