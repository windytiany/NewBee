export function movePlaylistItemsBefore(
  currentItemIds: readonly number[],
  movingItemIds: readonly number[],
  beforeItemId: number | null,
): number[] {
  const movingIds = new Set(movingItemIds);
  const moving = currentItemIds.filter((itemId) => movingIds.has(itemId));
  const remaining = currentItemIds.filter((itemId) => !movingIds.has(itemId));

  if (beforeItemId === null) return [...remaining, ...moving];

  const insertionIndex = remaining.indexOf(beforeItemId);
  if (insertionIndex < 0) {
    throw new Error("beforeItemId must identify an item remaining after the move.");
  }

  return [...remaining.slice(0, insertionIndex), ...moving, ...remaining.slice(insertionIndex)];
}
