# Direct connections for desktop and standalone server

2026-11-19. Checked reqwest 0.13.4, Tauri 2.11.2, tauri-plugin-updater
2.11.0, Wry 0.55.1 and webkit2gtk 2.0.2 (WebKitGTK API ≥2.32).

- API requests: disable proxies on the desktop shared client and the standalone
  server's upstream client. Reject explicit per-request proxies. The SDK can
  still be embedded with a caller-owned client; it cannot alter that client's
  connection policy. [Official reqwest docs](https://docs.rs/reqwest/0.13.4/reqwest/struct.ClientBuilder.html#method.no_proxy).
- Media and covers: these are loaded by the WebView rather than by the SDK.
  In the Windows process append Chromium's `--no-proxy-server` to the WebView2
  additional arguments before creating any windows, preserving Wry defaults.
  On Linux apply `NoProxy` to the WebKit website data manager for each WebView.
  [Official WebView2 docs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags),
  [official Chromium docs](https://www.chromium.org/developers/design-documents/network-settings/),
  [official WebKitGTK docs](https://webkitgtk.org/reference/webkit2gtk/stable/method.WebsiteDataManager.set_network_proxy_settings.html).
- Updater: the plugin JS check accepts a proxy address, not a no-proxy flag.
  Use the Rust builder instead: it copies `no_proxy` into the update resource
  used to download the signed package. Grant the frontend download/install,
  not the generic check command. [Upstream source](https://docs.rs/tauri-plugin-updater/2.11.0/src/tauri_plugin_updater/updater.rs.html).

Direct means no application-level proxy, not bypassing system routing, VPNs,
or transparent network infrastructure. An external browser is not part of this
policy. Revalidate on WebView or updater upgrades and on new target platforms.
One direct `song_url_v1` request with the saved session at `exhigh` still
returned business code `-460`; this does not establish the cause or frequency.
