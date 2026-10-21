import { ref, watch } from "vue";

const reducedMotion = ref(false);

export function isReducedMotionEnabled(): boolean {
  return reducedMotion.value;
}

export function onReducedMotionChange(callback: () => void): () => void {
  return watch(reducedMotion, callback, { flush: "sync" });
}

export function applyReducedMotion(enabled: boolean) {
  globalThis.document.documentElement.dataset.reducedMotion = String(enabled);
  reducedMotion.value = enabled;
}
