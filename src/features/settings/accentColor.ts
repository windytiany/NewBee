export const DEFAULT_ACCENT_COLOR = "#1ed760";

export const ACCENT_COLORS = [
  { value: DEFAULT_ACCENT_COLOR, label: "绿" },
  { value: "#60a5fa", label: "蓝" },
  { value: "#a78bfa", label: "紫" },
  { value: "#f472b6", label: "粉" },
  { value: "#fb923c", label: "橙" },
] as const;

export function normalizeAccentColor(value: string): string | null {
  const color = value.trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

export function applyAccentColor(value: string) {
  const color = normalizeAccentColor(value);
  if (!color) throw new Error("主题色必须是有效的 #RRGGBB 颜色。");
  globalThis.document.documentElement.style.setProperty("--app-accent", color);
}
