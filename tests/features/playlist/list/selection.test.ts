import { afterEach, beforeEach, expect, it } from "bun:test";
import * as Vue from "vue";
import type { PlaylistSummary } from "@/features/playlist/types";
import type { usePlaylistSelection } from "@/features/playlist/list/useSelection";
import { evaluateSource, transpileScript } from "../../../support/module/loader";

const source = transpileScript(await Bun.file("src/features/playlist/list/useSelection.ts").text());
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new Map<string, string>();
const warnings: unknown[][] = [];
const scopes: Vue.EffectScope[] = [];
const key = "newbee.playlist-selection";
const first: PlaylistSummary = { id: 1, name: "First", trackCount: 0, coverTrackId: null };
const second: PlaylistSummary = { ...first, id: 2, name: "Second" };
const { usePlaylistSelection: createSelection } = evaluateSource<{
  usePlaylistSelection: typeof usePlaylistSelection;
}>(source, {
  vue: Vue,
  "@/shared/logging/logger": { logger: { warn: (...args: unknown[]) => warnings.push(args) } },
});

beforeEach(() => {
  storage.clear();
  warnings.length = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function selection() {
  const scope = Vue.effectScope();
  scopes.push(scope);
  return scope.run(createSelection)!;
}

it("restores a saved playlist only after the first list arrives and persists later selection", () => {
  storage.set(key, "2");
  const state = selection();
  expect(state.selectedPlaylistId.value).toBeNull();
  expect(storage.get(key)).toBe("2");
  state.setAvailablePlaylists([first, second]);
  expect(state.selectedPlaylist.value).toEqual(second);
  state.selectPlaylist(first);
  expect(state.selectedPlaylistId.value).toBe(1);
  expect(storage.get(key)).toBe("1");
  state.selectPlaylist({ ...first, id: 99 });
  expect(state.selectedPlaylistId.value).toBe(1);
});

for (const saved of ["0", "-1", "1.5", "9007199254740992", "99", "invalid"]) {
  it(`rejects unavailable or invalid saved ID ${saved}`, () => {
    storage.set(key, saved);
    const state = selection();
    state.setAvailablePlaylists([first, second]);
    expect(state.selectedPlaylistId.value).toBeNull();
    expect(state.selectedPlaylist.value).toBeNull();
    expect(storage.has(key)).toBe(false);
  });
}

it("keeps selection across list updates and clears it when the selected playlist disappears", () => {
  const state = selection();
  state.setAvailablePlaylists([first, second]);
  state.selectPlaylist(second);
  state.setAvailablePlaylists([first, { ...second, name: "Renamed" }]);
  expect(state.selectedPlaylist.value?.name).toBe("Renamed");
  state.setAvailablePlaylists([first]);
  expect(state.selectedPlaylistId.value).toBeNull();
  expect(storage.has(key)).toBe(false);
  state.setAvailablePlaylists([first, second]);
  expect(state.selectedPlaylistId.value).toBeNull();
});

it("keeps selection usable when storage fails and logs the owning module", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("Storage unavailable");
    },
  });
  const state = selection();
  state.setAvailablePlaylists([first, second]);
  state.selectPlaylist(second);
  expect(state.selectedPlaylistId.value).toBe(2);
  expect(warnings).toHaveLength(3);
  expect(warnings.every(([owner]) => owner === "features/playlist/list/useSelection")).toBe(true);
});
