import { describe, expect, it } from "bun:test";
import { createWindowRelease } from "@/app/window/release";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides: Partial<Parameters<typeof createWindowRelease>[0]> = {}) {
  const calls: string[] = [];
  const gate = createWindowRelease({
    prepare: async () => {
      calls.push("prepare");
      return true;
    },
    hide: async (id) => {
      calls.push(`hide:${id}`);
      return true;
    },
    idle: async () => {
      calls.push("idle");
    },
    release: async (id) => {
      calls.push(`release:${id}`);
    },
    cancel: async (id) => {
      calls.push(`cancel:${id}`);
    },
    failed: () => {
      calls.push("failed");
    },
    ...overrides,
  });
  return { ...gate, calls };
}

describe("window release", () => {
  it("checks drafts before hiding and releases only after dependent work completes", async () => {
    const idle = deferred();
    const gate = fixture({ idle: () => idle.promise });
    const request = gate.request(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.calls).toEqual(["prepare", "hide:1"]);
    idle.resolve();
    await request;
    expect(gate.calls).toEqual(["prepare", "hide:1", "release:1"]);
  });

  it("does not hide or release when the user declines draft discard", async () => {
    const gate = fixture({ prepare: async () => false });
    await gate.request(1);
    expect(gate.calls).toEqual(["cancel:1"]);
  });

  it("cancels a delayed release when the window is reopened", async () => {
    const idle = deferred();
    const gate = fixture({ idle: () => idle.promise });
    const request = gate.request(1);
    await Promise.resolve();
    await Promise.resolve();
    gate.cancel();
    idle.resolve();
    await request;
    expect(gate.calls).not.toContain("release:1");
    expect(gate.calls).not.toContain("failed");
  });

  it("ignores confirmation returned after a restore", async () => {
    const confirmation = deferred();
    const gate = fixture({
      prepare: async () => {
        await confirmation.promise;
        return true;
      },
    });
    const request = gate.request(1);
    gate.cancel();
    confirmation.resolve();
    await request;
    expect(gate.calls).toEqual([]);
  });

  it("cannot release a request superseded by a later request", async () => {
    const idle = deferred();
    let waits = 0;
    const gate = fixture({ idle: () => (++waits === 1 ? idle.promise : Promise.resolve()) });
    const first = gate.request(1);
    await Promise.resolve();
    await Promise.resolve();
    await gate.request(2);
    idle.resolve();
    await first;
    expect(gate.calls).toContain("release:2");
    expect(gate.calls).not.toContain("release:1");
  });

  it("does not release if the backend rejects a stale hide request", async () => {
    const gate = fixture({ hide: async () => false });
    await gate.request(1);
    expect(gate.calls).toEqual(["prepare"]);
  });

  it("falls back to ordinary tray mode when preparation fails", async () => {
    let fallback: boolean | undefined;
    const gate = fixture({
      prepare: async () => {
        throw new Error("prepare failed");
      },
      cancel: async (_id, hide) => {
        fallback = hide;
      },
    });
    await gate.request(1);
    expect(fallback).toBe(true);
    expect(gate.calls).toEqual(["failed"]);
  });

  it("reports only once even when cancellation also fails", async () => {
    const gate = fixture({
      prepare: async () => {
        throw new Error("prepare failed");
      },
      cancel: async () => {
        throw new Error("cancel failed");
      },
    });
    await gate.request(1);
    expect(gate.calls).toEqual(["failed"]);
  });

  it("reports a release failure once without retrying", async () => {
    const gate = fixture({
      release: async () => {
        throw new Error("release failed");
      },
    });
    await gate.request(1);
    expect(gate.calls).toEqual(["prepare", "hide:1", "idle", "cancel:1", "failed"]);
  });
});
