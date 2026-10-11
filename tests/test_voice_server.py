"""Exercise the optional relay over localhost; transcription providers are mocked."""
from concurrent.futures import ThreadPoolExecutor
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
import voice

CAR = "car-test-token-" + "c" * 32
PHONE = "phone-test-token-" + "p" * 32
ORIGIN = "https://player.example.test"


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.calls = []

        def transcribe(config, data, mime):
            self.calls.append((data, mime))
            return "播放 Auld Lang Syne"

        config = voice.Config(tokens={"car": CAR, "phone": PHONE}, origins=(ORIGIN,), database=self.temp.name + "/inbox.sqlite3")
        self.service = voice.VoiceService(config, transcribe)
        self.server = voice.make_server(self.service, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:%s" % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", data=None, token=CAR, origin=None, headers=None):
        h = {"Authorization": "Bearer " + token} if token else {}
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
        if origin is not None:
            h["Origin"] = origin
        h.update(headers or {})
        try:
            response = urlopen(Request(self.base + path, data=data, headers=h, method=method), timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers

    def test_closed_by_default_and_unique_device_tokens(self):
        with self.assertRaises(ValueError), patch.dict(voice.os.environ, {"VOICE_TOKENS_JSON": "{}"}):
            voice.Config.from_env()
        with self.assertRaises(ValueError):
            voice.Config(tokens={"one": CAR, "two": CAR})
        self.assertEqual(Path(self.service.config.database).stat().st_mode & 0o777, 0o600)

    def test_unauthorized_and_disallowed_origins_cannot_read_or_write(self):
        for method, path, data in (("GET", "/inbox", None), ("POST", "/inbox", {"text": "Auld Lang Syne"})):
            self.assertEqual(self.request(path, method, data, token="wrong")[0], 401)
            self.assertEqual(self.request(path, method, data, origin="https://other.example.test")[0], 403)
        self.assertIsNone(self.service.inbox.peek("car"))
        self.assertEqual(self.calls, [])

    def test_cors_preflight_and_text_shortcut_need_no_asr_key(self):
        status, _, headers = self.request("/inbox", "OPTIONS", token=None, origin=ORIGIN)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertIn("Authorization", headers["Access-Control-Allow-Headers"])
        self.assertFalse(self.request("/health")[1]["asr"])
        status, result, _ = self.request("/inbox", "POST", {"text": "播放 Auld Lang Syne"})
        self.assertEqual(status, 202)
        self.assertEqual(result["command"]["query"], "Auld Lang Syne")
        self.assertEqual(self.calls, [])

    def test_device_isolation_and_atomic_acceptance_between_two_tabs(self):
        queued = self.request("/inbox", "POST", {"text": "play Edelweiss"})[1]["command"]
        self.assertIsNone(self.request("/inbox", token=PHONE)[1]["command"])
        self.assertFalse(self.request("/inbox/ack", "POST", {"id": queued["id"]}, token=PHONE)[1]["accepted"])
        self.assertEqual(self.request("/inbox")[1]["command"]["id"], queued["id"])
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.request("/inbox/ack", "POST", {"id": queued["id"]})[1]["accepted"], range(2)))
        self.assertEqual(sorted(results), [False, True])
        self.assertIsNone(self.request("/inbox")[1]["command"])

    def test_latest_request_replaces_previous_and_expires(self):
        first = self.request("/inbox", "POST", {"text": "First"})[1]["command"]
        second = self.request("/inbox", "POST", {"text": "Second"})[1]["command"]
        self.assertFalse(self.request("/inbox/ack", "POST", {"id": first["id"]})[1]["accepted"])
        self.assertEqual(self.request("/inbox")[1]["command"]["query"], "Second")
        with patch.object(voice.time, "time", return_value=second["expiresAt"]):
            self.assertIsNone(self.request("/inbox")[1]["command"])
            self.assertFalse(self.request("/inbox/ack", "POST", {"id": second["id"]})[1]["accepted"])

    def test_explicit_favorites_intent_does_not_depend_on_a_playlist_name(self):
        for phrase in ("播放我的最爱", "play my favorites", "Please play favourites"):
            self.assertEqual(voice.parse_command(phrase), {"type": "favorites"})
        self.assertEqual(voice.parse_command("播放 宝宝哄睡"), {"type": "search", "query": "宝宝哄睡"})
        self.assertEqual(voice.parse_command("平凡的一天"), {"type": "search", "query": "平凡的一天"})

    def test_invalid_shortcut_bodies_and_audio_sizes_do_not_reach_provider(self):
        for text in (None, [], "", "x" * 241):
            self.assertEqual(self.request("/inbox", "POST", {"text": text})[0], 400)
        self.assertEqual(self.request("/inbox", "POST", b"{bad", headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("/asr", "POST", b"fake", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("/asr", "POST", b"x", headers={"Content-Type": "audio/webm", "Content-Length": str(voice.MAX_AUDIO + 1)})[0], 413)
        self.assertEqual(self.calls, [])

    def test_webm_and_safari_mp4_recordings_are_forwarded_without_reencoding(self):
        for mime in ("audio/webm;codecs=opus", "audio/mp4"):
            status, result, _ = self.request("/asr", "POST", b"raw\x00audio", headers={"Content-Type": mime})
            self.assertEqual(status, 200)
            self.assertEqual(result["command"], {"type": "search", "query": "Auld Lang Syne"})
        self.assertEqual(self.calls, [(b"raw\x00audio", "audio/webm"), (b"raw\x00audio", "audio/mp4")])

    def test_transcription_capacity_and_write_rate_are_bounded(self):
        self.service.asr_slots.acquire()
        self.service.asr_slots.acquire()
        try:
            self.assertEqual(self.request("/asr", "POST", b"audio", headers={"Content-Type": "audio/mp4"})[0], 429)
        finally:
            self.service.asr_slots.release()
            self.service.asr_slots.release()
        for _ in range(29):
            self.assertEqual(self.request("/inbox", "POST", {"text": "A song"})[0], 202)
        self.assertEqual(self.request("/inbox", "POST", {"text": "Another"})[0], 429)
        self.assertEqual(self.request("/health")[0], 200)


class UpstreamTests(unittest.TestCase):
    def test_multipart_provider_contract_and_server_only_key(self):
        received = []

        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                message = BytesParser(policy=default).parsebytes(("Content-Type: " + self.headers["Content-Type"] + "\r\n\r\n").encode() + body)
                received.append((self.path, self.headers["Authorization"], list(message.iter_parts())))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"text":"play Edelweiss"}')

        server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            config = voice.Config(tokens={"car": CAR}, asr_url="http://127.0.0.1:%s/v1" % server.server_port,
                                  asr_key="provider-test-key-stays-server-side")
            self.assertEqual(voice.transcribe_audio(config, b"raw\x00mp4", "audio/mp4"), "play Edelweiss")
            path, auth, parts = received[0]
            self.assertEqual(path, "/v1/audio/transcriptions")
            self.assertEqual(auth, "Bearer provider-test-key-stays-server-side")
            self.assertEqual([p.get_param("name", header="content-disposition") for p in parts], ["model", "response_format", "file"])
            self.assertEqual(parts[2].get_filename(), "voice.mp4")
            self.assertEqual(parts[2].get_payload(decode=True), b"raw\x00mp4")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_missing_key_and_provider_errors_are_safe(self):
        config = voice.Config(tokens={"car": CAR})
        with self.assertRaises(voice.APIError) as caught:
            voice.transcribe_audio(config, b"audio", "audio/webm")
        self.assertEqual(caught.exception.status, 503)
        config = voice.Config(tokens={"car": CAR}, asr_key="provider-test-key-stays-server-side")
        with patch.object(voice, "urlopen", side_effect=HTTPError("private-url", 401, "provider-test-key-stays-server-side", {}, None)):
            with self.assertRaises(voice.APIError) as caught:
                voice.transcribe_audio(config, b"audio", "audio/webm")
        self.assertNotIn(config.asr_key, caught.exception.message)
        self.assertNotIn("private-url", caught.exception.message)


if __name__ == "__main__":
    unittest.main()
