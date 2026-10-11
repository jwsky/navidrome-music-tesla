# navidrome-music-tesla

[English](README.md) · [中文](README.zh-CN.md)

A single-file web client for [Navidrome](https://www.navidrome.org/), built for car, phone
and desktop browsers. One HTML file — no build step, no extra service for music playback,
no frontend dependencies. Voice control has an [optional relay](docs/voice.md).

![Auld Lang Syne with timed lyrics and album covers](docs/player.png)

| Phone · library expanded | Phone · library collapsed |
| --- | --- |
| <a href="docs/mobile-sheet.png"><img src="docs/mobile-sheet.png" width="390" alt="Phone with the song list open"></a> | <a href="docs/mobile-player.png"><img src="docs/mobile-player.png" width="390" alt="Phone showing lyrics with the song list collapsed"></a> |

## Overview

- **Single file.** `index.html` contains all markup, styles and scripts. Nothing to compile
  and nothing to install.
- **No backend for playback.** The page talks directly to your Navidrome server over the
  Subsonic API. Ordinary playback adds no service.
- **Designed for a car screen.** Large touch targets, tall list rows, a centred lyrics pane
  that scrolls itself, and album art used as the background. Wide-screen actions sit below
  the left song list, closer to the driver in a left-hand-drive car with a central display.
- **Phone layout.** Lyrics fill the screen; swipe up to browse the library, then pick a track
  to fold it away. Playback controls stay within reach at the bottom.
- **Optional plugins** for YouTube search, AI query correction, a self-hosted search backend
  and voice control. All are disabled by default and issue no requests until configured.
- **Voice requests.** Use the microphone or send iOS Shortcuts dictation from your phone.
  Only this feature needs the optional relay; code and deployment steps are included.
- **Native favorites.** A heart button opens your Navidrome-starred songs from a local cache. Long-press
  a library track to add or remove it; Chinese, English and instrumental tracks all work.
- **Most played, with some discovery.** Every ten default rows contain the next seven tracks
  by play count and three lower-play discoveries. The same rule applies to favorites.
- **Not tied to Tesla.** It was developed and tuned against the Tesla browser, but nothing in
  it is vehicle-specific. Any in-car, embedded or kiosk browser that meets the requirements
  below will run it — Android Automotive head units, aftermarket units, tablets mounted in a
  dash, or an ordinary desktop browser.
- **Light enough for weak hardware.** A single HTML document, no framework and no runtime
  dependencies. See [Performance](#performance).

## Why a separate client

Navidrome ships a capable web UI, but it is laid out for desktop and phone use. On an in-car
display the controls are small relative to the viewing distance, list rows are dense, and
lyrics are presented as static text. This client trades browsing depth for legibility:
fewer controls, larger hit areas, and a lyrics view that tracks playback.

The wide-screen microphone, ordering, search and heart toolbar is anchored below the song
list on the left. That reduces reach across a central display for a left-hand-drive driver
and leaves the lyrics area clear. Settings remain in the top-right corner. Optional
microphone and Siri/Shortcuts requests reduce typing; phones keep a compact top toolbar,
accessible with the list folded. Right-hand-drive mounting positions differ.

## Requirements

- A Navidrome server reachable from the car. The Subsonic API is enabled by default.
- A browser supporting `fetch`, `clip-path` and `IntersectionObserver`. Tested on Chrome,
  Edge, Safari and the Tesla in-car browser.
- HTTPS is recommended. A page served over HTTPS cannot call a plain-HTTP Navidrome server;
  browsers block that as mixed content.

## Installation

### Option 1 — use the hosted build

<https://jwsky.github.io/navidrome-music-tesla/>

Open it in the car's browser and bookmark it. This is the `index.html` from this repository
served as a static page by GitHub Pages. Your server address and credentials are stored in
your own browser and are never transmitted to the host — the page has no backend to send
them to.

### Option 2 — host it yourself

Download [`index.html`](index.html) and serve it from anywhere static:

- GitHub Pages, Cloudflare Pages, Netlify, or any object storage with static hosting
- Any directory served by the web server already running on the Navidrome host
- An internal nginx or Caddy instance

The file can also be opened directly from disk (`file://`). Some browsers restrict
`localStorage` or cross-origin requests in that context; if settings do not persist or the
connection is blocked, use static hosting. There is still no application backend to run.

## Configuration

Open the settings panel with the gear icon in the top-right corner.

![Settings](docs/settings.png)

Settings are stored in `localStorage` on the device that entered them. This page has no
separate account or telemetry. Play counts and favorite changes are sent to your Navidrome
server so that its other clients can see them too.

### Navidrome (required)

| Field | Notes |
| --- | --- |
| Server URL | Scheme and host, e.g. `https://music.example.com`. The `/rest` path is appended automatically; a trailing `/rest` is also accepted. |
| Username | Your Navidrome username. |
| Password | Your Navidrome password. |

No server of your own yet? The settings panel has a **fill in the official demo** link that
loads Navidrome's public demo instance and tests it in one go, so you can see what the client
does before setting anything up. That server is provided by the Navidrome project and is
explicitly offered for trying Subsonic clients; it carries a few hundred freely licensed
tracks and its settings are read-only.

Use **Test connection** to verify the settings before saving. On success it reports the
server type and version.

Authentication uses the Subsonic salt-and-token scheme: a random salt is generated for every
request and only `md5(password + salt)` is transmitted. The plaintext password is never put
in a URL, but it is kept in `localStorage` so that new salts can be derived. Treat any device
where you enter it as trusted.

#### Cross-origin requests

Navidrome returns `Access-Control-Allow-Origin: *` on the Subsonic API. That is what makes a
backend-free client possible: the page may be served from any origin and still call your
server directly. If Navidrome sits behind your own reverse proxy, make sure the proxy does
not strip or override that header.

### YouTube search (optional)

When configured, search results include YouTube entries alongside your library, so tracks
that are not in your collection can be played from the same interface. Audio is resolved to a
direct URL and played through the same `<audio>` element as local files — no embedded player
is used, so the progress bar, track skipping and keyboard shortcuts behave identically.

This plugin uses two third-party APIs hosted on RapidAPI, both with a free tier:

| API name | Purpose |
| --- | --- |
| `yt-api` | Search; returns the result list |
| `youtube-mp36` | Resolves a video to a playable audio URL |

Links are deliberately omitted — several similarly named APIs exist. Search for them by name
on RapidAPI and check the provider and current free-tier limits yourself.

**Setup**

1. Create a RapidAPI account.
2. Search for `yt-api`, open it and subscribe to the free plan.
3. Search for `youtube-mp36`, open it and subscribe to the free plan.
4. On either API page, copy the `X-RapidAPI-Key` value shown in the code samples.
5. Paste it into **Settings → YouTube search** and save.

The RapidAPI key is account-level, so a single key covers both APIs — but **each API must be
subscribed to separately**, otherwise calls are rejected with HTTP 403.

**Multiple keys.** Free plans are rate limited. Several keys may be entered, separated by
commas or newlines; one is chosen at random per request.

```
key-A, key-B
```

**Behaviour.** Library results are rendered first and remain visible while the YouTube
request is in flight. The resolver transcodes on demand, so the first play of a given track
may return a "processing" state; the interface reports this and retries for a few seconds.
YouTube entries have no lyrics — the artwork and title are shown instead.

**Troubleshooting**

| Message | Cause |
| --- | --- |
| `还没填 RapidAPI key` | The field is empty. |
| `RapidAPI 403` | Not subscribed to that API, or the key is wrong. Both APIs must be subscribed. |
| `RapidAPI 429` | Rate limit reached. Wait, or configure additional keys. |
| `YouTube 转码太久了` | The resolver stayed in the processing state. Try another result or retry later. |
| No YouTube results, no error | The key is empty, or the query genuinely returned nothing. |

**Compliance.** This plugin is disabled by default and ships with no credentials. It is
intended for personal use. The APIs it calls are operated by third parties with no
affiliation to this project or to YouTube, and downloading or extracting audio may conflict
with the YouTube Terms of Service or with local law depending on your jurisdiction and how
you use it. Enabling the plugin and supplying a key is your decision, and ensuring that your
use is lawful and compliant is your responsibility. This project hosts, caches, proxies and
redistributes no content whatsoever; all requests are made directly by your browser using
credentials you supply.

### AI query correction (optional)

Voice input and quick typing produce homophone errors — in Chinese, for example, 告白气球
easily becomes 告白汽球, which matches nothing. With this enabled, the query is first passed
to a language model for correction, and **results for both the original and the corrected
query are shown**. Nothing is replaced or discarded, so a bad correction does not cost you
the original results.

| Field | Notes |
| --- | --- |
| Enable | Off by default. |
| Endpoint | Any service exposing an OpenAI-compatible `/chat/completions`, e.g. `https://api.openai.com/v1`. |
| API key | Sent as `Authorization: Bearer`. |
| Model | Model identifier, e.g. `gpt-4o-mini`. |

One short completion is issued per search, capped at 40 output tokens. The key is stored in
`localStorage` and sent directly from the browser to the endpoint you configured.

### Self-hosted search backend (optional)

An additional source can be attached by pointing this field at a service that implements
three endpoints. See [docs/backend-api.md](docs/backend-api.md) for the contract. If a
backend supplies word-level lyric timings, the karaoke sweep described below is used.

### Voice and iOS Shortcuts (optional)

Deploy [`server/voice.py`](server/voice.py), then enable **Settings → 语音点歌与 iOS 快捷指令**
and enter its HTTPS address and your own device token. The default page does not record or poll.

- **Browser microphone:** tap, speak a title, tap again to finish. Your relay transcribes
  the recording using a provider key kept on the server.
- **iOS Shortcuts:** use **Dictate Text**, then **Get Contents of URL** to POST the text.
  The open player receives it and searches normally; this path needs no transcription API key.
- **Native favorites:** say “play my favorites” or “播放我的最爱”. This uses the current
  Navidrome account's stars, independently of the entry's display label.

The relay uses Python's standard library and never receives your music password.
[Deployment and Shortcut setup](docs/voice.md) includes HTTPS, configuration, an optional
systemd unit and API examples. Simple title/artist requests work; complex natural-language
playlist instructions are not implemented. The player must stay open and visible;
browser autoplay may still require tapping Play once.

## Playback

Selecting a track starts playback. Native library tracks request playback directly during
the click, without waiting for a loading event. If the browser blocks playback, the page
shows a prompt; tap **Play** to retry. The button follows the actual playback state.

When the browser cannot decode the original format, the client requests one MP3 transcode
from Navidrome at up to 320 kbps. Navidrome must have transcoding configured for this to work.
Playback permission errors do not trigger transcoding. A failed retry shows an error and
leaves the controls available to retry or choose another track.

## On a phone

Phones open in the lyrics view. The library sits in a sheet at the bottom; when collapsed,
only its header shows. The two phone screenshots at the top show the expanded and collapsed
states.

- **More room for lyrics.** The list folds away after choosing a track, so lyrics remain large
  and easy to follow on a narrow screen.
- **More tracks in view.** Single-line rows keep artwork, title and artist together without
  filling the screen with separate cards.
- **Controls stay visible.** The playback bar and library handle fit within the visible
  viewport as mobile browser toolbars expand or collapse.
- **Quick favorites access.** Once synced, the heart button opens cached native favorites immediately.
  Long-press a track to manage its membership.

The same HTML file works on a phone, tablet or car screen, with no app to install and no
additional backend to run.

Swipe up on the header — or tap it — to raise the sheet over most of the screen; swipe back
down or pick a track to drop it again. A quick flick counts, and a drag that does not travel
far enough springs back rather than toggling.

Rows are one line each — artwork, title, source badge and artist — so roughly seventeen fit on
screen at once. Titles that do not fit scroll sideways, and the right edge fades only when
there is actually more text to reveal.

The screenshots show selected library tracks with real album artwork and timed lyrics.
The playing track is **Auld Lang Syne**, performed by Mairi Campbell and David Francis;
the displayed lyric excerpt follows Robert Burns's
[public-domain text (Library of Congress)](https://www.loc.gov/item/00001778/).
The recording and album artwork retain their respective rights. Account details are omitted.
Images are lossless PNGs rendered at 2× on desktop and 3× on phone. Open an image to see it
at full resolution.

Covers replace the built-in placeholder only after the image has loaded successfully, so
a slow or broken server leaves a placeholder rather than an empty box.

## Favorites (native Navidrome stars)

The heart button opens the **songs starred by your signed-in Navidrome account**, using
`getStarred2.song`. No named playlist, bundled collection or extra backend is required.
Track hearts set in other Navidrome clients appear here too. Starring an album or artist
does not automatically star every track it contains.

1. Connect your own Navidrome account.
2. Long-press a library track, right-click it, or press Shift+F10 on a focused row.
3. Choose **加入最爱** to call native `star`; the client reads the song back to confirm.
4. Choose **取消最爱** to call `unstar`. The audio file, ordinary playlists and current
   playback are preserved.

**Settings → 最爱 → 入口显示名称** changes the label only: `Favorites`, `Bedtime favorites`
or another name all open the same account's starred songs. The label never chooses a playlist
or filters music. Each account has one starred-song collection; use ordinary Navidrome
playlists for independently managed bedtime, nursery or pop collections.

**Also show favorites as a playlist in Navidrome.** Its native smart playlists can mirror
track hearts. Save this as `Favorites.nsp` in your music folder and run a library scan:

```json
{
  "name": "Favorites",
  "all": [{"is": {"loved": true}}],
  "sort": "playCount",
  "order": "desc"
}
```

Set its owner to the account whose favorites you want; new imports belong to the first admin
by default. The playlist refreshes on access, so star or unstar songs to change its contents.
This client still reads native stars directly and does not require the playlist.
See [Navidrome smart playlists](https://www.navidrome.org/docs/usage/features/smart-playlists/).

Metadata is cached by server and username, independently of the label. Opening the heart
reads the cache immediately; a first visit waits for the initial background sync. Refreshes
run every five minutes and on returning after at least a minute. Failed reads preserve the
last confirmed snapshot. Artwork and audio still load from Navidrome. Switching accounts
uses a separate cache.

**Upgrading an older installation.** Earlier “bedtime favorites” were entries in an ordinary
playlist, not native stars. Upgrading does not delete or automatically rewrite those playlists.
Open your old playlist in Navidrome and star the tracks you want to keep, or add them individually
through this client's track menu. Existing native stars are preserved.

[Navidrome favorites](https://www.navidrome.org/docs/overview/) ·
[getStarred2 API](https://opensubsonic.netlify.app/docs/endpoints/getstarred2/)

**Finding tracks.** In the favorites view, **从曲库挑选** opens suggestions drawn from your
own library. Titles and album or genre names are matched against lullabies, familiar gentle
songs and quiet piano collections. English, Chinese and instrumental tracks are supported;
examples include *Edelweiss*, 《平凡的一天》 and *Mia & Sebastian's Theme*. This is a metadata
filter, not audio analysis: versions and arrangements vary, so listen before adding them.
Nothing is automatically added, downloaded or bought. No music collection or personal
playlist is bundled with the client.

**File deletion.** The menu shows original-file deletion as unavailable. The standard
[Subsonic API](https://opensubsonic.netlify.app/docs/endpoints/) used here has no endpoint for
deleting library audio files. Delete a file with the tools managing your music folder, then
let Navidrome rescan. Removing a playlist entry is a separate operation. This client
installs no file-management service.

## Default order and play counts

The library and favorites use the same default order. Each complete block of ten
contains the next seven tracks ranked by Navidrome's `playCount` and three discoveries from
the lower-play part of the list. The positions are **popular, popular, popular, discovery,
popular, popular, discovery, popular, popular, discovery**. Tracks are not repeated. Tied
counts are resolved by last played time, then date added; discovery stays stable during
one page session and is reshuffled on reload. The order button switches the library to
**最近添加** (recently added) and back.

All ranking happens in the browser after library metadata has loaded. The library is read
in pages, so collections larger than 500 tracks are included. Search results keep their
search order instead of using this mix.

For a library track, the client submits one `scrobble` after actually played sections total
at least **half the track or four minutes, whichever is shorter**. Seeking over the halfway
point does not count skipped audio; time spent paused does not count either. Listening to
the same section again within one play does not count that section twice. Loading a track
again starts a new play. After a confirmed submission, the client reads the updated count
from Navidrome. External YouTube or plugin tracks are not submitted as library plays.
Reporting requires a connection; this page does not queue or automatically retry an
uncertain submission. Counts recorded by other clients follow those clients' own rules.

## Lyrics

Navidrome serves embedded lyrics as well as `.lrc` files placed alongside the audio. Timed
lyrics are followed automatically: the active line is enlarged, centred and scrolled into
view.

![Lyrics](docs/lyrics.png)

When a source provides word-level timings, the active line is swept character by character.
Three layers are rendered per line — original text, romanisation and translation. If a
romanisation is present the type scale is inverted: the romanisation becomes the primary
line, the original is reduced to a reference line above it, and the sweep follows the
romanisation. Long lines wrap, and the sweep advances across the wrapped rows.

### Scrubbing by lyrics

Dragging the lyrics pauses auto-follow and shows a crosshair line with the timestamp of the
line at the centre. Playback does **not** jump on drag alone — swiping past a line is far too
easy to do by accident — so the position is only applied when the button is tapped. Auto-follow
resumes a few seconds after the last movement, or immediately after a jump.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| → | Next track |
| ← | Previous track |

## Performance

In-car browsers generally run on modest hardware and an unreliable connection, so the client
is built to stay cheap at runtime:

- One HTML document, parsed in a single pass. No framework, no bundler runtime, no
  external requests for code or fonts. Basic playback requests only your own server's API,
  cover art and audio; optional plugins contact their configured services.
- The DOM stays small. Only the current lyric line carries the two-layer sweep markup;
  every other line is plain text.
- The karaoke sweep animates `clip-path` on a composited layer and reads no layout during
  playback — all glyph measurements are taken once when the line becomes active.
- Cover art is fetched only for rows scrolled into view, at 96 px. See the note below on why
  this matters more than it looks.
- Progress and lyric tracking run on a single 200 ms interval; the per-frame loop exists only
  while a swept line is actually playing.

## Notes on in-car browsers

- The Tesla browser is Chromium-based; ES6 and modern CSS are available. Other Chromium- or
  WebKit-based head units behave the same way.
- **Cover art is loaded on demand.** A library view can contain hundreds of rows, and
  requesting every thumbnail at once saturates the connection pool and starves the audio
  stream. Measured on a 500-track library: 12 seconds from tapping a track to audio starting.
  With an `IntersectionObserver` loading only visible rows, the same action starts audio in
  under 5 seconds. `loading="lazy"` alone was not sufficient.
- List thumbnails are requested at 96 px; the full-size image is fetched only for the
  background.
- The karaoke sweep is drawn with `clip-path` on a composited layer, so it does not trigger
  layout on every frame.
- Many vehicles, Tesla included, disable screen interaction while moving. That is a platform
  restriction, not a limitation of this page.

## Privacy

Basic playback has no extra application backend or analytics. Browser requests go to
destinations you configure: Navidrome and enabled plugin endpoints. The optional voice relay
forwards recordings to your configured transcription provider and temporarily stores
Shortcut text for delivery. It receives no music credentials. Settings, including
credentials and API keys, are held in `localStorage` on that device only. The favorites cache
is also local. Favorite changes and qualifying playback timestamps are sent to your
Navidrome server. No settings export or private song list is included in this repository.

A static page cannot conceal a key from the browser using it. Enter your own keys in
settings; do not paste them into `index.html` or publish browser storage, network captures
or screenshots containing filled credentials.

## Browser support

Chrome, Edge, Safari and the Tesla in-car browser have been tested directly. Any reasonably
current Chromium- or WebKit-based browser should work; the requirements are `fetch`,
`clip-path` and `IntersectionObserver`, and the client degrades to eager image loading where
`IntersectionObserver` is unavailable.

## Roadmap

The following is not implemented yet and is listed here to describe the intended direction.

### Richer voice commands

Simple microphone and Apple Shortcuts requests are implemented through the optional relay.
Extracting title and artist from complex sentences and selecting arbitrary playlists by
natural language remain future work. Current voice input supports search and native favorites.

## Private deployments and the GitHub version

Both use the same native favorite source: `getStarred2.song` and `star/unstar`. The
default label in both deployments is “最爱”. Labels and connection
settings do not change the source. This repository contains no private songs, accounts or
playlist IDs, and installs no original-file deletion service. See the [development contract](docs/development.md).

## Contributing

Issues and pull requests are welcome. The entire application is `index.html`; there is no
build tooling to set up — edit the file and reload the page.

Client checks use Node's built-in test runner: `node --test tests/*.test.cjs`. Relay checks
run with `python3 -m unittest discover -s tests -p test_voice_server.py`.
Both use mocked services and require no build or provider credentials.

## Disclaimer

This project is provided as-is under the MIT licence, with no warranty. It is a client for a
music server that you operate. You are responsible for holding the necessary rights to the
content you access through it and for ensuring that your use of any optional third-party
integration complies with that provider's terms and with the law in your jurisdiction.

## License

[MIT](LICENSE)
