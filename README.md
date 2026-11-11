# Spellspeed

**Play DuelingBook at Spell Speed 2.** Spellspeed is a free browser extension and Android app that makes
[DuelingBook](https://www.duelingbook.com/) faster and easier on the eyes: drag-and-drop plays, card fans, a replay
timeline you can rewind, themes and a smarter deck builder.

Website: [spellspeed.com](https://spellspeed.com) · X and Instagram: [@spellspeedapp](https://x.com/spellspeedapp) ·
Contact: contact@spellspeed.com

## What's here
- `extension/`: the browser extension (Chrome, Edge, Brave, Opera, Firefox), version 0.9.2 (the Chrome Web Store and Firefox Add-ons build).
  Its `README.md` lists the features.
- `android/`: the Android app, a WebView that carries the extension's files.
- `scripts/`: the build scripts for the store zips and the APK.
- `site/`: a redirect from this repo's old GitHub Pages address to spellspeed.com. The website itself lives in
  [KingMrock/spellspeed-site](https://github.com/KingMrock/spellspeed-site).

## Building

To load the Chrome extension without building: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/`. Reload DuelingBook.

Run commands from the repository root. With Windows PowerShell 5.1 or PowerShell 7 (including `Compress-Archive`):

```powershell
./scripts/build-extension.ps1
```

This packages `extension/` into `outputs/spellspeed-chrome.zip` and `outputs/spellspeed-firefox.zip` (the Firefox copy gets a Firefox manifest; both are unsigned). Staging directories are `outputs/spellspeed-chrome/` and `outputs/spellspeed-firefox/`.

The Android script targets Windows with Git Bash (Bash 4+, standard Unix utilities), Python 3 (`python` on PATH), a JDK (`JAVA_HOME`, for `javac` and `keytool`), and the Android SDK (`ANDROID_HOME`) with platform 35 and build-tools 35.0.0. It uses Windows SDK executables and batch files; no Gradle is needed.

```bash
bash scripts/build-android-app.sh
```

It embeds `extension/` and `android/` into `outputs/Spellspeed-<version>.apk`; intermediate files go in `work/android-build/`. `SPELLSPEED_APP_DEBUG=1` enables WebView debugging. Set `SPELLSPEED_KEY_PASS` to your signing key's password; the script creates `~/.android/spellspeed-app.keystore` with it on the first build and signs with it afterwards. An APK signed with your own key cannot update an APK signed with a different key. `adb` is optional for USB installation. Neither script downloads dependencies; install them separately.

## Licence
GPL-3.0-only, see [LICENSE](LICENSE). Spellspeed builds on GPL code from DuelingBook Overflow (C. Diserio) and
eyal282's Dueling Book Unlock. The Spellspeed name and logo identify this project; please don't use them for
modified versions.

Spellspeed is an independent project, not affiliated with or endorsed by DuelingBook or Konami.
Yu-Gi-Oh! is a trademark of Konami.
