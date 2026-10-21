import { afterEach, expect, it } from "bun:test";
import { createView, cleanupView } from "../../support/settings/view";
import { findNode, getTextContent } from "../../support/host/renderer";

for (const [category, included, excluded] of [
  ["常规", "关闭窗口时", "主题色"],
  ["外观", "主题色", "专辑排序"],
  ["媒体库", "专辑排序", "关闭窗口时"],
  ["歌词", "网易云音乐", "关闭窗口时"],
] as const) {
  it(`renders only ${category} options`, async () => {
    const { panel, navigation, select } = await createView();
    await select(category);
    const button = findNode(navigation, (node) => getTextContent(node).trim() === category)!;
    expect(button.props["aria-current"]).toBe("true");
    expect(getTextContent(panel)).toContain(included);
    expect(getTextContent(panel)).not.toContain(excluded);
    const explanation = {
      常规: "托盘菜单中的",
      外观: "保存后立即生效",
      媒体库: "缺少日期的专辑",
      歌词: "不检查是否缺少",
    }[category];
    expect(getTextContent(panel)).not.toContain(explanation);
    const help = findNode(panel, (node) => node.props["aria-label"] === `${category}设置说明`);
    expect(help).toBeNull();
  });
}
afterEach(cleanupView);
