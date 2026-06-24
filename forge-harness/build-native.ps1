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

$Javac = Join-Path $GraalHome 'bin\javac.exe'
$NativeImage = Join-Path $GraalHome 'bin\native-image.cmd'
$JarBin = Join-Path $GraalHome 'bin\jar.exe'

$Jar = Join-Path $HarnessDir 'target\forge-harness-jar-with-dependencies.jar'
$Src = Join-Path $HarnessDir 'native\forge\harness\ffi\ForgeNative.java'
$Classes = Join-Path $HarnessDir 'native\classes'
$Cfg = Join-Path $HarnessDir 'native\frozen-config'
$Out = Join-Path $HarnessDir 'native\build'
$Langs = Join-Path $RepoRoot 'forge\forge-gui\res\languages'
$Extra = Join-Path $HarnessDir 'native\extra-config'
$Gen = Join-Path $HarnessDir 'native\gen-config'

if (-not (Test-Path $NativeImage)) { throw "native-image not found at $NativeImage" }
if (-not (Test-Path $Jar)) { throw "fat jar missing — run: yarn build:harness" }

# $Cfg is a tracked snapshot of the non-forge reachability metadata (library/JDK
# reflection, resources, JNI, serialization) captured once with the tracing agent.
# The agent run is gone — gen-config below owns the entire forge.* closed world
# generatively, so nothing depends on a sample game anymore. To refresh the
# JDK/library slice after a dependency bump, re-run the agent by hand and diff it in.

Write-Host "==> compiling ForgeNative with GraalVM javac"
if (Test-Path $Classes) { Remove-Item -Recurse -Force $Classes }
New-Item -ItemType Directory -Force -Path $Classes | Out-Null
& $Javac -cp $Jar -d $Classes $Src

# A tracing run only captures the subset a single game touches, and a hand-listed
# set of packages will eventually forget a reflectively-instantiated family (it
# already silently dropped forge.ai.ability and forge.game.keyword). Instead
# register constructors for EVERY forge.* class in the jar — every top-level and
# nested class, no curated list — so every reflective factory (SpellApiToAi,
# TriggerType, ReplacementType, ApiType, Keyword, CostType) resolves, now and
# after any Forge bump. Nested classes ($) are deliberately kept: the goal is
# that nothing in the forge closed world can be missing.
#  - forge.* (minus forge.harness): instantiated reflectively by name → need
#    constructors.
#  - forge.harness.{protocol,host}: Gson DTOs (prompts/actions) serialized and
#    deserialized reflectively → need fields (the "type" discriminator is a field).
Write-Host "==> generating reflect-config for reflectively-accessed classes"
if (Test-Path $Gen) { Remove-Item -Recurse -Force $Gen }
New-Item -ItemType Directory -Force -Path $Gen | Out-Null

$entries = & $JarBin --list --file $Jar
$rxForge = '^forge/.*\.class$'
$rxHarness = '^forge/harness/(protocol|host)/[^/]+\.class$'
$forgeMeta = '"allDeclaredConstructors":true'
$harnessMeta = '"allDeclaredFields":true,"allDeclaredConstructors":true,"allDeclaredMethods":true'

$rows = [System.Collections.Generic.SortedSet[string]]::new()
foreach ($entry in $entries) {
    if ($entry -match $rxHarness) {
        $name = ($entry -replace '\.class$', '') -replace '/', '.'
        [void]$rows.Add("$name`t$harnessMeta")
    } elseif ($entry -match $rxForge -and $entry -notmatch '^forge/harness/(protocol|host)/') {
        $name = ($entry -replace '\.class$', '') -replace '/', '.'
        [void]$rows.Add("$name`t$forgeMeta")
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
