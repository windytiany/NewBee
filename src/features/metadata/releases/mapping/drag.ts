export type MappingDragPreview = {
  trackId: number;
  x: number;
  y: number;
  target: number | null | undefined;
};
export type MappingDragOptions = {
  canStart: () => boolean;
  preview: (value: MappingDragPreview | null) => void;
  drop: (trackId: number, target: number | null) => void;
};
const MOVE_THRESHOLD = 6;
const SCROLL_EDGE = 48;
const SCROLL_SPEED = 12;

function targetAt(document: Document, x: number, y: number) {
  const value = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-album-tag-slot]")
    ?.dataset.albumTagSlot;
  if (value === "unmatched") return null;
  if (value !== undefined && /^\d+$/.test(value)) return Number(value);
  return undefined;
}
function scrollDistance(bounds: DOMRect, x: number, y: number) {
  if (x < bounds.left || x > bounds.right) return 0;
  if (y < bounds.top + SCROLL_EDGE) return -SCROLL_SPEED;
  if (y > bounds.bottom - SCROLL_EDGE) return SCROLL_SPEED;
  return 0;
}

/** Pointer-based drag leaves Tauri's native file-drop handler enabled on Windows. */
export function createMappingDrag(options: MappingDragOptions) {
  let cleanup: (() => void) | null = null;
  let clickSuppressed = false;
  let clickTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  function clearClickSuppression() {
    if (clickTimer !== null) globalThis.clearTimeout(clickTimer);
    clickTimer = null;
    clickSuppressed = false;
  }
  function suppressClick(event: Event) {
    if (!clickSuppressed) return;
    event.preventDefault();
    event.stopPropagation();
    clearClickSuppression();
  }
  function cancel() {
    cleanup?.();
    clearClickSuppression();
  }
  function start(trackId: number, event: PointerEvent) {
    if (!options.canStart() || event.button !== 0 || !event.isPrimary) return;
    cancel();
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const document = handle.ownerDocument;
    const view = document.defaultView;
    const scroll = handle.closest<HTMLElement>("[data-album-tag-scroll]");
    const pointerId = event.pointerId;
    const listeners = new AbortController();
    const startX = event.clientX;
    const startY = event.clientY;
    let x = startX;
    let y = startY;
    let dragging = false;
    let frame: number | null = null;
    let target: number | null | undefined;
    let finished = false;
    function update() {
      target = targetAt(document, x, y);
      options.preview({ trackId, x, y, target });
    }
    function autoScroll() {
      frame = null;
      if (!dragging || finished) return;
      if (scroll) {
        const distance = scrollDistance(scroll.getBoundingClientRect(), x, y);
        if (distance) {
          scroll.scrollTop += distance;
          update();
        }
      }
      frame = view?.requestAnimationFrame(autoScroll) ?? null;
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      x = event.clientX;
      y = event.clientY;
      if (!dragging && Math.hypot(x - startX, y - startY) < MOVE_THRESHOLD) return;
      event.preventDefault();
      if (!dragging) {
        dragging = true;
        frame = view?.requestAnimationFrame(autoScroll) ?? null;
      }
      update();
    }
    function stop() {
      if (finished) return;
      finished = true;
      listeners.abort();
      if (frame !== null) view?.cancelAnimationFrame(frame);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      options.preview(null);
      cleanup = null;
    }
    function end(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      if (dragging) {
        x = event.clientX;
        y = event.clientY;
        update();
        if (options.canStart() && target !== undefined) options.drop(trackId, target);
      }
      stop();
      if (dragging) {
        clickSuppressed = true;
        clickTimer = globalThis.setTimeout(clearClickSuppression, 0);
      }
    }
    function pointerCancel(event: PointerEvent) {
      if (event.pointerId === pointerId) stop();
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stop();
      }
    }
    const listenerOptions = { capture: true, signal: listeners.signal };
    document.addEventListener("pointermove", move, listenerOptions);
    document.addEventListener("pointerup", end, listenerOptions);
    document.addEventListener("pointercancel", pointerCancel, listenerOptions);
    document.addEventListener("keydown", keydown, listenerOptions);
    handle.addEventListener("lostpointercapture", stop, listenerOptions);
    cleanup = stop;
    handle.setPointerCapture(pointerId);
  }
  return { start, cancel, suppressClick };
}
