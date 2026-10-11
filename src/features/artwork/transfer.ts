import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { t } from "@/shared/i18n/locale";

export function hasClipboardCover(): Promise<boolean> {
  return invoke<boolean>("has_clipboard_artwork");
}

export async function readClipboardCover(): Promise<number[]> {
  const data = await invoke<ArrayBuffer>("read_clipboard_artwork");
  return Array.from(new Uint8Array(data));
}

export async function readOriginalCover(trackId: number): Promise<number[]> {
  const data = await invoke<ArrayBuffer>("get_track_artwork", { trackId, size: null });
  return Array.from(new Uint8Array(data));
}

export async function saveCover(data: number[], isCurrent: () => boolean): Promise<void> {
  const extensions = await invoke<string[]>("artwork_extensions", { data });
  if (!isCurrent()) return;
  const path = await save({
    title: t("保存封面"),
    defaultPath: `cover.${extensions[0]}`,
    filters: [{ name: t("封面"), extensions }],
  });
  if (!path || !isCurrent()) return;
  await invoke<void>("save_artwork", { path, data });
}
