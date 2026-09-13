// Windows session-local process guard, deliberately before Tauri/storage startup.
// Holding a named kernel object (not a lock file) also covers simultaneous launches.
use std::io;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
use windows_sys::Win32::System::Threading::CreateMutexW;

pub struct DesktopInstance(HANDLE);

pub fn acquire(identifier: &str) -> io::Result<Option<DesktopInstance>> {
    let name: Vec<u16> = format!("Local\\{identifier}-desktop-writer").encode_utf16().chain(Some(0)).collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() { return Err(io::Error::last_os_error()); }
    let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    let guard = DesktopInstance(handle);
    if existed { drop(guard); Ok(None) } else { Ok(Some(guard)) }
}

impl Drop for DesktopInstance {
    fn drop(&mut self) { unsafe { CloseHandle(self.0); } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_second_handle_and_releases_on_close() {
        let id = format!("human-coach-test-{}", std::process::id());
        let first = acquire(&id).unwrap().unwrap();
        assert!(acquire(&id).unwrap().is_none());
        let other = acquire(&format!("{id}-dev")).unwrap().unwrap();
        drop(first);
        assert!(acquire(&id).unwrap().is_some());
        drop(other);
    }
}
