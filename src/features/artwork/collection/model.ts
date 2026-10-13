import type {
  ArtworkCollection,
  ArtworkDraft,
  CollectionDraft,
  CollectionSnapshot,
  CollectionTrack,
  CommonPicture,
  DisplaySelection,
  DraftPicture,
} from "@/features/artwork/collection/types";

function validateType(pictureType: number) {
  if (!Number.isInteger(pictureType) || pictureType < 0 || pictureType > 20)
    throw new Error("无效的图片类型");
}

function copySnapshot(snapshot: CollectionSnapshot): CollectionSnapshot {
  return {
    displayKey: snapshot.displayKey,
    pictures: snapshot.pictures.map((entry) => ({
      ...entry,
      picture:
        entry.picture.source === "new"
          ? { ...entry.picture, data: [...entry.picture.data] }
          : { ...entry.picture },
    })),
  };
}

function fallback(pictures: readonly DraftPicture[]): string | null {
  return (
    pictures.find(({ picture, embedded }) => picture.pictureType === 3 && embedded)?.key ??
    pictures.find(({ picture }) => picture.pictureType === 3)?.key ??
    pictures.find(({ embedded }) => embedded)?.key ??
    pictures[0]?.key ??
    null
  );
}

export function createCollectionDraft(
  trackIds: readonly number[],
  collections: readonly ArtworkCollection[],
): CollectionDraft {
  const ids = [...new Set(trackIds)];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("无效的曲目 ID");
  if (collections.some(({ trackId }) => !ids.includes(trackId)))
    throw new Error("返回的图片集合与编辑目标不匹配");
  return {
    tracks: ids.map((trackId) => {
      const matches = collections.filter((entry) => entry.trackId === trackId);
      const collection = matches[0];
      const track: CollectionTrack = {
        trackId,
        pictures: [],
        displayKey: null,
        error: collection?.error ?? null,
        original: { pictures: [], displayKey: null },
      };
      try {
        if (matches.length !== 1 || !collection) throw new Error("图片集合缺失或重复");
        const seen = new Set<string>();
        for (const picture of collection.pictures) {
          if (
            !Number.isInteger(picture.pictureType) ||
            picture.pictureType < 0 ||
            picture.pictureType > 255
          )
            throw new Error("无效的图片类型");
          if (
            !picture.contentId ||
            seen.has(picture.contentId) ||
            !picture.mimeType ||
            !Number.isSafeInteger(picture.byteLength) ||
            picture.byteLength <= 0 ||
            typeof picture.embedded !== "boolean"
          )
            throw new Error("无效的图片集合");
          seen.add(picture.contentId);
          track.pictures.push({
            key: picture.contentId,
            mimeType: picture.mimeType,
            byteLength: picture.byteLength,
            embedded: picture.embedded,
            picture: {
              source: "existing",
              contentId: picture.contentId,
              pictureType: picture.pictureType,
            },
          });
        }
        const index = collection.displayIndex;
        if (
          index !== null &&
          (!Number.isInteger(index) || index < 0 || index >= track.pictures.length)
        )
          throw new Error("无效的展示图片索引");
        track.displayKey =
          index === null ? fallback(track.pictures) : (track.pictures[index]?.key ?? null);
      } catch (error) {
        track.error = error instanceof Error ? error.message : String(error);
      }
      track.original = copySnapshot(track);
      return track;
    }),
  };
}

function requireReady(draft: CollectionDraft) {
  if (!draft.tracks.length || draft.tracks.some(({ error }) => error !== null))
    throw new Error("图片集合尚未成功加载");
}

export function commonPictures(draft: CollectionDraft): CommonPicture[] {
  if (!draft.tracks.length || draft.tracks.some(({ error }) => error !== null)) return [];
  return (draft.tracks[0]?.pictures ?? []).flatMap((entry) => {
    const matches = draft.tracks.map((track) =>
      track.pictures.find(({ key }) => key === entry.key),
    );
    if (matches.some((match) => !match)) return [];
    const type = entry.picture.pictureType;
    const mixed = matches.some((match) => match?.picture.pictureType !== type);
    return [
      {
        key: entry.key,
        mimeType: entry.mimeType,
        byteLength: entry.byteLength,
        pictureType: mixed ? null : type,
        mixed,
      },
    ];
  });
}

export function displaySelection(draft: CollectionDraft): DisplaySelection {
  if (draft.tracks.some(({ error }) => error !== null)) return { mixed: true, picture: null };
  const first = draft.tracks[0];
  const key = first?.displayKey ?? null;
  if (draft.tracks.some(({ displayKey }) => displayKey !== key))
    return { mixed: true, picture: null };
  return { mixed: false, picture: first?.pictures.find((entry) => entry.key === key) ?? null };
}

function requireCommon(draft: CollectionDraft, key: string) {
  requireReady(draft);
  if (!commonPictures(draft).some((entry) => entry.key === key))
    throw new Error("图片不是所有曲目共有的图片");
}

export function changePictureType(draft: CollectionDraft, key: string, pictureType: number) {
  requireCommon(draft, key);
  validateType(pictureType);
  for (const track of draft.tracks)
    for (const entry of track.pictures)
      if (entry.key === key) entry.picture.pictureType = pictureType;
}

export function deletePicture(draft: CollectionDraft, key: string) {
  requireCommon(draft, key);
  for (const track of draft.tracks) {
    track.pictures = track.pictures.filter((entry) => entry.key !== key);
    if (track.displayKey === key) track.displayKey = fallback(track.pictures);
  }
}

export function setDisplayPicture(draft: CollectionDraft, key: string) {
  requireCommon(draft, key);
  for (const track of draft.tracks) track.displayKey = key;
}

async function hash(data: Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read originals only on import, so descriptors and ordinary editing stay lazy. */
export async function addPicture(
  draft: CollectionDraft,
  data: Uint8Array,
  mimeType: string,
  readContent: (contentId: string) => Promise<ArrayBuffer>,
  pictureType = 3,
): Promise<string> {
  requireReady(draft);
  validateType(pictureType);
  if (!data.byteLength || !mimeType) throw new Error("图片内容为空");
  const bytes = Uint8Array.from(data);
  const digest = await hash(bytes);
  const existing = new Map<string, string>();
  const contentIds = new Set(
    draft.tracks.flatMap((track) =>
      [...track.original.pictures, ...track.pictures].flatMap(({ picture }) =>
        picture.source === "existing" ? [picture.contentId] : [],
      ),
    ),
  );
  await Promise.all(
    [...contentIds].map(async (contentId) => {
      existing.set(contentId, await hash(new Uint8Array(await readContent(contentId))));
    }),
  );
  const matchingId = [...contentIds].find((id) => existing.get(id) === digest);
  const key = matchingId ?? `new:${digest}`;
  requireReady(draft);
  for (const track of draft.tracks) {
    const current = track.pictures.find((entry) => entry.key === key);
    if (current) continue;
    const original = track.original.pictures.find(
      ({ picture }) => picture.source === "existing" && existing.get(picture.contentId) === digest,
    );
    const contentMatch = track.pictures.find(({ picture }) =>
      picture.source === "existing"
        ? existing.get(picture.contentId) === digest
        : picture.data.length === bytes.length &&
          picture.data.every((byte, index) => byte === bytes[index]),
    );
    if (contentMatch) {
      const previousKey = contentMatch.key;
      contentMatch.key = key;
      if (track.displayKey === previousKey) track.displayKey = key;
      for (const entry of track.original.pictures) if (entry.key === previousKey) entry.key = key;
      if (track.original.displayKey === previousKey) track.original.displayKey = key;
      continue;
    }
    track.pictures.push(
      original
        ? { ...original, key, picture: { ...original.picture, pictureType } }
        : {
            key,
            mimeType,
            byteLength: bytes.length,
            embedded: false,
            picture: { source: "new", data: Array.from(bytes), pictureType },
          },
    );
    if (track.displayKey === null) track.displayKey = fallback(track.pictures);
  }
  return key;
}

export function collectionChanged(track: CollectionTrack): boolean {
  if (track.error !== null) return false;
  return (
    track.displayKey !== track.original.displayKey ||
    track.pictures.length !== track.original.pictures.length ||
    track.pictures.some((entry, index) => {
      const original = track.original.pictures[index];
      return (
        entry.key !== original?.key || entry.picture.pictureType !== original.picture.pictureType
      );
    })
  );
}

export function serializeCollections(draft: CollectionDraft, embedArtwork = false): ArtworkDraft[] {
  return draft.tracks.flatMap((track) => {
    if (track.error !== null || (!embedArtwork && !collectionChanged(track))) return [];
    return [
      {
        trackId: track.trackId,
        pictures: track.pictures.map(({ picture }) =>
          picture.source === "new" ? { ...picture, data: [...picture.data] } : { ...picture },
        ),
        displayIndex:
          track.displayKey === null
            ? null
            : track.pictures.findIndex(({ key }) => key === track.displayKey),
      },
    ];
  });
}

export function acceptCollectionChanges(
  draft: CollectionDraft,
  trackIds: readonly number[],
  embedded = false,
) {
  for (const track of draft.tracks) {
    if (track.error !== null || !trackIds.includes(track.trackId)) continue;
    if (embedded) for (const entry of track.pictures) entry.embedded = true;
    track.original = copySnapshot(track);
  }
}
