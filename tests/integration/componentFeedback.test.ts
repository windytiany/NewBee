import { describe, expect, it } from "bun:test";
import { parse } from "@vue/compiler-sfc";
import { fileURLToPath } from "node:url";

const sourceRoot = new URL("../../src/", import.meta.url);
const templates = await Promise.all(
  Array.from(
    new Bun.Glob("{features,app}/**/*.vue").scanSync({ cwd: fileURLToPath(sourceRoot) }),
  ).map(async (filePath) => {
    const path = filePath.replace(/\\/g, "/");
    const source = await Bun.file(new URL(path, sourceRoot)).text();
    const { descriptor } = parse(source, { filename: path });
    return { path, template: descriptor.template?.content ?? "" };
  }),
);

function template(path: string) {
  const file = templates.find((file) => file.path === path);
  if (!file) throw new Error(`Missing component: ${path}`);
  return file.template;
}

describe("组件反馈边界", () => {
  it("业务组件不再内嵌错误区或重试按钮", () => {
    expect(templates.length).toBeGreaterThan(0);
    for (const file of templates) {
      expect(file.template).not.toContain('role="alert"');
      expect(file.template).not.toMatch(/@(?:click|retry)[^\n]*retry/i);
      expect(file.template).not.toContain("重试");
    }
  });

  it("删除常驻解释小字，不展示逐曲保存明细", () => {
    for (const file of templates) {
      expect(file.template).not.toContain("请在桌面应用");
      expect(file.template).not.toContain("保存时将清除");
      expect(file.template).not.toContain("暂时无法保存标签");
      expect(file.template).not.toContain("result.path");
      expect(file.template).not.toContain("result.error");
    }
    expect(template("features/settings/components/SettingsDialog.vue")).not.toContain(
      "日志仅保存在本机。分享前请检查路径隐私。",
    );
  });

  it("保留信息图标帮助和破坏性操作确认", () => {
    for (const path of [
      "features/settings/components/SettingsDialog.vue",
      "features/library/import/ScanDialog.vue",
      "features/library/paths/PathMigrationDialog.vue",
    ]) {
      expect(template(path)).toContain("<HelpDialog");
    }
    expect(template("features/tags/manual/components/TagEditorDialog.vue")).toContain(
      "未保存的修改将丢失。",
    );
    expect(template("features/lyrics/components/LyricsSearch.vue")).toContain(
      "文本框中的歌词修改将被替换，仍需保存才会写入文件。",
    );
    expect(template("features/playlist/components/dialogs/DeletePlaylistDialog.vue")).toContain(
      "删除此歌单无法撤销。",
    );
  });
});
