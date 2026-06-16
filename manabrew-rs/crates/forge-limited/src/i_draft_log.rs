pub trait IDraftLog: Send {
    fn add_log_entry(&mut self, message: String);
}

#[derive(Debug, Default)]
pub struct VecDraftLog {
    pub entries: Vec<String>,
}

impl IDraftLog for VecDraftLog {
    fn add_log_entry(&mut self, message: String) {
        self.entries.push(message);
    }
}
