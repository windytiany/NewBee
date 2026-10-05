import { computed, onUnmounted, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";

export type ItemIdentity = {
  listScope: string;
  itemKey: string;
};

export type ItemSelectionModifiers = {
  ctrlKey: boolean;
  shiftKey: boolean;
};

export type ItemSelectionState = {
  listScope: string;
  selectedItemKeys: readonly string[];
  anchorItemKey: string | null;
};

type ItemInteractionDocument = Pick<Document, "addEventListener">;

export function createItemSelection() {
  const focusedItem = shallowRef<ItemIdentity | null>(null);
  const selection = shallowRef<ItemSelectionState | null>(null);
  const mountedLists = new Map<string, number>();
  let connectedDocument = false;

  function clear() {
    focusedItem.value = null;
    selection.value = null;
  }

  function handleDocumentClick(event: Event) {
    const target = event.target as
      (EventTarget & { closest?: (selector: string) => unknown }) | null;
    if (target?.closest?.("[data-item-interaction]")) return;
    clear();
  }

  function connectDocument(documentTarget?: ItemInteractionDocument) {
    if (connectedDocument) return;
    const target = documentTarget ?? globalThis.document;
    if (!target) return;

    target.addEventListener("click", handleDocumentClick, true);
    connectedDocument = true;
  }

  function focusItem(listScope: string, itemKey: string) {
    focusedItem.value = { listScope, itemKey };
    selection.value = null;
  }

  function isFocused(listScope: string, itemKey: string) {
    return focusedItem.value?.listScope === listScope && focusedItem.value.itemKey === itemKey;
  }

  function isSelected(listScope: string, itemKey: string) {
    return (
      selection.value?.listScope === listScope && selection.value.selectedItemKeys.includes(itemKey)
    );
  }

  function getSelectedItemKeys(listScope: string, visibleItemKeys: readonly string[]) {
    if (selection.value?.listScope !== listScope) return [];
    const selected = new Set(selection.value.selectedItemKeys);
    return visibleItemKeys.filter((itemKey) => selected.has(itemKey));
  }

  function selectItem(
    listScope: string,
    itemKey: string,
    visibleItemKeys: readonly string[],
    modifiers: ItemSelectionModifiers = { ctrlKey: false, shiftKey: false },
  ) {
    if (!visibleItemKeys.includes(itemKey)) return [];

    focusedItem.value = { listScope, itemKey };
    const previous = selection.value?.listScope === listScope ? selection.value : null;
    const selected = new Set(previous?.selectedItemKeys ?? []);

    if (modifiers.shiftKey) {
      const anchorItemKey =
        previous?.anchorItemKey && visibleItemKeys.includes(previous.anchorItemKey)
          ? previous.anchorItemKey
          : itemKey;
      const anchorIndex = visibleItemKeys.indexOf(anchorItemKey);
      const targetIndex = visibleItemKeys.indexOf(itemKey);
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const range = visibleItemKeys.slice(start, end + 1);
      const nextSelection = modifiers.ctrlKey ? new Set([...selected, ...range]) : new Set(range);
      selection.value = { listScope, selectedItemKeys: [...nextSelection], anchorItemKey };
    } else if (modifiers.ctrlKey) {
      if (selected.has(itemKey)) selected.delete(itemKey);
      else selected.add(itemKey);
      selection.value = {
        listScope,
        selectedItemKeys: [...selected],
        anchorItemKey: previous?.anchorItemKey ?? itemKey,
      };
    } else {
      selection.value = { listScope, selectedItemKeys: [itemKey], anchorItemKey: itemKey };
    }

    return getSelectedItemKeys(listScope, visibleItemKeys);
  }

  function contextMenuTargets(
    listScope: string,
    itemKey: string,
    visibleItemKeys: readonly string[],
  ) {
    if (!visibleItemKeys.includes(itemKey)) return [];

    focusedItem.value = { listScope, itemKey };
    const previous = selection.value?.listScope === listScope ? selection.value : null;
    const previousSelected = new Set(previous?.selectedItemKeys ?? []);
    const selectedItemKeys = previousSelected.has(itemKey)
      ? getSelectedItemKeys(listScope, visibleItemKeys)
      : [itemKey];

    selection.value = {
      listScope,
      selectedItemKeys,
      anchorItemKey: previousSelected.has(itemKey) ? (previous?.anchorItemKey ?? itemKey) : itemKey,
    };
    return selectedItemKeys;
  }

  function syncVisibleItems(listScope: string, visibleItemKeys: readonly string[]) {
    const visible = new Set(visibleItemKeys);
    if (focusedItem.value?.listScope === listScope && !visible.has(focusedItem.value.itemKey)) {
      focusedItem.value = null;
    }

    const currentSelection = selection.value;
    if (currentSelection?.listScope !== listScope) return;

    const selectedItemKeys = currentSelection.selectedItemKeys.filter((itemKey) =>
      visible.has(itemKey),
    );
    const anchorItemKey =
      currentSelection.anchorItemKey && visible.has(currentSelection.anchorItemKey)
        ? currentSelection.anchorItemKey
        : null;
    if (
      selectedItemKeys.length === currentSelection.selectedItemKeys.length &&
      anchorItemKey === currentSelection.anchorItemKey
    ) {
      return;
    }
    selection.value =
      selectedItemKeys.length === 0 && anchorItemKey === null
        ? null
        : { listScope, selectedItemKeys, anchorItemKey };
  }

  function registerList(listScope: string) {
    mountedLists.set(listScope, (mountedLists.get(listScope) ?? 0) + 1);
  }

  function unregisterList(listScope: string) {
    const mountedCount = mountedLists.get(listScope) ?? 0;
    if (mountedCount > 1) {
      mountedLists.set(listScope, mountedCount - 1);
      return;
    }
    mountedLists.delete(listScope);
    if (focusedItem.value?.listScope === listScope) focusedItem.value = null;
    if (selection.value?.listScope === listScope) selection.value = null;
  }

  return {
    focusedItem,
    selection,
    clear,
    connectDocument,
    focusItem,
    isFocused,
    isSelected,
    getSelectedItemKeys,
    selectItem,
    contextMenuTargets,
    syncVisibleItems,
    registerList,
    unregisterList,
  };
}

export const itemSelection = createItemSelection();

export function useItemSelection(listScope: MaybeRefOrGetter<string>) {
  const currentListScope = computed(() => toValue(listScope));
  itemSelection.connectDocument();
  itemSelection.registerList(currentListScope.value);

  const stopWatchingScope = watch(currentListScope, (nextScope, previousScope) => {
    itemSelection.unregisterList(previousScope);
    itemSelection.registerList(nextScope);
  });

  onUnmounted(() => {
    stopWatchingScope();
    itemSelection.unregisterList(currentListScope.value);
  });

  return {
    isFocused: (itemKey: string) => itemSelection.isFocused(currentListScope.value, itemKey),
    isSelected: (itemKey: string) => itemSelection.isSelected(currentListScope.value, itemKey),
    focusItem: (itemKey: string) => itemSelection.focusItem(currentListScope.value, itemKey),
    selectItem: (
      itemKey: string,
      visibleItemKeys: readonly string[],
      modifiers: ItemSelectionModifiers,
    ) => itemSelection.selectItem(currentListScope.value, itemKey, visibleItemKeys, modifiers),
    contextMenuTargets: (itemKey: string, visibleItemKeys: readonly string[]) =>
      itemSelection.contextMenuTargets(currentListScope.value, itemKey, visibleItemKeys),
    getSelectedItemKeys: (visibleItemKeys: readonly string[]) =>
      itemSelection.getSelectedItemKeys(currentListScope.value, visibleItemKeys),
    syncVisibleItems: (visibleItemKeys: readonly string[]) =>
      itemSelection.syncVisibleItems(currentListScope.value, visibleItemKeys),
  };
}
