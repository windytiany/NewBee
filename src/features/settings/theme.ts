export const THEMES = [
  { value: "spotify", label: "Spotify" },
  { value: "tokyoNight", label: "Tokyo Night · Night" },
  { value: "catppuccin", label: "Catppuccin · Mocha" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

export function applyTheme(theme: Theme) {
  globalThis.document.documentElement.dataset.theme = theme;
}
