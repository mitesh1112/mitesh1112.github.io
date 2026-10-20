# Copy the complete, dependency-free function into the clipboard for Dashboard deployment.
# No credentials or generated files are involved.
$handlerPath = Join-Path $PSScriptRoot 'handler.mjs'
$entryPath = Join-Path $PSScriptRoot 'index.ts'
$handlerSource = (Get-Content -LiteralPath $handlerPath -Raw).Replace('export function ', 'function ')
$entrySource = (Get-Content -LiteralPath $entryPath -Raw) -replace "(?m)^import .*\r?\n", ''
Set-Clipboard -Value ($handlerSource + "`n" + $entrySource)
Write-Output 'Function source copied. Paste it into the Supabase log-expense function editor.'
