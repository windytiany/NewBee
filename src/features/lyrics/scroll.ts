export type LyricsScrollViewport = {
  readonly top: number;
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
};

export type LyricsLineGeometry = {
  readonly top: number;
  readonly height: number;
};

export function calculateLyricsEdgePadding(
  viewportHeight: number,
  firstLineHeight: number,
  lastLineHeight: number,
) {
  return {
    top: Math.max(0, (viewportHeight - firstLineHeight) / 2),
    bottom: Math.max(0, (viewportHeight - lastLineHeight) / 2),
  };
}

export function calculateLyricsScrollTop(
  container: LyricsScrollViewport,
  line: LyricsLineGeometry,
) {
  const lineCenter = line.top - container.top + container.scrollTop + line.height / 2;
  const requestedTop = lineCenter - container.clientHeight / 2;
  return Math.min(
    Math.max(0, requestedTop),
    Math.max(0, container.scrollHeight - container.clientHeight),
  );
}

export function isLyricsLineVisible(
  container: Pick<LyricsScrollViewport, "top" | "clientHeight">,
  line: LyricsLineGeometry,
) {
  return (
    line.top < container.top + container.clientHeight && line.top + line.height > container.top
  );
}

export function isLyricsScrollKey(key: string, code: string, isInteractiveTarget: boolean) {
  if (isInteractiveTarget) return false;
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End" ||
    key === " " ||
    key === "Spacebar" ||
    code === "Space"
  );
}
