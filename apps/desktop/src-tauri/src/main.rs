// Pactlab Rinse (T-178, T-178b): the desktop shell. The window shows the Rinse screens; the rinse
// engine (apps/desktop/src/engine) runs on this machine as a Node sidecar, started from the bundled
// `binaries/rinse-engine`, and holds the Pactlab session. Prep invites arrive as deep links. Updates
// come signed from the Pactlab release feed through the Tauri updater.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("Pactlab Rinse could not start");
}
