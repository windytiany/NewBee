type ReleaseOptions = {
  prepare: (signal: AbortSignal) => Promise<boolean>;
  hide: (request: number) => Promise<boolean>;
  idle: (signal: AbortSignal) => Promise<void>;
  release: (request: number) => Promise<unknown>;
  cancel: (request: number, fallback?: boolean) => Promise<unknown>;
  failed: (error: unknown) => void;
};

export function createWindowRelease(options: ReleaseOptions) {
  let pending: AbortController | undefined;
  function cancel() {
    pending?.abort();
    pending = undefined;
  }
  async function request(id: number) {
    cancel();
    const controller = new AbortController();
    pending = controller;
    const { signal } = controller;
    try {
      if (!(await options.prepare(signal))) {
        if (!signal.aborted) await options.cancel(id);
        return;
      }
      if (signal.aborted || !(await options.hide(id))) return;
      await options.idle(signal);
      if (!signal.aborted) await options.release(id);
    } catch (error) {
      if (signal.aborted) return;
      let failure = error;
      try {
        await options.cancel(id, true);
      } catch (reason) {
        failure = { error, cancellationError: reason };
      }
      options.failed(failure);
    } finally {
      if (pending === controller) pending = undefined;
    }
  }
  return { request, cancel };
}
