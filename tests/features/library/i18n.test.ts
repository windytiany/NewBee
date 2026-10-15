import { afterEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Vue from "vue";
import * as ts from "typescript";
import { compileScript, parse } from "@vue/compiler-sfc";
import { libraryMessages } from "@/shared/i18n/messages/library";
import { setLocale, t } from "@/shared/i18n/locale";
import { formatAudioSummary, formatTrackDuration } from "@/features/tracks/format";
import { compileSfc, evaluateSource } from "../../support/module/loader";
import {
  createHostNode,
  createHostRenderer,
  findNode,
  getTextContent,
} from "../../support/host/renderer";

const components = new Map<string, Vue.Component>();
for (const path of [
  "artists/navigation/ArtistRow.vue",
  "library/browser/albums/AlbumTrack.vue",
  "playlist/tracks/PlaylistTrack.vue",
]) {
  const filename = `src/features/${path}`;
  const source = readFileSync(filename, "utf8");
  components.set(
    path,
    evaluateSource<{ default: Vue.Component }>(compileSfc(source, filename), {
      vue: Vue,
      "@/features/artwork/artist/ArtistPhoto.vue": Vue.defineComponent({ setup: () => () => null }),
      "@lucide/vue": { AudioLines: Vue.defineComponent({ setup: () => () => null }) },
      "@/features/tracks/format": { formatTrackDuration },
    }).default,
  );
}

const apps: Vue.App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  setLocale("zh-CN");
});

function mount(path: string, props: Record<string, unknown>) {
  const component = components.get(path);
  if (!component) throw new Error(`Missing test component: ${path}`);
  const root = createHostNode("root");
  const app = createHostRenderer(createHostNode).createApp(component, props);
  apps.push(app);
  app.mount(root);
  return root;
}

function collectSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    if (!/\.(ts|vue)$/.test(entry.name)) return [];
    const source = readFileSync(path, "utf8");
    if (!entry.name.endsWith(".vue")) return [source];
    const { descriptor } = parse(source, { filename: path });
    return [compileScript(descriptor, { id: path, inlineTemplate: true }).content];
  });
}

describe("library and playlist translations", () => {
  it("translates both artist grouping options when switching languages", () => {
    expect(t("专辑演出者")).toBe("专辑演出者");
    expect(t("演出者")).toBe("演出者");
    setLocale("en");
    expect(t("专辑演出者")).toBe("Album artist");
    expect(t("演出者")).toBe("Artist");
    setLocale("zh-CN");
    expect(t("演出者")).toBe("演出者");
  });

  it("provides English translations for every literal UI key", () => {
    const keys = new Set<string>();
    for (const source of [
      ...collectSources("src/features/library"),
      ...collectSources("src/features/playlist"),
      ...collectSources("src/features/tracks/table"),
    ]) {
      const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          const target = ts.isCallExpression(expression) ? expression.arguments[0] : expression;
          const argument = node.arguments[0];
          if (
            target &&
            ts.isIdentifier(target) &&
            target.text === "t" &&
            argument &&
            ts.isStringLiteral(argument)
          ) {
            keys.add(argument.text);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
    }
    expect(keys.size).toBeGreaterThan(100);
    for (const key of keys) {
      expect(libraryMessages[key], key).toBeDefined();
      expect(libraryMessages[key], key).not.toMatch(/\p{Script=Han}/u);
    }
    for (const [source, translation] of Object.entries(libraryMessages)) {
      const placeholders = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(translation), source).toEqual(placeholders(source));
    }
  });

  it("updates artist album counts when the locale changes without remounting", async () => {
    const root = mount("artists/navigation/ArtistRow.vue", {
      artist: "演出者数据",
      name: "演出者数据",
      albumCount: 3,
      isSelected: false,
      isFocused: false,
    });
    expect(getTextContent(root)).toContain("3 张专辑");
    setLocale("en");
    await Vue.nextTick();
    expect(getTextContent(root)).toContain("3 albums");
    expect(getTextContent(root)).toContain("演出者数据");
    setLocale("zh-CN");
    await Vue.nextTick();
    expect(getTextContent(root)).toContain("3 张专辑");
  });

  it("updates album track fallback text and computed labels without remounting", async () => {
    const root = mount("library/browser/albums/AlbumTrack.vue", {
      track: {
        id: 1,
        title: null,
        artist: null,
        album: null,
        durationMs: null,
        trackNumber: 1,
        discNumber: 1,
      },
      albumArtist: null,
      isFocused: false,
      isSelected: false,
      isCurrentTrack: false,
      isContextMenuOpen: false,
    });
    const label = findNode(root, (node) => "data-album-track-label" in node.props);
    expect(label?.props.title).toBe("未知曲目");
    setLocale("en");
    await Vue.nextTick();
    expect(label?.props.title).toBe("Unknown track");
    expect(getTextContent(root)).toContain("Unknown duration");
    expect(getTextContent(root)).not.toContain("未知");
  });

  it("updates playlist drag aria-labels and computed durations without remounting", async () => {
    const root = mount("playlist/tracks/PlaylistTrack.vue", {
      track: {
        playlistItemId: 1,
        trackId: 2,
        title: null,
        artist: null,
        album: null,
        durationMs: null,
      },
      trackNumber: 4,
      isFocused: false,
      isSelected: false,
      isCurrentTrack: false,
    });
    const drag = findNode(root, (node) => node.props["aria-label"] === "拖动重排第 4 首");
    expect(drag).not.toBeNull();
    setLocale("en");
    await Vue.nextTick();
    expect(drag?.props["aria-label"]).toBe("Drag to reorder track 4");
    expect(getTextContent(root)).toContain("Unknown track");
    expect(getTextContent(root)).toContain("Unknown artist");
    expect(getTextContent(root)).toContain("Unknown album");
    expect(getTextContent(root)).toContain("Unknown duration");
  });

  it("evaluates audio formatting and named count parameters in the current locale", () => {
    const details = {
      id: 1,
      path: "歌曲.flac",
      title: null,
      artist: null,
      album: null,
      albumArtist: null,
      releaseDate: null,
      discNumber: null,
      trackNumber: null,
      discTotal: null,
      trackTotal: null,
      durationMs: null,
      codec: null,
      sampleRateHz: null,
      bitrateKbps: null,
      channels: 6,
    };
    expect(formatAudioSummary(details)).toBe("6 声道");
    setLocale("en");
    expect(formatAudioSummary(details)).toBe("6 channels");
    expect(formatAudioSummary({ ...details, channels: 1 })).toBe("Mono");
    expect(formatAudioSummary({ ...details, channels: 2 })).toBe("Stereo");
    expect(formatAudioSummary({ ...details, channels: null })).toBe("Unknown audio information");
    expect(t("扫描完成：新增 {added} 首，更新 {updated} 首", { added: 2, updated: 3 })).toBe(
      "Scan complete: 2 tracks added, 3 updated",
    );
  });
});
