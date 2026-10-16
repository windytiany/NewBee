import { onMounted, onUnmounted } from "vue";
import { createFocusNavigation } from "@/shared/interaction/focus/navigation";

export function usePageFocus() {
  const navigation = createFocusNavigation(globalThis.document);
  onMounted(() => {
    globalThis.document.addEventListener("focusin", navigation.remember);
    globalThis.document.addEventListener("keydown", navigation.handleKeydown, true);
    globalThis.document.addEventListener("keydown", navigation.handleEscape);
  });
  onUnmounted(() => {
    globalThis.document.removeEventListener("focusin", navigation.remember);
    globalThis.document.removeEventListener("keydown", navigation.handleKeydown, true);
    globalThis.document.removeEventListener("keydown", navigation.handleEscape);
  });
}
