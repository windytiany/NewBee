type ItemKeyboardOptions = {
  getItemKeys: () => readonly string[];
  itemSelector: string;
  onFocus: (key: string) => void;
  onMove: (key: string, event: KeyboardEvent) => void;
  onSelectAll?: (keys: readonly string[]) => void;
  onActivate?: (key: string) => void;
  onEscape?: () => void;
  grid?: boolean;
};

type ItemBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;

export function findDirectionalItem(bounds: readonly ItemBounds[], index: number, key: string) {
  const current = bounds[index];
  if (!current) return index;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const x = current.left + current.width / 2;
  const y = current.top + current.height / 2;
  let result = index;
  let bestDistance = Infinity;
  bounds.forEach((candidate, candidateIndex) => {
    if (candidateIndex === index) return;
    const dx = candidate.left + candidate.width / 2 - x;
    const dy = candidate.top + candidate.height / 2 - y;
    const forward = (horizontal ? dx : dy) * sign;
    const sideways = Math.abs(horizontal ? dy : dx);
    if (forward <= 1 || sideways >= forward) return;
    const distance = forward + sideways * 2;
    if (distance < bestDistance) {
      result = candidateIndex;
      bestDistance = distance;
    }
  });
  return result;
}

export function createItemKeyboard(options: ItemKeyboardOptions) {
  function getTarget(event: Event) {
    const container = event.currentTarget;
    const target = event.target;
    if (!(container instanceof HTMLElement) || !(target instanceof Element)) return null;
    const items = [...container.querySelectorAll<HTMLElement>(options.itemSelector)];
    const index = items.findIndex((item) => item === target || item.contains(target));
    const key = options.getItemKeys()[index];
    return key === undefined ? null : { items, index, key };
  }

  function onFocusin(event: FocusEvent) {
    const target = getTarget(event);
    if (target) {
      options.onFocus(target.key);
      target.items.forEach((item, index) => {
        item.tabIndex = index === target.index ? 0 : -1;
      });
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.metaKey || event.isComposing) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
    )
      return;
    const target = getTarget(event);
    if (!target) return;
    const { items, index, key } = target;
    if (
      event.ctrlKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "a" &&
      options.onSelectAll
    ) {
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      options.onSelectAll(options.getItemKeys());
      return;
    }
    if (event.ctrlKey && !event.shiftKey && event.key === " " && options.onSelectAll) {
      event.preventDefault();
      event.stopPropagation();
      options.onMove(key, event);
      return;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.shiftKey && options.onActivate) {
      event.preventDefault();
      event.stopPropagation();
      options.onActivate(key);
      return;
    }
    if (event.key === "Escape" && options.onEscape) {
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End" &&
      !(options.grid && (event.key === "ArrowLeft" || event.key === "ArrowRight"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : options.grid
            ? findDirectionalItem(
                items.map((item) => item.getBoundingClientRect()),
                index,
                event.key,
              )
            : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
    const nextKey = options.getItemKeys()[nextIndex];
    if (nextKey === undefined) return;
    if (event.ctrlKey && !event.shiftKey) options.onFocus(nextKey);
    else options.onMove(nextKey, event);
    items[nextIndex]?.focus({ preventScroll: true });
    items[nextIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return { onKeydown, onFocusin };
}
