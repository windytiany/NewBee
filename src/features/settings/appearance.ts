import { applyAccentColor } from "@/features/settings/accent";
import { applyReducedMotion } from "@/features/settings/motion";
import type { Settings } from "@/features/settings/types";

export function applyAppearance(settings: Pick<Settings, "accentColor" | "reducedMotion">) {
  applyAccentColor(settings.accentColor);
  applyReducedMotion(settings.reducedMotion);
}
