import { expect, it } from "bun:test";
import * as Vue from "vue";
import { evaluateModule, transpileScript } from "../../support/module/loader";
import { playbackFixture, playbackReply, playbackSnapshot } from "../../support/playback/session";
import type { PlaybackSessionReply } from "@/features/playback/session";

const output = transpileScript(
  await Bun.file("src/features/playback/composables/useVolume.ts").text(),
);
function controls(fixture: ReturnType<typeof playbackFixture>) {
  return evaluateModule<typeof import("@/features/playback/composables/useVolume")>(output, {
    vue: Vue,
    "@/features/playback/session": { usePlaybackSession: () => fixture.session },
  }).usePlaybackVolume();
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("uses restored backend volume without local storage or a startup volume command", async () => {
  const fixture = playbackFixture({ initialSnapshot: playbackSnapshot({ volume: 0 }) });
  await fixture.session.ready;
  const volume = controls(fixture);
  expect(volume.volume.value).toBe(0);
  expect(fixture.calls).toEqual(["snapshot"]);
  fixture.emit({ volume: 27 });
  expect(volume.volume.value).toBe(27);
});

it("retains only slider preview while a backend volume command is pending", async () => {
  const fixture = playbackFixture({ initialSnapshot: playbackSnapshot({ volume: 27 }) });
  await fixture.session.ready;
  const volume = controls(fixture);
  let resolve!: (reply: PlaybackSessionReply) => void;
  fixture.defer(
    new Promise<PlaybackSessionReply>((done) => {
      resolve = done;
    }),
  );
  volume.volume.value = 75;
  expect(volume.volume.value).toBe(75);
  expect(fixture.session.state.volume.value).toBe(27);
  expect(fixture.commands[fixture.commands.length - 1]).toEqual({ action: "volume", volume: 75 });
  resolve(
    playbackReply({ ...fixture.snapshot, revision: fixture.snapshot.revision + 1, volume: 75 }),
  );
  await settle();
  expect(volume.volume.value).toBe(75);
  expect(fixture.session.state.volume.value).toBe(75);
});

it("a late slider response cannot override a newer authoritative volume event", async () => {
  const fixture = playbackFixture();
  await fixture.session.ready;
  const volume = controls(fixture);
  let resolve!: (reply: PlaybackSessionReply) => void;
  fixture.defer(
    new Promise<PlaybackSessionReply>((done) => {
      resolve = done;
    }),
  );
  const oldRevision = fixture.snapshot.revision;
  volume.volume.value = 20;
  fixture.emit({ volume: 80 });
  resolve(playbackReply(playbackSnapshot({ revision: oldRevision, volume: 20 })));
  await settle();
  expect(volume.volume.value).toBe(80);
});

it("mute is a backend operation, not a frontend remembered-volume decision", async () => {
  const fixture = playbackFixture({ initialSnapshot: playbackSnapshot({ volume: 31 }) });
  await fixture.session.ready;
  const volume = controls(fixture);
  fixture.defer(
    Promise.resolve(
      playbackReply({ ...fixture.snapshot, revision: fixture.snapshot.revision + 1, volume: 0 }),
    ),
  );
  await volume.toggleMute();
  expect(fixture.commands[fixture.commands.length - 1]).toEqual({ action: "mute" });
  expect(volume.volume.value).toBe(0);
  fixture.defer(
    Promise.resolve(
      playbackReply({ ...fixture.snapshot, revision: fixture.snapshot.revision + 1, volume: 31 }),
    ),
  );
  await volume.toggleMute();
  expect(volume.volume.value).toBe(31);
});
