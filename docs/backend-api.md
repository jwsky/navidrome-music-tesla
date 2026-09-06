# Self-hosted search backend contract

[English](backend-api.md) · [中文](backend-api.zh-CN.md)

When a URL is configured under **Settings → Self-hosted search backend**, the client issues
three request types against it. Implementing all three is the complete integration;
implementing only `/search` and `/play` also works, with those tracks simply having no
lyrics.

All requests are `GET` and must return `application/json`. Because the browser calls the
service directly, **the server must send CORS headers**:

```
Access-Control-Allow-Origin: *
```

The examples below assume the configured base URL is `https://example.com/api`.

## GET /search?q=&lt;query&gt;

```jsonc
{
  "results": [
    {
      "id": "12345",
      "title": "Track title",
      "artist": "Artist",
      "duration": 269,             // seconds, optional
      "cover": "https://…/x.jpg",  // optional; a built-in placeholder is used when absent
      "play": { "id": "12345", "platform": "xxx" }
      // `play` is an opaque dictionary. The client appends it verbatim to the query string
      // of /play and /lyric. When omitted it defaults to {id: id}.
    }
  ]
}
```

## GET /play?&lt;keys from `play`&gt;

Returns an address the browser can assign directly to an `<audio>` element:

```jsonc
{ "url": "https://…/song.mp3" }
```

The host serving that URL must also permit cross-origin playback, or the backend should
proxy the stream itself.

## GET /lyric?&lt;keys from `play`&gt;

```jsonc
{
  "lines": [
    {
      "start": 21500,            // line start time, milliseconds
      "value": "original text",
      "roma":  "romanisation",   // optional
      "trans": "translation",    // optional
      "chars": [                 // optional, per-character timing for the original text
        { "o": 0,   "d": 260, "c": "原" },
        { "o": 260, "d": 240, "c": "文" }
      ],
      "romaChars": [             // optional, per-character timing for the romanisation
        { "o": 0,   "d": 300, "c": "luo " },
        { "o": 300, "d": 300, "c": "ma " }
      ]
    }
  ]
}
```

In `chars` and `romaChars`, `o` is the offset **relative to that line's `start`** in
milliseconds and `d` is the duration of the character. When present, the client sweeps the
line character by character; when absent it falls back to highlighting the whole line.

If both arrays are supplied the sweep follows `romaChars`, because the romanisation is
rendered as the primary line whenever it exists.

## GET /correct?q=&lt;query&gt;  (optional)

Lets the backend fix up a query before it is searched — useful for homophone errors from
voice input. Keeping this server-side means no model API key has to live in the browser, and
the backend can cache repeated queries.

```jsonc
{
  "original":  "告白汽球",
  "corrected": "告白气球",
  "changed":   true          // false = leave the query alone
}
```

When `changed` is true the client searches for **both** the original and the corrected query
and keeps both sets of results. If this endpoint is missing, the client falls back to the
OpenAI-compatible endpoint configured in settings, if any.

## Reserved

Two further endpoints are planned and not implemented yet; they are listed so backends can
avoid the names. `/asr` will accept captured audio and return a transcript, and `/inbox` will
let an external trigger (an Apple Shortcut, for instance) queue a query for the player to pick
up. See the roadmap in the README.

## Failure handling

If any endpoint is unreachable, times out or returns an unexpected shape, the client skips
that source only. Local library search and playback are unaffected.
