<template>
  <div
    ref="layoutElement"
    class="bg-app-base grid h-[calc(100vh-var(--spacing)*34)] min-h-0 w-full min-w-0 grid-cols-(--three-column-layout-columns) overflow-hidden max-md:grid-cols-1 md:h-[calc(100vh-var(--spacing)*24)]"
    :style="{ '--three-column-layout-columns': gridColumns }"
  >
    <slot name="workspace" />

    <ResizeHandle
      v-show="props.mode === 'workspace'"
      :label="t('调整左侧栏宽度')"
      class="z-20 col-start-2 row-start-1 -translate-x-1/2 max-md:hidden"
      orientation="vertical"
      :value="leftPaneWidth"
      :min-value="MIN_LEFT_PANE_WIDTH"
      :max-value="leftPaneMaxWidth"
      @resize="resizeLeftPane"
    />

    <section
      v-if="props.mode === 'playing'"
      class="col-start-1 row-start-1 grid h-full min-h-0 min-w-0 place-items-center overflow-hidden text-white"
    >
      <slot name="playing" />
    </section>

    <ResizeHandle
      v-show="props.mode === 'workspace'"
      :label="t('调整右侧栏宽度')"
      reverse
      class="z-20 col-start-4 row-start-1 -translate-x-1/2 max-md:hidden"
      orientation="vertical"
      :value="rightPaneWidth"
      :min-value="MIN_RIGHT_PANE_WIDTH"
      :max-value="rightPaneMaxWidth"
      @resize="resizeRightPane"
    />

    <SidePane
      v-show="props.mode === 'workspace'"
      side="right"
      class="col-start-5 row-start-1 max-md:hidden"
    >
      <div
        ref="sidebarElement"
        class="grid h-full min-h-0"
        :style="{
          gridTemplateRows: `minmax(${MIN_RIGHT_TOP_HEIGHT}px, ${rightTopHeight}px) ${RESIZE_HANDLE_SIZE}px minmax(${MIN_RIGHT_BOTTOM_HEIGHT}px, 1fr)`,
        }"
      >
        <div class="h-full min-h-0 min-w-0 overflow-hidden">
          <slot name="queue" />
        </div>
        <ResizeHandle
          :label="t('调整右侧上下区域高度')"
          orientation="horizontal"
          :value="rightTopHeight"
          :min-value="MIN_RIGHT_TOP_HEIGHT"
          :max-value="rightTopMaxHeight"
          @resize="resizeRightTop"
        />
        <div class="h-full min-h-0 min-w-0 overflow-hidden">
          <slot name="details" />
        </div>
      </div>
    </SidePane>
  </div>
</template>

<script setup lang="ts">
import { t } from "@/shared/i18n/locale";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePaneSizes } from "@/app/shell/usePaneSizes";
import ResizeHandle from "@/shared/interaction/resize/ResizeHandle.vue";
import SidePane from "@/shared/layout/SidePane.vue";

const props = withDefaults(defineProps<{ mode?: "workspace" | "playing" }>(), {
  mode: "workspace",
});

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

const {
  leftPaneWidth: sharedLeftPaneWidth,
  rightPaneWidth: sharedRightPaneWidth,
  rightTopHeight: sharedRightTopHeight,
} = usePaneSizes();
const fittedPaneWidths = computed(() =>
  fitPaneWidths(
    sharedLeftPaneWidth.value ?? MIN_LEFT_PANE_WIDTH,
    sharedRightPaneWidth.value ?? MIN_RIGHT_PANE_WIDTH,
    containerWidth.value,
  ),
);
const leftPaneWidth = computed(() => fittedPaneWidths.value[0]);
const rightPaneWidth = computed(() => fittedPaneWidths.value[1]);
const rightTopHeight = computed(() =>
  clamp(
    sharedRightTopHeight.value ?? MIN_RIGHT_TOP_HEIGHT,
    MIN_RIGHT_TOP_HEIGHT,
    getRightTopMaxHeight(containerHeight.value),
  ),
);
const layoutElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const sidebarElement = ref<InstanceType<typeof globalThis.HTMLDivElement> | null>(null);
const containerWidth = ref(0);
const containerHeight = ref(0);
let layoutResizeObserver: InstanceType<typeof globalThis.ResizeObserver> | null = null;
let sidebarResizeObserver: InstanceType<typeof globalThis.ResizeObserver> | null = null;
let hasInitialLayout = false;
let hasInitialSidebarHeight = false;

const gridColumns = computed(() =>
  props.mode === "playing"
    ? "minmax(0, 1fr)"
    : `minmax(${MIN_LEFT_PANE_WIDTH}px, ${leftPaneWidth.value}px) 0px minmax(${MIN_CENTER_WIDTH}px, 1fr) 0px minmax(${MIN_RIGHT_PANE_WIDTH}px, ${rightPaneWidth.value}px)`,
);

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
const rightTopMaxHeight = computed(() => getRightTopMaxHeight(containerHeight.value));

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPaneWidthBudget(width: number) {
  return Math.max(MIN_LEFT_PANE_WIDTH + MIN_RIGHT_PANE_WIDTH, width - MIN_CENTER_WIDTH);
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
  sharedLeftPaneWidth.value = clamp(width, MIN_LEFT_PANE_WIDTH, leftPaneMaxWidth.value);
}

function resizeRightPane(width: number) {
  sharedRightPaneWidth.value = clamp(width, MIN_RIGHT_PANE_WIDTH, rightPaneMaxWidth.value);
}

function resizeRightTop(height: number) {
  sharedRightTopHeight.value = clamp(height, MIN_RIGHT_TOP_HEIGHT, rightTopMaxHeight.value);
}

function updateContainerWidth(width: number) {
  if (width <= 0) return;
  containerWidth.value = width;

  if (props.mode === "playing") return;

  if (!hasInitialLayout) {
    hasInitialLayout = true;
    sharedLeftPaneWidth.value ??= clamp(
      width * INITIAL_PANE_WIDTH_RATIO,
      MIN_LEFT_PANE_WIDTH,
      MAX_PANE_WIDTH,
    );
    sharedRightPaneWidth.value ??= clamp(
      width * INITIAL_PANE_WIDTH_RATIO,
      MIN_RIGHT_PANE_WIDTH,
      MAX_PANE_WIDTH,
    );
  }
}

function updateContainerHeight(height: number) {
  if (height <= 0 || props.mode === "playing") return;
  containerHeight.value = height;

  if (!hasInitialSidebarHeight) {
    hasInitialSidebarHeight = true;
    sharedRightTopHeight.value ??= clamp(
      height * INITIAL_RIGHT_TOP_HEIGHT_RATIO,
      MIN_RIGHT_TOP_HEIGHT,
      getRightTopMaxHeight(height),
    );
  }
}

watch(
  () => props.mode,
  (mode) => {
    if (mode !== "workspace") return;

    const layout = layoutElement.value;
    if (layout) updateContainerWidth(layout.getBoundingClientRect().width);

    const sidebar = sidebarElement.value;
    if (sidebar) updateContainerHeight(sidebar.getBoundingClientRect().height);
  },
  { flush: "post" },
);

onMounted(() => {
  const layout = layoutElement.value;
  if (layout) {
    layoutResizeObserver = new globalThis.ResizeObserver(([entry]) => {
      if (!entry) return;
      updateContainerWidth(entry.contentRect.width);
    });
    layoutResizeObserver.observe(layout);
  }

  const sidebar = sidebarElement.value;
  if (sidebar) {
    sidebarResizeObserver = new globalThis.ResizeObserver(([entry]) => {
      if (!entry) return;
      updateContainerHeight(entry.contentRect.height);
    });
    sidebarResizeObserver.observe(sidebar);
  }
});

onBeforeUnmount(() => {
  layoutResizeObserver?.disconnect();
  layoutResizeObserver = null;
  sidebarResizeObserver?.disconnect();
  sidebarResizeObserver = null;
});
</script>
