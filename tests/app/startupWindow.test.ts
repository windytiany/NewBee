import { afterEach, describe, expect, it } from "bun:test";
import { transpileScript, evaluateSource } from "../support/moduleLoader";

const config = JSON.parse(
  await Bun.file(new URL("../../src-tauri/tauri.conf.json", import.meta.url)).text(),
);
const output = transpileScript(
  await Bun.file(new URL("../../src/main.ts", import.meta.url)).text(),
);
const originalGlobals = new Map(
  ["document", "requestAnimationFrame"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);

afterEach(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function start(isTauriApp = true) {
  const events: string[] = [];
  const frames: Array<() => void> = [];
  let finishRendering!: () => void;
  const rendered = new Promise<void>((resolve) => {
    finishRendering = resolve;
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { addEventListener: () => {} },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: () => void) => frames.push(callback),
  });
  const modules: Record<string, unknown> = {
    vue: {
      createApp: () => ({ mount: () => events.push("mount") }),
      nextTick: () => rendered,
    },
    "@/app/logging": { installErrorLogging: () => {} },
    "@/app/App.vue": { default: {} },
    "@/app/styles/main.css": {},
    "@/features/settings/preferences": {
      restorePreferences: async () => events.push("restore-preferences"),
    },
    "@tauri-apps/api/core": {
      isTauri: () => isTauriApp,
      invoke: async (command: string) => {
        events.push(command);
      },
    },
  };
  evaluateSource(output, modules);
  return { events, frames, finishRendering };
}

async function settle() {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

describe("startup window visibility", () => {
  it("creates the main window hidden with a dark webview background", () => {
    expect(config.app.windows[0].visible).toBe(false);
    expect(config.app.windows[0].backgroundColor).toBe("#121212");
  });

  it("restores and shows only after DOM updates and the first painted frame", async () => {
    const startup = start();
    expect(startup.events).toEqual(["mount", "restore-preferences"]);
    expect(startup.frames).toHaveLength(0);
    startup.finishRendering();
    await settle();
    expect(startup.events).toEqual(["mount", "restore-preferences"]);
    expect(startup.frames).toHaveLength(1);
    startup.frames.shift()?.();
    await settle();
    expect(startup.events).toEqual(["mount", "restore-preferences"]);
    expect(startup.frames).toHaveLength(1);
    startup.frames.shift()?.();
    await settle();
    expect(startup.events).toEqual(["mount", "restore-preferences", "show_main_window"]);
  });

  it("does not request another restore on subsequent paint frames", async () => {
    const startup = start();
    startup.finishRendering();
    await settle();
    startup.frames.shift()?.();
    startup.frames.shift()?.();
    await settle();
    expect(startup.frames).toHaveLength(0);
    expect(startup.events).toEqual(["mount", "restore-preferences", "show_main_window"]);
  });

  it("keeps browser preview independent of desktop window APIs", async () => {
    const startup = start(false);
    startup.finishRendering();
    await settle();
    expect(startup.events).toEqual(["mount"]);
    expect(startup.frames).toHaveLength(0);
  });
});
