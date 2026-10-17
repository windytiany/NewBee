import { computed, onScopeDispose, ref } from "vue";
import type { CSSProperties } from "vue";

export type TableColumn = {
  key: string;
  label: string;
  width: string;
  mobileWidth?: string;
  desktopOnly?: boolean;
  right?: boolean;
  resizable?: boolean;
};
export type TableSort = { key: string; direction: "ascending" | "descending" };
type CellValue = string | number | null | undefined;

export function useTable<T>(options: {
  columns: () => readonly TableColumn[];
  rows: () => readonly T[];
  value: (row: T, key: string, index: number) => CellValue;
}) {
  const sort = ref<TableSort | null>(null);
  const widths = ref({
    desktop: {} as Record<string, number>,
    mobile: {} as Record<string, number>,
  });
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const rows = computed(() => {
    const entries = options.rows().map((row, index) => ({ row, index }));
    const order = sort.value;
    if (order) {
      entries.sort((a, b) => {
        const left = options.value(a.row, order.key, a.index);
        const right = options.value(b.row, order.key, b.index);
        let compared: number;
        if (left == null) compared = right == null ? 0 : 1;
        else if (right == null) compared = -1;
        else if (typeof left === "number" && typeof right === "number") compared = left - right;
        else compared = collator.compare(String(left), String(right));
        return (order.direction === "ascending" ? compared : -compared) || a.index - b.index;
      });
    }
    return entries.map(({ row }) => row);
  });
  function toggle(key: string) {
    if (!options.columns().some((column) => column.key === key)) return;
    sort.value = {
      key,
      direction:
        sort.value?.key === key && sort.value.direction === "ascending"
          ? "descending"
          : "ascending",
    };
  }
  function layout(columns: readonly TableColumn[], mobile: boolean) {
    return columns.map((column) => {
      const weight =
        column.resizable === false
          ? undefined
          : (mobile ? widths.value.mobile : widths.value.desktop)[column.key];
      return weight
        ? `minmax(0,${weight}fr)`
        : mobile
          ? (column.mobileWidth ?? column.width)
          : column.width;
    });
  }
  const style = computed<CSSProperties>(() => {
    const columns = options.columns();
    const mobile = columns.filter((column) => !column.desktopOnly);
    const full = layout(columns, false);
    const compact = layout(mobile, true);
    return {
      "--table-columns": compact.join(" "),
      "--table-desktop-columns": full.join(" "),
      "--table-body-columns": compact.slice(1).join(" "),
      "--table-desktop-body-columns": full.slice(1).join(" "),
    };
  });
  let stopResize: (() => void) | null = null;
  function cancelResize() {
    stopResize?.();
    stopResize = null;
  }
  function resize(key: string, event: PointerEvent | KeyboardEvent) {
    if ("button" in event && event.button !== 0) return;
    if ("key" in event && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const handle = event.currentTarget as HTMLElement | null;
    const header = handle?.closest("[data-table-header]");
    if (!header) return;
    const cells = Array.from(header.querySelectorAll<HTMLElement>("[data-table-column]"))
      .map((cell) => ({
        key: cell.dataset.tableColumn ?? "",
        width: cell.getBoundingClientRect().width,
      }))
      .filter((cell) => cell.width > 0);
    const index = cells.findIndex((cell) => cell.key === key);
    if (index < 0 || cells.length < 2) return;
    const left = index === cells.length - 1 ? index - 1 : index;
    const first = cells[left]!;
    const second = cells[left + 1]!;
    const resizable = new Set(
      options
        .columns()
        .filter((column) => column.resizable !== false)
        .map((column) => column.key),
    );
    if (!resizable.has(first.key) || !resizable.has(second.key)) return;
    const total = first.width + second.width;
    const minimum = Math.min(32, total / 3);
    const mode = cells.length === options.columns().length ? "desktop" : "mobile";
    const apply = (delta: number) => {
      const width = Math.max(minimum, Math.min(total - minimum, first.width + delta));
      widths.value[mode] = {
        ...Object.fromEntries(
          cells.filter((cell) => resizable.has(cell.key)).map((cell) => [cell.key, cell.width]),
        ),
        [first.key]: width,
        [second.key]: total - width,
      };
    };
    event.preventDefault();
    cancelResize();
    if ("key" in event) {
      apply(event.key === "ArrowRight" ? 8 : -8);
      return;
    }
    const start = event.clientX;
    const pointerId = event.pointerId;
    const move = (event: PointerEvent) => {
      if (event.pointerId === pointerId) apply(event.clientX - start);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === pointerId) cancelResize();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", cancelResize);
    stopResize = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", cancelResize);
    };
  }
  onScopeDispose(cancelResize);
  return { rows, sort, style, toggle, resize };
}
