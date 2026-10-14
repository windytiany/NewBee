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
        entry.picture.source === "embedded"
          ? { ...entry.picture, data: [...entry.picture.data] }
          : { ...entry.picture },
    })),
  };
}

function fallback(pictures: readonly DraftPicture[]): string | null {
  return pictures[0]?.key ?? null;
}

export function createCollectionDraft(
  trackIds: readonly number[],
  collections: readonly ArtworkCollection[],
): CollectionDraft {
  const ids = [...new Set(trackIds)];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("无效的曲目 ID");
  if (collections.some(({ trackId }) => !ids.includes(trackId)))
    throw new Error("返回的图片集合与编辑目标不匹配");
  const typedContents = new Set<string>();
  for (const collection of collections) {
    const seen = new Set<string>();
    for (const picture of collection.pictures) {
      if (picture.source !== "embedded") continue;
      if (seen.has(picture.contentId)) typedContents.add(picture.contentId);
      seen.add(picture.contentId);
    }
  }
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
        if (collection.error !== null && typeof collection.error !== "string")
          throw new Error("无效的图片集合错误");
        for (const picture of collection.pictures) {
          if (
            !Number.isSafeInteger(picture.artworkId) ||
            picture.artworkId <= 0 ||
            !Number.isInteger(picture.pictureType) ||
            picture.pictureType < 0 ||
            picture.pictureType > 255 ||
            !["embedded", "directory", "manual"].includes(picture.source) ||
            typeof picture.contentId !== "string" ||
            !picture.contentId ||
            typeof picture.mimeType !== "string" ||
            !picture.mimeType ||
            !Number.isSafeInteger(picture.byteLength) ||
            picture.byteLength <= 0 ||
            typeof picture.path !== "string" ||
            (picture.source !== "embedded" && !picture.path) ||
            (picture.error !== null && typeof picture.error !== "string")
          )
            throw new Error("无效的图片集合");
          if (
            track.pictures.some(
              (entry) =>
                entry.picture.source === "existing" &&
                entry.picture.artworkId === picture.artworkId,
            )
          )
            throw new Error("图片集合重复");
          const storage = picture.source === "embedded" ? "embedded" : "linked";
          const identity =
            storage === "embedded"
              ? typedContents.has(picture.contentId)
                ? `embedded:${picture.contentId}:${picture.pictureType}`
                : picture.contentId
              : `linked:${normalizePath(picture.path)}`;
          if (track.pictures.some((entry) => entry.key === identity))
            throw new Error("图片集合重复");
          track.pictures.push({
            key: identity,
            contentId: picture.contentId,
            mimeType: picture.mimeType,
            byteLength: picture.byteLength,
            storage,
            path: picture.path,
            error: picture.error,
            picture: {
              source: "existing",
              artworkId: picture.artworkId,
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
        contentId: entry.contentId,
        storage: entry.storage,
        path: entry.path,
        error: entry.error,
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
  for (const track of draft.tracks) {
    const selected = track.pictures.find((entry) => entry.key === key);
    if (
      selected?.storage === "embedded" &&
      track.pictures.some(
        (entry) =>
          entry.key !== key &&
          entry.storage === "embedded" &&
          entry.contentId === selected.contentId &&
          entry.picture.pictureType === pictureType,
      )
    )
      throw new Error("相同内容和类型的内嵌图片已存在");
  }
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

export function normalizePath(path: string): string {
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
  const value = path.replace(/\\/g, "/");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === ".") continue;
    if (part === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(part);
  }
  const normalized = parts.join("/");
  return windows ? normalized.toLowerCase() : normalized;
}

export async function addPicture(
  draft: CollectionDraft,
  data: Uint8Array,
  mimeType: string,
  readPicture: (artworkId: number) => Promise<ArrayBuffer>,
  pictureType = 3,
  path?: string,
): Promise<string> {
  requireReady(draft);
  validateType(pictureType);
  if (!data.byteLength || !mimeType) throw new Error("图片内容为空");
  const bytes = Uint8Array.from(data);
  const digest = await hash(bytes);
  const storage = path === undefined ? "embedded" : "linked";
  if (path !== undefined && !path.trim()) throw new Error("图片路径为空");
  const hashes = new Map<number, string>();
  if (storage === "embedded") {
    const originals = draft.tracks.flatMap((track) => [
      ...track.original.pictures,
      ...track.pictures,
    ]);
    for (const entry of originals) {
      if (entry.storage !== "embedded" || entry.picture.source !== "existing") continue;
      const id = entry.picture.artworkId;
      if (!hashes.has(id)) hashes.set(id, await hash(new Uint8Array(await readPicture(id))));
    }
  }
  requireReady(draft);
  const key =
    storage === "linked"
      ? `linked:${normalizePath(path ?? "")}`
      : `embedded:${digest}:${pictureType}`;
  for (const track of draft.tracks) {
    const matches = (entry: DraftPicture) =>
      storage === "linked"
        ? entry.storage === "linked" && normalizePath(entry.path) === normalizePath(path ?? "")
        : entry.storage === "embedded" &&
          entry.picture.pictureType === pictureType &&
          (entry.picture.source === "existing"
            ? hashes.get(entry.picture.artworkId) === digest
            : entry.picture.source === "embedded" &&
              entry.picture.data.length === bytes.length &&
              entry.picture.data.every((byte, index) => byte === bytes[index]));
    const current = track.pictures.find(matches);
    if (current) {
      const previous = current.key;
      current.key = key;
      if (track.displayKey === previous) track.displayKey = key;
      for (const entry of track.original.pictures) if (entry.key === previous) entry.key = key;
      if (track.original.displayKey === previous) track.original.displayKey = key;
      continue;
    }
    const original = track.original.pictures.find(matches);
    track.pictures.push(
      original
        ? { ...original, key, picture: { ...original.picture } }
        : {
            key,
            contentId: digest,
            mimeType,
            byteLength: bytes.length,
            storage,
            path: path ?? "",
            error: null,
            picture:
              path === undefined
                ? { source: "embedded", data: Array.from(bytes), pictureType }
                : { source: "linked", path, pictureType },
          },
    );
    if (track.displayKey === null) track.displayKey = key;
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

export function serializeCollections(draft: CollectionDraft): ArtworkDraft[] {
  return draft.tracks.flatMap((track) => {
    if (track.error !== null || !collectionChanged(track)) return [];
    return [
      {
        trackId: track.trackId,
        pictures: track.pictures.map(({ picture }) =>
          picture.source === "embedded" ? { ...picture, data: [...picture.data] } : { ...picture },
        ),
        displayIndex:
          track.displayKey === null
            ? null
            : track.pictures.findIndex(({ key }) => key === track.displayKey),
      },
    ];
  });
}

export function acceptCollectionChanges(draft: CollectionDraft, trackIds: readonly number[]) {
  for (const track of draft.tracks) {
    if (track.error !== null || !trackIds.includes(track.trackId)) continue;
    track.original = copySnapshot(track);
  }
}
