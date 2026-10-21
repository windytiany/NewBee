import { readonly, shallowRef } from "vue";

export function createReplayGainConfirmation() {
  const state = shallowRef<{ title: string; message: string } | null>(null);
  let finish: ((confirmed: boolean) => void) | null = null;

  function ask(title: string, message: string): Promise<boolean> {
    if (finish) return Promise.resolve(false);
    return new Promise((resolve) => {
      finish = resolve;
      state.value = { title, message };
    });
  }

  function resolve(confirmed: boolean) {
    const complete = finish;
    finish = null;
    state.value = null;
    complete?.(confirmed);
  }

  return { state: readonly(state), ask, resolve };
}

const confirmation = createReplayGainConfirmation();
export function useReplayGainConfirmation() {
  return confirmation;
}
