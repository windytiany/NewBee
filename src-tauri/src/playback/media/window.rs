use windows::{
    core::w,
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::WindowsAndMessaging::{
            CreateWindowExW, PostMessageW, WM_CLOSE, WS_EX_TOOLWINDOW, WS_POPUP,
        },
    },
};

// Created on the application's UI thread. Its native message loop also dispatches
// this window's messages; no browser environment or additional thread is needed.
pub(super) struct MediaWindow(isize);

impl MediaWindow {
    pub(super) fn new() -> windows::core::Result<Self> {
        // STATIC is a system-registered class. Omitting WS_VISIBLE keeps this
        // unowned top-level window hidden for its entire lifetime.
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("NewBee Media"),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                None,
                None,
            )?
        };
        Ok(Self(hwnd.0 as isize))
    }

    pub(super) fn hwnd(&self) -> HWND {
        HWND(self.0 as *mut std::ffi::c_void)
    }
}

impl Drop for MediaWindow {
    fn drop(&mut self) {
        // State can be dropped off the UI thread. Let the owning thread destroy
        // the HWND rather than calling DestroyWindow from the wrong thread.
        if let Err(error) =
            unsafe { PostMessageW(Some(self.hwnd()), WM_CLOSE, WPARAM(0), LPARAM(0)) }
        {
            log::warn!("Could not close media control window: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;

    #[test]
    fn media_window_is_hidden_and_owns_a_valid_media_control_handle() {
        use windows::{
            core::factory, Media::SystemMediaTransportControls,
            Win32::System::WinRT::ISystemMediaTransportControlsInterop,
        };
        let window = MediaWindow::new().unwrap();
        assert!(!unsafe { IsWindowVisible(window.hwnd()) }.as_bool());
        let interop: ISystemMediaTransportControlsInterop =
            factory::<SystemMediaTransportControls, _>().unwrap();
        let controls: SystemMediaTransportControls =
            unsafe { interop.GetForWindow(window.hwnd()) }.unwrap();
        controls.SetIsEnabled(false).unwrap();
    }
}
