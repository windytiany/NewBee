import { expect, it } from "bun:test";

it("gives the truncated playlist heading enough line height for descenders", async () => {
  const source = await Bun.file("src/features/playlist/tracks/PlaylistBrowser.vue").text();
  const heading = source.match(/<h1\b[^>]*id="playlist-browser-heading"[^>]*>/)?.[0];
  const classes = heading?.match(/class="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
  expect(classes).toContain("truncate");
  expect(classes).toContain("leading-normal");
});
