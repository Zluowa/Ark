#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
#[cfg(target_os = "windows")]
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    SetClipboardData,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

#[cfg(target_os = "windows")]
const CF_UNICODETEXT_FORMAT: u32 = 13;

#[cfg(target_os = "windows")]
fn open_clipboard_with_retry(mode: &str) -> Result<(), String> {
    let mut last_error = String::new();
    for _ in 0..12 {
        unsafe {
            match OpenClipboard(HWND::default()) {
                Ok(()) => return Ok(()),
                Err(err) => {
                    last_error = format!("Clipboard {mode} failed: OpenClipboard ({err})");
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    Err(last_error)
}

pub fn get_text() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        open_clipboard_with_retry("read")?;

        let result = (|| {
            if IsClipboardFormatAvailable(CF_UNICODETEXT_FORMAT).is_err() {
                return Ok(String::new());
            }

            let handle = GetClipboardData(CF_UNICODETEXT_FORMAT)
                .map_err(|e| format!("Clipboard read failed: GetClipboardData ({e})"))?;

            let hglobal = HGLOBAL(handle.0);
            let ptr = GlobalLock(hglobal) as *const u16;
            if ptr.is_null() {
                return Err("Clipboard read failed: GlobalLock".to_string());
            }

            let mut len = 0usize;
            while *ptr.add(len) != 0 {
                len += 1;
            }

            let slice = std::slice::from_raw_parts(ptr, len);
            let text = String::from_utf16_lossy(slice);
            let _ = GlobalUnlock(hglobal);
            Ok(text.trim_end_matches(['\r', '\n']).to_string())
        })();

        let _ = CloseClipboard();
        return result;
    }

    #[allow(unreachable_code)]
    Err("Clipboard is only supported on Windows in this build".to_string())
}

pub fn set_text(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        open_clipboard_with_retry("write")?;

        let result = (|| {
            EmptyClipboard()
                .map_err(|e| format!("Clipboard write failed: EmptyClipboard ({e})"))?;

            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes = wide.len() * std::mem::size_of::<u16>();

            let hglobal = GlobalAlloc(GMEM_MOVEABLE, bytes)
                .map_err(|e| format!("Clipboard write failed: GlobalAlloc ({e})"))?;

            let ptr = GlobalLock(hglobal) as *mut u16;
            if ptr.is_null() {
                let _ = GlobalUnlock(hglobal);
                return Err("Clipboard write failed: GlobalLock".to_string());
            }

            ptr.copy_from_nonoverlapping(wide.as_ptr(), wide.len());
            let _ = GlobalUnlock(hglobal);

            let handle = HANDLE(hglobal.0);
            SetClipboardData(CF_UNICODETEXT_FORMAT, handle)
                .map_err(|e| format!("Clipboard write failed: SetClipboardData ({e})"))?;

            Ok(())
        })();

        let _ = CloseClipboard();
        return result;
    }

    #[allow(unreachable_code)]
    Err("Clipboard is only supported on Windows in this build".to_string())
}
