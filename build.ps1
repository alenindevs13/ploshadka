param([string]$SdkPath = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk' }))

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$tools = Join-Path $SdkPath 'build-tools\36.0.0'
$platform = Join-Path $SdkPath 'platforms\android-35\android.jar'
if (!(Test-Path -LiteralPath $platform)) { throw "Android Platform 35 not found at $platform" }
if (!(Test-Path -LiteralPath (Join-Path $tools 'aapt2.exe'))) { throw "Android Build Tools 36.0.0 not found at $tools" }

Push-Location $PSScriptRoot
try {
    $out = 'build'
    New-Item -ItemType Directory -Force "$out/assets","$out/classes","$out/dex" | Out-Null
    Copy-Item -LiteralPath web/index.html,web/app.js,web/photos.json,web/style.css,web/icon.svg,web/manifest.webmanifest,catalog/catalog.sqlite -Destination "$out/assets"
    & "$tools\aapt2.exe" compile --dir android/res -o "$out/resources.zip"
    & "$tools\aapt2.exe" link -I $platform --manifest android/AndroidManifest.xml -A "$out/assets" -o "$out/linked.apk" "$out/resources.zip"
    javac -encoding UTF-8 --release 8 -classpath $platform -d "$out/classes" android/MainActivity.java android/Catalog.java
    $classes = @(Get-ChildItem "$out/classes" -Recurse -Filter '*.class' | ForEach-Object FullName)
    & "$tools\d8.bat" --lib $platform --min-api 26 --output "$out/dex" @classes
    python -c "from zipfile import ZipFile, ZIP_DEFLATED; from pathlib import Path; p=Path('build'); z=ZipFile(p/'linked.apk','a',compression=ZIP_DEFLATED); z.write(p/'dex/classes.dex','classes.dex'); z.close()"
    & "$tools\zipalign.exe" -f 4 "$out/linked.apk" "$out/aligned.apk"
    $key = "$out/local-debug.jks"
    if (!(Test-Path -LiteralPath $key)) {
        keytool -genkeypair -keystore $key -storetype JKS -storepass android -keypass android -alias ploshchadka -dname 'CN=Ploshchadka Local Debug' -keyalg RSA -keysize 2048 -validity 10000
    }
    $apk = "$out/Ploshchadka-SPB-1.9-debug.apk"
    & "$tools\apksigner.bat" sign --ks $key --ks-key-alias ploshchadka --ks-pass pass:android --key-pass pass:android --out $apk "$out/aligned.apk"
    & "$tools\apksigner.bat" verify $apk
    Write-Output (Resolve-Path $apk)
} finally {
    Pop-Location
}

