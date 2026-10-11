import { afterEach, describe, expect, it } from "bun:test";
import * as Vue from "vue";
import { compile } from "tailwindcss";
import { evaluateSource, transpileScript } from "../../support/module/loader";

const output = transpileScript(
  await Bun.file(new URL("../../../src/features/settings/motion.ts", import.meta.url)).text(),
);
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("application motion preference", () => {
  it("defaults off, updates the root and notifies synchronously only until unsubscribed", () => {
    const dataset: Record<string, string> = {};
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: { dataset } },
    });
    const motion = evaluateSource<typeof import("@/features/settings/motion")>(output, {
      vue: Vue,
    });
    expect(motion.isReducedMotionEnabled()).toBe(false);
    const changes: boolean[] = [];
    const stop = motion.onReducedMotionChange(() => changes.push(motion.isReducedMotionEnabled()));
    motion.applyReducedMotion(true);
    expect(dataset.reducedMotion).toBe("true");
    expect(changes).toEqual([true]);
    motion.applyReducedMotion(false);
    expect(dataset.reducedMotion).toBe("false");
    expect(changes).toEqual([true, false]);
    stop();
    motion.applyReducedMotion(true);
    expect(changes).toEqual([true, false]);
  });

  it("compiles both Tailwind motion variants against the root instead of system media", async () => {
    const css = await Bun.file(new URL("../../../src/app/styles/main.css", import.meta.url)).text();
    const compiler = await compile(css, {
      loadStylesheet: async (id) => ({
        path: id,
        base: "",
        content: id === "tailwindcss" ? "@tailwind utilities;" : "",
      }),
    });
    const compiled = compiler.build([
      "motion-reduce:transition-none",
      "motion-safe:transition-all",
    ]);
    expect(compiled).toContain(".motion-reduce\\:transition-none");
    expect(compiled).toContain(".motion-safe\\:transition-all");
    expect(compiled).toContain('[data-reduced-motion="true"]');
    expect(compiled).not.toContain("prefers-reduced-motion");
    expect(compiled).toContain("::before");
    expect(compiled).toContain("animation-duration: 0.01ms !important");
    expect(compiled).toContain("transition-duration: 0.01ms !important");
  });
});
