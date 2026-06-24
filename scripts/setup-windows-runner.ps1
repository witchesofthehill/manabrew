# Setup script for a Windows self-hosted GitHub Actions runner that builds
# the Tauri .exe bundle for this repo.
#
# Run as Administrator:
#   PS> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
#   PS> .\scripts\setup-windows-runner.ps1
#
# Installs: Chocolatey, Git, Node LTS, Yarn, NSIS, jq, Maven, PowerShell 7
# (pwsh), WebView2 runtime, GraalVM for JDK 21 (java + native-image), Visual
# Studio 2022 Build Tools (C++ workload + Win11 SDK), Rust (MSVC), the Tauri CLI
# and wasm-pack. GraalVM + Maven + the C++ toolchain are what the forge-room
# native engine (libforgeharness) needs; pwsh runs build-native.ps1.
#
# Idempotent: each step skips work already done. Safe to re-run.
#
# ASCII-only on purpose so PowerShell 5.1 (Windows default codepage) parses
# the file correctly without a UTF-8 BOM.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"   # faster Invoke-WebRequest

function Section($msg) {
    $bar = "-" * [Math]::Max(0, 70 - $msg.Length)
    Write-Host "`n== $msg $bar" -ForegroundColor Cyan
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")  + ";" +
                "$env:USERPROFILE\.cargo\bin"
}

function Has-Command($name) {
    $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Add-ToSystemPath($dir) {
    # Persists to HKLM so every account - including the GitHub Actions runner
    # service - sees the entry. Running processes keep their old PATH until
    # restarted; the runner service restart is handled later in this script.
    $current = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $entries = $current -split ';' | Where-Object { $_ -ne '' }
    if ($entries -notcontains $dir) {
        [Environment]::SetEnvironmentVariable("Path", "$current;$dir", "Machine")
        Write-Host "Added to system PATH: $dir"
    } else {
        Write-Host "Already on system PATH: $dir"
    }
}

function Set-MachineEnv($name, $value) {
    # Persist to HKLM so the runner service account sees it, and update the
    # current session so later steps in this script can use it immediately.
    [Environment]::SetEnvironmentVariable($name, $value, "Machine")
    Set-Item -Path "Env:$name" -Value $value
    Write-Host "Set $name = $value (Machine)"
}

function Grant-LogOnAsServiceRight {
    # Grants the SeServiceLogonRight privilege to an account by calling
    # LsaAddAccountRights directly via P/Invoke. More reliable than secedit,
    # which can silently fail (exit 0 without applying the change).
    param([Parameter(Mandatory)][string]$AccountName)

    $normalised = $AccountName
    if ($normalised.StartsWith('.\')) {
        $normalised = "$env:COMPUTERNAME\" + $normalised.Substring(2)
    } elseif ($normalised -notmatch '\\') {
        $normalised = "$env:COMPUTERNAME\$normalised"
    }

    try {
        $sid = (New-Object System.Security.Principal.NTAccount($normalised)).Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
    } catch {
        throw "Could not resolve account '$normalised' to a SID: $($_.Exception.Message)"
    }

    if (-not ('LsaGrant' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class LsaGrant {
    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES {
        public int    Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint   Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES Attrs, uint AccessMask, out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint LsaAddAccountRights(IntPtr PolicyHandle, byte[] AccountSid, LSA_UNICODE_STRING[] UserRights, uint CountOfRights);

    [DllImport("advapi32.dll")]
    private static extern uint LsaClose(IntPtr Handle);

    [DllImport("advapi32.dll")]
    private static extern int LsaNtStatusToWinError(uint Status);

    public static void Grant(string sidString, string rightName) {
        var sid = new SecurityIdentifier(sidString);
        var sidBytes = new byte[sid.BinaryLength];
        sid.GetBinaryForm(sidBytes, 0);

        var attrs = new LSA_OBJECT_ATTRIBUTES { Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES)) };

        IntPtr handle;
        // POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES = 0x30
        uint status = LsaOpenPolicy(IntPtr.Zero, ref attrs, 0x30, out handle);
        if (status != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(status), "LsaOpenPolicy failed");

        IntPtr buf = IntPtr.Zero;
        try {
            byte[] nameBytes = System.Text.Encoding.Unicode.GetBytes(rightName);
            buf = Marshal.AllocHGlobal(nameBytes.Length);
            Marshal.Copy(nameBytes, 0, buf, nameBytes.Length);

            var rights = new LSA_UNICODE_STRING[1];
            rights[0].Length        = (ushort)nameBytes.Length;
            rights[0].MaximumLength = (ushort)nameBytes.Length;
            rights[0].Buffer        = buf;

            status = LsaAddAccountRights(handle, sidBytes, rights, 1);
            if (status != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(status), "LsaAddAccountRights failed");
        } finally {
            if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
            LsaClose(handle);
        }
    }
}
'@ -ErrorAction Stop
    }

    try {
        [LsaGrant]::Grant($sid, "SeServiceLogonRight")
        Write-Host "Granted 'Log on as a service' to $normalised (SID $sid)."
    } catch {
        throw "LsaAddAccountRights failed for $normalised ($sid): $($_.Exception.Message)"
    }
}

# --- 1. TLS 1.2 -----------------------------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- 2. Chocolatey --------------------------------------------------------
Section "Chocolatey"
if (Has-Command choco) {
    Write-Host "choco already installed: $(choco --version)"
} else {
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Refresh-Path
}

# --- 3. Core tools via Chocolatey ----------------------------------------
Section "Core tools (git, node, yarn, nsis, jq, maven, powershell 7)"
$packages = @(
    "git",
    "nodejs-lts",
    "yarn",
    "nsis",
    "jq",
    "maven",
    "powershell-core"
)
foreach ($pkg in $packages) {
    Write-Host "-> $pkg"
    choco install -y --no-progress $pkg
}
Refresh-Path

# --- 3b. GraalVM for JDK 21 (java + native-image) ------------------------
# native-image builds the forge-room native lib (libforgeharness); the harness
# Maven build runs on this JDK too. Pinned to match build-native.sh's default.
# Maven and javac resolve their JDK from JAVA_HOME, so point it at GraalVM.
Section "GraalVM for JDK 21 (java + native-image)"
$graalVersion = "21.0.2"
$graalRoot    = "C:\graalvm"
$existingHome = [Environment]::GetEnvironmentVariable("GRAALVM_HOME", "Machine")
if ($existingHome -and (Test-Path (Join-Path $existingHome "bin\native-image.cmd"))) {
    Write-Host "GraalVM already installed at: $existingHome"
    $graalHome = $existingHome
} else {
    $zip = "$env:TEMP\graalvm-ce-$graalVersion.zip"
    $url = "https://github.com/graalvm/graalvm-ce-builds/releases/download/jdk-$graalVersion/graalvm-community-jdk-${graalVersion}_windows-x64_bin.zip"
    Write-Host "Downloading $url ..."
    Invoke-WebRequest -Uri $url -OutFile $zip
    if (Test-Path $graalRoot) { Remove-Item -Recurse -Force $graalRoot }
    New-Item -ItemType Directory -Force -Path $graalRoot | Out-Null
    Write-Host "Extracting to $graalRoot ..."
    Expand-Archive -Path $zip -DestinationPath $graalRoot -Force
    Remove-Item $zip -ErrorAction SilentlyContinue
    $graalHome = (Get-ChildItem -Path $graalRoot -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "bin\native-image.cmd") } |
        Select-Object -First 1).FullName
    if (-not $graalHome) { throw "GraalVM extracted but bin\native-image.cmd not found under $graalRoot" }
    Write-Host "Installed at: $graalHome"
}
Set-MachineEnv "GRAALVM_HOME" $graalHome
Set-MachineEnv "JAVA_HOME"    $graalHome
Add-ToSystemPath (Join-Path $graalHome "bin")
Refresh-Path

# WebView2 Runtime ships preinstalled on Windows 10 (20H1+) and Windows 11,
# so no choco package is needed. Verify the install key is present; if
# missing, point the user at the Evergreen Bootstrapper instead of failing
# the build later inside Tauri.
Section "WebView2 Runtime (preinstalled check)"
$wv2Keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$wv2Installed = $false
foreach ($k in $wv2Keys) {
    if (Test-Path $k) {
        $ver = (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv
        if ($ver) {
            Write-Host "WebView2 Runtime present: $ver"
            $wv2Installed = $true
            break
        }
    }
}
if (-not $wv2Installed) {
    Write-Warning "WebView2 Runtime not detected. Install the Evergreen Bootstrapper manually from https://developer.microsoft.com/microsoft-edge/webview2/ before running a Tauri build."
}

# --- 4. Visual Studio 2022 Build Tools (C++ workload) --------------------
Section "Visual Studio 2022 Build Tools + C++ workload"
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath  = ""
if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
}

if ($vsPath) {
    Write-Host "VS Build Tools with C++ already installed at: $vsPath"
} else {
    Write-Host "Downloading vs_buildtools.exe (direct bootstrapper - chocolatey's param-passing is flaky for this)..."
    $installer = "$env:TEMP\vs_buildtools.exe"
    Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile $installer
    Write-Host "Running installer (10-30 min, no progress output; wait for prompt)..."
    $vsArgs = @(
        "--quiet", "--wait", "--norestart", "--nocache",
        "--add", "Microsoft.VisualStudio.Workload.VCTools",
        "--add", "Microsoft.VisualStudio.Component.Windows11SDK.22621",
        "--includeRecommended"
    )
    $proc = Start-Process -Wait -PassThru -FilePath $installer -ArgumentList $vsArgs
    # Exit codes 0 = success, 3010 = success, reboot required
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
        throw "vs_buildtools exited with code $($proc.ExitCode)"
    }
    Remove-Item $installer -ErrorAction SilentlyContinue
    $vsPath = & $vsWhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsPath) { throw "VS Build Tools install finished but vswhere still reports nothing." }
    Write-Host "Installed at: $vsPath"
}

# --- 5. Rust (MSVC toolchain) --------------------------------------------
Section "Rust toolchain (MSVC)"
if (Has-Command rustc) {
    Write-Host "rustc already installed: $(rustc --version)"
    rustup update stable
} else {
    $rustup = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest `
        -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" `
        -OutFile $rustup
    & $rustup -y --default-toolchain stable --default-host x86_64-pc-windows-msvc
    Remove-Item $rustup -ErrorAction SilentlyContinue
    Refresh-Path
}

# rustup-init only touches the installing user's PATH. The GitHub Actions
# runner service runs under a different account (NetworkService or a named
# service user), so it won't see cargo unless .cargo\bin is on SYSTEM PATH.
Add-ToSystemPath "$env:USERPROFILE\.cargo\bin"
Refresh-Path

# --- 5b. wasm32 target (no linker needed) --------------------------------
Section "wasm32-unknown-unknown target"
$installedTargets = (& rustup target list --installed) -split "`n"
if ($installedTargets -contains "wasm32-unknown-unknown") {
    Write-Host "wasm32-unknown-unknown already installed."
} else {
    rustup target add wasm32-unknown-unknown
}

# --- 6. Enter VS Dev Shell + install Tauri CLI + wasm-pack ---------------
# Both cargo installs compile from source and need link.exe, so they share
# the same dev shell session. Skipping whichever is already present.
Section "Tauri CLI + wasm-pack (require MSVC linker on PATH)"
$needTauri    = -not (Has-Command cargo-tauri)
$needWasmPack = -not (Has-Command wasm-pack)
if ($needTauri -or $needWasmPack) {
    # link.exe is never on system PATH - load the dev env for this session.
    Import-Module "$vsPath\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
    Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation `
        -DevCmdArguments "-arch=x64 -host_arch=x64"
    if (-not (Has-Command link)) { throw "link.exe still not on PATH after Enter-VsDevShell" }
    if ($needTauri)    { cargo install tauri-cli --version "^2" }
    if ($needWasmPack) { cargo install wasm-pack --locked }
} else {
    Write-Host "tauri CLI and wasm-pack already installed."
}

# --- 7. GitHub Actions runner service ------------------------------------
# Rust is installed under C:\Users\Administrator\.cargo. NetworkService (the
# runner service default) cannot read Administrator's profile, so even with
# the correct PATH the service sees "cargo not found". Fix: change the
# service logon account to Administrator, which already owns the install.
#
# If the service already runs as Administrator, only restart it to pick up
# PATH changes. Requires the Administrator password (prompted interactively).
Section "GitHub Actions runner service"
$runners = Get-Service "actions.runner.*" -ErrorAction SilentlyContinue
if (-not $runners) {
    Write-Warning "No 'actions.runner.*' Windows service found."
    Write-Warning "Install the runner as a service first, then re-run this script."
} else {
    foreach ($svc in $runners) {
        $wmi = Get-WmiObject Win32_Service -Filter "Name='$($svc.Name)'"
        $currentUser = $wmi.StartName
        Write-Host "Service: $($svc.Name)"
        Write-Host "  currently runs as: $currentUser"

        $needsAccountChange = $currentUser -notmatch '(?i)(^|\\)Administrator$'

        if ($needsAccountChange) {
            Write-Warning "Runner service runs as $currentUser. That account cannot read"
            Write-Warning "C:\Users\Administrator\.cargo\bin, so cargo lookups fail in CI."
            Write-Warning "Switching logon to .\Administrator."

            $adminAccount = "$env:COMPUTERNAME\Administrator"
            $cred = Get-Credential -Message "Enter password for $adminAccount (used to run the runner service)" -UserName $adminAccount
            if (-not $cred) { throw "No credentials supplied; aborting." }
            Write-Host "  captured credential for: $($cred.UserName)"

            $plain = $cred.GetNetworkCredential().Password
            if ([string]::IsNullOrEmpty($plain)) {
                throw "Empty password received from Get-Credential prompt."
            }

            Grant-LogOnAsServiceRight -AccountName ".\Administrator"

            # Sanity: re-read policy and confirm the Administrator SID is now
            # listed under SeServiceLogonRight. Catches silent secedit failures.
            $adminSid = (New-Object System.Security.Principal.NTAccount("$env:COMPUTERNAME\Administrator")).Translate(
                [System.Security.Principal.SecurityIdentifier]).Value
            $verify = Join-Path $env:TEMP "verify-$(Get-Random).inf"
            & secedit /export /areas USER_RIGHTS /cfg $verify /quiet | Out-Null
            $verifyContent = Get-Content $verify -Raw -Encoding Unicode
            Remove-Item $verify -ErrorAction SilentlyContinue
            if ($verifyContent -notmatch [regex]::Escape("*$adminSid")) {
                throw "SeServiceLogonRight grant did not apply to $adminSid. Run 'secedit /export /areas USER_RIGHTS /cfg out.inf' to inspect."
            }
            Write-Host "  verified SeServiceLogonRight grant for $adminSid."

            Write-Host "  stopping service..."
            Stop-Service $svc.Name -Force

            # Use sc.exe rather than WMI Change() - clearer error codes.
            # sc.exe obj= / password= syntax requires the space after '='.
            Write-Host "  setting logon account to $($cred.UserName)..."
            $scOut = & sc.exe config $svc.Name obj= $cred.UserName password= $plain 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host ($scOut | Out-String)
                throw "sc.exe config failed with exit $LASTEXITCODE. Common causes: wrong password, account disabled, or SeServiceLogonRight not granted."
            }

            Write-Host "  starting service as $($cred.UserName)..."
            try {
                Start-Service $svc.Name -ErrorAction Stop
            } catch {
                throw "Service failed to start after logon change: $($_.Exception.Message). Check Event Viewer -> Windows Logs -> System for the exact cause (usually 7000 or 7038)."
            }

            $wmi2 = Get-WmiObject Win32_Service -Filter "Name='$($svc.Name)'"
            Write-Host "  now runs as: $($wmi2.StartName)"
        } else {
            Write-Host "  already running as Administrator; restarting to pick up PATH."
            Restart-Service $svc.Name -Force
        }
    }
    Start-Sleep -Seconds 2
    Get-Service "actions.runner.*" | Select-Object Name, Status | Format-Table | Out-String | Write-Host
}

# --- 8. Sanity check -----------------------------------------------------
Section "Versions"
Refresh-Path
function Try-Version($cmd, $arg = "--version") {
    if (Has-Command $cmd) {
        try { "{0,-10} {1}" -f $cmd, ((& $cmd $arg) 2>&1 | Select-Object -First 1) }
        catch { "{0,-10} (error: $_)" -f $cmd }
    } else {
        "{0,-10} NOT FOUND" -f $cmd
    }
}
Try-Version git
Try-Version node
Try-Version npm
Try-Version yarn
Try-Version rustc
Try-Version cargo
Try-Version wasm-pack
Try-Version jq
Try-Version pwsh
Try-Version java "-version"
Try-Version mvn
if (Has-Command native-image) { "native-image found at $((Get-Command native-image).Source)" } else { "native-image NOT FOUND (check GRAALVM_HOME\bin on PATH)" }
if (Has-Command link)     { "link.exe   found at $((Get-Command link).Source)" }      else { "link.exe   NOT FOUND (ensure dev shell is active OR use ilammy/msvc-dev-cmd in CI)" }
if (Has-Command makensis) { "makensis   found at $((Get-Command makensis).Source)" }  else { "makensis   NOT FOUND" }
$wasm32Installed = ((& rustup target list --installed) -split "`n") -contains 'wasm32-unknown-unknown'
if ($wasm32Installed) { "wasm32     installed" } else { "wasm32     NOT INSTALLED" }

Section "Next steps"
Write-Host @"
1. The runner service now runs as .\Administrator with PATH including
   cargo + wasm-pack. Trigger a build via workflow_dispatch on the
   Release artifacts workflow, or push a tag like v0.0.1-test.
2. Confirm the service identity from a fresh shell if needed:
     (Get-WmiObject Win32_Service -Filter "Name LIKE 'actions.runner%'").StartName
   Should print '.\Administrator'.
3. The release-artifacts workflow uses ilammy/msvc-dev-cmd@v1 to load MSVC
   env per run, so link.exe does NOT need to be on system PATH.
4. If you ever change the Administrator password, re-run this script so
   the service gets the new password (services keep cached credentials
   and will fail to start after a password change).
"@
