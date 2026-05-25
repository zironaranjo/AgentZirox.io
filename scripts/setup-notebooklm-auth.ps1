#Requires -Version 5.1
<#
.SYNOPSIS
  Instala notebooklm-py, hace login Google y prepara auth para el VPS.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/setup-notebooklm-auth.ps1
#>
$ErrorActionPreference = "Stop"

Write-Host "=== NotebookLM - setup auth (PC local) ===" -ForegroundColor Cyan

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $python) {
    throw "Python no encontrado. Instala Python 3.10+ desde python.org"
}

Write-Host "Python: $($python.Source)"
& $python.Source -m pip install --upgrade pip | Out-Null
& $python.Source -m pip install "notebooklm-py[browser]"

Write-Host ""
Write-Host "Se abrira el navegador para login Google (cuenta con acceso a NotebookLM)." -ForegroundColor Yellow
Write-Host "Tras login, pulsa Enter en la terminal del CLI si lo pide."
Write-Host ""

& $python.Source -m notebooklm login

$storage = Join-Path $env:USERPROFILE ".notebooklm\profiles\default\storage_state.json"
if (-not (Test-Path $storage)) {
    throw "No se encontro storage_state.json en $storage"
}

Write-Host ""
Write-Host "OK - Auth guardada en:" -ForegroundColor Green
Write-Host "  $storage"
Write-Host ""
Write-Host "Paso 1 completado. Avisa al agente: listo paso 1" -ForegroundColor Green
Write-Host ""
