use super::ClipboardImage;
use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf};
use windows::{
    core::w,
    Win32::{
        Foundation::HGLOBAL,
        System::{
            DataExchange::{
                CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
                RegisterClipboardFormatW,
            },
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
        UI::Shell::{DragQueryFileW, HDROP},
    },
};

const CF_DIB: u32 = 8;
const CF_HDROP: u32 = 15;
const CF_DIBV5: u32 = 17;
const MAX_BITMAP_BYTES: usize = 256 * 1024 * 1024;

struct OpenClipboardGuard;
impl Drop for OpenClipboardGuard {
    fn drop(&mut self) {
        // This guard owns the clipboard opened on the same thread.
        if let Err(error) = unsafe { CloseClipboard() } {
            log::warn!("event=clipboard_close_failed error={error}");
        }
    }
}

pub(super) fn read() -> Result<ClipboardImage, String> {
    // Open only for copying handles/data; file reads and decoding happen after closing.
    unsafe { OpenClipboard(None) }.map_err(|error| format!("打开剪贴板失败：{error}"))?;
    let _clipboard = OpenClipboardGuard;
    if available(CF_HDROP) {
        return copied_file();
    }
    for name in [w!("PNG"), w!("JFIF")] {
        let format = unsafe { RegisterClipboardFormatW(name) };
        if format == 0 {
            return Err("读取剪贴板图片格式失败。".into());
        }
        if available(format) {
            return copy_data(format).map(ClipboardImage::Encoded);
        }
    }
    for format in [CF_DIBV5, CF_DIB] {
        if available(format) {
            return copy_data(format).map(ClipboardImage::Bitmap);
        }
    }
    Ok(ClipboardImage::Empty)
}

fn available(format: u32) -> bool {
    unsafe { IsClipboardFormatAvailable(format) }.is_ok()
}

fn copied_file() -> Result<ClipboardImage, String> {
    let handle = unsafe { GetClipboardData(CF_HDROP) }
        .map_err(|error| format!("读取剪贴板文件失败：{error}"))?;
    let drop = HDROP(handle.0);
    // CF_HDROP is owned by the clipboard and stays valid until our guard closes it.
    if unsafe { DragQueryFileW(drop, u32::MAX, None) } != 1 {
        return Ok(ClipboardImage::Empty);
    }
    let length = unsafe { DragQueryFileW(drop, 0, None) } as usize;
    if length == 0 || length > 32767 {
        return Err("剪贴板图片文件路径无效。".into());
    }
    let mut path = vec![0; length + 1];
    if unsafe { DragQueryFileW(drop, 0, Some(&mut path)) } as usize != length {
        return Err("读取剪贴板图片文件路径失败。".into());
    }
    Ok(ClipboardImage::File(PathBuf::from(OsString::from_wide(
        &path[..length],
    ))))
}

fn copy_data(format: u32) -> Result<Vec<u8>, String> {
    let handle = unsafe { GetClipboardData(format) }
        .map_err(|error| format!("读取剪贴板图片失败：{error}"))?;
    let memory = HGLOBAL(handle.0);
    let size = unsafe { GlobalSize(memory) };
    if size == 0 || size > MAX_BITMAP_BYTES {
        return Err("剪贴板图片为空或过大。".into());
    }
    let pointer = unsafe { GlobalLock(memory) };
    if pointer.is_null() {
        return Err("读取剪贴板图片内存失败。".into());
    }
    // The locked HGLOBAL has `size` readable bytes and remains owned by the clipboard.
    let data = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), size) }.to_vec();
    // GlobalUnlock returns false when the lock count reaches zero, even on success.
    let _ = unsafe { GlobalUnlock(memory) };
    Ok(data)
}
