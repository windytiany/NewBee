import { describe, expect, it } from "bun:test";
import { createItemFocusManager, type ItemSelectionModifiers } from "@/interaction/itemFocus";

const plainClick: ItemSelectionModifiers = { ctrlKey: false, shiftKey: false };
const ctrlClick: ItemSelectionModifiers = { ctrlKey: true, shiftKey: false };
const shiftClick: ItemSelectionModifiers = { ctrlKey: false, shiftKey: true };
const ctrlShiftClick: ItemSelectionModifiers = { ctrlKey: true, shiftKey: true };

function createDocumentHarness() {
  let clickListener: ((event: Event) => void) | null = null;
  let registrations = 0;
  const documentTarget = {
    addEventListener: (_type: string, listener: EventListener) => {
      registrations += 1;
      clickListener = listener as (event: Event) => void;
    },
  };

  return {
    documentTarget: documentTarget as unknown as Pick<Document, "addEventListener">,
    get registrations() {
      return registrations;
    },
    click(closest: (selector: string) => unknown) {
      clickListener?.({ target: { closest } } as unknown as Event);
    },
  };
}

describe("Item 焦点与列表选择", () => {
  it("全应用只保留一个焦点，点击空白同时清除焦点和多选", () => {
    const manager = createItemFocusManager();
    const albumRows = ["41", "42", "43"];
    const queueRows = ["queue-row-a", "queue-row-b"];

    manager.selectItem("library:album-tracks", "41", albumRows, plainClick);
    manager.selectItem("playback:queue", "queue-row-b", queueRows, plainClick);

    expect(manager.focusedItem.value).toEqual({
      listScope: "playback:queue",
      itemKey: "queue-row-b",
    });
    expect(manager.selection.value).toMatchObject({
      listScope: "playback:queue",
      selectedItemKeys: ["queue-row-b"],
    });

    const documentHarness = createDocumentHarness();
    manager.connectDocument(documentHarness.documentTarget);
    manager.connectDocument(documentHarness.documentTarget);
    expect(documentHarness.registrations).toBe(1);

    documentHarness.click(() => null);
    expect(manager.focusedItem.value).toBeNull();
    expect(manager.selection.value).toBeNull();
  });

  it("导航 Item 只设唯一焦点，不支持多选", () => {
    const manager = createItemFocusManager();
    manager.selectItem("playlist:tracks:9", "501", ["501", "502"], ctrlClick);

    manager.focusItem("library:artists", "artist:1");

    expect(manager.focusedItem.value).toEqual({
      listScope: "library:artists",
      itemKey: "artist:1",
    });
    expect(manager.selection.value).toBeNull();
  });

  it("按 Ctrl、Shift 和 Ctrl+Shift 修饰键选择并保留 Shift 锚点", () => {
    const manager = createItemFocusManager();
    const visibleRows = ["a", "b", "c", "d", "e"];

    manager.selectItem("album-tracks", "b", visibleRows, plainClick);
    manager.selectItem("album-tracks", "d", visibleRows, ctrlClick);
    expect(manager.getSelectedItemKeys("album-tracks", visibleRows)).toEqual(["b", "d"]);
    expect(manager.selection.value?.anchorItemKey).toBe("b");

    manager.selectItem("album-tracks", "d", visibleRows, ctrlClick);
    expect(manager.getSelectedItemKeys("album-tracks", visibleRows)).toEqual(["b"]);
    expect(manager.focusedItem.value?.itemKey).toBe("d");

    manager.selectItem("album-tracks", "d", visibleRows, shiftClick);
    expect(manager.getSelectedItemKeys("album-tracks", visibleRows)).toEqual(["b", "c", "d"]);
    expect(manager.selection.value?.anchorItemKey).toBe("b");

    manager.selectItem("album-tracks", "e", visibleRows, ctrlShiftClick);
    expect(manager.getSelectedItemKeys("album-tracks", visibleRows)).toEqual(["b", "c", "d", "e"]);
    expect(manager.focusedItem.value?.itemKey).toBe("e");
  });

  it("切换列表会清除旧锚点，队列以 rowKey 区分重复曲目", () => {
    const manager = createItemFocusManager();
    manager.selectItem("album-tracks", "7", ["7", "8"], plainClick);

    const queueRows = ["row-first-track-7", "row-second-track-7"];
    manager.selectItem("playback:queue", "row-second-track-7", queueRows, shiftClick);

    expect(manager.getSelectedItemKeys("playback:queue", queueRows)).toEqual([
      "row-second-track-7",
    ]);
    expect(manager.selection.value?.anchorItemKey).toBe("row-second-track-7");
    expect(manager.isSelected("playback:queue", "row-first-track-7")).toBe(false);
    expect(manager.isSelected("playback:queue", "row-second-track-7")).toBe(true);
  });

  it("右键及键盘菜单目标保留已选集，否则只选目标行；菜单点击不清理状态", () => {
    const manager = createItemFocusManager();
    const visibleRows = ["a", "b", "c", "d"];
    manager.selectItem("playback:queue", "a", visibleRows, plainClick);
    manager.selectItem("playback:queue", "c", visibleRows, ctrlClick);

    expect(manager.contextMenuTargets("playback:queue", "c", visibleRows)).toEqual(["a", "c"]);
    expect(manager.focusedItem.value?.itemKey).toBe("c");

    const documentHarness = createDocumentHarness();
    manager.connectDocument(documentHarness.documentTarget);
    documentHarness.click((selector) => (selector === "[data-item-interaction]" ? {} : null));
    expect(manager.getSelectedItemKeys("playback:queue", visibleRows)).toEqual(["a", "c"]);

    // The same target-resolution path is used when the menu is opened from the keyboard.
    expect(manager.contextMenuTargets("playback:queue", "d", visibleRows)).toEqual(["d"]);
    expect(manager.focusedItem.value?.itemKey).toBe("d");
  });

  it("列表卸载或行不可见后失效对应焦点、选中项和锚点", () => {
    const manager = createItemFocusManager();
    manager.registerList("playlist:tracks:9");
    manager.selectItem("playlist:tracks:9", "501", ["501", "502"], plainClick);
    manager.selectItem("playlist:tracks:9", "502", ["501", "502"], ctrlClick);

    manager.syncVisibleItems("playlist:tracks:9", ["501"]);
    expect(manager.focusedItem.value).toBeNull();
    expect(manager.selection.value).toMatchObject({
      selectedItemKeys: ["501"],
      anchorItemKey: "501",
    });

    manager.unregisterList("playlist:tracks:9");
    expect(manager.selection.value).toBeNull();
  });
});
