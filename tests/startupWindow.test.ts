// @ts-expect-error Bun provides this built-in test module at runtime; Bun types are not installed here.
import { afterEach, describe, expect, it } from "bun:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const bunRuntime = globalThis as typeof globalThis & {
  Bun: { file: (path: URL) => { text: () => Promise<string> } };
};
const config = JSON.parse(
  await bunRuntime.Bun.file(new URL("../src-tauri/tauri.conf.json", import.meta.url)).text(),
);
const output = transpileModule(
  await bunRuntime.Bun.file(new URL("../src/main.ts", import.meta.url)).text(),
  { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
).outputText;
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
    "@/App.vue": { default: {} },
    "@/style.css": {},
    "@tauri-apps/api/core": {
      isTauri: () => isTauriApp,
      invoke: async (command: string) => {
        events.push(command);
      },
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
      return modules[name];
    },
    module,
    module.exports,
  );
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
    expect(startup.events).toEqual(["mount"]);
    expect(startup.frames).toHaveLength(0);
    startup.finishRendering();
    await settle();
    expect(startup.events).toEqual(["mount"]);
    expect(startup.frames).toHaveLength(1);
    startup.frames.shift()?.();
    await settle();
    expect(startup.events).toEqual(["mount"]);
    expect(startup.frames).toHaveLength(1);
    startup.frames.shift()?.();
    await settle();
    expect(startup.events).toEqual(["mount", "show_main_window"]);
  });

  it("does not request another restore on subsequent paint frames", async () => {
    const startup = start();
    startup.finishRendering();
    await settle();
    startup.frames.shift()?.();
    startup.frames.shift()?.();
    await settle();
    expect(startup.frames).toHaveLength(0);
    expect(startup.events).toEqual(["mount", "show_main_window"]);
  });

  it("keeps browser preview independent of desktop window APIs", async () => {
    const startup = start(false);
    startup.finishRendering();
    await settle();
    expect(startup.events).toEqual(["mount"]);
    expect(startup.frames).toHaveLength(0);
  });
});
