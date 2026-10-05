import { describe, expect, it } from "bun:test";
import {
  calculateLyricsEdgePadding,
  calculateLyricsScrollTop,
  createLyricsFollowCoordinator,
  isLyricsScrollKey,
} from "@/features/lyrics/composables/useFollow";
import type {
  LyricsFollowAdapter,
  LyricsFollowInputs,
  LyricsFollowLine,
  LyricsScrollBehavior,
} from "@/features/lyrics/composables/useFollow";

type ScrollCall = { top: number; behavior: LyricsScrollBehavior };

function createTestAdapter() {
  let nextHandle = 0;
  const scheduled = new Map<number, () => void>();
  const cancelled = new Map<number, () => void>();
  const idleCallbacks = new Map<number, () => void>();
  const scrollCalls: ScrollCall[] = [];
  const lookedUpLines: number[] = [];
  const lines = new Map<number, LyricsFollowLine>();
  let resizeCallback: (() => void) | null = null;
  let reducedMotion = false;
  let reducedMotionCallback: (() => void) | null = null;
  let containerReads = 0;
  let observingResize = 0;
  let stoppedScrolls = 0;
  let edgePadding = { top: 0, bottom: 0 };

  const container = {
    top: 100,
    scrollTop: 0,
    clientHeight: 200,
    scrollHeight: 800,
    scrollTo(top: number, behavior: LyricsScrollBehavior) {
      scrollCalls.push({ top, behavior });
      container.scrollTop = top;
    },
  };

  const adapter: LyricsFollowAdapter = {
    schedule(callback) {
      const handle = ++nextHandle;
      scheduled.set(handle, callback);
      return handle;
    },
    cancelScheduled(handle) {
      const callback = scheduled.get(handle);
      if (callback !== undefined) cancelled.set(handle, callback);
      scheduled.delete(handle);
    },
    scheduleIdle(callback) {
      const handle = ++nextHandle;
      idleCallbacks.set(handle, callback);
      return handle;
    },
    cancelIdle(handle) {
      idleCallbacks.delete(handle);
    },
    getContainer() {
      containerReads += 1;
      return container;
    },
    getLine(index) {
      lookedUpLines.push(index);
      return lines.get(index) ?? null;
    },
    getLineCount() {
      return lines.size;
    },
    setEdgePadding(top, bottom) {
      edgePadding = { top, bottom };
    },
    cancelScroll() {
      stoppedScrolls += 1;
    },
    observeResize(callback) {
      observingResize += 1;
      resizeCallback = callback;
      return () => {
        observingResize -= 1;
        resizeCallback = null;
      };
    },
    prefersReducedMotion() {
      return reducedMotion;
    },
    onReducedMotionChange(callback) {
      reducedMotionCallback = callback;
      return () => {
        reducedMotionCallback = null;
      };
    },
  };

  return {
    adapter,
    container,
    scrollCalls,
    lookedUpLines,
    get containerReads() {
      return containerReads;
    },
    get observingResize() {
      return observingResize;
    },
    get stoppedScrolls() {
      return stoppedScrolls;
    },
    get edgePadding() {
      return edgePadding;
    },
    addLine(index: number, line: LyricsFollowLine) {
      lines.set(index, line);
    },
    flushScheduled() {
      const callbacks = [...scheduled.values()];
      scheduled.clear();
      for (const callback of callbacks) callback();
    },
    flushIdle() {
      const callbacks = [...idleCallbacks.values()];
      idleCallbacks.clear();
      for (const callback of callbacks) callback();
    },
    get pendingIdleCount() {
      return idleCallbacks.size;
    },
    runCancelledCallbacks() {
      const callbacks = [...cancelled.values()];
      cancelled.clear();
      for (const callback of callbacks) callback();
    },
    resize() {
      resizeCallback?.();
    },
    setReducedMotion(value: boolean) {
      reducedMotion = value;
      reducedMotionCallback?.();
    },
    get pendingCount() {
      return scheduled.size;
    },
  };
}

function inputs(overrides: Partial<LyricsFollowInputs> = {}): LyricsFollowInputs {
  return {
    trackId: 1,
    visible: true,
    compact: false,
    isSeeking: false,
    activeGroupStartIndex: 0,
    activeIndex: overrides.activeGroupStartIndex ?? 0,
    lineCount: 0,
    ...overrides,
  };
}

describe("歌词跟随定位", () => {
  it("初始跟随；手动浏览后播放高亮更新但不滚动，按钮恢复跟随并平滑定位", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 170, height: 40 });
    testAdapter.addLine(1, { top: 230, height: 40 });
    testAdapter.addLine(2, { top: 290, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);

    expect(follow.state.value).toBe("following");
    follow.update(inputs());
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls).toHaveLength(1);
    expect(testAdapter.scrollCalls[0]?.behavior).toBe("instant");

    follow.update(inputs({ activeGroupStartIndex: 1 }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("smooth");

    follow.startBrowsing();
    expect(follow.state.value).toBe("browsing");
    expect(testAdapter.stoppedScrolls).toBe(1);
    follow.update(inputs({ activeGroupStartIndex: 2 }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls).toHaveLength(2);

    follow.returnToCurrentLyric();
    expect(follow.state.value).toBe("following");
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("smooth");
    follow.dispose();
  });

  it("停止操作后，高亮行在视野内自动恢复跟随", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.startBrowsing();
    expect(follow.state.value).toBe("browsing");
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("following");
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("smooth");
    expect(testAdapter.pendingIdleCount).toBe(0);
    follow.dispose();
  });

  it("高亮行不在视野内保持浏览，滚回可视区域后恢复", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 350, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.startBrowsing();
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("browsing");
    testAdapter.addLine(0, { top: 180, height: 40 });
    follow.handleScroll();
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("following");
    follow.dispose();
  });

  it("同组任意高亮行进入视野即可恢复，播放推进也会重新检查", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 40, height: 40 });
    testAdapter.addLine(1, { top: 150, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.startBrowsing();
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("browsing");
    follow.update(inputs({ activeIndex: 1 }));
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("following");
    follow.dispose();
  });

  it("重复操作重置等待，手指或按键未释放时不自动恢复", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.startBrowsing();
    follow.startBrowsing();
    follow.handleScroll();
    expect(testAdapter.pendingIdleCount).toBe(1);
    follow.beginInteraction();
    follow.startBrowsing();
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("browsing");
    follow.endInteraction();
    expect(testAdapter.pendingIdleCount).toBe(1);
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("following");
    follow.dispose();
  });

  it("隐藏、seek 和卸载时取消自动恢复检查", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.startBrowsing();
    follow.update(inputs({ visible: false }));
    expect(testAdapter.pendingIdleCount).toBe(0);
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("browsing");
    follow.update(inputs());
    expect(testAdapter.pendingIdleCount).toBe(1);
    follow.update(inputs({ isSeeking: true }));
    expect(testAdapter.pendingIdleCount).toBe(0);
    follow.update(inputs());
    expect(testAdapter.pendingIdleCount).toBe(1);
    follow.dispose();
    expect(testAdapter.pendingIdleCount).toBe(0);
    testAdapter.flushIdle();
    expect(follow.state.value).toBe("browsing");
  });

  it("切歌从 browsing 重置为 following，并直接定位新曲目", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.startBrowsing();

    follow.update(inputs({ trackId: 2, activeGroupStartIndex: 0 }));
    expect(follow.state.value).toBe("following");
    testAdapter.flushScheduled();

    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("instant");
    expect(testAdapter.observingResize).toBe(1);
    follow.dispose();
    expect(testAdapter.observingResize).toBe(0);
  });

  it("切歌、隐藏或手动浏览后，已取消的旧滚动任务不会执行", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    testAdapter.addLine(1, { top: 240, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);

    follow.update(inputs());
    follow.update(inputs({ trackId: 2 }));
    testAdapter.runCancelledCallbacks();
    expect(testAdapter.containerReads).toBe(0);
    expect(testAdapter.pendingCount).toBe(1);
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls).toHaveLength(1);

    follow.update(inputs({ trackId: 2, activeGroupStartIndex: 1 }));
    follow.update(inputs({ trackId: 2, visible: false, activeGroupStartIndex: 1 }));
    testAdapter.runCancelledCallbacks();
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls).toHaveLength(1);

    follow.update(inputs({ trackId: 2, visible: true, activeGroupStartIndex: 1 }));
    testAdapter.flushScheduled();
    follow.update(inputs({ trackId: 2, activeGroupStartIndex: 0 }));
    follow.startBrowsing();
    testAdapter.runCancelledCallbacks();
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls).toHaveLength(2);
    expect(follow.state.value).toBe("browsing");
    follow.dispose();
  });

  it("隐藏时不测量或滚动，显示后保留 browsing 状态", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.startBrowsing();
    follow.update(inputs({ visible: false, activeGroupStartIndex: 3 }));
    const containerReadsWhenHidden = testAdapter.containerReads;
    const scrollCountWhenHidden = testAdapter.scrollCalls.length;

    follow.update(inputs({ visible: false, compact: true, activeGroupStartIndex: 5 }));
    follow.update(inputs({ visible: true, compact: true, activeGroupStartIndex: 5 }));
    testAdapter.flushScheduled();

    expect(follow.state.value).toBe("browsing");
    expect(testAdapter.containerReads).toBe(containerReadsWhenHidden);
    expect(testAdapter.scrollCalls).toHaveLength(scrollCountWhenHidden);
    follow.dispose();
  });

  it("following 状态隐藏再显示时直接定位，且不重置状态", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();
    follow.update(inputs({ visible: false }));
    follow.update(inputs({ visible: true }));
    testAdapter.flushScheduled();

    expect(follow.state.value).toBe("following");
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("instant");
    follow.dispose();
  });

  it("首句之前滚到顶部，不把 -1 当作歌词行索引", () => {
    const testAdapter = createTestAdapter();
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs({ activeGroupStartIndex: -1 }));
    testAdapter.flushScheduled();

    expect(testAdapter.scrollCalls).toEqual([{ top: 0, behavior: "instant" }]);
    expect(testAdapter.lookedUpLines).not.toContain(-1);
    follow.dispose();
  });

  it("歌词加载与 compact 布局变化后直接定位", () => {
    const testAdapter = createTestAdapter();
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs({ activeGroupStartIndex: -1 }));
    testAdapter.flushScheduled();

    testAdapter.addLine(0, { top: 180, height: 40 });
    follow.update(inputs({ activeGroupStartIndex: 0, lineCount: 1 }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[1]?.behavior).toBe("instant");

    follow.update(inputs({ activeGroupStartIndex: 0, lineCount: 1, compact: true }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[2]?.behavior).toBe("instant");
    follow.dispose();
  });

  it("首句之前进入第一组时按普通前进平滑定位", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs({ activeGroupStartIndex: -1, lineCount: 1 }));
    testAdapter.flushScheduled();

    follow.update(inputs({ activeGroupStartIndex: 0, lineCount: 1 }));
    testAdapter.flushScheduled();

    expect(testAdapter.scrollCalls[0]?.behavior).toBe("instant");
    expect(testAdapter.scrollCalls[1]?.behavior).toBe("smooth");
    follow.dispose();
  });

  it("将目标行中心对齐到容器中心，并限制在可滚动范围内", () => {
    expect(
      calculateLyricsScrollTop(
        { top: 100, scrollTop: 40, clientHeight: 200, scrollHeight: 800 },
        { top: 230, height: 40 },
      ),
    ).toBe(90);
    expect(
      calculateLyricsScrollTop(
        { top: 100, scrollTop: 400, clientHeight: 200, scrollHeight: 600 },
        { top: 900, height: 40 },
      ),
    ).toBe(400);
    expect(calculateLyricsEdgePadding(200, 40, 60)).toEqual({ top: 80, bottom: 70 });
  });

  it("普通前进平滑定位，倒退、跳过多组和 seek 结束直接定位", () => {
    const testAdapter = createTestAdapter();
    for (let index = 0; index < 6; index += 1) {
      testAdapter.addLine(index, { top: 180 + index * 60, height: 40 });
    }
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs({ activeGroupStartIndex: 0 }));
    testAdapter.flushScheduled();

    follow.update(inputs({ activeGroupStartIndex: 1 }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("smooth");

    follow.update(inputs({ activeGroupStartIndex: 4 }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("instant");

    follow.update(inputs({ activeGroupStartIndex: 1 }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("instant");

    follow.update(inputs({ activeGroupStartIndex: 2, isSeeking: true }));
    testAdapter.flushScheduled();
    const callsDuringSeek = testAdapter.scrollCalls.length;
    follow.update(inputs({ activeGroupStartIndex: 3, isSeeking: true }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls).toHaveLength(callsDuringSeek);

    follow.update(inputs({ activeGroupStartIndex: 3, isSeeking: false }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("instant");
    follow.dispose();
  });

  it("尊重减少动态效果，并在尺寸变化后直接重新定位", () => {
    const testAdapter = createTestAdapter();
    testAdapter.addLine(0, { top: 180, height: 40 });
    testAdapter.addLine(1, { top: 240, height: 40 });
    const follow = createLyricsFollowCoordinator(testAdapter.adapter);
    follow.update(inputs());
    testAdapter.flushScheduled();

    testAdapter.setReducedMotion(true);
    follow.update(inputs({ activeGroupStartIndex: 1 }));
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("instant");

    testAdapter.resize();
    testAdapter.flushScheduled();
    expect(testAdapter.scrollCalls[testAdapter.scrollCalls.length - 1]?.behavior).toBe("instant");
    follow.dispose();
  });

  it("滚动键进入 browsing，但歌词 button 的 Enter/Space 激活不算滚动", () => {
    expect(isLyricsScrollKey("ArrowDown", "ArrowDown", false)).toBe(true);
    expect(isLyricsScrollKey("Enter", "Enter", true)).toBe(false);
    expect(isLyricsScrollKey(" ", "Space", true)).toBe(false);
    expect(isLyricsScrollKey(" ", "Space", false)).toBe(true);
  });
});
