# 网易云风控（-460 / 503）与设备会话标识

Research date: 2026-11-14. Versions checked: local `ncm-api-rs` 0.1.0,
`yms-netease-music-api` 4.28.0, upstream `imsyy/ncm-api-rs` source at
`main`, and the current enhanced API repository metadata.

## Verified conclusions

1. **The local eapi request path was dropping `NMTID`.** `ncm-api-rs` first
   constructed a general Cookie header, then the eapi branch replaced it with
   a Cookie built only from `header_map`. The old `header_map` omitted
   `NMTID`, so a value supplied by the stored session cookie could not reach
   `/song/url/v1`.

2. **A maintained API implementation explicitly reuses `NMTID`.** The
   published `yms-netease-music-api@4.28.0` source documents and implements a
   four-step behavior: Cookie input, then a server-issued in-process cache,
   then up to three eapi probe requests without `NMTID` so the server can issue
   one, then a generated fallback. Its eapi request includes `NMTID` in the
   header Cookie once available. This supports the same sequence in nnplayer.

3. **The server-issued value should be preferred.** The package captures
   `NMTID` from `Set-Cookie`, caches it, and reuses it on later requests. This
   supports merging successful business-response cookies back into nnplayer's
   in-memory session and preferring that value over a generated fallback.

4. **The 5 s / 20 s / 60 s playback retry ladder is a product decision.**
   No official NetEase document was found that publishes these intervals.
   The ladder limits repeated URL requests while keeping the user on the same
   song; it is not presented as a documented upstream requirement.

## Decisions and impact

- `ncm-api-rs/src/request.rs` keeps the eapi header-Cookie shape used by the
  maintained implementation. A missing `NMTID` is omitted for at most three
  eapi probes so a server-issued value can be captured, then falls back to a
  stable device-derived value. `Set-Cookie: NMTID=...` is cached even when the
  request errors.
- `src-tauri/src/commands/auth.rs` and `music.rs` merge server `Set-Cookie`
  values into the active session. Login/account validation cookies are included
  before persistence; song URL responses can refresh the in-memory identity.
- `src/playback/playbackEngine.ts`, `src/utils/appErrors.ts`, `PRODUCT.md`, and
  `DESIGN.md` implement and describe the product-level staged retry behavior.

## Sources

- **official docs:** docs.rs, `ncm_api_rs::NcmError` 0.1.0. Documents
  `RateLimited(String)` as API 503 / high-frequency IP risk control:
  https://docs.rs/ncm-api-rs/latest/ncm_api_rs/error/enum.NcmError.html

- **upstream source:** `imsyy/ncm-api-rs`, `src/request.rs` on `main`, fetched
  2026-11-14. Confirms the per-request fallback and the eapi header-Cookie
  replacement behavior inspected locally:
  https://raw.githubusercontent.com/imsyy/ncm-api-rs/main/src/request.rs

- **published package source:** `yms-netease-music-api@4.28.0`, npm tarball
  fetched and inspected 2026-11-14. `README.MD` describes the NMTID
  preference order; `util/request.js` implements server-cookie capture and
  eapi reuse:
  https://www.npmjs.com/package/yms-netease-music-api

- **upstream repository metadata:** current enhanced API repository page,
  fetched through the GitHub API on 2026-11-14:
  https://github.com/NeteaseCloudMusicApiEnhanced/NeteaseCloudMusicApi

## Unconfirmed / limitations

- No official NetEase documentation confirms that a stable fallback value
  reduces `-460` frequency. The package-level NMTID behavior is evidence for a
  compatible mitigation, not a guarantee.
- The real effect can only be measured with a live account and network. The
  browser mock and unit tests cannot produce an upstream risk-control response.
- `yms-netease-music-api@4.28.0` currently routes `/song/url/v1` through its
  newer `xeapi` protocol. nnplayer still uses this repository's eapi client.
  If the backend moves or requires `xeapi` / `X-antiCheatToken`, this mitigation
  will be insufficient and a protocol migration will be required.
- The process-level `deviceId`, and therefore the generated fallback, is not
  currently persisted across application restarts. Persisting it requires a
  deliberate session/store migration.
