# Hive - watchdog: religa o servidor sozinho quando ele cai
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File E:\Local\hive\hive-watchdog.ps1
# Instalar no logon (uma vez):
#   schtasks /Create /TN "HiveWatchdog" /SC ONLOGON /RL LIMITED /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File E:\Local\hive\hive-watchdog.ps1" /F
param(
  [int]$IntervalSec = 30,
  [int]$FailsBeforeRestart = 3
)

$ErrorActionPreference = "SilentlyContinue"
$logDir = Join-Path $env:LOCALAPPDATA "Temp\hive"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$watchLog = Join-Path $logDir "hive-watchdog.log"

function Write-Watch([string]$msg) {
  Add-Content -Path $watchLog -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg)
}

function Test-HiveHealth([int]$p) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/health" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200 -and $r.Content -match '"status"\s*:\s*"(ok|starting|degraded)"') { return $true }
  } catch { }
  return $false
}

function Test-AnyHive {
  foreach ($p in 3100..3104) { if (Test-HiveHealth $p) { return $true } }
  return $false
}

Write-Watch "watchdog iniciado (intervalo ${IntervalSec}s, $FailsBeforeRestart falhas para religar)"
$fails = 0

while ($true) {
  if (Test-AnyHive) {
    if ($fails -gt 0) { Write-Watch "servidor respondeu de novo; contador zerado" }
    $fails = 0
  } else {
    $fails++
    Write-Watch "health falhou ($fails/$FailsBeforeRestart)"
    if ($fails -ge $FailsBeforeRestart) {
      Write-Watch "religando via hive-start.ps1"
      $start = "E:\Local\hive\hive-start.ps1"
      & powershell -NoProfile -ExecutionPolicy Bypass -File $start 2>&1 |
        ForEach-Object { Write-Watch ("  " + $_) }
      $fails = 0
    }
  }
  Start-Sleep -Seconds $IntervalSec
}
