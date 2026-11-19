# SPlayer ncm-api-rs upstream sync

Research date: 2026-11-19. Versions checked: SPlayer `ncm-api-rs` 0.1.0
(`133b65b`), nnplayer `v0.5.6` (`6b7cf77`), and `tower-http` 0.6.11.

## Decision and impact

- The upstream default branch and `v0.1.0` tag resolve to `133b65b`, also recorded
  in the crates.io tarball's `.cargo_vcs_info.json`. The closest source snapshot
  to nnplayer's original vendored import is `bf408ee` (374 of 385 file blobs
  match). Port the SDK changes between those revisions rather than swapping the
  path dependency for the registry crate: the registry version uses reqwest 0.12
  and a different `ApiClient` constructor, and does not have nnplayer's NMTID
  handling or `RiskControl` variant.
- Sync the new API modules and the updated voice-list search. Adapt upstream
  multi-origin CORS to retain fail-closed behavior for malformed origin lists.
  With credentials enabled, mirror the preflight request headers instead of
  sending a wildcard, which `tower-http` rejects. Keep the local crate name,
  reqwest 0.13, release configuration, and playback transport unchanged.
- Upstream documents `real_ip` as forwarding headers, not as a change to the
  connection's actual egress. It was already supported by the local SDK; the
  sync does not supply a default address, enable IP rotation, or retry login.

- Preserve the local boolean convention (`0` means false), the previous
  `podcastName` input (prefer `keyword` when supplied), and first-page offset
  `0`. For credentialed CORS compare the trimmed input to the URL origin’s
  ASCII serialization, not just its validity as an HTTP header value.

## Sources

- **official docs:** [url 2.5.8 Origin](https://docs.rs/url/2.5.8/url/enum.Origin.html),
  checked against the locked `ascii_serialization()` implementation.
- **official registry:** [crates.io package and version](https://crates.io/crates/ncm-api-rs/0.1.0),
  cross-checked with `cargo info` and the downloaded manifest.
- **upstream source:** [SPlayer repository](https://github.com/SPlayer-Dev/ncm-api-rs),
  checked via `git ls-remote` and the cloned source at `133b65b`, including its
  README and the diff from `bf408ee`.
- **official docs:** [tower-http AllowHeaders](https://docs.rs/tower-http/latest/tower_http/cors/struct.AllowHeaders.html),
  cross-checked against the locked 0.6.11 implementation.

## Limitations

Upstream did not change `song_url_v1` or its request transport in this range.
This sync is not evidence that NetEase now accepts the desktop player's playback
requests. Revisit the dependency decision if upstream changes that transport or
provides the APIs needed to preserve nnplayer's session handling.
