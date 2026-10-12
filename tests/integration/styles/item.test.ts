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

const componentPaths = [
  "../../../src/features/playlist/list/PlaylistRow.vue",
  "../../../src/features/playlist/tracks/PlaylistTrack.vue",
  "../../../src/features/tracks/presentation/TrackFields.vue",
  "../../../src/features/tracks/presentation/TrackRow.vue",
  "../../../src/features/artists/navigation/ArtistRow.vue",
  "../../../src/features/library/browser/albums/AlbumCard.vue",
  "../../../src/features/library/browser/albums/AlbumTrack.vue",
  "../../../src/features/playback/queue/components/QueueRow.vue",
] as const;
const componentFiles: SfcFile[] = await Promise.all(
  componentPaths.map(async (path) => {
    const source = await Bun.file(new URL(path, import.meta.url)).text();
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
  expect(file.templateSource).toContain("focus-visible:bg-app-track");
  expect(file.templateSource).toContain("bg-app-track");
  expect(file.templateSource).not.toContain("focus-visible:outline");
  expect(file.templateSource).not.toContain("focus:outline");
  expect(file.templateSource).not.toContain("ring-");
  if (hasMultiSelectBackground) expect(file.templateSource).toContain("bg-white/10");
}

describe("列表条目状态样式", () => {
  it("除专辑卡片外，焦点和多选只使用背景，不显示状态 ring 或焦点 outline", () => {
    const withoutMultiSelectBackground = new Set(["PlaylistRow.vue", "ArtistRow.vue"]);
    for (const file of componentFiles) {
      if (file.path.endsWith("AlbumCard.vue") || file.path.endsWith("TrackFields.vue")) continue;
      const hasSelectionBackground = ![...withoutMultiSelectBackground].some((suffix) =>
        file.path.endsWith(suffix),
      );
      expectBackgroundOnly(file, hasSelectionBackground);

      for (const button of elements(file.template).filter(({ tag }) => tag === "button")) {
        const classes = staticClass(button);
        expect(classes).toContain("focus-visible:bg-app-track");
        expect(classes).toContain("outline-none");
        expect(classes).not.toContain("focus-visible:outline");
      }
    }
  });

  it("专辑卡片悬停只改变背景，焦点显示绿色线框，选中不改变背景", () => {
    const file = findFile("AlbumCard.vue");
    const button = elements(file.template).find(({ tag }) => tag === "button");
    if (!button) throw new Error("Album button was not rendered.");
    expect(staticClass(button)).toContain("focus-visible:ring-app-accent");
    expect(staticClass(button)).toContain("focus-visible:ring-2");
    expect(staticClass(button)).toContain("hover:bg-white/5");
    expect(staticClass(button)).toContain("transition-colors");
    expect(staticClass(button)).toContain("outline-none");
    expect(classBinding(button)).toContain("isFocused ? 'ring-app-accent ring-2'");
    expect(classBinding(button)).not.toContain("isSelected");
    expect(file.templateSource).not.toContain("bg-white/10");
    expect(file.templateSource).not.toContain("translate-y");
    expect(file.templateSource).not.toContain("transition-transform");
    expect(file.templateSource).not.toContain("bg-app-track");
  });

  it("焦点不改变歌单、艺术家或专辑名称颜色", () => {
    const playlistTitle = elements(findFile("PlaylistRow.vue").template).find(
      (node) => node.tag === "span" && staticClass(node).includes("text-base"),
    );
    const artistTitle = elements(findFile("ArtistRow.vue").template).find(
      (node) =>
        node.tag === "span" &&
        staticClass(node).includes("font-medium") &&
        textContent(node).includes("name"),
    );
    const albumTitle = elements(findFile("AlbumCard.vue").template).find(
      (node) => node.tag === "span" && textContent(node).includes("album.album"),
    );

    expect(playlistTitle && staticClass(playlistTitle)).toContain("text-app-muted");
    expect(artistTitle && staticClass(artistTitle)).toContain("text-white");
    expect(albumTitle && staticClass(albumTitle)).toContain("text-white");
    for (const node of [playlistTitle, artistTitle, albumTitle]) {
      expect(node && classBinding(node)).toBeUndefined();
    }
  });

  it("只有当前播放曲目的标题使用品牌绿色", () => {
    expect(findFile("PlaylistTrack.vue").templateSource).toContain(':current="isCurrentTrack"');
    expect(findFile("TrackRow.vue").templateSource).toContain(':current="current"');
    for (const suffix of ["TrackFields.vue", "AlbumTrack.vue", "QueueRow.vue"]) {
      const file = findFile(suffix);
      const titleBinding = elements(file.template)
        .filter(({ tag }) => tag === "span")
        .map(classBinding)
        .find((binding) =>
          binding?.includes(suffix === "TrackFields.vue" ? "current" : "isCurrentTrack"),
        );

      expect(titleBinding).toContain(
        `${suffix === "TrackFields.vue" ? "current" : "isCurrentTrack"} ? 'text-app-accent' : 'text-white'`,
      );
      expect(titleBinding).not.toContain("isFocused");
    }
  });
});
