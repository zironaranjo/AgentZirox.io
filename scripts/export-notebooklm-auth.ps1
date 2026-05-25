#Requires -Version 5.1
<#
.SYNOPSIS
  Muestra instrucciones para NOTEBOOKLM_AUTH_JSON (alternativa al volumen Docker).
#>
$ErrorActionPreference = "Stop"

$storage = Join-Path $env:USERPROFILE ".notebooklm\profiles\default\storage_state.json"
if (-not (Test-Path $storage)) {
    throw "Ejecuta primero: scripts/setup-notebooklm-auth.ps1"
}

$json = Get-Content -Raw -Encoding UTF8 $storage
$bytes = [System.Text.Encoding]::UTF8.GetByteCount($json)
$outFile = Join-Path $PSScriptRoot "notebooklm-auth-oneline.txt"

# Una linea para pegar en Dokploy (puede ser muy largo)
$oneLine = ($json -replace "`r`n", "" -replace "`n", "" -replace "\s{2,}", " ").Trim()
Set-Content -Path $outFile -Value $oneLine -Encoding UTF8 -NoNewline

Write-Host "Auth exportada ($bytes bytes)" -ForegroundColor Green
Write-Host "Archivo: $outFile"
Write-Host ""
Write-Host "En Dokploy anade:" -ForegroundColor Cyan
Write-Host "  NOTEBOOKLM_AUTH_JSON=<contenido del archivo>"
Write-Host ""
Write-Host "NOTA: Si Dokploy trunca JSON largo, usa volumen /opt/zirox/notebooklm -> /app/.notebooklm" -ForegroundColor Yellow
