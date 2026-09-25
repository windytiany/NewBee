<template>
  <div
    ref="layoutElement"
    class="grid h-[calc(100vh-8.5rem)] w-full min-w-0 grid-cols-(--three-column-layout-columns) bg-spotify-base max-md:grid-cols-1 md:h-[calc(100vh-6rem)]"
    :style="{ '--three-column-layout-columns': gridColumns }"
  >
    <Sidebar side="left" class="max-md:hidden">
      <slot name="left" />
    </Sidebar>

    <ResizeHandle
      label="调整左侧栏宽度"
      class="max-md:hidden"
      orientation="vertical"
      :value="leftPaneWidth"
      :min-value="MIN_LEFT_PANE_WIDTH"
      :max-value="leftPaneMaxWidth"
      @resize="resizeLeftPane"
    />

    <section class="grid min-w-0 place-items-center text-white">
      <slot name="center" />
    </section>

    <ResizeHandle
      label="调整右侧栏宽度"
      reverse
      class="max-md:hidden"
      orientation="vertical"
      :value="rightPaneWidth"
      :min-value="MIN_RIGHT_PANE_WIDTH"
      :max-value="rightPaneMaxWidth"
      @resize="resizeRightPane"
    />

    <Sidebar side="right" class="max-md:hidden">
      <div
        class="grid h-full min-h-0"
        :style="{
          gridTemplateRows: `minmax(${MIN_RIGHT_TOP_HEIGHT}px, ${rightTopHeight}px) ${RESIZE_HANDLE_SIZE}px minmax(${MIN_RIGHT_BOTTOM_HEIGHT}px, 1fr)`,
        }"
      >
        <div class="h-full min-h-0 min-w-0 overflow-hidden">
          <slot name="right-top" />
        </div>
        <ResizeHandle
          label="调整右侧上下区域高度"
          orientation="horizontal"
          :value="rightTopHeight"
          :min-value="MIN_RIGHT_TOP_HEIGHT"
          :max-value="rightTopMaxHeight"
          @resize="resizeRightTop"
        />
        <div class="h-full min-h-0 min-w-0 overflow-hidden">
          <slot name="right-bottom" />
        </div>
      </div>
    </Sidebar>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ResizeHandle from "./ResizeHandle.vue";
import Sidebar from "./Sidebar.vue";

const MIN_LEFT_PANE_WIDTH = 208;
const MIN_RIGHT_PANE_WIDTH = 240;
const MAX_PANE_WIDTH = 480;
const MIN_CENTER_WIDTH = 280;
const RESIZE_HANDLE_SIZE = 6;
const MIN_RIGHT_TOP_HEIGHT = 160;
const MAX_RIGHT_TOP_HEIGHT = 560;
const MIN_RIGHT_BOTTOM_HEIGHT = 240;
const INITIAL_PANE_WIDTH_RATIO = 0.17;
const INITIAL_RIGHT_TOP_HEIGHT_RATIO = 0.4;

const layoutElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const containerWidth = ref(0);
const containerHeight = ref(0);
const leftPaneWidth = ref(MIN_LEFT_PANE_WIDTH);
const rightPaneWidth = ref(MIN_RIGHT_PANE_WIDTH);
const rightTopHeight = ref(MIN_RIGHT_TOP_HEIGHT);
let resizeObserver: InstanceType<typeof globalThis.ResizeObserver> | null = null;
let hasInitialLayout = false;

const gridColumns = computed(
  () =>
    `minmax(${MIN_LEFT_PANE_WIDTH}px, ${leftPaneWidth.value}px) ${RESIZE_HANDLE_SIZE}px minmax(${MIN_CENTER_WIDTH}px, 1fr) ${RESIZE_HANDLE_SIZE}px minmax(${MIN_RIGHT_PANE_WIDTH}px, ${rightPaneWidth.value}px)`,
);

const rightTopMaxHeight = computed(() => getRightTopMaxHeight(containerHeight.value));
const leftPaneMaxWidth = computed(() =>
  Math.max(
    MIN_LEFT_PANE_WIDTH,
    Math.min(MAX_PANE_WIDTH, getPaneWidthBudget(containerWidth.value) - rightPaneWidth.value),
  ),
);
const rightPaneMaxWidth = computed(() =>
  Math.max(
    MIN_RIGHT_PANE_WIDTH,
    Math.min(MAX_PANE_WIDTH, getPaneWidthBudget(containerWidth.value) - leftPaneWidth.value),
  ),
);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPaneWidthBudget(width: number) {
  return Math.max(
    MIN_LEFT_PANE_WIDTH + MIN_RIGHT_PANE_WIDTH,
    width - MIN_CENTER_WIDTH - RESIZE_HANDLE_SIZE * 2,
  );
}

function getRightTopMaxHeight(height: number) {
  return Math.max(
    MIN_RIGHT_TOP_HEIGHT,
    Math.min(MAX_RIGHT_TOP_HEIGHT, height - RESIZE_HANDLE_SIZE - MIN_RIGHT_BOTTOM_HEIGHT),
  );
}

function fitPaneWidths(left: number, right: number, width: number) {
  let nextLeft = clamp(left, MIN_LEFT_PANE_WIDTH, MAX_PANE_WIDTH);
  let nextRight = clamp(right, MIN_RIGHT_PANE_WIDTH, MAX_PANE_WIDTH);
  const availableExtra = getPaneWidthBudget(width) - MIN_LEFT_PANE_WIDTH - MIN_RIGHT_PANE_WIDTH;
  const requestedExtra = nextLeft - MIN_LEFT_PANE_WIDTH + nextRight - MIN_RIGHT_PANE_WIDTH;

  if (requestedExtra > availableExtra) {
    const scale = availableExtra / requestedExtra;
    nextLeft = MIN_LEFT_PANE_WIDTH + (nextLeft - MIN_LEFT_PANE_WIDTH) * scale;
    nextRight = MIN_RIGHT_PANE_WIDTH + (nextRight - MIN_RIGHT_PANE_WIDTH) * scale;
  }

  return [nextLeft, nextRight] as const;
}

function resizeLeftPane(width: number) {
  leftPaneWidth.value = clamp(width, MIN_LEFT_PANE_WIDTH, leftPaneMaxWidth.value);
}

function resizeRightPane(width: number) {
  rightPaneWidth.value = clamp(width, MIN_RIGHT_PANE_WIDTH, rightPaneMaxWidth.value);
}

function resizeRightTop(height: number) {
  rightTopHeight.value = clamp(height, MIN_RIGHT_TOP_HEIGHT, rightTopMaxHeight.value);
}

function updateContainerSize(width: number, height: number) {
  containerWidth.value = width;
  containerHeight.value = height;

  if (!hasInitialLayout) {
    hasInitialLayout = true;
    leftPaneWidth.value = clamp(
      width * INITIAL_PANE_WIDTH_RATIO,
      MIN_LEFT_PANE_WIDTH,
      MAX_PANE_WIDTH,
    );
    rightPaneWidth.value = clamp(
      width * INITIAL_PANE_WIDTH_RATIO,
      MIN_RIGHT_PANE_WIDTH,
      MAX_PANE_WIDTH,
    );
    rightTopHeight.value = clamp(
      height * INITIAL_RIGHT_TOP_HEIGHT_RATIO,
      MIN_RIGHT_TOP_HEIGHT,
      getRightTopMaxHeight(height),
    );
  }

  [leftPaneWidth.value, rightPaneWidth.value] = fitPaneWidths(
    leftPaneWidth.value,
    rightPaneWidth.value,
    width,
  );
  rightTopHeight.value = clamp(
    rightTopHeight.value,
    MIN_RIGHT_TOP_HEIGHT,
    getRightTopMaxHeight(height),
  );
}

onMounted(() => {
  const element = layoutElement.value;
  if (!element) return;

  resizeObserver = new globalThis.ResizeObserver(([entry]) => {
    if (!entry) return;
    updateContainerSize(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(element);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>
