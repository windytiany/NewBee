import type { Directive } from "vue";
import { logger } from "@/shared/logging/logger";

const STORAGE_KEY = "newbee.scroll-positions";
type Position = { top: number; left: number };
type Positions = Record<string, Position>;
type ScrollBinding = string | { scope: string; paused: boolean };
type ScrollState = {
  scope: string;
  setPaused: (paused: boolean) => void;
  restore: () => void;
  dispose: () => void;
};
const elements = new WeakMap<HTMLElement, ScrollState>();

function readPositions(): Positions {
  try {
    if (!globalThis.localStorage) return {};
    const serialized = globalThis.localStorage.getItem(STORAGE_KEY);
    if (serialized === null) return {};
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const positions: Positions = {};
    for (const [scope, position] of Object.entries(value)) {
      if (typeof position !== "object" || position === null) continue;
      if (
        "top" in position &&
        typeof position.top === "number" &&
        Number.isFinite(position.top) &&
        position.top >= 0 &&
        "left" in position &&
        typeof position.left === "number" &&
        Number.isFinite(position.left) &&
        position.left >= 0
      )
        positions[scope] = { top: position.top, left: position.left };
    }
    return positions;
  } catch (error) {
    logger.warn("interaction/scroll", "Could not read scroll positions.", error);
    return {};
  }
}

function options(value: ScrollBinding) {
  return typeof value === "string" ? { scope: value, paused: false } : value;
}

function attach(element: HTMLElement, scope: string, paused: boolean) {
  let target = readPositions()[scope];
  let pending = target !== undefined;
  const restore = () => {
    if (paused || !element.clientHeight || !pending || !target) return;
    // Hidden panes and asynchronously loaded lists may not have enough content yet.
    const maxTop = element.scrollHeight - element.clientHeight;
    const maxLeft = element.scrollWidth - element.clientWidth;
    if (
      !Number.isFinite(maxTop) ||
      !Number.isFinite(maxLeft) ||
      maxTop < target.top ||
      maxLeft < target.left
    )
      return;
    element.scrollTop = target.top;
    element.scrollLeft = target.left;
    pending = false;
  };
  const save = () => {
    if (
      paused ||
      pending ||
      !element.clientHeight ||
      !Number.isFinite(element.scrollTop) ||
      !Number.isFinite(element.scrollLeft)
    )
      return;
    target = {
      top: Math.max(0, element.scrollTop),
      left: Math.max(0, element.scrollLeft),
    };
    try {
      if (!globalThis.localStorage) return;
      const positions = readPositions();
      positions[scope] = target;
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    } catch (error) {
      logger.warn("interaction/scroll", "Could not save scroll positions.", error);
    }
  };
  const interact = () => {
    if (!paused) pending = false;
  };
  element.addEventListener("scroll", save, { passive: true });
  for (const event of ["wheel", "pointerdown", "keydown"])
    element.addEventListener(event, interact, { passive: true });
  const resize =
    typeof globalThis.ResizeObserver === "function" ? new globalThis.ResizeObserver(restore) : null;
  const mutation =
    typeof globalThis.MutationObserver === "function"
      ? new globalThis.MutationObserver(restore)
      : null;
  resize?.observe(element);
  mutation?.observe(element, { childList: true, subtree: true });
  restore();
  elements.set(element, {
    scope,
    setPaused(value) {
      if (value && !paused) {
        save();
        pending = target !== undefined;
      }
      paused = value;
    },
    restore,
    dispose() {
      save();
      element.removeEventListener("scroll", save);
      for (const event of ["wheel", "pointerdown", "keydown"])
        element.removeEventListener(event, interact);
      resize?.disconnect();
      mutation?.disconnect();
    },
  });
}

export const vPersistentScroll: Directive<HTMLElement, ScrollBinding> = {
  mounted(element, binding) {
    const { scope, paused } = options(binding.value);
    attach(element, scope, paused);
  },
  beforeUpdate(element, binding) {
    const { scope, paused } = options(binding.value);
    const current = elements.get(element);
    if (current?.scope === scope) {
      current.setPaused(paused);
      return;
    }
    current?.dispose();
    elements.delete(element);
  },
  updated(element, binding) {
    const { scope, paused } = options(binding.value);
    const current = elements.get(element);
    if (current?.scope === scope) {
      current.restore();
      return;
    }
    current?.dispose();
    attach(element, scope, paused);
  },
  beforeUnmount(element) {
    elements.get(element)?.dispose();
    elements.delete(element);
  },
};
