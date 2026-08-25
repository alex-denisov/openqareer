//! What happens to the `sing-box` sidecar when the application does not get to
//! run its own exit handler.
//!
//! `main` stops the tunnel on `RunEvent::ExitRequested`/`Exit`, which covers
//! closing the window, `Cmd-Q` and an AppleScript `quit` (B147). None of those
//! events fire when the process is terminated by a signal — an installer or
//! updater replacing the running `.app`, `killall`, a logout that times out, or
//! Force Quit. The sidecar then outlives its parent: a local proxy still
//! listening and a route the candidate believes is closed, plus the runtime
//! config — which carries the SSH private key and the proxy password — left on
//! disk (PRB-011).
//!
//! Two mechanisms, because the two cases are genuinely different:
//!
//! * `SIGTERM`/`SIGINT`/`SIGHUP` are catchable, so the application stops the
//!   tunnel and exits through its normal path.
//! * `SIGKILL` is not catchable by anyone. The next launch sweeps up what the
//!   killed instance left behind, which bounds the exposure to the time the
//!   application is not running.

use std::path::{Path, PathBuf};

/// A tunnel runtime left on disk by some instance of this application.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeftoverRuntime {
    /// PID of the application instance that wrote it (encoded in the filename).
    pub owner_pid: u32,
    /// PID of the sidecar it spawned, when the companion `.pid` file survived.
    pub sidecar_pid: Option<u32>,
    pub config_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReapAction {
    /// The owning instance is gone and the sidecar is still that sidecar.
    KillSidecarAndRemoveFiles(u32),
    /// The owning instance is gone but nothing is left to kill.
    RemoveFilesOnly,
    /// Somebody still owns this runtime — do not touch it.
    Skip,
}

/// Whether a PID is running *and* is the process we think it is.
///
/// PIDs are recycled, so liveness alone is not enough to justify killing
/// anything: the caller proves identity by matching the command line.
pub trait ProcessInspector {
    fn command_line(&self, pid: u32) -> Option<String>;
}

/// Decides what to do with one leftover runtime.
///
/// Deliberately conservative: it only reaps once it has established both that
/// the owning application instance is gone and that the PID it is about to
/// kill is still running this exact runtime config.
pub fn decide_reap(
    leftover: &LeftoverRuntime,
    self_pid: u32,
    inspector: &dyn ProcessInspector,
) -> ReapAction {
    if leftover.owner_pid == self_pid {
        return ReapAction::Skip;
    }
    let owner_still_running = inspector
        .command_line(leftover.owner_pid)
        .is_some_and(|line| line.contains("openqareer"));
    if owner_still_running {
        return ReapAction::Skip;
    }
    let config_marker = leftover.config_path.to_string_lossy().to_string();
    match leftover.sidecar_pid {
        Some(pid)
            if inspector
                .command_line(pid)
                .is_some_and(|line| line.contains("sing-box") && line.contains(&config_marker)) =>
        {
            ReapAction::KillSidecarAndRemoveFiles(pid)
        }
        _ => ReapAction::RemoveFilesOnly,
    }
}

/// The companion file that records which sidecar a runtime config belongs to.
pub fn pid_path_for(config_path: &Path) -> PathBuf {
    config_path.with_extension("pid")
}

/// `tunnel-<pid>.json` → `<pid>`. Anything else is not ours.
pub fn owner_pid_from_config_name(file_name: &str) -> Option<u32> {
    file_name
        .strip_prefix("tunnel-")?
        .strip_suffix(".json")?
        .parse()
        .ok()
}

/// Reads the sidecar PID a previous instance recorded, ignoring anything
/// unparseable — a truncated file must not stop the sweep.
pub fn sidecar_pid_from_record(contents: &str) -> Option<u32> {
    contents.trim().parse().ok()
}

#[cfg(unix)]
struct SystemProcesses;

#[cfg(unix)]
impl ProcessInspector for SystemProcesses {
    fn command_line(&self, pid: u32) -> Option<String> {
        let output = std::process::Command::new("/bin/ps")
            .args(["-o", "command=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (!line.is_empty()).then_some(line)
    }
}

/// Sweeps leftover tunnel runtimes in `dir`, returning a line per action taken
/// so the caller can log what it actually did rather than what it intended.
///
/// On platforms without a `ps` this degrades to removing the leftover config
/// files (which is the credential half of the problem) and never kills
/// anything, because it cannot prove what a PID is.
pub async fn sweep_leftover_runtimes(dir: &Path) -> Vec<String> {
    #[cfg(unix)]
    let inspector = SystemProcesses;
    #[cfg(not(unix))]
    let inspector = UnknownProcesses;

    let self_pid = std::process::id();
    let mut actions = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return actions;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let config_path = entry.path();
        let Some(owner_pid) = config_path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(owner_pid_from_config_name)
        else {
            continue;
        };
        let pid_path = pid_path_for(&config_path);
        let sidecar_pid = tokio::fs::read_to_string(&pid_path)
            .await
            .ok()
            .as_deref()
            .and_then(sidecar_pid_from_record);
        let leftover = LeftoverRuntime {
            owner_pid,
            sidecar_pid,
            config_path: config_path.clone(),
        };
        match decide_reap(&leftover, self_pid, &inspector) {
            ReapAction::Skip => continue,
            ReapAction::KillSidecarAndRemoveFiles(pid) => {
                kill_process(pid);
                actions.push(format!(
                    "killed orphaned sing-box pid {pid} left by app pid {owner_pid}"
                ));
            }
            ReapAction::RemoveFilesOnly => {
                actions.push(format!(
                    "removed stale tunnel runtime of app pid {owner_pid}"
                ));
            }
        }
        let _ = tokio::fs::remove_file(&config_path).await;
        let _ = tokio::fs::remove_file(&pid_path).await;
    }
    actions
}

#[cfg(not(unix))]
struct UnknownProcesses;

#[cfg(not(unix))]
impl ProcessInspector for UnknownProcesses {
    fn command_line(&self, _pid: u32) -> Option<String> {
        None
    }
}

#[cfg(unix)]
fn kill_process(pid: u32) {
    let _ = std::process::Command::new("/bin/kill")
        .args(["-9", &pid.to_string()])
        .status();
}

#[cfg(not(unix))]
fn kill_process(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct FakeProcesses(HashMap<u32, String>);

    impl ProcessInspector for FakeProcesses {
        fn command_line(&self, pid: u32) -> Option<String> {
            self.0.get(&pid).cloned()
        }
    }

    fn leftover(owner: u32, sidecar: Option<u32>) -> LeftoverRuntime {
        LeftoverRuntime {
            owner_pid: owner,
            sidecar_pid: sidecar,
            config_path: PathBuf::from("/cfg/tunnel-100.json"),
        }
    }

    #[test]
    fn reaps_the_sidecar_of_an_application_instance_that_is_gone() {
        let processes = FakeProcesses(HashMap::from([(
            200,
            "/Applications/OpenQareer.app/Contents/MacOS/sing-box run -c /cfg/tunnel-100.json"
                .to_string(),
        )]));
        assert_eq!(
            decide_reap(&leftover(100, Some(200)), 999, &processes),
            ReapAction::KillSidecarAndRemoveFiles(200)
        );
    }

    #[test]
    fn leaves_the_runtime_of_a_second_live_application_instance_alone() {
        let processes = FakeProcesses(HashMap::from([
            (
                100,
                "/Applications/OpenQareer.app/Contents/MacOS/openqareer-desktop".to_string(),
            ),
            (200, "sing-box run -c /cfg/tunnel-100.json".to_string()),
        ]));
        assert_eq!(
            decide_reap(&leftover(100, Some(200)), 999, &processes),
            ReapAction::Skip
        );
    }

    #[test]
    fn never_reaps_the_runtime_of_the_running_process_itself() {
        let processes = FakeProcesses(HashMap::new());
        assert_eq!(
            decide_reap(&leftover(100, Some(200)), 100, &processes),
            ReapAction::Skip
        );
    }

    #[test]
    fn does_not_kill_a_recycled_pid_that_is_no_longer_our_sidecar() {
        let processes = FakeProcesses(HashMap::from([(
            200,
            "/usr/bin/some-unrelated-process".to_string(),
        )]));
        assert_eq!(
            decide_reap(&leftover(100, Some(200)), 999, &processes),
            ReapAction::RemoveFilesOnly
        );
    }

    #[test]
    fn does_not_kill_a_sing_box_serving_a_different_runtime_config() {
        let processes = FakeProcesses(HashMap::from([(
            200,
            "sing-box run -c /cfg/tunnel-777.json".to_string(),
        )]));
        assert_eq!(
            decide_reap(&leftover(100, Some(200)), 999, &processes),
            ReapAction::RemoveFilesOnly
        );
    }

    #[test]
    fn still_removes_the_credential_config_when_the_sidecar_record_is_lost() {
        let processes = FakeProcesses(HashMap::new());
        assert_eq!(
            decide_reap(&leftover(100, None), 999, &processes),
            ReapAction::RemoveFilesOnly
        );
    }

    #[test]
    fn reads_the_runtime_record_written_next_to_the_config() {
        assert_eq!(
            pid_path_for(Path::new("/cfg/tunnel-100.json")),
            PathBuf::from("/cfg/tunnel-100.pid")
        );
        assert_eq!(owner_pid_from_config_name("tunnel-100.json"), Some(100));
        assert_eq!(owner_pid_from_config_name("probe-100.json"), None);
        assert_eq!(owner_pid_from_config_name("tunnel-100.pid"), None);
        assert_eq!(sidecar_pid_from_record("200\n"), Some(200));
        assert_eq!(sidecar_pid_from_record(""), None);
    }

    #[tokio::test]
    async fn sweeping_removes_a_leftover_runtime_and_its_record() {
        let dir = std::env::temp_dir().join(format!("oq-sweep-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.expect("temp dir");
        let config = dir.join("tunnel-1.json");
        tokio::fs::write(&config, "{}").await.expect("config");
        tokio::fs::write(pid_path_for(&config), "999999")
            .await
            .expect("record");

        let actions = sweep_leftover_runtimes(&dir).await;

        assert_eq!(actions.len(), 1);
        assert!(!config.exists());
        assert!(!pid_path_for(&config).exists());
        tokio::fs::remove_dir_all(&dir).await.ok();
    }
}
