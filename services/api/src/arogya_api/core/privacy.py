from collections import deque

from starlette.responses import JSONResponse


class BoundedRequestBody:
    def __init__(self, app, max_bytes=16384, path_limits=None):
        self.app = app
        self.max_bytes = max_bytes
        self.path_limits = path_limits or {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        chunks, size = deque(), 0
        maximum = next(
            (
                limit
                for prefix, limit in self.path_limits.items()
                if scope["path"].startswith(prefix)
            ),
            self.max_bytes,
        )
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > maximum:
                return await JSONResponse({"detail": "request_too_large"}, 413)(
                    scope, receive, send
                )
            chunks.append(message)
            if not message.get("more_body", False):
                break

        async def replay():
            return chunks.popleft() if chunks else await receive()

        await self.app(scope, replay, send)
