#!/usr/bin/env bash
# Setup script for a Linux self-hosted GitHub Actions runner that builds
# the WASM + card data, runs the TypeScript checker, and compiles the
# Rust workspace for this repo.
#
# Run as a user with sudo (not as root directly):
#   $ chmod +x scripts/setup-linux-runner.sh
#   $ ./scripts/setup-linux-runner.sh
#
# Installs: core build deps (compiler toolchain, pkg-config, OpenSSL
# headers, git, curl, jq, ca-certificates), Node.js LTS, Yarn (via
# corepack), Rust (rustup, stable MSVC-equivalent = gnu on Linux),
# wasm32-unknown-unknown target, and wasm-pack.
#
# Idempotent: each step skips work already done. Safe to re-run.
#
# Target distros: Debian/Ubuntu (apt), Fedora/RHEL (dnf) — which covers
# Fedora Asahi Remix on Apple Silicon — and Arch (pacman). Other
# families abort early with a clear message.
#
# Architecture-independent: nothing here assumes x86_64, so it also
# provisions an aarch64 host.

set -euo pipefail

# ---------- helpers -------------------------------------------------------

section() {
    local msg="$1"
    local bar
    bar=$(printf '%.0s-' $(seq 1 $((70 - ${#msg}))))
    printf '\n\033[1;36m== %s %s\033[0m\n' "$msg" "$bar"
}

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# Re-exec under sudo if the invoking user is not root. Keeps HOME so that
# rustup writes to the user's profile rather than /root.
require_root() {
    if [[ $EUID -ne 0 ]]; then
        if ! has_cmd sudo; then
            echo "This script needs root privileges and 'sudo' is not installed." >&2
            exit 1
        fi
        # Preserve the invoking user so Rust / Node user-level installs
        # land in the runner account's home, not root's.
        export RUNNER_USER="${RUNNER_USER:-$USER}"
        export RUNNER_HOME="${RUNNER_HOME:-$HOME}"
        exec sudo -E RUNNER_USER="$RUNNER_USER" RUNNER_HOME="$RUNNER_HOME" bash "$0" "$@"
    fi
    : "${RUNNER_USER:=${SUDO_USER:-root}}"
    : "${RUNNER_HOME:=$(getent passwd "$RUNNER_USER" | cut -d: -f6)}"
    if [[ -z "$RUNNER_HOME" ]]; then
        echo "Could not resolve HOME for user '$RUNNER_USER'." >&2
        exit 1
    fi
}

# Run a command as the runner user (not root). Used for rustup / cargo
# installs that must write to $RUNNER_HOME.
as_runner() {
    sudo -u "$RUNNER_USER" -H bash -lc "$*"
}

# ---------- 1. sanity checks ---------------------------------------------

require_root "$@"

section "Distro detection"
if [[ ! -f /etc/os-release ]]; then
    echo "Cannot detect distro: /etc/os-release missing." >&2
    exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
echo "Detected: $PRETTY_NAME (ID=$ID, ID_LIKE=${ID_LIKE:-n/a})"
case "${ID,,} ${ID_LIKE:-}" in
    *debian*|*ubuntu*)                  PKG_FAMILY=debian ;;
    *fedora*|*rhel*|*centos*)           PKG_FAMILY=fedora ;;
    *arch*)                             PKG_FAMILY=arch ;;
    *)
        echo "Unsupported distro '$ID'. Supported families: Debian/Ubuntu" >&2
        echo "(apt), Fedora/RHEL (dnf), Arch (pacman)." >&2
        exit 1
        ;;
esac
echo "Package family: $PKG_FAMILY ($(uname -m))"
echo "Runner user: $RUNNER_USER (HOME=$RUNNER_HOME)"

# ---------- 2. core packages ----------------------------------------------

section "Core packages (build tools, TLS, jq, git)"
# compiler toolchain : gcc/g++/make — cargo linker + native node modules
# pkg-config         : cargo build scripts (openssl-sys, etc.)
# openssl headers    : cargo crates that link libssl
# ca-certificates    : TLS trust for curl / rustup / cargo
# curl, wget, git    : checkout + installers
# jq                 : release workflow payload assembly
# unzip, xz          : occasional tarball helpers
# python3            : some build scripts (node-gyp fallback)
case "$PKG_FAMILY" in
    debian)
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -y
        apt-get install -y --no-install-recommends \
            build-essential \
            pkg-config \
            libssl-dev \
            ca-certificates \
            curl \
            wget \
            git \
            jq \
            unzip \
            xz-utils \
            python3
        ;;
    fedora)
        dnf install -y \
            gcc \
            gcc-c++ \
            make \
            pkgconf-pkg-config \
            openssl-devel \
            ca-certificates \
            curl \
            wget \
            git \
            jq \
            unzip \
            xz \
            python3
        ;;
    arch)
        # -Syu, not -Sy: a partial upgrade on Arch can leave the system
        # with mismatched libc/toolchain versions.
        pacman -Syu --needed --noconfirm \
            base-devel \
            pkgconf \
            openssl \
            ca-certificates \
            curl \
            wget \
            git \
            jq \
            unzip \
            xz \
            python
        ;;
esac

# ---------- 3. Node.js LTS ------------------------------------------------

section "Node.js LTS"
NODE_MAJOR_TARGET=20

node_major() {
    has_cmd node || return 0
    local ver
    ver=$(node --version | sed 's/^v//')
    echo "${ver%%.*}"
}

install_node() {
    case "$PKG_FAMILY" in
        debian)
            curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_TARGET}.x" | bash -
            apt-get install -y nodejs
            ;;
        fedora)
            # Fedora ships a current Node; only older RHEL rebuilds need
            # NodeSource, so try the distro package and check the result.
            dnf install -y nodejs npm || true
            local got
            got=$(node_major)
            if (( ${got:-0} < NODE_MAJOR_TARGET )); then
                curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR_TARGET}.x" | bash -
                dnf install -y nodejs
            fi
            ;;
        arch)
            pacman -S --needed --noconfirm nodejs npm corepack
            ;;
    esac
}

current_major=$(node_major)
if [[ -n "$current_major" ]]; then
    echo "node already installed: v$(node --version | sed 's/^v//')"
    if (( current_major < NODE_MAJOR_TARGET )); then
        echo "  upgrading to Node.js $NODE_MAJOR_TARGET.x (LTS)."
        install_node
    fi
else
    install_node
fi

# ---------- 4. Yarn via corepack -----------------------------------------

# Yarn is enabled through corepack (ships with Node >=16) rather than
# the distro `yarn` package, which is Berry on Debian/Ubuntu and would
# rewrite yarn.lock into a format CI's --frozen-lockfile rejects.
section "Yarn (via corepack)"
# Pin Classic (1.x) — matches the `yarn.lock` format the workflow expects.
YARN_VERSION=1.22.22
if has_cmd corepack; then
    corepack enable
    corepack prepare "yarn@$YARN_VERSION" --activate
else
    # Fedora ships no corepack package and strips the copy bundled in the
    # upstream Node tarball, so fall back to a plain global install.
    npm install -g "yarn@$YARN_VERSION"
fi
yarn --version

# ---------- 5. Rust (rustup) for the runner user --------------------------

section "Rust toolchain (stable, gnu)"
CARGO_BIN="$RUNNER_HOME/.cargo/bin"
if as_runner "command -v rustc >/dev/null 2>&1"; then
    echo "rustc already installed: $(as_runner 'rustc --version')"
    as_runner "rustup update stable"
else
    echo "Installing rustup for $RUNNER_USER..."
    as_runner "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
fi

# ---------- 5b. wasm32 target --------------------------------------------

section "wasm32-unknown-unknown target"
if as_runner "$CARGO_BIN/rustup target list --installed" | grep -q '^wasm32-unknown-unknown$'; then
    echo "wasm32-unknown-unknown already installed."
else
    as_runner "$CARGO_BIN/rustup target add wasm32-unknown-unknown"
fi

# ---------- 6. wasm-pack --------------------------------------------------

section "wasm-pack"
if as_runner "command -v wasm-pack >/dev/null 2>&1" || [[ -x "$CARGO_BIN/wasm-pack" ]]; then
    echo "wasm-pack already installed: $(as_runner "$CARGO_BIN/wasm-pack --version" 2>/dev/null || echo unknown)"
else
    # Prefer the prebuilt installer (fast, no compile) and fall back to
    # `cargo install` if the upstream script ever misses this arch.
    if ! as_runner "curl -fsSL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh"; then
        echo "Prebuilt installer failed — falling back to cargo install."
        as_runner "$CARGO_BIN/cargo install wasm-pack --locked"
    fi
fi

# ---------- 7. Ensure cargo is on PATH for the runner shell ---------------

# The GitHub Actions runner executes steps via bash -l, which sources
# ~/.profile / ~/.bashrc. rustup appends its PATH export to ~/.profile,
# but older ~/.bashrc files may not source it. Add an idempotent guard.
section "Shell PATH (runner login shells)"
for rc in "$RUNNER_HOME/.bashrc" "$RUNNER_HOME/.profile"; do
    if [[ -f "$rc" ]] && ! grep -q '.cargo/env' "$rc"; then
        echo '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"' >> "$rc"
        chown "$RUNNER_USER:$RUNNER_USER" "$rc" 2>/dev/null || true
        echo "Appended cargo env to $rc"
    fi
done

# ---------- 8. Cargo binaries on system PATH -----------------------------

# The runner service executes step shells as non-login bash, so
# ~/.bashrc / ~/.profile are NOT sourced and the cargo env from step 7
# never reaches `cargo check` / `wasm-pack`. Two belt-and-suspenders
# fixes:
#   a) Symlink the toolchain binaries into /usr/local/bin (always on the
#      service's default PATH — no env file needed).
#   b) Write ~/actions-runner/.env with the cargo bin prepended to PATH.
#      runsvc.sh sources this file before each job, so PATH sticks even
#      if /usr/local/bin ever gets scrubbed.
section "Cargo on system PATH (symlinks)"
for bin in cargo rustc rustup rustdoc wasm-pack; do
    src="$CARGO_BIN/$bin"
    if [[ -x "$src" ]]; then
        ln -sf "$src" "/usr/local/bin/$bin"
        echo "Linked /usr/local/bin/$bin -> $src"
    fi
done

section "actions-runner/.env PATH injection"
RUNNER_ROOT="$RUNNER_HOME/actions-runner"
if [[ -d "$RUNNER_ROOT" ]]; then
    env_file="$RUNNER_ROOT/.env"
    touch "$env_file"
    chown "$RUNNER_USER:$RUNNER_USER" "$env_file"
    # Remove any prior PATH= line this script wrote, then append a fresh
    # one. Idempotent: re-running the script won't duplicate entries.
    tmp=$(mktemp)
    grep -v '^PATH=' "$env_file" > "$tmp" || true
    echo "PATH=$CARGO_BIN:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin" >> "$tmp"
    mv "$tmp" "$env_file"
    chown "$RUNNER_USER:$RUNNER_USER" "$env_file"
    echo "Wrote PATH= into $env_file"
else
    echo "Runner directory $RUNNER_ROOT not found — skipping .env injection."
    echo "Install the runner first, then re-run this script."
fi

# ---------- 9. GitHub Actions runner service -----------------------------

# Restart the unit so it re-reads .env and picks up the new PATH.
section "GitHub Actions runner service"
runner_units=$(systemctl list-units --type=service --all --no-legend 2>/dev/null \
    | awk '{print $1}' \
    | grep -E '^actions\.runner\..*\.service$' || true)

if [[ -z "$runner_units" ]]; then
    echo "No 'actions.runner.*.service' systemd unit found."
    echo "If you installed the runner under ~/actions-runner, register the"
    echo "service with:  cd ~/actions-runner && sudo ./svc.sh install && sudo ./svc.sh start"
else
    while IFS= read -r unit; do
        echo "Restarting $unit to pick up new PATH..."
        systemctl restart "$unit"
    done <<< "$runner_units"
    sleep 2
    systemctl --no-pager --no-legend status $runner_units | head -n 20 || true
fi

# ---------- 10. Sanity check ---------------------------------------------

section "Versions"
try_version() {
    local cmd="$1"
    local arg="${2:---version}"
    if as_runner "command -v $cmd >/dev/null 2>&1"; then
        printf '%-12s %s\n' "$cmd" "$(as_runner "$cmd $arg 2>&1 | head -n1")"
    else
        printf '%-12s NOT FOUND\n' "$cmd"
    fi
}

try_version git
try_version node
try_version npm
try_version yarn
try_version rustc
try_version cargo
try_version wasm-pack
try_version jq
try_version pkg-config

if as_runner "$CARGO_BIN/rustup target list --installed" | grep -q '^wasm32-unknown-unknown$'; then
    echo "wasm32       installed"
else
    echo "wasm32       NOT INSTALLED"
fi

section "Next steps"
cat <<EOF
1. Confirm the runner service is online in GitHub: Settings -> Actions ->
   Runners. It should show 'Idle'.
2. Trigger a quick smoke test by re-running any job from
   .github/workflows/build-checks.yml (TypeScript, WASM build, Rust engine).
3. If the runner still reports 'cargo: command not found' after this
   script finishes, verify both fixes landed:
     a) ls -l /usr/local/bin/cargo   # should symlink to $CARGO_BIN/cargo
     b) grep '^PATH=' $RUNNER_HOME/actions-runner/.env
   Then restart the service: sudo systemctl restart 'actions.runner.*'.
4. This script does NOT install Tauri bundling deps (webkit2gtk, libsoup,
   libayatana-appindicator, etc.) because the Linux workflows in this repo
   only run checks + WASM + release publish. Add them here if you later
   start producing Linux .AppImage/.deb artifacts on this runner.
EOF
