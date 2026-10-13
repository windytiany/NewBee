import { t } from "@/shared/i18n/locale";

import type { TrackDetails } from "@/features/tracks/types";

export function formatTrackDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatSampleRate(sampleRateHz: number | null) {
  if (sampleRateHz === null || !Number.isFinite(sampleRateHz)) {
    return null;
  }

  const sampleRateKHz = sampleRateHz / 1000;
  return `${Number.isInteger(sampleRateKHz) ? sampleRateKHz : Number(sampleRateKHz.toFixed(3))} kHz`;
}

function formatBitrate(bitrateKbps: number | null) {
  if (bitrateKbps === null || !Number.isFinite(bitrateKbps)) {
    return null;
  }

  return `${bitrateKbps}k`;
}

function formatChannels(channels: number | null) {
  if (channels === null || !Number.isFinite(channels)) {
    return null;
  }

  if (channels === 1) return t("单声道");
  if (channels === 2) return t("立体声");
  return t("{count} 声道", { count: channels });
}

export function formatAudioSummary(
  details: Pick<TrackDetails, "codec" | "sampleRateHz" | "bitrateKbps" | "channels" | "durationMs">,
) {
  const codecAndSampleRate = [details.codec, formatSampleRate(details.sampleRateHz)]
    .filter((value): value is string => value !== null && value !== "")
    .join(" ");
  const values = [
    codecAndSampleRate || null,
    formatBitrate(details.bitrateKbps),
    formatChannels(details.channels),
    formatTrackDuration(details.durationMs),
  ].filter((value): value is string => value !== null && value !== "");

  return values.length > 0 ? values.join(", ") : t("音频信息未知");
}
