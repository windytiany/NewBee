import { expect, it } from "bun:test";
import { createReplayGainConfirmation } from "@/features/metadata/replaygain/confirmation";

it("waits for application confirmation and rejects overlapping requests", async () => {
  const confirmation = createReplayGainConfirmation();
  let completed = false;
  const pending = confirmation
    .ask("分析 ReplayGain", "覆盖 ReplayGain 标签？")
    .then((confirmed) => {
      completed = true;
      return confirmed;
    });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(confirmation.state.value).toEqual({
    title: "分析 ReplayGain",
    message: "覆盖 ReplayGain 标签？",
  });
  expect(await confirmation.ask("移除 ReplayGain 标签", "移除 ReplayGain 标签？")).toBe(false);
  expect(confirmation.state.value?.title).toBe("分析 ReplayGain");
  confirmation.resolve(true);
  expect(await pending).toBe(true);
  expect(confirmation.state.value).toBeNull();
});

it("cancels without accepting and permits subsequent operations", async () => {
  const confirmation = createReplayGainConfirmation();
  const first = confirmation.ask("分析 ReplayGain", "覆盖 ReplayGain 标签？");
  confirmation.resolve(false);
  confirmation.resolve(true);
  expect(await first).toBe(false);
  const second = confirmation.ask("移除 ReplayGain 标签", "移除 ReplayGain 标签？");
  expect(confirmation.state.value?.title).toBe("移除 ReplayGain 标签");
  confirmation.resolve(true);
  expect(await second).toBe(true);
});
