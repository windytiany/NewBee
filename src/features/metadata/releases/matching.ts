import { t } from "@/shared/i18n/locale";
import type { TrackDetails } from "@/features/library/types";
import { buildTagChanges, TAG_FIELDS } from "@/features/metadata/draft";
import type { EditableTrack, IdentifierField, TagChange } from "@/features/metadata/types";

import type {
  ReleaseTrack,
  ReleaseDetails,
  MatchRow,
  TrackPatch,
  AlbumField,
} from "@/features/metadata/releases/types";

export function releaseId(value: string): string | null {
  const trimmed = value.trim();
  const id = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  if (id.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new globalThis.URL(trimmed);
    if (url.hostname !== "musicbrainz.org" || !["https:", "http:"].includes(url.protocol))
      return null;
    const match = /^\/release\/([^/]+)\/?$/.exec(url.pathname);
    return match?.[1] && id.test(match[1]) ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}
const normalize = (value: string | null) =>
  (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
function similarity(source: ReleaseTrack, local: TrackDetails) {
  let score = 0;
  const title = normalize(source.title);
  const localTitle = normalize(local.title);
  if (title && localTitle) {
    if (title === localTitle) score += 100;
    else if (title.includes(localTitle) || localTitle.includes(title)) score += 35;
  }
  if (source.trackNumber === local.trackNumber) score += 20;
  if (source.discNumber === local.discNumber) score += 15;
  if (source.durationMs !== null && local.durationMs !== null) {
    const delta = Math.abs(source.durationMs - local.durationMs);
    score += Math.max(0, 30 - delta / 1000);
  }
  if (normalize(source.artist) && normalize(source.artist) === normalize(local.artist)) score += 5;
  return score;
}

export function createMatchRows(
  release: ReleaseDetails,
  locals: readonly EditableTrack[],
): MatchRow[] {
  const rows = release.tracks.map((source): MatchRow => ({
    source,
    trackId: null,
    identifiers: { ...release.identifiers, ...source.identifiers },
    values: {
      ...release.values,
      ...source.values,
      title: source.title || undefined,
      artist: source.artist || undefined,
      album: release.summary.title || undefined,
      albumArtist: release.summary.artist || undefined,
      releaseDate: release.summary.releaseDate || undefined,
      trackNumber: String(source.trackNumber),
      trackTotal: String(source.trackTotal),
      discNumber: String(source.discNumber),
      discTotal: String(release.summary.discCount),
    },
  }));
  const pairs = release.tracks
    .flatMap((source, row) =>
      locals.map(({ track }, index) => ({
        row,
        index,
        score: similarity(source, track),
      })),
    )
    .sort((a, b) => b.score - a.score || a.row - b.row || a.index - b.index);
  const assigned = new Set<number>();
  for (const pair of pairs) {
    const row = rows[pair.row];
    const local = locals[pair.index];
    if (!row || !local || row.trackId !== null || assigned.has(local.track.id)) continue;
    row.trackId = local.track.id;
    assigned.add(local.track.id);
  }
  for (const { track } of locals) {
    if (!assigned.has(track.id)) rows.push({ source: null, trackId: track.id, values: {} });
  }
  return rows;
}

/** Move a local file between rows; a null target leaves its source side blank. */
export function assignTrack(rows: MatchRow[], trackId: number, target: number | null) {
  const previous = rows.find((row) => row.trackId === trackId);
  if (!previous) return;
  if (target === null) {
    if (previous.source === null) return;
    previous.trackId = null;
    rows.splice(rows.indexOf(previous) + 1, 0, { source: null, trackId, values: {} });
    return;
  }
  const next = rows[target];
  if (!next || previous === next) return;
  previous.trackId = next.trackId;
  next.trackId = trackId;
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index]?.source === null && rows[index]?.trackId === null) rows.splice(index, 1);
  }
}

export function buildAlbumPatches(
  rows: readonly MatchRow[],
  tracks: readonly EditableTrack[],
  fields: readonly AlbumField[],
  included: readonly number[],
  writeCover: boolean,
): TrackPatch[] {
  const patches: TrackPatch[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.source === null || row.trackId === null || !included.includes(row.trackId)) continue;
    if (seen.has(row.trackId)) throw new Error(t("同一本地曲目不能重复对应。"));
    seen.add(row.trackId);
    const local = tracks.find(({ track }) => track.id === row.trackId);
    if (!local) throw new Error(t("对应的本地曲目不存在。"));
    const changed = TAG_FIELDS.flatMap((field) => {
      const value = row.values[field.key];
      if (!fields.includes(field.key) || value === undefined || !value.trim()) return [];
      const original = String({ ...local.track, ...local.values }[field.key] ?? "");
      if (value.trim() === original.trim()) return [];
      return [{ ...field, value, mixed: false, writable: true }];
    });
    const changes: TagChange[] = changed.length ? buildTagChanges(changed, [local]) : [];
    for (const [field, values] of Object.entries(row.identifiers ?? {})) {
      const valid = values?.map((value) => value.trim()).filter(Boolean) ?? [];
      if (valid.length)
        changes.push({ field: field as IdentifierField, value: null, values: valid });
    }
    if (changes.length || writeCover) patches.push({ trackId: row.trackId, changes, writeCover });
  }
  return patches;
}
