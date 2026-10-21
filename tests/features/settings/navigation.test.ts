import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { createView, cleanupView } from "../../support/settings/view";
import { findNode, getTextContent } from "../../support/host/renderer";

it("renders category navigation and category-specific controls", async () => {
  const { root, header, footer, panel, navigation, categoryButtons } = await createView();
  expect(String(findNode(root, (node) => node.type === "dialog")?.props.class)).toContain(
    "sidebar-scrollbars",
  );
  if (!header || !footer) throw new Error("Missing dialog header or footer");
  expect(getTextContent(header).trim()).toBe("设置");
  expect(findNode(header, (node) => node.type === "button")).toBeNull();
  expect(getTextContent(footer)).toContain("取消");
  expect(getTextContent(footer)).toContain("保存");
  expect(findNode(root, (node) => node.props.name === "check-updates-on-startup")).toBeNull();
  expect(findNode(root, (node) => node.props["data-update"] === "")).toBeNull();

  if (!panel || !navigation) throw new Error("Missing settings panel or navigation");
  expect(categoryButtons.map((button) => getTextContent(button).trim())).toEqual([
    "常规",
    "外观",
    "播放",
    "媒体库",
    "歌词",
    "快捷键",
    "高级",
    "关于",
  ]);
  for (const button of categoryButtons) {
    if (typeof button.props.onClick !== "function") throw new Error("Missing category handler");
    button.props.onClick();
    await Vue.nextTick();
    const heading = findNode(panel, (node) => node.type === "h3");
    const category = getTextContent(button).trim();
    if (category === "快捷键") {
      expect(heading).not.toBeNull();
      expect(getTextContent(heading!)).toBe(category);
    } else {
      expect(heading).toBeNull();
    }
    expect(
      findNode(panel, (node) => String(node.props["aria-label"] ?? "").endsWith("设置说明")),
    ).toBeNull();
    expect(panel.props["aria-labelledby"]).toBe(button.props.id);
    if (category === "媒体库") {
      const content = getTextContent(panel);
      const labels = ["同步文件夹", "扫描时补齐 ReplayGain 标签", "专辑排序", "显示播放统计"];
      for (const label of labels) expect(content).toContain(label);
      const positions = labels.map((label) => content.indexOf(label));
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      expect(findNode(panel, (node) => node.props.name === "replay-gain")).toBeNull();
      expect(findNode(panel, (node) => node.props.name === "replay-gain-preamp")).toBeNull();
    }
    if (category === "播放") {
      const loudnessHeading = findNode(
        panel,
        (node) => node.type === "h4" && node.props.id === "playback-loudness-label",
      );
      if (!loudnessHeading) throw new Error("Missing loudness heading");
      expect(getTextContent(loudnessHeading)).toBe("响度");
      expect(getTextContent(panel)).not.toContain("同步文件夹");
      expect(getTextContent(panel)).not.toContain("专辑排序");
      expect(findNode(panel, (node) => node.props.name === "scan-replay-gain")).toBeNull();
      setLocale("en");
      await Vue.nextTick();
      expect(getTextContent(button).trim()).toBe("Playback");
      expect(getTextContent(loudnessHeading)).toBe("Loudness");
      setLocale("zh-CN");
      await Vue.nextTick();
      const preamp = findNode(panel, (node) => node.props.name === "replay-gain-preamp");
      const toggle = findNode(panel, (node) => node.props.name === "replay-gain");
      const reset = findNode(panel, (node) => node.props["aria-label"] === "恢复默认");
      if (!preamp || !toggle || !reset) throw new Error("Missing ReplayGain controls");
      expect(preamp.props.type).toBe("number");
      expect(preamp.props.min).toBe("-20");
      expect(preamp.props.max).toBe("20");
      expect(preamp.props.step).toBe("0.5");
      expect(preamp.props.disabled).toBe(false);
      const change = toggle.props["native-change"];
      const input = preamp.props["native-input"];
      const restore = reset.props.onClick;
      if (
        typeof change !== "function" ||
        typeof input !== "function" ||
        typeof restore !== "function"
      )
        throw new Error("Missing ReplayGain handlers");
      Reflect.set(preamp, "value", "3.5");
      input({ target: preamp });
      await Vue.nextTick();
      expect(Number(Reflect.get(preamp, "value"))).toBe(3.5);
      Reflect.set(toggle, "checked", false);
      change({ target: toggle });
      await Vue.nextTick();
      expect(preamp.props.disabled).toBe(true);
      expect(reset.props.disabled).toBe(true);
      expect(Number(Reflect.get(preamp, "value"))).toBe(3.5);
      Reflect.set(toggle, "checked", true);
      change({ target: toggle });
      await Vue.nextTick();
      expect(preamp.props.disabled).toBe(false);
      restore();
      await Vue.nextTick();
      expect(Reflect.get(preamp, "value")).toBe(0);
    }
    const startupCheck = findNode(panel, (node) => node.props.name === "check-updates-on-startup");
    const updatePanel = findNode(panel, (node) => node.props["data-update"] === "");
    if (category !== "高级") {
      expect(startupCheck).toBeNull();
      expect(updatePanel).toBeNull();
    }
    if (category === "关于") {
      expect(findNode(panel, (node) => node.props["data-about"] === "")).not.toBeNull();
      expect(getTextContent(footer)).not.toContain("保存");
    }
    if (category === "高级") {
      expect(startupCheck?.props.type).toBe("checkbox");
      expect(startupCheck && Reflect.get(startupCheck, "checked")).toBe(true);
      expect(getTextContent(panel)).toContain("启动时自动检查更新");
      expect(updatePanel).not.toBeNull();
      expect(getTextContent(panel)).toContain("检查更新");
      expect(getTextContent(panel)).toContain("诊断");
      expect(getTextContent(panel)).toContain("打开日志目录");
      expect(getTextContent(panel)).toContain("备份");
      expect(getTextContent(panel)).toContain("导出备份");
      expect(getTextContent(footer)).toContain("保存");
      setLocale("en");
      await Vue.nextTick();
      expect(getTextContent(button).trim()).toBe("Advanced");
      setLocale("zh-CN");
      await Vue.nextTick();
    }
  }
});

afterEach(cleanupView);
