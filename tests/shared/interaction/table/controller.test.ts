import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { useTable } from "@/shared/interaction/table/useTable";
import type { TableColumn } from "@/shared/interaction/table/useTable";
import { compileSfc, evaluateSource } from "../../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../../support/host/renderer";

const columns: TableColumn[] = [
  { key: "number", label: "#", width: "2rem", mobileWidth: "1.5rem" },
  { key: "title", label: "Title", width: "minmax(0,1.5fr)", mobileWidth: "minmax(0,1fr)" },
  { key: "album", label: "Album", width: "minmax(0,1fr)", desktopOnly: true },
  { key: "duration", label: "Duration", width: "3rem" },
];
const source = Vue.ref([
  { title: "Song 10", album: "B", duration: 1000 },
  { title: "Song 2", album: "A", duration: 90000 },
  { title: "Song 2", album: "A", duration: 2000 },
]);
const scopes: Vue.EffectScope[] = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let target: EventTarget;
beforeEach(() => {
  target = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
});
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
function fixture() {
  const scope = Vue.effectScope();
  scopes.push(scope);
  const table = scope.run(() =>
    useTable({
      columns: () => columns,
      rows: () => source.value,
      value: (row, key, index) => {
        if (key === "number") return index;
        if (key === "title") return row.title;
        if (key === "album") return row.album;
        return row.duration;
      },
    }),
  );
  if (!table) throw new Error("Missing table controller");
  return { table, scope };
}
function handle(widths: number[]) {
  return {
    closest: () => ({
      querySelectorAll: () =>
        columns.map((column, index) => ({
          dataset: { tableColumn: column.key },
          getBoundingClientRect: () => ({ width: widths[index] ?? 0 }),
        })),
    }),
  };
}
function pointer(type: string, x: number, currentTarget?: object, id = 1) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { button: 0, clientX: x, pointerId: id });
  if (currentTarget) Object.defineProperty(event, "currentTarget", { value: currentTarget });
  return event as PointerEvent;
}

describe("table interactions", () => {
  it("sorts text naturally, numbers numerically and ties stably without mutating input", () => {
    const { table } = fixture();
    const original = [...source.value];
    table.toggle("title");
    expect(table.rows.value).toEqual([original[1], original[2], original[0]]);
    table.toggle("title");
    expect(table.rows.value).toEqual([original[0], original[1], original[2]]);
    table.toggle("duration");
    expect(table.rows.value).toEqual([original[0], original[2], original[1]]);
    table.toggle("duration");
    expect(table.rows.value).toEqual([original[1], original[2], original[0]]);
    table.toggle("album");
    expect(table.rows.value).toEqual([original[1], original[2], original[0]]);
    table.toggle("number");
    expect(table.rows.value).toEqual(original);
    table.toggle("number");
    expect(table.rows.value).toEqual([...original].reverse());
    expect(source.value).toEqual(original);
  });

  it("resizes adjacent columns as proportions shared by headers and nested row bodies", () => {
    const { table } = fixture();
    const event = pointer("pointerdown", 100, handle([32, 180, 120, 48]));
    table.resize("title", event);
    expect(event.defaultPrevented).toBe(true);
    target.dispatchEvent(pointer("pointermove", 140));
    expect(table.style.value["--table-desktop-columns"]).toBe(
      "minmax(0,32fr) minmax(0,220fr) minmax(0,80fr) minmax(0,48fr)",
    );
    expect(table.style.value["--table-desktop-body-columns"]).toBe(
      "minmax(0,220fr) minmax(0,80fr) minmax(0,48fr)",
    );
    expect(table.sort.value).toBeNull();
    target.dispatchEvent(pointer("pointermove", 10000));
    expect(table.style.value["--table-desktop-columns"]).toContain("minmax(0,32fr)");
    target.dispatchEvent(pointer("pointerup", 10000));
    const finished = table.style.value;
    target.dispatchEvent(pointer("pointermove", 100));
    expect(table.style.value).toEqual(finished);
  });

  it("keeps mobile layout independent and cleans up canceled or unmounted gestures", () => {
    const { table, scope } = fixture();
    const desktop = table.style.value["--table-desktop-columns"];
    table.resize("title", pointer("pointerdown", 100, handle([24, 180, 0, 48])));
    target.dispatchEvent(pointer("pointermove", 130, undefined, 2));
    expect(table.style.value["--table-columns"]).toBe("1.5rem minmax(0,1fr) 3rem");
    target.dispatchEvent(pointer("pointermove", 130));
    expect(table.style.value["--table-columns"]).toBe(
      "minmax(0,24fr) minmax(0,196fr) minmax(0,32fr)",
    );
    expect(table.style.value["--table-desktop-columns"]).toBe(desktop);
    target.dispatchEvent(pointer("pointercancel", 130));
    const canceled = table.style.value;
    target.dispatchEvent(pointer("pointermove", 100));
    expect(table.style.value).toEqual(canceled);
    table.resize("title", pointer("pointerdown", 100, handle([24, 196, 0, 32])));
    scope.stop();
    target.dispatchEvent(pointer("pointermove", 50));
    expect(table.style.value).toEqual(canceled);
  });

  it("exposes accessible sort buttons and keyboard column resizing", async () => {
    const { table } = fixture();
    const component = evaluateSource<{ default: Vue.Component }>(
      compileSfc(
        await Bun.file("src/shared/interaction/table/TableHeader.vue").text(),
        "TableHeader.vue",
      ),
      { vue: Vue },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp({
      setup: () => () =>
        Vue.h(component, {
          columns,
          sort: table.sort.value,
          onSort: table.toggle,
          onResize: table.resize,
        }),
    });
    app.mount(root);
    try {
      const button = findNode(root, (node) => node.props["data-table-sort"] === "title");
      const click = button?.props.onClick;
      if (typeof click !== "function") throw new Error("Missing sort button");
      click();
      await Vue.nextTick();
      const cell = findNode(root, (node) => node.props["data-table-column"] === "title");
      expect(cell?.props["aria-sort"]).toBe("ascending");
      expect(getTextContent(root)).toContain("↑");
      click();
      await Vue.nextTick();
      expect(cell?.props["aria-sort"]).toBe("descending");
      const separator = findNode(root, (node) => node.props["data-table-resize"] === "title");
      const keydown = separator?.props.onKeydown;
      if (typeof keydown !== "function") throw new Error("Missing resize handle");
      const event = new Event("keydown", { cancelable: true });
      Object.defineProperties(event, {
        key: { value: "ArrowRight" },
        currentTarget: { value: handle([32, 180, 120, 48]) },
      });
      keydown(event);
      expect(table.style.value["--table-desktop-columns"]).toContain("minmax(0,188fr)");
      expect(table.sort.value?.direction).toBe("descending");
    } finally {
      app.unmount();
    }
  });
});
