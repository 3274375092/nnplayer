# NNPlayer

NNPlayer is a desktop music player that coordinates playback and synchronized lyrics across a main window and a desktop lyrics window.

## Language

**Playback Position**:
The elapsed position within the active song as reported by authoritative media playback.
_Avoid_: UI time, lyric time

**Lyric Timeline**:
An ordered set of lyric lines and optional character-level timing windows for one song.
_Avoid_: Parsed lyrics, lyric data

**Lyric Frame**:
The renderable lyric state derived from a Lyric Timeline at a Playback Position, including the active line and within-line progress.
_Avoid_: Active lyric, lyric UI state

**Clock Anchor**:
A sampled association between a Playback Position and a sampling instant, used to continue playback time consistently across windows.
_Avoid_: Current-time packet, sync tick

**Timeline Snapshot**:
A complete Lyric Timeline associated with a song and a Lyric Session.
_Avoid_: Full packet, lyric payload

**Lyric Session**:
The lifetime of one authoritative lyric producer; observations from different Lyric Sessions are not comparable.
_Avoid_: Window session, sync session
