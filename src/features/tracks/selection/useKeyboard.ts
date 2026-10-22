import { onMounted, onUnmounted } from "vue";
import type { Ref } from "vue";

export function useTrackSelectionKeyboard(
  list: Ref<HTMLElement | null>,
  keyboard: { onSelectAllKeydown: (event: KeyboardEvent) => void },
) {
  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.key.toLowerCase() !== "a" || !event.ctrlKey) return;
    const element = list.value;
    if (
      !element ||
      !element.isConnected ||
      !element.getClientRects().length ||
      element.closest('[inert], [aria-hidden="true"]')
    )
      return;
    if (
      event.target instanceof Element &&
      event.target.closest('dialog, [role="menu"], [data-local-drop="queue"]')
    )
      return;
    if (
      [...document.querySelectorAll<HTMLElement>('dialog[open], [role="menu"]')].some(
        (overlay) => overlay.getClientRects().length > 0,
      )
    )
      return;
    keyboard.onSelectAllKeydown(event);
  }

  onMounted(() => document.addEventListener("keydown", onKeydown));
  onUnmounted(() => document.removeEventListener("keydown", onKeydown));
}
