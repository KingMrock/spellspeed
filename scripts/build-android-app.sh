#!/usr/bin/env bash
# Builds the Spellspeed Android app (android) with the plain Android SDK tools: no Gradle.
# Packs the current Spellspeed files from extension as app assets.
# Output: outputs/Spellspeed-<version>.apk, signed with a local key kept in ~/.android.
# SPELLSPEED_APP_DEBUG=1 builds a debuggable app (WebView DevTools over USB) for diagnosis only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
BT="$SDK/build-tools/35.0.0"; JAR="$SDK/platforms/android-35/android.jar"
APP="$ROOT/android"; EXT="$ROOT/extension"; WORK="$ROOT/work/android-build"
export JAVA_HOME="${JAVA_HOME:?Set JAVA_HOME to your JDK directory}"
VERSION=$(sed -n 's/.*"version": "\([0-9.]*\)".*/\1/p' "$EXT/manifest.json")
IFS=. read -r MAJ MIN PAT <<< "$VERSION"; CODE=$((MAJ * 10000 + MIN * 100 + PAT))

rm -rf "$WORK"; mkdir -p "$WORK/assets/dbetter" "$WORK/res/mipmap" "$WORK/classes" "$WORK/dex" "$WORK/gen"
# Spellspeed itself, exactly as the extension ships it.
cp "$EXT"/{rules,workbench,constructor,sounds,content,touch,tour,popup,rewind,rewind-ui,rewind-observer}.js "$EXT"/{night,popup}.css "$EXT"/sfx-*.wav "$EXT"/icon128.png "$WORK/assets/dbetter/"
cp "$APP/app-loader.js" "$WORK/assets/dbetter/"
cp "$EXT/LICENSE" "$EXT/NOTICE.txt" "$WORK/assets/dbetter/" 2>/dev/null || true
# Settings window: the extension's full settings page with chrome.storage provided by the app.
python - "$EXT/options.html" "$WORK/assets/dbetter/app-settings.html" <<'PY'
import sys
page = open(sys.argv[1], encoding='utf-8').read()
shim = """<script>
// Spellspeed for Android: chrome.storage and runtime for the settings page, backed by the app.
(() => {
  const app = window.DBETTERApp, listeners = [];
  const read = () => { try { return JSON.parse(app.getSettings() || '{}') || {}; } catch { return {}; } };
  window.browser = {
    runtime: { getManifest: () => ({ version: app.version() }), openOptionsPage() {} },
    storage: {
      local: {
        get: async () => ({ settings: read() }),
        set: async value => { const old = read(); app.setSettings(JSON.stringify(value.settings || {})); listeners.forEach(fn => fn({ settings: { oldValue: old, newValue: value.settings } }, 'local')); }
      },
      onChanged: { addListener: fn => listeners.push(fn) }
    }
  };
})();
</script>"""
back = '<button id="dbetter-app-back" type="button" onclick="DBETTERApp.closeSettings()">← Back to the game</button>'
# DuelingBook links: whether Android opens them in the app (MainActivity.linksState), and its Open by default screen.
links = """<section id="dbetter-app-page"><h2>DuelingBook page</h2><p class="note">Stuck on a message such as “Timed out due to inactivity”? Reload the page.</p><div class="actions"><button id="dbetter-app-reload" type="button" onclick="DBETTERApp.reload()">Reload DuelingBook</button></div></section>
<section id="dbetter-app-links"><h2>DuelingBook links</h2><p class="note" id="dbetter-links-state"></p><div class="actions"><button id="dbetter-links-setup" type="button" onclick="DBETTERApp.openLinkSettings()">Open by default…</button></div></section>
<script>
window.__dbetterLinks = () => {
  const state = DBETTERApp.linksState(), note = document.getElementById('dbetter-links-state');
  note.textContent = state === 'on' ? 'Replay, deck and other DuelingBook links you tap in Chrome or another app open in Spellspeed. An app that shows links in its own built-in browser (× at the top left) keeps them there: tap its share button, then Spellspeed.'
    : state === 'chooser' ? 'Android offers Spellspeed when you open a DuelingBook link: choose Spellspeed, then Always.'
    : 'DuelingBook links open in the browser. To open them in Spellspeed: Open by default…, then Add link and tick both duelingbook.com addresses.';
  document.getElementById('dbetter-links-setup').hidden = state === 'chooser';
};
window.__dbetterLinks();
</script>"""
style = '<style>#dbetter-app-back{position:sticky;top:0;z-index:2;width:100%;margin:0 0 12px;padding:12px;font-size:16px;font-weight:600}#export,label.file-button,#import{display:none!important}</style>'
page = page.replace('<script src="rules.js">', shim + '<script src="rules.js">', 1)
page = page.replace('<main>', '<main>' + back, 1).replace('</main>', links + '</main>', 1).replace('</head>', style + '</head>', 1)
assert 'DBETTERApp.closeSettings' in page and 'window.browser' in page and 'DBETTERApp.linksState' in page
open(sys.argv[2], 'w', encoding='utf-8').write(page)
PY
# Launcher icon: adaptive (mark on the brand tile), with the tile image for older launchers. See android/res.
cp -r "$APP/res/." "$WORK/res/"

"$BT/aapt2.exe" compile --dir "$WORK/res" -o "$WORK/res.zip"
"$BT/aapt2.exe" link -o "$WORK/unaligned.apk" -I "$JAR" --manifest "$APP/AndroidManifest.xml" -R "$WORK/res.zip" -A "$WORK/assets" \
  --java "$WORK/gen" --min-sdk-version 26 --target-sdk-version 35 --version-code "$CODE" --version-name "$VERSION" --auto-add-overlay \
  $([ "${SPELLSPEED_APP_DEBUG:-}" = 1 ] && echo --debug-mode)
# The project path contains a space: pass file lists through arrays, never word splitting.
mapfile -t SOURCES < <(find "$APP/src" "$WORK/gen" -name '*.java')
"$JAVA_HOME/bin/javac" -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -d "$WORK/classes" "${SOURCES[@]}"
# d8.bat goes through cmd.exe, which mangles quoted paths with spaces: run it on relative paths.
mapfile -t CLASSES < <(cd "$WORK/classes" && find . -name '*.class')
(cd "$WORK/classes" && "$BT/d8.bat" --release --lib "$JAR" --min-api 26 --output ../dex "${CLASSES[@]}")
python - "$WORK/unaligned.apk" "$WORK/dex/classes.dex" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'a', zipfile.ZIP_DEFLATED) as apk: apk.write(sys.argv[2], 'classes.dex')
PY
"$BT/zipalign.exe" -f -p 4 "$WORK/unaligned.apk" "$WORK/aligned.apk"
KEY="$HOME/.android/spellspeed-app.keystore"
# The signing key's password comes from the environment, never from this file.
export KEY_PASS="${SPELLSPEED_KEY_PASS:?Set SPELLSPEED_KEY_PASS to your signing key password}"
if [ ! -f "$KEY" ]; then
  mkdir -p "$(dirname "$KEY")"
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KEY" -alias spellspeed -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KEY_PASS" -keypass "$KEY_PASS" -dname "CN=Spellspeed local build" >/dev/null
fi
mkdir -p "$ROOT/outputs"
OUT="$ROOT/outputs/Spellspeed-$VERSION.apk"
"$BT/apksigner.bat" sign --ks "$KEY" --ks-key-alias spellspeed --ks-pass env:KEY_PASS --key-pass env:KEY_PASS --out "$OUT" "$WORK/aligned.apk"
"$BT/apksigner.bat" verify "$OUT"
echo "Built $OUT ($(du -k "$OUT" | cut -f1) KB, versionCode $CODE)"
