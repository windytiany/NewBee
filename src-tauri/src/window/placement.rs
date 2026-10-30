use tauri::WebviewWindow;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_CLOAK, DWMWA_TRANSITIONS_FORCEDISABLED,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowPlacement, SetWindowPlacement, SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, SW_SHOWNORMAL,
    WINDOWPLACEMENT, WPF_RESTORETOMAXIMIZED,
};

pub(super) struct Placement(WINDOWPLACEMENT);

pub(crate) fn prepare_borderless(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = windows::Win32::Foundation::HWND(window.hwnd().map_err(|e| e.to_string())?.0);
    // Recalculate the hidden window's client area before the WebView lays out.
    // Otherwise its first show removes the cached caption/border insets and
    // resizes the viewport after the logo is already visible.
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| error.to_string())
}

pub(super) fn cloak(window: &WebviewWindow, cloaked: bool) -> Result<(), String> {
    let hwnd = windows::Win32::Foundation::HWND(window.hwnd().map_err(|e| e.to_string())?.0);
    let value = i32::from(cloaked);
    // Suppress the restore/maximize transition as well as the intermediate frame.
    for attribute in if cloaked {
        [DWMWA_TRANSITIONS_FORCEDISABLED, DWMWA_CLOAK]
    } else {
        [DWMWA_CLOAK, DWMWA_TRANSITIONS_FORCEDISABLED]
    } {
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                &value as *const i32 as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            )
        }
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn restored_show_command(placement: &WINDOWPLACEMENT) -> u32 {
    let maximized = placement.showCmd == SW_SHOWMAXIMIZED.0 as u32
        || (placement.showCmd == SW_SHOWMINIMIZED.0 as u32
            && placement.flags.0 & WPF_RESTORETOMAXIMIZED.0 != 0);
    if maximized {
        SW_SHOWMAXIMIZED
    } else {
        SW_SHOWNORMAL
    }
    .0 as u32
}

impl Placement {
    pub(super) fn capture(window: &WebviewWindow) -> Result<Self, String> {
        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        let hwnd = windows::Win32::Foundation::HWND(window.hwnd().map_err(|e| e.to_string())?.0);
        // The native placement retains the normal bounds even when maximized.
        unsafe { GetWindowPlacement(hwnd, &mut placement) }.map_err(|e| e.to_string())?;
        placement.showCmd = restored_show_command(&placement);
        Ok(Self(placement))
    }

    pub(super) fn restore(&self, window: &WebviewWindow) -> Result<(), String> {
        let hwnd = windows::Win32::Foundation::HWND(window.hwnd().map_err(|e| e.to_string())?.0);
        // Avoid round-tripping borderless client sizes through the window-state
        // cache: Windows' non-client frame can otherwise accumulate on rebuild.
        // The caller cloaks the HWND while native placement and layout are restored.
        unsafe { SetWindowPlacement(hwnd, &self.0) }.map_err(|e| e.to_string())
    }
}
