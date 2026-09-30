import { movePlaylistItemsBefore } from "@/playlist/reorder";

export const PLAYLIST_DRAG_MOVE_THRESHOLD = 6;

const AUTO_SCROLL_EDGE_SIZE = 56;
const MAX_AUTO_SCROLL_PER_FRAME = 16;
const CLICK_SUPPRESSION_DURATION_MS = 500;
const CLICK_SUPPRESSION_RADIUS = 12;

type DragStartDetails = {
  playlistItemId: number;
  itemIds: readonly number[];
  movingItemIds: readonly number[];
  shouldSelectDraggedItem: boolean;
};

type DragPreview = {
  beforeItemId: number | null;
  movingItemIds: number[];
  clientX: number;
  clientY: number;
};

type DragReorderOptions = {
  canStart: () => boolean;
  getItemIds: () => readonly number[];
  getListElement: () => HTMLOListElement | null;
  getScrollContainer: () => HTMLElement | null;
  onDragStart: (details: DragStartDetails) => void;
  onPreview: (preview: DragPreview) => void;
  onDrop: (orderedPlaylistItemIds: number[]) => void;
  onCancel: () => void;
};

type PointerSession = {
  pointerId: number;
  handle: HTMLElement;
  document: Document;
  itemIds: number[];
  movingItemIds: number[];
  movingIds: Set<number>;
  playlistItemId: number;
  shouldSelectDraggedItem: boolean;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  isDragging: boolean;
  beforeItemId: number | null;
};

export function createPlaylistDragReorder(options: DragReorderOptions) {
  let session: PointerSession | null = null;
  let autoScrollFrame: number | null = null;
  let clearClickSuppression: (() => void) | null = null;

  function clearSuppressedClicks() {
    clearClickSuppression?.();
    clearClickSuppression = null;
  }

  function suppressRelatedClicks(current: PointerSession) {
    clearSuppressedClicks();

    const view = current.document.defaultView;
    const expiresAt = Date.now() + CLICK_SUPPRESSION_DURATION_MS;
    let timeoutId: number | null = null;
    let isCleared = false;

    const clear = () => {
      if (isCleared) return;
      isCleared = true;
      current.document.removeEventListener("click", suppressClick, true);
      current.document.removeEventListener("dblclick", suppressClick, true);
      if (timeoutId !== null) view?.clearTimeout(timeoutId);
      if (clearClickSuppression === clear) clearClickSuppression = null;
    };

    const suppressClick = (event: MouseEvent) => {
      if (Date.now() > expiresAt) {
        clear();
        return;
      }
      if (event.detail === 0) return;

      const pointerId = "pointerId" in event ? (event as PointerEvent).pointerId : -1;
      if (pointerId >= 0 && pointerId !== current.pointerId) {
        return;
      }
      if (
        Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >
        CLICK_SUPPRESSION_RADIUS
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    current.document.addEventListener("click", suppressClick, true);
    current.document.addEventListener("dblclick", suppressClick, true);
    timeoutId = view?.setTimeout(clear, CLICK_SUPPRESSION_DURATION_MS) ?? null;
    clearClickSuppression = clear;
  }

  function stopAutoScroll(current: PointerSession) {
    if (autoScrollFrame === null) return;
    current.document.defaultView?.cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
  }

  function cleanupSession(current: PointerSession, suppressClicks: boolean) {
    if (session !== current) return;
    session = null;
    stopAutoScroll(current);

    current.document.removeEventListener("pointermove", handlePointerMove, true);
    current.document.removeEventListener("pointerup", handlePointerUp, true);
    current.document.removeEventListener("pointercancel", handlePointerCancel, true);
    current.document.removeEventListener("keydown", handleKeydown, true);
    current.handle.removeEventListener("lostpointercapture", handleLostPointerCapture);

    try {
      if (current.handle.hasPointerCapture(current.pointerId)) {
        current.handle.releasePointerCapture(current.pointerId);
      }
    } catch {
      // The pointer may already have been released by the browser.
    }

    if (suppressClicks && current.isDragging) suppressRelatedClicks(current);
  }

  function findBeforeItemId(current: PointerSession): number | null {
    const list = options.getListElement();
    if (!list) return null;

    const currentIds = new Set(current.itemIds);
    const candidates = Array.from(
      list.querySelectorAll<HTMLElement>("[data-playlist-item-id]"),
    ).flatMap((element) => {
      const itemId = Number(element.dataset.playlistItemId);
      if (
        !Number.isSafeInteger(itemId) ||
        !currentIds.has(itemId) ||
        current.movingIds.has(itemId)
      ) {
        return [];
      }

      const bounds = element.getBoundingClientRect();
      return [{ itemId, midpoint: bounds.top + bounds.height / 2 }];
    });
    candidates.sort((left, right) => left.midpoint - right.midpoint);

    return candidates.find(({ midpoint }) => current.clientY < midpoint)?.itemId ?? null;
  }

  function updatePreview(current: PointerSession) {
    const beforeItemId = findBeforeItemId(current);
    current.beforeItemId = beforeItemId;
    options.onPreview({
      beforeItemId,
      movingItemIds: [...current.movingItemIds],
      clientX: current.clientX,
      clientY: current.clientY,
    });
  }

  function getAutoScrollDelta(current: PointerSession) {
    const container = options.getScrollContainer();
    if (!container || container.scrollHeight <= container.clientHeight) return 0;

    const bounds = container.getBoundingClientRect();
    if (current.clientY < bounds.top + AUTO_SCROLL_EDGE_SIZE) {
      const ratio = Math.min(
        1,
        (bounds.top + AUTO_SCROLL_EDGE_SIZE - current.clientY) / AUTO_SCROLL_EDGE_SIZE,
      );
      return -Math.max(1, Math.ceil(ratio * MAX_AUTO_SCROLL_PER_FRAME));
    }
    if (current.clientY > bounds.bottom - AUTO_SCROLL_EDGE_SIZE) {
      const ratio = Math.min(
        1,
        (current.clientY - bounds.bottom + AUTO_SCROLL_EDGE_SIZE) / AUTO_SCROLL_EDGE_SIZE,
      );
      return Math.max(1, Math.ceil(ratio * MAX_AUTO_SCROLL_PER_FRAME));
    }
    return 0;
  }

  function scheduleAutoScroll(current: PointerSession) {
    if (autoScrollFrame !== null || getAutoScrollDelta(current) === 0) return;
    const view = current.document.defaultView;
    if (!view) return;

    autoScrollFrame = view.requestAnimationFrame(() => {
      autoScrollFrame = null;
      if (session !== current || !current.isDragging) return;

      const container = options.getScrollContainer();
      const delta = getAutoScrollDelta(current);
      if (!container || delta === 0) return;

      const previousScrollTop = container.scrollTop;
      container.scrollTop += delta;
      if (container.scrollTop === previousScrollTop) return;

      updatePreview(current);
      scheduleAutoScroll(current);
    });
  }

  function handlePointerMove(event: PointerEvent) {
    const current = session;
    if (!current || event.pointerId !== current.pointerId) return;

    current.clientX = event.clientX;
    current.clientY = event.clientY;
    if (
      !current.isDragging &&
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <
        PLAYLIST_DRAG_MOVE_THRESHOLD
    ) {
      return;
    }

    if (!current.isDragging) {
      current.isDragging = true;
      options.onDragStart({
        playlistItemId: current.playlistItemId,
        itemIds: [...current.itemIds],
        movingItemIds: [...current.movingItemIds],
        shouldSelectDraggedItem: current.shouldSelectDraggedItem,
      });
      if (session !== current) return;
    }

    if (event.cancelable) event.preventDefault();
    updatePreview(current);
    scheduleAutoScroll(current);
  }

  function handlePointerUp(event: PointerEvent) {
    const current = session;
    if (!current || event.pointerId !== current.pointerId) return;

    current.clientX = event.clientX;
    current.clientY = event.clientY;
    if (!current.isDragging) {
      cleanupSession(current, false);
      return;
    }

    updatePreview(current);
    const orderedPlaylistItemIds = movePlaylistItemsBefore(
      current.itemIds,
      current.movingItemIds,
      current.beforeItemId,
    );
    const changed = orderedPlaylistItemIds.some(
      (itemId, index) => itemId !== current.itemIds[index],
    );
    cleanupSession(current, true);
    if (changed) options.onDrop(orderedPlaylistItemIds);
    else options.onCancel();
  }

  function handlePointerCancel(event: PointerEvent) {
    const current = session;
    if (!current || event.pointerId !== current.pointerId) return;

    current.clientX = event.clientX;
    current.clientY = event.clientY;
    cleanupSession(current, true);
    if (current.isDragging) options.onCancel();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !session) return;

    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  function handleLostPointerCapture(event: PointerEvent) {
    const current = session;
    if (!current || event.pointerId !== current.pointerId) return;

    current.clientX = event.clientX;
    current.clientY = event.clientY;
    cleanupSession(current, true);
    if (current.isDragging) options.onCancel();
  }

  function begin(
    event: PointerEvent,
    playlistItemId: number,
    movingItemIds: readonly number[],
    shouldSelectDraggedItem = false,
  ) {
    if (session || !options.canStart() || !event.isPrimary || event.button !== 0) return;

    const handle = event.currentTarget as HTMLElement | null;
    if (!handle?.setPointerCapture || !handle.releasePointerCapture) return;

    const itemIds = [...options.getItemIds()];
    if (!itemIds.includes(playlistItemId)) return;

    const movingIds = new Set(movingItemIds);
    movingIds.add(playlistItemId);
    const orderedMovingItemIds = itemIds.filter((itemId) => movingIds.has(itemId));
    if (orderedMovingItemIds.length === 0) return;

    const target = handle as HTMLElement;
    const ownerDocument = target.ownerDocument;
    const current: PointerSession = {
      pointerId: event.pointerId,
      handle: target,
      document: ownerDocument,
      itemIds,
      movingItemIds: orderedMovingItemIds,
      movingIds: new Set(orderedMovingItemIds),
      playlistItemId,
      shouldSelectDraggedItem,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      isDragging: false,
      beforeItemId: null,
    };
    session = current;

    ownerDocument.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: false,
    });
    ownerDocument.addEventListener("pointerup", handlePointerUp, true);
    ownerDocument.addEventListener("pointercancel", handlePointerCancel, true);
    ownerDocument.addEventListener("keydown", handleKeydown, true);
    target.addEventListener("lostpointercapture", handleLostPointerCapture);

    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      cleanupSession(current, false);
    }
  }

  function cancel() {
    const current = session;
    if (!current) return;

    cleanupSession(current, true);
    if (current.isDragging) options.onCancel();
  }

  function dispose() {
    cancel();
  }

  return { begin, cancel, dispose };
}
