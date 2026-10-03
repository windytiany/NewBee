import type { TrackDetails } from "@/library/model";

export const METADATA_FIELDS = [
  { key: "title", label: "标题", type: "text" },
  { key: "artist", label: "艺术家", type: "text" },
  { key: "albumArtist", label: "专辑艺术家", type: "text" },
  { key: "album", label: "专辑", type: "text" },
  { key: "releaseDate", label: "发行日期", type: "date" },
  { key: "trackNumber", label: "曲号", type: "number" },
  { key: "trackTotal", label: "总曲数", type: "number" },
  { key: "discNumber", label: "碟号", type: "number" },
  { key: "discTotal", label: "总碟数", type: "number" },
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number]["key"];
export type EditMode = "tracks" | "album";
export type EditableTrack = {
  track: TrackDetails;
  writableFields: MetadataField[];
  issue: string | null;
};
export type MetadataChange = { field: MetadataField; value: string | null };
export type MetadataSaveResult = {
  trackId: number;
  path: string;
  fileWritten: boolean;
  databaseUpdated: boolean;
  error: string | null;
};
export type DraftField = {
  key: MetadataField;
  label: string;
  type: "text" | "date" | "number";
  value: string;
  mixed: boolean;
  writable: boolean;
};

export function createMetadataDraft(
  tracks: readonly EditableTrack[],
  mode: EditMode,
): DraftField[] {
  return METADATA_FIELDS.flatMap((field) => {
    if (mode === "album" && ["title", "trackNumber", "discNumber"].includes(field.key)) return [];
    const values = tracks.map(({ track }) => String(track[field.key] ?? ""));
    const mixed = values.some((value) => value !== values[0]);
    return [
      {
        ...field,
        value: mixed ? "" : (values[0] ?? ""),
        mixed,
        writable:
          tracks.length > 0 && tracks.every((track) => track.writableFields.includes(field.key)),
      },
    ];
  });
}

function validDate(value: string) {
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false;
  const parts = value.split("-").map(Number);
  const year = parts[0];
  if (year === undefined || year === 0) return false;
  const month = parts[1];
  if (month === undefined) return true;
  if (month < 1 || month > 12) return false;
  const day = parts[2];
  if (day === undefined) return true;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  let days = 31;
  if (month === 2) days = leap ? 29 : 28;
  else if ([4, 6, 9, 11].includes(month)) days = 30;
  return day >= 1 && day <= days;
}

export function buildMetadataChanges(
  draft: readonly DraftField[],
  tracks: readonly EditableTrack[] = [],
): MetadataChange[] {
  const changes = draft.flatMap((field) => {
    if (!field.writable || field.mixed) return [];
    let value = field.value.trim();
    if (value && field.type === "number") {
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > 4_294_967_295
      ) {
        throw new Error(`${field.label}必须是有效的正整数或留空。`);
      }
      value = String(Number(value));
    }
    if (value && field.type === "date" && !validDate(value)) {
      throw new Error("发行日期必须是有效的 YYYY、YYYY-MM 或 YYYY-MM-DD。");
    }
    if (value.includes("\0")) throw new Error(`${field.label}不能包含空字符。`);
    return [{ field: field.key, value: value || null }];
  });
  if (changes.length === 0) throw new Error("没有可写入的字段。");
  for (const { track } of tracks) validateNumberTotals(track, changes);
  return changes;
}

function validateNumberTotals(track: TrackDetails, changes: readonly MetadataChange[]) {
  const updates = new Map(changes.map(({ field, value }) => [field, value]));
  const pairs = [
    ["trackNumber", "trackTotal"],
    ["discNumber", "discTotal"],
  ] as const;
  for (const [numberField, totalField] of pairs) {
    if (!updates.has(numberField) && !updates.has(totalField)) continue;
    let number = track[numberField] ?? 0;
    let total = track[totalField] ?? 0;
    if (updates.has(numberField)) number = Number(updates.get(numberField));
    if (updates.has(totalField)) total = Number(updates.get(totalField));
    if (total > 0 && number > total) throw new Error("编号不能大于对应总数。");
  }
}
