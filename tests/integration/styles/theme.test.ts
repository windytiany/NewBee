import { describe, expect, it } from "bun:test";
import { createAlbumBackgroundPixels } from "@/features/artwork/background";

const css = await Bun.file(new URL("../../../src/app/styles/themes.css", import.meta.url)).text();

function declarations(selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing theme selector: ${selector}`);
  return Object.fromEntries(
    [
      ...css
        .slice(start + selector.length + 2)
        .split("}")[0]!
        .matchAll(/([\w-]+):\s*([^;]+);/g),
    ].map(([, property, value]) => [
      property,
      value!.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim(),
    ]),
  );
}

describe("theme palettes", () => {
  it("follows the system without an explicit preference and excludes fixed modes", () => {
    expect(css).toContain("@media (prefers-color-scheme: light)");
    const system = declarations(
      ':root:not([data-theme-mode="dark"]):not([data-theme-mode="light"])',
    );
    const light = declarations(':root[data-theme-mode="light"]');
    expect(system).toEqual(light);
    expect(light["color-scheme"]).toBe("light");
    expect(light["--app-base"]).toBe("#f5f5f5");
    expect(light["--app-text"]).toBe("#171717");
    expect(light["--app-select-arrow"]).toContain("%23171717");
  });

  it("retains visible cover variation through the light overlay", () => {
    const light = declarations(':root[data-theme-mode="light"]');
    const mix = Number.parseFloat(light["--app-cover-mix"]!) / 100;
    const sample = (value: number) =>
      createAlbumBackgroundPixels(new Uint8ClampedArray([value, value, value, 255]), 1, 1)
        .pixels[0]!;
    expect((sample(255) - sample(0)) * (1 - mix)).toBeGreaterThan(80);
  });

  it("keeps cover text readable over the darkest light and brightest dark backgrounds", () => {
    const luminance = (channel: number) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const contrast = (a: number, b: number) =>
      (luminance(Math.max(a, b)) + 0.05) / (luminance(Math.min(a, b)) + 0.05);
    const light = declarations(':root[data-theme-mode="light"]');
    const dark = declarations(":root");
    const lightMix = Number.parseFloat(light["--app-cover-mix"]!) / 100;
    const darkMix = Number.parseFloat(dark["--app-cover-mix"]!) / 100;
    const lightBase = Number.parseInt(light["--app-base"]!.slice(1, 3), 16);
    const lightMuted = Number.parseInt(light["--app-cover-muted"]!.slice(1, 3), 16);
    const darkMuted = Number.parseInt(dark["--app-cover-muted"]!.slice(1, 3), 16);
    expect(contrast(lightBase * lightMix, lightMuted)).toBeGreaterThan(4.5);
    expect(contrast(255 * (1 - darkMix), darkMuted)).toBeGreaterThan(4.5);
  });

  it("softens cover backgrounds in light mode while preserving the dark rendering", () => {
    const dark = declarations(":root");
    const light = declarations(':root[data-theme-mode="light"]');
    expect(dark["--app-cover-overlay"]).toBe("rgb(0 0 0 / 60%)");
    expect(dark["--app-cover-tint"]).toBe("#000000");
    expect(dark["--app-cover-mix"]).toBe("60%");
    expect(dark["--app-cover-muted"]).toBe("#e5e7eb");
    expect(light["--app-cover-overlay"]).toBe(
      "color-mix(in srgb, var(--app-cover-tint) var(--app-cover-mix), transparent)",
    );
    expect(light["--app-cover-tint"]).toBe("var(--app-base)");
    expect(light["--app-cover-mix"]).toBe("60%");
    expect(light["--app-cover-muted"]).toBe("#242424");
  });

  it("retains the dark palette and supplies all corresponding light colors", () => {
    const dark = declarations(":root");
    const light = declarations(':root[data-theme-mode="light"]');
    expect(dark["color-scheme"]).toBe("dark");
    expect(dark["--app-base"]).toBe("#121212");
    expect(dark["--app-text"]).toBe("#ffffff");
    for (const key of Object.keys(dark)) {
      if (!key.startsWith("--app-") || key === "--app-accent") continue;
      expect(light[key]).toBeDefined();
      if (key !== "--app-cover-mix") expect(light[key]).not.toBe(dark[key]);
    }
  });
});
