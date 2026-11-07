/* DBETTER for Android, GPL-3.0-only. DuelingBook in a full-screen game window with DBETTER built in. */
package com.dbetter.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
  // DBETTER's files are served from this address; it never leaves the device.
  static final String ASSET_ORIGIN = "https://appassets.androidplatform.net";
  static final String HOME = "https://www.duelingbook.com/";
  private WebView game, settings;
  private FrameLayout root;
  private SharedPreferences prefs;
  private String loader;
  private long backAt;
  private boolean linksAsking;

  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    // Only debug builds (DBETTER_APP_DEBUG=1) can be inspected with WebView DevTools over USB.
    if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
    prefs = getSharedPreferences("dbetter", Context.MODE_PRIVATE);
    // The replay capture must hook DuelingBook's request before the replay loads: it runs with the loader as each
    // page starts (it does nothing outside replays, and only once per page).
    loader = readAsset("dbetter/rewind-observer.js") + "\n;" + readAsset("dbetter/app-loader.js");
    Window window = getWindow();
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (Build.VERSION.SDK_INT >= 28) window.getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    game = makeWebView();
    game.addJavascriptInterface(new Bridge(), "DBETTERApp");
    game.setWebViewClient(new GameClient());
    root.addView(game, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(game, true);
    String link = gameLink(getIntent());
    if (link != null) game.loadUrl(link); else if (state != null) game.restoreState(state); else game.loadUrl(HOME);
    immersive();
    // Once, a few seconds after the first start: offer to open DuelingBook links here.
    if (linksState().equals("off") && !prefs.getBoolean("linksAsked", false)) {
      new Handler().postDelayed(new Runnable() { public void run() { if (!isFinishing()) askLinks(); } }, 4000);
    }
  }

  /** DuelingBook links (user, 2026-10-28: they should open in DBETTER by default). They cannot be verified App Links
   *  (that needs a file on duelingbook.com), so from Android 12 they open in the browser until the user selects the
   *  duelingbook.com addresses under the app's Open by default; Android 8 to 11 offer the app in their chooser.
   *  "on", "off" or "chooser". */
  String linksState() {
    if (Build.VERSION.SDK_INT < 31) return "chooser";
    try {
      android.content.pm.verify.domain.DomainVerificationUserState user =
        getSystemService(android.content.pm.verify.domain.DomainVerificationManager.class).getDomainVerificationUserState(getPackageName());
      if (user == null || !user.isLinkHandlingAllowed()) return "off";
      for (Integer state : user.getHostToStateMap().values())
        if (state == android.content.pm.verify.domain.DomainVerificationUserState.DOMAIN_STATE_NONE) return "off";
      return "on";
    } catch (Exception e) { return "off"; }
  }

  void askLinks() {
    prefs.edit().putBoolean("linksAsked", true).apply();
    new android.app.AlertDialog.Builder(this).setTitle("Open DuelingBook links in Spellspeed?")
      .setMessage("Replay and deck links from Chrome, Discord or any other app can open straight in Spellspeed. Android needs your OK once: on the next screen, tap Add link and tick both duelingbook.com addresses.")
      .setPositiveButton("Allow", new android.content.DialogInterface.OnClickListener() {
        @Override public void onClick(android.content.DialogInterface dialog, int which) { openLinkSettings(); }
      })
      .setNegativeButton("Not now", null).show();
  }

  void openLinkSettings() {
    linksAsking = true;
    try { startActivity(new Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS, Uri.parse("package:" + getPackageName()))); }
    catch (Exception e) {
      try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private WebView makeWebView() {
    WebView view = new WebView(this);
    WebSettings s = view.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setSupportMultipleWindows(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    // Raster the whole visible page ahead of time, so parts of the board are never shown as
    // not-yet-drawn (black) areas while animations and card moves repaint it.
    s.setOffscreenPreRaster(true);
    view.setBackgroundColor(Color.BLACK);
    view.setWebChromeClient(new WebChromeClient());
    view.setOverScrollMode(View.OVER_SCROLL_NEVER);
    return view;
  }

  /** Serves the packaged DBETTER files, like an extension's own URLs. */
  WebResourceResponse asset(Uri url) {
    if (url == null || !ASSET_ORIGIN.equals(url.getScheme() + "://" + url.getHost())) return null;
    String path = url.getPath() == null ? "" : url.getPath().replaceFirst("^/", "");
    if (!path.startsWith("dbetter/") || path.contains("..")) return null;
    try {
      InputStream in = getAssets().open(path);
      WebResourceResponse response = new WebResourceResponse(mime(path), mime(path).startsWith("text/") || path.endsWith(".js") ? "utf-8" : null, in);
      Map<String, String> headers = new HashMap<>();
      // duelingbook.com loads these files; allow it like web_accessible_resources.
      headers.put("Access-Control-Allow-Origin", "*");
      headers.put("Cache-Control", "no-cache");
      response.setResponseHeaders(headers);
      return response;
    } catch (IOException e) { return null; }
  }

  /** DuelingBook's card art, kept on the device after the first view, so the deck constructor and duels
   *  show it at once even after the WebView's own (small) cache has dropped it. Public, unchanging images
   *  only (images.duelingbook.com, .jpg/.png/.webp); Android may clear the cache folder when space runs low. */
  WebResourceResponse cachedImage(WebResourceRequest request) {
    Uri url = request.getUrl();
    String path = url == null || url.getPath() == null ? "" : url.getPath();
    if (!"GET".equals(request.getMethod()) || !"https".equals(url.getScheme()) || !"images.duelingbook.com".equals(url.getHost())
        || url.getQuery() != null || !path.matches("/[A-Za-z0-9_/-]+\\.(jpg|png|webp)")) return null;
    File file = new File(new File(getCacheDir(), "images"), path.substring(1).replace('/', '_'));
    try {
      if (!file.isFile()) {
        HttpURLConnection connection = (HttpURLConnection) new URL(url.toString()).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(20000);
        if (connection.getResponseCode() != 200) { connection.disconnect(); return null; }
        file.getParentFile().mkdirs();
        File part = new File(file.getPath() + "." + Thread.currentThread().getId() + ".part");
        try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
          byte[] buffer = new byte[16384]; int n;
          while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        } finally { connection.disconnect(); }
        if (!part.renameTo(file)) { part.delete(); if (!file.isFile()) return null; }
      }
      String type = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
      WebResourceResponse response = new WebResourceResponse(type, null, new FileInputStream(file));
      Map<String, String> headers = new HashMap<>();
      headers.put("Access-Control-Allow-Origin", "*");
      headers.put("Cache-Control", "public, max-age=31536000");
      response.setResponseHeaders(headers);
      return response;
    } catch (IOException | RuntimeException e) { return null; }
  }

  static String mime(String path) {
    if (path.endsWith(".js")) return "text/javascript";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".wav")) return "audio/wav";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".json")) return "application/json";
    return "application/octet-stream";
  }

  String readAsset(String path) {
    try (InputStream in = getAssets().open(path)) {
      ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int n;
      while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
      return out.toString(StandardCharsets.UTF_8.name());
    } catch (IOException e) { return ""; }
  }

  String settingsJson() { return prefs.getString("settings", "{}"); }

  /** Sends changed settings to the duel page, as the extension's storage listener does. */
  void pushSettings() {
    String json = settingsJson();
    game.evaluateJavascript("window.__dbetterApp&&window.__dbetterApp.settings(" + json + ");", null);
  }

  private boolean isDuelingBook(Uri url) {
    String host = url == null ? null : url.getHost();
    return host != null && (host.equals("duelingbook.com") || host.endsWith(".duelingbook.com"));
  }

  /** Ads (user, 2026-10-28: they covered the board and made the app close to unusable). DuelingBook's pages load
   *  Ezoic, Google's ad network and header-bidding and tracking services; the app answers those requests itself
   *  with nothing. DuelingBook's own servers, Cloudflare's replay check and google.com (reCAPTCHA) are not on it. */
  static final String[] AD_HOSTS = {
    "ezoic.net", "ezoic.com", "ezojs.com", "ezodn.com", "ezoicanalytics.com", "ezoiccdn.com", "humix.com", "gatekeeperconsent.com",
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com", "googletagmanager.com",
    "google-analytics.com", "analytics.google.com", "adtrafficquality.google", "fundingchoicesmessages.google.com", "imasdk.googleapis.com",
    "amazon-adsystem.com", "rubiconproject.com", "pubmatic.com", "criteo.com", "criteo.net", "3lift.com", "media.net", "smartadserver.com",
    "onetag-sys.com", "teads.tv", "adsrvr.org", "a-mx.com", "ad.gt", "crwdcntrl.net", "quantserve.com", "quantcount.com", "id5-sync.com",
    "ccgateway.net", "ingage.tech", "bidsystem.ai", "analytics.yahoo.com", "adnxs.com", "openx.net", "sharethrough.com", "indexww.com",
    "casalemedia.com", "lijit.com", "sovrn.com", "yieldmo.com", "taboola.com", "outbrain.com", "primis.tech", "connatix.com", "aniview.com",
    "sonobi.com", "gumgum.com", "33across.com", "bidswitch.net", "rlcdn.com", "everesttech.net", "mathtag.com", "adsafeprotected.com",
    "moatads.com", "doubleverify.com", "scorecardresearch.com", "adform.net",
    // Loaded by DuelingBook's replay page (seen 2026-10-29).
    "powerad.ai", "vntsm.com"
  };
  static boolean isAd(Uri url) {
    String host = url == null ? null : url.getHost();
    if (host == null) return false;
    for (String ad : AD_HOSTS) if (host.equals(ad) || host.endsWith("." + ad)) return true;
    return false;
  }
  static WebResourceResponse nothing() {
    return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", new HashMap<String, String>(), new java.io.ByteArrayInputStream(new byte[0]));
  }

  class GameClient extends WebViewClient {
    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      if (isAd(request.getUrl())) return nothing();
      WebResourceResponse own = asset(request.getUrl());
      return own != null ? own : cachedImage(request);
    }
    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri url = request.getUrl();
      if (isDuelingBook(url) || ASSET_ORIGIN.equals(url.getScheme() + "://" + url.getHost())) return false;
      // Card databases, replays on other sites, social links: the phone's browser.
      try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception ignored) { }
      return true;
    }
    @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
      if (isDuelingBook(Uri.parse(url))) view.evaluateJavascript(loader + "\n;window.__dbetterAppStart&&window.__dbetterAppStart('early');", null);
    }
    @Override public void onPageFinished(WebView view, String url) {
      if (isDuelingBook(Uri.parse(url))) view.evaluateJavascript(loader + "\n;window.__dbetterAppStart&&window.__dbetterAppStart('ready');", null);
    }
  }

  /** The page side of chrome.storage.local and the settings window. */
  class Bridge {
    @JavascriptInterface public String getSettings() { return settingsJson(); }
    @JavascriptInterface public void setSettings(String json) {
      prefs.edit().putString("settings", json == null ? "{}" : json).apply();
      runOnUiThread(new Runnable() { public void run() { pushSettings(); } });
    }
    @JavascriptInterface public void openSettings() { runOnUiThread(new Runnable() { public void run() { showSettings(); } }); }
    @JavascriptInterface public void closeSettings() { runOnUiThread(new Runnable() { public void run() { hideSettings(); } }); }
    // A stuck page (user, 2026-10-29: "Timed out due to inactivity" and no way to reload in the app).
    @JavascriptInterface public void reload() { runOnUiThread(new Runnable() { public void run() { hideSettings(); game.reload(); } }); }
    @JavascriptInterface public String linksState() { return MainActivity.this.linksState(); }
    @JavascriptInterface public void openLinkSettings() { runOnUiThread(new Runnable() { public void run() { MainActivity.this.openLinkSettings(); } }); }
    @JavascriptInterface public String version() {
      try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }
  }

  @SuppressLint("AddJavascriptInterface")
  void showSettings() {
    if (settings == null) {
      settings = makeWebView();
      settings.setBackgroundColor(Color.parseColor("#111b18"));
      settings.addJavascriptInterface(new Bridge(), "DBETTERApp");
      settings.setWebViewClient(new WebViewClient() {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return asset(request.getUrl()); }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
          Uri url = request.getUrl();
          if (ASSET_ORIGIN.equals(url.getScheme() + "://" + url.getHost())) return false;
          try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception ignored) { }
          return true;
        }
      });
      root.addView(settings, new FrameLayout.LayoutParams(-1, -1));
    }
    settings.loadUrl(ASSET_ORIGIN + "/dbetter/app-settings.html");
    settings.setVisibility(View.VISIBLE);
  }

  void hideSettings() {
    if (settings != null) { settings.setVisibility(View.GONE); settings.loadUrl("about:blank"); }
    pushSettings();
    immersive();
  }

  @Override public void onBackPressed() {
    if (settings != null && settings.getVisibility() == View.VISIBLE) { hideSettings(); return; }
    // From a replay, a deck or any page but the main one, Back leads to DuelingBook's main page, as the ⌂ button does,
    // but never straight out of a duel (a Solo started from a deck page).
    String url = game.getUrl();
    if (url != null && url.matches("https://(?:www\\.)?duelingbook\\.com/[^?#].*")) {
      game.evaluateJavascript("!!(window.duel_active && window.duelist && !window.replay)", new android.webkit.ValueCallback<String>() {
        @Override public void onReceiveValue(String value) { if ("true".equals(value)) backTwice(); else game.loadUrl(HOME); }
      });
      return;
    }
    backTwice();
  }

  void backTwice() {
    long now = System.currentTimeMillis();
    if (now - backAt < 2000) { super.onBackPressed(); return; }
    backAt = now;
    Toast.makeText(this, "Press back again to leave DuelingBook", Toast.LENGTH_SHORT).show();
  }

  /** A DuelingBook link opened with or shared to DBETTER (user, 2026-10-28): a replay's address, another DuelingBook
   *  page (a deck, the front page ...), or null. */
  static String gameLink(Intent intent) {
    if (intent == null) return null;
    String text = null;
    if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) text = intent.getData().toString();
    else if (Intent.ACTION_SEND.equals(intent.getAction())) text = intent.getStringExtra(Intent.EXTRA_TEXT);
    if (text == null) return null;
    java.util.regex.Matcher match = java.util.regex.Pattern.compile("https?://(?:www\\.)?duelingbook\\.com/replay(?:\\.php)?/?\\?(?:[^\\s#]*&)?id=(\\d+(?:-\\d+)?)").matcher(text);
    if (match.find()) return HOME + "replay?id=" + match.group(1);
    match = java.util.regex.Pattern.compile("https://(?:www\\.)?duelingbook\\.com(?:[/?#][^\\s]*)?(?![\\w.:-])").matcher(text);
    return match.find() ? match.group() : null;
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    final String link = gameLink(intent);
    if (link == null) {
      if (Intent.ACTION_SEND.equals(intent.getAction())) Toast.makeText(this, "Not a DuelingBook link", Toast.LENGTH_SHORT).show();
      return;
    }
    if (settings != null && settings.getVisibility() == View.VISIBLE) hideSettings();
    // Never leave a duel in progress without asking.
    // (No lambdas: the build compiles against android.jar, which has no LambdaMetafactory.)
    game.evaluateJavascript("!!(window.duel_active && window.duelist && !window.replay)", new android.webkit.ValueCallback<String>() {
      @Override public void onReceiveValue(String value) {
        if (!"true".equals(value)) { game.loadUrl(link); return; }
        new android.app.AlertDialog.Builder(MainActivity.this).setTitle("Leave the duel?")
          .setMessage("You are in a duel. Opening the link leaves it.")
          .setPositiveButton("Open link", new android.content.DialogInterface.OnClickListener() {
            @Override public void onClick(android.content.DialogInterface dialog, int which) { game.loadUrl(link); }
          })
          .setNegativeButton("Stay", null).show();
      }
    });
  }

  @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) immersive(); }
  @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); game.saveState(out); }
  @Override protected void onPause() { super.onPause(); game.onPause(); CookieManager.getInstance().flush(); }
  @Override protected void onResume() {
    super.onResume(); game.onResume(); immersive();
    // Back from Open by default: say whether links now open here, and update the settings window.
    if (linksAsking) {
      linksAsking = false;
      Toast.makeText(this, linksState().equals("on") ? "DuelingBook links now open in Spellspeed" : "DuelingBook links still open in the browser. Spellspeed settings → DuelingBook links to change it.", Toast.LENGTH_LONG).show();
    }
    if (settings != null && settings.getVisibility() == View.VISIBLE) settings.evaluateJavascript("window.__dbetterLinks&&window.__dbetterLinks();", null);
  }

  /** Full screen: system bars hidden, a swipe from the edge shows them briefly. */
  @SuppressWarnings("deprecation")
  void immersive() {
    Window window = getWindow();
    // A swipe near an edge (dragging a hand card upwards, for example) shows the bars briefly.
    // Android normally lays a dark contrast scrim behind them, which looked like part of the
    // board flashing dark: keep the bars transparent and without that scrim.
    window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
    window.setStatusBarColor(Color.TRANSPARENT);
    window.setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= 29) { window.setStatusBarContrastEnforced(false); window.setNavigationBarContrastEnforced(false); }
    if (Build.VERSION.SDK_INT >= 30) {
      window.setDecorFitsSystemWindows(false);
      WindowInsetsController controller = window.getInsetsController();
      if (controller != null) {
        controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        // Hiding bars that are already hidden still starts an insets change; only hide when shown.
        WindowInsets insets = window.getDecorView().getRootWindowInsets();
        if (insets == null || insets.isVisible(WindowInsets.Type.systemBars())) controller.hide(WindowInsets.Type.systemBars());
      }
    } else {
      window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
  }
}
