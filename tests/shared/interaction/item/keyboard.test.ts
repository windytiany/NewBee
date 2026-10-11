import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createItemKeyboard, findDirectionalItem } from "@/shared/interaction/item/keyboard";

type Bounds = Pick<DOMRect, "left" | "top" | "width" | "height">;
const itemSelector = "[data-keyboard-item]";

class TestElement extends EventTarget {
  readonly children: TestElement[] = [];
  readonly focus = mock((options?: FocusOptions) => {
    void options;
  });
  readonly scrollIntoView = mock((options?: ScrollIntoViewOptions) => {
    void options;
  });

  constructor(
    readonly selector = "",
    public bounds: Bounds = { left: 0, top: 0, width: 80, height: 40 },
  ) {
    super();
  }

  contains(target: EventTarget): boolean {
    return this === target || this.children.some((child) => child.contains(target));
  }

  querySelectorAll(selector: string): TestElement[] {
    return this.children.flatMap((child) => [
      ...(child.selector === selector ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  getBoundingClientRect() {
    return this.bounds;
  }
}

class TestUIEvent extends Event implements UIEvent {
  readonly detail = 0;
  readonly view = null;
  readonly which = 0;

  constructor(
    type: string,
    private readonly eventTarget: EventTarget | null,
    private readonly container: EventTarget | null,
  ) {
    super(type, { bubbles: true, cancelable: true });
  }

  override get target() {
    return this.eventTarget;
  }

  override get currentTarget() {
    return this.container;
  }

  initUIEvent(): never {
    throw new Error("Use the test event constructor");
  }
}

class TestKeyboardEvent extends TestUIEvent implements KeyboardEvent {
  readonly charCode = 0;
  readonly code = "";
  readonly keyCode = 0;
  readonly location = 0;
  readonly repeat = false;
  readonly DOM_KEY_LOCATION_STANDARD = 0;
  readonly DOM_KEY_LOCATION_LEFT = 1;
  readonly DOM_KEY_LOCATION_RIGHT = 2;
  readonly DOM_KEY_LOCATION_NUMPAD = 3;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly preventDefaultCalls = mock(() => {});
  readonly stopPropagationCalls = mock(() => {});

  constructor(
    readonly key: string,
    target: EventTarget | null,
    container: EventTarget | null,
    modifiers: KeyboardEventInit = {},
  ) {
    super("keydown", target, container);
    this.altKey = modifiers.altKey ?? false;
    this.ctrlKey = modifiers.ctrlKey ?? false;
    this.metaKey = modifiers.metaKey ?? false;
    this.shiftKey = modifiers.shiftKey ?? false;
    this.isComposing = modifiers.isComposing ?? false;
  }

  override preventDefault() {
    this.preventDefaultCalls();
    super.preventDefault();
  }

  override stopPropagation() {
    this.stopPropagationCalls();
    super.stopPropagation();
  }

  getModifierState(key: string) {
    switch (key) {
      case "Alt":
        return this.altKey;
      case "Control":
        return this.ctrlKey;
      case "Meta":
        return this.metaKey;
      case "Shift":
        return this.shiftKey;
      default:
        return false;
    }
  }

  initKeyboardEvent(): never {
    throw new Error("Use the test event constructor");
  }
}

class TestFocusEvent extends TestUIEvent implements FocusEvent {
  readonly relatedTarget = null;

  constructor(target: EventTarget | null, container: EventTarget | null) {
    super("focusin", target, container);
  }
}

function createHarness(options: { grid?: boolean; callbacks?: boolean; keys?: string[] } = {}) {
  const keys = options.keys ?? ["a", "b", "c"];
  const items = keys.map(() => new TestElement(itemSelector));
  const container = new TestElement();
  container.children.push(...items);
  const onFocus = mock((key: string) => {
    void key;
  });
  const onMove = mock((key: string, event: KeyboardEvent) => {
    void key;
    void event;
  });
  const onPlay = mock((key: string) => {
    void key;
  });
  const onEscape = mock(() => {});
  const keyboard = createItemKeyboard({
    getItemKeys: () => keys,
    itemSelector,
    grid: options.grid,
    onFocus,
    onMove,
    ...(options.callbacks === false ? {} : { onActivate: onPlay, onEscape }),
  });
  return { keys, items, container, onFocus, onMove, onPlay, onEscape, keyboard };
}

function expectUnhandled(event: TestKeyboardEvent, harness: ReturnType<typeof createHarness>) {
  expect(event.preventDefaultCalls).not.toHaveBeenCalled();
  expect(event.stopPropagationCalls).not.toHaveBeenCalled();
  expect(harness.onMove).not.toHaveBeenCalled();
  expect(harness.onPlay).not.toHaveBeenCalled();
  expect(harness.onEscape).not.toHaveBeenCalled();
  expect(harness.onFocus).not.toHaveBeenCalled();
  for (const item of harness.items) {
    expect(item.focus).not.toHaveBeenCalled();
    expect(item.scrollIntoView).not.toHaveBeenCalled();
  }
}

const originalConstructors = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  for (const name of ["HTMLElement", "Element"]) {
    originalConstructors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: TestElement });
  }
});

afterEach(() => {
  for (const [name, descriptor] of originalConstructors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originalConstructors.clear();
});

describe("Item 列表键盘", () => {
  it.each([
    ["ArrowUp", 1, 0],
    ["ArrowDown", 1, 2],
    ["ArrowUp", 0, 0],
    ["ArrowDown", 2, 2],
  ])("%s 从索引 %i 移到 %i，边界不循环", (key, index, nextIndex) => {
    const harness = createHarness();
    const event = new TestKeyboardEvent(key, harness.items[index], harness.container);
    harness.keyboard.onKeydown(event);

    expect(harness.onMove.mock.calls).toEqual([[harness.keys[nextIndex], event]]);
    expect(event.defaultPrevented).toBe(true);
    expect(event.stopPropagationCalls).toHaveBeenCalledTimes(1);
    for (const [itemIndex, item] of harness.items.entries()) {
      if (itemIndex === nextIndex) {
        expect(item.focus.mock.calls).toEqual([[{ preventScroll: true }]]);
        expect(item.scrollIntoView.mock.calls).toEqual([
          [
            {
              block: "nearest",
              inline: "nearest",
            },
          ],
        ]);
      } else {
        expect(item.focus).not.toHaveBeenCalled();
        expect(item.scrollIntoView).not.toHaveBeenCalled();
      }
    }
  });

  it.each(["ArrowUp", "ArrowDown"])("单项列表 %s 保持当前 Item", (key) => {
    const harness = createHarness({ keys: ["only"] });
    const event = new TestKeyboardEvent(key, harness.items[0], harness.container);
    harness.keyboard.onKeydown(event);
    expect(harness.onMove.mock.calls).toEqual([["only", event]]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Enter 调用当前 Item 的播放 callback，并阻止默认行为与冒泡", () => {
    const harness = createHarness();
    const child = new TestElement();
    harness.items[1].children.push(child);
    const event = new TestKeyboardEvent("Enter", child, harness.container);
    harness.keyboard.onKeydown(event);
    expect(harness.onPlay.mock.calls).toEqual([["b"]]);
    expect(event.defaultPrevented).toBe(true);
    expect(event.preventDefaultCalls).toHaveBeenCalledTimes(1);
    expect(event.stopPropagationCalls).toHaveBeenCalledTimes(1);
    expect(harness.onMove).not.toHaveBeenCalled();
    expect(harness.items[1].focus).not.toHaveBeenCalled();
  });

  it("Escape 调用退出 callback，并阻止默认行为与冒泡", () => {
    const harness = createHarness();
    const event = new TestKeyboardEvent("Escape", harness.items[1], harness.container);
    harness.keyboard.onKeydown(event);
    expect(harness.onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(event.preventDefaultCalls).toHaveBeenCalledTimes(1);
    expect(event.stopPropagationCalls).toHaveBeenCalledTimes(1);
    expect(harness.onPlay).not.toHaveBeenCalled();
    expect(harness.onMove).not.toHaveBeenCalled();
  });

  it.each(["Enter", "Escape"])("未提供 callback 时不接管 %s", (key) => {
    const harness = createHarness({ callbacks: false });
    const event = new TestKeyboardEvent(key, harness.items[0], harness.container);
    harness.keyboard.onKeydown(event);
    expectUnhandled(event, harness);
  });

  it("focusin 将 Item 本身及其后代映射到对应 key", () => {
    const harness = createHarness();
    const child = new TestElement();
    const grandchild = new TestElement();
    child.children.push(grandchild);
    harness.items[2].children.push(child);
    harness.keyboard.onFocusin(new TestFocusEvent(harness.items[1], harness.container));
    harness.keyboard.onFocusin(new TestFocusEvent(grandchild, harness.container));
    expect(harness.onFocus.mock.calls).toEqual([["b"], ["c"]]);
    expect(harness.onMove).not.toHaveBeenCalled();
    expect(harness.onPlay).not.toHaveBeenCalled();
  });

  it.each(["ArrowLeft", "ArrowRight", "Tab", " ", "a"])("列表不接管 %s", (key) => {
    const harness = createHarness();
    const event = new TestKeyboardEvent(key, harness.items[1], harness.container);
    harness.keyboard.onKeydown(event);
    expectUnhandled(event, harness);
  });

  it.each(["blank", "menu", "input"])("不处理 Item 外的 %s 目标", (selector) => {
    const harness = createHarness();
    const target = new TestElement(selector);
    harness.container.children.push(target);
    for (const key of ["ArrowDown", "Enter", "Escape"]) {
      const event = new TestKeyboardEvent(key, target, harness.container);
      harness.keyboard.onKeydown(event);
      expectUnhandled(event, harness);
    }
    harness.keyboard.onFocusin(new TestFocusEvent(target, harness.container));
    expect(harness.onFocus).not.toHaveBeenCalled();
  });

  it("空列表或目标没有对应 key 时不处理", () => {
    for (const keys of [[], ["a"]]) {
      const harness = createHarness({ keys });
      const unmatched = new TestElement(itemSelector);
      harness.container.children.push(unmatched);
      const event = new TestKeyboardEvent("ArrowDown", unmatched, harness.container);
      harness.keyboard.onKeydown(event);
      harness.keyboard.onFocusin(new TestFocusEvent(unmatched, harness.container));
      expectUnhandled(event, harness);
    }
  });

  it("非 Element、空目标或非 HTMLElement 容器不处理", () => {
    const harness = createHarness();
    for (const target of [null, new EventTarget()]) {
      const event = new TestKeyboardEvent("Enter", target, harness.container);
      harness.keyboard.onKeydown(event);
      harness.keyboard.onFocusin(new TestFocusEvent(target, harness.container));
      expectUnhandled(event, harness);
    }
    for (const container of [null, new EventTarget()]) {
      const event = new TestKeyboardEvent("Enter", harness.items[0], container);
      harness.keyboard.onKeydown(event);
      harness.keyboard.onFocusin(new TestFocusEvent(harness.items[0], container));
      expectUnhandled(event, harness);
    }
  });

  it.each([{ altKey: true }, { metaKey: true }, { isComposing: true }])(
    "忽略修饰或输入法状态 %j",
    (modifiers) => {
      const harness = createHarness();
      for (const key of ["ArrowDown", "Enter", "Escape"]) {
        const event = new TestKeyboardEvent(key, harness.items[0], harness.container, modifiers);
        harness.keyboard.onKeydown(event);
        expectUnhandled(event, harness);
      }
    },
  );

  it("不再次处理已 defaultPrevented 的事件", () => {
    const harness = createHarness();
    for (const key of ["ArrowDown", "Enter", "Escape"]) {
      const event = new TestKeyboardEvent(key, harness.items[0], harness.container);
      event.preventDefault();
      event.preventDefaultCalls.mockClear();
      harness.keyboard.onKeydown(event);
      expect(event.defaultPrevented).toBe(true);
      expectUnhandled(event, harness);
    }
  });

  it.each([{ ctrlKey: true }, { shiftKey: true }, { ctrlKey: true, shiftKey: true }])(
    "Ctrl/Shift %j 原样传入移动 callback",
    (modifiers) => {
      const harness = createHarness();
      const event = new TestKeyboardEvent(
        "ArrowDown",
        harness.items[0],
        harness.container,
        modifiers,
      );
      harness.keyboard.onKeydown(event);
      expect(harness.onMove.mock.calls).toEqual([["b", event]]);
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it("只影响当前容器，不匹配其他区域中相同 selector 的 Item", () => {
    const first = createHarness();
    const second = createHarness();
    const ownEvent = new TestKeyboardEvent("ArrowDown", first.items[0], first.container);
    first.keyboard.onKeydown(ownEvent);
    expect(first.onMove.mock.calls).toEqual([["b", ownEvent]]);
    const foreignEvent = new TestKeyboardEvent("Enter", first.items[0], second.container);
    second.keyboard.onKeydown(foreignEvent);
    second.keyboard.onFocusin(new TestFocusEvent(first.items[0], second.container));
    expectUnhandled(foreignEvent, second);
  });
});

// DOM order deliberately differs from the visual layout; dimensions vary as well.
const gridBounds: Bounds[] = [
  { left: 100, top: 100, width: 80, height: 60 }, // center
  { left: 100, top: 200, width: 80, height: 60 }, // down
  { left: 200, top: 100, width: 100, height: 60 }, // right
  { left: 110, top: 0, width: 60, height: 60 }, // up
  { left: 0, top: 110, width: 80, height: 40 }, // left
  { left: 200, top: 200, width: 80, height: 60 }, // diagonal
  { left: 400, top: 100, width: 80, height: 60 }, // far right
];

describe("Item grid 几何导航", () => {
  it.each([
    ["ArrowUp", 3],
    ["ArrowDown", 1],
    ["ArrowLeft", 4],
    ["ArrowRight", 2],
  ])("%s 使用实际 bounds 而非 DOM 索引，移到 %i", (key, nextIndex) => {
    const harness = createHarness({ grid: true, keys: gridBounds.map((_, index) => `${index}`) });
    harness.items.forEach((item, index) => {
      item.bounds = gridBounds[index];
    });
    const event = new TestKeyboardEvent(key, harness.items[0], harness.container);
    harness.keyboard.onKeydown(event);
    expect(harness.onMove.mock.calls).toEqual([[`${nextIndex}`, event]]);
    expect(harness.items[nextIndex].focus.mock.calls).toEqual([
      [
        {
          preventScroll: true,
        },
      ],
    ]);
    expect(harness.items[nextIndex].scrollIntoView.mock.calls).toEqual([
      [
        {
          block: "nearest",
          inline: "nearest",
        },
      ],
    ]);
    expect(event.defaultPrevented).toBe(true);
    expect(event.stopPropagationCalls).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ArrowUp", 3],
    ["ArrowDown", 1],
    ["ArrowLeft", 4],
    ["ArrowRight", 6],
  ])("%s 在视觉边界 %i 不循环", (key, index) => {
    expect(findDirectionalItem(gridBounds, index, key)).toBe(index);
  });

  it("排除背向、对角和几乎重叠候选，优先较低方向距离", () => {
    const bounds: Bounds[] = [
      { left: 100, top: 100, width: 20, height: 20 },
      { left: 50, top: 100, width: 20, height: 20 },
      { left: 130, top: 140, width: 20, height: 20 },
      { left: 101, top: 100, width: 20, height: 20 },
      { left: 140, top: 130, width: 20, height: 20 },
      { left: 180, top: 100, width: 20, height: 20 },
    ];
    expect(findDirectionalItem(bounds, 0, "ArrowRight")).toBe(5);
    expect(findDirectionalItem(bounds.slice(0, 4), 0, "ArrowRight")).toBe(0);
  });

  it("空 bounds 或无效当前索引保持原索引", () => {
    expect(findDirectionalItem([], 0, "ArrowDown")).toBe(0);
    expect(findDirectionalItem(gridBounds, -1, "ArrowUp")).toBe(-1);
    expect(findDirectionalItem(gridBounds, gridBounds.length, "ArrowRight")).toBe(
      gridBounds.length,
    );
  });
});
