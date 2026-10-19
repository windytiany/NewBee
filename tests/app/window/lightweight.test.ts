import { describe, expect, it } from "bun:test";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const source = transpileScript(await Bun.file("src/app/window/lightweight.ts").text());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  idle: Promise<void> = Promise.resolve(),
  failRegistration = false,
  failRelease = false,
) {
  const events = new Map<string, (event: { payload: number }) => void>();
  const calls: Array<[string, unknown]> = [];
  const stopped: string[] = [];
  const feedback: unknown[] = [];
  const module = evaluateSource<{ initializeLightweightMode: () => Promise<boolean> }>(source, {
    "@tauri-apps/api/core": {
      isTauri: () => true,
      invoke: async (command: string, args: unknown) => {
        calls.push([command, args]);
        if (
          failRelease &&
          command === "advance_lightweight" &&
          (args as { release: boolean }).release
        ) {
          throw new Error("release failed");
        }
        return true;
      },
    },
    "@tauri-apps/api/event": {
      listen: async (event: string, handler: (event: { payload: number }) => void) => {
        if (failRegistration && event === "lightweight-cancelled")
          throw new Error("registration failed");
        events.set(event, handler);
        return () => {
          stopped.push(event);
        };
      },
    },
    "@/shared/lifecycle/activity": { prepareRelease: async () => true, waitForIdle: () => idle },
    "@/app/update": { waitForUpdates: async () => {} },
    "@tauri-apps/plugin-dialog": { message: async (input: unknown) => feedback.push(input) },
  });
  return { ...module, calls, events, stopped, feedback };
}
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

describe("lightweight desktop wiring", () => {
  it("registers once and restores global shortcuts before releasing the WebView", async () => {
    const idle = deferred();
    const app = fixture(idle.promise);
    await Promise.all([app.initializeLightweightMode(), app.initializeLightweightMode()]);
    expect(app.events.size).toBe(2);
    app.events.get("lightweight-requested")!({ payload: 7 });
    await settle();
    expect(app.calls).toEqual([["advance_lightweight", { request: 7, release: false }]]);
    idle.resolve();
    await settle();
    expect(app.calls).toEqual([
      ["advance_lightweight", { request: 7, release: false }],
      ["set_shortcuts_suspended", { suspended: false }],
      ["advance_lightweight", { request: 7, release: true }],
    ]);
  });

  it("does not destroy a reopened window when a task finishes", async () => {
    const idle = deferred();
    const app = fixture(idle.promise);
    await app.initializeLightweightMode();
    app.events.get("lightweight-requested")!({ payload: 8 });
    await settle();
    app.events.get("lightweight-cancelled")!({ payload: 0 });
    idle.resolve();
    await settle();
    expect(app.calls).toEqual([["advance_lightweight", { request: 8, release: false }]]);
    expect(app.feedback).toEqual([]);
  });

  it("reports release errors through a native dialog while the main window is hidden", async () => {
    const app = fixture(Promise.resolve(), false, true);
    await app.initializeLightweightMode();
    app.events.get("lightweight-requested")!({ payload: 9 });
    await settle();
    expect(app.feedback).toHaveLength(1);
    expect(app.calls[app.calls.length - 1]).toEqual([
      "cancel_lightweight",
      { request: 9, fallback: true },
    ]);
  });

  it("removes partial registrations and disables lightweight mode without blocking startup", async () => {
    const app = fixture(Promise.resolve(), true);
    expect(await app.initializeLightweightMode()).toBe(false);
    expect(app.stopped).toEqual(["lightweight-requested"]);
  });
});
