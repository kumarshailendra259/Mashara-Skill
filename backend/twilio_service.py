"""Twilio integration for SMS + WhatsApp notifications.

Wraps the synchronous Twilio SDK so FastAPI callers can `await send_sms(...)`
without blocking the event loop. Every send is persisted to
`db.notification_logs` for idempotency + audit. Delivery-status webhooks
(handled in server.py) update the row by MessageSid.
"""
from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi.concurrency import run_in_threadpool
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client

log = logging.getLogger("twilio")

_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
_AUTH_TOKEN  = os.environ.get("TWILIO_AUTH_TOKEN")
SMS_FROM     = os.environ.get("TWILIO_SMS_FROM")           # +E164
WHATSAPP_FROM = os.environ.get("TWILIO_WHATSAPP_FROM")     # whatsapp:+E164
PUBLIC_BASE  = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")

_client: Optional[Client] = None


def is_configured() -> bool:
    return bool(_ACCOUNT_SID and _AUTH_TOKEN)


def get_client() -> Optional[Client]:
    """Lazy singleton — avoids failing app startup if creds aren't set yet."""
    global _client
    if _client is not None:
        return _client
    if not is_configured():
        return None
    _client = Client(_ACCOUNT_SID, _AUTH_TOKEN)
    return _client


_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def normalise_phone(raw: str, default_country_code: str = "+91") -> Optional[str]:
    """Best-effort E.164 normaliser for Indian numbers.

    - "9876543210"           -> "+919876543210"
    - "+91 98765-43210"      -> "+919876543210"
    - "(920) 806-9066"       -> "+19208069066" (US, if input starts with 1)
    """
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", str(raw))
    if not s:
        return None
    if s.startswith("+"):
        return s if _E164.match(s) else None
    # Strip leading zeros
    s = s.lstrip("0")
    if len(s) == 10:
        s = default_country_code + s
    elif len(s) == 11 and s.startswith("1"):
        s = "+" + s
    elif len(s) == 12 and s.startswith("91"):
        s = "+" + s
    else:
        s = default_country_code + s
    return s if _E164.match(s) else None


async def _log_send(db, doc: dict) -> None:
    doc.setdefault("id", str(uuid.uuid4()))
    doc.setdefault("created_at", datetime.now(timezone.utc).isoformat())
    await db.notification_logs.insert_one(doc)


async def send_message(
    db,
    channel: str,
    to: str,
    body: str,
    *,
    event_type: str = "generic",
    event_id: Optional[str] = None,
    sent_by_user_id: Optional[str] = None,
    sent_by_name: Optional[str] = None,
    content_sid: Optional[str] = None,
    content_variables: Optional[dict] = None,
) -> dict:
    """Send an SMS or WhatsApp message and log it.

    Returns a dict with `ok`, `message_sid`, `status`, `error`.
    """
    if channel not in ("sms", "whatsapp"):
        return {"ok": False, "error": f"invalid channel '{channel}'"}
    client = get_client()
    if not client:
        return {"ok": False, "error": "twilio_not_configured"}
    to_e164 = normalise_phone(to)
    if not to_e164:
        return {"ok": False, "error": "invalid_phone", "recipient": to}

    from_addr = WHATSAPP_FROM if channel == "whatsapp" else SMS_FROM
    if not from_addr:
        return {"ok": False, "error": f"missing_from_for_{channel}"}
    to_addr = f"whatsapp:{to_e164}" if channel == "whatsapp" else to_e164

    kwargs = {"to": to_addr, "from_": from_addr}
    if PUBLIC_BASE:
        kwargs["status_callback"] = f"{PUBLIC_BASE}/api/webhooks/twilio/status"
    if channel == "whatsapp" and content_sid:
        import json as _json
        kwargs["content_sid"] = content_sid
        kwargs["content_variables"] = _json.dumps(content_variables or {})
    else:
        kwargs["body"] = body

    def _do_send():
        return client.messages.create(**kwargs)

    log_doc = {
        "channel": channel, "recipient": to_e164, "body": body,
        "event_type": event_type, "event_id": event_id,
        "sent_by_user_id": sent_by_user_id, "sent_by_name": sent_by_name,
        "status": "queued",
    }
    try:
        msg = await run_in_threadpool(_do_send)
        log_doc.update({
            "message_sid": msg.sid, "status": msg.status or "queued",
            "twilio_from": from_addr, "twilio_to": to_addr,
        })
        await _log_send(db, log_doc)
        return {"ok": True, "message_sid": msg.sid, "status": msg.status,
                "recipient": to_e164, "channel": channel}
    except TwilioRestException as exc:
        log_doc.update({"status": "failed", "error_code": exc.code, "error_message": exc.msg})
        await _log_send(db, log_doc)
        log.warning("Twilio send failed code=%s msg=%s", exc.code, exc.msg)
        return {"ok": False, "error": "twilio_error", "code": exc.code, "message": exc.msg}
    except Exception as exc:  # noqa: BLE001
        log_doc.update({"status": "failed", "error_message": str(exc)})
        await _log_send(db, log_doc)
        log.exception("Notification failure")
        return {"ok": False, "error": "unknown", "message": str(exc)}
