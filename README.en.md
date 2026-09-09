<div align="center">

<img src="./src-tauri/icons/128x128.png" width="96" height="96" alt="nnplayer icon" />

# nnplayer

A NetEase Cloud Music desktop player built with Tauri v2, Rust, Vue 3, and TypeScript.

[Download latest release](https://github.com/3274375092/nnplayer/releases/latest) · [Report an issue](https://github.com/3274375092/nnplayer/issues)

![Version](https://img.shields.io/badge/version-0.2.9-E85D3A?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-2563EB?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-16A34A?style=flat-square)

[简体中文](./README.md)

</div>

> [!IMPORTANT]
> nnplayer is an unofficial third-party client and is not affiliated with NetEase Cloud Music or its affiliates. It is intended for learning and personal use. Please comply with applicable laws and the NetEase Cloud Music terms of service.

## Features

- Daily recommendations, song search, suggestions, playlists, and playlist details
- QR-code, account/password, SMS verification, and advanced Cookie login
- Queue management, seeking, volume control, repeat, single-track repeat, and shuffle
- System media keys, tray menu, global shortcuts, and background tray operation
- LRC line lyrics, YRC word-level karaoke lyrics, translations, and audio-clock synchronization
- Resizable desktop lyrics window with always-on-top, dragging, locking, font-size, and opacity controls
- Cover-derived light themes with Gruvbox Light as the default
- Request deduplication, bounded caching, URL prefetching, list virtualization, and size-aware artwork loading
- Session isolation when switching accounts or logging out

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + Alt + P` | Play / pause |
| `Ctrl + Alt + ←` | Previous track |
| `Ctrl + Alt + →` | Next track |
| `Ctrl + Alt + L` | Show / hide desktop lyrics |

## Download and install

Releases provide Windows x86_64 packages and Linux x86_64 packages: Debian `.deb`, Fedora/RHEL `.rpm`, and AppImage.

- Windows: download and run the NSIS installer.
- Debian/Ubuntu: `sudo apt install ./nnplayer*.deb`
- Fedora/RHEL: `sudo dnf install ./nnplayer*.rpm`
- AppImage: `chmod +x nnplayer*.AppImage && ./nnplayer*.AppImage`

Linux requires GTK/WebKitGTK 4.1 and tray support. Package names may vary between distributions. GNOME Wayland users may need to enable the AppIndicator extension for the tray icon.

## Development

Requirements:

- Node.js 20 LTS
- Stable Rust
- Windows: WebView2 and Microsoft C++ Build Tools
- Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, and `patchelf`

```bash
git clone https://github.com/3274375092/nnplayer.git
cd nnplayer
npm ci
npm run tauri dev
```

Run the frontend only with:

```bash
npm run dev
```

Check and test:

```bash
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
```

Build packages:

```bash
npm run tauri build
```

Outputs are placed under `src-tauri/target/release/bundle/`, including `nsis`, `deb`, `rpm`, and `appimage` bundles.

## Architecture

```text
Vue 3 UI
  ├─ Pinia stores and composables
  └─ Tauri invoke/events
       ├─ Rust commands, sessions, tray, shortcuts, windows
       └─ ncm-api-rs (NetEase Cloud Music API client)
```

## Technology

- Tauri v2, Wry
- Vue 3, TypeScript, Pinia, Vue Router, Vite
- Tailwind CSS and Lucide
- Rust, Tokio, Serde, Reqwest, Rustls

## License

The main project is licensed under the [MIT License](./LICENSE). `ncm-api-rs` declares WTFPL in its Cargo manifest; follow the licenses of third-party components as applicable.
