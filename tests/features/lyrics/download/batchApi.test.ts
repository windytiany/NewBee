import { expect, it } from "bun:test";
import * as Vue from "vue";
import type { createLyricsBatch } from "@/features/lyrics/download/batch";
import type { LyricsBatchEvent } from "@/features/lyrics/types";
import type { TagSaveResult } from "@/features/tags/types";
import { evaluateSource, transpileScript } from "../../../support/moduleLoader";

it("wires the production batch through a Channel and round commands without frontend begin/fetch/finish or snapshot reads", async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const edits: number[][] = [];
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  class TestChannel {
    onmessage: (event: LyricsBatchEvent) => void = () => {};
  }
  const result: TagSaveResult = {
    trackId: 7,
    path: "7.mp3",
    fileWritten: false,
    databaseUpdated: false,
    error: "文件为只读",
  };
  const source = await Bun.file("src/features/lyrics/download/batch.ts").text();
  const module = evaluateSource<{ useLyricsBatch: () => ReturnType<typeof createLyricsBatch> }>(
    transpileScript(source),
    {
      vue: Vue,
      "@tauri-apps/api/core": {
        Channel: TestChannel,
        invoke: async (command: string, args?: Record<string, unknown>) => {
          calls.push([command, args]);
          if (command === "run_lyrics_download") {
            const channel = args?.onProgress;
            if (!(channel instanceof TestChannel)) throw new Error("Missing progress channel");
            channel.onmessage({ kind: "started", batchId: 10, total: 1 });
            channel.onmessage({
              kind: "saveRequested",
              batchId: 10,
              stepId: 1,
              trackId: 7,
              path: "7.mp3",
              content: "instrumental",
            });
            await completion;
            return {
              batchId: 10,
              status: "completed",
              results: [{ trackId: 7, kind: "instrumental", result, error: null }],
              error: null,
            };
          }
          if (command === "commit_lyrics_download_step") return result;
          if (command === "complete_lyrics_download_step") {
            resolveCompletion();
            return;
          }
          throw new Error(`Unexpected command: ${command}`);
        },
      },
      "@/features/playback/session": {
        usePlaybackSession: () => ({
          withMetadataEditing: async <T>(ids: readonly number[], save: () => Promise<T>) => {
            edits.push([...ids]);
            return save();
          },
        }),
      },
      "@/shared/notifications/center": {
        notifications: { notify: () => 1, updateTask: () => {}, removeTask: () => {} },
      },
    },
  );
  const batch = module.useLyricsBatch();
  expect(module.useLyricsBatch()).toBe(batch);
  await batch.startTracks([7]);
  expect(edits).toEqual([[7]]);
  expect(calls.map(([command]) => command)).toEqual([
    "run_lyrics_download",
    "commit_lyrics_download_step",
    "complete_lyrics_download_step",
  ]);
  expect(calls[0]?.[1]?.trackIds).toEqual([7]);
  expect(calls[1]?.[1]).toEqual({ batchId: 10, stepId: 1 });
  expect(calls[2]?.[1]).toEqual({ batchId: 10, stepId: 1, error: null });
  expect(batch.state.instrumental).toBe(0);
  expect(batch.state.failed).toBe(1);
});
