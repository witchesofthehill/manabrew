use std::sync::mpsc;
use std::time::Duration;

use manabrew_agent_interface::agent_impl::Responder;
use manabrew_agent_interface::game_log_event::GameLogEntryDto;
use manabrew_agent_interface::game_snapshot_event::GameSnapshotEventDto;
use manabrew_agent_interface::prompt::{
    AgentMessage, AgentPrompt, ChooseActionOutput, ClientToServerMessage, DirectiveInput,
    PromptOutput,
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
    response_rx: mpsc::Receiver<ClientToServerMessage>,
    notify_tx: Option<mpsc::Sender<GameLogEntryDto>>,
    snapshot_tx: Option<mpsc::Sender<GameSnapshotEventDto>>,
    response_timeout: Option<Duration>,
    disconnected: bool,
}

impl MpscTransport {
    pub fn new_local(
        prompt_tx: mpsc::Sender<AgentMessage>,
        response_rx: mpsc::Receiver<ClientToServerMessage>,
        notify_tx: mpsc::Sender<GameLogEntryDto>,
        snapshot_tx: mpsc::Sender<GameSnapshotEventDto>,
    ) -> Self {
        Self {
            prompt_sink: PromptSink::Local(prompt_tx),
            response_rx,
            notify_tx: Some(notify_tx),
            snapshot_tx: Some(snapshot_tx),
            response_timeout: None,
            disconnected: false,
        }
    }

    pub fn new_relay(
        player_index: usize,
        prompt_tx: mpsc::Sender<(usize, AgentMessage)>,
        response_rx: mpsc::Receiver<ClientToServerMessage>,
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
            disconnected: false,
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

    fn recv(&mut self) -> ClientToServerMessage {
        // When the response channel is disconnected — typically because
        //
        let pass = || ClientToServerMessage::Response {
            action: PromptOutput::ChooseAction(ChooseActionOutput::Pass { until: None }),
        };
        let received = if let Some(timeout) = self.response_timeout {
            match self.response_rx.recv_timeout(timeout) {
                Ok(message) => Some(message),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => return pass(),
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => None,
            }
        } else {
            self.response_rx.recv().ok()
        };
        match received {
            Some(message) => message,
            None if !self.disconnected => {
                self.disconnected = true;
                ClientToServerMessage::Directive {
                    directive: DirectiveInput::Concede,
                }
            }
            None => pass(),
        }
    }
}

impl Responder for MpscTransport {
    fn present(&mut self, message: &AgentMessage) {
        self.send_to_sink(message.clone());
    }

    fn respond(&mut self, _prompt: AgentPrompt) -> ClientToServerMessage {
        self.recv()
    }

    fn await_ack(&mut self) -> ClientToServerMessage {
        self.recv()
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
