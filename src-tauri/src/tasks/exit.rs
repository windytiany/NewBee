use super::QUEUE;
use crate::{
    locking::WriteState,
    settings::{Locale, SettingsState},
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

static CONFIRMING: AtomicBool = AtomicBool::new(false);
static APPROVED: AtomicBool = AtomicBool::new(false);

pub(crate) fn intercept(app: &tauri::AppHandle) -> bool {
    if APPROVED.load(Ordering::Acquire) {
        return false;
    }
    {
        let queue = QUEUE.lock().unwrap();
        if queue.restoring {
            return true;
        }
        if queue.pending.is_empty() {
            return false;
        }
    }
    if CONFIRMING.swap(true, Ordering::AcqRel) {
        return true;
    }
    let english = app
        .state::<SettingsState>()
        .get()
        .is_ok_and(|settings| settings.locale == Locale::En);
    let (message, quit, cancel) = if english {
        (
            "Unfinished tasks will be cancelled. Quit?",
            "Quit",
            "Cancel",
        )
    } else {
        ("未完成的任务将被取消，是否退出？", "退出", "取消")
    };
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title("NewBee")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            quit.into(),
            cancel.into(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                CONFIRMING.store(false, Ordering::Release);
                return;
            }
            {
                let mut queue = QUEUE.lock().unwrap();
                queue.restoring = true;
                for entry in &queue.pending {
                    entry.cancelled.store(true, Ordering::Release);
                }
            }
            if let Err(error) = handle
                .state::<crate::lyrics::batch::LyricsBatchState>()
                .cancel_active()
            {
                log::warn!("Could not cancel lyrics during exit: {error}");
            }
            tauri::async_runtime::spawn_blocking(move || {
                loop {
                    let idle = QUEUE.lock().unwrap().pending.is_empty();
                    if idle && handle.state::<WriteState>().available() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                APPROVED.store(true, Ordering::Release);
                handle.exit(0);
            });
        });
    true
}
