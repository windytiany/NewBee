import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import * as desktopApi from "@tauri-apps/api/core";
import { compileSfc, evaluateModule, transpileScript } from "./moduleLoader";
import { createHostNode, createHostRenderer, getTextContent } from "./hostRenderer";

const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});

const counterSource = `
<script setup lang="ts">
import { ref } from "vue";
const count = ref<number>(2);
</script>
<template><button @click="count++">{{ count }}</button></template>
`;

describe("test module loader", () => {
  it("transpiles TypeScript and keeps injected dependencies and module state local", () => {
    const output = transpileScript(`
      import { invoke } from "@tauri-apps/api/core";
      let calls = 0;
      export function run(): string { return invoke(++calls); }
    `);
    const originalInvoke = desktopApi.invoke;
    const first = evaluateModule<{ run: () => string }>(output, {
      "@tauri-apps/api/core": { invoke: (count: number) => `first:${count}` },
    });
    const second = evaluateModule<{ run: () => string }>(output, {
      "@tauri-apps/api/core": { invoke: (count: number) => `second:${count}` },
    });
    expect(first.run()).toBe("first:1");
    expect(first.run()).toBe("first:2");
    expect(second.run()).toBe("second:1");
    expect(desktopApi.invoke).toBe(originalInvoke);
  });

  it("fails explicitly when a dependency was not supplied, including inherited names", () => {
    const output = transpileScript('import "toString";');
    expect(() => evaluateModule(output, {})).toThrow("Missing test dependency: toString");
  });

  it("compiles and renders an inline template with reactive TypeScript bindings", async () => {
    const component = evaluateModule<{ default: Vue.Component }>(
      compileSfc(counterSource, "counter.vue"),
      { vue: Vue },
    ).default;
    const root = createHostNode("root");
    const app = createHostRenderer(createHostNode).createApp(component);
    app.mount(root);
    apps.push(app);
    const button = root.children[0]!;
    expect(getTextContent(button)).toBe("2");
    const click = button.props.onClick;
    if (typeof click !== "function") throw new Error("Counter click handler is missing.");
    click();
    await Vue.nextTick();
    expect(getTextContent(button)).toBe("3");
  });

  it("keeps setup bindings available when inline templates are disabled", () => {
    const component = evaluateModule<{
      default: { setup: (props: object, context: object) => { count: Vue.Ref<number> } };
    }>(compileSfc(counterSource, "counter.vue", { inlineTemplate: false }), { vue: Vue }).default;
    const bindings = component.setup({}, { expose: () => {} });
    expect(bindings.count.value).toBe(2);
  });

  it("reports malformed SFC input with its filename", () => {
    expect(() => compileSfc("<script setup>const count = 2;", "broken.vue")).toThrow(
      "Cannot compile broken.vue",
    );
  });
});
