use crate::core::config::WINDOW_TITLE;
use std::iter;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::{
    Shell_NotifyIconW, NOTIFYICONDATAW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE,
    NIM_SETVERSION, NOTIFYICON_VERSION_4,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
    DispatchMessageW, GetCursorPos, GetWindowLongPtrW, LoadCursorW, LoadIconW, ModifyMenuW,
    PeekMessageW, PostMessageW, RegisterClassW, SetForegroundWindow, SetWindowLongPtrW,
    TrackPopupMenu, TranslateMessage, CW_USEDEFAULT, GWLP_USERDATA, HMENU, IDC_ARROW,
    IDI_APPLICATION, MF_BYCOMMAND, MF_STRING, MSG, PM_REMOVE, TPM_BOTTOMALIGN, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_APP, WM_COMMAND,
    WM_CONTEXTMENU, WM_CREATE, WM_DESTROY, WM_LBUTTONUP, WM_NCCREATE, WM_RBUTTONUP, WNDCLASSW,
};

const TRAY_MESSAGE_ID: u32 = WM_APP + 1;
const TRAY_ICON_ID: u32 = 1;
const TOGGLE_ID: usize = 1001;
const SETTINGS_ID: usize = 1002;
const EXIT_ID: usize = 1003;

pub struct TrayManager {
    hwnd: HWND,
    menu: HMENU,
}

impl TrayManager {
    pub fn new() -> Self {
        unsafe {
            let class_name = wide("ArkTrayWindow");
            let hinstance = GetModuleHandleW(None).expect("Failed to get module handle");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(tray_wndproc),
                hInstance: hinstance.into(),
                lpszClassName: PCWSTR(class_name.as_ptr()),
                hCursor: LoadCursorW(None, IDC_ARROW).ok().unwrap_or_default(),
                ..Default::default()
            };
            let _ = RegisterClassW(&wc);

            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                PCWSTR(class_name.as_ptr()),
                PCWSTR(class_name.as_ptr()),
                WINDOW_STYLE::default(),
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                0,
                0,
                None,
                None,
                hinstance,
                None,
            )
            .expect("Failed to create tray window");

            let menu = CreatePopupMenu().expect("Failed to create tray menu");
            append_menu(menu, TOGGLE_ID, "Hide");
            append_menu(menu, SETTINGS_ID, "Settings");
            append_menu(menu, EXIT_ID, "Exit");
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, menu.0 as isize);

            let mut nid = tray_icon_data(hwnd);
            nid.hIcon = LoadIconW(None, IDI_APPLICATION)
                .ok()
                .unwrap_or_default()
                .into();
            write_wide_buf(&mut nid.szTip, WINDOW_TITLE);
            Shell_NotifyIconW(NIM_ADD, &nid).expect("Failed to add tray icon");
            nid.Anonymous.uVersion = NOTIFYICON_VERSION_4;
            let _ = Shell_NotifyIconW(NIM_SETVERSION, &nid);

            Self { hwnd, menu }
        }
    }

    pub fn update_item_text(&self, visible: bool) {
        unsafe {
            let text = if visible { "Hide" } else { "Show" };
            let wide_text = wide(text);
            let _ = ModifyMenuW(
                self.menu,
                TOGGLE_ID as u32,
                MF_BYCOMMAND | MF_STRING,
                TOGGLE_ID,
                PCWSTR(wide_text.as_ptr()),
            );
        }
    }

    pub fn poll_action(&self) -> Option<TrayAction> {
        unsafe {
            let mut pending = None;
            loop {
                let mut msg = MSG::default();
                if !PeekMessageW(&mut msg, self.hwnd, 0, 0, PM_REMOVE).as_bool() {
                    break;
                }
                if msg.message == WM_COMMAND {
                    let id = (msg.wParam.0 & 0xffff) as usize;
                    pending = match id {
                        TOGGLE_ID => Some(TrayAction::ToggleVisibility),
                        SETTINGS_ID => Some(TrayAction::OpenSettings),
                        EXIT_ID => Some(TrayAction::Exit),
                        _ => None,
                    };
                    if pending.is_some() {
                        break;
                    }
                } else {
                    let _ = TranslateMessage(&msg);
                    let _ = DispatchMessageW(&msg);
                }
            }
            pending
        }
    }
}

impl Drop for TrayManager {
    fn drop(&mut self) {
        unsafe {
            let nid = tray_icon_data(self.hwnd);
            let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
            let _ = DestroyMenu(self.menu);
            let _ = DestroyWindow(self.hwnd);
        }
    }
}

pub enum TrayAction {
    ToggleVisibility,
    OpenSettings,
    Exit,
}

unsafe extern "system" fn tray_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_NCCREATE | WM_CREATE => return LRESULT(1),
        WM_DESTROY => return LRESULT(0),
        TRAY_MESSAGE_ID => {
            let menu = HMENU(GetWindowLongPtrW(hwnd, GWLP_USERDATA) as _);
            match lparam.0 as u32 {
                WM_LBUTTONUP => {
                    let _ = PostMessageW(hwnd, WM_COMMAND, WPARAM(TOGGLE_ID), LPARAM(0));
                }
                WM_RBUTTONUP | WM_CONTEXTMENU => {
                    if !menu.0.is_null() {
                        let mut point = POINT::default();
                        let _ = GetCursorPos(&mut point);
                        let _ = SetForegroundWindow(hwnd);
                        let _ = TrackPopupMenu(
                            menu,
                            TPM_BOTTOMALIGN,
                            point.x,
                            point.y,
                            0,
                            hwnd,
                            None,
                        );
                    }
                }
                _ => {}
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

fn tray_icon_data(hwnd: HWND) -> NOTIFYICONDATAW {
    let mut nid = NOTIFYICONDATAW::default();
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd;
    nid.uID = TRAY_ICON_ID;
    nid.uFlags = NIF_MESSAGE | NIF_TIP | NIF_ICON;
    nid.uCallbackMessage = TRAY_MESSAGE_ID;
    nid
}

fn append_menu(menu: HMENU, id: usize, text: &str) {
    unsafe {
        let wide_text = wide(text);
        let _ = AppendMenuW(menu, MF_STRING, id, PCWSTR(wide_text.as_ptr()));
    }
}

fn write_wide_buf(buf: &mut [u16], text: &str) {
    for (index, value) in wide(text)
        .into_iter()
        .take(buf.len().saturating_sub(1))
        .enumerate()
    {
        buf[index] = value;
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(iter::once(0)).collect()
}
