import { expect, test } from "bun:test";
import { createUpdater } from "../../../src/shared/update/controller";

test("installation waits for verification and repeated confirmation cannot install twice", async () => {
  let finishDownload!: () => void;
  let finishInstall!: () => void;
  let installs = 0;
  const updater = createUpdater({
    supported: true,
    failed: () => {},
    check: async () => ({
      version: "0.3.0",
      close: async () => {},
      download: () => new Promise<void>((resolve) => (finishDownload = resolve)),
      install: async (options) => {
        expect(options?.restartAfterInstall).toBe(true);
        installs++;
        await new Promise<void>((resolve) => (finishInstall = resolve));
      },
    }),
  });

  await updater.check();
  expect(updater.dialogOpen.value).toBe(true);
  expect(installs).toBe(0);
  const updating = updater.update();
  await updater.update();
  updater.dismiss();
  expect(updater.dialogOpen.value).toBe(true);
  expect(installs).toBe(0);
  finishDownload();
  await Promise.resolve();
  await Promise.resolve();
  expect(updater.phase.value).toBe("installing");
  await updater.update();
  expect(installs).toBe(1);
  finishInstall();
  await updating;
});

test("failed verification cannot install; failed installation retries without another download", async () => {
  let downloads = 0;
  let installs = 0;
  const updater = createUpdater({
    supported: true,
    failed: () => {},
    check: async () => ({
      version: "0.3.0",
      close: async () => {},
      download: async () => {
        if (++downloads === 1) throw new Error("invalid signature");
      },
      install: async () => {
        if (++installs === 1) throw new Error("installer failed");
      },
    }),
  });

  await updater.check();
  await updater.update();
  expect(installs).toBe(0);
  expect(updater.phase.value).toBe("available");
  expect(updater.error.value).not.toBe("");
  await updater.update();
  expect(updater.phase.value).toBe("ready");
  expect(updater.error.value).not.toBe("");
  updater.dismiss();
  await updater.check();
  expect(updater.dialogOpen.value).toBe(true);
  await updater.update();
  expect(downloads).toBe(2);
  expect(installs).toBe(2);
  expect(updater.error.value).toBe("");
});
