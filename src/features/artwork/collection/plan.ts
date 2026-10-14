import type { ArtworkDraft, ArtworkWritePlan } from "@/features/artwork/collection/types";

export async function planCollectionWrites(
  drafts: ArtworkDraft[],
  readPlan: (drafts: ArtworkDraft[]) => Promise<ArtworkWritePlan[]>,
): Promise<ArtworkWritePlan[]> {
  const plan = await readPlan(drafts);
  return drafts.map(({ trackId }) => {
    const matches = plan.filter((entry) => entry.trackId === trackId);
    const entry = matches[0];
    if (
      matches.length !== 1 ||
      !entry ||
      typeof entry.fileWriteRequired !== "boolean" ||
      (entry.error !== null && typeof entry.error !== "string")
    )
      return { trackId, fileWriteRequired: false, error: "图片写入计划无效" };
    return entry;
  });
}
