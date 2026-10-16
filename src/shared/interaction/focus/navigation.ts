const ITEM_SELECTOR = "[data-keyboard-item]";
const FOCUS_SELECTOR = "button, input, select, textarea, a[href], [tabindex], [contenteditable]";
const REGION_SELECTOR = "[data-focus-region]";
const LIST_SELECTOR = "[data-keyboard-list]";

function available(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    !element.matches(':disabled, [aria-disabled="true"]') &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    element.getAttribute("type") !== "hidden"
  );
}

export function createFocusNavigation(document: Document) {
  const regionFocus = new WeakMap<HTMLElement, HTMLElement>();
  const listFocus = new WeakMap<HTMLElement, HTMLElement>();

  function remember(event: FocusEvent) {
    const target = event.target;
    if (!(target instanceof globalThis.HTMLElement) || target.closest('dialog, [role="menu"]'))
      return;
    const region = target.closest<HTMLElement>(REGION_SELECTOR);
    if (region) regionFocus.set(region, target);
    const list = target.closest<HTMLElement>(LIST_SELECTOR);
    if (list && target.matches(ITEM_SELECTOR)) listFocus.set(list, target);
  }

  function prepareLists() {
    for (const list of document.querySelectorAll<HTMLElement>(LIST_SELECTOR)) {
      if (!available(list)) continue;
      const items = [...list.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
        (item) => item.closest(LIST_SELECTOR) === list && available(item),
      );
      const previous = listFocus.get(list);
      const entry =
        (previous && items.includes(previous) ? previous : undefined) ??
        items.find(
          (item) =>
            item.getAttribute("aria-pressed") === "true" ||
            item.getAttribute("aria-current") === "true",
        ) ??
        items.find((item) => item.tabIndex >= 0) ??
        items[0];
      for (const item of items) item.tabIndex = item === entry ? 0 : -1;
    }
  }

  function entry(region: HTMLElement) {
    const previous = regionFocus.get(region);
    if (
      previous &&
      previous !== region &&
      previous.tabIndex >= 0 &&
      region.contains(previous) &&
      available(previous)
    )
      return previous;
    const belongs = (element: HTMLElement) =>
      available(element) && element.tabIndex >= 0 && element.closest(REGION_SELECTOR) === region;
    const item = [...region.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].find(belongs);
    if (item) return item;
    const control = [...region.querySelectorAll<HTMLElement>(FOCUS_SELECTOR)].find(belongs);
    if (control) return control;
    region.tabIndex = -1;
    return region;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (event.key !== "Tab" && event.key !== "F6")
    )
      return;
    if ([...document.querySelectorAll<HTMLElement>('dialog[open], [role="menu"]')].some(available))
      return;
    prepareLists();
    if (event.key === "Tab") return;
    const regions = [...document.querySelectorAll<HTMLElement>(REGION_SELECTOR)].filter(available);
    if (!regions.length) return;
    event.preventDefault();
    if (event.repeat) return;
    const current = document.activeElement?.closest(REGION_SELECTOR);
    const index = regions.findIndex((region) => region === current);
    const next =
      index < 0
        ? event.shiftKey
          ? regions.length - 1
          : 0
        : (index + (event.shiftKey ? -1 : 1) + regions.length) % regions.length;
    const region = regions[next];
    if (region) entry(region).focus();
  }

  return { remember, handleKeydown };
}
