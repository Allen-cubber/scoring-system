$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /out:"$projectDirectory\评分服务启动器.exe" "$PSScriptRoot\ScoringLauncher.cs"
if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }
Write-Output "已生成：$projectDirectory\评分服务启动器.exe"
