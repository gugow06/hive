# Hive - start (detached) com logs e checagem de saude
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File E:\Local\hive\hive-start.ps1
param(
  [int]$Port = 3100,
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = "SilentlyContinue"
$root = "E:\Local\hive"
$node = "E:\Local\nvm\v24.22.0\node.exe"
$logDir = Join-Path $env:LOCALAPPDATA "Temp\hive"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "hive-out.log"
$errLog = Join-Path $logDir "hive-err.log"

function Test-HiveHealth([int]$p) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/health" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200 -and $r.Content -match '"status"\s*:\s*"(ok|starting|degraded)"') { return $true }
  } catch { }
  return $false
}

# 1. Ja esta no ar? nao duplica instancia (duas instancias disputam porta e cluster)
foreach ($p in @($Port, $Port + 1, $Port + 2)) {
  if (Test-HiveHealth $p) {
    Write-Host "Hive ja esta no ar em http://127.0.0.1:$p - nada a fazer."
    exit 0
  }
}

# 2. Limpa instancias mortas: node do Hive e postgres embutido orfao
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*cli/src/index.ts*" } |
  ForEach-Object { Write-Host "encerrando node orfao $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2
Get-Process postgres | Where-Object { $_.Path -like "*embedded-postgres*" } | ForEach-Object {
  Write-Host "encerrando postgres orfao $($_.Id)"; Stop-Process -Id $_.Id -Force
}
Start-Sleep -Seconds 2
Remove-Item "C:\Users\cpsep\.paperclip\instances\default\db\postmaster.pid" -Force

# 3. Sobe destacado (sobrevive ao fechamento do terminal) com heap maior:
#    as queries de reconciliacao de chat ja derrubaram o processo com o heap default.
$env:NODE_OPTIONS = "--max-old-space-size=6144"
Add-Content -Path $outLog -Value "`n===== start $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====="
$proc = Start-Process -FilePath $node `
  -ArgumentList "cli/node_modules/tsx/dist/cli.mjs","cli/src/index.ts","run" `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
  -PassThru
Write-Host "processo iniciado: pid $($proc.Id)"

# 4. Espera ficar saudavel e informa a porta real (detectPort pula porta ocupada)
for ($i = 0; $i -lt [math]::Ceiling($TimeoutSec / 5); $i++) {
  Start-Sleep -Seconds 5
  foreach ($p in @($Port, $Port + 1, $Port + 2)) {
    if (Test-HiveHealth $p) {
      Write-Host "Hive OK em http://127.0.0.1:$p"
      exit 0
    }
  }
  if ($proc.HasExited) {
    Write-Host "ERRO: processo saiu (exit $($proc.ExitCode)). Veja $errLog"
    exit 1
  }
}
Write-Host "ERRO: nao ficou saudavel em ${TimeoutSec}s. Veja $outLog"
exit 1
