//! Wire framing for a seat's session stream.
//!
//! The payload is the same opaque engine envelope the relay already carries in
//! `BroadcastState.state` and `StateUpdate.state`. Nothing in this module reads
//! it, which is what keeps the game protocol transport-agnostic.

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::{NetError, Result};

pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionFrame {
    /// Opening frame from the joining seat. The host answers with `Welcome`.
    Hello {
        room_id: String,
        username: String,
        protocol_version: u32,
    },
    Welcome {
        accepted: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Game {
        seq: u64,
        payload: serde_json::Value,
    },
    Bye {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

pub async fn write_frame<W: AsyncWrite + Unpin>(w: &mut W, frame: &SessionFrame) -> Result<()> {
    let body = serde_json::to_vec(frame)?;
    if body.len() > MAX_FRAME_BYTES {
        return Err(NetError::FrameTooLarge(body.len(), MAX_FRAME_BYTES));
    }
    w.write_all(&(body.len() as u32).to_be_bytes()).await?;
    w.write_all(&body).await?;
    w.flush().await?;
    Ok(())
}

pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<SessionFrame> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len).await?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(NetError::FrameTooLarge(len, MAX_FRAME_BYTES));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    Ok(serde_json::from_slice(&body)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trips_a_game_frame() {
        let frame = SessionFrame::Game {
            seq: 7,
            payload: serde_json::json!({ "kind": "state", "forPlayer": "player-0" }),
        };
        let mut buf = Vec::new();
        write_frame(&mut buf, &frame).await.unwrap();
        let mut cursor = std::io::Cursor::new(buf);
        assert_eq!(read_frame(&mut cursor).await.unwrap(), frame);
    }
}
