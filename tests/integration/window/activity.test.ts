import { expect, it } from "bun:test";
import { nextTick } from "vue";
import { createMetadataSave } from "@/features/metadata/save";
import { waitForIdle } from "@/shared/lifecycle/activity";
import { createWindowRelease } from "@/app/window/release";

it("keeps the WebView alive through metadata writes and subsequent playback synchronization", async () => {
  let finishWrite!: () => void;
  let finishSynchronization!: () => void;
  const written = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const synchronized = new Promise<void>((resolve) => {
    finishSynchronization = resolve;
  });
  const save = createMetadataSave({
    editFiles: (_ids, action) => action(),
    synchronize: () => synchronized,
  });
  const saving = save.run({
    targets: [{ trackId: 1, path: "D:/Music/track.flac" }],
    writeTrackIds: [1],
    execute: async () => {
      await written;
      return [
        {
          trackId: 1,
          path: "D:/Music/track.flac",
          fileWritten: true,
          databaseUpdated: true,
          error: null,
        },
      ];
    },
  });
  let released = false;
  const gate = createWindowRelease({
    prepare: async () => true,
    hide: async () => true,
    idle: waitForIdle,
    release: async () => {
      released = true;
    },
    cancel: async () => {},
    failed: (error) => {
      throw error;
    },
  });
  const entering = gate.request(1);
  await nextTick();
  expect(released).toBe(false);
  finishWrite();
  await nextTick();
  expect(released).toBe(false);
  expect(save.state.saving).toBe(true);
  finishSynchronization();
  await saving;
  await entering;
  expect(released).toBe(true);
});
