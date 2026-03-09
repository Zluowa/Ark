#![recursion_limit = "256"]
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod core;
mod ui;
mod utils;
mod window;

use crate::window::app::App;
use std::env;
use windows::core::w;
use windows::Win32::Foundation::GetLastError;
use windows::Win32::Foundation::ERROR_ALREADY_EXISTS;
use windows::Win32::System::Threading::CreateMutexW;
use winit::event_loop::EventLoop;
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|arg| arg == "--settings") {
        let config = crate::core::persistence::load_config();
        crate::window::settings::run_settings(config);
    } else if args.iter().any(|arg| arg == "--music-settings") {
        let config = crate::core::persistence::load_config();
        crate::window::music_settings::run_music_settings(config);
    } else {
        unsafe {
            let _ = CreateMutexW(None, true, w!("Global\\WinIsland_SingleInstance_Mutex"));
            if GetLastError() == ERROR_ALREADY_EXISTS {
                return;
            }
        }
        let event_loop = EventLoop::new().unwrap();
        let mut app = App::default();
        event_loop.run_app(&mut app).unwrap();
    }
}
