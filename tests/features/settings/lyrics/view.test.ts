import { afterEach, expect, it } from "bun:test";
import * as Vue from "vue";
import { setLocale } from "@/shared/i18n/locale";
import { createView, cleanupView } from "../../../support/settings/view";
import { findNode, getTextContent } from "../../../support/host/renderer";

it("edits lyrics controls and translates labels", async () => {
  const { panel, select } = await createView();
  await select("歌词");
  const providerHeading = findNode(
    panel,
    (node) => node.type === "h4" && node.props.id === "netease-lyrics-label",
  );
  if (!providerHeading) throw new Error("Missing lyrics provider heading");
  expect(getTextContent(providerHeading)).toBe("网易云音乐");
  expect(getTextContent(panel)).not.toContain("歌词来源");
  const providerGroup = findNode(
    panel,
    (node) => node.type === "fieldset" && node.props["aria-labelledby"] === "netease-lyrics-label",
  );
  expect(providerGroup).not.toBeNull();
  const providerToggle = findNode(providerGroup!, (node) => node.props.name === "netease-lyrics");
  const toggleLabel = providerToggle?.parent;
  if (!toggleLabel) throw new Error("Missing lyrics provider toggle");
  expect(getTextContent(toggleLabel).trim()).toBe("启用");
  expect(String(toggleLabel.props.class)).not.toContain("bg-");
  expect(String(toggleLabel.props.class)).not.toContain("px-");
  expect(getTextContent(panel)).not.toContain("歌词内容");
  const neteaseModeSelect = findNode(
    providerGroup!,
    (node) => node.props.name === "netease-lyrics-mode",
  );
  expect(neteaseModeSelect?.type).toBe("select");
  const modeRow = neteaseModeSelect?.parent;
  if (!modeRow) throw new Error("Missing lyrics content row");
  expect(String(modeRow.props.class)).not.toContain("ml-");
  expect(neteaseModeSelect?.props["aria-label"]).toBe("歌词内容");
  expect(String(neteaseModeSelect?.props.class)).toContain("font-normal");
  expect(neteaseModeSelect?.children.map((node) => node.props.value)).toEqual([
    "original",
    "translated",
    "bilingual",
  ]);
  setLocale("en");
  await Vue.nextTick();
  expect(getTextContent(providerHeading)).toBe("NetEase Cloud Music");
  expect(getTextContent(toggleLabel).trim()).toBe("Enabled");
  expect(getTextContent(panel)).not.toContain("Lyrics content");
  expect(neteaseModeSelect?.props["aria-label"]).toBe("Lyrics content");
  setLocale("zh-CN");
  await Vue.nextTick();
});
afterEach(cleanupView);
