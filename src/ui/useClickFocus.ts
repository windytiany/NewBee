import { onMounted, onUnmounted, ref } from "vue";

export function useClickFocus() {
  const focusedItem = ref<string | null>(null);

  function clearFocus() {
    focusedItem.value = null;
  }

  function setFocusedItem(itemKey: string) {
    focusedItem.value = itemKey;
  }

  onMounted(() => {
    globalThis.document.addEventListener("click", clearFocus, true);
  });

  onUnmounted(() => {
    globalThis.document.removeEventListener("click", clearFocus, true);
  });

  return { focusedItem, setFocusedItem };
}
