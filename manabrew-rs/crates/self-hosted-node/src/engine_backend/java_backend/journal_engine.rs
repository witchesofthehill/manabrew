use super::*;
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone)]
pub(super) struct JournalEngine {
    bridge: Rc<RefCell<SubprocessBridge>>,
}

impl JournalEngine {
    pub(super) fn spawn() -> Result<Self, String> {
        let config = JavaRuntimeConfig::from_env();
        #[cfg(feature = "java-forge")]
        let bridge = SubprocessBridge::spawn(&config)?;
        #[cfg(all(feature = "graal-forge", not(feature = "java-forge")))]
        let bridge = {
            let executable = std::env::current_exe().map_err(|error| error.to_string())?;
            let mut command = Command::new(executable);
            command
                .arg("--forge-engine-worker")
                .arg(&config.assets_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            SubprocessBridge::from_child(command.spawn().map_err(|error| error.to_string())?)?
        };
        Ok(Self {
            bridge: Rc::new(RefCell::new(bridge)),
        })
    }

    fn call(&self, command: &str, session: &str) -> Result<String, String> {
        self.bridge
            .borrow_mut()
            .call(&json!({"command": command, "sessionId": session}).to_string())
    }

    pub(super) fn start_game(&self, request: &str) -> Result<String, String> {
        let response = self.bridge.borrow_mut().start_game_json(request)?;
        serde_json::from_str::<StartGameResponse>(&response)
            .map(|response| response.session_id)
            .map_err(|error| error.to_string())
    }

    pub(super) fn submit_action(&self, session: &str, action: &str) -> Result<String, String> {
        self.bridge.borrow_mut().submit_action(session, action)
    }

    pub(super) fn get_prompt(
        &self,
        session: &str,
        player: usize,
    ) -> Result<Option<String>, String> {
        self.bridge.borrow_mut().get_prompt(session, player)
    }

    pub(super) fn get_snapshot(
        &self,
        session: &str,
        viewer: Option<usize>,
    ) -> Result<String, String> {
        self.bridge.borrow_mut().get_snapshot(session, viewer)
    }

    pub(super) fn is_game_over(&self, session: &str) -> Result<bool, String> {
        self.bridge.borrow_mut().is_game_over(session)
    }

    pub(super) fn state_revision(&self, session: &str) -> Result<u64, String> {
        self.bridge.borrow_mut().state_revision(session)
    }

    pub(super) fn drain_checkpoint_metrics(&self, session: &str) -> Result<String, String> {
        self.bridge.borrow_mut().drain_checkpoint_metrics(session)
    }

    pub(super) fn end_game(&self, session: &str) -> Result<(), String> {
        self.bridge.borrow_mut().end_game(session)
    }

    pub(super) fn abort_game(&self, session: &str) -> Result<(), String> {
        self.bridge.borrow_mut().abort_game(session)
    }

    #[cfg(all(feature = "graal-forge", not(feature = "java-forge")))]
    pub(super) fn gc_stats(&self) -> Result<GcStats, String> {
        serde_json::from_str(&self.call("gcStats", "")?).map_err(|error| error.to_string())
    }

    pub(super) fn rewind_if_requested(
        &self,
        session: &str,
        cancel: &Arc<AtomicBool>,
    ) -> Result<Option<u32>, String> {
        self.rewind_with(session, cancel, Self::spawn, Duration::from_secs(120))
    }

    fn rewind_with(
        &self,
        session: &str,
        cancel: &Arc<AtomicBool>,
        spawn: impl FnOnce() -> Result<Self, String>,
        timeout: Duration,
    ) -> Result<Option<u32>, String> {
        let snapshot = self.call("getRewindRequest", session)?;
        if snapshot.is_empty() {
            return Ok(None);
        }
        let result = (|| {
            let snapshot: Value =
                serde_json::from_str(&snapshot).map_err(|error| error.to_string())?;
            let start = snapshot["journal"]["startRequest"]
                .as_str()
                .ok_or("rewind has no start request")?;
            let mut request: Value =
                serde_json::from_str(start).map_err(|error| error.to_string())?;
            let prompt_id = snapshot["prompt"]["promptId"]
                .as_u64()
                .and_then(|id| u32::try_from(id).ok())
                .ok_or("rewind has no target prompt")?;
            request["replaySnapshot"] = snapshot;
            let deadline = Instant::now() + timeout;
            let replacement = spawn()?;
            {
                let mut bridge = replacement.bridge.borrow_mut();
                bridge.deadline = Some(deadline);
                bridge.cancel = Some(Arc::clone(cancel));
            }
            if replacement.start_game(&request.to_string())? != session {
                return Err("rewind changed the game identity".to_string());
            }
            loop {
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("rewind cancelled".to_string());
                }
                if replacement.call("replayReady", session)? == "true" {
                    serde_json::from_str::<GameViewDto>(&replacement.get_snapshot(session, None)?)
                        .map_err(|error| format!("invalid restored state: {error}"))?;
                    serde_json::from_str::<AgentPrompt>(
                        &replacement
                            .get_prompt(session, 0)?
                            .ok_or("no restored prompt")?,
                    )
                    .map_err(|error| format!("invalid restored prompt: {error}"))?;
                    replacement.bridge.borrow_mut().remaining(deadline)?;
                    let pending = {
                        let mut source = self.bridge.borrow_mut();
                        source.cancel = Some(Arc::clone(cancel));
                        let result = source.call(
                            &json!({"command": "getRewindRequest", "sessionId": session})
                                .to_string(),
                        );
                        source.cancel = None;
                        result?
                    };
                    if pending.is_empty() {
                        return Err("rewind interrupted by a pending directive".into());
                    }
                    replacement.bridge.borrow_mut().remaining(deadline)?;
                    if !self.bridge.borrow_mut().is_alive() {
                        return Err("authoritative engine exited during rewind".into());
                    }
                    {
                        let mut bridge = replacement.bridge.borrow_mut();
                        bridge.deadline = None;
                        bridge.cancel = None;
                    }
                    self.bridge.swap(&replacement.bridge);
                    return Ok(prompt_id);
                }
                if Instant::now() >= deadline || replacement.is_game_over(session)? {
                    return Err("replay did not reach the selected decision".to_string());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        })();
        match result {
            Ok(prompt) => Ok(Some(prompt)),
            Err(error) => {
                warn!(%error, "journal rewind failed; keeping the current game");
                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                    let mut bridge = self.bridge.borrow_mut();
                    bridge.failed = true;
                    let _ = bridge.child.kill();
                    return Err("rewind cancelled".into());
                }
                self.call("resumeAfterFailedRewind", session)?;
                Ok(None)
            }
        }
    }
}

#[cfg(feature = "graal-forge")]
pub(super) fn run_native_worker() -> ! {
    let result = (|| -> Result<(), String> {
        let assets = std::env::args()
            .nth(2)
            .ok_or("missing engine assets directory")?;
        let bridge = std::mem::ManuallyDrop::new(GraalBridge::create()?);
        let assets = cstring(&assets)?;
        bridge.decode(unsafe { graal_ffi::forge_initialize(bridge.thread, assets.as_ptr()) })?;
        let isolate = unsafe { graal_ffi::graal_get_isolate(bridge.thread) } as usize;
        std::thread::spawn(move || {
            let mut thread = std::ptr::null_mut();
            if unsafe { graal_ffi::graal_attach_thread(isolate as *mut _, &mut thread) } != 0 {
                return;
            }
            let sampler = GraalBridge {
                thread,
                attached: true,
            };
            loop {
                if let Ok(stats) = sampler.decode(unsafe { graal_ffi::forge_gc_stats(thread) }) {
                    eprintln!("forge:gc {stats}");
                }
                std::thread::sleep(ENGINE_GC_SAMPLE_INTERVAL);
            }
        });
        for line in std::io::stdin().lock().lines() {
            let line = line.map_err(|error| error.to_string())?;
            let response = (|| -> Result<String, String> {
                let request: Value =
                    serde_json::from_str(&line).map_err(|error| error.to_string())?;
                if request["command"] == "quit" {
                    std::process::exit(0);
                }
                if request["command"] == "gcStats" {
                    return bridge.decode(unsafe { graal_ffi::forge_gc_stats(bridge.thread) });
                }
                let request = cstring(&line)?;
                bridge.decode(unsafe { graal_ffi::forge_command(bridge.thread, request.as_ptr()) })
            })();
            let envelope = match response {
                Ok(result) => json!({"ok": true, "result": result}),
                Err(error) => json!({"ok": false, "error": error}),
            };
            println!("{envelope}");
        }
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("engine worker failed: {error}");
        std::process::exit(1);
    }
    std::process::exit(0);
}

#[cfg(feature = "graal-forge")]
pub(super) fn report_process_gc(process_id: u32, stats: Option<GcStats>) {
    static PROCESSES: std::sync::OnceLock<std::sync::Mutex<HashMap<u32, GcStats>>> =
        std::sync::OnceLock::new();
    let Ok(mut processes) = PROCESSES.get_or_init(Default::default).lock() else {
        return;
    };
    if let Some(stats) = stats {
        let previous = processes.get(&process_id);
        for (collector, current) in &stats.by_collector {
            let prior = previous.and_then(|stats| stats.by_collector.get(collector));
            crate::metrics::record_engine_gc_delta(
                collector,
                current
                    .collections
                    .saturating_sub(prior.map_or(0, |stats| stats.collections)),
                current
                    .pause_millis
                    .saturating_sub(prior.map_or(0, |stats| stats.pause_millis)),
            );
        }
        crate::metrics::record_engine_stall_delta(
            stats
                .stalled_millis
                .saturating_sub(previous.map_or(0, |stats| stats.stalled_millis)),
            stats
                .long_stalls
                .saturating_sub(previous.map_or(0, |stats| stats.long_stalls)),
        );
        processes.insert(process_id, stats);
    } else {
        processes.remove(&process_id);
    }
    crate::metrics::record_engine_gc(
        0,
        0,
        processes.values().map(|stats| stats.heap_used_bytes).sum(),
        processes.values().map(|stats| stats.heap_max_bytes).sum(),
    );
    crate::metrics::record_engine_stall(
        0,
        processes
            .values()
            .map(|stats| stats.max_stall_millis)
            .max()
            .unwrap_or(0),
        0,
    );
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn engine(script: &str) -> JournalEngine {
        let child = Command::new("python3")
            .args(["-u", "-c", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        JournalEngine {
            bridge: Rc::new(RefCell::new(SubprocessBridge::from_child(child).unwrap())),
        }
    }

    fn source() -> JournalEngine {
        engine(
            r#"import sys,json
resumed=False
snapshot=json.dumps({'journal':{'startRequest':'{}'},'prompt':{'promptId':1}})
for line in sys.stdin:
 command=json.loads(line)['command']
 if command=='resumeAfterFailedRewind': resumed=True
 result=snapshot if command=='getRewindRequest' else ('resumed' if resumed else 'frozen')
 print(json.dumps({'ok':True,'result':result}),flush=True)
"#,
        )
    }

    #[test]
    fn hung_and_crashed_replacements_leave_source_usable() {
        for operation in ["startGame", "replayReady", "getSnapshot", "getPrompt"] {
            for crash in [false, true] {
                let source = source();
                let original_pid = source.bridge.borrow().child.id();
                let replacement = engine(&format!(
                    r#"import sys,json,time
for line in sys.stdin:
 command=json.loads(line)['command']
 if command=={operation:?}:
  if {crash}: sys.exit(9)
  time.sleep(60)
 result={{'startGame':'{{"sessionId":"game","playerIndexes":[0,1]}}','replayReady':'true','getSnapshot':{view:?}}}.get(command,'false')
 print(json.dumps({{'ok':True,'result':result}}),flush=True)
"#,
                    crash = if crash { "True" } else { "False" },
                    view = serde_json::to_string(&GameViewDto::default()).unwrap()
                ));
                let pid = replacement.bridge.borrow().child.id();
                let start = Instant::now();
                let cancel = Arc::new(AtomicBool::new(false));
                assert!(source
                    .rewind_with(
                        "game",
                        &cancel,
                        || Ok(replacement),
                        Duration::from_millis(150)
                    )
                    .unwrap()
                    .is_none());
                assert_eq!(source.bridge.borrow().child.id(), original_pid);
                assert_eq!(source.call("submitAction", "game").unwrap(), "resumed");
                assert!(start.elapsed() < Duration::from_secs(3));
                if !crash {
                    assert!(
                        start.elapsed() >= Duration::from_millis(140),
                        "did not reach {operation}"
                    );
                }
                assert!(!Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .stderr(Stdio::null())
                    .status()
                    .unwrap()
                    .success());
            }
        }
    }

    fn ready_candidate() -> JournalEngine {
        let view = serde_json::to_string(&GameViewDto::default()).unwrap();
        let prompt = r#"{"promptId":1,"decidingPlayerId":"player-0","input":{"type":"mulligan","handCardIds":[],"mulliganCount":0}}"#;
        engine(&format!(
            r#"import sys,json
snapshot=json.dumps({{'journal':{{'startRequest':'{{}}'}},'prompt':{{'promptId':1}}}})
for line in sys.stdin:
 command=json.loads(line)['command']
 result={{'startGame':'{{"sessionId":"game","playerIndexes":[0,1]}}','replayReady':'true','getSnapshot':{view:?},'getPrompt':{prompt:?},'getRewindRequest':snapshot}}.get(command,'ok')
 print(json.dumps({{'ok':True,'result':result}}),flush=True)
"#
        ))
    }

    #[test]
    fn consecutive_promotions_reap_previous_authority() {
        let source = source();
        let cancel = Arc::new(AtomicBool::new(false));
        for _ in 0..3 {
            let old = source.bridge.borrow().child.id();
            let candidate = ready_candidate();
            let new = candidate.bridge.borrow().child.id();
            assert_eq!(
                source
                    .rewind_with("game", &cancel, || Ok(candidate), Duration::from_secs(2))
                    .unwrap(),
                Some(1)
            );
            assert_eq!(source.bridge.borrow().child.id(), new);
            assert!(source.bridge.borrow().deadline.is_none());
            assert_eq!(source.call("submitAction", "game").unwrap(), "ok");
            assert!(!Command::new("kill")
                .args(["-0", &old.to_string()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success());
        }
    }

    #[test]
    fn source_failure_during_reconstruction_never_promotes_candidate() {
        let source = source();
        let old = source.bridge.borrow().child.id();
        let candidate = ready_candidate();
        let new = candidate.bridge.borrow().child.id();
        let cancel = Arc::new(AtomicBool::new(false));
        assert!(source
            .rewind_with(
                "game",
                &cancel,
                || {
                    source.bridge.borrow_mut().child.kill().unwrap();
                    Ok(candidate)
                },
                Duration::from_secs(2)
            )
            .is_err());
        assert_eq!(source.bridge.borrow().child.id(), old);
        assert!(!Command::new("kill")
            .args(["-0", &new.to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
    }

    #[test]
    fn termination_during_reconstruction_reaps_both_processes() {
        let source = source();
        let source_pid = source.bridge.borrow().child.id();
        let candidate = engine("import time; time.sleep(60)");
        let candidate_pid = candidate.bridge.borrow().child.id();
        let cancel = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&cancel);
        let trigger = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            signal.store(true, std::sync::atomic::Ordering::Relaxed);
        });
        assert!(source
            .rewind_with("game", &cancel, || Ok(candidate), Duration::from_secs(2))
            .unwrap_err()
            .contains("cancelled"));
        drop(source);
        trigger.join().unwrap();
        for pid in [source_pid, candidate_pid] {
            assert!(!Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success());
        }
    }
}
