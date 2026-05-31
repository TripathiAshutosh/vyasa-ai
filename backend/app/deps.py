from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from app.config import settings


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    expected = settings.ADMIN_TOKEN
    if not expected or expected == "change-me":
        # Refuse to operate with the default token in any deployed mode.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ADMIN_TOKEN is not configured on the server.",
        )
    if not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin token.",
        )
