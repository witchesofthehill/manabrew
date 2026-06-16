use std::cell::RefCell;
use std::sync::{Arc, Mutex};

use crate::protocol::ChoiceLogEntry;

thread_local! {
    static SINK: RefCell<Option<Arc<Mutex<Vec<ChoiceLogEntry>>>>> = const { RefCell::new(None) };
}

pub fn set_sink(sink: Arc<Mutex<Vec<ChoiceLogEntry>>>) {
    SINK.with(|s| *s.borrow_mut() = Some(sink));
}

pub fn clear_sink() {
    SINK.with(|s| *s.borrow_mut() = None);
}

pub fn log(entry: ChoiceLogEntry) {
    SINK.with(|s| {
        if let Some(ref sink) = *s.borrow() {
            sink.lock().unwrap().push(entry);
        }
    });
}

pub fn drain() -> Vec<ChoiceLogEntry> {
    SINK.with(|s| {
        if let Some(ref sink) = *s.borrow() {
            let mut guard = sink.lock().unwrap();
            guard.drain(..).collect()
        } else {
            Vec::new()
        }
    })
}
