import { ref } from "vue";

const rightPaneWidth = ref<number | null>(null);
const rightTopHeight = ref<number | null>(null);

export function useSharedRightSidebarLayout() {
  return { rightPaneWidth, rightTopHeight };
}
