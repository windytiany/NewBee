import { ref, watch, type WatchSource } from "vue";

const active = ref(0);
const guards = new Set<(signal: AbortSignal) => Promise<boolean>>();

export function watchActivity(source: WatchSource<boolean>) {
  return watch(
    source,
    (busy, _previous, onCleanup) => {
      if (!busy) return;
      active.value++;
      onCleanup(() => {
        active.value--;
      });
    },
    { immediate: true, flush: "sync" },
  );
}

export function beforeRelease(guard: (signal: AbortSignal) => Promise<boolean>) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export async function prepareRelease(signal: AbortSignal) {
  for (const guard of guards) {
    if (signal.aborted || !(await guard(signal))) return false;
  }
  return !signal.aborted;
}

export function waitForIdle(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (active.value === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      stop();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    const stop = watch(
      active,
      (count) => {
        if (count !== 0) return;
        finish();
        resolve();
      },
      { flush: "post" },
    );
    signal.addEventListener("abort", abort, { once: true });
  });
}
