import { applyAccentColor } from "@/features/settings/appearance/accent";
import { applyLayoutDensity } from "@/features/settings/appearance/layout";
import { applyReducedMotion } from "@/features/settings/appearance/motion";
import type { Settings } from "@/features/settings/types";

export function applyAppearance(
  settings: Pick<Settings, "themeMode" | "accentColor" | "reducedMotion" | "layoutDensity">,
) {
  globalThis.document.documentElement.dataset.themeMode = settings.themeMode;
  applyAccentColor(settings.accentColor);
  applyReducedMotion(settings.reducedMotion);
  applyLayoutDensity(settings.layoutDensity);
}
