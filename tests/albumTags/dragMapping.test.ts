import { describe, expect, it } from "bun:test";
import { createMappingDrag } from "@/albumTags/dragMapping";
import type { MappingDragPreview } from "@/albumTags/dragMapping";

function fixture() {
  let slot: string | undefined = "1";
  let allowed = true;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const scroll = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, right: 500, top: 0, bottom: 400 }),
  };
  const document = Object.assign(new EventTarget(), {
    elementFromPoint: () =>
      slot === undefined ? null : { closest: () => ({ dataset: { albumTagSlot: slot } }) },
    defaultView: {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      },
      cancelAnimationFrame: (id: number) => {
        frames.delete(id);
      },
    },
  });
  let captured = false;
  const handle = Object.assign(new EventTarget(), {
    ownerDocument: document,
    closest: () => scroll,
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
  });
  const previews: Array<MappingDragPreview | null> = [];
  const drops: Array<{ id: number; target: number | null }> = [];
  const drag = createMappingDrag({
    canStart: () => allowed,
    preview: (preview) => previews.push(preview),
    drop: (id, target) => drops.push({ id, target }),
  });
  const pointer = { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100 };
  function start() {
    drag.start(7, { ...pointer, currentTarget: handle } as unknown as PointerEvent);
  }
  function dispatch(type: string, fields: object = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), { ...pointer, ...fields });
    document.dispatchEvent(event);
    return event;
  }
  function frame() {
    const entry = frames.entries().next().value;
    if (!entry) throw new Error("Missing scroll frame");
    frames.delete(entry[0]);
    entry[1](0);
  }
  return {
    drag,
    start,
    dispatch,
    frame,
    previews,
    drops,
    frames,
    scroll,
    slot: (value: string | undefined) => {
      slot = value;
    },
    allow: (value: boolean) => {
      allowed = value;
    },
    captured: () => captured,
  };
}
describe("pointer track mapping drag", () => {
  it("starts only after movement threshold and drops on the pointed source slot", () => {
    const context = fixture();
    context.start();
    context.dispatch("pointermove", { clientX: 102 });
    expect(context.previews).toEqual([]);
    context.dispatch("pointermove", { clientX: 120 });
    expect(context.previews[context.previews.length - 1]?.target).toBe(1);
    context.slot("3");
    context.dispatch("pointerup", { clientX: 120 });
    expect(context.drops).toEqual([{ id: 7, target: 3 }]);
    expect(context.captured()).toBe(false);
    expect(context.previews[context.previews.length - 1]).toBeNull();
    expect(context.frames.size).toBe(0);
  });
  it("supports unmatched placement and cancels outside valid slots", () => {
    const context = fixture();
    context.start();
    context.slot("unmatched");
    context.dispatch("pointermove", { clientX: 120 });
    context.dispatch("pointerup", { clientX: 120 });
    expect(context.drops).toEqual([{ id: 7, target: null }]);
    context.start();
    context.slot(undefined);
    context.dispatch("pointermove", { clientX: 120 });
    context.dispatch("pointerup", { clientX: 120 });
    expect(context.drops.length).toBe(1);
  });
  it("cancels on Escape, pointer cancellation or disposal and releases listeners", () => {
    const context = fixture();
    context.start();
    context.dispatch("pointermove", { clientX: 120 });
    expect(context.dispatch("keydown", { key: "Escape" }).defaultPrevented).toBe(true);
    context.dispatch("pointerup");
    expect(context.drops).toEqual([]);
    context.start();
    context.dispatch("pointercancel");
    expect(context.captured()).toBe(false);
    context.start();
    context.drag.cancel();
    context.dispatch("pointermove", { clientX: 120 });
    expect(context.previews[context.previews.length - 1]).toBeNull();
    expect(context.frames.size).toBe(0);
  });
  it("ignores other pointers, disabled starts and disabling during a drag", () => {
    const context = fixture();
    context.allow(false);
    context.start();
    expect(context.captured()).toBe(false);
    context.allow(true);
    context.start();
    context.dispatch("pointermove", { clientX: 120, pointerId: 2 });
    expect(context.previews).toEqual([]);
    context.dispatch("pointermove", { clientX: 120 });
    context.allow(false);
    context.dispatch("pointerup");
    expect(context.drops).toEqual([]);
  });
  it("auto-scrolls the modal near its edge and stops scrolling on cancel", () => {
    const context = fixture();
    context.start();
    context.dispatch("pointermove", { clientY: 390 });
    context.frame();
    expect(context.scroll.scrollTop).toBe(12);
    context.drag.cancel();
    expect(context.frames.size).toBe(0);
  });
});
