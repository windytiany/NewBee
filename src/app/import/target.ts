export type DropTarget =
  | { kind: "Library" }
  | { kind: "Inbox" }
  | { kind: "queue" }
  | { kind: "playlists" }
  | { kind: "playlist"; playlistId: number };

export type DropBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;
export type DropRegion = { target: DropTarget; bounds: DropBounds };

type HitElement = {
  closest: (selector: string) => {
    getAttribute: (name: string) => string | null;
    getBoundingClientRect: () => DropBounds;
  } | null;
};

export function resolveDropRegion(
  position: { x: number; y: number },
  scaleFactor: number,
  elementsAt: (x: number, y: number) => readonly HitElement[],
): DropRegion | null {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return null;
  const x = position.x / scaleFactor;
  const y = position.y / scaleFactor;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const regions = elementsAt(x, y).map((element): DropRegion | null => {
    const region = element.closest("[data-local-drop]");
    if (!region) return null;
    const kind = region.getAttribute("data-local-drop");
    let target: DropTarget;
    if (kind === "queue" || kind === "Library" || kind === "Inbox" || kind === "playlists") {
      target = { kind };
    } else if (kind === "playlist") {
      const playlistId = Number(region.getAttribute("data-playlist-id"));
      if (!Number.isSafeInteger(playlistId) || playlistId <= 0) return null;
      target = { kind, playlistId };
    } else {
      return null;
    }
    const { left, top, width, height } = region.getBoundingClientRect();
    if (
      ![left, top, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0 ||
      x < left ||
      x >= left + width ||
      y < top ||
      y >= top + height
    ) {
      return null;
    }
    return { target, bounds: { left, top, width, height } };
  });
  const foreground = regions[0];
  if (!foreground) return null;
  return regions.find((region) => region?.target.kind === "queue") ?? foreground;
}
