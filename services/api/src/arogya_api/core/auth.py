import base64
import binascii
import hmac
import json
import threading
import time
import uuid
from collections import deque

from fastapi import HTTPException


class Sessions:
    def __init__(self, settings, store):
        self.key = settings.signing_key.get_secret_value().encode()
        self.seconds = settings.session_seconds
        self.store = store

    def issue(self):
        session_id = str(uuid.uuid4())
        expires = int(time.time()) + self.seconds
        payload = base64.urlsafe_b64encode(
            json.dumps({"sid": session_id, "exp": expires}).encode()
        ).rstrip(b"=")
        signature = base64.urlsafe_b64encode(hmac.digest(self.key, payload, "sha256")).rstrip(b"=")
        self.store.session_create(session_id, expires)
        return (payload + b"." + signature).decode(), expires

    def verify(self, token):
        try:
            if not token or len(token) > 512:
                raise ValueError
            payload, signature = token.encode().split(b".")
            expected = base64.urlsafe_b64encode(hmac.digest(self.key, payload, "sha256")).rstrip(
                b"="
            )
            if not hmac.compare_digest(expected, signature):
                raise ValueError
            data = json.loads(base64.urlsafe_b64decode(payload + b"=" * (-len(payload) % 4)))
            if set(data) != {"sid", "exp"} or type(data["exp"]) is not int:
                raise ValueError
            session_id = str(uuid.UUID(data["sid"]))
            if data["exp"] <= time.time() or not self.store.session_active(session_id):
                raise ValueError
            return session_id
        except (ValueError, TypeError, KeyError, binascii.Error, UnicodeError):
            raise HTTPException(401, "invalid_or_expired_session") from None


class RateLimiter:
    def __init__(self):
        self.entries = {}
        self.lock = threading.Lock()

    def check(self, key, limit):
        now = time.monotonic()
        with self.lock:
            self.entries = {k: v for k, v in self.entries.items() if v and v[-1] > now - 60}
            if key not in self.entries and len(self.entries) >= 1024:
                raise HTTPException(429, "rate_limit_capacity", headers={"Retry-After": "60"})
            queue = self.entries.setdefault(key, deque())
            while queue and queue[0] <= now - 60:
                queue.popleft()
            if len(queue) >= limit:
                raise HTTPException(429, "rate_limit_exceeded", headers={"Retry-After": "60"})
            queue.append(now)
