# Optional voice control

[English](voice.md) · [中文](voice.zh-CN.md)

Library playback, lyrics, favorites and play counts still work from one static HTML file
with your existing Navidrome server. Run this optional relay only for the microphone button
or remote requests from iOS Shortcuts.

| Input | Flow | Requirement |
| --- | --- | --- |
| iPhone / Siri | iOS dictates text → relay → open player | Relay only; no transcription API key |
| Browser microphone | Recorded audio → relay → transcription provider → player | Relay plus server-side transcription API key |

The relay never receives Navidrome credentials or handles music files. Search and playback
go directly from the browser to Navidrome. Python 3.10+ and its standard-library SQLite are
enough; no packages need installing.

## Start the service

Keep configuration and the database outside your public web directory. Upload only
`index.html` to static hosting.

```sh
git clone https://github.com/jwsky/navidrome-music-tesla.git
cd navidrome-music-tesla
mkdir -p ~/.config/navidrome-music-voice ~/.local/state/navidrome-music-voice
cp server/.env.example ~/.config/navidrome-music-voice/voice.env
chmod 600 ~/.config/navidrome-music-voice/voice.env
python3 -c 'import json,secrets; print(json.dumps({"car":secrets.token_urlsafe(32)}))'
```

Edit `~/.config/navidrome-music-voice/voice.env`: paste the generated JSON object into
`VOICE_TOKENS_JSON`, wrapped in single quotes. The empty object in the example deliberately
prevents startup. The player's settings and its Shortcut use the same device token; use a
different independently generated token for another receiving player.

| Variable | Use |
| --- | --- |
| `VOICE_TOKENS_JSON` | Device name → random token of at least 24 characters; never a music password |
| `VOICE_ALLOWED_ORIGINS` | Exact browser origins, comma-separated; GitHub Pages uses `https://jwsky.github.io` |
| `VOICE_HOST`, `VOICE_PORT` | Default `127.0.0.1:8787`; put an HTTPS reverse proxy in front |
| `VOICE_DB` | Private SQLite command file |
| `ASR_BASE_URL` | Optional OpenAI-compatible API base URL; default `https://api.openai.com/v1` |
| `ASR_API_KEY` | Optional transcription provider key, kept on the server |
| `ASR_MODEL` | Transcription model; default `gpt-4o-mini-transcribe`, adjustable for your provider |

Leave `ASR_API_KEY` empty for iOS-only use. The microphone needs your own provider key for
[`POST /audio/transcriptions`](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create),
accepting multipart audio and returning JSON with `text`. A compatible self-hosted provider
can be used. Provider availability and usage charges belong to your account.

```sh
set -a
. "$HOME/.config/navidrome-music-voice/voice.env"
set +a
export VOICE_DB="$HOME/.local/state/navidrome-music-voice/inbox.sqlite3"
python3 server/voice.py
```

For remote access, point your domain at the machine and add an HTTPS reverse proxy.
A minimal [Caddy configuration](https://caddyserver.com/docs/quick-starts/reverse-proxy) is:

```caddyfile
voice.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Replace the hostname with yours. An HTTPS player needs an HTTPS relay. Preserve
`Authorization` and allow `OPTIONS`; the Python service supplies CORS for the configured
origins. Do not put tokens in URLs or add wildcard CORS rules.

### systemd (optional)

Put the checkout at `/opt/navidrome-music-tesla`, readable by the service user, and copy
your completed environment file to `/etc/navidrome-music-voice.env`. Then:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin navidrome-voice
sudo chmod 600 /etc/navidrome-music-voice.env
sudo cp server/voice.service /etc/systemd/system/navidrome-music-voice.service
sudo systemctl daemon-reload
sudo systemctl enable --now navidrome-music-voice.service
```

The unit creates `/var/lib/navidrome-music-voice` for the database and changes no Navidrome
settings. Stop it independently with `systemctl stop navidrome-music-voice`.

## Player and microphone

In **Settings → 语音点歌与 iOS 快捷指令**, enable the service and enter its HTTPS address
and device token. **测试语音服务** checks the relay and whether transcription is configured;
it does not validate the upstream provider. Save and keep the player page open.

On wide screens microphone, ordering, search and heart buttons are below the left song
list. On phones they stay in the top toolbar, accessible while the list is collapsed.
Settings remain in the top-right corner.

Tap the microphone, grant access, say a title and tap again to finish. Recording stops at
eight seconds and pauses the music. The browser selects supported WebM, MP4 or Ogg audio;
the relay forwards it without re-encoding or saving a recording. If recognition fails,
tap Play to resume.
[Microphone access requires a secure context and permission](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
Some head units expose no microphone to web pages; use the Shortcut instead. Disabling
voice stops polling and releases microphone capture.

## iOS Shortcut

1. Create a shortcut called **Car music**. Add **Dictate Text**, select your language and
   finish listening after a pause.
2. Add **URL**: `https://voice.example.com/inbox`.
3. Add **Get Contents of URL**, expand the options and select **POST**.
4. Set the header `Authorization` to `Bearer ` followed by the same device token as the
   player. Keep the space after `Bearer`.
5. Set **Request Body → JSON**. Add a Text field named `text` and insert the **Dictated Text**
   variable as its value, rather than typing the variable's name.
6. Optionally show the response. `queued: true` means accepted by the relay, not that music
   has already started.
7. Run once to grant permissions; then invoke the named shortcut with Siri.

Apple describes POST and JSON bodies in
[Get Contents of URL](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios).
iPhone performs dictation, so this path does not call the transcription provider.

```json
{"text":"Play Edelweiss"}
```

Say a title or artist, optionally preceded by “play” or “播放”. “Play my favorites” and
“播放我的最爱” play the signed-in Navidrome account's native starred songs. Parsing uses
simple prefix rules; arbitrary playlist control and extracting title/artist from complex
sentences are not implemented. The optional AI search-correction plugin can help with
transcription homophones.

The visible, idle page polls about every two seconds. The relay retains only the latest
unaccepted request per device, for two minutes. Acceptance is atomic between tabs; use
one receiving player per device token. Commands are removed when accepted, before searching,
so disconnecting or closing the page after acceptance requires resending. Closed, hidden
or sleeping pages cannot receive promptly. The relay cannot wake a browser or override
vehicle restrictions.

Voice search attempts to play the first matching result through the normal player. Browser
autoplay rules apply; tap Play if blocked. Prepare the connection and Shortcut while parked.
Web microphone access and screen restrictions depend on the vehicle.

## API and checks

Except CORS preflight, all routes require `Authorization: Bearer <device-token>`.

| Route | Input / output |
| --- | --- |
| `GET /health` | `{ "ok": true, "asr": false }`; `asr` means configured |
| `POST /inbox` | JSON `{ "text": "Play Edelweiss" }` → HTTP 202, `queued`, `command` |
| `GET /inbox` | `command: null` or an object with `id`, `createdAt`, `expiresAt`, `type`, optional `query` |
| `POST /inbox/ack` | JSON `{ "id": "…" }` → `accepted: true` for one claim only |
| `POST /asr` | Raw audio and its audio `Content-Type` → `text` and a parsed `command` |

Limits: 2 MiB audio, 4 KiB JSON, 240 text characters, 30 submissions per device per minute
and two simultaneous transcriptions. Only temporary text commands are stored, with no
recordings, music passwords or model keys. The HTTP handler omits access logs; configure
your proxy to exclude authorization headers and request bodies too.

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p test_voice_server.py
```

Tests use mock library data and localhost providers, covering device separation, expiry,
duplicate acceptance, audio formats and late responses after account changes.
