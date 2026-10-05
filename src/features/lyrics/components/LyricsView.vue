<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    class="relative w-full"
    :class="{ 'md:flex md:h-full md:min-h-0 md:flex-col': props.compact }"
  >
    <section
      v-show="props.visible"
      ref="containerElement"
      aria-label="LyricsView"
      class="lyrics-scroll-container focus-visible:outline-app-accent w-full overflow-y-auto py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
      :class="
        props.compact
          ? 'max-h-[min(76vh,52rem)] md:max-h-none md:min-h-0 md:flex-1'
          : 'max-h-[min(68vh,40rem)]'
      "
      tabindex="0"
      @scroll.passive="lyricsFollow.handleScroll"
      @pointerdown="lyricsFollow.beginInteraction"
      @pointerup="lyricsFollow.endInteraction"
      @pointercancel="lyricsFollow.endInteraction"
      @pointerleave="lyricsFollow.endInteraction"
      @wheel.passive="handleWheel"
      @touchstart.passive="handleTouchStart"
      @touchmove.passive="handleTouchMove"
      @touchend.passive="clearTouchOrigin"
      @touchcancel.passive="clearTouchOrigin"
      @keydown="handleKeydown"
      @keyup="lyricsFollow.endInteraction"
      @blur="lyricsFollow.endInteraction"
    >
      <div ref="contentElement">
        <div
          v-if="props.lyrics.kind === 'none'"
          class="text-app-muted/45 mx-auto max-w-5xl leading-tight font-bold tracking-tight"
          :class="[
            props.compact ? 'text-2xl md:text-3xl lg:text-4xl' : 'text-3xl sm:text-4xl md:text-5xl',
            { 'px-6': !props.compact },
          ]"
        >
          无歌词
        </div>
        <p
          v-else-if="props.lyrics.kind === 'plain'"
          class="text-app-muted/45 mx-auto max-w-5xl leading-tight font-bold tracking-tight break-words whitespace-pre-wrap"
          :class="[
            props.compact ? 'text-2xl md:text-3xl lg:text-4xl' : 'text-3xl sm:text-4xl md:text-5xl',
            { 'px-6': !props.compact },
          ]"
        >
          {{ props.lyrics.text }}
        </p>
        <ol
          v-else
          ref="listElement"
          class="mx-auto max-w-5xl space-y-2"
          :class="{ 'px-6': !props.compact }"
          :style="{
            paddingBlockStart: `${edgePadding.top}px`,
            paddingBlockEnd: `${edgePadding.bottom}px`,
          }"
        >
          <li
            v-for="(line, index) in props.lyrics.lines"
            :key="index"
            :ref="(element) => setLineElement(index, element)"
            :aria-current="index === props.activeIndex ? 'true' : undefined"
            class="leading-tight font-bold tracking-tight transition-colors"
            :class="[
              props.compact
                ? 'text-2xl md:text-3xl lg:text-4xl'
                : 'text-3xl sm:text-4xl md:text-5xl',
              index >= props.activeGroupStartIndex && index <= props.activeIndex
                ? 'text-white'
                : 'text-app-muted/45',
              { 'min-h-[1.25em]': line.text.trim().length === 0 },
            ]"
          >
            <button
              v-if="line.text.trim().length > 0"
              type="button"
              :disabled="!props.canSeek"
              class="block w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left font-[inherit] text-inherit disabled:cursor-not-allowed"
              @click="emit('seek', line.startMs)"
            >
              {{ line.text }}
            </button>
          </li>
        </ol>
      </div>
    </section>
    <button
      v-if="props.visible && props.lyrics.kind === 'synced' && followState === 'browsing'"
      type="button"
      aria-label="恢复歌词跟随"
      title="恢复歌词跟随"
      class="bg-app-interactive text-app-muted focus-visible:outline-app-accent hover:bg-app-highlight absolute right-4 bottom-4 z-10 grid size-10 place-items-center rounded-full shadow-lg transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2"
      @click="returnToCurrentLyric"
    >
      <RefreshCw aria-hidden="true" class="size-5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef } from "vue";
import { RefreshCw } from "@lucide/vue";
import type { ComponentPublicInstance } from "vue";
import { isLyricsScrollKey, useLyricsFollow } from "@/features/lyrics/composables/useFollow";
import type { TrackLyrics } from "@/features/lyrics/types";

type BrowserElement = InstanceType<typeof globalThis.Element>;
type BrowserHTMLElement = InstanceType<typeof globalThis.HTMLElement>;
type BrowserHTMLOListElement = InstanceType<typeof globalThis.HTMLOListElement>;
type BrowserTouchEvent = InstanceType<typeof globalThis.TouchEvent>;
type BrowserKeyboardEvent = InstanceType<typeof globalThis.KeyboardEvent>;

const props = withDefaults(
  defineProps<{
    compact?: boolean;
    lyrics: TrackLyrics;
    activeIndex: number;
    activeGroupStartIndex: number;
    canSeek: boolean;
    trackId: number | null;
    visible: boolean;
    isSeeking: boolean;
  }>(),
  {
    compact: false,
  },
);

const emit = defineEmits<{ seek: [startMs: number] }>();
const containerElement = shallowRef<BrowserHTMLElement | null>(null);
const contentElement = shallowRef<BrowserHTMLElement | null>(null);
const listElement = shallowRef<BrowserHTMLOListElement | null>(null);
const lineElements = new Map<number, BrowserHTMLElement>();
const edgePadding = ref({ top: 0, bottom: 0 });
const lyricsFollow = useLyricsFollow({
  trackId: () => props.trackId,
  visible: () => props.visible,
  compact: () => props.compact,
  isSeeking: () => props.isSeeking,
  activeGroupStartIndex: () => props.activeGroupStartIndex,
  activeIndex: () => props.activeIndex,
  container: () => containerElement.value,
  content: () => contentElement.value,
  line: (index) => lineElements.get(index) ?? null,
  lineCount: () => (props.lyrics.kind === "synced" ? props.lyrics.lines.length : 0),
  setEdgePadding: (top, bottom) => {
    if (edgePadding.value.top !== top || edgePadding.value.bottom !== bottom) {
      edgePadding.value = { top, bottom };
    }
    if (listElement.value !== null) {
      listElement.value.style.paddingBlockStart = `${top}px`;
      listElement.value.style.paddingBlockEnd = `${bottom}px`;
    }
  },
});
const followState = lyricsFollow.state;
let touchOrigin: { x: number; y: number } | null = null;

function setLineElement(index: number, element: BrowserElement | ComponentPublicInstance | null) {
  if (element instanceof globalThis.HTMLElement) lineElements.set(index, element);
  else lineElements.delete(index);
}

function handleWheel() {
  lyricsFollow.startBrowsing();
}

function handleTouchStart(event: BrowserTouchEvent) {
  lyricsFollow.beginInteraction();
  const touch = event.touches[0];
  touchOrigin = touch === undefined ? null : { x: touch.clientX, y: touch.clientY };
}

function handleTouchMove(event: BrowserTouchEvent) {
  const touch = event.touches[0];
  if (touchOrigin === null || touch === undefined) return;
  if (Math.abs(touch.clientX - touchOrigin.x) + Math.abs(touch.clientY - touchOrigin.y) < 4) return;
  touchOrigin = null;
  lyricsFollow.startBrowsing();
}

function clearTouchOrigin() {
  touchOrigin = null;
  lyricsFollow.endInteraction();
}

function handleKeydown(event: BrowserKeyboardEvent) {
  const target = event.target;
  const isInteractiveTarget =
    target instanceof globalThis.Element &&
    target.closest('button, a[href], input, select, textarea, [contenteditable="true"]') !== null;
  if (isLyricsScrollKey(event.key, event.code, isInteractiveTarget)) {
    lyricsFollow.beginInteraction();
    lyricsFollow.startBrowsing();
  }
}

function returnToCurrentLyric() {
  lyricsFollow.returnToCurrentLyric();
}
</script>

<style scoped>
.lyrics-scroll-container {
  scrollbar-width: none;
}

.lyrics-scroll-container::-webkit-scrollbar {
  display: none;
}
</style>
