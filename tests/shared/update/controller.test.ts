import { describe, expect, it } from "bun:test";
import { createUpdater } from "@/shared/update/controller";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const events: string[] = [];
  const failures: string[] = [];
  const resource = {
    version: "0.2.0",
    download: async (progress?: (event: DownloadEvent) => void) => {
      events.push("download");
      progress?.({ event: "Started", data: { contentLength: 100 } });
      progress?.({ event: "Progress", data: { chunkLength: 40 } });
      progress?.({ event: "Progress", data: { chunkLength: 60 } });
      progress?.({ event: "Finished" });
    },
    install: async (options?: { restartAfterInstall?: boolean }) => {
      events.push(`install:${options?.restartAfterInstall}`);
    },
    close: async () => {
      events.push("close");
    },
  };
  let result: typeof resource | null = resource;
  const updater = createUpdater({
    supported: true,
    check: async (options) => {
      expect(options.timeout).toBe(15_000);
      events.push("check");
      return result;
    },
    failed: (event) => failures.push(event),
  });
  return {
    updater,
    resource,
    events,
    failures,
    latest: () => {
      result = null;
    },
  };
}

describe("update controller", () => {
  it("only downloads and restarts after separate explicit actions", async () => {
    const { updater, events } = fixture();
    await updater.install();
    await updater.download();
    expect(events).toEqual([]);
    await updater.check();
    expect(updater.phase.value).toBe("available");
    expect(updater.version.value).toBe("0.2.0");
    expect(events).toEqual(["check"]);
    await updater.download();
    expect(updater.phase.value).toBe("ready");
    expect(updater.downloaded.value).toBe(100);
    expect(updater.total.value).toBe(100);
    expect(updater.holdsWindow.value).toBe(true);
    await updater.check();
    expect(events).toEqual(["check", "download"]);
    await updater.install();
    await updater.install();
    expect(events).toEqual(["check", "download", "install:true"]);
    expect(updater.phase.value).toBe("installing");
  });

  it("releases superseded resources and reports latest only on successful checks", async () => {
    const { updater, events, latest } = fixture();
    await updater.check();
    latest();
    await updater.check();
    expect(events).toEqual(["check", "close", "check"]);
    expect(updater.phase.value).toBe("latest");
    expect(updater.version.value).toBe("");
    expect(updater.holdsWindow.value).toBe(false);
  });

  it("deduplicates checks and does not show an error as up to date", async () => {
    const pending = deferred<null>();
    let checks = 0;
    const failures: string[] = [];
    const updater = createUpdater({
      supported: true,
      check: () => {
        checks++;
        return pending.promise;
      },
      failed: (event) => failures.push(event),
    });
    const first = updater.check();
    const second = updater.check();
    expect(first).toBe(second);
    expect(updater.busy.value).toBe(true);
    expect(updater.holdsWindow.value).toBe(true);
    pending.reject(new Error("HTTP 404 private repository"));
    await Promise.all([first, second]);
    expect(checks).toBe(1);
    expect(updater.phase.value).toBe("idle");
    expect(updater.error.value).toBe("检查更新失败，请稍后重试");
    expect(updater.holdsWindow.value).toBe(false);
    expect(failures).toEqual(["check_failed"]);
  });

  it("waits for verification, handles unknown length and retries download failures", async () => {
    const { updater, resource, events, failures } = fixture();
    const verification = deferred<void>();
    let attempts = 0;
    resource.download = async (progress) => {
      attempts++;
      progress?.({ event: "Started", data: {} });
      progress?.({ event: "Progress", data: { chunkLength: 12 } });
      progress?.({ event: "Finished" });
      await verification.promise;
    };
    await updater.check();
    const download = updater.download();
    await updater.download();
    await updater.check();
    await updater.install();
    expect(attempts).toBe(1);
    expect(updater.phase.value).toBe("downloading");
    expect(updater.total.value).toBeUndefined();
    expect(updater.downloaded.value).toBe(12);
    expect(events).toEqual(["check"]);
    verification.reject(new Error("invalid signature"));
    await download;
    expect(updater.phase.value).toBe("available");
    expect(updater.error.value).toBe("下载或验证更新失败，请重试");
    expect(failures).toEqual(["download_failed"]);
    resource.download = async () => {};
    await updater.download();
    expect(updater.error.value).toBe("");
    expect(updater.phase.value).toBe("ready");
  });

  it("retains verified bytes for retry after an installation failure", async () => {
    const { updater, resource, failures } = fixture();
    let attempts = 0;
    resource.install = async () => {
      attempts++;
      throw new Error("installer unavailable");
    };
    await updater.check();
    await updater.download();
    await updater.install();
    expect(updater.phase.value).toBe("ready");
    expect(updater.error.value).toBe("安装更新失败，请重试");
    expect(failures).toEqual(["install_failed"]);
    resource.install = async () => {
      attempts++;
    };
    await updater.install();
    expect(attempts).toBe(2);
    expect(updater.error.value).toBe("");
  });

  it("logs cleanup failures but still allows another check", async () => {
    const { updater, resource, failures, latest } = fixture();
    await updater.check();
    resource.close = async () => {
      throw new Error("resource gone");
    };
    latest();
    await updater.check();
    expect(updater.phase.value).toBe("latest");
    expect(failures).toEqual(["resource_release_failed"]);
  });

  it("does not invoke native APIs in unsupported environments", async () => {
    const updater = createUpdater({
      supported: false,
      check: async () => {
        throw new Error("native API must not run");
      },
      failed: () => {
        throw new Error("unexpected failure");
      },
    });
    await updater.check();
    await updater.download();
    await updater.install();
    expect(updater.phase.value).toBe("idle");
  });
});
