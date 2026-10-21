import { expect, it } from "bun:test";
import * as Vue from "vue";
import { createUpdater } from "@/shared/update/controller";
import type { waitForUpdates } from "@/app/window/update";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const output = transpileScript(await Bun.file("src/app/window/update.ts").text());
function fixture() {
  const updater = createUpdater({
    supported: true,
    check: async () => ({
      version: "0.2.0",
      download: async () => {},
      install: async () => {},
      close: async () => {},
    }),
    failed: () => {},
  });
  const { waitForUpdates: wait } = evaluateSource<{ waitForUpdates: typeof waitForUpdates }>(
    output,
    {
      vue: Vue,
      "@/shared/update/runtime": { getUpdater: () => updater },
    },
  );
  return { updater, wait };
}

it("keeps downloaded bytes alive while hidden and cancels the release wait on reopen", async () => {
  const { updater, wait } = fixture();
  await updater.check();
  await updater.download();
  expect(updater.busy.value).toBe(false);
  expect(updater.holdsWindow.value).toBe(true);
  const request = new AbortController();
  let finished = false;
  const waiting = wait(request.signal).then(
    () => {
      finished = true;
      return undefined;
    },
    (reason: unknown) => reason,
  );
  await Vue.nextTick();
  expect(finished).toBe(false);
  request.abort(new Error("reopened"));
  expect(await waiting).toEqual(new Error("reopened"));
  expect(updater.phase.value).toBe("ready");
});

it("does not wait without update data and rejects an already cancelled request", async () => {
  const { wait } = fixture();
  const request = new AbortController();
  await wait(request.signal);
  request.abort(new Error("cancelled"));
  await expect(wait(request.signal)).rejects.toThrow("cancelled");
});

it("finishes when an update check no longer holds the window", async () => {
  const { updater, wait } = fixture();
  const checking = updater.check();
  expect(updater.holdsWindow.value).toBe(true);
  const waiting = wait(new AbortController().signal);
  await checking;
  await waiting;
  expect(updater.holdsWindow.value).toBe(false);
});
