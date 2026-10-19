import { describe, expect, it } from "bun:test";
import { parse } from "@vue/compiler-sfc";

const row = await Bun.file("src/features/playlist/list/PlaylistRow.vue").text();
const browser = await Bun.file("src/features/playlist/tracks/PlaylistBrowser.vue").text();

describe("playlist appearance", () => {
  it("shares the same theme-aware fallback artwork between the list and detail", async () => {
    for (const source of [row, browser]) {
      expect(source).toContain("<PlaylistPlaceholder");
      expect(source).toContain("@/features/playlist/artwork/PlaylistPlaceholder.vue");
      expect(source).not.toMatch(/from-violet|via-indigo|to-slate/);
    }
    const placeholder = await Bun.file(
      "src/features/playlist/artwork/PlaylistPlaceholder.vue",
    ).text();
    expect(placeholder).toContain("from-app-accent/30");
    expect(placeholder).toContain("via-app-accent/10");
    expect(placeholder).toContain("to-app-surface");
  });

  it("tints the playlist header with the current accent rather than fixed header colors", () => {
    const template = parse(browser).descriptor.template!.content;
    const header = template.match(/<header\b[^>]*>/)?.[0] ?? "";
    expect(header).toContain("from-app-accent/20");
    expect(header).toContain("via-app-accent/5");
    expect(header).toContain("to-app-base");
    expect(template).not.toContain("app-header");
  });
});
