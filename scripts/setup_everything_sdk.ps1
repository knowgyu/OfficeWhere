param(
  [string]$SdkUrl = 'https://www.voidtools.com/Everything-SDK.zip'
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TargetDir = Join-Path $RootDir 'resources\everything-sdk'
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('officewhere-everything-sdk-' + [System.Guid]::NewGuid().ToString('N'))
$ZipPath = Join-Path $TempDir 'Everything-SDK.zip'

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  Write-Host '[officewhere] Everything SDK 다운로드 중...'
  Invoke-WebRequest -Uri $SdkUrl -OutFile $ZipPath

  Write-Host '[officewhere] Everything SDK 압축 해제 중...'
  Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

  $Dlls = Get-ChildItem -Path $TempDir -Recurse -File -Include 'Everything64.dll','Everything32.dll'
  if (-not $Dlls) {
    throw 'Everything64.dll 또는 Everything32.dll을 SDK zip에서 찾지 못했습니다.'
  }

  foreach ($Dll in $Dlls) {
    Copy-Item -Path $Dll.FullName -Destination (Join-Path $TargetDir $Dll.Name) -Force
    Write-Host "[officewhere] 설치됨: resources\everything-sdk\$($Dll.Name)"
  }

  Write-Host ''
  Write-Host '[officewhere] 완료. 이제 Everything 앱을 켜고 dev-web.bat 또는 패키지 빌드를 실행하면 자동 감지됩니다.'
  Write-Host '[officewhere] 이 스크립트는 유지보수자가 공식 SDK DLL을 갱신할 때만 필요합니다.'
  Write-Host '[officewhere] 일반 사용자는 DLL 경로를 직접 입력할 필요가 없습니다.'
} finally {
  Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
