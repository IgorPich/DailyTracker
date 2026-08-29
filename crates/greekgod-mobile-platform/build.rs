fn main() {
    tauri_plugin::Builder::new(&[
        "storeSecret",
        "loadSecret",
        "deleteSecret",
        "discoverSyncService",
        "networkStatus",
        "releaseLocalNetwork",
        "scheduleAutoSync",
        "startRestTimer",
        "restTimerStatus",
    ])
    .android_path("android")
    .try_build()
    .expect("failed to build GreekGod mobile platform plugin");
}
