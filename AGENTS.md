# Development rules

Read README.md and docs/development.md before editing. Native favorites must always read
getStarred2.song and write star/unstar. Display names are labels only; do not map them to
family playlists, embed private IDs, or restore the former bedtime-playlist implementation.
Preserve per-account cache isolation and current playback during favorite changes.
Use node --test tests/*.test.cjs with mocked services; do not call private speaker controls.
