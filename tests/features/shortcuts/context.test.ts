import { afterEach, describe, expect, it, mock } from "bun:test";
import * as Vue from "vue";
import { getContextCommands, useContextCommands } from "@/features/shortcuts/context";
import { createHostNode, createHostRenderer } from "../../support/host/renderer";

const apps: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
});
function element(parent?: HTMLElement) {
  const target = {
    parent,
    contains(other: unknown): boolean {
      return (
        this === other ||
        (Boolean(other) &&
          typeof other === "object" &&
          other !== null &&
          "parent" in other &&
          Boolean(this.contains(other.parent))) ||
        false
      );
    },
  };
  return target as unknown as HTMLElement;
}
function mount(setup: () => void) {
  const app = createHostRenderer(createHostNode).createApp({
    setup() {
      setup();
      return () => null;
    },
  });
  app.mount(createHostNode("root"));
  apps.push(app);
  return app;
}

describe("context commands", () => {
  it("selects the nearest context and removes unmounted targets", () => {
    const outer = element();
    const inner = element(outer);
    const row = element(inner);
    const outside = element();
    const outerAction = mock(() => {});
    const innerAction = mock(() => {});
    mount(() => useContextCommands(Vue.shallowRef(outer), () => ({ addToQueue: outerAction })));
    const nested = mount(() =>
      useContextCommands(Vue.shallowRef(inner), () => ({ addToQueue: innerAction })),
    );
    expect(getContextCommands(null)).toEqual({});
    expect(getContextCommands(outside)).toEqual({});
    getContextCommands(row).addToQueue?.();
    expect(innerAction).toHaveBeenCalledTimes(1);
    expect(outerAction).not.toHaveBeenCalled();
    nested.unmount();
    apps.splice(apps.indexOf(nested), 1);
    getContextCommands(row).addToQueue?.();
    expect(outerAction).toHaveBeenCalledTimes(1);
  });

  it("reads current availability but preserves a captured command for the palette", () => {
    const root = element();
    let ids = [1, 2];
    let pending = false;
    const additions: number[][] = [];
    mount(() =>
      useContextCommands(Vue.shallowRef(root), () => {
        if (pending || !ids.length) return {};
        const targets = [...ids];
        return {
          addToQueue: () => {
            additions.push(targets);
          },
        };
      }),
    );
    const captured = getContextCommands(root);
    ids = [3];
    captured.addToQueue?.();
    getContextCommands(root).addToQueue?.();
    expect(additions).toEqual([[1, 2], [3]]);
    pending = true;
    expect(getContextCommands(root)).toEqual({});
  });
});
