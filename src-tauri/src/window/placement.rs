use tauri::WebviewWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowPlacement, SetWindowPlacement, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, SW_SHOWNORMAL,
    WINDOWPLACEMENT, WPF_RESTORETOMAXIMIZED,
};

pub(super) struct Placement(WINDOWPLACEMENT);

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
        // Called only after the frontend's first painted frame, since this may show it.
        unsafe { SetWindowPlacement(hwnd, &self.0) }.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restoration_unminimizes_without_losing_maximization() {
        for (command, flags, expected) in [
            (SW_SHOWNORMAL, 0, SW_SHOWNORMAL),
            (SW_SHOWMAXIMIZED, 0, SW_SHOWMAXIMIZED),
            (SW_SHOWMINIMIZED, 0, SW_SHOWNORMAL),
            (SW_SHOWMINIMIZED, WPF_RESTORETOMAXIMIZED.0, SW_SHOWMAXIMIZED),
            (SW_SHOWNORMAL, WPF_RESTORETOMAXIMIZED.0, SW_SHOWNORMAL),
        ] {
            let mut placement = WINDOWPLACEMENT {
                showCmd: command.0 as u32,
                ..Default::default()
            };
            placement.flags.0 = flags;
            assert_eq!(restored_show_command(&placement), expected.0 as u32);
        }
    }
}
