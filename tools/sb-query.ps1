# Runs a SQL query against the Job Scout Supabase project and prints the JSON result.
# Usage: powershell -File tools\sb-query.ps1 -Sql "select ..."
param([Parameter(Mandatory)][string]$Sql)
$ErrorActionPreference = 'Stop'
$token = (Get-Content "D:\Claude work\jreebs-app\.secrets\sb_access_token" -Raw).Trim()
$ref = (Get-Content (Join-Path $PSScriptRoot '..\.secrets\project_ref') -Raw).Trim()
$body = @{ query = $Sql } | ConvertTo-Json -Compress
$res = Invoke-WebRequest -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
  -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } `
  -Body ([Text.Encoding]::UTF8.GetBytes($body)) -UseBasicParsing
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# Decode the raw bytes as UTF-8; .Content guesses Latin-1 and garbles Arabic and punctuation.
$bytes = $res.RawContentStream.ToArray()
[Text.Encoding]::UTF8.GetString($bytes)
