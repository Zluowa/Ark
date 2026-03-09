// @input: Island executable path
// @output: Spawns the island process and prints the dashboard handoff
// @position: Process orchestrator - single entry point for the desktop open-source build

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

#[tokio::main]
async fn main() {
    let dev_mode = std::env::args().any(|a| a == "--dev");

    println!("[launcher] starting Ark desktop (dev={dev_mode})");
    ensure_island_binary();

    let island = spawn_island();
    print_dashboard_hint();

    if let Err(e) = monitor("island", island).await {
        eprintln!("[launcher] island error: {e}");
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

fn print_dashboard_hint() {
    println!("[launcher] dashboard shell is web-first in the public build");
    println!("[launcher] open http://127.0.0.1:3010/dashboard in your browser when the web app is running");
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
