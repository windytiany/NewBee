<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="lyrics-view relative h-full min-h-0 w-full">
    <section
      v-show="props.visible"
      ref="containerElement"
      aria-label="LyricsView"
      class="lyrics-scroll-container h-full w-full overflow-y-auto"
      :style="fadeStyle"
      tabindex="-1"
      @scroll.passive="handleScroll"
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
          v-if="props.lyrics.kind === 'none' || props.lyrics.kind === 'instrumental'"
          class="text-app-muted/45 leading-tight font-bold tracking-tight"
          :class="lyricSize"
        >
          {{ props.lyrics.kind === "instrumental" ? t("此曲目已标记为无歌词") : t("无歌词") }}
        </div>
        <div
          v-else-if="props.lyrics.kind === 'plain'"
          class="lyric-lines text-app-muted/45 leading-tight font-bold tracking-tight"
          :class="lyricSize"
        >
          <p
            v-for="(line, index) in props.lyrics.text.split('\n')"
            :key="index"
            class="wrap-anywhere whitespace-pre-wrap"
            :class="{ 'lyric-blank': line.trim().length === 0 }"
          >
            {{ line }}
          </p>
        </div>
        <ol
          v-else
          ref="listElement"
          class="lyric-lines"
          :class="lyricSize"
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
              index >= props.activeGroupStartIndex && index <= props.activeIndex
                ? 'text-white'
                : 'text-app-muted/45',
              { 'lyric-blank': line.text.trim().length === 0 },
            ]"
          >
            <button
              v-if="line.text.trim().length > 0"
              type="button"
              tabindex="-1"
              :disabled="!props.canSeek"
              class="block w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left font-[inherit] wrap-anywhere text-inherit disabled:cursor-not-allowed"
              @click="emit('seek', line.startMs)"
            >
              {{ line.text }}
            </button>
          </li>
        </ol>
      </div>
    </section>
    <slot
      v-if="props.visible && props.lyrics.kind === 'synced' && followState === 'browsing'"
      name="controls"
      :return-to-current-lyric="lyricsFollow.returnToCurrentLyric"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, ref, shallowRef, watchPostEffect } from "vue";
import type { ComponentPublicInstance } from "vue";
import { useLyricsFollow } from "@/features/lyrics/useFollow";
import { isLyricsScrollKey } from "@/features/lyrics/scroll";
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

defineSlots<{ controls(props: { returnToCurrentLyric: () => void }): unknown }>();
const emit = defineEmits<{ seek: [startMs: number] }>();
const lyricSize = computed(() =>
  props.compact ? "text-2xl md:text-3xl lg:text-4xl" : "text-3xl sm:text-4xl md:text-5xl",
);
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
const fadeStyle = shallowRef<Record<string, string>>();
let touchOrigin: { x: number; y: number } | null = null;

watchPostEffect((onCleanup) => {
  const container = containerElement.value;
  const content = contentElement.value;
  if (!props.visible || container === null || content === null) return;

  const observer = new globalThis.ResizeObserver(updateFades);
  observer.observe(container);
  observer.observe(content);
  onCleanup(() => observer.disconnect());
});
watchPostEffect(updateFades);

function updateFades() {
  // Reading the padding also refreshes the fades when follow alignment changes without scrolling.
  const { top: paddingTop, bottom: paddingBottom } = edgePadding.value;
  const container = containerElement.value;
  const content = contentElement.value;
  if (!props.visible || container === null || content === null) return;

  const viewport = container.getBoundingClientRect();
  const lyrics = content.getBoundingClientRect();
  const synced = props.lyrics.kind === "synced";
  const above = Math.max(0, viewport.top - lyrics.top - (synced ? paddingTop : 0));
  const below = Math.max(0, lyrics.bottom - viewport.bottom - (synced ? paddingBottom : 0));
  const limit = Math.min(48, viewport.height * 0.12);
  const fadeTop = `${Math.min(limit, above)}px`;
  const fadeBottom = `${Math.min(limit, below)}px`;
  if (
    fadeStyle.value?.["--fade-top"] !== fadeTop ||
    fadeStyle.value["--fade-bottom"] !== fadeBottom
  ) {
    fadeStyle.value = { "--fade-top": fadeTop, "--fade-bottom": fadeBottom };
  }
}

function handleScroll() {
  lyricsFollow.handleScroll();
  updateFades();
}

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
</script>

<style scoped>
.lyrics-view:has(> .lyrics-scroll-container:focus-visible) {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}

.lyric-lines {
  display: flow-root;
}

.lyric-lines > :not(.lyric-blank) + :not(.lyric-blank) {
  margin-block-start: 1.2em;
}

/* A run of blank lines replaces the regular gap with one stanza break. */
.lyric-blank {
  height: 1.5em;
  overflow: hidden;
}

.lyric-blank + .lyric-blank {
  height: 0;
}

.lyrics-scroll-container {
  scrollbar-width: none;
  mask-image: linear-gradient(
    to bottom,
    transparent,
    black var(--fade-top, 0px),
    black calc(100% - var(--fade-bottom, 0px)),
    transparent
  );
}

@media (forced-colors: active) {
  .lyrics-scroll-container {
    mask-image: none;
  }
}

.lyrics-scroll-container::-webkit-scrollbar {
  display: none;
}
</style>
