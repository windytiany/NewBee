import { invoke, isTauri } from "@tauri-apps/api/core";

export const BACKUP_INTERFACE_KEYS = [
  "newbee.active-page",
  "newbee.sidebar-layout",
  "newbee.library-selection",
  "newbee.playlist-selection",
  "newbee.playing-presentation",
  "newbee.scroll-positions",
] as const;

export type BackupInterfaceState = Partial<Record<(typeof BACKUP_INTERFACE_KEYS)[number], string>>;

export function captureInterfaceState(
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
): BackupInterfaceState {
  const state: BackupInterfaceState = {};
  for (const key of BACKUP_INTERFACE_KEYS) {
    const value = storage.getItem(key);
    if (value !== null) state[key] = value;
  }
  return state;
}

export function applyInterfaceState(
  state: BackupInterfaceState,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = globalThis.localStorage,
) {
  const previous = captureInterfaceState(storage);
  const apply = (values: BackupInterfaceState) => {
    for (const key of BACKUP_INTERFACE_KEYS) {
      const value = values[key];
      if (value === undefined) storage.removeItem(key);
      else storage.setItem(key, value);
    }
  };
  try {
    apply(state);
  } catch (error) {
    apply(previous);
    throw error;
  }
}

export async function restoreInterfaceState() {
  if (!isTauri()) return;
  const error = await invoke<string | null>("get_backup_restore_error");
  if (error !== null) throw new Error(error);
  const state = await invoke<BackupInterfaceState | null>("get_restored_interface_state");
  if (state === null) return;
  applyInterfaceState(state);
  await invoke<void>("acknowledge_interface_restore");
}
