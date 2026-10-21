import { expect, it } from "bun:test";
import { resolveDropRegion, type DropBounds } from "@/app/import/target";

const bounds: DropBounds = { left: 0, top: 0, width: 300, height: 500 };
function region(kind: string, id?: string, rectangle = bounds) {
  const element = {
    getAttribute: (key: string) => (key === "data-local-drop" ? kind : (id ?? null)),
    getBoundingClientRect: () => rectangle,
  };
  return { closest: () => element };
}
it("queue wins when multiple business regions are hit and supplies its exact viewport bounds", () => {
  const queueBounds = { left: 40, top: 24, width: 230, height: 340 };
  const elements = [
    region("playlist", "4"),
    region("queue", undefined, queueBounds),
    region("Library"),
  ];
  expect(
    resolveDropRegion({ x: 90, y: 60 }, 1.5, (x, y) => {
      expect([x, y]).toEqual([60, 40]);
      return elements;
    }),
  ).toEqual({ target: { kind: "queue" }, bounds: queueBounds });
});
it("requires an explicit region and a valid selected playlist ID", () => {
  for (const elements of [
    [],
    [region("playlist")],
    [region("playlist", "0")],
    [region("playlist", "NaN")],
    [region("unknown")],
  ]) {
    expect(resolveDropRegion({ x: 0, y: 0 }, 1, () => elements)).toBeNull();
  }
  expect(resolveDropRegion({ x: 0, y: 0 }, 1, () => [region("playlist", "9")])).toEqual({
    target: { kind: "playlist", playlistId: 9 },
    bounds,
  });
  for (const kind of ["Library", "Inbox", "queue", "playlists"] as const) {
    expect(resolveDropRegion({ x: 0, y: 0 }, 1, () => [region(kind)])).toEqual({
      target: { kind },
      bounds,
    });
  }
});
it("does not target a browser underneath an unrelated foreground pane", () => {
  expect(
    resolveDropRegion({ x: 50, y: 30 }, 1, () => [{ closest: () => null }, region("Library")]),
  ).toBeNull();
});
it("rejects descendants outside the browser rectangle and empty or invalid rectangles", () => {
  for (const rectangle of [
    { ...bounds, left: 100 },
    { ...bounds, top: 100 },
    { ...bounds, width: 50 },
    { ...bounds, height: 30 },
    { ...bounds, width: 0 },
    { ...bounds, height: -1 },
    { ...bounds, left: NaN },
  ]) {
    expect(
      resolveDropRegion({ x: 50, y: 30 }, 1, () => [region("Library", undefined, rectangle)]),
    ).toBeNull();
  }
});
it("rejects invalid scale or coordinates before hit testing", () => {
  const mustNotHit = () => {
    throw new Error("must not hit test");
  };
  for (const scale of [0, -1, NaN, Infinity]) {
    expect(resolveDropRegion({ x: 0, y: 0 }, scale, mustNotHit)).toBeNull();
  }
  expect(resolveDropRegion({ x: Infinity, y: 0 }, 1, mustNotHit)).toBeNull();
  expect(resolveDropRegion({ x: 0, y: NaN }, 1, mustNotHit)).toBeNull();
});
