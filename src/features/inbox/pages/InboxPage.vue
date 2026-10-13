<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from "vue";
import { useInbox } from "@/features/inbox/useInbox";
import { formatAddedDate } from "@/features/inbox/format";
import { usePlaybackSession } from "@/features/playback/session";
import SidePane from "@/shared/components/SidePane.vue";
import ArtistList from "@/features/artists/navigation/ArtistList.vue";
import TrackRow from "@/features/tracks/presentation/TrackRow.vue";
import EditMenuItem from "@/features/metadata/manual/components/EditMenuItem.vue";
import ReleaseMenuItem from "@/features/metadata/releases/components/ReleaseMenuItem.vue";
import { useItemSelection } from "@/shared/interaction/item/useSelection";
import { createItemKeyboard } from "@/shared/interaction/item/keyboard";
import { useContextMenu } from "@/shared/interaction/useContextMenu";
import { vPersistentScroll } from "@/shared/interaction/scroll/persistence";
import { t } from "@/shared/i18n/locale";
const props = defineProps<{ active: boolean }>();
const inbox = useInbox(toRef(props, "active"));
const state = inbox.state;
const tracks = inbox.visibleTracks;
const artists = inbox.artists;
const playback = usePlaybackSession().state;
const scope = computed(() => JSON.stringify(["inbox", state.grouping, state.artist]));
const selection = useItemSelection(scope);
const keys = computed(() => tracks.value.map((track) => track.path));
watch(keys, (keys) => selection.syncVisibleItems(keys), { immediate: true });
const root = ref<globalThis.HTMLElement | null>(null);
const list = ref<globalThis.HTMLOListElement | null>(null);
const menuElement = ref<globalThis.HTMLElement | null>(null);
const firstMenuItemElement = ref<globalThis.HTMLElement | null>(null);
const menu = useContextMenu<{ itemKey: string | null; paths: string[] }>({
  menuElement,
  firstMenuItemElement,
  fallbackFocusElement: root,
});
const request = menu.request;
const position = menu.position;
const paths = computed(() => request.value?.payload.paths ?? []);
const keyboard = createItemKeyboard({
  getItemKeys: () => (state.loading || state.pending ? [] : keys.value),
  itemSelector: "button[data-track-select]",
  onFocus: (key) => {
    if (!selection.isFocused(key)) selection.focusItem(key);
  },
  onMove: (key, event) => selection.selectItem(key, keys.value, event),
  onActivate: (key) => {
    void inbox.play(key);
  },
});
function open(request: {
  itemKey: string;
  x: number;
  y: number;
  trigger: globalThis.HTMLButtonElement;
}) {
  const paths = selection.contextMenuTargets(request.itemKey, keys.value);
  if (!paths.length) return;
  menu.open({ ...request, payload: { itemKey: request.itemKey, paths } });
}
function emptyMenu(event: globalThis.MouseEvent) {
  event.preventDefault();
  menu.open({
    x: event.clientX,
    y: event.clientY,
    trigger: event.currentTarget as globalThis.HTMLElement,
    payload: { itemKey: null, paths: [] },
  });
}
async function action(kind: "next" | "end" | "ingest" | "remove" | "refresh") {
  const targets = [...paths.value];
  const index = Math.max(
    0,
    keys.value.findIndex((key) => targets.includes(key)),
  );
  const removing = kind === "remove" || kind === "ingest";
  menu.close(!removing);
  if (kind === "next") await inbox.addNext(targets);
  else if (kind === "end") await inbox.addEnd(targets);
  else if (kind === "ingest") await inbox.ingest(targets);
  else if (kind === "remove") await inbox.remove(targets);
  else await inbox.refresh();
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
    if (!active) menu.close();
  },
);
watch(keys, (keys) => {
  if (paths.value.some((path) => !keys.includes(path))) menu.close(true);
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
      @keydown.f5.prevent="inbox.refresh()"
    >
      <div
        class="bg-app-base/95 text-app-muted sticky top-0 z-10 grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-3 border-b border-white/10 px-4 py-2 text-xs backdrop-blur-sm sm:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1fr)_9rem_3rem]"
      >
        <span class="text-right">#</span><span>{{ t("歌曲") }}</span
        ><span class="hidden sm:block">{{ t("专辑") }}</span
        ><span class="hidden sm:block">{{ t("添加日期") }}</span
        ><span class="text-right">{{ t("时长") }}</span>
      </div>
      <p v-if="state.loading" role="status" class="text-app-muted py-4 text-sm">
        {{ t("加载中…") }}
      </p>
      <p v-else-if="state.error" role="alert" class="py-4 text-sm">{{ state.error }}</p>
      <p v-else-if="!tracks.length" class="text-app-muted py-4 text-sm">{{ t("无曲目") }}</p>
      <ol v-else ref="list" @keydown="keyboard.onKeydown" @focusin="keyboard.onFocusin">
        <TrackRow
          v-for="(track, index) in tracks"
          :key="track.path"
          :item-key="track.path"
          :track="track"
          :number="index + 1"
          :focused="selection.isFocused(track.path)"
          :selected="selection.isSelected(track.path)"
          :current="playback.activeQueueRowKey.value === `inbox:${track.path}`"
          :menu-open="request?.payload.itemKey === track.path"
          menu-id="inbox-context-menu"
          @select="selection.selectItem(track.path, keys, $event)"
          @play="inbox.play(track.path)"
          @context-menu="open"
        >
          <template #before-duration>
            <span class="text-app-muted hidden text-xs tabular-nums sm:block">{{
              formatAddedDate(track.addedAt)
            }}</span>
          </template>
        </TrackRow>
      </ol>
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
        ref="firstMenuItemElement"
        role="menuitem"
        type="button"
        :disabled="!paths.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('next')"
      >
        {{ t("添加为下一首") }}
      </button>
      <button
        role="menuitem"
        type="button"
        :disabled="!paths.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('end')"
      >
        {{ t("添加到队尾") }}
      </button>
      <EditMenuItem
        :track-ids="paths"
        :disabled="!paths.length || state.pending"
        @close="menu.close(true)"
      />
      <ReleaseMenuItem
        :paths="paths"
        :disabled="!paths.length || state.pending"
        @close="menu.close(true)"
      />
      <div class="my-1 border-t border-white/10" role="separator" />
      <button
        role="menuitem"
        type="button"
        :disabled="!paths.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('ingest')"
      >
        {{ t("添加到音乐库") }}
      </button>
      <button
        role="menuitem"
        type="button"
        :disabled="!paths.length || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm text-red-200 hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('remove')"
      >
        {{ t("从 Inbox 移除") }}
      </button>
      <div class="my-1 border-t border-white/10" role="separator" />
      <button
        role="menuitem"
        type="button"
        :disabled="state.loading || state.pending"
        class="focus-visible:outline-app-accent w-full rounded px-2 py-2 text-left text-sm hover:bg-white/10 focus-visible:outline-2 disabled:opacity-50"
        @click="action('refresh')"
      >
        {{ t("刷新") }}
      </button>
    </div>
  </div>
</template>
