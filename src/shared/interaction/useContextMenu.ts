import { computed, nextTick, onScopeDispose, readonly, ref, shallowRef } from "vue";
import type { Ref, ShallowRef } from "vue";

type ContextMenuRequest<Payload> = {
  x: number;
  y: number;
  trigger: HTMLElement;
  payload: Payload;
};

type ContextMenuElements = {
  menuElement: Readonly<Ref<HTMLElement | null>>;
  firstMenuItemElement: Readonly<Ref<HTMLElement | null>>;
  fallbackFocusElement: Readonly<Ref<HTMLElement | null>>;
};

type ContextMenuPosition = {
  x: number;
  y: number;
};

type ContextMenuListeners = {
  pointerdown: (event: PointerEvent) => void;
  keydown: (event: KeyboardEvent) => void;
  scroll: (event: Event) => void;
  resize: () => void;
};

type ContextMenuController<Payload> = {
  elements: ContextMenuElements;
  request: ShallowRef<ContextMenuRequest<Payload> | null>;
  position: Ref<ContextMenuPosition>;
  generation: number;
  listenersAttached: boolean;
  listeners: ContextMenuListeners;
};

export function useContextMenu<Payload>(elements: ContextMenuElements) {
  const controller: ContextMenuController<Payload> = {
    elements,
    request: shallowRef<ContextMenuRequest<Payload> | null>(null),
    position: ref<ContextMenuPosition>({ x: 0, y: 0 }),
    generation: 0,
    listenersAttached: false,
    listeners: {
      pointerdown: () => {},
      keydown: () => {},
      scroll: () => {},
      resize: () => {},
    },
  };
  controller.listeners = createContextMenuListeners(controller);

  onScopeDispose(() => closeContextMenu(controller));
  return {
    request: computed(() => controller.request.value),
    position: readonly(controller.position),
    open: (request: ContextMenuRequest<Payload>) => openContextMenu(controller, request),
    close: (restoreFocus = false) => closeContextMenu(controller, restoreFocus),
  };
}

function createContextMenuListeners<Payload>(controller: ContextMenuController<Payload>) {
  return {
    pointerdown: (event: PointerEvent) => closeOnOutsidePointer(controller, event),
    keydown: (event: KeyboardEvent) => closeOnEscape(controller, event),
    scroll: (event: Event) => closeOnScroll(controller, event),
    resize: () => closeContextMenu(controller),
  };
}

function openContextMenu<Payload>(
  controller: ContextMenuController<Payload>,
  request: ContextMenuRequest<Payload>,
) {
  const generation = ++controller.generation;
  controller.request.value = request;
  controller.position.value = { x: request.x, y: request.y };
  attachListeners(controller);
  void positionAndFocus(controller, request, generation);
}

function closeContextMenu<Payload>(
  controller: ContextMenuController<Payload>,
  restoreFocus = false,
) {
  const request = controller.request.value;
  const generation = ++controller.generation;
  controller.request.value = null;
  detachListeners(controller);
  if (!restoreFocus || !request) return;

  void nextTick(() => restoreRequestFocus(controller, request, generation));
}

async function positionAndFocus<Payload>(
  controller: ContextMenuController<Payload>,
  request: ContextMenuRequest<Payload>,
  generation: number,
) {
  await nextTick();
  if (!isCurrentRequest(controller, request, generation)) return;

  const bounds = controller.elements.menuElement.value?.getBoundingClientRect();
  if (bounds) {
    controller.position.value = clampToViewport(request.x, request.y, bounds.width, bounds.height);
  }

  await nextTick();
  if (isCurrentRequest(controller, request, generation)) {
    controller.elements.firstMenuItemElement.value?.focus({ preventScroll: true });
  }
}

function restoreRequestFocus<Payload>(
  controller: ContextMenuController<Payload>,
  request: ContextMenuRequest<Payload>,
  generation: number,
) {
  if (controller.generation !== generation || controller.request.value !== null) return;

  const focusTarget = request.trigger.isConnected
    ? request.trigger
    : controller.elements.fallbackFocusElement.value;
  if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
}

function isCurrentRequest<Payload>(
  controller: ContextMenuController<Payload>,
  request: ContextMenuRequest<Payload>,
  generation: number,
) {
  return controller.generation === generation && controller.request.value === request;
}

function closeOnOutsidePointer<Payload>(
  controller: ContextMenuController<Payload>,
  event: PointerEvent,
) {
  if (isInsideMenu(controller, event.target)) return;
  closeContextMenu(controller);
}

function closeOnEscape<Payload>(controller: ContextMenuController<Payload>, event: KeyboardEvent) {
  if (event.key !== "Escape" || controller.request.value === null) return;
  event.preventDefault();
  closeContextMenu(controller, true);
}

function closeOnScroll<Payload>(controller: ContextMenuController<Payload>, event: Event) {
  if (isInsideMenu(controller, event.target)) return;
  closeContextMenu(controller);
}

function isInsideMenu<Payload>(
  controller: ContextMenuController<Payload>,
  target: EventTarget | null,
) {
  return (
    target instanceof globalThis.Node &&
    controller.elements.menuElement.value?.contains(target) === true
  );
}

function attachListeners<Payload>(controller: ContextMenuController<Payload>) {
  if (controller.listenersAttached) return;
  globalThis.document.addEventListener("pointerdown", controller.listeners.pointerdown);
  globalThis.document.addEventListener("keydown", controller.listeners.keydown);
  globalThis.document.addEventListener("scroll", controller.listeners.scroll, true);
  globalThis.window.addEventListener("scroll", controller.listeners.scroll, true);
  globalThis.window.addEventListener("resize", controller.listeners.resize);
  controller.listenersAttached = true;
}

function detachListeners<Payload>(controller: ContextMenuController<Payload>) {
  if (!controller.listenersAttached) return;
  globalThis.document.removeEventListener("pointerdown", controller.listeners.pointerdown);
  globalThis.document.removeEventListener("keydown", controller.listeners.keydown);
  globalThis.document.removeEventListener("scroll", controller.listeners.scroll, true);
  globalThis.window.removeEventListener("scroll", controller.listeners.scroll, true);
  globalThis.window.removeEventListener("resize", controller.listeners.resize);
  controller.listenersAttached = false;
}

function clampToViewport(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(0, Math.min(x, globalThis.innerWidth - width)),
    y: Math.max(0, Math.min(y, globalThis.innerHeight - height)),
  };
}
