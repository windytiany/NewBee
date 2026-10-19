import { applyAccentColor } from "@/features/settings/accent";
import { applyLayoutDensity } from "@/features/settings/layout";
import { applyReducedMotion } from "@/features/settings/motion";
import type { Settings } from "@/features/settings/types";

export function applyAppearance(
  settings: Pick<Settings, "themeMode" | "accentColor" | "reducedMotion" | "layoutDensity">,
) {
  globalThis.document.documentElement.dataset.themeMode = settings.themeMode;
  applyAccentColor(settings.accentColor);
  applyReducedMotion(settings.reducedMotion);
  applyLayoutDensity(settings.layoutDensity);
}
