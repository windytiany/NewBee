import { watch } from "vue";
import { getUpdater } from "@/shared/update/runtime";

export function waitForUpdates(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const updater = getUpdater();
  if (!updater.holdsWindow.value) return Promise.resolve();
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
      updater.holdsWindow,
      (held) => {
        if (held) return;
        finish();
        resolve();
      },
      { flush: "sync" },
    );
    signal.addEventListener("abort", abort, { once: true });
  });
}
