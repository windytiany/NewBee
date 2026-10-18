use crate::settings::{Locale, SettingsState};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

fn show_main_window(app: &AppHandle) {
    if let Err(error) = super::restore_main_window(app) {
        log::warn!("Could not restore main window: {error}");
    }
}

fn menu_labels(locale: Locale) -> [&'static str; 6] {
    match locale {
        Locale::ZhCn => [
            "显示 NewBee",
            "进入轻量模式",
            "上一首",
            "播放/暂停",
            "下一首",
            "退出",
        ],
        Locale::En => [
            "Show NewBee",
            "Enter lightweight mode",
            "Previous",
            "Play/Pause",
            "Next",
            "Quit",
        ],
    }
}

fn create_menu<R: tauri::Runtime>(app: &AppHandle<R>, locale: Locale) -> tauri::Result<Menu<R>> {
    let [show, lightweight, previous, toggle, next, exit] = menu_labels(locale);
    let show = MenuItem::with_id(app, "show", show, true, None::<&str>)?;
    let lightweight = MenuItem::with_id(app, "lightweight", lightweight, true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", previous, true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", toggle, true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", next, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "exit", exit, true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show,
            &lightweight,
            &previous,
            &toggle,
            &next,
            &separator,
            &exit,
        ],
    )
}

pub fn update_locale<R: tauri::Runtime>(app: &AppHandle<R>, locale: Locale) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };
    tray.set_menu(Some(create_menu(app, locale)?))
}

pub fn initialize(app: &AppHandle) -> tauri::Result<()> {
    let settings = app
        .state::<SettingsState>()
        .get()
        .map_err(std::io::Error::other)?;
    let menu = create_menu(app, settings.locale)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("NewBee")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "exit" => app.exit(0),
            "lightweight" => {
                if let Err(error) = super::lightweight::request(app) {
                    super::lightweight::report_error(app, &error);
                }
            }
            command @ ("previous" | "toggle" | "next") => {
                crate::playback::session::system_command(app, command);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_menu_labels_follow_locale() {
        assert_eq!(
            menu_labels(Locale::ZhCn),
            [
                "显示 NewBee",
                "进入轻量模式",
                "上一首",
                "播放/暂停",
                "下一首",
                "退出"
            ]
        );
        assert_eq!(
            menu_labels(Locale::En),
            [
                "Show NewBee",
                "Enter lightweight mode",
                "Previous",
                "Play/Pause",
                "Next",
                "Quit"
            ]
        );
    }
}
