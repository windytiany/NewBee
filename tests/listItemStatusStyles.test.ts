// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { describe, expect, it } from "bun:test";
import { parse } from "@vue/compiler-sfc";

type TemplateNode = {
  tag?: string;
  content?: string | { content?: string };
  props?: Array<{
    name?: string;
    value?: { content: string };
    arg?: { content?: string };
    exp?: { content?: string };
  }>;
  children?: TemplateNode[];
};

type SfcFile = {
  path: string;
  template: TemplateNode;
  templateSource: string;
};

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const componentPaths = [
  "../src/playlist/ui/PlaylistListItem.vue",
  "../src/playlist/ui/PlaylistTrack.vue",
  "../src/library/ui/ArtistListItem.vue",
  "../src/library/ui/AlbumCard.vue",
  "../src/library/ui/AlbumTrack.vue",
  "../src/playback/ui/QueueRow.vue",
] as const;
const componentFiles: SfcFile[] = await Promise.all(
  componentPaths.map(async (path) => {
    const source = await bunRuntime.Bun.file(new URL(path, import.meta.url)).text();
    const { descriptor } = parse(source, { filename: path });
    if (!descriptor.template) throw new Error(`Missing template: ${path}`);
    return {
      path,
      template: descriptor.template.ast as unknown as TemplateNode,
      templateSource: descriptor.template.content,
    };
  }),
);

function elements(root: TemplateNode): TemplateNode[] {
  const found = root.tag ? [root] : [];
  for (const child of root.children ?? []) found.push(...elements(child));
  return found;
}

function staticClass(node: TemplateNode) {
  return node.props?.find((prop) => prop.name === "class")?.value?.content ?? "";
}

function classBinding(node: TemplateNode) {
  return node.props?.find((prop) => prop.name === "bind" && prop.arg?.content === "class")?.exp
    ?.content;
}

function textContent(node: TemplateNode): string {
  if (typeof node.content === "string") return node.content;
  if (node.content) return node.content.content ?? "";
  return (node.children ?? []).map(textContent).join("");
}

function findFile(pathSuffix: string) {
  const file = componentFiles.find(({ path }) => path.endsWith(pathSuffix));
  if (!file) throw new Error(`Test source was not loaded: ${pathSuffix}`);
  return file;
}

function expectBackgroundOnly(file: SfcFile, hasMultiSelectBackground: boolean) {
  expect(file.templateSource).toContain("focus-visible:bg-spotify-track");
  expect(file.templateSource).toContain("bg-spotify-track");
  expect(file.templateSource).not.toContain("focus-visible:outline");
  expect(file.templateSource).not.toContain("focus:outline");
  expect(file.templateSource).not.toContain("ring-");
  if (hasMultiSelectBackground) expect(file.templateSource).toContain("bg-white/10");
}

describe("列表条目状态样式", () => {
  it("焦点和多选只使用背景，不显示状态 ring 或焦点 outline", () => {
    const withoutMultiSelectBackground = new Set(["PlaylistListItem.vue", "ArtistListItem.vue"]);
    for (const file of componentFiles) {
      const hasSelectionBackground = ![...withoutMultiSelectBackground].some((suffix) =>
        file.path.endsWith(suffix),
      );
      expectBackgroundOnly(file, hasSelectionBackground);

      for (const button of elements(file.template).filter(({ tag }) => tag === "button")) {
        const classes = staticClass(button);
        expect(classes).toContain("focus-visible:bg-spotify-track");
        expect(classes).toContain("outline-none");
        expect(classes).not.toContain("focus-visible:outline");
      }
    }
  });

  it("焦点不改变歌单、艺术家或专辑名称颜色", () => {
    const playlistTitle = elements(findFile("PlaylistListItem.vue").template).find(
      (node) => node.tag === "span" && staticClass(node).includes("text-base"),
    );
    const artistTitle = elements(findFile("ArtistListItem.vue").template).find(
      (node) =>
        node.tag === "span" &&
        staticClass(node).includes("font-medium") &&
        textContent(node).includes("name"),
    );
    const albumTitle = elements(findFile("AlbumCard.vue").template).find(
      (node) => node.tag === "span" && textContent(node).includes("album.album"),
    );

    expect(playlistTitle && staticClass(playlistTitle)).toContain("text-spotify-muted");
    expect(artistTitle && staticClass(artistTitle)).toContain("text-white");
    expect(albumTitle && staticClass(albumTitle)).toContain("text-white");
    for (const node of [playlistTitle, artistTitle, albumTitle]) {
      expect(node && classBinding(node)).toBeUndefined();
    }
  });

  it("只有当前播放曲目的标题使用品牌绿色", () => {
    for (const suffix of ["PlaylistTrack.vue", "AlbumTrack.vue", "QueueRow.vue"]) {
      const file = findFile(suffix);
      const titleBinding = elements(file.template)
        .filter(({ tag }) => tag === "span")
        .map(classBinding)
        .find((binding) => binding?.includes("isCurrentTrack"));

      expect(titleBinding).toContain("isCurrentTrack ? 'text-spotify-green' : 'text-white'");
      expect(titleBinding).not.toContain("isFocused");
    }
  });
});
