"""Razorpay-backed subscription & module entitlement engine.

Every paid module maps to an `Entitlement` row per (company, module). Access
is granted only when:
  - Entitlement.status == "active"
  - Entitlement.expires_at > now()
  - The order that funded it has a captured Razorpay payment
  - Payment signature verified server-side (never trust the browser)

Frontends see a `blocked_modules` list from /auth/me/scope so they can render
the "Not Authorised" screen without ever loading protected data.
"""
from __future__ import annotations
import hashlib
import hmac
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

try:
    import razorpay
    from razorpay.errors import SignatureVerificationError
except ImportError:  # pragma: no cover
    razorpay = None
    class SignatureVerificationError(Exception):
        pass

log = logging.getLogger("razorpay")

KEY_ID = os.environ.get("RAZORPAY_KEY_ID") or ""
KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET") or ""
WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET") or ""

# ---- Catalog (INR, monthly) ------------------------------------------------
# Prices are server-owned; the client never sends amounts. Default catalog is
# seeded on startup; admins can edit prices via /api/subscription/catalog.
DEFAULT_CATALOG: list[dict] = [
    {"module": "finance",       "name": "Finance & Accounting", "description": "Transactions, Vendor Bills, Bank Reconciliation, MIS", "price_paise": 49900},
    {"module": "hr",            "name": "HR Management",        "description": "Staff Master, Documents, HR Settings",                "price_paise": 39900},
    {"module": "payroll",       "name": "Payroll",              "description": "Payroll runs, approval workflow, disbursements",       "price_paise": 69900},
    {"module": "attendance",    "name": "Attendance",           "description": "Check-in/out, Geofencing, Monthly reports",            "price_paise": 29900},
    {"module": "approvals",     "name": "Approval Workflows",   "description": "Multi-level approval engine + audit trail",            "price_paise": 19900},
    {"module": "bank_guarantee","name": "Bank Guarantee",       "description": "BG tracking + expiry alerts + renewal reminders",      "price_paise": 29900},
    {"module": "notifications", "name": "SMS & WhatsApp",       "description": "Twilio-powered SMS + WhatsApp notifications",          "price_paise": 14900},
    {"module": "mis",           "name": "MIS Dashboard",        "description": "Cross-module KPI dashboards + exports",                "price_paise": 49900},
]

# Modules that anyone with an account can access (never gated behind Razorpay).
FREE_MODULES = {"subscription", "auth", "profile"}


def is_configured() -> bool:
    return bool(razorpay and KEY_ID and KEY_SECRET)


_client = None


def get_client():
    global _client
    if _client is None and is_configured():
        _client = razorpay.Client(auth=(KEY_ID, KEY_SECRET))
    return _client


async def seed_catalog(db):
    """Idempotent: insert default modules if they aren't in the catalog yet."""
    for row in DEFAULT_CATALOG:
        await db.subscription_catalog.update_one(
            {"module": row["module"]},
            {"$setOnInsert": {**row, "is_active": True, "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )


async def get_catalog(db) -> list[dict]:
    rows = await db.subscription_catalog.find({"is_active": True}, {"_id": 0}).sort("price_paise", 1).to_list(50)
    return rows


def _company_id_for(user: dict) -> str:
    """Per-company entitlement model. Every user of the same company_id shares
    the same entitlements. Falls back to user.id if the company field is not
    set (single-user tenants)."""
    return user.get("company_id") or user.get("id")


async def compute_entitled_modules(db, user: dict) -> dict:
    """Return the effective module map for this user.

    Admins have implicit access to ALL modules (they need to be able to
    unlock things even before purchasing). Everyone else follows the
    company's active entitlements.

    Returns: {module: {status, expires_at}} for allowed modules only.
    """
    role = user.get("role")
    now_iso = datetime.now(timezone.utc).isoformat()

    # Admins bypass entitlement checks — they manage subscriptions themselves.
    if role == "admin":
        return {m["module"]: {"status": "admin", "expires_at": None}
                for m in await db.subscription_catalog.find({}, {"_id": 0, "module": 1}).to_list(50)}

    company_id = _company_id_for(user)
    rows = await db.entitlements.find(
        {"company_id": company_id, "status": "active", "expires_at": {"$gt": now_iso}},
        {"_id": 0},
    ).to_list(50)
    return {r["module"]: {"status": r["status"], "expires_at": r["expires_at"]} for r in rows}


async def _extend_or_create_entitlement(db, company_id: str, module: str,
                                        duration_months: int, order_id: str,
                                        payment_id: str) -> dict:
    """Idempotent: if the entitlement already came from this order, no-op.
    Else extends the existing active entitlement from its current expiry, or
    activates a new one starting now."""
    existing = await db.entitlements.find_one({"source_order_id": order_id}, {"_id": 0})
    if existing:
        return existing

    now = datetime.now(timezone.utc)
    active = await db.entitlements.find_one(
        {"company_id": company_id, "module": module, "status": "active",
         "expires_at": {"$gt": now.isoformat()}},
        {"_id": 0},
    )
    start_from = datetime.fromisoformat(active["expires_at"].replace("Z", "+00:00")) if active else now
    new_expiry = start_from + timedelta(days=30 * duration_months)

    doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "module": module,
        "status": "active",
        "starts_at": now.isoformat() if not active else active["starts_at"],
        "expires_at": new_expiry.isoformat(),
        "source_order_id": order_id,
        "source_payment_id": payment_id,
        "duration_months": duration_months,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    if active:
        # Extend the existing one instead of creating a duplicate.
        await db.entitlements.update_one(
            {"id": active["id"]},
            {"$set": {"expires_at": doc["expires_at"], "updated_at": doc["updated_at"],
                       "source_order_id": order_id, "source_payment_id": payment_id}},
        )
        active.update({"expires_at": doc["expires_at"], "source_order_id": order_id})
        active.pop("_id", None)
        return active
    else:
        await db.entitlements.insert_one(doc)
        doc.pop("_id", None)
        return doc


async def audit(db, event: str, actor: dict, target: Optional[dict] = None,
                extra: Optional[dict] = None):
    await db.subscription_audit.insert_one({
        "id": str(uuid.uuid4()),
        "event": event,
        "actor_id": (actor or {}).get("id"),
        "actor_role": (actor or {}).get("role"),
        "actor_email": (actor or {}).get("email"),
        "target": target or {},
        "extra": extra or {},
        "at": datetime.now(timezone.utc).isoformat(),
    })


async def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    """HMAC-SHA256 over the raw request body with the webhook secret.

    Returns False on any error — endpoint MUST fail-closed with 403.
    """
    if not WEBHOOK_SECRET or not signature:
        return False
    try:
        expected = hmac.new(WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)
    except Exception:  # noqa: BLE001
        return False


def verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """HMAC-SHA256 over `order_id|payment_id` with the API Key Secret."""
    if not KEY_SECRET:
        return False
    try:
        expected = hmac.new(KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(),
                            hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)
    except Exception:  # noqa: BLE001
        return False


def require_module(module: str):
    """FastAPI dependency factory. Denies with 403 if the caller's company
    lacks an active entitlement for `module`. Admins always pass.

    NOTE: this dependency reads `db` and `get_current_user` from server.py
    via the wrapper injected in server.py; the wiring lives there so we can
    keep this file free of circular imports.
    """
    return module  # Actual check is wired in server.py; sentinel returned here.
