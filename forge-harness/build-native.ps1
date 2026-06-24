#!/usr/bin/env pwsh
# Windows port of build-native.sh: builds forgeharness.dll + forgeharness.lib
# from the forge-harness fat jar + the ForgeNative @CEntryPoint layer, using
# GraalVM native-image. native-image cannot cross-compile, so this must run on
# Windows inside an MSVC dev shell (vcvars / "x64 Native Tools" prompt — CI uses
# ilammy/msvc-dev-cmd). Keep in sync with build-native.sh.

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$HarnessDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $HarnessDir

if (-not $env:GRAALVM_HOME) {
    throw "GRAALVM_HOME is not set. Point it at a GraalVM for JDK 21 install (the dir containing bin\native-image.cmd)."
}
$GraalHome = $env:GRAALVM_HOME

$Java = Join-Path $GraalHome 'bin\java.exe'
$Javac = Join-Path $GraalHome 'bin\javac.exe'
$NativeImage = Join-Path $GraalHome 'bin\native-image.cmd'
$JarBin = Join-Path $GraalHome 'bin\jar.exe'

$Jar = Join-Path $HarnessDir 'target\forge-harness-jar-with-dependencies.jar'
$Src = Join-Path $HarnessDir 'native\forge\harness\ffi\ForgeNative.java'
$Classes = Join-Path $HarnessDir 'native\classes'
$Cfg = Join-Path $HarnessDir 'native\native-image-config'
$Out = Join-Path $HarnessDir 'native\build'
$Langs = Join-Path $RepoRoot 'forge\forge-gui\res\languages'
$Extra = Join-Path $HarnessDir 'native\extra-config'
$Gen = Join-Path $HarnessDir 'native\gen-config'

if (-not (Test-Path $NativeImage)) { throw "native-image not found at $NativeImage" }
if (-not (Test-Path $Jar)) { throw "fat jar missing — run: yarn build:harness" }

# Capture native-image reachability metadata (reflect/resource/jni/serialization)
# by running a sample game under the tracing agent. Cached after the first run;
# delete native/native-image-config to force a fresh capture (e.g. after a Forge
# bump). gen-config (below) covers the by-name class families comprehensively;
# this captures everything else the agent observes.
if (-not (Test-Path $Cfg)) {
    Write-Host "==> capturing native-image metadata via tracing agent (sample game)"
    New-Item -ItemType Directory -Force -Path $Cfg | Out-Null
    Push-Location $RepoRoot
    try {
        & $Java "-agentlib:native-image-agent=config-output-dir=$Cfg" `
            "-Djava.awt.headless=true" `
            -jar $Jar --deck1 red_burn --deck2 green_stompy --seed 42 --max-turns 8 `
            *> $null
    } finally {
        Pop-Location
    }
}

Write-Host "==> compiling ForgeNative with GraalVM javac"
if (Test-Path $Classes) { Remove-Item -Recurse -Force $Classes }
New-Item -ItemType Directory -Force -Path $Classes | Out-Null
& $Javac -cp $Jar -d $Classes $Src

# A tracing run only captures the subset a single game touches. Register the
# whole closed sets from the jar so any card / any prompt works:
#  - forge.game.{trigger,replacement,...}: instantiated reflectively by name
#    (TriggerType/ReplacementType/ApiType/CostType) → need constructors.
#  - forge.harness.{protocol,host}: Gson DTOs (prompts/actions) serialized and
#    deserialized reflectively → need fields (the "type" discriminator is a field).
Write-Host "==> generating reflect-config for reflectively-accessed classes"
if (Test-Path $Gen) { Remove-Item -Recurse -Force $Gen }
New-Item -ItemType Directory -Force -Path $Gen | Out-Null

$entries = & $JarBin --list --file $Jar
$rxGame = '^forge/game/(trigger|replacement|ability/effects|ability/ai|staticability|cost)/[^/]*\.class$'
$rxHarness = '^forge/harness/(protocol|host)/[^/]*\.class$'
$gameMeta = '"allDeclaredConstructors":true'
$harnessMeta = '"allDeclaredFields":true,"allDeclaredConstructors":true,"allDeclaredMethods":true'

$rows = [System.Collections.Generic.SortedSet[string]]::new()
foreach ($entry in $entries) {
    if ($entry -match '\$') { continue }
    if ($entry -match $rxGame) {
        $name = ($entry -replace '\.class$', '') -replace '/', '.'
        [void]$rows.Add("$name`t$gameMeta")
    } elseif ($entry -match $rxHarness) {
        $name = ($entry -replace '\.class$', '') -replace '/', '.'
        [void]$rows.Add("$name`t$harnessMeta")
    }
}

$json = [System.Text.StringBuilder]::new()
[void]$json.AppendLine('[')
$first = $true
foreach ($row in $rows) {
    $parts = $row -split "`t", 2
    if (-not $first) { [void]$json.AppendLine(',') }
    [void]$json.Append("  {""name"":""$($parts[0])"",$($parts[1])}")
    $first = $false
}
[void]$json.AppendLine()
[void]$json.AppendLine(']')
$reflectConfig = Join-Path $Gen 'reflect-config.json'
[System.IO.File]::WriteAllText($reflectConfig, $json.ToString())
Write-Host "    registered $($rows.Count) classes for reflection"

Write-Host "==> native-image --shared → forgeharness"
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Push-Location $Out
try {
    $cp = @($Jar, $Classes, $Langs) -join ';'
    $configArg = @()
    if (Test-Path $Cfg) {
        $configArg = @("-H:ConfigurationFileDirectories=$Cfg,$Extra,$Gen")
    }
    & $NativeImage `
        --shared `
        -H:Name=forgeharness `
        -cp $cp `
        -H:IncludeResourceBundles=en-US `
        --no-fallback `
        --report-unsupported-elements-at-runtime `
        -H:+ReportExceptionStackTraces `
        --initialize-at-run-time=org.tinylog,org.slf4j,io.netty,forge,org.apache.commons.lang3 `
        "-Djava.awt.headless=true" `
        @configArg `
        @args
} finally {
    Pop-Location
}

# Rust links `-l forgeharness` against the import library forgeharness.lib;
# the loader resolves forgeharness.dll at runtime (must sit next to the exe —
# no rpath on Windows). native-image emits both with the -H:Name base, so no
# rename is needed (unlike the lib-prefixed Unix outputs).
Write-Host "==> built:"
Get-ChildItem $Out
