import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { t } from "@/shared/i18n/locale";

export function hasClipboardCover(): Promise<boolean> {
  return invoke<boolean>("has_clipboard_artwork");
}

export async function readClipboardCover(): Promise<number[]> {
  const data = await invoke<ArrayBuffer>("read_clipboard_artwork");
  return Array.from(new Uint8Array(data));
}

export async function readOriginalCover(trackId: number | string): Promise<number[]> {
  const data =
    typeof trackId === "string"
      ? await invoke<ArrayBuffer>("get_file_artwork", { path: trackId, size: null })
      : await invoke<ArrayBuffer>("get_track_artwork", { trackId, size: null });
  return Array.from(new Uint8Array(data));
}

export async function pictureMimeType(data: number[]): Promise<string> {
  const extensions = await invoke<string[]>("artwork_extensions", { data });
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    ico: "image/x-icon",
    avif: "image/avif",
    tga: "image/x-tga",
    pbm: "image/x-portable-bitmap",
    pgm: "image/x-portable-graymap",
    ppm: "image/x-portable-pixmap",
    pam: "image/x-portable-arbitrarymap",
    dds: "image/vnd-ms.dds",
    hdr: "image/vnd.radiance",
    exr: "image/x-exr",
    ff: "image/farbfeld",
    qoi: "image/qoi",
  };
  const mimeType = extensions.map((extension) => types[extension]).find(Boolean);
  if (!mimeType) throw new Error(t("无法识别图片格式"));
  return mimeType;
}

export async function saveCover(
  data: number[],
  isCurrent: () => boolean,
): Promise<string | undefined> {
  const extensions = await invoke<string[]>("artwork_extensions", { data });
  if (!isCurrent()) return;
  const path = await save({
    title: t("保存封面"),
    defaultPath: `cover.${extensions[0]}`,
    filters: [{ name: t("封面"), extensions }],
  });
  if (!path || !isCurrent()) return;
  await invoke<void>("save_artwork", { path, data });
  return path;
}

export async function selectCover(): Promise<{ path: string; data: Uint8Array } | null> {
  const path = await open({ multiple: false, directory: false, title: t("添加图片") });
  if (!path || Array.isArray(path)) return null;
  return { path, data: await readCover(path) };
}

export async function readCover(path: string): Promise<Uint8Array> {
  return Uint8Array.from(await invoke<number[]>("read_artwork_file", { path }));
}
