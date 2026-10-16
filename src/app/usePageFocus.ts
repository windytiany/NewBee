import { nextTick, onMounted, onUnmounted, watch } from "vue";
import type { Ref } from "vue";
import type { PageName } from "@/app/pages";
import { createFocusNavigation } from "@/shared/interaction/focus/navigation";

export function usePageFocus(page: Ref<PageName>) {
  const remembered = new Map<PageName, HTMLElement>();
  const navigation = createFocusNavigation(globalThis.document);
  function remember(event: FocusEvent) {
    navigation.remember(event);
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(`[data-page="${page.value}"]`)) {
      remembered.set(page.value, target);
    }
  }
  async function restore() {
    const current = page.value;
    await nextTick();
    if (current !== page.value || globalThis.document.querySelector("dialog[open]")) return;
    const root = globalThis.document.querySelector<HTMLElement>(`[data-page="${current}"]`);
    const previous = remembered.get(current);
    if (
      previous?.isConnected &&
      root?.contains(previous) &&
      !previous.matches(":disabled") &&
      previous.getClientRects().length
    ) {
      previous.focus();
      return;
    }
    function firstVisible(selector: string) {
      return [...(root?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
        (element) => !element.matches(":disabled") && element.getClientRects().length,
      );
    }
    const first =
      firstVisible(
        "button[data-track-select], button[data-playlist-track-select], button[data-album-track-row], button[data-album-card]",
      ) ??
      firstVisible("button[data-item-interaction], button[data-playlist-id]") ??
      firstVisible('button, [tabindex="0"]');
    first?.focus();
  }
  watch(
    page,
    () => {
      void restore();
    },
    { flush: "post" },
  );
  onMounted(() => {
    globalThis.document.addEventListener("focusin", remember);
    globalThis.document.addEventListener("keydown", navigation.handleKeydown, true);
  });
  onUnmounted(() => {
    globalThis.document.removeEventListener("focusin", remember);
    globalThis.document.removeEventListener("keydown", navigation.handleKeydown, true);
  });
}
