use std::sync::mpsc;
use std::time::Duration;

use manabrew_agent_interface::agent_impl::Responder;
use manabrew_agent_interface::game_log_event::GameLogEntryDto;
use manabrew_agent_interface::game_snapshot_event::GameSnapshotEventDto;
use manabrew_agent_interface::prompt::{
    AgentMessage, AgentPrompt, ChooseActionOutput, PromptOutput,
};

enum PromptSink {
    Local(mpsc::Sender<AgentMessage>),
    Relay {
        player_index: usize,
        tx: mpsc::Sender<(usize, AgentMessage)>,
    },
}

pub struct MpscTransport {
    prompt_sink: PromptSink,
    response_rx: mpsc::Receiver<PromptOutput>,
    notify_tx: Option<mpsc::Sender<GameLogEntryDto>>,
    snapshot_tx: Option<mpsc::Sender<GameSnapshotEventDto>>,
    response_timeout: Option<Duration>,
}

impl MpscTransport {
    pub fn new_local(
        prompt_tx: mpsc::Sender<AgentMessage>,
        response_rx: mpsc::Receiver<PromptOutput>,
        notify_tx: mpsc::Sender<GameLogEntryDto>,
        snapshot_tx: mpsc::Sender<GameSnapshotEventDto>,
    ) -> Self {
        Self {
            prompt_sink: PromptSink::Local(prompt_tx),
            response_rx,
            notify_tx: Some(notify_tx),
            snapshot_tx: Some(snapshot_tx),
            response_timeout: None,
        }
    }

    pub fn new_relay(
        player_index: usize,
        prompt_tx: mpsc::Sender<(usize, AgentMessage)>,
        response_rx: mpsc::Receiver<PromptOutput>,
    ) -> Self {
        Self {
            prompt_sink: PromptSink::Relay {
                player_index,
                tx: prompt_tx,
            },
            response_rx,
            notify_tx: None,
            snapshot_tx: None,
            response_timeout: Some(Duration::from_secs(120)),
        }
    }
}

impl MpscTransport {
    fn send_to_sink(&self, message: AgentMessage) {
        match &self.prompt_sink {
            PromptSink::Local(tx) => {
                let _ = tx.send(message);
            }
            PromptSink::Relay { player_index, tx } => {
                let _ = tx.send((*player_index, message));
            }
        }
    }

    fn recv(&self) -> PromptOutput {
        // When the response channel is disconnected — typically because
        // `GameManager::end_game()` (or the concede branch of `respond`)
        // dropped it to tear the session down — the previous fallback of
        // `PlayerAction::Pass { until: None }` quietly passed
        // priority and let the game loop keep running forever on auto-
        // pilot, which manifested on the UI side as the concede/return-
        // to-menu "infinite prompt" loop. Treating a disconnect as a
        // concede lets the engine mark the player as having lost,
        // collapse the game, and exit cleanly.
        //
        // A recv_timeout timeout (separate from disconnection) still
        // falls back to a no-op so long-idle games don't get forcibly
        // conceded just because nobody clicked anything for a while.
        if let Some(timeout) = self.response_timeout {
            match self.response_rx.recv_timeout(timeout) {
                Ok(action) => action,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    PromptOutput::ChooseAction(ChooseActionOutput::Pass { until: None })
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    PromptOutput::ChooseAction(ChooseActionOutput::Concede)
                }
            }
        } else {
            self.response_rx
                .recv()
                .unwrap_or(PromptOutput::ChooseAction(ChooseActionOutput::Concede))
        }
    }
}

impl Responder for MpscTransport {
    fn present(&mut self, message: &AgentMessage) {
        self.send_to_sink(message.clone());
    }

    fn respond(&mut self, _prompt: AgentPrompt) -> PromptOutput {
        self.recv()
    }

    fn await_ack(&mut self) {
        let _ = self.recv();
    }

    fn send_log(&mut self, entry: GameLogEntryDto) {
        if let Some(tx) = &self.notify_tx {
            let _ = tx.send(entry);
        }
    }

    fn send_snapshot(&mut self, snapshot: GameSnapshotEventDto) {
        if let Some(tx) = &self.snapshot_tx {
            let _ = tx.send(snapshot);
        }
    }
}
