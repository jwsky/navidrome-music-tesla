#!/usr/bin/env python3
"""Optional voice relay. Python 3.10+, standard library only; no music credentials."""
from __future__ import annotations

from collections import defaultdict, deque
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid

MAX_AUDIO = 2 * 1024 * 1024
MAX_JSON = 4096
COMMAND_TTL = 120
AUDIO_TYPES = {"audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg",
               "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac"}


class APIError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message
        super().__init__(message)


@dataclass(frozen=True)
class Config:
    tokens: dict[str, str]
    origins: tuple[str, ...] = ("https://jwsky.github.io",)
    database: str = "voice-state.sqlite3"
    asr_url: str = "https://api.openai.com/v1"
    asr_key: str = ""
    asr_model: str = "gpt-4o-mini-transcribe"

    def __post_init__(self):
        if not self.tokens or any(not isinstance(name, str) or not name or
                                  not isinstance(token, str) or len(token) < 24
                                  for name, token in self.tokens.items()):
            raise ValueError("VOICE_TOKENS_JSON must map device names to random tokens of at least 24 characters")
        if len(set(self.tokens.values())) != len(self.tokens):
            raise ValueError("Each device must have a different token")
        u = urlsplit(self.asr_url)
        if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password or u.query or u.fragment:
            raise ValueError("ASR_BASE_URL must be an HTTP(S) API base URL without credentials or a query")
        if any(origin == "*" for origin in self.origins):
            raise ValueError("VOICE_ALLOWED_ORIGINS must list exact browser origins")

    @classmethod
    def from_env(cls):
        try:
            tokens = json.loads(os.environ.get("VOICE_TOKENS_JSON", "{}"))
        except (ValueError, TypeError):
            raise ValueError("VOICE_TOKENS_JSON must be a JSON object") from None
        if not isinstance(tokens, dict):
            raise ValueError("VOICE_TOKENS_JSON must be a JSON object")
        return cls(tokens=tokens,
                   origins=tuple(o.strip() for o in os.environ.get("VOICE_ALLOWED_ORIGINS", "https://jwsky.github.io").split(",") if o.strip()),
                   database=os.environ.get("VOICE_DB", "voice-state.sqlite3"),
                   asr_url=os.environ.get("ASR_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
                   asr_key=os.environ.get("ASR_API_KEY", ""),
                   asr_model=os.environ.get("ASR_MODEL", "gpt-4o-mini-transcribe"))


def parse_command(text: str) -> dict:
    if not isinstance(text, str) or not text.strip() or len(text) > 240:
        raise APIError(400, "text must contain 1–240 characters")
    query = re.sub(r"\s+", " ", text).strip(" \t\n。！？!?.,，；;\"“”")
    query = re.sub(r"^(?:请|麻烦)?(?:帮我)?(?:播放|放一首|放一下|放|播一首|我想听一首|我想听|听一下)\s*", "", query)
    query = re.sub(r"^(?:please\s+)?(?:play|search(?:\s+for)?|find)\s+", "", query, flags=re.I).strip(" \"“”")
    if query.casefold() in {"最爱", "我的最爱", "我的收藏", "收藏歌曲", "favorites", "favourites", "my favorites", "my favourites"}:
        return {"type": "favorites"}
    if not query:
        raise APIError(400, "Please include a song title or artist")
    return {"type": "search", "query": query}


class Inbox:
    def __init__(self, filename: str):
        path = Path(filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect(filename) as db:
            db.execute("CREATE TABLE IF NOT EXISTS commands (device TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL)")
        path.chmod(0o600)
        self.filename = filename

    @staticmethod
    @contextmanager
    def connect(filename):
        db = sqlite3.connect(filename, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, device: str, command: dict) -> dict:
        now = int(time.time())
        item = {**command, "id": str(uuid.uuid4()), "createdAt": now, "expiresAt": now + COMMAND_TTL}
        with self.connect(self.filename) as db:
            db.execute("INSERT INTO commands VALUES (?, ?, ?, ?) ON CONFLICT(device) DO UPDATE SET id=excluded.id, payload=excluded.payload, expires=excluded.expires",
                       (device, item["id"], json.dumps(item, ensure_ascii=False), item["expiresAt"]))
        return item

    def peek(self, device: str) -> dict | None:
        with self.connect(self.filename) as db:
            row = db.execute("SELECT payload FROM commands WHERE device=? AND expires>?", (device, int(time.time()))).fetchone()
        return json.loads(row[0]) if row else None

    def accept(self, device: str, command_id: str) -> bool:
        with self.connect(self.filename) as db:
            changed = db.execute("DELETE FROM commands WHERE device=? AND id=? AND expires>?", (device, command_id, int(time.time()))).rowcount
        return changed == 1

    def expire(self):
        with self.connect(self.filename) as db:
            db.execute("DELETE FROM commands WHERE expires<=?", (int(time.time()),))


def transcribe_audio(config: Config, audio: bytes, mime: str) -> str:
    if not config.asr_key:
        raise APIError(503, "ASR is not configured; iOS dictated-text shortcuts still work")
    boundary = "voice-" + secrets.token_hex(16)
    parts = []
    for name, value in (("model", config.asr_model), ("response_format", "json")):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.{AUDIO_TYPES[mime]}"\r\nContent-Type: {mime}\r\n\r\n'.encode())
    parts.extend((audio, f"\r\n--{boundary}--\r\n".encode()))
    request = Request(config.asr_url.rstrip("/") + "/audio/transcriptions", data=b"".join(parts), method="POST",
                      headers={"Authorization": "Bearer " + config.asr_key, "Content-Type": "multipart/form-data; boundary=" + boundary})
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read(1024 * 1024 + 1)
        if len(body) > 1024 * 1024:
            raise APIError(502, "Transcription provider returned an oversized response")
        data = json.loads(body)
        text = data.get("text") if isinstance(data, dict) else None
        if not isinstance(text, str) or not text.strip() or len(text) > 240:
            raise APIError(502, "Transcription provider returned no usable song request")
        return text.strip()
    except HTTPError:
        raise APIError(502, "Transcription provider rejected the request") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise APIError(502, "Transcription provider could not be reached or returned invalid JSON") from None


class VoiceService:
    def __init__(self, config: Config, transcriber=transcribe_audio):
        self.config, self.transcriber = config, transcriber
        self.inbox = Inbox(config.database)
        self.asr_slots = threading.BoundedSemaphore(2)
        self.rate_lock = threading.Lock()
        self.writes = defaultdict(deque)

    def device(self, authorization: str) -> str:
        supplied = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
        digest = hashlib.sha256(supplied.encode()).digest()
        for name, token in self.config.tokens.items():
            if hmac.compare_digest(digest, hashlib.sha256(token.encode()).digest()):
                return name
        raise APIError(401, "A valid device bearer token is required")

    def limit_write(self, device: str):
        with self.rate_lock:
            history, now = self.writes[device], time.monotonic()
            while history and history[0] <= now - 60:
                history.popleft()
            if len(history) >= 30:
                raise APIError(429, "Too many voice requests; try again in a minute")
            history.append(now)


def make_server(service: VoiceService, host="127.0.0.1", port=8787):
    class RelayServer(ThreadingHTTPServer):
        last_cleanup = 0

        def service_actions(self):
            if time.monotonic() - self.last_cleanup >= 30:
                service.inbox.expire()
                self.last_cleanup = time.monotonic()

    class Handler(BaseHTTPRequestHandler):
        # Do not log tokens, query strings, audio or dictated text.
        def log_message(self, *_):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def reply(self, status: int, data: dict):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            origin = self.headers.get("Origin")
            if origin in service.config.origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            self.wfile.write(body)

        def body(self, maximum: int) -> bytes:
            if self.headers.get("Transfer-Encoding"):
                raise APIError(400, "A Content-Length is required")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise APIError(400, "Invalid Content-Length") from None
            if length <= 0:
                raise APIError(400, "An empty request is not accepted")
            if length > maximum:
                raise APIError(413, "Request is too large")
            body = self.rfile.read(length)
            if len(body) != length:
                raise APIError(400, "Incomplete request")
            return body

        def json_body(self) -> dict:
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                raise APIError(415, "Use application/json")
            try:
                data = json.loads(self.body(MAX_JSON))
            except ValueError:
                raise APIError(400, "Invalid JSON") from None
            if not isinstance(data, dict):
                raise APIError(400, "JSON must be an object")
            return data

        def dispatch(self):
            try:
                origin = self.headers.get("Origin")
                if origin is not None and origin not in service.config.origins:
                    raise APIError(403, "Browser origin is not allowed")
                if self.command == "OPTIONS":
                    self.reply(200, {})
                    return
                device = service.device(self.headers.get("Authorization", ""))
                path = urlsplit(self.path).path
                if self.command == "GET" and path == "/health":
                    self.reply(200, {"ok": True, "asr": bool(service.config.asr_key)})
                elif self.command == "GET" and path == "/inbox":
                    self.reply(200, {"command": service.inbox.peek(device)})
                elif self.command == "POST" and path == "/inbox":
                    service.limit_write(device)
                    item = service.inbox.put(device, parse_command(self.json_body().get("text")))
                    self.reply(202, {"queued": True, "command": item})
                elif self.command == "POST" and path == "/inbox/ack":
                    command_id = self.json_body().get("id")
                    if not isinstance(command_id, str) or len(command_id) > 80:
                        raise APIError(400, "A command id is required")
                    self.reply(200, {"accepted": service.inbox.accept(device, command_id)})
                elif self.command == "POST" and path == "/asr":
                    service.limit_write(device)
                    mime = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                    if mime not in AUDIO_TYPES:
                        raise APIError(415, "Send WebM, MP4, Ogg, MP3, WAV or FLAC audio")
                    audio = self.body(MAX_AUDIO)
                    if not service.asr_slots.acquire(blocking=False):
                        raise APIError(429, "Transcription is busy; try again shortly")
                    try:
                        text = service.transcriber(service.config, audio, mime)
                    finally:
                        service.asr_slots.release()
                    self.reply(200, {"text": text, "command": parse_command(text)})
                else:
                    raise APIError(404, "Unknown endpoint")
            except APIError as error:
                self.reply(error.status, {"error": error.message})
            except (TimeoutError, ConnectionError, BrokenPipeError):
                return
            except Exception:
                self.reply(500, {"error": "Voice service could not complete the request"})

        do_GET = do_POST = do_OPTIONS = dispatch

    return RelayServer((host, port), Handler)


def main():
    try:
        config = Config.from_env()
        service = VoiceService(config)
        server = make_server(service, os.environ.get("VOICE_HOST", "127.0.0.1"), int(os.environ.get("VOICE_PORT", "8787")))
    except (ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
    print("Optional voice relay listening on %s:%s" % server.server_address, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
