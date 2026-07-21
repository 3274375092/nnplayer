---
status: accepted
---

# Project lyric frames from the authoritative playback position

NNPlayer derives main-window and desktop-window Lyric Frames with the same deterministic projection of a Lyric Timeline onto the authoritative Playback Position. Cross-window synchronization sends Timeline Snapshots only when song or timeline identity changes and low-frequency Clock Anchors during playback; it never sends per-frame active-line or token progress, and a mismatched session or song suppresses stale lyrics until a matching snapshot arrives. This trades brief synchronization placeholders and local projection work for consistent timing, lower serialization, and fault isolation; desktop transport failures cannot change main-window update demand, theme delivery stays outside lyric timing, and timing correction cannot use hidden fixed offsets.
