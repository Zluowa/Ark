// @input: tokio mpsc channel + TauriToIsland message type
// @output: Shared IPC sender accessible from Tauri commands
// @position: Global state bridging Tauri commands → Island pipe

use omniagent_shared::ipc::TauriToIsland;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub struct IpcState {
    pub tx: Arc<Mutex<Option<mpsc::Sender<TauriToIsland>>>>,
}

impl IpcState {
    pub fn new() -> Self {
        Self {
            tx: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn set_sender(&self, sender: mpsc::Sender<TauriToIsland>) {
        *self.tx.lock().await = Some(sender);
    }

    pub async fn send(&self, msg: TauriToIsland) -> Result<(), String> {
        let guard = self.tx.lock().await;
        match guard.as_ref() {
            Some(tx) => tx.send(msg).await.map_err(|e| e.to_string()),
            None => Err("Island not connected".into()),
        }
    }
}
