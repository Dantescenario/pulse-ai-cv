"""Runtime portfolio policy. Only explicit false enables the private legacy app."""
import os

from starlette.responses import JSONResponse


def demo_mode_enabled():
    value = os.getenv("PULSEAI_DEMO_MODE", "true").strip().lower()
    if value not in ("true", "false"):
        raise ValueError("PULSEAI_DEMO_MODE must be true or false")
    return value == "true"


DEMO_ERROR = {
    "detail": {
        "code": "DEMO_MODE_DISABLED",
        "message": "Personal-data and non-CV APIs are disabled in the public portfolio demo.",
    }
}


class PortfolioDemoMiddleware:
    """Reject before request parsing or database-backed handlers can run.

    An API allowlist also protects newly added endpoints by default. Static
    frontend and bundled MediaPipe assets remain accessible.
    """
    PUBLIC_API_PATHS = frozenset(("/api/health", "/api/workouts/analyze-video"))

    def __init__(self, app, settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if (scope["type"] == "http" and self.settings.demo_mode
                and (path == "/api" or path.startswith("/api/"))
                and path not in self.PUBLIC_API_PATHS):
            await JSONResponse(DEMO_ERROR, status_code=403)(scope, receive, send)
            return
        await self.app(scope, receive, send)
