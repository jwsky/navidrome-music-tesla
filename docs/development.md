# Favorite semantics and deployment differences

Since 2026-10-10, Favorite means the signed-in Navidrome user's **track star flag**.
Reads use `getStarred2.song`; writes use `star` / `unstar` followed by `getSong` confirmation.
An entry labelled “Bedtime favorites” uses exactly the same collection as “Favorites”.

| Behavior | Public single-file client | Private family deployment |
| --- | --- | --- |
| Favorite source | Native per-user starred songs | Same native per-user source |
| Display label | `favoriteName`, default 最爱 | 最爱 |
| Credentials | User's browser settings | Private service configuration |
| Cache identity | Server + username; label-independent | Same scope, optional authenticated initial snapshot |
| Original-file deletion | Unsupported | Separate private service with explicit confirmation |
| Extra music sources | Optional user-configured plugins | Private search backend |

Do not implement favorites by editing a named playlist or choose a playlist from the display
label. Album/artist stars must not expand into track favorites. Each user has one native
starred-song collection; separate collections require ordinary playlists or separate accounts.

Old `bedName` settings and named-playlist snapshots are not native favorites. Use the
`navidrome-tesla.favorites.v1` cache namespace. Legacy `bedtime` function/DOM/tag names are
internal compatibility names. Migrations add selected tracks' stars and preserve existing
stars and original playlists. No private credentials, playlist IDs, song snapshots or server
addresses belong in this repository.

Run `node --test tests/*.test.cjs` after changes. Keep cancellation independent of files and
playback, reject stale account responses, and prevent an old refresh from undoing a mutation.
See [Navidrome's native favorite and smart-playlist semantics](https://www.navidrome.org/docs/usage/features/smart-playlists/).

Wide-screen microphone, ordering, search and heart controls belong below the left song list.
The same toolbar moves to the top on phones; do not duplicate control IDs. Voice is off by
default and must not create requests or capture audio until configured. Its relay receives
only recordings or command text and a separate device token, never music credentials.
Native favorites intent is explicit; display labels must not imply playlist selection.
See [optional voice deployment](voice.md). Relay tests use mocked localhost providers:
`python3 -m unittest discover -s tests -p test_voice_server.py`.
