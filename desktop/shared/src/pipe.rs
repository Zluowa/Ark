// @input: Windows Named Pipe APIs via `windows` crate
// @output: PipeServer (Tauri side) + PipeClient (Island side)
// @position: Transport layer for IPC — length-prefixed JSON frames

use crate::config::{MAX_MESSAGE_SIZE, PIPE_NAME};
use serde::{de::DeserializeOwned, Serialize};
use std::io;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};

// --- Frame codec: [4-byte LE length][JSON payload] ---

async fn write_frame<W: AsyncWriteExt + Unpin, T: Serialize>(
    writer: &mut W,
    msg: &T,
) -> io::Result<()> {
    let payload =
        serde_json::to_vec(msg).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    if payload.len() > MAX_MESSAGE_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "message too large",
        ));
    }
    let len = (payload.len() as u32).to_le_bytes();
    writer.write_all(&len).await?;
    writer.write_all(&payload).await?;
    writer.flush().await
}

async fn read_frame<R: AsyncReadExt + Unpin, T: DeserializeOwned>(reader: &mut R) -> io::Result<T> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > MAX_MESSAGE_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame too large",
        ));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    serde_json::from_slice(&buf).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

// --- Server (Tauri side) ---

pub struct PipeServerHandle {
    inner: NamedPipeServer,
}

impl PipeServerHandle {
    pub async fn create() -> io::Result<Self> {
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(PIPE_NAME)?;
        Ok(Self { inner: server })
    }

    pub async fn wait_for_client(&self) -> io::Result<()> {
        self.inner.connect().await
    }

    pub async fn send<T: Serialize>(&mut self, msg: &T) -> io::Result<()> {
        write_frame(&mut self.inner, msg).await
    }

    pub async fn recv<T: DeserializeOwned>(&mut self) -> io::Result<T> {
        read_frame(&mut self.inner).await
    }
}

// --- Client (Island side) ---

pub struct PipeClientHandle {
    inner: tokio::net::windows::named_pipe::NamedPipeClient,
}

impl PipeClientHandle {
    pub async fn connect() -> io::Result<Self> {
        let client = ClientOptions::new().open(PIPE_NAME)?;
        Ok(Self { inner: client })
    }

    pub async fn send<T: Serialize>(&mut self, msg: &T) -> io::Result<()> {
        write_frame(&mut self.inner, msg).await
    }

    pub async fn recv<T: DeserializeOwned>(&mut self) -> io::Result<T> {
        read_frame(&mut self.inner).await
    }
}
