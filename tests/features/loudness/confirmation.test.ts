import { expect, it } from "bun:test";
import { createLoudnessConfirmation } from "@/features/loudness/confirmation";

it("waits for application confirmation and rejects overlapping requests", async () => {
  const confirmation = createLoudnessConfirmation();
  let completed = false;
  const pending = confirmation.ask("分析响度", "覆盖标签？").then((confirmed) => {
    completed = true;
    return confirmed;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(confirmation.state.value).toEqual({ title: "分析响度", message: "覆盖标签？" });
  expect(await confirmation.ask("恢复原始响度", "移除标签？")).toBe(false);
  expect(confirmation.state.value?.title).toBe("分析响度");
  confirmation.resolve(true);
  expect(await pending).toBe(true);
  expect(confirmation.state.value).toBeNull();
});

it("cancels without accepting and permits subsequent operations", async () => {
  const confirmation = createLoudnessConfirmation();
  const first = confirmation.ask("分析响度", "覆盖标签？");
  confirmation.resolve(false);
  confirmation.resolve(true);
  expect(await first).toBe(false);
  const second = confirmation.ask("恢复原始响度", "移除标签？");
  expect(confirmation.state.value?.title).toBe("恢复原始响度");
  confirmation.resolve(true);
  expect(await second).toBe(true);
});
