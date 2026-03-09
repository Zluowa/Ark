// @input: Island + Tauri executable paths
// @output: Spawns both processes, monitors health
// @position: Process orchestrator — single entry point for desktop app

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

#[tokio::main]
async fn main() {
    let dev_mode = std::env::args().any(|a| a == "--dev");

    println!("[launcher] starting OmniAgent desktop (dev={dev_mode})");
    ensure_island_binary();

    let island = spawn_island();
    let tauri = spawn_tauri(dev_mode);

    // Monitor both processes
    let (island_result, tauri_result) =
        tokio::join!(monitor("island", island), monitor("tauri", tauri),);

    if let Err(e) = island_result {
        eprintln!("[launcher] island error: {e}");
    }
    if let Err(e) = tauri_result {
        eprintln!("[launcher] tauri error: {e}");
    }
}

fn ensure_island_binary() {
    #[cfg(debug_assertions)]
    {
        let mut workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        workspace_root.pop();
        println!("[launcher] building island binary before launch...");
        let status = Command::new("cargo")
            .args(["build", "-p", "omniagent-island"])
            .current_dir(workspace_root)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .expect("failed to run cargo build for island");
        if !status.success() {
            panic!("cargo build -p omniagent-island failed with status {status}");
        }
    }
}

fn spawn_island() -> std::process::Child {
    let exe = if cfg!(debug_assertions) {
        "./target/debug/omniagent-island.exe"
    } else {
        "./island.exe"
    };
    Command::new(exe)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to start island process")
}

fn spawn_tauri(dev_mode: bool) -> std::process::Child {
    let exe = if cfg!(debug_assertions) {
        "./target/debug/omniagent-tauri.exe"
    } else {
        "./tauri-app.exe"
    };
    let mut cmd = Command::new(exe);
    if dev_mode {
        cmd.env("TAURI_DEV", "1");
    }
    cmd.stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to start tauri process")
}

async fn monitor(name: &str, mut child: std::process::Child) -> std::io::Result<()> {
    loop {
        match child.try_wait()? {
            Some(status) => {
                println!("[launcher] {name} exited with {status}");
                return Ok(());
            }
            None => tokio::time::sleep(Duration::from_secs(1)).await,
        }
    }
}
