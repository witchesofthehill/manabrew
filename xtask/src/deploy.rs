//! `cargo xtask deploy` — production rollout, run from the CI runner (or a
//! laptop), never from the box. The box holds no git checkout logic and no
//! scripts: tracked config is rsynced at the release tag, images are pulled
//! from ghcr at that tag, `docker compose` reconciles, and an unhealthy
//! rollout is redeployed at the previously running tag.
//!
//! Modes:
//!   --gate       print `early=true|false` (semver compat of the client-facing
//!                crates vs the previous release) and append it to
//!                $GITHUB_OUTPUT when set
//!   --web-only   early deploy: web container only, gated like --gate
//!   (default)    full deploy: web + hub, relay only when its binary changed
//!   --only S...  pull + force-recreate the named compose services (config
//!                changes to bind-mounted files, e.g. grafana provisioning)

use std::path::Path;

use anyhow::{bail, Context, Result};

use crate::util::{capture, run, run_inherit};

const COMPOSE_FILE: &str = "compose.production.yml";
const GHCR: &str = "ghcr.io/witchesofthehill";
const RELAY_BIN: &str = "/usr/local/bin/manabrew-server";
const GATE_CRATES: [&str; 3] = ["manabrew-protocol", "manabrew-server", "manabrew-hub"];
const OBS_SERVICES: [&str; 6] = [
    "prometheus",
    "pushgateway",
    "grafana",
    "loki",
    "alloy",
    "events-ingester",
];
const OBS_CONFIG_PATHS: [&str; 2] = ["ops/observability", "scripts/ingest-events.py"];
// docker-images.yml builds the release images in a separate workflow with no
// cross-workflow `needs`, so the pull has to wait them out (~20 min typical).
const PULL_ATTEMPTS: u32 = 60;
const PULL_RETRY_SECS: u32 = 30;

enum Mode {
    Full,
    WebOnly,
    Gate,
    Only(Vec<String>),
}

struct Opts {
    tag: String,
    host: String,
    path: String,
    mode: Mode,
    allow_untagged: bool,
}

pub fn run_cmd(root: &Path, args: &[String]) -> Result<()> {
    let opts = parse(args)?;

    if let Mode::Gate = opts.mode {
        return gate(root, &opts.tag).map(|_| ());
    }

    assert_tag_checkout(root, &opts)?;

    if let Mode::Only(services) = &opts.mode {
        return deploy_only(root, &opts, services);
    }

    if matches!(opts.mode, Mode::WebOnly) && !gate(root, &opts.tag)? {
        println!("⏭️ **Early web deploy skipped** — semver-incompatible release; the full deploy runs after the installers publish.");
        return Ok(());
    }

    deploy(root, &opts)
}

fn parse(args: &[String]) -> Result<Opts> {
    let mut tag = None;
    let mut host = std::env::var("DEPLOY_SSH_HOST").ok();
    let mut path = std::env::var("DEPLOY_PATH").ok();
    let mut mode = Mode::Full;
    let mut allow_untagged = false;
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| -> Result<String> {
            it.next()
                .cloned()
                .with_context(|| format!("{name} needs a value"))
        };
        match arg.as_str() {
            "--tag" => tag = Some(value("--tag")?),
            "--host" => host = Some(value("--host")?),
            "--path" => path = Some(value("--path")?),
            "--web-only" => mode = Mode::WebOnly,
            "--gate" => mode = Mode::Gate,
            "--allow-untagged" => allow_untagged = true,
            "--only" => {
                let services: Vec<String> = it.clone().cloned().collect();
                if services.is_empty() {
                    bail!("--only needs at least one compose service");
                }
                mode = Mode::Only(services);
                break;
            }
            other => bail!("unknown deploy argument `{other}`"),
        }
    }
    let tag = tag.context("--tag vX.Y.Z is required")?;
    if !tag.strip_prefix('v').is_some_and(|rest| {
        rest.chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-".contains(c))
    }) {
        bail!("`{tag}` does not look like a release tag");
    }
    if matches!(mode, Mode::Gate) {
        return Ok(Opts {
            tag,
            host: String::new(),
            path: String::new(),
            mode,
            allow_untagged,
        });
    }
    Ok(Opts {
        tag,
        host: host.context("--host (or DEPLOY_SSH_HOST) is required")?,
        path: path.context("--path (or DEPLOY_PATH) is required")?,
        mode,
        allow_untagged,
    })
}

// Deploying a checkout that is not the tag would re-open the config/image skew
// this command exists to close (config rsynced from HEAD, images pulled at the
// tag — issue #512 gap 1).
fn assert_tag_checkout(root: &Path, opts: &Opts) -> Result<()> {
    let head = run(
        root,
        "git",
        &["describe", "--exact-match", "--tags", "HEAD"],
    )
    .map(|s| s.trim().to_string())
    .unwrap_or_default();
    if head == opts.tag {
        return Ok(());
    }
    let msg = format!(
        "HEAD is `{head}`, not `{}` — config would not match the images",
        opts.tag
    );
    if opts.allow_untagged || matches!(opts.mode, Mode::Only(_)) {
        eprintln!("⚠️ {msg} (continuing)");
        Ok(())
    } else {
        bail!("{msg}; check out the tag or pass --allow-untagged");
    }
}

// ── Gate: is this release safe to web-deploy before the installers? ──

fn gate(root: &Path, tag: &str) -> Result<bool> {
    let early = match previous_release_tag(root, tag)? {
        None => {
            println!("no previous release tag — taking the safe deploy-last path");
            false
        }
        Some(prev) => match incompatible_crate(root, &prev, tag)? {
            Some(reason) => {
                println!("{reason} — taking the safe deploy-last path");
                false
            }
            None => true,
        },
    };
    println!("early={early}");
    if let Ok(out) = std::env::var("GITHUB_OUTPUT") {
        use std::io::Write as _;
        std::fs::OpenOptions::new()
            .append(true)
            .open(out)?
            .write_all(format!("early={early}\n").as_bytes())?;
    }
    Ok(early)
}

fn previous_release_tag(root: &Path, tag: &str) -> Result<Option<String>> {
    let out = capture(
        root,
        "git",
        &[
            "describe",
            "--tags",
            "--abbrev=0",
            "--match",
            "v[0-9]*",
            &format!("{tag}^"),
        ],
    )?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8(out.stdout)?.trim().to_string()))
}

fn incompatible_crate(root: &Path, prev: &str, tag: &str) -> Result<Option<String>> {
    let old = manifest_at(root, prev)?;
    let new = manifest_at(root, tag)?;
    for crate_name in GATE_CRATES {
        let (Some(o), Some(n)) = (
            old["packages"][crate_name].as_str(),
            new["packages"][crate_name].as_str(),
        ) else {
            return Ok(Some(format!("{crate_name} missing from a manifest")));
        };
        let o: semver::Version = o.parse()?;
        let n: semver::Version = n.parse()?;
        // Cargo semver compatibility: 0.x crates break on minor bumps too.
        let compatible = o.major == n.major && (o.major != 0 || o.minor == n.minor);
        if !compatible {
            return Ok(Some(format!(
                "{crate_name}: {o} → {n} is semver-incompatible"
            )));
        }
    }
    Ok(None)
}

fn manifest_at(root: &Path, refname: &str) -> Result<serde_json::Value> {
    let raw = run(
        root,
        "git",
        &["show", &format!("{refname}:ops/manifest.json")],
    )?;
    serde_json::from_str(&raw).with_context(|| format!("parsing ops/manifest.json at {refname}"))
}

// ── Remote plumbing ──────────────────────────────────────────────────

const SSH_OPTS: [&str; 4] = [
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=120",
];

fn ssh(root: &Path, host: &str, script: &str) -> Result<String> {
    let mut args: Vec<&str> = SSH_OPTS.to_vec();
    args.push(host);
    args.push(script);
    run(root, "ssh", &args)
}

fn ssh_streamed(root: &Path, host: &str, script: &str) -> Result<()> {
    let mut args: Vec<&str> = SSH_OPTS.to_vec();
    args.push(host);
    args.push(script);
    run_inherit(root, "ssh", &args)
}

// Every compose invocation needs the box .env files in scope: the compose file
// has required interpolations (`${MANABREW_SERVER_KEY:?}`) and the server .env
// carries COMPOSE_PROFILES.
fn compose(path: &str, tag: &str, rest: &str) -> String {
    format!(
        "cd '{path}' && set -a && {{ [ -f ./.env ] && . ./.env; }}; \
         {{ [ -f manabrew-rs/crates/manabrew-server/.env ] && . manabrew-rs/crates/manabrew-server/.env; }}; \
         set +a; export MANABREW_IMAGE_TAG='{tag}'; \
         docker compose -f {COMPOSE_FILE} {rest}"
    )
}

// Tracked files only: the data dirs living under ops/ (hub-data,
// observability/data) are gitignored and must never be touched by the sync.
// No --delete for the same reason.
fn sync_config(root: &Path, opts: &Opts) -> Result<()> {
    println!(
        "📤 syncing config at {} to {}:{}",
        opts.tag, opts.host, opts.path
    );
    let ssh_cmd = format!("ssh {}", SSH_OPTS.join(" "));
    run(
        root,
        "sh",
        &[
            "-c",
            &format!(
                "git ls-files -z -- {COMPOSE_FILE} ops scripts/ingest-events.py \
                 | rsync -0 --files-from=- -az -e '{ssh_cmd}' . '{}:{}/'",
                opts.host, opts.path
            ),
        ],
    )?;
    Ok(())
}

fn running_image_tag(root: &Path, opts: &Opts, service: &str) -> Result<Option<String>> {
    let script = compose(
        &opts.path,
        &opts.tag,
        &format!(
            "ps -q {service} | head -1 | xargs -r docker inspect --format '{{{{.Config.Image}}}}'"
        ),
    );
    let out = ssh(root, &opts.host, &script)?;
    Ok(out
        .trim()
        .rsplit(':')
        .next()
        .filter(|t| !t.is_empty() && out.contains(':'))
        .map(String::from))
}

fn pull_images(root: &Path, opts: &Opts, images: &[String]) -> Result<()> {
    let pulls = images
        .iter()
        .map(|i| format!("docker pull -q '{i}' >/dev/null"))
        .collect::<Vec<_>>()
        .join(" && ");
    println!(
        "⬇️ pulling {} image(s) at {} (waits out docker-images.yml)",
        images.len(),
        opts.tag
    );
    ssh_streamed(
        root,
        &opts.host,
        &format!(
            "for i in $(seq 1 {PULL_ATTEMPTS}); do \
               if {pulls}; then echo \"images ready after $i attempt(s)\"; exit 0; fi; \
               echo \"pull attempt $i/{PULL_ATTEMPTS} failed (CI still building?); retry in {PULL_RETRY_SECS}s\" >&2; \
               sleep {PULL_RETRY_SECS}; \
             done; echo 'release images never appeared on ghcr' >&2; exit 1"
        ),
    )
}

fn binary_sha(root: &Path, opts: &Opts, image: &str) -> Option<String> {
    let out = capture(
        root,
        "ssh",
        &[
            SSH_OPTS[0],
            SSH_OPTS[1],
            SSH_OPTS[2],
            SSH_OPTS[3],
            &opts.host,
            &format!(
                "docker run --rm --entrypoint sha256sum '{image}' {RELAY_BIN} | cut -d' ' -f1"
            ),
        ],
    )
    .ok()?;
    if !out.status.success() {
        return None;
    }
    let sha = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (!sha.is_empty()).then_some(sha)
}

// ── Deploys ──────────────────────────────────────────────────────────

fn deploy(root: &Path, opts: &Opts) -> Result<()> {
    let web_only = matches!(opts.mode, Mode::WebOnly);
    let prev = running_image_tag(root, opts, "manabrew")?;
    sync_config(root, opts)?;

    let mut images = vec![format!("{GHCR}/manabrew-web:{}", opts.tag)];
    if !web_only {
        images.push(format!("{GHCR}/manabrew-server:{}", opts.tag));
        images.push(format!("{GHCR}/manabrew-hub:{}", opts.tag));
    }
    pull_images(root, opts, &images)?;

    let mut services = vec!["manabrew"];
    let mut relay_note = String::new();
    if !web_only {
        services.push("manabrew-hub");
        // Restarting the relay kills every live game, so it only restarts when
        // the binary inside the fresh image actually differs from the running
        // one — an image-digest change from an unrelated base bump must not.
        let running = ssh(
            root,
            &opts.host,
            &compose(
                &opts.path,
                &opts.tag,
                "ps -q manabrew-server | head -1 | xargs -r docker inspect --format '{{.Image}}'",
            ),
        )?
        .trim()
        .to_string();
        let old_sha = (!running.is_empty())
            .then(|| binary_sha(root, opts, &running))
            .flatten();
        let new_sha = binary_sha(root, opts, &format!("{GHCR}/manabrew-server:{}", opts.tag));
        match (old_sha, new_sha) {
            (Some(o), Some(n)) if o == n => {
                relay_note =
                    "🛡️ **Relay:** binary unchanged — not restarted, live games preserved\n"
                        .to_string();
            }
            _ => services.push("manabrew-server"),
        }
    }

    let list = services.join(" ");
    println!("🚀 rolling out: {list}");
    // --no-deps: never recreate dependencies as a side effect (an `up manabrew`
    // without it recreates the relay it depends_on). --remove-orphans: renamed/
    // removed services must not linger holding host ports.
    let up = |tag: &str| {
        compose(
            &opts.path,
            tag,
            &format!("up -d --no-deps --remove-orphans --wait --wait-timeout 180 {list}"),
        )
    };
    if ssh_streamed(root, &opts.host, &up(&opts.tag)).is_err() {
        match &prev {
            Some(prev_tag) if prev_tag != &opts.tag => {
                eprintln!("⚠️ rollout unhealthy — redeploying {prev_tag}");
                ssh_streamed(root, &opts.host, &up(prev_tag))?;
                bail!(
                    "rollout of {} was unhealthy; redeployed {prev_tag}",
                    opts.tag
                );
            }
            _ => bail!(
                "rollout of {} was unhealthy and no previous tag is known",
                opts.tag
            ),
        }
    }

    // Bind-mounted and not watched by caddy; a recreate picks it up, but the
    // reload covers a Caddyfile-only change where the image was identical.
    ssh_streamed(
        root,
        &opts.host,
        &compose(
            &opts.path,
            &opts.tag,
            "exec -T manabrew caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile",
        ),
    )?;

    let mut obs_note = String::new();
    if !web_only {
        obs_note = recreate_observability_if_changed(root, opts, prev.as_deref())?;
    }

    print_summary(root, opts, prev.as_deref(), &list, &relay_note, &obs_note);
    Ok(())
}

// compose can't see bind-mount content changes, so config-only edits to the
// observability stack need an explicit force-recreate (never an image build).
fn recreate_observability_if_changed(
    root: &Path,
    opts: &Opts,
    prev: Option<&str>,
) -> Result<String> {
    let Some(prev) = prev else {
        return Ok(String::new());
    };
    let changed = run(
        root,
        "git",
        &[
            "diff",
            "--name-only",
            prev,
            &opts.tag,
            "--",
            OBS_CONFIG_PATHS[0],
            OBS_CONFIG_PATHS[1],
        ],
    )
    .map(|s| !s.trim().is_empty())
    .unwrap_or(false);
    if !changed {
        return Ok(String::new());
    }
    let probe = compose(
        &opts.path,
        &opts.tag,
        "--profile observability ps -q grafana",
    );
    if ssh(root, &opts.host, &probe)?.trim().is_empty() {
        return Ok(
            "📊 **Observability:** config changed but stack not running — skipped\n".to_string(),
        );
    }
    let list = OBS_SERVICES.join(" ");
    println!("📊 observability config changed — recreating {list}");
    ssh_streamed(
        root,
        &opts.host,
        &compose(
            &opts.path,
            &opts.tag,
            &format!("--profile observability up -d --no-deps --force-recreate {list}"),
        ),
    )?;
    Ok(format!(
        "📊 **Observability:** config changed — recreated {list}\n"
    ))
}

fn deploy_only(root: &Path, opts: &Opts, services: &[String]) -> Result<()> {
    sync_config(root, opts)?;
    let list = services.join(" ");
    let mut profiles = String::new();
    if services.iter().any(|s| s == "parity-dashboard") {
        profiles.push_str("--profile parity ");
    }
    if services.iter().any(|s| OBS_SERVICES.contains(&s.as_str())) {
        profiles.push_str("--profile observability ");
    }
    ssh_streamed(
        root,
        &opts.host,
        &compose(
            &opts.path,
            &opts.tag,
            &format!("{profiles}pull --quiet {list} || true"),
        ),
    )?;
    // --force-recreate: these services' configs are bind-mounted, so `up -d`
    // alone would consider an unchanged image up-to-date and never pick the
    // new config up.
    ssh_streamed(
        root,
        &opts.host,
        &compose(
            &opts.path,
            &opts.tag,
            &format!("{profiles}up -d --no-deps --force-recreate {list}"),
        ),
    )?;
    println!("🎯 **Single-service rollout complete** ({})", opts.tag);
    println!("🔁 Recreated: {list}");
    Ok(())
}

fn print_summary(
    root: &Path,
    opts: &Opts,
    prev: Option<&str>,
    services: &str,
    relay_note: &str,
    obs_note: &str,
) {
    let prev_label = prev.unwrap_or("unknown");
    let mut changelog = prev
        .and_then(|p| {
            run(
                root,
                "git",
                &[
                    "log",
                    "--pretty=format:- %s (%h, %an)",
                    &format!("{p}..{}", opts.tag),
                ],
            )
            .ok()
        })
        .unwrap_or_default();
    if changelog.len() > 1500 {
        changelog.truncate(1500);
        changelog.push_str("\n… (truncated)");
    }
    if changelog.is_empty() {
        changelog = "(no commit range available)".to_string();
    }
    let mode = if matches!(opts.mode, Mode::WebOnly) {
        "🌐 **Web-only:** relay + hub deferred to the final deploy\n"
    } else {
        ""
    };
    println!(
        "🎉 **Deploy complete** (`{prev_label}` → `{tag}`)\n\n\
         🔁 **Rolled out:** {services} (tag `{tag}`)\n\
         {relay_note}{obs_note}{mode}\
         📝 **Changelog:**\n{changelog}",
        tag = opts.tag,
    );
}
