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

GST_RATE_PCT = 18  # India — flat rate applied on subtotal (post-discount).

# ---- Staff-tier base plans ---------------------------------------------------
# Every subscription starts with a base plan (HR + core Attendance + core Staff
# management included). Features & addons stack on top. Prices are in paise.
DEFAULT_PLANS: list[dict] = [
    {"code": "plan_5",   "name": "Starter · 5 Staff",       "staff_limit": 5,        "price_paise": 49900,   "sort": 10},
    {"code": "plan_10",  "name": "Basic · 10 Staff",         "staff_limit": 10,       "price_paise": 89900,   "sort": 20},
    {"code": "plan_20",  "name": "Growth · 20 Staff",        "staff_limit": 20,       "price_paise": 149900,  "sort": 30},
    {"code": "plan_50",  "name": "Team · 50 Staff",          "staff_limit": 50,       "price_paise": 299900,  "sort": 40},
    {"code": "plan_100", "name": "Business · 100 Staff",     "staff_limit": 100,      "price_paise": 499900,  "sort": 50},
    {"code": "plan_200", "name": "Enterprise · 200 Staff",   "staff_limit": 200,      "price_paise": 899900,  "sort": 60},
    {"code": "plan_500", "name": "Scale · 500 Staff",        "staff_limit": 500,      "price_paise": 1999900, "sort": 70},
    {"code": "plan_unl", "name": "Unlimited Staff",          "staff_limit": 999999,   "price_paise": 4999900, "sort": 80},
]

# ---- Premium features (stackable on top of the base plan) --------------------
DEFAULT_FEATURES: list[dict] = [
    {"code": "payroll",       "name": "Payroll",                     "description": "Monthly payroll, approval chain, disbursements",  "price_paise": 69900},
    {"code": "attendance",    "name": "Attendance Pro",              "description": "GPS check-in, selfies, geofencing, monthly reports","price_paise": 49900},
    {"code": "approvals",     "name": "Approval Workflows",          "description": "Multi-level approval engine + audit trail",         "price_paise": 29900},
    {"code": "bank_guarantee","name": "Bank Guarantee",              "description": "BG tracking + expiry alerts + renewals",            "price_paise": 39900},
    {"code": "notifications", "name": "SMS & WhatsApp",              "description": "Twilio-powered SMS + WhatsApp notifications",       "price_paise": 24900},
    {"code": "mis",           "name": "MIS Dashboard",               "description": "Cross-module KPI dashboards + exports",             "price_paise": 59900},
    {"code": "finance",       "name": "Finance & Accounting",        "description": "Transactions, Vendor Bills, Bank Reconciliation",   "price_paise": 79900},
    {"code": "reports",       "name": "Advanced Reports & Exports",  "description": "Custom CSV / PDF reporting + auto-schedule",        "price_paise": 39900},
]

# ---- Add-ons (misc paid extras) ---------------------------------------------
DEFAULT_ADDONS: list[dict] = [
    {"code": "bgv",          "name": "Background Verification", "description": "Per-employee KYC + police + address check",  "price_paise": 19900, "unit": "per_staff",  "is_recurring": False},
    {"code": "gst_filing",   "name": "GST Filing Assist",       "description": "Monthly GST return preparation + upload",     "price_paise": 99900, "unit": "monthly",   "is_recurring": True},
    {"code": "priority",     "name": "Priority Support 24×7",   "description": "Dedicated support with 1-hour response SLA",  "price_paise": 149900,"unit": "monthly",   "is_recurring": True},
    {"code": "custom_domain","name": "Custom Domain",           "description": "Host portal on your own domain (SSL managed)","price_paise": 39900, "unit": "monthly",   "is_recurring": True},
    {"code": "data_vault",   "name": "Data Backup & Vault",     "description": "Daily encrypted backups with 90-day retention","price_paise": 49900, "unit": "monthly",   "is_recurring": True},
    {"code": "api_access",   "name": "API Access",              "description": "REST API tokens + webhook events",            "price_paise": 199900,"unit": "monthly",   "is_recurring": True},
]

# Legacy — kept for backwards compat with existing catalog docs.
DEFAULT_CATALOG: list[dict] = [
    {"module": f["code"], "name": f["name"], "description": f["description"], "price_paise": f["price_paise"]}
    for f in DEFAULT_FEATURES
]

# Modules that anyone with an account can access (never gated behind Razorpay).
FREE_MODULES = {"subscription", "auth", "profile"}
# Modules included in the base plan (HR is always covered by staff-limit plans).
BASE_PLAN_MODULES = {"hr"}


def is_configured() -> bool:
    return bool(razorpay and KEY_ID and KEY_SECRET)


_client = None


def get_client():
    global _client
    if _client is None and is_configured():
        _client = razorpay.Client(auth=(KEY_ID, KEY_SECRET))
    return _client


async def seed_catalog(db):
    """Idempotent: seed legacy catalog + plans + features + addons."""
    now = datetime.now(timezone.utc).isoformat()
    for row in DEFAULT_CATALOG:
        await db.subscription_catalog.update_one(
            {"module": row["module"]},
            {"$setOnInsert": {**row, "is_active": True, "created_at": now}},
            upsert=True,
        )
    for row in DEFAULT_PLANS:
        await db.subscription_plans.update_one(
            {"code": row["code"]},
            {"$setOnInsert": {**row, "is_active": True, "created_at": now}},
            upsert=True,
        )
    for row in DEFAULT_FEATURES:
        await db.subscription_features.update_one(
            {"code": row["code"]},
            {"$setOnInsert": {**row, "is_active": True, "created_at": now}},
            upsert=True,
        )
    for row in DEFAULT_ADDONS:
        await db.subscription_addons.update_one(
            {"code": row["code"]},
            {"$setOnInsert": {**row, "is_active": True, "created_at": now}},
            upsert=True,
        )


async def get_pricing_catalog(db) -> dict:
    """Everything the buyer needs to build a quote — plans / features / addons."""
    plans   = await db.subscription_plans.find({"is_active": True}, {"_id": 0}).sort("sort", 1).to_list(50)
    feats   = await db.subscription_features.find({"is_active": True}, {"_id": 0}).sort("price_paise", 1).to_list(50)
    addons  = await db.subscription_addons.find({"is_active": True}, {"_id": 0}).sort("price_paise", 1).to_list(50)
    return {"plans": plans, "features": feats, "addons": addons, "gst_rate_pct": GST_RATE_PCT}


async def get_catalog(db) -> list[dict]:
    rows = await db.subscription_catalog.find({"is_active": True}, {"_id": 0}).sort("price_paise", 1).to_list(50)
    return rows


async def validate_coupon(db, code: str, subtotal_paise: int) -> dict:
    """Return {ok, discount_paise, reason, coupon} — never raise."""
    if not code:
        return {"ok": False, "discount_paise": 0, "reason": "no_code"}
    row = await db.coupons.find_one({"code": code.upper().strip(), "is_active": True}, {"_id": 0})
    if not row:
        return {"ok": False, "discount_paise": 0, "reason": "not_found"}
    now = datetime.now(timezone.utc)
    if row.get("expires_at"):
        try:
            if datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) < now:
                return {"ok": False, "discount_paise": 0, "reason": "expired"}
        except Exception:  # noqa: BLE001
            pass
    if row.get("max_uses") and (row.get("used_count") or 0) >= row["max_uses"]:
        return {"ok": False, "discount_paise": 0, "reason": "max_uses_reached"}
    if row.get("min_subtotal_paise") and subtotal_paise < row["min_subtotal_paise"]:
        return {"ok": False, "discount_paise": 0, "reason": "min_subtotal_not_met",
                "coupon": row}
    if row.get("discount_pct"):
        disc = int(subtotal_paise * row["discount_pct"] // 100)
    else:
        disc = int(row.get("discount_paise") or 0)
    disc = min(disc, subtotal_paise)
    return {"ok": True, "discount_paise": disc, "reason": "ok", "coupon": row}


async def compute_quote(db, *, plan_code: str, feature_codes: list[str],
                        addon_codes: list[str], staff_count_for_bgv: int,
                        duration_months: int, coupon_code: Optional[str]) -> dict:
    """Server-authoritative price computation. Client is NEVER trusted with amounts.

    Returns a rich breakdown so the UI can render every line item + totals.
    """
    if duration_months < 1 or duration_months > 24:
        raise HTTPException(400, "duration_months must be between 1 and 24")

    plan_doc = await db.subscription_plans.find_one({"code": plan_code, "is_active": True}, {"_id": 0}) if plan_code else None
    if not plan_doc:
        raise HTTPException(400, "Invalid or missing plan_code")

    feature_docs = []
    if feature_codes:
        feature_docs = await db.subscription_features.find(
            {"code": {"$in": feature_codes}, "is_active": True}, {"_id": 0},
        ).to_list(50)
    addon_docs = []
    if addon_codes:
        addon_docs = await db.subscription_addons.find(
            {"code": {"$in": addon_codes}, "is_active": True}, {"_id": 0},
        ).to_list(50)

    line_items: list[dict] = []
    # Base plan — always recurring monthly, × duration.
    plan_total = plan_doc["price_paise"] * duration_months
    line_items.append({
        "kind": "plan", "code": plan_doc["code"], "name": plan_doc["name"],
        "unit_price_paise": plan_doc["price_paise"], "qty": duration_months,
        "total_paise": plan_total, "meta": {"staff_limit": plan_doc["staff_limit"]},
    })
    # Features — recurring monthly, × duration.
    for f in feature_docs:
        t = f["price_paise"] * duration_months
        line_items.append({
            "kind": "feature", "code": f["code"], "name": f["name"],
            "unit_price_paise": f["price_paise"], "qty": duration_months,
            "total_paise": t, "meta": {},
        })
    # Addons — either recurring monthly × duration or one-off per_staff.
    for a in addon_docs:
        if a.get("unit") == "per_staff":
            qty = max(1, int(staff_count_for_bgv or 1))
            t = a["price_paise"] * qty
            line_items.append({
                "kind": "addon", "code": a["code"], "name": a["name"],
                "unit_price_paise": a["price_paise"], "qty": qty,
                "total_paise": t, "meta": {"unit": "per_staff"},
            })
        else:
            t = a["price_paise"] * duration_months
            line_items.append({
                "kind": "addon", "code": a["code"], "name": a["name"],
                "unit_price_paise": a["price_paise"], "qty": duration_months,
                "total_paise": t, "meta": {"unit": "monthly"},
            })

    subtotal = sum(li["total_paise"] for li in line_items)
    coupon_res = await validate_coupon(db, coupon_code or "", subtotal)
    discount = coupon_res["discount_paise"] if coupon_res["ok"] else 0
    taxable = max(0, subtotal - discount)
    gst = int(round(taxable * GST_RATE_PCT / 100))
    grand_total = taxable + gst

    return {
        "line_items": line_items,
        "subtotal_paise": subtotal,
        "discount_paise": discount,
        "coupon_status": {"code": (coupon_code or "").upper().strip(), "ok": coupon_res["ok"], "reason": coupon_res["reason"]},
        "gst_rate_pct": GST_RATE_PCT,
        "gst_paise": gst,
        "grand_total_paise": grand_total,
        "duration_months": duration_months,
        "plan_code": plan_doc["code"],
        "staff_limit": plan_doc["staff_limit"],
        "feature_codes": [f["code"] for f in feature_docs],
        "addon_codes": [a["code"] for a in addon_docs],
    }


async def apply_bundle_entitlements(db, company_id: str, *, plan_code: str,
                                    staff_limit: int, feature_codes: list[str],
                                    duration_months: int, order_id: str, payment_id: str):
    """After payment capture: activate all modules the buyer selected.

    Base plan → grants `hr` (BASE_PLAN_MODULES). Features → each feature code
    becomes its own entitlement. Addons are tracked on the bundle doc for
    ops visibility but don't gate modules directly.
    """
    modules_to_grant = list(BASE_PLAN_MODULES | set(feature_codes or []))
    ents = []
    for m in modules_to_grant:
        ent = await _extend_or_create_entitlement(
            db, company_id, m, duration_months, order_id, payment_id,
        )
        ents.append(ent)
    return ents


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
