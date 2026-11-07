# Spellspeed for Android

An Android app that opens duelingbook.com with Spellspeed built in, as a full-screen landscape game.

## What it is

- **DuelingBook in a game window**: landscape, full screen, screen kept on. Back asks for a second press before
  leaving. Replays and decks opened from links replace the main page; a ⌂ button and Back lead to DuelingBook's main
  page.
- **Marked as a game** (`android:appCategory="game"`, `android:isGame="true"`), so game modes and launchers can list it.
- **Spellspeed inside**: the same files as the extension, from `extension/`, packed into the app and served from an
  address the app answers itself (`https://appassets.androidplatform.net/`); nothing is downloaded. `app-loader.js`
  does what the extension's loader and content scripts do.
- **Settings**: the ⚙ button opens Spellspeed's full settings page over the game. Settings are stored by the app.
- **No ads**: requests to ad and tracking hosts (`AD_HOSTS` in `MainActivity`) get an empty reply and their slots are
  hidden. DuelingBook's own servers, Cloudflare's replay check and reCAPTCHA are never blocked. The browser extension
  does not block ads.
- **DuelingBook links** open in the app (replays, decks, the front page), from any app or through *Share →
  Spellspeed*. From Android 12, select the duelingbook.com addresses under the app's *Open by default*; the app offers
  to open that screen once after its first start.
- **Reload**: ⚙ settings → *DuelingBook page* → **Reload DuelingBook**, for pages stuck on a timeout message.
- **Links to other sites** open in the phone's default browser. The app keeps its own DuelingBook login.

## Build

Needs the Android SDK (platform 35, build-tools 35.0.0) at `ANDROID_HOME` and a JDK. No Gradle.

```bash
SPELLSPEED_KEY_PASS=<your key password> bash scripts/build-android-app.sh
```

`SPELLSPEED_APP_DEBUG=1` builds a debuggable app whose WebView can be inspected over USB; use it for diagnosis only.

Output: `outputs/Spellspeed-<version>.apk` (version from `extension/manifest.json`). The first build creates the
signing key `~/.android/spellspeed-app.keystore`; keep it, because Android only installs an update signed with the
same key.

## Install

`adb install -r outputs/Spellspeed-<version>.apk`, or copy the APK to the phone and open it there.
