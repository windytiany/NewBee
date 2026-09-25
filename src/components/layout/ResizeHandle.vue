<template>
  <div
    role="separator"
    :aria-label="label"
    :aria-orientation="orientation"
    :aria-valuemin="minValue"
    :aria-valuemax="maxValue"
    :aria-valuenow="value"
    :class="
      orientation === 'vertical'
        ? 'h-full w-1.5 cursor-col-resize'
        : 'h-1.5 w-full cursor-row-resize'
    "
    class="touch-none bg-transparent select-none hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-white/20"
    tabindex="0"
    @pointerdown="startPointerDrag"
    @pointermove="movePointerDrag"
    @pointerup="finishPointerDrag"
    @pointercancel="finishPointerDrag"
    @lostpointercapture="finishPointerDrag"
    @keydown="handleKeydown"
  />
</template>

<script setup lang="ts">
const KEYBOARD_STEP = 10;

type Orientation = "vertical" | "horizontal";

const props = withDefaults(
  defineProps<{
    orientation: Orientation;
    label: string;
    value: number;
    minValue: number;
    maxValue: number;
    reverse?: boolean;
  }>(),
  { reverse: false },
);

const emit = defineEmits<{
  resize: [value: number];
}>();

let activePointerId: number | null = null;
let startCoordinate = 0;
let startValue = 0;

function clampValue(value: number) {
  return Math.max(props.minValue, Math.min(props.maxValue, value));
}

function getCoordinate(event: InstanceType<typeof globalThis.PointerEvent>) {
  return props.orientation === "vertical" ? event.clientX : event.clientY;
}

function startPointerDrag(event: InstanceType<typeof globalThis.PointerEvent>) {
  if (event.button !== 0 || activePointerId !== null) return;

  event.preventDefault();
  activePointerId = event.pointerId;
  startCoordinate = getCoordinate(event);
  startValue = props.value;
  if (event.currentTarget instanceof globalThis.HTMLElement) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
}

function movePointerDrag(event: InstanceType<typeof globalThis.PointerEvent>) {
  if (event.pointerId !== activePointerId) return;

  const pointerDelta = getCoordinate(event) - startCoordinate;
  const direction = props.reverse ? -1 : 1;
  emit("resize", clampValue(startValue + pointerDelta * direction));
}

function finishPointerDrag(event: InstanceType<typeof globalThis.PointerEvent>) {
  if (event.pointerId === activePointerId) activePointerId = null;
}

function handleKeydown(event: InstanceType<typeof globalThis.KeyboardEvent>) {
  const increaseKey = props.orientation === "vertical" ? "ArrowRight" : "ArrowDown";
  const decreaseKey = props.orientation === "vertical" ? "ArrowLeft" : "ArrowUp";

  const direction = props.reverse ? -1 : 1;

  if (event.key === increaseKey) {
    event.preventDefault();
    emit("resize", clampValue(props.value + KEYBOARD_STEP * direction));
  } else if (event.key === decreaseKey) {
    event.preventDefault();
    emit("resize", clampValue(props.value - KEYBOARD_STEP * direction));
  }
}
</script>
