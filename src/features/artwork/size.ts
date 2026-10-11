// Physical pixels. The backend accepts only these three persistent variants.
export const ARTWORK_SIZES = [128, 512, 2048] as const;
export type ArtworkSize = (typeof ARTWORK_SIZES)[number];

export function selectArtworkSize(pixels: number | null): ArtworkSize | 0 | null {
  if (pixels === null) return null;
  if (!Number.isFinite(pixels) || pixels <= 0) return 0;
  return ARTWORK_SIZES.find((size) => size >= pixels) ?? ARTWORK_SIZES[2];
}
