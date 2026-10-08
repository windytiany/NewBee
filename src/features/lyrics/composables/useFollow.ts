import { isReducedMotionEnabled, onReducedMotionChange } from "@/features/settings/motion";
import { onMounted, onScopeDispose, readonly, ref, watch } from "vue";
import type { Ref } from "vue";

const LYRICS_RESUME_IDLE_MS = 1200;

export type LyricsFollowState = "following" | "browsing";
export type LyricsScrollBehavior = "instant" | "smooth";

export type LyricsFollowInputs = {
  trackId: number | null;
  visible: boolean;
  compact: boolean;
  isSeeking: boolean;
  activeGroupStartIndex: number;
  activeIndex: number;
  lineCount: number;
};

export type LyricsFollowContainer = {
  readonly top: number;
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  scrollTo(top: number, behavior: LyricsScrollBehavior): void;
};

export type LyricsFollowLine = {
  readonly top: number;
  readonly height: number;
};

export type LyricsFollowAdapter = {
  schedule(callback: () => void): number;
  cancelScheduled(handle: number): void;
  scheduleIdle(callback: () => void): number;
  cancelIdle(handle: number): void;
  getContainer(): LyricsFollowContainer | null;
  getLine(index: number): LyricsFollowLine | null;
  getLineCount(): number;
  setEdgePadding(top: number, bottom: number): void;
  cancelScroll(): void;
  observeResize(callback: () => void): () => void;
  isReducedMotionEnabled(): boolean;
  onReducedMotionChange(callback: () => void): () => void;
};

export type LyricsFollowCoordinator = {
  readonly state: Readonly<Ref<LyricsFollowState>>;
  update(inputs: LyricsFollowInputs): void;
  startBrowsing(): void;
  handleScroll(): void;
  beginInteraction(): void;
  endInteraction(): void;
  returnToCurrentLyric(): void;
  handleResize(): void;
  dispose(): void;
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
  container: Pick<LyricsFollowContainer, "top" | "scrollTop" | "clientHeight" | "scrollHeight">,
  line: LyricsFollowLine,
) {
  const lineCenter = line.top - container.top + container.scrollTop + line.height / 2;
  const requestedTop = lineCenter - container.clientHeight / 2;
  return Math.min(
    Math.max(0, requestedTop),
    Math.max(0, container.scrollHeight - container.clientHeight),
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

export function createLyricsFollowCoordinator(
  adapter: LyricsFollowAdapter,
): LyricsFollowCoordinator {
  const followState = ref<LyricsFollowState>("following");
  let inputs: LyricsFollowInputs | null = null;
  let scheduledHandle: number | null = null;
  let taskVersion = 0;
  let motionInProgress = false;
  let stopObservingResize: (() => void) | null = null;
  let disposed = false;
  let idleHandle: number | null = null;
  let idleVersion = 0;
  let interacting = false;

  function cancelIdle() {
    idleVersion += 1;
    if (idleHandle !== null) adapter.cancelIdle(idleHandle);
    idleHandle = null;
  }

  function scheduleResume() {
    cancelIdle();
    if (
      disposed ||
      !inputs?.visible ||
      inputs.isSeeking ||
      interacting ||
      followState.value !== "browsing"
    )
      return;
    const version = idleVersion;
    idleHandle = adapter.scheduleIdle(() => {
      if (version !== idleVersion || disposed) return;
      idleHandle = null;
      const container = adapter.getContainer();
      if (container === null || inputs === null || container.clientHeight <= 0) return;
      for (
        let index = Math.max(0, inputs.activeGroupStartIndex);
        index <= inputs.activeIndex;
        index += 1
      ) {
        const line = adapter.getLine(index);
        if (
          line !== null &&
          line.top < container.top + container.clientHeight &&
          line.top + line.height > container.top
        ) {
          returnToCurrentLyric();
          return;
        }
      }
    });
  }

  const stopReducedMotionListener = adapter.onReducedMotionChange(() => {
    if (!adapter.isReducedMotionEnabled() || !motionInProgress) return;
    cancelWork(true);
    if (canLocate()) schedulePosition("instant");
  });

  function canLocate() {
    return (
      !disposed &&
      inputs !== null &&
      inputs.visible &&
      !inputs.isSeeking &&
      followState.value === "following"
    );
  }

  function cancelWork(stopMotion: boolean) {
    taskVersion += 1;
    if (scheduledHandle !== null) {
      adapter.cancelScheduled(scheduledHandle);
      scheduledHandle = null;
    }
    if (stopMotion && motionInProgress) adapter.cancelScroll();
    if (stopMotion) motionInProgress = false;
  }

  function stopResizeObservation() {
    stopObservingResize?.();
    stopObservingResize = null;
  }

  function syncResizeObservation() {
    if (inputs?.visible && stopObservingResize === null) {
      stopObservingResize = adapter.observeResize(() => handleResize());
    } else if (!inputs?.visible) {
      stopResizeObservation();
    }
  }

  function schedulePosition(requestedBehavior: LyricsScrollBehavior) {
    if (!canLocate()) return;

    cancelWork(true);
    const version = taskVersion;
    scheduledHandle = adapter.schedule(() => {
      if (version !== taskVersion || !canLocate()) return;
      scheduledHandle = null;

      const container = adapter.getContainer();
      if (container === null) return;

      const lineCount = adapter.getLineCount();
      if (lineCount > 0) {
        const firstLine = adapter.getLine(0);
        const lastLine = adapter.getLine(lineCount - 1);
        if (firstLine !== null && lastLine !== null) {
          const padding = calculateLyricsEdgePadding(
            container.clientHeight,
            firstLine.height,
            lastLine.height,
          );
          adapter.setEdgePadding(padding.top, padding.bottom);
        }
      }

      const activeGroupStartIndex = inputs?.activeGroupStartIndex ?? -1;
      let targetTop = 0;
      if (activeGroupStartIndex >= 0) {
        const line = adapter.getLine(activeGroupStartIndex);
        if (line === null) return;
        targetTop = calculateLyricsScrollTop(container, line);
      }

      const behavior: LyricsScrollBehavior =
        requestedBehavior === "smooth" && !adapter.isReducedMotionEnabled() ? "smooth" : "instant";
      container.scrollTo(targetTop, behavior);
      motionInProgress = behavior === "smooth";
    });
  }

  function update(next: LyricsFollowInputs) {
    if (disposed) return;
    const previous = inputs;
    const trackChanged = previous !== null && previous.trackId !== next.trackId;
    inputs = next;

    if (trackChanged) {
      cancelIdle();
      interacting = false;
      cancelWork(previous.visible);
      followState.value = "following";
      syncResizeObservation();
      if (canLocate()) schedulePosition("instant");
      return;
    }

    if (!next.visible) {
      cancelIdle();
      interacting = false;
      if (previous?.visible) cancelWork(true);
      syncResizeObservation();
      return;
    }

    syncResizeObservation();
    if (previous === null || !previous.visible) {
      if (canLocate()) schedulePosition("instant");
      else scheduleResume();
      return;
    }

    if (previous.isSeeking !== next.isSeeking) {
      if (next.isSeeking) {
        cancelIdle();
        cancelWork(true);
        return;
      }
      if (followState.value === "following") {
        schedulePosition("instant");
        return;
      }
    }

    if (next.isSeeking) return;
    if (followState.value === "browsing") {
      if (idleHandle === null) scheduleResume();
      return;
    }
    if (previous.lineCount !== next.lineCount) {
      schedulePosition("instant");
      return;
    }
    if (previous.compact !== next.compact) {
      schedulePosition("instant");
      return;
    }
    if (previous.activeGroupStartIndex === next.activeGroupStartIndex) return;

    const previousIndex = previous.activeGroupStartIndex;
    const nextIndex = next.activeGroupStartIndex;
    const skippedForward = nextIndex > previousIndex + 1;
    const behavior =
      nextIndex < 0 || nextIndex < previousIndex || skippedForward ? "instant" : "smooth";
    schedulePosition(behavior);
  }

  function startBrowsing() {
    if (disposed) return;
    if (followState.value !== "browsing") {
      followState.value = "browsing";
      cancelWork(true);
    }
    scheduleResume();
  }

  function handleScroll() {
    if (followState.value === "browsing") scheduleResume();
  }

  function beginInteraction() {
    if (disposed) return;
    interacting = true;
    cancelIdle();
  }

  function endInteraction() {
    interacting = false;
    scheduleResume();
  }

  function returnToCurrentLyric() {
    if (disposed) return;
    cancelIdle();
    followState.value = "following";
    if (canLocate()) schedulePosition("smooth");
  }

  function handleResize() {
    if (canLocate()) schedulePosition("instant");
    else scheduleResume();
  }

  function dispose() {
    if (disposed) return;
    cancelIdle();
    cancelWork(true);
    disposed = true;
    stopResizeObservation();
    stopReducedMotionListener();
  }

  return {
    state: readonly(followState),
    update,
    startBrowsing,
    handleScroll,
    beginInteraction,
    endInteraction,
    returnToCurrentLyric,
    handleResize,
    dispose,
  };
}

type LyricsFollowSources = {
  trackId: () => number | null;
  visible: () => boolean;
  compact: () => boolean;
  isSeeking: () => boolean;
  activeGroupStartIndex: () => number;
  activeIndex: () => number;
  lineCount: () => number;
  container: () => HTMLElement | null;
  content: () => HTMLElement | null;
  line: (index: number) => HTMLElement | null;
  setEdgePadding: (top: number, bottom: number) => void;
};

function createDomAdapter(sources: LyricsFollowSources): LyricsFollowAdapter {
  return {
    schedule: (callback) => globalThis.requestAnimationFrame(callback),
    cancelScheduled: (handle) => globalThis.cancelAnimationFrame(handle),
    scheduleIdle: (callback) => globalThis.window.setTimeout(callback, LYRICS_RESUME_IDLE_MS),
    cancelIdle: (handle) => globalThis.window.clearTimeout(handle),
    getContainer: () => {
      if (!sources.visible()) return null;
      const element = sources.container();
      if (element === null) return null;
      return {
        get top() {
          return element.getBoundingClientRect().top;
        },
        get scrollTop() {
          return element.scrollTop;
        },
        get clientHeight() {
          return element.clientHeight;
        },
        get scrollHeight() {
          return element.scrollHeight;
        },
        scrollTo: (top, behavior) => {
          if (behavior === "smooth") element.scrollTo({ top, behavior });
          else element.scrollTop = top;
        },
      };
    },
    getLine: (index) => {
      if (!sources.visible()) return null;
      const element = sources.line(index);
      if (element === null) return null;
      return {
        get top() {
          return element.getBoundingClientRect().top;
        },
        get height() {
          return element.getBoundingClientRect().height;
        },
      };
    },
    getLineCount: () => (sources.visible() ? sources.lineCount() : 0),
    setEdgePadding: sources.setEdgePadding,
    cancelScroll: () => {
      const element = sources.container();
      if (element !== null) {
        const currentTop = element.scrollTop;
        element.scrollTop = currentTop;
      }
    },
    observeResize: (callback) => {
      const container = sources.container();
      const content = sources.content();
      if (globalThis.ResizeObserver === undefined || container === null) return () => {};
      const observer = new globalThis.ResizeObserver(callback);
      observer.observe(container);
      if (content !== null) observer.observe(content);
      return () => observer.disconnect();
    },
    isReducedMotionEnabled,
    onReducedMotionChange,
  };
}

export type UseLyricsFollowOptions = Omit<
  LyricsFollowSources,
  "trackId" | "visible" | "compact" | "isSeeking" | "activeGroupStartIndex"
> & {
  trackId: () => number | null;
  visible: () => boolean;
  compact: () => boolean;
  isSeeking: () => boolean;
  activeGroupStartIndex: () => number;
};

export function useLyricsFollow(options: UseLyricsFollowOptions) {
  const coordinator = createLyricsFollowCoordinator(createDomAdapter(options));
  const readInputs = (): LyricsFollowInputs => ({
    trackId: options.trackId(),
    visible: options.visible(),
    compact: options.compact(),
    isSeeking: options.isSeeking(),
    activeGroupStartIndex: options.activeGroupStartIndex(),
    activeIndex: options.activeIndex(),
    lineCount: options.lineCount(),
  });

  const stopWatching = watch(
    [
      options.trackId,
      options.visible,
      options.compact,
      options.isSeeking,
      options.activeGroupStartIndex,
      options.activeIndex,
      options.lineCount,
    ],
    () => coordinator.update(readInputs()),
    { flush: "sync" },
  );

  onMounted(() => coordinator.update(readInputs()));
  onScopeDispose(() => {
    stopWatching();
    coordinator.dispose();
  });

  return {
    state: coordinator.state,
    startBrowsing: coordinator.startBrowsing,
    handleScroll: coordinator.handleScroll,
    beginInteraction: coordinator.beginInteraction,
    endInteraction: coordinator.endInteraction,
    returnToCurrentLyric: coordinator.returnToCurrentLyric,
  };
}
