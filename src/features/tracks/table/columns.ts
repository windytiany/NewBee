import type { TrackSummary } from "@/features/tracks/types";
import type { TableColumn } from "@/shared/interaction/table/useTable";
import { t } from "@/shared/i18n/locale";

export function trackColumns(extra: readonly TableColumn[] = []): TableColumn[] {
  return [
    { key: "number", label: "#", width: "2rem", mobileWidth: "1.5rem", right: true },
    { key: "title", label: t("歌曲"), width: "minmax(0,1.5fr)", mobileWidth: "minmax(0,1fr)" },
    { key: "album", label: t("专辑"), width: "minmax(0,1fr)", desktopOnly: true },
    ...extra,
    { key: "durationMs", label: t("时长"), width: "3rem", right: true },
  ];
}

export function trackColumnValue(
  track: Pick<TrackSummary, "title" | "album" | "durationMs">,
  key: string,
  index: number,
) {
  if (key === "number") return index;
  if (key === "title") return track.title;
  if (key === "album") return track.album;
  if (key === "durationMs") return track.durationMs;
  return undefined;
}
