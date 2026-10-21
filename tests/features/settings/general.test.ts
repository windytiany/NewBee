import { cleanupEditor } from "../../support/settings/editor";
import * as Vue from "vue";
import { createHostNode, createHostRenderer, findNode } from "../../support/host/renderer";
import type { HostNode } from "../../support/host/renderer";
import { afterEach, describe, expect, it } from "bun:test";
import { createEditor, defaults } from "../../support/settings/editor";
import { locale, setLocale } from "@/shared/i18n/locale";

import type { Settings } from "@/features/settings/types";

describe("settings general", () => {
  it("loads lightweight mode and persists the explicit preference", async () => {
    let saved: Settings | undefined;
    const { bindings } = createEditor(async (command, args) => {
      if (command === "get_settings") return { ...defaults, lightweightOnClose: false };
      if (command === "save_settings") saved = (args as { settings: Settings }).settings;
    });
    await bindings.show();
    expect(bindings.draft.lightweightOnClose).toBe(false);
    bindings.draft.lightweightOnClose = true;
    await bindings.save();
    expect(saved?.lightweightOnClose).toBe(true);
  });

  for (const savedLocale of ["zh-CN", "en"] as const) {
    it(`persists locale ${savedLocale} and applies it only after successful saving`, async () => {
      const initialLocale = savedLocale === "en" ? "zh-CN" : "en";
      setLocale(initialLocale);
      let fail = true;
      const saved: unknown[] = [];
      const { bindings, element } = createEditor(async (command, args) => {
        if (command === "get_settings") return { ...defaults, locale: initialLocale };
        if (fail) throw new Error("Disk unavailable");
        saved.push(args);
      });
      await bindings.show();
      expect(bindings.draft.locale).toBe(initialLocale);
      bindings.draft.locale = savedLocale;
      expect(locale.value).toBe(initialLocale);
      await bindings.save();
      expect(locale.value).toBe(initialLocale);
      expect(element.open).toBe(true);
      fail = false;
      await bindings.save();
      expect(saved).toEqual([{ settings: { ...defaults, locale: savedLocale } }]);
      expect(locale.value).toBe(savedLocale);
      expect(element.open).toBe(false);
    });
  }

  it("cancel does not apply a language change and reopening restores the saved language", async () => {
    const { bindings } = createEditor(async () => defaults);
    await bindings.show();
    bindings.draft.locale = "en";
    bindings.close();
    expect(locale.value).toBe("zh-CN");
    await bindings.show();
    expect<Settings["locale"]>(bindings.draft.locale).toBe("zh-CN");
  });
});

it("preserves radio selection when close options are reordered during template updates", async () => {
  const general = await Bun.file("src/features/settings/GeneralOptions.vue").text();
  if (!general) throw new Error("Missing general settings");
  const labels = [...general.matchAll(/<label\b[\s\S]*?<\/label>/g)].map((match) => match[0]);
  const tray = labels.find((label) => label.includes('value="tray"'))!;
  const exit = labels.find((label) => label.includes('value="exit"'))!;
  const lightweight = labels.find((label) => label.includes('name="lightweight-on-close"'))!;
  const template = `<fieldset>${[tray, lightweight, exit].join("\n")}</fieldset>`;
  const previous = `<fieldset>${[tray, exit, lightweight].join("\n")}</fieldset>`.replace(
    /\skey="[^"]*"/g,
    "",
  );
  const before = Vue.compile(previous, { prefixIdentifiers: true });
  const after = Vue.compile(template, { prefixIdentifiers: true });
  const reordered = Vue.ref(false);
  const closeBehavior = Vue.ref("tray");
  const component = Vue.defineComponent({
    setup: () => ({
      draft: Vue.reactive({ closeBehavior, lightweightOnClose: true }),
      t: (text: string) => text,
    }),
    render() {
      const vnode = Reflect.apply(reordered.value ? after : before, this, [this, []]);
      // Template hot updates use a full diff rather than the previous template's block layout.
      if (Vue.isVNode(vnode)) Reflect.set(vnode, "dynamicChildren", null);
      return vnode;
    },
  });
  const renderer = createHostRenderer<HostNode>(
    (type, text = "") => {
      const node = Object.assign(createHostNode(type, text), {
        tagName: type.toUpperCase(),
        checked: false,
        value: "",
        addEventListener(event: string, handler: (event: unknown) => void) {
          node.props[`native-${event}`] = handler;
        },
      });
      return node;
    },
    {
      patchProp(node, key, _previous, next) {
        node.props[key] = next;
        if (key === "value") Object.assign(node, { value: next, _value: next });
      },
    },
  );
  const root = createHostNode("root");
  const app = renderer.createApp(component);
  app.mount(root);
  try {
    reordered.value = true;
    await Vue.nextTick();
    for (const value of ["exit", "tray", "exit"] as const) {
      const radio = findNode(root, (node) => node.props.value === value);
      const change = radio?.props["native-change"];
      if (!radio || typeof change !== "function") throw new Error("Missing radio change event");
      Reflect.set(radio, "checked", true);
      change({ target: radio });
      await Vue.nextTick();
      expect(closeBehavior.value).toBe(value);
      expect(Reflect.get(radio, "checked")).toBe(true);
    }
  } finally {
    app.unmount();
  }
});

afterEach(cleanupEditor);
