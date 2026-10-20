import { t } from "@/shared/i18n/locale";

export const DEFAULT_ACCENT_COLOR = "#a6e3a1";

export const ACCENT_COLORS = [
  { value: DEFAULT_ACCENT_COLOR, light: "#40a02b", label: "绿" },
  { value: "#89b4fa", light: "#1e66f5", label: "蓝" },
  { value: "#cba6f7", light: "#8839ef", label: "紫" },
  { value: "#f5c2e7", light: "#ea76cb", label: "粉" },
  { value: "#fab387", light: "#fe640b", label: "橙" },
  { value: "#f9e2af", light: "#df8e1d", label: "黄" },
  { value: "#f38ba8", light: "#d20f39", label: "红" },
  { value: "#94e2d5", light: "#179299", label: "青" },
] as const;

export function normalizeAccentColor(value: string): string | null {
  const color = value.trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

function foreground(color: string): string {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function applyAccentColor(value: string) {
  const color = normalizeAccentColor(value);
  if (!color) throw new Error(t("主题色必须是有效的 #RRGGBB 颜色。"));
  const preset = ACCENT_COLORS.find((preset) => preset.value === color);
  const style = globalThis.document.documentElement.style;
  style.setProperty("--app-accent", preset ? `light-dark(${preset.light}, ${color})` : color);
  style.setProperty(
    "--app-on-accent",
    preset ? `light-dark(${foreground(preset.light)}, ${foreground(color)})` : foreground(color),
  );
}
