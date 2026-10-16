import { onMounted, onUnmounted } from "vue";
import type { Ref } from "vue";
import type { ShortcutAction } from "@/features/shortcuts/bindings";

export type ContextCommands = Partial<Record<ShortcutAction, () => void | Promise<unknown>>>;
const contexts = new Set<{
  element: Ref<HTMLElement | null>;
  commands: () => ContextCommands;
}>();

export function useContextCommands(
  element: Ref<HTMLElement | null>,
  commands: () => ContextCommands,
) {
  const context = { element, commands };
  onMounted(() => contexts.add(context));
  onUnmounted(() => contexts.delete(context));
}

export function getContextCommands(target: Element | null): ContextCommands {
  let result: ContextCommands = {};
  let nearest: HTMLElement | null = null;
  for (const context of contexts) {
    const element = context.element.value;
    if (!element || !target || !element.contains(target)) continue;
    if (nearest && !nearest.contains(element)) continue;
    nearest = element;
    result = context.commands();
  }
  return result;
}
