from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import re
import csv
import uuid
import asyncio
import logging
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId as _BsonObjectId

logger = logging.getLogger(__name__)


def _json_safe(obj):
    """Recursively convert Mongo ObjectId → str inside nested dict/list so the
    doc is safely JSON-serialisable by FastAPI. Also strips top-level and any
    nested `_id` keys. Idempotent for already-clean payloads."""
    if isinstance(obj, _BsonObjectId):
        return str(obj)
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items() if k != "_id"}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, tuple):
        return [_json_safe(v) for v in obj]
    return obj


# ---------- DB ----------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]


# ---------- App ----------
app = FastAPI(title="Finance Tracker API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
log = logging.getLogger("finance")


# ---------- Auth helpers ----------
JWT_ALG = "HS256"


def jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, jwt_secret(), algorithm=JWT_ALG)


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=12 * 3600,
        path="/",
    )


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(*roles: str):
    async def dep(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return dep


# ---- Finance Visibility Gate -------------------------------------------------
# Roles allowed to see investments / income / expense / profit-loss / TDS / milestone income.
# Other roles (center_manager, center_staff, manager, viewer, reporting_authority, center_partner)
# get a 403 on any financial endpoint. Operational endpoints (attendance, leave, staff, stock)
# remain accessible.
FINANCE_VISIBLE_ROLES = {"admin", "partner", "senior_manager", "hr", "accountant"}


def require_finance_visible(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in FINANCE_VISIBLE_ROLES:
        raise HTTPException(status_code=403, detail="Financial data is restricted for your role")
    return user


# ---------- Models ----------
ROLE_LITERAL = Literal["admin", "manager", "senior_manager", "center_manager", "center_staff", "partner", "accountant", "hr", "viewer", "reporting_authority", "center_partner"]


class UserOut(BaseModel):
    id: str
    # Use plain str here (not EmailStr) — register/login already validate format via EmailStr.
    # Some legacy test/seed users have RFC-6761 reserved TLDs (.local/.test) which pydantic 2.x
    # rejects, and we don't want a single bad row to crash GET /auth/users.
    email: str
    name: str
    role: str
    assigned_center_ids: List[str] = Field(default_factory=list)
    assigned_partner_id: Optional[str] = None


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: ROLE_LITERAL = "viewer"


class UserUpdateIn(BaseModel):
    role: Optional[ROLE_LITERAL] = None
    assigned_center_ids: Optional[List[str]] = None
    assigned_partner_id: Optional[str] = None
    name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ForgotPwdIn(BaseModel):
    email: EmailStr


class VerifyOtpIn(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)


class ResetPwdIn(BaseModel):
    reset_token: str
    new_password: str = Field(min_length=6)


class PartnerAssociationIn(BaseModel):
    partner_a_id: str
    partner_b_id: str


class PartnerAssociationOut(BaseModel):
    id: str
    partner_a_id: str
    partner_b_id: str
    created_at: str
    created_by: Optional[str] = None

class EntityIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    description: Optional[str] = ""
    # ===== Common optional fields (any subset, depending on etype) =====
    # All optional — front-end decides which to show based on etype.
    email: Optional[str] = None           # Login id for partner / center manager
    mobile: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    # ----- Company -----
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    cin_number: Optional[str] = None
    registration_number: Optional[str] = None
    logo_url: Optional[str] = None
    # ----- Center -----
    manager_name: Optional[str] = None    # Center manager name (creates auto user)
    # ----- Project -----
    project_type: Optional[str] = None    # ID from project_types collection (JSDMS/SJKVY/BIRSA/...)
    project_code: Optional[str] = None
    funding_agency: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    # ----- Auto-created user reference (set by backend, not by client) -----
    linked_user_id: Optional[str] = None


class EntityOut(EntityIn):
    model_config = ConfigDict(extra="allow")
    id: str
    type: str
    created_at: str
    # When backend auto-creates a user (center manager / partner login), return the
    # plain-text password ONCE on POST response so admin can copy + share.
    # Stored hashed in DB; this field is never persisted on the entity doc.
    generated_password: Optional[str] = None
    # Mail-send audit fields (persisted)
    credentials_mail_sent: Optional[bool] = None
    credentials_mail_at: Optional[str] = None
    credentials_mail_error: Optional[str] = None
    credentials_mail_id: Optional[str] = None


EntityType = Literal["company", "partner", "center", "project"]
TxnType = Literal["investment", "income", "expense"]


class TransactionItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    quantity: float = Field(default=1, ge=0)
    rate: float = Field(default=0, ge=0)
    amount: float = Field(ge=0)


class AttachmentRef(BaseModel):
    id: str
    path: str
    filename: str
    content_type: str
    size: int


class TransactionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: TxnType
    amount: float = Field(gt=0)
    date: str  # ISO YYYY-MM-DD
    description: Optional[str] = ""
    company_id: Optional[str] = None
    partner_id: Optional[str] = None
    center_id: Optional[str] = None
    project_id: Optional[str] = None
    items: List[TransactionItem] = Field(default_factory=list)
    attachments: List[AttachmentRef] = Field(default_factory=list)
    source: Optional[str] = None        # e.g. "milestone" when auto-created from Programs
    milestone: Optional[str] = None     # "1st" | "2nd" | "3rd" when source == "milestone"
    # Populated when the txn was auto-created from an approved payment against a quotation
    qrn: Optional[str] = None
    quotation_id: Optional[str] = None
    payment_id: Optional[str] = None


TxnStatus = Literal["pending", "approved", "rejected"]


class TransactionOut(TransactionIn):
    # Override: output tolerates amount >= 0 (historical/edge-case data; input still enforces > 0)
    amount: float = Field(ge=0)
    id: str
    created_by: str
    created_at: str
    status: TxnStatus = "pending"
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    approval_via: Optional[str] = None  # "partner_cross" when cross-approved by associated partner
    approval_reason: Optional[str] = None
    rejected_reason: Optional[str] = None


class RejectIn(BaseModel):
    reason: Optional[str] = ""


# ============================================================================
# Approval Chains — configurable multi-level approval workflows
# ============================================================================
ApprovalType = Literal["reimbursement", "leave", "transaction", "asset_purchase", "employee_transfer", "regularisation", "quotation", "payment"]
ApproverKind = Literal["role", "staff", "user", "reports_to"]

# Central mapping from approval-type → backing collection. Used by /approvals/act, /approvals/pending,
# /approvals/{type}/{id}/nudge and /approvals/{type}/{id}/timeline. When adding a new approval type
# update this single dict and the chain seeder below — no further plumbing required.
APPROVAL_TYPE_COLL: dict = {
    "reimbursement":     "reimbursements",
    "leave":             "leaves",
    "transaction":       "transactions",
    "asset_purchase":    "asset_purchase_requests",
    "employee_transfer": "employee_transfers",
    "regularisation":    "regularisations",
    "quotation":         "quotations",
    "payment":           "payments",
}


class ApprovalStep(BaseModel):
    """One level in an approval chain.

    kind / value semantics:
      - role          → value = role name (e.g. "manager"); any user with that role may approve
      - staff         → value = staff.id (their linked user_id approves)
      - user          → value = user.id (specific person)
      - reports_to    → value = depth-int as string ("1"=direct manager, "2"=grand-manager)
                        resolved dynamically from the submitter's staff.reports_to chain
    """
    level: int = Field(ge=1)
    kind: ApproverKind
    value: str
    label: Optional[str] = None
    optional: bool = False  # if approver can't be resolved, skip this level


class ApprovalChainIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    type: ApprovalType
    # Center-scoped chain: if set, ONLY requests on this center route through it.
    # Multiple active chains allowed per type AS LONG AS each has a distinct center_id.
    # A chain with center_id=None is the global default fallback for centers without a specific chain.
    center_id: Optional[str] = None
    steps: List[ApprovalStep] = Field(default_factory=list)
    active: bool = True


class ApprovalChainOut(ApprovalChainIn):
    id: str
    created_at: str
    created_by: Optional[str] = None


class ApprovalActionIn(BaseModel):
    request_type: ApprovalType
    request_id: str
    action: Literal["approve", "reject"]
    remarks: str = Field(min_length=3, description="Mandatory note explaining the decision (min 3 chars)")


def _txn_scope_for_user(user: dict) -> dict:
    """Return Mongo query filter restricting transactions to user's scope.

    - admin / manager / senior_manager / accountant / hr: all transactions
    - center_manager / center_staff: only transactions where center_id is in their assigned_center_ids
    - partner: scoped to centers where this partner is mapped via batches/center.partner_id
              (i.e. partner X at center A also sees co-partner Y's txns at A, but NOT Y's txns elsewhere)
    - viewer: only their own created transactions

    The caller MUST ensure `_associated_center_ids` is populated on the user (via
    `_enrich_user_with_associations`) when the role is partner — otherwise the
    legacy partner-id-based filter is used as a safe fallback.
    """
    role = user.get("role")
    if role in ("admin", "manager", "senior_manager", "accountant", "hr"):
        return {}
    if role in ("center_manager", "center_staff"):
        return {"center_id": {"$in": user.get("assigned_center_ids") or []}}
    if role == "partner":
        pid = user.get("assigned_partner_id")
        if not pid:
            return {"_never_": True}
        # NEW: center-based scoping. A partner sees everything that happens at the centers
        # where they are mapped. This matches the user's mental model: "X is partnered at
        # Center A and Center B → X sees all of A and B".
        center_ids = user.get("_associated_center_ids")
        if center_ids is not None:
            if not center_ids:
                # Mapped to a partner but not yet linked to any center → show nothing.
                return {"_never_": True}
            return {"center_id": {"$in": center_ids}}
        # Fallback (should not normally happen): partner-id-based filter retained for safety
        extras = user.get("_associated_partner_ids") or []
        all_pids = list({pid, *extras})
        return {"partner_id": {"$in": all_pids}}
    # viewer / any other → own data only
    return {"created_by": user["id"]}


async def _centers_for_partner(partner_id: str) -> list:
    """Compute the set of center_ids where the given partner is mapped.

    Sources (combined):
      1. `batches.partner_ids` containing this partner_id (both center_id+partner_ids set)
      2. Legacy single-partner centers (`centers.partner_id == partner_id`)
      3. Any approved transaction where partner_id matches and center_id is set
         (covers cases where the partner-center linkage exists only in txn history)
    Result: a de-duplicated list (order not guaranteed).
    """
    if not partner_id:
        return []
    centers: set = set()
    async for b in db.batches.find(
        {"partner_ids": partner_id, "center_id": {"$ne": None}},
        {"_id": 0, "center_id": 1},
    ):
        if b.get("center_id"):
            centers.add(b["center_id"])
    async for c in db.centers.find(
        {"partner_id": partner_id},
        {"_id": 0, "id": 1},
    ):
        if c.get("id"):
            centers.add(c["id"])
    # Source #3: derive from transactions where this partner has actually transacted at a center.
    # This covers data where batch.center_id is None but the partner has center-level txn history.
    txn_centers = await db.transactions.distinct(
        "center_id",
        {"partner_id": partner_id, "center_id": {"$ne": None}},
    )
    centers.update([c for c in txn_centers if c])
    return list(centers)


async def _derive_context_for_center(center_id: Optional[str]) -> dict:
    """Return a best-effort `{company_id, partner_id, project_id}` for a center.

    Used by auto-created transactions (reimbursements, payroll, asset purchases,
    milestone recovery / assessment fees) so they aren't left with dangling `—`
    in the transactions list.

    Resolution order:
      1. From the center's batches — company_id (most-common) + single-partner batches
      2. Fallback to legacy `centers.partner_id`
      3. Fallback to most-common company_id / partner_id across APPROVED transactions
         that already exist at this center (bootstraps from historical manual entries).
    """
    if not center_id:
        return {"company_id": None, "partner_id": None, "project_id": None}
    company_id = None
    partner_id = None
    from collections import Counter
    companies: Counter = Counter()
    partners: set = set()
    async for b in db.batches.find(
        {"center_id": center_id},
        {"_id": 0, "company_id": 1, "partner_ids": 1},
    ):
        if b.get("company_id"):
            companies[b["company_id"]] += 1
        for pid in (b.get("partner_ids") or []):
            partners.add(pid)
    if companies:
        company_id = companies.most_common(1)[0][0]
    if len(partners) == 1:
        partner_id = next(iter(partners))
    else:
        c = await db.centers.find_one({"id": center_id}, {"_id": 0, "partner_id": 1, "company_id": 1})
        if c and c.get("partner_id"):
            partner_id = c["partner_id"]
        # Center may also carry a direct company_id override (allowed via ConfigDict(extra=allow))
        if not company_id and c and c.get("company_id"):
            company_id = c["company_id"]

    # Bootstrap from existing txn history when still unresolved
    if not company_id:
        rows = await db.transactions.aggregate([
            {"$match": {"center_id": center_id, "company_id": {"$ne": None}}},
            {"$group": {"_id": "$company_id", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": 1},
        ]).to_list(1)
        if rows:
            company_id = rows[0]["_id"]
    if not partner_id:
        rows = await db.transactions.aggregate([
            {"$match": {"center_id": center_id, "partner_id": {"$ne": None}}},
            {"$group": {"_id": "$partner_id", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": 1},
        ]).to_list(1)
        if rows:
            partner_id = rows[0]["_id"]

    return {"company_id": company_id, "partner_id": partner_id, "project_id": None}


async def _enrich_user_with_associations(user: dict) -> dict:
    """Mutates `user` to add `_associated_partner_ids` for partner-role users.
    Called inside endpoints that filter txns by scope so cross-partner approvals work."""
    if user.get("role") != "partner":
        return user
    pid = user.get("assigned_partner_id")
    if not pid or user.get("_associated_partner_ids") is not None:
        return user
    peers: set = await _custom_associated_partners(pid)
    # Also include partners sharing project/center on existing transactions
    own_txns = await db.transactions.find(
        {"partner_id": pid},
        {"_id": 0, "project_id": 1, "center_id": 1},
    ).to_list(2000)
    proj_ids = {t.get("project_id") for t in own_txns if t.get("project_id")}
    center_ids = {t.get("center_id") for t in own_txns if t.get("center_id")}
    if proj_ids or center_ids:
        or_clauses = []
        if proj_ids:
            or_clauses.append({"project_id": {"$in": list(proj_ids)}})
        if center_ids:
            or_clauses.append({"center_id": {"$in": list(center_ids)}})
        peer_txns = await db.transactions.find(
            {"partner_id": {"$ne": pid, "$nin": [None]}, "$or": or_clauses},
            {"_id": 0, "partner_id": 1},
        ).to_list(5000)
        for t in peer_txns:
            if t.get("partner_id"):
                peers.add(t["partner_id"])
    user["_associated_partner_ids"] = list(peers)
    # Also compute the set of centers where THIS partner is mapped (via batches or
    # legacy centers.partner_id). Used by _txn_scope_for_user + dashboards so a
    # partner sees only their own centers' data — including co-partners' txns at
    # those centers, but NOT the co-partner's other-center txns.
    user["_associated_center_ids"] = await _centers_for_partner(pid)
    return user


def _can_auto_approve(user: dict) -> bool:
    return user.get("role") == "admin"


# ---------- Startup ----------
async def _ensure_libreoffice_installed() -> None:
    """Background best-effort install of libreoffice-writer + core.

    Emergent's deploy image ships without LibreOffice, so offer letters would
    otherwise always be delivered as .docx. This helper attempts a silent
    `apt-get install` on first boot; it never raises and is safe to no-op on
    systems without apt / root privileges. Once soffice becomes available,
    `offer_letter._find_soffice()` picks it up on the next render call — no
    restart needed.
    """
    import shutil as _shutil
    if _shutil.which("soffice") or _shutil.which("libreoffice"):
        return
    if not _shutil.which("apt-get"):
        logger.info("LibreOffice not present and apt-get unavailable — offer letters will be delivered as .docx")
        return
    try:
        proc = await asyncio.create_subprocess_exec(
            "apt-get", "install", "-y", "--no-install-recommends",
            "libreoffice-writer", "libreoffice-core",
            env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            _stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)
        except asyncio.TimeoutError:
            proc.kill()
            logger.warning("LibreOffice apt install timed out — offer letters continue as .docx fallback")
            return
        if proc.returncode == 0 and (_shutil.which("soffice") or _shutil.which("libreoffice")):
            logger.info("LibreOffice installed successfully — offer letters will now deliver as PDF")
        else:
            logger.warning("LibreOffice install exit=%s stderr=%s — offer letters continue as .docx fallback",
                           proc.returncode, (stderr or b"")[:400].decode(errors="ignore"))
    except Exception as e:
        logger.info("LibreOffice auto-install skipped: %s — offer letters continue as .docx fallback", e)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    for col in ("companies", "partners", "centers", "projects", "transactions", "staff", "attendance", "leaves", "reimbursements", "payroll", "notifications", "batches", "batch_payments", "fooding_entries", "approval_chains", "holidays", "geofences", "shifts", "regularisations", "staff_documents", "assets", "asset_purchase_requests", "asset_transfers", "employee_transfers", "leave_types", "leave_balances", "offer_letter_templates", "offer_letters", "quotations", "payments", "qrn_counters", "vendors"):
        await db[col].create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.batches.create_index([("project_id", 1), ("center_id", 1)])
    await db.batch_payments.create_index([("batch_id", 1), ("milestone", 1)])
    await db.approval_chains.create_index([("type", 1), ("active", 1)])
    await db.holidays.create_index("date")
    await db.geofences.create_index([("center_id", 1), ("active", 1)])
    await db.regularisations.create_index([("created_by", 1), ("status", 1)])
    await db.staff_documents.create_index([("staff_id", 1), ("uploaded_at", -1)])
    # Password reset OTPs — TTL on expires_at (auto-purge expired docs)
    await db.password_reset_otps.create_index("email")
    await db.password_reset_otps.create_index("expires_at", expireAfterSeconds=0)
    # Partner cross-approval associations
    await db.partner_associations.create_index("id", unique=True)
    await db.partner_associations.create_index([("partner_a_id", 1), ("partner_b_id", 1)], unique=True)
    # Leave allocation indices (seeder runs lazily on first GET /leave-types)
    await db.leave_types.create_index("code", unique=True)
    await db.leave_balances.create_index([("staff_id", 1), ("leave_type_id", 1), ("year", 1)], unique=True)
    # Quotation / Payment indices — QRN is unique per center (compound with center_id
    # so two centers whose slug prefix happens to collide can each independently
    # generate `PALOJORI-QRN-0001` without a duplicate-key error).
    # Migration: drop legacy global-unique qrn_1 index if it exists (iter-34 first-cut).
    # ALSO drop the earlier compound sparse index `qrn_1_center_id_1` — sparse on
    # a compound index only skips when ALL indexed fields are missing, so with
    # center_id always present, the sparse flag was inert and multiple pending
    # quotations (all with qrn absent) collided on `{qrn:null, center_id:X}`.
    # Replace it with a partial-filter unique index that ONLY enforces uniqueness
    # once qrn has been stamped as a string on final approval.
    try:
        idx = await db.quotations.index_information()
        if "qrn_1" in idx:
            await db.quotations.drop_index("qrn_1")
        if "qrn_1_center_id_1" in idx:
            await db.quotations.drop_index("qrn_1_center_id_1")
    except Exception:
        pass
    await db.quotations.create_index(
        [("qrn", 1), ("center_id", 1)],
        unique=True,
        partialFilterExpression={"qrn": {"$type": "string"}},
        name="qrn_center_unique_when_stamped",
    )
    await db.quotations.create_index([("center_id", 1), ("status", 1)])
    await db.payments.create_index([("quotation_id", 1)])
    await db.payments.create_index([("center_id", 1), ("status", 1)])
    await db.qrn_counters.create_index("center_id", unique=True)

    # Best-effort LibreOffice install for the offer-letter PDF pipeline. Runs
    # in the background so it never blocks startup; when it finishes, offer
    # letters will start delivering as PDF automatically. If apt isn't present
    # or the install fails, the offer-letter service already falls back to
    # emailing the rendered .docx instead — no user-facing failure either way.
    asyncio.create_task(_ensure_libreoffice_installed())

    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_pwd = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_pwd),
            "name": "Admin",
            "role": "admin",
            "assigned_center_ids": [],
            "assigned_partner_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        log.info("Seeded admin user")
    elif not verify_password(admin_pwd, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pwd)}})

    # Backfill new fields on existing docs (idempotent migration)
    await db.users.update_many(
        {"assigned_center_ids": {"$exists": False}},
        {"$set": {"assigned_center_ids": [], "assigned_partner_id": None}},
    )
    await db.transactions.update_many(
        {"status": {"$exists": False}},
        {"$set": {"status": "approved", "approved_by": None, "approved_at": None, "rejected_reason": None, "items": [], "attachments": []}},
    )

    # Seed default approval chains (idempotent)
    await _seed_default_chains()


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


# ---------- Object Storage ----------
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
APP_STORAGE_PREFIX = os.environ.get("APP_STORAGE_PREFIX", "finance-tracker")
_storage_key: Optional[str] = None


def _init_storage() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        raise HTTPException(500, "Object storage not configured (EMERGENT_LLM_KEY missing)")
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    return _storage_key


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    key = _init_storage()
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if r.status_code == 403:
        # refresh key once
        globals()["_storage_key"] = None
        key = _init_storage()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    r.raise_for_status()
    return r.json()


def _get_object(path: str) -> tuple[bytes, str]:
    key = _init_storage()
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if r.status_code == 403:
        globals()["_storage_key"] = None
        key = _init_storage()
        r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


@api.post("/files/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
    if len(ext) > 10:
        ext = "bin"
    file_id = str(uuid.uuid4())
    path = f"{APP_STORAGE_PREFIX}/uploads/{user['id']}/{file_id}.{ext}"
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 10MB)")
    content_type = file.content_type or "application/octet-stream"
    try:
        result = _put_object(path, data, content_type)
    except requests.HTTPError as e:
        raise HTTPException(502, f"Storage upload failed: {e}")
    ref = {
        "id": file_id,
        "path": result.get("path", path),
        "filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": user["id"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "is_deleted": False,
    }
    await db.files.insert_one(ref)
    return {k: ref[k] for k in ("id", "path", "filename", "content_type", "size")}


@api.get("/files/view")
async def view_file(
    path: str = Query(...),
    auth: Optional[str] = Query(None),
    request: Request = None,
):
    # Allow either cookie OR ?auth=<jwt> for direct img/iframe display
    token = request.cookies.get("access_token") if request else None
    if not token and auth:
        token = auth
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        jwt.decode(token, jwt_secret(), algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    rec = await db.files.find_one({"path": path, "is_deleted": False})
    if not rec:
        raise HTTPException(404, "File not found")
    try:
        data, ct = _get_object(path)
    except requests.HTTPError as e:
        raise HTTPException(502, f"Storage fetch failed: {e}")
    return Response(content=data, media_type=rec.get("content_type", ct))


# ---------- Offer Letter Templates ----------
class OfferLetterTemplateOut(BaseModel):
    id: str
    company_id: Optional[str] = None
    company_name: Optional[str] = None
    filename: str
    file_path: str  # object-storage path to the source DOCX
    uploaded_by: Optional[str] = None
    uploaded_by_name: Optional[str] = None
    uploaded_at: str
    is_active: bool = True


@api.post("/offer-letter-templates", response_model=OfferLetterTemplateOut, status_code=201)
async def upload_offer_letter_template(
    file: UploadFile = File(...),
    company_id: Optional[str] = Query(None),
    user=Depends(require_role("admin", "hr")),
):
    """Upload a `.docx` offer-letter template. Optionally scope to a company —
    if a template is uploaded per company, `create_staff` will pick the template
    matching the staff's center's Default Company automatically.

    Only ONE template per company is active at a time — uploading a new template
    for the same company deactivates the previous one.
    """
    if not file.filename or not file.filename.lower().endswith(".docx"):
        raise HTTPException(400, "Only .docx files are accepted")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Template too large (max 5MB)")
    if company_id:
        c = await db.companies.find_one({"id": company_id}, {"_id": 0, "name": 1})
        if not c:
            raise HTTPException(404, "Company not found")
        company_name = c.get("name")
    else:
        company_name = None
    tid = str(uuid.uuid4())
    path = f"{APP_STORAGE_PREFIX}/offer-letter-templates/{tid}.docx"
    try:
        _put_object(path, data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    except requests.HTTPError as e:
        raise HTTPException(502, f"Storage upload failed: {e}")
    # Deactivate any existing templates for the same company
    if company_id:
        await db.offer_letter_templates.update_many(
            {"company_id": company_id, "is_active": True},
            {"$set": {"is_active": False}},
        )
    else:
        # Global default template — deactivate previous global default
        await db.offer_letter_templates.update_many(
            {"company_id": None, "is_active": True},
            {"$set": {"is_active": False}},
        )
    doc = {
        "id": tid,
        "company_id": company_id,
        "company_name": company_name,
        "filename": file.filename,
        "file_path": path,
        "uploaded_by": user["id"],
        "uploaded_by_name": user.get("name") or user.get("email"),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
    }
    await db.offer_letter_templates.insert_one(doc)
    return OfferLetterTemplateOut(**doc)


@api.get("/offer-letter-templates", response_model=List[OfferLetterTemplateOut])
async def list_offer_letter_templates(_=Depends(require_role("admin", "hr", "manager"))):
    docs = await db.offer_letter_templates.find({}, {"_id": 0}).sort("uploaded_at", -1).to_list(500)
    return [OfferLetterTemplateOut(**d) for d in docs]


@api.delete("/offer-letter-templates/{tid}", status_code=204)
async def delete_offer_letter_template(tid: str, _=Depends(require_role("admin"))):
    r = await db.offer_letter_templates.delete_one({"id": tid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Template not found")
    return None


async def _resolve_offer_letter_template(company_id: Optional[str]) -> Optional[dict]:
    """Return the active template for the given company_id, falling back to the
    global default (`company_id: None`)."""
    if company_id:
        tpl = await db.offer_letter_templates.find_one(
            {"company_id": company_id, "is_active": True}, {"_id": 0},
        )
        if tpl:
            return tpl
    return await db.offer_letter_templates.find_one(
        {"company_id": None, "is_active": True}, {"_id": 0},
    )


async def _generate_and_deliver_offer_letter(staff: dict, login_email: str,
                                             login_password: Optional[str]) -> dict:
    """Render the offer-letter PDF for a staff record, upload to storage, mail
    to the staff, and persist the reference. Returns an audit dict.

    Called from `create_staff` (when `send_offer_letter=True`) and from the
    manual /staff/{sid}/send-offer-letter regenerate endpoint.
    """
    from offer_letter import render_offer_letter, send_offer_letter_email
    result = {"generated": False, "emailed": False, "reason": None,
              "pdf_path": None, "letter_id": None}
    if not login_email:
        result["reason"] = "staff_has_no_email"
        return result
    # Resolve center → company via the same auto-derive logic used for txns
    ctx = await _derive_context_for_center(staff.get("center_id"))
    company_id = ctx.get("company_id")
    company = await db.companies.find_one({"id": company_id}, {"_id": 0}) if company_id else None
    center = await db.centers.find_one({"id": staff.get("center_id")}, {"_id": 0}) if staff.get("center_id") else None
    tpl = await _resolve_offer_letter_template(company_id)
    if not tpl:
        result["reason"] = "no_template_uploaded"
        return result
    # Load the template bytes
    try:
        template_bytes, _ = _get_object(tpl["file_path"])
    except Exception as e:
        result["reason"] = f"template_fetch_failed: {str(e)[:120]}"
        return result
    # Render → PDF/DOCX bytes
    try:
        letter_bytes, content_type, ext = render_offer_letter(
            template_bytes=template_bytes, staff=staff, company=company or {},
            center=center, login_email=login_email, login_password=login_password,
        )
    except Exception as e:
        logger.exception("Offer letter render failed for staff %s", staff.get("id"))
        result["reason"] = f"render_failed: {str(e)[:200]}"
        return result
    # Upload to object storage (extension reflects whether PDF or DOCX fallback)
    letter_id = str(uuid.uuid4())
    file_path = f"{APP_STORAGE_PREFIX}/offer-letters/{letter_id}.{ext}"
    try:
        _put_object(file_path, letter_bytes, content_type)
    except Exception as e:
        result["reason"] = f"upload_failed: {str(e)[:120]}"
        return result
    # Persist ledger row
    safe_name = (staff.get('name') or 'staff').replace(' ', '_')
    letter_doc = {
        "id": letter_id,
        "staff_id": staff.get("id"),
        "staff_name": staff.get("name"),
        "staff_email": login_email,
        "company_id": company_id,
        "company_name": (company or {}).get("name"),
        "center_id": staff.get("center_id"),
        "template_id": tpl["id"],
        "pdf_path": file_path,  # kept for backwards-compat; may be a .docx path now
        "content_type": content_type,
        "extension": ext,
        "filename": f"OfferLetter_{safe_name}.{ext}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.offer_letters.insert_one(letter_doc)
    # Update staff record with the latest offer letter reference
    await db.staff.update_one(
        {"id": staff.get("id")},
        {"$set": {
            "offer_letter_url": file_path,
            "offer_letter_id": letter_id,
            "offer_letter_generated_at": letter_doc["generated_at"],
        }},
    )
    result["generated"] = True
    result["pdf_path"] = file_path
    result["letter_id"] = letter_id
    result["extension"] = ext
    # Email delivery
    mail = await send_offer_letter_email(
        to_email=login_email, name=staff.get("name") or login_email.split("@")[0],
        letter_bytes=letter_bytes, filename=letter_doc["filename"],
        company_name=(company or {}).get("name") or "Mashara Skills and Creative Learning Pvt Ltd",
        content_type=content_type,
    )
    result["emailed"] = bool(mail.get("sent"))
    if not mail.get("sent"):
        result["reason"] = f"email_failed: {mail.get('reason','unknown')}"
        await db.offer_letters.update_one(
            {"id": letter_id}, {"$set": {"email_error": mail.get("reason")}},
        )
    else:
        await db.offer_letters.update_one(
            {"id": letter_id}, {"$set": {"email_id": mail.get("id"), "emailed_at": datetime.now(timezone.utc).isoformat()}},
        )
    return result


# ---------- Auth Routes ----------
@api.post("/auth/register", response_model=UserOut)
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": body.role if body.role != "admin" else "viewer",  # self-register cannot become admin
        "assigned_center_ids": [],
        "assigned_partner_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user)
    token = create_access_token(user["id"], user["email"])
    set_auth_cookie(response, token)
    return UserOut(**user)


@api.post("/auth/login", response_model=UserOut)
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    ip = (request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip") or
          (request.client.host if request.client else None) or "unknown")
    ua = request.headers.get("user-agent", "")[:300]
    now = datetime.now(timezone.utc).isoformat()
    if not user or not verify_password(body.password, user["password_hash"]):
        # Record failed attempt (admin can review brute-force attempts)
        await db.login_logs.insert_one({
            "id": str(uuid.uuid4()), "email": email, "user_id": None,
            "success": False, "ip": ip, "user_agent": ua, "at": now,
            "reason": "invalid_credentials",
        })
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"])
    set_auth_cookie(response, token)
    # Record success
    await db.login_logs.insert_one({
        "id": str(uuid.uuid4()), "email": email, "user_id": user["id"],
        "success": True, "ip": ip, "user_agent": ua, "at": now,
    })
    return UserOut(**user)


@api.get("/auth/login-history")
async def login_history(
    email: Optional[str] = None, user_id: Optional[str] = None, limit: int = 200,
    user=Depends(get_current_user),
):
    """Admin/HR see all; other users see only their own login attempts."""
    q: dict = {}
    if user.get("role") not in ("admin", "hr"):
        q["user_id"] = user["id"]
    else:
        if email:
            q["email"] = email.lower()
        if user_id:
            q["user_id"] = user_id
    docs = await db.login_logs.find(q, {"_id": 0}).sort("at", -1).to_list(max(10, min(limit, 1000)))
    return docs


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/partners/{pid}/centers")
async def partners_mapped_centers(pid: str, _=Depends(require_role("admin", "hr", "manager", "senior_manager"))):
    """Helper for User Management UI: preview the set of centers a partner is currently
    mapped to (via batches.partner_ids OR centers.partner_id). When admin assigns this
    partner to a user, the user will get visibility ONLY into these centers.
    """
    ids = await _centers_for_partner(pid)
    if not ids:
        return {"partner_id": pid, "center_ids": [], "centers": []}
    docs = await db.centers.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "city": 1, "state": 1}).to_list(500)
    return {"partner_id": pid, "center_ids": ids, "centers": docs}


@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(**user)


@api.get("/auth/users", response_model=List[UserOut])
async def list_users(_=Depends(require_role("admin", "hr"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return [UserOut(**d) for d in docs]


@api.patch("/auth/users/{uid}", response_model=UserOut)
async def update_user(uid: str, body: UserUpdateIn, _=Depends(require_role("admin"))):
    # Use exclude_unset so the admin can explicitly clear nullable fields (e.g. {"assigned_partner_id": null})
    update = body.model_dump(exclude_unset=True)
    if not update:
        raise HTTPException(400, "Nothing to update")
    res = await db.users.find_one_and_update(
        {"id": uid}, {"$set": update}, return_document=True, projection={"_id": 0, "password_hash": 0}
    )
    if not res:
        raise HTTPException(404, "User not found")
    return UserOut(**res)


# ---------- Password Reset (OTP via email) ----------
import secrets as _secrets  # local alias to avoid shadowing
import hashlib as _hashlib
import hmac as _hmac

OTP_VALIDITY_MIN = 15
OTP_MAX_ATTEMPTS = 5
OTP_RATE_LIMIT_PER_WINDOW = 3  # max OTP sends per email per window
OTP_RATE_WINDOW_MIN = 15
RESET_TOKEN_VALIDITY_MIN = 10


def _hash_otp(otp: str) -> str:
    return _hashlib.sha256(otp.encode()).hexdigest()


def _gen_otp() -> str:
    return f"{_secrets.randbelow(1000000):06d}"


def _gen_reset_token() -> str:
    return _secrets.token_urlsafe(32)


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotPwdIn):
    """Always returns success (prevents email enumeration). Sends OTP if email exists."""
    email = body.email.lower().strip()
    generic = {"ok": True, "message": "If an account exists for that email, an OTP has been sent."}
    user = await db.users.find_one({"email": email})
    if not user:
        return generic

    # Rate-limit: count OTP rows created in last window for this email
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(minutes=OTP_RATE_WINDOW_MIN)).isoformat()
    recent = await db.password_reset_otps.count_documents({"email": email, "created_at": {"$gt": window_start}})
    if recent >= OTP_RATE_LIMIT_PER_WINDOW:
        raise HTTPException(429, "Too many OTP requests. Please try again later.")

    otp = _gen_otp()
    expires_at = now + timedelta(minutes=OTP_VALIDITY_MIN)
    await db.password_reset_otps.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "otp_hash": _hash_otp(otp),
        "attempts": 0,
        "used": False,
        "reset_token": None,
        "reset_token_expires_at": None,
        "created_at": now.isoformat(),
        "expires_at": expires_at,  # native datetime → TTL index will purge
    })

    # Send OTP via Resend (non-fatal)
    try:
        from email_utils import send_otp_email
        await send_otp_email(to_email=email, otp=otp, validity_minutes=OTP_VALIDITY_MIN)
    except Exception as e:  # noqa: BLE001
        log.error("OTP email send failed: %s", e)

    return generic


@api.post("/auth/verify-otp")
async def verify_otp(body: VerifyOtpIn):
    """Verifies OTP and returns a short-lived reset_token on success."""
    email = body.email.lower().strip()
    otp = (body.otp or "").strip()
    if not otp.isdigit() or len(otp) != 6:
        raise HTTPException(400, "Invalid OTP format")
    # Most recent unused, unexpired OTP for this email
    now = datetime.now(timezone.utc)
    doc = await db.password_reset_otps.find_one(
        {"email": email, "used": False, "expires_at": {"$gt": now}},
        sort=[("created_at", -1)],
    )
    if not doc:
        raise HTTPException(400, "OTP expired or not found. Please request a new one.")
    if doc.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many invalid attempts. Please request a new OTP.")

    expected = doc["otp_hash"]
    actual = _hash_otp(otp)
    if not _hmac.compare_digest(expected, actual):
        await db.password_reset_otps.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Incorrect OTP")

    # OTP correct → issue reset token (single-use, 10 min)
    reset_token = _gen_reset_token()
    reset_expires = now + timedelta(minutes=RESET_TOKEN_VALIDITY_MIN)
    await db.password_reset_otps.update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "reset_token_hash": _hash_otp(reset_token),
            "reset_token_expires_at": reset_expires.isoformat(),
        }},
    )
    return {"ok": True, "reset_token": reset_token, "expires_in": RESET_TOKEN_VALIDITY_MIN * 60}


@api.post("/auth/reset-password")
async def reset_password(body: ResetPwdIn):
    """Consumes the reset_token from verify-otp and sets a new password."""
    token = (body.reset_token or "").strip()
    if not token:
        raise HTTPException(400, "Missing reset token")
    token_hash = _hash_otp(token)
    now = datetime.now(timezone.utc)
    doc = await db.password_reset_otps.find_one({
        "reset_token_hash": token_hash,
        "used": False,
        "expires_at": {"$gt": now},
    })
    if not doc:
        raise HTTPException(400, "Invalid or expired reset token. Please restart the flow.")
    # Reset token must also be within its own validity window
    rte = doc.get("reset_token_expires_at")
    if rte:
        try:
            rte_dt = datetime.fromisoformat(rte)
            if rte_dt.tzinfo is None:
                rte_dt = rte_dt.replace(tzinfo=timezone.utc)
            if rte_dt < now:
                raise HTTPException(400, "Reset token expired. Please restart the flow.")
        except ValueError:
            pass

    email = doc["email"]
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(400, "Account not found")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(body.new_password)}},
    )
    # Mark OTP doc consumed + invalidate any other open OTPs for this email
    await db.password_reset_otps.update_one({"_id": doc["_id"]}, {"$set": {"used": True}})
    await db.password_reset_otps.update_many(
        {"email": email, "used": False},
        {"$set": {"used": True}},
    )
    return {"ok": True, "message": "Password updated successfully. Please log in."}


# ---------- Partner Associations (cross-approval mapping) ----------
def _norm_pair(a: str, b: str) -> tuple:
    return tuple(sorted([a, b]))


@api.get("/partner-associations", response_model=List[PartnerAssociationOut])
async def list_partner_associations(_=Depends(get_current_user)):
    docs = await db.partner_associations.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [PartnerAssociationOut(**d) for d in docs]


@api.post("/partner-associations", response_model=PartnerAssociationOut)
async def create_partner_association(body: PartnerAssociationIn, user=Depends(require_role("admin", "manager"))):
    if body.partner_a_id == body.partner_b_id:
        raise HTTPException(400, "Cannot associate a partner with itself")
    a, b = _norm_pair(body.partner_a_id, body.partner_b_id)
    # Validate both partners exist
    pa = await db.partners.find_one({"id": a})
    pb = await db.partners.find_one({"id": b})
    if not pa or not pb:
        raise HTTPException(400, "One or both partners not found")
    existing = await db.partner_associations.find_one({"partner_a_id": a, "partner_b_id": b})
    if existing:
        existing.pop("_id", None)
        return PartnerAssociationOut(**existing)
    doc = {
        "id": str(uuid.uuid4()),
        "partner_a_id": a,
        "partner_b_id": b,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["id"],
    }
    await db.partner_associations.insert_one(doc)
    doc.pop("_id", None)
    return PartnerAssociationOut(**doc)


@api.delete("/partner-associations/{assoc_id}")
async def delete_partner_association(assoc_id: str, _=Depends(require_role("admin", "manager"))):
    r = await db.partner_associations.delete_one({"id": assoc_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Association not found")
    return {"ok": True}


async def _custom_associated_partners(partner_id: str) -> set:
    """Return set of partner_ids that are explicitly paired with `partner_id`."""
    if not partner_id:
        return set()
    docs = await db.partner_associations.find(
        {"$or": [{"partner_a_id": partner_id}, {"partner_b_id": partner_id}]},
        {"_id": 0, "partner_a_id": 1, "partner_b_id": 1},
    ).to_list(1000)
    out = set()
    for d in docs:
        out.add(d["partner_a_id"])
        out.add(d["partner_b_id"])
    out.discard(partner_id)
    return out


async def _shares_project_or_center(approver_pid: str, owner_pid: str,
                                    project_id: Optional[str], center_id: Optional[str]) -> bool:
    """True if approver_pid has any past approved/pending transaction at the SAME project_id
    or center_id as the target transaction (i.e., they operate in the same scope as owner)."""
    if not approver_pid:
        return False
    or_clauses = []
    if project_id:
        or_clauses.append({"project_id": project_id})
    if center_id:
        or_clauses.append({"center_id": center_id})
    if not or_clauses:
        return False
    q = {"partner_id": approver_pid, "$or": or_clauses}
    cnt = await db.transactions.count_documents(q)
    if cnt > 0:
        return True
    # Also check batches.partner_ids at same project_id
    if project_id:
        bcnt = await db.batches.count_documents({"project_id": project_id, "partner_ids": approver_pid})
        if bcnt > 0:
            return True
    return False


async def _can_partner_approve(user: dict, txn: dict) -> tuple[bool, str]:
    """Returns (allowed, reason). True if user (partner role) can cross-approve this txn.

    HARD GATE (per User Management mapping): the approver's `assigned_center_ids` MUST
    contain the txn's center_id. Partners assigned to a different center never see or
    act on this txn, even if they share a project history or are paired with the owner.

    After the gate, the user qualifies if ANY of these are true:
      • Peer user under SAME partner entity (different user_id, same assigned_partner_id)
      • Custom pairing in `partner_associations` between approver_pid and owner_pid
      • Shares the same project_id OR center_id with the txn's partner

    Always blocked when the approver IS the txn creator (own-self check).
    """
    if user.get("role") != "partner":
        return (False, "Only partner role can perform partner-approval")
    approver_pid = user.get("assigned_partner_id")
    if not approver_pid:
        return (False, "Your account is not linked to a partner profile")
    owner_pid = txn.get("partner_id")
    if not owner_pid:
        return (False, "Transaction has no partner attached")
    # Hard center-mapping gate — must be enforced regardless of other associations.
    txn_cid = txn.get("center_id")
    if txn_cid:
        assigned = user.get("assigned_center_ids") or []
        if txn_cid not in assigned:
            return (False, "You are not mapped to this transaction's center in User Management")
    # Block creator-self only (NOT same-partner — peers under one partner entity should approve each other)
    if txn.get("created_by") == user["id"]:
        return (False, "You cannot approve a transaction you created")
    # Peer under the same partner entity
    if approver_pid == owner_pid:
        return (True, "Peer user under the same partner entity")
    # Check custom pairing
    custom = await _custom_associated_partners(approver_pid)
    if owner_pid in custom:
        return (True, "Linked via custom partner-association")
    # Check same project / center
    if await _shares_project_or_center(approver_pid, owner_pid, txn.get("project_id"), txn.get("center_id")):
        return (True, "Shares same project/center")
    return (False, "Not associated with the transaction's partner")



# ---------- Entity (company/partner/center/project) ----------
ENTITY_COLLECTION = {
    "company": "companies",
    "partner": "partners",
    "center": "centers",
    "project": "projects",
}


def _entity_doc(body: EntityIn, etype: str) -> dict:
    """Build entity dict including ALL extra fields the user passed (gst, mobile, etc).
    Uses Pydantic .model_dump() so extra-allow fields make it through."""
    data = body.model_dump()
    # Strip system-managed keys client might've supplied
    data.pop("linked_user_id", None)
    return {
        "id": str(uuid.uuid4()),
        "type": etype,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **data,
    }


def _gen_password(length: int = 12) -> str:
    """Generate a human-friendly random password (no ambiguous 0/O/1/l)."""
    import secrets
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$"
    return "".join(secrets.choice(chars) for _ in range(length))


async def _maybe_send_credentials_email(email: str, name: str, password: str, role_label: str) -> dict:
    """Best-effort: send login credentials via Resend. Returns the result dict
    so callers can persist {sent, id|reason} to the entity for an audit trail.
    """
    try:
        from email_utils import send_credentials_email
        portal_url = "https://finance.masharaskills.com"
        check_in_url = "https://finance.masharaskills.com/check-in"
        result = await send_credentials_email(
            to_email=email, name=name or "there",
            password=password, check_in_url=check_in_url, portal_url=portal_url,
        )
        return result if isinstance(result, dict) else {"sent": False, "reason": "no_response"}
    except Exception as e:
        return {"sent": False, "reason": str(e)[:200]}


async def _auto_create_user_for_entity(etype: str, entity_doc: dict) -> Optional[str]:
    """If the entity carries an `email`, auto-create (or re-link) a user account.

    - center → role=center_manager, assigned_center_ids=[entity_id]
    - partner → role=partner, assigned_partner_id=entity_id

    Returns the plain-text password (for one-time display) OR None when no user
    was created (e.g. email absent, or email already belongs to a user — in that
    case the entity is linked to the existing user without resetting password).
    """
    if etype not in ("center", "partner"):
        return None
    email = (entity_doc.get("email") or "").strip().lower()
    if not email:
        return None
    role = "center_manager" if etype == "center" else "partner"
    role_label = "Center Manager" if etype == "center" else "Partner"
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        # Re-link existing user to this entity (no password reset)
        upd: dict = {}
        if etype == "center":
            current = set(existing.get("assigned_center_ids") or [])
            current.add(entity_doc["id"])
            upd["assigned_center_ids"] = list(current)
            upd["role"] = role if existing.get("role") in (None, "viewer") else existing.get("role")
        else:
            upd["assigned_partner_id"] = entity_doc["id"]
            upd["role"] = role if existing.get("role") in (None, "viewer") else existing.get("role")
        if upd:
            await db.users.update_one({"id": existing["id"]}, {"$set": upd})
        entity_doc["linked_user_id"] = existing["id"]
        return None
    # Create new user
    plain = _gen_password()
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(plain),
        "name": entity_doc.get("manager_name") or entity_doc.get("name") or email.split("@")[0],
        "role": role,
        "assigned_center_ids": [entity_doc["id"]] if etype == "center" else [],
        "assigned_partner_id": entity_doc["id"] if etype == "partner" else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_via": f"entity_{etype}",
    }
    await db.users.insert_one(user_doc)
    entity_doc["linked_user_id"] = user_doc["id"]
    # Fire-and-forget Resend email — capture result for audit trail
    mail_res = await _maybe_send_credentials_email(email, user_doc["name"], plain, role_label)
    entity_doc["credentials_mail_sent"] = bool(mail_res.get("sent"))
    entity_doc["credentials_mail_at"] = datetime.now(timezone.utc).isoformat() if mail_res.get("sent") else None
    entity_doc["credentials_mail_id"] = mail_res.get("id")
    entity_doc["credentials_mail_error"] = mail_res.get("reason") if not mail_res.get("sent") else None
    return plain


@api.get("/entities/{etype}", response_model=List[EntityOut])
async def list_entities(etype: EntityType, _=Depends(get_current_user)):
    col = ENTITY_COLLECTION[etype]
    docs = await db[col].find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [EntityOut(**d) for d in docs]


@api.post("/entities/{etype}", response_model=EntityOut)
async def create_entity(etype: EntityType, body: EntityIn, _=Depends(require_role("admin", "manager"))):
    col = ENTITY_COLLECTION[etype]
    doc = _entity_doc(body, etype)
    plain_password = await _auto_create_user_for_entity(etype, doc)
    await db[col].insert_one(doc)
    doc.pop("_id", None)
    if plain_password:
        return EntityOut(**{**doc, "generated_password": plain_password})
    return EntityOut(**doc)


@api.put("/entities/{etype}/{eid}", response_model=EntityOut)
async def update_entity(etype: EntityType, eid: str, body: EntityIn, _=Depends(require_role("admin", "manager"))):
    col = ENTITY_COLLECTION[etype]
    existing = await db[col].find_one({"id": eid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    update = body.model_dump()
    update.pop("linked_user_id", None)  # cannot be set from client
    # If email changed AND entity already has a linked user, mirror the change on the user record
    old_email = (existing.get("email") or "").lower()
    new_email = (update.get("email") or "").lower()
    linked_uid = existing.get("linked_user_id")
    plain_password = None
    if linked_uid and new_email and new_email != old_email:
        # Conflict check: another user already on new_email?
        clash = await db.users.find_one({"email": new_email, "id": {"$ne": linked_uid}}, {"_id": 0, "id": 1})
        if clash:
            raise HTTPException(400, f"Email '{new_email}' is already used by another user")
        await db.users.update_one({"id": linked_uid}, {"$set": {"email": new_email}})
    elif (not linked_uid) and new_email and etype in ("center", "partner"):
        # No linked user but email now provided → create one on edit too
        plain_password = await _auto_create_user_for_entity(etype, {**existing, **update, "id": eid})
        update["linked_user_id"] = (await db[col].find_one({"id": eid}, {"_id": 0, "linked_user_id": 1}) or {}).get("linked_user_id")
    res = await db[col].find_one_and_update({"id": eid}, {"$set": update}, return_document=True)
    res.pop("_id", None)
    if plain_password:
        return EntityOut(**{**res, "generated_password": plain_password})
    return EntityOut(**res)


@api.delete("/entities/{etype}/{eid}")
async def delete_entity(etype: EntityType, eid: str, _=Depends(require_role("admin"))):
    col = ENTITY_COLLECTION[etype]
    r = await db[col].delete_one({"id": eid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.post("/entities/{etype}/{eid}/resend-credentials")
async def resend_entity_credentials(etype: EntityType, eid: str, _=Depends(require_role("admin", "manager"))):
    """Regenerate a fresh password for the linked user + re-send credentials email.
    Returns {sent, generated_password} on success. Only valid for center/partner with linked user."""
    col = ENTITY_COLLECTION[etype]
    ent = await db[col].find_one({"id": eid}, {"_id": 0})
    if not ent:
        raise HTTPException(404, "Entity not found")
    email = (ent.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "Entity has no email — add email first to enable credentials")
    if etype not in ("center", "partner"):
        raise HTTPException(400, "Resend credentials only supported for center/partner entities")
    linked_uid = ent.get("linked_user_id")
    role_label = "Center Manager" if etype == "center" else "Partner"
    plain = _gen_password()
    if linked_uid:
        await db.users.update_one({"id": linked_uid}, {"$set": {"password_hash": hash_password(plain)}})
        user_name = (await db.users.find_one({"id": linked_uid}, {"_id": 0, "name": 1}) or {}).get("name", "")
    else:
        # No linked user yet — create one now (treats this as the first onboarding)
        await _auto_create_user_for_entity(etype, ent)
        # _auto_create_user_for_entity set linked_user_id on `ent` dict but didn't persist; persist now
        await db[col].update_one({"id": eid}, {"$set": {"linked_user_id": ent.get("linked_user_id")}})
        return {"sent": ent.get("credentials_mail_sent"), "generated_password": None,
                "note": "User account created with new credentials (email sent if Resend configured)"}
    mail_res = await _maybe_send_credentials_email(email, user_name, plain, role_label)
    # Persist mail audit + password rotation timestamp
    await db[col].update_one({"id": eid}, {"$set": {
        "credentials_mail_sent": bool(mail_res.get("sent")),
        "credentials_mail_at": datetime.now(timezone.utc).isoformat() if mail_res.get("sent") else None,
        "credentials_mail_id": mail_res.get("id"),
        "credentials_mail_error": mail_res.get("reason") if not mail_res.get("sent") else None,
        "credentials_rotated_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {
        "sent": bool(mail_res.get("sent")),
        "reason": mail_res.get("reason"),
        "generated_password": plain,  # admin can copy + share manually if email fails
        "email": email,
    }


# ---------- Project Types (admin-configurable lookup) ----------
# Seed-defaults are inserted on first GET if collection is empty.
DEFAULT_PROJECT_TYPES = [
    {"code": "JSDMS",     "name": "JSDMS"},
    {"code": "SJKVY",     "name": "SJKVY"},
    {"code": "BIRSA",     "name": "BIRSA"},
    {"code": "PMKVY",     "name": "PMKVY"},
    {"code": "DDU_GKY",   "name": "DDU-GKY"},
    {"code": "NSDC",      "name": "NSDC"},
    {"code": "MEGA",      "name": "Mega Project"},
    {"code": "OTHER",     "name": "Other"},
]


class ProjectTypeIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    active: bool = True


class ProjectTypeOut(ProjectTypeIn):
    id: str
    created_at: str


@api.get("/project-types", response_model=List[ProjectTypeOut])
async def list_project_types(_=Depends(get_current_user)):
    docs = await db.project_types.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    if not docs:
        now = datetime.now(timezone.utc).isoformat()
        seed = [{"id": str(uuid.uuid4()), "active": True, "created_at": now, **t} for t in DEFAULT_PROJECT_TYPES]
        await db.project_types.insert_many(seed)
        docs = sorted(seed, key=lambda x: x["name"])
    return [ProjectTypeOut(**d) for d in docs]


@api.post("/project-types", response_model=ProjectTypeOut)
async def create_project_type(body: ProjectTypeIn, _=Depends(require_role("admin", "manager"))):
    if await db.project_types.find_one({"code": body.code}):
        raise HTTPException(400, f"Project type with code '{body.code}' already exists")
    doc = {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), **body.model_dump()}
    await db.project_types.insert_one(doc)
    return ProjectTypeOut(**doc)


@api.put("/project-types/{ptid}", response_model=ProjectTypeOut)
async def update_project_type(ptid: str, body: ProjectTypeIn, _=Depends(require_role("admin", "manager"))):
    res = await db.project_types.find_one_and_update(
        {"id": ptid}, {"$set": body.model_dump()}, return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return ProjectTypeOut(**res)


@api.delete("/project-types/{ptid}")
async def delete_project_type(ptid: str, _=Depends(require_role("admin"))):
    r = await db.project_types.delete_one({"id": ptid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}




# ---------- Transactions ----------
@api.get("/transactions", response_model=List[TransactionOut])
async def list_transactions(
    user=Depends(require_finance_visible),
    type: Optional[TxnType] = None,
    status: Optional[TxnStatus] = None,
    company_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    center_id: Optional[str] = None,
    project_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    q: dict = {}
    await _enrich_user_with_associations(user)
    q.update(_txn_scope_for_user(user))
    if type:
        q["type"] = type
    if status:
        q["status"] = status
    if company_id:
        q["company_id"] = company_id
    if partner_id:
        q["partner_id"] = partner_id
    if center_id:
        q["center_id"] = center_id
    if project_id:
        q["project_id"] = project_id
    if start or end:
        rng: dict = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        q["date"] = rng
    docs = await db.transactions.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return [TransactionOut(**d) for d in docs]


@api.post("/transactions", response_model=TransactionOut)
async def create_transaction(body: TransactionIn, user=Depends(require_role("admin", "manager", "center_manager", "partner", "accountant"))):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    # Auto-derive company_id / partner_id from the center when caller left them blank
    # (e.g. Stock quick-add, income entries where the operator only picked a center).
    # Ensures the transaction row shows the correct Company + Partner in the ledger UI.
    if doc.get("center_id") and (not doc.get("company_id") or not doc.get("partner_id")):
        ctx = await _derive_context_for_center(doc.get("center_id"))
        if not doc.get("company_id"):
            doc["company_id"] = ctx["company_id"]
        if not doc.get("partner_id"):
            doc["partner_id"] = ctx["partner_id"]
    if _can_auto_approve(user):
        doc["status"] = "approved"
        doc["approved_by"] = user["id"]
        doc["approved_at"] = doc["created_at"]
        # Admin-created transactions skip the chain (auto-approved)
        doc["chain_id"] = None
        doc["current_level"] = 0
        doc["chain_snapshot"] = []
        doc["chain_history"] = []
    else:
        doc["status"] = "pending"
        doc["approved_by"] = None
        doc["approved_at"] = None
        await _attach_chain_to_request("transaction", doc)
    doc["rejected_reason"] = None
    await db.transactions.insert_one(doc)
    # Notify first-level approver if chain present
    if doc.get("current_level") and doc.get("chain_snapshot"):
        first = next((s for s in doc["chain_snapshot"] if s.get("level") == 1), None)
        if first:
            for uid in await _resolve_step_user_ids(first, doc):
                if uid and uid != user["id"]:
                    await _notify(uid, f"New transaction awaiting your approval (₹{doc.get('amount', 0):,.0f})",
                                  ntype="txn_pending", ref_id=doc["id"], link="/transactions")
    # PARTNER cross-approval routing: when a partner creates a txn, alert ALL associated
    # partners (custom pairings + same project/center peers) so any one of them can
    # tap "Partner Approve" — even before admin/chain approval clears.
    if user.get("role") == "partner" and doc.get("status") == "pending":
        owner_pid = user.get("assigned_partner_id") or doc.get("partner_id")
        notified_users: set[str] = set()
        if owner_pid:
            peers = await _custom_associated_partners(owner_pid)
            # Always include peers under the SAME partner entity (other users linked to same partner)
            peers.add(owner_pid)
            # Also include partners sharing project/center on this txn
            if doc.get("project_id") or doc.get("center_id"):
                or_c = []
                if doc.get("project_id"):
                    or_c.append({"project_id": doc["project_id"]})
                if doc.get("center_id"):
                    or_c.append({"center_id":  doc["center_id"]})
                peer_txns = await db.transactions.find(
                    {"partner_id": {"$ne": owner_pid, "$nin": [None]}, "$or": or_c},
                    {"_id": 0, "partner_id": 1},
                ).to_list(2000)
                for t in peer_txns:
                    if t.get("partner_id"):
                        peers.add(t["partner_id"])
            # Resolve linked users for these partner_ids
            if peers:
                peer_users = await db.users.find(
                    {"role": "partner", "assigned_partner_id": {"$in": list(peers)}},
                    {"_id": 0, "id": 1},
                ).to_list(2000)
                for u in peer_users:
                    uid = u.get("id")
                    if uid and uid != user["id"]:
                        notified_users.add(uid)
        for uid in notified_users:
            await _notify(
                uid,
                f"Associated partner submitted txn for your approval (₹{doc.get('amount', 0):,.0f})",
                ntype="txn_partner_approve", ref_id=doc["id"], link="/transactions",
            )
    return TransactionOut(**doc)


@api.put("/transactions/{tid}", response_model=TransactionOut)
async def update_transaction(tid: str, body: TransactionIn, user=Depends(get_current_user)):
    existing = await db.transactions.find_one({"id": tid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    role = user.get("role")
    is_admin = role == "admin"
    is_owner = existing.get("created_by") == user["id"]
    # Admin can edit any. Non-admin creator (with editor role) can edit own entry;
    # if it was approved, editing resets status back to pending.
    if not (is_admin or (is_owner and role in ("manager", "center_manager", "partner", "accountant"))):
        raise HTTPException(403, "Forbidden")
    update = body.model_dump()
    # Editing an approved entry sets it back to pending (unless admin)
    if not is_admin and existing.get("status") == "approved":
        update["status"] = "pending"
        update["approved_by"] = None
        update["approved_at"] = None
    res = await db.transactions.find_one_and_update(
        {"id": tid}, {"$set": update}, return_document=True
    )
    res.pop("_id", None)
    return TransactionOut(**res)


class BulkIds(BaseModel):
    ids: List[str]


@api.post("/transactions/bulk-approve")
async def bulk_approve(body: BulkIds, user=Depends(require_role("admin", "senior_manager"))):
    if not body.ids:
        return {"approved": 0}
    now = datetime.now(timezone.utc).isoformat()
    # Snapshot creators before update so we can notify them
    docs = await db.transactions.find(
        {"id": {"$in": body.ids}, "status": {"$ne": "approved"}},
        {"_id": 0, "id": 1, "created_by": 1, "amount": 1},
    ).to_list(5000)
    r = await db.transactions.update_many(
        {"id": {"$in": body.ids}, "status": {"$ne": "approved"}},
        {"$set": {"status": "approved", "approved_by": user["id"], "approved_at": now, "rejected_reason": None}},
    )
    # Fire notifications (best-effort)
    for d in docs:
        if d.get("created_by") and d["created_by"] != user["id"]:
            await _notify(d["created_by"], f"Your transaction was approved (₹{d.get('amount', 0):,.0f})",
                          ntype="txn_approved", ref_id=d["id"], link="/transactions")
    return {"approved": r.modified_count}


# ---------- Bulk Delete / Archive endpoints (admin-only) ----------
# Convention: hard-delete for transactional / configuration data; soft-archive for
# identity / personnel data (staff, users). Soft-archive sets is_active=false so the
# row remains queryable for historical reports but is hidden from default listings.

@api.post("/transactions/bulk-delete")
async def bulk_delete_transactions(body: BulkIds, _=Depends(require_role("admin"))):
    if not body.ids:
        return {"deleted": 0}
    r = await db.transactions.delete_many({"id": {"$in": body.ids}})
    return {"deleted": r.deleted_count}


@api.post("/transactions/backfill-company-partner")
async def backfill_company_partner(user=Depends(require_role("admin"))):
    """One-shot repair: for every transaction with a `center_id` but missing
    `company_id` and/or `partner_id`, derive both from the center's batches
    and update in-place. Returns counts. Idempotent — running twice is safe.

    Fixes historical data where auto-created reimbursements, payroll salaries,
    asset purchases, stock entries etc. left the company/partner columns as "—".
    """
    # Cache per-center lookups so we don't re-derive N times per center.
    cache: dict[str, dict] = {}
    updated = 0
    scanned = 0
    async for t in db.transactions.find(
        {"center_id": {"$ne": None}, "$or": [{"company_id": None}, {"partner_id": None}]},
        {"_id": 0, "id": 1, "center_id": 1, "company_id": 1, "partner_id": 1},
    ):
        scanned += 1
        cid = t.get("center_id")
        if cid not in cache:
            cache[cid] = await _derive_context_for_center(cid)
        ctx = cache[cid]
        patch: dict = {}
        if not t.get("company_id") and ctx["company_id"]:
            patch["company_id"] = ctx["company_id"]
        if not t.get("partner_id") and ctx["partner_id"]:
            patch["partner_id"] = ctx["partner_id"]
        if patch:
            await db.transactions.update_one({"id": t["id"]}, {"$set": patch})
            updated += 1
    return {"scanned": scanned, "updated": updated, "distinct_centers": len(cache)}


@api.post("/entities/{etype}/bulk-delete")
async def bulk_delete_entities(etype: EntityType, body: BulkIds, _=Depends(require_role("admin"))):
    if not body.ids:
        return {"deleted": 0}
    col = ENTITY_COLLECTION[etype]
    r = await db[col].delete_many({"id": {"$in": body.ids}})
    return {"deleted": r.deleted_count}


@api.post("/batches/bulk-delete")
async def bulk_delete_batches(body: BulkIds, _=Depends(require_role("admin"))):
    if not body.ids:
        return {"deleted": 0}
    await db.batch_payments.delete_many({"batch_id": {"$in": body.ids}})
    r = await db.batches.delete_many({"id": {"$in": body.ids}})
    return {"deleted": r.deleted_count}


@api.post("/partner-associations/bulk-delete")
async def bulk_delete_partner_associations(body: BulkIds, _=Depends(require_role("admin"))):
    if not body.ids:
        return {"deleted": 0}
    r = await db.partner_associations.delete_many({"id": {"$in": body.ids}})
    return {"deleted": r.deleted_count}


@api.post("/staff/bulk-archive")
async def bulk_archive_staff(body: BulkIds, _=Depends(require_role("admin"))):
    """Soft-archive staff (sets is_active=false). Linked user account also archived."""
    if not body.ids:
        return {"archived": 0}
    docs = await db.staff.find({"id": {"$in": body.ids}}, {"_id": 0, "id": 1, "user_id": 1}).to_list(5000)
    linked_user_ids = [d["user_id"] for d in docs if d.get("user_id")]
    now = datetime.now(timezone.utc).isoformat()
    r = await db.staff.update_many(
        {"id": {"$in": body.ids}},
        {"$set": {"is_active": False, "archived_at": now}},
    )
    if linked_user_ids:
        await db.users.update_many(
            {"id": {"$in": linked_user_ids}},
            {"$set": {"is_active": False, "archived_at": now}},
        )
    return {"archived": r.modified_count, "linked_users_archived": len(linked_user_ids)}


@api.post("/auth/users/bulk-archive")
async def bulk_archive_users(body: BulkIds, current=Depends(require_role("admin"))):
    """Soft-archive users (sets is_active=false). Cannot archive yourself."""
    if not body.ids:
        return {"archived": 0}
    safe_ids = [i for i in body.ids if i != current["id"]]
    if not safe_ids:
        raise HTTPException(400, "You cannot archive your own account")
    r = await db.users.update_many(
        {"id": {"$in": safe_ids}},
        {"$set": {"is_active": False, "archived_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"archived": r.modified_count, "skipped_self": len(body.ids) - len(safe_ids)}




@api.post("/transactions/{tid}/approve", response_model=TransactionOut)
async def approve_transaction(tid: str, user=Depends(require_role("admin", "senior_manager"))):
    now = datetime.now(timezone.utc).isoformat()
    res = await db.transactions.find_one_and_update(
        {"id": tid},
        {"$set": {"status": "approved", "approved_by": user["id"], "approved_at": now, "rejected_reason": None}},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    if res.get("created_by") and res["created_by"] != user["id"]:
        await _notify(res["created_by"], f"Your transaction was approved (₹{res.get('amount', 0):,.0f})",
                      ntype="txn_approved", ref_id=tid, link="/transactions")
    return TransactionOut(**res)


@api.post("/transactions/{tid}/reject", response_model=TransactionOut)
async def reject_transaction(tid: str, body: RejectIn, user=Depends(require_role("admin", "senior_manager"))):
    res = await db.transactions.find_one_and_update(
        {"id": tid},
        {"$set": {"status": "rejected", "approved_by": user["id"], "approved_at": None, "rejected_reason": body.reason or ""}},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    if res.get("created_by") and res["created_by"] != user["id"]:
        await _notify(res["created_by"],
                      "Your transaction was rejected" + (f": {body.reason}" if body.reason else ""),
                      ntype="txn_rejected", ref_id=tid, link="/transactions")
    return TransactionOut(**res)


@api.post("/transactions/{tid}/partner-approve", response_model=TransactionOut)
async def partner_approve_transaction(tid: str, user=Depends(get_current_user)):
    """Cross-partner approval: an associated partner approves another partner's transaction.
    Eligibility (any of):
      • Custom pairing in `partner_associations`
      • Shares the same project_id OR center_id (via transactions or batch.partner_ids)
    Creator-self approval is blocked. 1 valid approval → status=approved.
    """
    txn = await db.transactions.find_one({"id": tid})
    if not txn:
        raise HTTPException(404, "Transaction not found")
    if txn.get("status") == "approved":
        raise HTTPException(400, "Already approved")
    if txn.get("status") == "rejected":
        raise HTTPException(400, "Transaction was rejected — cannot partner-approve")
    allowed, reason = await _can_partner_approve(user, txn)
    if not allowed:
        raise HTTPException(403, reason)
    now = datetime.now(timezone.utc).isoformat()
    res = await db.transactions.find_one_and_update(
        {"id": tid, "status": {"$ne": "approved"}},
        {"$set": {
            "status": "approved",
            "approved_by": user["id"],
            "approved_at": now,
            "approval_via": "partner_cross",
            "approval_reason": reason,
            "rejected_reason": None,
        }},
        return_document=True,
    )
    if not res:
        raise HTTPException(409, "Could not approve (race condition)")
    res.pop("_id", None)
    if res.get("created_by") and res["created_by"] != user["id"]:
        await _notify(res["created_by"],
                      f"Your transaction was approved by a partner peer (₹{res.get('amount', 0):,.0f})",
                      ntype="txn_approved", ref_id=tid, link="/transactions")
    return TransactionOut(**res)


class PartnerRejectIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    remarks: str = Field(min_length=3)


@api.post("/transactions/{tid}/partner-reject", response_model=TransactionOut)
async def partner_reject_transaction(tid: str, body: PartnerRejectIn, user=Depends(get_current_user)):
    """Cross-partner rejection: an associated partner rejects another partner's pending txn.
    Eligibility identical to partner-approve. Sets status=rejected with mandatory remarks."""
    txn = await db.transactions.find_one({"id": tid})
    if not txn:
        raise HTTPException(404, "Transaction not found")
    if txn.get("status") == "approved":
        raise HTTPException(400, "Already approved — cannot partner-reject")
    if txn.get("status") == "rejected":
        raise HTTPException(400, "Already rejected")
    allowed, reason = await _can_partner_approve(user, txn)
    if not allowed:
        raise HTTPException(403, reason)
    res = await db.transactions.find_one_and_update(
        {"id": tid, "status": {"$ne": "approved"}},
        {"$set": {
            "status": "rejected",
            "approved_by": user["id"],
            "approved_at": None,
            "approval_via": "partner_cross",
            "rejected_reason": body.remarks,
        }},
        return_document=True,
    )
    if not res:
        raise HTTPException(409, "Could not reject (race condition)")
    res.pop("_id", None)
    if res.get("created_by") and res["created_by"] != user["id"]:
        await _notify(res["created_by"],
                      f"Your transaction was rejected by a partner peer: {body.remarks}",
                      ntype="txn_rejected", ref_id=tid, link="/transactions")
    return TransactionOut(**res)



@api.get("/transactions/{tid}/partner-approve-eligibility")
async def partner_approve_eligibility(tid: str, user=Depends(get_current_user)):
    """UI helper: returns whether the current user can partner-approve a given txn."""
    txn = await db.transactions.find_one({"id": tid})
    if not txn:
        raise HTTPException(404, "Transaction not found")
    if txn.get("status") == "approved":
        return {"eligible": False, "reason": "Already approved"}
    allowed, reason = await _can_partner_approve(user, txn)
    return {"eligible": allowed, "reason": reason}



@api.delete("/transactions/{tid}")
async def delete_transaction(tid: str, _=Depends(require_role("admin"))):
    r = await db.transactions.delete_one({"id": tid})
    # Idempotent: don't 404 on a row that's already gone — this avoids noisy errors
    # when the UI double-clicks or shows a stale list.
    return {"ok": True, "already_deleted": r.deleted_count == 0}


@api.post("/transactions/import")
async def import_transactions(file: UploadFile = File(...), user=Depends(require_role("admin", "manager"))):
    """CSV columns: type,amount,date,description,company,partner,center,project
    company/partner/center/project can be name or id; if name not found it's created."""
    raw = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(raw))
    inserted = 0
    errors: List[str] = []

    name_cache: dict = {}

    async def resolve(etype: str, val: str) -> Optional[str]:
        val = (val or "").strip()
        if not val:
            return None
        key = f"{etype}:{val.lower()}"
        if key in name_cache:
            return name_cache[key]
        col = ENTITY_COLLECTION[etype]
        # try by id
        d = await db[col].find_one({"id": val}, {"_id": 0, "id": 1})
        if not d:
            d = await db[col].find_one({"name": {"$regex": f"^{val}$", "$options": "i"}}, {"_id": 0, "id": 1})
        if not d:
            new_doc = _entity_doc(EntityIn(name=val), etype)
            await db[col].insert_one(new_doc)
            d = {"id": new_doc["id"]}
        name_cache[key] = d["id"]
        return d["id"]

    for i, row in enumerate(reader, start=2):
        try:
            ttype = row.get("type", "").strip().lower()
            if ttype not in ("investment", "income", "expense"):
                raise ValueError("invalid type")
            amount = float(row.get("amount", 0))
            date = row.get("date", "").strip()
            if not date:
                raise ValueError("missing date")
            doc = {
                "id": str(uuid.uuid4()),
                "type": ttype,
                "amount": amount,
                "date": date,
                "description": row.get("description", "").strip(),
                "company_id": await resolve("company", row.get("company", "")),
                "partner_id": await resolve("partner", row.get("partner", "")),
                "center_id": await resolve("center", row.get("center", "")),
                "project_id": await resolve("project", row.get("project", "")),
                "items": [],
                "attachments": [],
                "created_by": user["id"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "approved" if _can_auto_approve(user) else "pending",
                "approved_by": user["id"] if _can_auto_approve(user) else None,
                "approved_at": datetime.now(timezone.utc).isoformat() if _can_auto_approve(user) else None,
                "rejected_reason": None,
            }
            await db.transactions.insert_one(doc)
            inserted += 1
        except Exception as e:
            errors.append(f"row {i}: {e}")

    return {"inserted": inserted, "errors": errors}


# ---------- Dashboard ----------
@api.get("/dashboard/summary")
async def dashboard_summary(
    user=Depends(require_finance_visible),
    company_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    center_id: Optional[str] = None,
    project_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    include_pending: bool = False,
):
    match: dict = {}
    await _enrich_user_with_associations(user)
    match.update(_txn_scope_for_user(user))
    # Only approved entries count toward financial summary by default
    if not include_pending:
        match["status"] = "approved"
    for k, v in [("company_id", company_id), ("partner_id", partner_id),
                 ("center_id", center_id), ("project_id", project_id)]:
        if v:
            match[k] = v
    if start or end:
        rng: dict = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        match["date"] = rng

    pipeline = [{"$match": match}, {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}}]
    agg = await db.transactions.aggregate(pipeline).to_list(100)
    totals = {"investment": 0.0, "income": 0.0, "expense": 0.0}
    for row in agg:
        totals[row["_id"]] = row["total"]
    profit = totals["income"] - totals["expense"]

    # monthly trend
    monthly_pipeline = [
        {"$match": match},
        {"$group": {
            "_id": {"month": {"$substr": ["$date", 0, 7]}, "type": "$type"},
            "total": {"$sum": "$amount"},
        }},
        {"$sort": {"_id.month": 1}},
    ]
    monthly_agg = await db.transactions.aggregate(monthly_pipeline).to_list(1000)
    months_map: dict = {}
    for row in monthly_agg:
        m = row["_id"]["month"]
        months_map.setdefault(m, {"month": m, "investment": 0, "income": 0, "expense": 0})
        months_map[m][row["_id"]["type"]] = row["total"]
    monthly = sorted(months_map.values(), key=lambda x: x["month"])

    # breakdown by dimension
    async def breakdown(group_field: str, collection: str):
        pipe = [
            {"$match": match},
            {"$group": {"_id": {"id": f"${group_field}", "type": "$type"}, "total": {"$sum": "$amount"}}},
        ]
        rows = await db.transactions.aggregate(pipe).to_list(2000)
        # fetch names
        ids = list({r["_id"]["id"] for r in rows if r["_id"]["id"]})
        names_docs = await db[collection].find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
        name_map = {d["id"]: d["name"] for d in names_docs}
        agg_map: dict = {}
        for r in rows:
            eid = r["_id"]["id"] or "—"
            name = name_map.get(eid, "Unassigned")
            agg_map.setdefault(eid, {"id": eid, "name": name, "investment": 0, "income": 0, "expense": 0})
            agg_map[eid][r["_id"]["type"]] = r["total"]
        out = list(agg_map.values())
        for o in out:
            o["profit"] = o["income"] - o["expense"]
        return sorted(out, key=lambda x: x["profit"], reverse=True)

    return {
        "totals": {
            "investment": totals["investment"],
            "income": totals["income"],
            "expense": totals["expense"],
            "profit": profit,
        },
        "monthly": monthly,
        "by_company": await breakdown("company_id", "companies"),
        "by_partner": await breakdown("partner_id", "partners"),
        "by_center": await breakdown("center_id", "centers"),
        "by_project": await breakdown("project_id", "projects"),
        "by_item": await _items_breakdown(match),
    }


async def _items_breakdown(match: dict) -> list:
    """Aggregate transaction.items[] grouped by item name across the matched txns."""
    pipe = [
        {"$match": match},
        {"$unwind": "$items"},
        {"$group": {
            "_id": {"name": "$items.name", "type": "$type"},
            "amount": {"$sum": "$items.amount"},
            "qty": {"$sum": "$items.quantity"},
        }},
    ]
    rows = await db.transactions.aggregate(pipe).to_list(5000)
    agg_map: dict = {}
    for r in rows:
        n = (r["_id"]["name"] or "Unnamed").strip() or "Unnamed"
        agg_map.setdefault(n, {"name": n, "investment": 0, "income": 0, "expense": 0, "quantity": 0})
        agg_map[n][r["_id"]["type"]] += r["amount"]
        agg_map[n]["quantity"] += r["qty"]
    out = list(agg_map.values())
    for o in out:
        o["profit"] = o["income"] - o["expense"]
        o["total"] = o["investment"] + o["income"] + o["expense"]
    return sorted(out, key=lambda x: x["total"], reverse=True)


@api.get("/dashboard/milestone-income")
async def milestone_income_summary(
    user=Depends(require_finance_visible),
    start: Optional[str] = None,
    end: Optional[str] = None,
    project_id: Optional[str] = None,
    center_id: Optional[str] = None,
):
    """Aggregate milestone-source income across approved transactions.

    Returns:
      - total: float
      - by_milestone: { "1st": float, "2nd": float, "3rd": float }
      - by_partner: [{ partner_id, partner_name, amount }]
      - by_project: [{ project_id, project_name, amount }]
      - rows: full list of milestone transactions (for drill-down / print)
    """
    q: dict = {"source": "milestone", "status": "approved"}
    if start or end:
        rng: dict = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        q["date"] = rng
    if project_id:
        q["project_id"] = project_id
    if center_id:
        q["center_id"] = center_id
    # Apply scope
    await _enrich_user_with_associations(user)
    q.update(_txn_scope_for_user(user))

    docs = await db.transactions.find(q, {"_id": 0}).to_list(20000)

    pmap = await db.partners.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    pname_by_id = {p["id"]: p["name"] for p in pmap}
    projmap = await db.projects.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    proj_by_id = {p["id"]: p["name"] for p in projmap}

    total = 0.0
    by_milestone: dict = {"1st": 0.0, "2nd": 0.0, "3rd": 0.0, "other": 0.0}
    partner_agg: dict = {}
    project_agg: dict = {}
    for d in docs:
        amt = float(d.get("amount") or 0)
        total += amt
        ms = d.get("milestone") or "—"
        if ms in by_milestone:
            by_milestone[ms] += amt
        pid = d.get("partner_id")
        key = pid or "__unassigned"
        partner_agg[key] = partner_agg.get(key, 0.0) + amt
        prj = d.get("project_id") or "__none"
        project_agg[prj] = project_agg.get(prj, 0.0) + amt

    by_partner = [
        {"partner_id": k if k != "__unassigned" else None,
         "partner_name": pname_by_id.get(k, "Unassigned") if k != "__unassigned" else "Unassigned",
         "amount": round(v, 2)}
        for k, v in sorted(partner_agg.items(), key=lambda x: -x[1])
    ]
    by_project = [
        {"project_id": k if k != "__none" else None,
         "project_name": proj_by_id.get(k, "—") if k != "__none" else "—",
         "amount": round(v, 2)}
        for k, v in sorted(project_agg.items(), key=lambda x: -x[1])
    ]
    return {
        "total": round(total, 2),
        "by_milestone": {k: round(v, 2) for k, v in by_milestone.items()},
        "by_partner": by_partner,
        "by_project": by_project,
        "count": len(docs),
    }


@api.get("/dashboard/fooding-income")
async def fooding_income_summary(
    user=Depends(require_finance_visible),
    start: Optional[str] = None,
    end: Optional[str] = None,
    project_id: Optional[str] = None,
    center_id: Optional[str] = None,
):
    """Aggregate source='fooding' approved transactions.

    Returns total, monthly trend, company-vs-partner split, and per-partner breakdown.
    """
    q: dict = {"source": "fooding", "status": "approved"}
    if start or end:
        rng: dict = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        q["date"] = rng
    if project_id:
        q["project_id"] = project_id
    if center_id:
        q["center_id"] = center_id
    await _enrich_user_with_associations(user)
    q.update(_txn_scope_for_user(user))

    docs = await db.transactions.find(q, {"_id": 0}).to_list(20000)
    pmap = await db.partners.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    pname = {p["id"]: p["name"] for p in pmap}
    cmap = await db.companies.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    cname = {c["id"]: c["name"] for c in cmap}

    total = 0.0
    company_total = 0.0
    partner_total = 0.0
    monthly: dict = {}
    partner_agg: dict = {}
    company_agg: dict = {}
    for d in docs:
        amt = float(d.get("amount") or 0)
        total += amt
        m = (d.get("date") or "")[:7]
        if m:
            monthly[m] = monthly.get(m, 0.0) + amt
        pid = d.get("partner_id")
        cid = d.get("company_id")
        if pid:
            partner_total += amt
            partner_agg[pid] = partner_agg.get(pid, 0.0) + amt
        else:
            company_total += amt
            key = cid or "__unassigned"
            company_agg[key] = company_agg.get(key, 0.0) + amt

    monthly_list = [{"month": m, "amount": round(v, 2)} for m, v in sorted(monthly.items())]
    by_partner = [
        {"partner_id": k, "partner_name": pname.get(k, "Unknown"), "amount": round(v, 2)}
        for k, v in sorted(partner_agg.items(), key=lambda x: -x[1])
    ]
    by_company = [
        {"company_id": k if k != "__unassigned" else None,
         "company_name": cname.get(k, "Unassigned") if k != "__unassigned" else "Unassigned",
         "amount": round(v, 2)}
        for k, v in sorted(company_agg.items(), key=lambda x: -x[1])
    ]
    return {
        "total": round(total, 2),
        "company_total": round(company_total, 2),
        "partner_total": round(partner_total, 2),
        "monthly": monthly_list,
        "by_partner": by_partner,
        "by_company": by_company,
        "count": len(docs),
    }


async def _latest_settlement_for_center(cid: str) -> Optional[dict]:
    """Return the most-recent partner_settlements record for a center (or None)."""
    doc = await db.partner_settlements.find_one(
        {"center_id": cid},
        sort=[("date", -1), ("created_at", -1)],
    )
    if not doc:
        return None
    doc.pop("_id", None)
    return doc


def _aggregate_partners_for_center(rows: list, p_name: dict) -> list:
    """Group raw txn aggregation rows into per-partner totals and add fair-share fields."""
    agg: dict = {}
    for r in rows:
        pid = r["_id"]["pid"]
        agg.setdefault(pid, {
            "id": pid, "name": p_name.get(pid, "Unknown"),
            "investment": 0, "income": 0, "expense": 0,
        })
        agg[pid][r["_id"]["type"]] += r["total"]
    partners = list(agg.values())
    for p in partners:
        p["net_contribution"] = p["investment"] + p["expense"] - p["income"]
        p["profit_share"] = p["income"] - p["expense"]
    total_contrib = sum(p["net_contribution"] for p in partners)
    n = len(partners) or 1
    fair_share = total_contrib / n
    for p in partners:
        p["fair_share"] = round(fair_share, 2)
        p["adjustment"] = round(fair_share - p["net_contribution"], 2)
    return partners, total_contrib, fair_share, n


@api.get("/dashboard/settlement")
async def settlement_view(
    user=Depends(require_finance_visible),
    center_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    after_date: Optional[str] = None,
    include_history: Optional[bool] = False,
):
    """Co-partner settlement view for a center.

    Cutoff Logic:
      • The latest recorded settlement for each center is treated as a "cutoff" — only
        transactions strictly AFTER `settled_till` are counted, so balances naturally
        reset to 0 once partners pay each other.
      • An explicit `after_date` query parameter overrides the auto cutoff.
      • Pass `include_history=true` to additionally receive the FULL (pre-cutoff)
        balances under each center as `lifetime` — used by the frontend "View Settled
        History" toggle.

    - partner role: scoped to centers where the logged-in partner is mapped.
    - admin/manager/accountant: can pass any center_id (or partner_id) to inspect.

    Returns list of centers; for each center, list of partners with their investment/income/expense
    plus fair-share (equal split) adjustment.
    Each center entry also carries `settled_till` (date) and `last_settlement` (record) when applicable.
    """
    role = user.get("role")
    own_partner_id = user.get("assigned_partner_id") if role == "partner" else partner_id

    # Find which centers to include
    center_ids: list[str] = []
    if center_id:
        center_ids = [center_id]
    elif role == "partner" and own_partner_id:
        center_ids = await _centers_for_partner(own_partner_id)
    elif own_partner_id:
        center_ids = await _centers_for_partner(own_partner_id)
    else:
        # admin without filter: all centers that have any partner transaction
        center_ids = await db.transactions.distinct(
            "center_id",
            {"status": "approved", "partner_id": {"$ne": None}, "center_id": {"$ne": None}},
        )

    # Fetch entity name lookups
    center_docs = await db.centers.find({"id": {"$in": center_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    center_name = {c["id"]: c["name"] for c in center_docs}

    out_centers = []
    for cid in center_ids:
        # Resolve cutoff for this center — query param wins, else latest recorded settlement.
        last_settlement = await _latest_settlement_for_center(cid)
        cutoff = after_date or (last_settlement.get("date") if last_settlement else None)

        # Build the date window for CURRENT (post-cutoff) view
        cur_match: dict = {"status": "approved", "center_id": cid, "partner_id": {"$ne": None}}
        date_filter: dict = {}
        if cutoff:
            date_filter["$gt"] = cutoff
        if start:
            # If user-supplied start is later than cutoff, use it; otherwise keep cutoff
            if not cutoff or start > cutoff:
                date_filter["$gte"] = start
                date_filter.pop("$gt", None)
        if end:
            date_filter["$lte"] = end
        if date_filter:
            cur_match["date"] = date_filter

        pipe = [
            {"$match": cur_match},
            {"$group": {"_id": {"pid": "$partner_id", "type": "$type"}, "total": {"$sum": "$amount"}}},
        ]
        rows = await db.transactions.aggregate(pipe).to_list(5000)

        # Lifetime (pre-cutoff) numbers — for the "View Settled History" toggle
        lifetime_block = None
        if include_history:
            life_match: dict = {"status": "approved", "center_id": cid, "partner_id": {"$ne": None}}
            life_date: dict = {}
            if start:
                life_date["$gte"] = start
            if end:
                life_date["$lte"] = end
            if life_date:
                life_match["date"] = life_date
            life_rows = await db.transactions.aggregate([
                {"$match": life_match},
                {"$group": {"_id": {"pid": "$partner_id", "type": "$type"}, "total": {"$sum": "$amount"}}},
            ]).to_list(5000)
            if life_rows:
                life_partner_ids = list({r["_id"]["pid"] for r in life_rows})
                life_pdocs = await db.partners.find(
                    {"id": {"$in": life_partner_ids}}, {"_id": 0, "id": 1, "name": 1},
                ).to_list(1000)
                life_p_name = {p["id"]: p["name"] for p in life_pdocs}
                l_partners, l_total, l_fair, l_n = _aggregate_partners_for_center(life_rows, life_p_name)
                lifetime_block = {
                    "total_contribution": round(l_total, 2),
                    "fair_share_each": round(l_fair, 2),
                    "partner_count": l_n,
                    "partners": sorted(l_partners, key=lambda x: x["adjustment"]),
                }

        if not rows and not lifetime_block:
            # No activity at all — skip this center
            continue

        # Resolve partner names (across both current and lifetime)
        pids_needed = list({r["_id"]["pid"] for r in rows})
        if not pids_needed and lifetime_block:
            # No post-cutoff activity yet, but render an "all settled" stub so UI can show the
            # cutoff banner and history toggle.
            out_centers.append({
                "center_id": cid,
                "center_name": center_name.get(cid, "Unknown"),
                "total_contribution": 0,
                "fair_share_each": 0,
                "partner_count": 0,
                "partners": [],
                "settled_till": cutoff,
                "last_settlement": last_settlement,
                "lifetime": lifetime_block,
            })
            continue
        p_docs = await db.partners.find({"id": {"$in": pids_needed}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        p_name = {p["id"]: p["name"] for p in p_docs}

        partners, total_contrib, fair_share, n = _aggregate_partners_for_center(rows, p_name)

        entry = {
            "center_id": cid,
            "center_name": center_name.get(cid, "Unknown"),
            "total_contribution": round(total_contrib, 2),
            "fair_share_each": round(fair_share, 2),
            "partner_count": n,
            "partners": sorted(partners, key=lambda x: x["adjustment"]),
        }
        if cutoff:
            entry["settled_till"] = cutoff
        if last_settlement:
            entry["last_settlement"] = last_settlement
        if lifetime_block:
            entry["lifetime"] = lifetime_block
        out_centers.append(entry)

    return {"centers": sorted(out_centers, key=lambda x: x["center_name"])}


# ---------- Settlement Record (Partner-to-Partner payment) ----------
class SettlementRecordIn(BaseModel):
    center_id: str
    from_partner_id: str   # the partner who PAID
    to_partner_id: str     # the partner who RECEIVED
    amount: float = Field(gt=0)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")  # YYYY-MM-DD — acts as the cutoff date
    note: Optional[str] = None


@api.post("/dashboard/settlement/record", status_code=201)
async def record_settlement(
    payload: SettlementRecordIn,
    user=Depends(require_finance_visible),
):
    """Record a partner-to-partner settlement payment.

    Permissions:
      • admin / senior_manager / manager / accountant — can record for any center.
      • partner — can ONLY record settlements for centers they are mapped to, and must
        be one of the two parties (either payer or receiver).
    """
    role = user.get("role")
    if payload.from_partner_id == payload.to_partner_id:
        raise HTTPException(status_code=400, detail="Payer and receiver cannot be the same partner")

    # Validate center exists
    center = await db.centers.find_one({"id": payload.center_id}, {"_id": 0, "id": 1, "name": 1})
    if not center:
        raise HTTPException(status_code=404, detail="Center not found")

    # Partner-role enforcement
    if role == "partner":
        own_pid = user.get("assigned_partner_id")
        if not own_pid or own_pid not in (payload.from_partner_id, payload.to_partner_id):
            raise HTTPException(status_code=403, detail="Partners can only record settlements they are part of")
        own_centers = await _centers_for_partner(own_pid)
        if payload.center_id not in own_centers:
            raise HTTPException(status_code=403, detail="Center not mapped to your partner profile")

    # Validate both partners exist
    p_docs = await db.partners.find(
        {"id": {"$in": [payload.from_partner_id, payload.to_partner_id]}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(2)
    p_map = {p["id"]: p["name"] for p in p_docs}
    if payload.from_partner_id not in p_map or payload.to_partner_id not in p_map:
        raise HTTPException(status_code=404, detail="One or both partners not found")

    rec = {
        "id": str(uuid.uuid4()),
        "center_id": payload.center_id,
        "center_name": center.get("name"),
        "from_partner_id": payload.from_partner_id,
        "from_partner_name": p_map[payload.from_partner_id],
        "to_partner_id": payload.to_partner_id,
        "to_partner_name": p_map[payload.to_partner_id],
        "amount": round(float(payload.amount), 2),
        "date": payload.date,
        "note": payload.note,
        "recorded_by": user["id"],
        "recorded_by_name": user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.partner_settlements.insert_one(rec)
    rec.pop("_id", None)
    return rec


@api.get("/dashboard/settlement/history")
async def settlement_history(
    center_id: Optional[str] = None,
    user=Depends(require_finance_visible),
):
    """List previously-recorded partner settlements.

    Scope rules:
      • partner — restricted to centers mapped to their partner profile.
      • others — can pass `center_id` to filter, or omit to get every settlement.
    """
    role = user.get("role")
    q: dict = {}
    if center_id:
        q["center_id"] = center_id
    if role == "partner":
        own_pid = user.get("assigned_partner_id")
        own_centers = await _centers_for_partner(own_pid) if own_pid else []
        if not own_centers:
            return {"records": []}
        if center_id and center_id not in own_centers:
            raise HTTPException(status_code=403, detail="Center not mapped to your partner profile")
        q["center_id"] = {"$in": own_centers} if not center_id else center_id
    docs = await db.partner_settlements.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    return {"records": docs}


@api.delete("/dashboard/settlement/record/{sid}", status_code=204)
async def delete_settlement_record(sid: str, user=Depends(require_finance_visible)):
    """Undo a recorded settlement (admin / senior_manager / manager / accountant only)."""
    role = user.get("role")
    if role not in ("admin", "senior_manager", "manager", "accountant"):
        raise HTTPException(status_code=403, detail="Only admin/senior_manager/manager/accountant can delete settlement records")
    res = await db.partner_settlements.delete_one({"id": sid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Settlement record not found")
    return None



# ---------- Role-specific dashboard widgets ----------
@api.get("/dashboard/role-widgets")
async def role_widgets(user=Depends(get_current_user)):
    """Returns aggregated KPIs + lists tuned to the logged-in user's role.

    Each role gets a different shape — the frontend keys off `role` to render
    the appropriate widget set. Centralised here so the frontend stays lean."""
    role = user.get("role")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out: dict = {"role": role, "as_of": today}

    # Center-scoped query helper used by center_manager + center_staff
    center_scope = {}
    if role in ("center_manager", "center_staff"):
        center_scope = {"center_id": {"$in": user.get("assigned_center_ids") or []}}

    # ----- Center Manager / Center Staff -----
    if role in ("center_manager", "center_staff"):
        scoped_ids = user.get("assigned_center_ids") or []
        out["center_ids"] = scoped_ids
        # Today attendance
        out["attendance_today_present"] = await db.attendance.count_documents({**center_scope, "date": today, "status": "present"})
        out["attendance_today_absent"]  = await db.attendance.count_documents({**center_scope, "date": today, "status": "absent"})
        out["staff_total"]              = await db.staff.count_documents(center_scope)
        # Stock value
        stock_txns = await db.transactions.find(
            {**center_scope, "type": "expense", "status": "approved"}, {"_id": 0, "items": 1},
        ).to_list(2000)
        stock_value = 0.0
        for t in stock_txns:
            for it in (t.get("items") or []):
                stock_value += float(it.get("amount") or 0)
        out["stock_value"] = round(stock_value, 2)
        # Pending expense requests (created at this center)
        out["pending_expense_requests"] = await db.transactions.count_documents({**center_scope, "type": "expense", "status": "pending"})
        # Active batches
        out["batches_active"] = await db.batches.count_documents({**center_scope, "closed": {"$ne": True}})
        # Recent leave requests
        leaves = await db.leaves.find({**center_scope, "status": {"$in": ["pending", "submitted"]}}, {"_id": 0}).sort("created_at", -1).to_list(10)
        out["pending_leaves"] = [{"id": lv["id"], "status": lv.get("status"), "reason": lv.get("reason", "")[:60]} for lv in leaves]

    # ----- Accountant -----
    if role == "accountant":
        out["pending_payments"]      = await db.transactions.count_documents({"status": "pending"})
        out["payroll_unpaid"]        = await db.payroll.count_documents({"status": {"$ne": "paid"}})
        out["reimb_to_pay"]          = await db.reimbursements.count_documents({"status": "accountant_approved"})
        out["reimb_l1_approved"]     = await db.reimbursements.count_documents({"status": "l1_approved"})
        # Monthly cash-flow (current + prev 5 months)
        cf = await db.transactions.aggregate([
            {"$match": {"status": "approved"}},
            {"$group": {
                "_id": {"month": {"$substr": ["$date", 0, 7]}, "type": "$type"},
                "amount": {"$sum": "$amount"},
            }},
            {"$sort": {"_id.month": -1}},
            {"$limit": 24},
        ]).to_list(24)
        monthly: dict = {}
        for row in cf:
            m = row["_id"].get("month") or ""
            t = row["_id"].get("type") or ""
            monthly.setdefault(m, {"month": m, "income": 0, "expense": 0, "investment": 0})
            if t in ("income", "expense", "investment"):
                monthly[m][t] += float(row.get("amount") or 0)
        out["cash_flow_monthly"] = sorted(monthly.values(), key=lambda x: x["month"])[-6:]
        # GST exposure: sum of approved expense amounts (rough — actual GST extracted elsewhere)
        tot = await db.transactions.aggregate([
            {"$match": {"status": "approved"}}, {"$group": {"_id": "$type", "amount": {"$sum": "$amount"}}},
        ]).to_list(10)
        out["totals_by_type"] = {row["_id"]: round(row.get("amount") or 0, 2) for row in tot if row.get("_id")}

    # ----- HR -----
    if role == "hr":
        out["staff_total"]    = await db.staff.count_documents({})
        out["staff_active"]   = await db.staff.count_documents({"status": {"$ne": "exited"}})
        # New joiners in last 30 days
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        out["new_joiners_30d"] = await db.staff.count_documents({"doj": {"$gte": cutoff}})
        # Attendance compliance: % present today / total
        present = await db.attendance.count_documents({"date": today, "status": "present"})
        total_s = max(1, out["staff_active"])
        out["attendance_compliance_pct"] = round(100.0 * present / total_s, 1)
        out["pending_leaves"]    = await db.leaves.count_documents({"status": {"$in": ["pending", "submitted", "l1_approved"]}})
        out["pending_reimb_hr"]  = await db.reimbursements.count_documents({"status": "accountant_approved"})

    # ----- Senior Manager -----
    if role in ("senior_manager", "manager"):
        # Center-wise performance ranking (count of approved txns + total income last 30d)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        pipeline = [
            {"$match": {"status": "approved", "date": {"$gte": cutoff}, "type": "income"}},
            {"$group": {"_id": "$center_id", "amount": {"$sum": "$amount"}, "count": {"$sum": 1}}},
            {"$sort": {"amount": -1}},
            {"$limit": 10},
        ]
        rank = await db.transactions.aggregate(pipeline).to_list(10)
        centers_map = {c["id"]: c["name"] for c in await db.centers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)}
        out["center_ranking_30d"] = [
            {"center_id": r["_id"], "center_name": centers_map.get(r["_id"], "Unknown"),
             "income": round(float(r.get("amount") or 0), 2), "txn_count": r.get("count") or 0}
            for r in rank if r.get("_id")
        ]
        out["pending_approvals_count"] = await db.transactions.count_documents({"status": "pending"})

    # ----- Reporting Authority -----
    if role == "reporting_authority":
        # Pending verifications routed via approval chain to this user (best-effort)
        await _enrich_user_with_associations(user)
        out["pending_verifications"] = await db.transactions.count_documents({"status": "pending"})
        # Recent escalations: pending >3 days
        old_cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        out["escalations_3d"] = await db.transactions.count_documents({"status": "pending", "created_at": {"$lt": old_cutoff}})

    # ----- Center Partner -----
    if role == "center_partner":
        # Profitability: sum of approved income - expense across own scope
        agg = await db.transactions.aggregate([
            {"$match": {"status": "approved"}}, {"$group": {"_id": "$type", "amount": {"$sum": "$amount"}}},
        ]).to_list(10)
        agg_map = {r["_id"]: round(float(r.get("amount") or 0), 2) for r in agg}
        out["income_total"]  = agg_map.get("income", 0)
        out["expense_total"] = agg_map.get("expense", 0)
        out["profit"]        = round(out["income_total"] - out["expense_total"], 2)
        out["pending_expense_requests"] = await db.transactions.count_documents({"type": "expense", "status": "pending"})

    return out


@api.get("/dashboard/center-ops")
async def center_ops_dashboard(user=Depends(get_current_user)):
    """Operational dashboard for Center Manager (and adjacent roles).

    Returns center-scoped operational metrics — NO finance data. Designed for
    `/` landing for `center_manager` so they get an actually useful home page
    instead of a redirect to /hrms.

    Shape:
      {
        as_of, center_ids: [...],
        kpi: { staff_total, attendance_present, attendance_absent, attendance_pct,
               leaves_pending, regularisations_pending, batches_active, asset_total },
        upcoming_holidays: [...],
        my_pending_approvals: int,
        recent_leaves: [...],
        my_centers: [{id,name}],
      }
    """
    role = user.get("role")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Determine the center scope
    if role in ("admin", "hr", "senior_manager", "manager"):
        cids = [c["id"] async for c in db.centers.find({}, {"_id": 0, "id": 1})]
    else:
        cids = user.get("assigned_center_ids") or []

    if not cids:
        return {
            "as_of": today, "center_ids": [],
            "kpi": {
                "staff_total": 0, "attendance_present": 0, "attendance_absent": 0, "attendance_pct": 0,
                "leaves_pending": 0, "regularisations_pending": 0, "batches_active": 0, "asset_total": 0,
            },
            "upcoming_holidays": [], "my_pending_approvals": 0, "recent_leaves": [], "my_centers": [],
        }

    cscope = {"center_id": {"$in": cids}}

    # Staff in scope
    staff_total = await db.staff.count_documents(cscope)
    staff_ids = [s["id"] async for s in db.staff.find(cscope, {"_id": 0, "id": 1})]
    staff_scope = {"staff_id": {"$in": staff_ids}} if staff_ids else {"staff_id": "__none__"}

    # Today attendance
    att_present = await db.attendance.count_documents({**staff_scope, "date": today, "status": "present"})
    att_absent  = await db.attendance.count_documents({**staff_scope, "date": today, "status": "absent"})
    att_pct     = round((att_present / staff_total * 100) if staff_total else 0, 1)

    # Pending HRMS items in their centers
    leaves_pending = await db.leaves.count_documents({**staff_scope, "status": "pending"})
    regs_pending   = await db.regularisations.count_documents({**staff_scope, "status": "pending"})

    # Batches active (ops view — count only, no amounts)
    batches_active = await db.batches.count_documents({**cscope, "status": {"$ne": "closed"}})

    # Assets registered to their centers
    asset_total = await db.assets.count_documents(cscope)

    # Upcoming holidays (next 5)
    upcoming = await db.holidays.find(
        {"date": {"$gte": today}}, {"_id": 0}
    ).sort("date", 1).to_list(5)

    # Pending approvals routed to ME (count from existing inbox shape)
    my_pending_count = 0
    try:
        from itertools import chain as _chain  # local import to avoid top-level disturbance
        await _enrich_user_with_associations(user)
        # Reuse the same pending scan as /approvals/pending — simplified, just counts.
        # Defer full implementation: count leaves/regularisations where this user is the next-level approver.
        my_pending_count = 0
        for coll_name in ("leaves", "regularisations", "reimbursements"):
            pending = await db[coll_name].find(
                {"status": "pending", "current_level": {"$gt": 0}}, {"_id": 0}
            ).to_list(500)
            for rec in pending:
                step = await _current_step(rec)
                if not step:
                    continue
                approvers = await _resolve_step_user_ids(step, rec)
                if user["id"] in approvers:
                    my_pending_count += 1
        _ = _chain  # silence unused warning
    except Exception:
        pass

    # Recent 5 leaves to give a glance into team activity (only staff_name + dates + status)
    recent_leaves = await db.leaves.find(staff_scope, {"_id": 0}).sort("created_at", -1).to_list(5)

    # Center name lookup
    my_centers = await db.centers.find({"id": {"$in": cids}}, {"_id": 0, "id": 1, "name": 1, "city": 1}).to_list(50)

    return {
        "as_of": today,
        "center_ids": cids,
        "kpi": {
            "staff_total": staff_total,
            "attendance_present": att_present,
            "attendance_absent": att_absent,
            "attendance_pct": att_pct,
            "leaves_pending": leaves_pending,
            "regularisations_pending": regs_pending,
            "batches_active": batches_active,
            "asset_total": asset_total,
        },
        "upcoming_holidays": upcoming,
        "my_pending_approvals": my_pending_count,
        "recent_leaves": recent_leaves,
        "my_centers": my_centers,
    }


@api.get("/")
async def root():
    return {"service": "finance-tracker", "ok": True}


# ====================== HRMS + Payroll ======================

class StaffIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    designation: str
    reports_to_id: Optional[str] = None
    monthly_salary: float = Field(ge=0, default=0)
    per_day_rate: float = Field(ge=0, default=0)
    joining_date: str = ""
    user_id: Optional[str] = None  # link to a User if they log in
    center_id: Optional[str] = None
    shift_id: Optional[str] = None  # link to Shift master for late/penalty rules
    # ---- Contact (persisted on staff record so admin/HR always see them) ----
    email: Optional[str] = None
    mobile: Optional[str] = None
    # ---- Personal info ----
    date_of_birth: Optional[str] = None  # YYYY-MM-DD
    gender: Optional[str] = None  # "male" | "female" | "other"
    address: Optional[str] = None
    pan: Optional[str] = None
    aadhaar_last4: Optional[str] = None  # store last 4 digits only for privacy
    emergency_contact_name: Optional[str] = None
    emergency_contact_mobile: Optional[str] = None
    # ---- Bank details (for payroll) ----
    bank_account_no: Optional[str] = None
    bank_name: Optional[str] = None
    ifsc: Optional[str] = None
    account_holder_name: Optional[str] = None
    bank_verified: bool = False
    bank_verified_at: Optional[str] = None
    bank_verified_by: Optional[str] = None
    # ---- Login auto-provisioning toggles (used only on create_staff) ----
    create_login: bool = False
    send_credentials_email: bool = True
    send_offer_letter: bool = True  # generate + email PDF offer letter (needs template + center's company)
    # ---- Offer letter references (set by _generate_and_deliver_offer_letter) ----
    offer_letter_url: Optional[str] = None
    offer_letter_id: Optional[str] = None
    offer_letter_generated_at: Optional[str] = None


class StaffOut(StaffIn):
    id: str
    created_at: str


class AttendanceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    staff_id: str
    date: str  # YYYY-MM-DD
    status: Literal["present", "absent", "half", "leave"] = "present"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None  # in meters
    selfie_path: Optional[str] = None  # storage path returned by /files/upload
    selfie_filename: Optional[str] = None
    marked_via: Optional[str] = "admin"  # "self" (from mobile check-in) or "admin"
    marked_at: Optional[str] = None      # ISO timestamp when staff/admin actually pressed Save


class SelfCheckInIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: Optional[str] = None  # defaults to today (server-side)
    status: Literal["present", "absent", "half", "leave"] = "present"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    selfie_path: Optional[str] = None
    selfie_filename: Optional[str] = None


class CheckOutIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    selfie_path: Optional[str] = None
    selfie_filename: Optional[str] = None


class HolidayIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: str  # YYYY-MM-DD
    name: str
    type: Optional[str] = "public"  # "public" | "festival" | "weekly_off" | "other"
    is_recurring: bool = False  # if true, applies to that month-day every year


class StaffDocIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    doc_type: str  # "aadhaar" | "pan" | "education" | "experience" | "photo" | "other"
    title: str
    file_path: str
    file_name: str
    notes: Optional[str] = None


class GeofenceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    center_id: Optional[str] = None  # if None → global fence (any center can use)
    name: str
    latitude: float
    longitude: float
    radius_m: float = Field(gt=0, default=200)  # default 200 metres
    active: bool = True


class ShiftIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str  # e.g. "Day Shift", "Night Shift"
    start_time: str  # "HH:MM" 24h
    end_time: str  # "HH:MM"
    grace_minutes: int = Field(ge=0, default=10)
    late_penalty_per_hour: float = Field(ge=0, default=0)  # ₹ deducted per hour late beyond grace
    half_day_after_minutes: int = Field(ge=0, default=120)  # late > N min → half day
    min_hours_for_present: float = Field(ge=0, default=4)  # punched-duration min for present status
    active: bool = True


class RegularisationIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: str  # YYYY-MM-DD — day to regularise
    # Renamed on save to attendance_status so it doesn't clash with the chain status
    # ('pending'/'approved'/'rejected') used by the unified approval engine.
    status: Literal["present", "half", "leave"] = "present"
    reason: str  # mandatory explanation


class LeaveIn(BaseModel):
    staff_id: str
    start_date: str
    end_date: str
    reason: Optional[str] = ""
    leave_type_id: Optional[str] = None  # links to leave_types collection; deducted on final approve


# ----- Leave Allocation (HR provisioning) -----
class LeaveTypeIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=2)
    code: str = Field(min_length=1, max_length=10)  # short ID: CL, SL, PL, COMP, etc.
    annual_quota: float = Field(ge=0, default=0)
    paid: bool = True
    carry_forward: bool = False
    color: Optional[str] = None  # tailwind hue for UI badges (e.g. "blue", "amber")
    active: bool = True


class LeaveAllocateIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    leave_type_id: str
    year: int = Field(ge=2020, le=2100)
    days: float = Field(ge=0)
    staff_ids: List[str] = Field(default_factory=list)  # empty = ALL active staff
    center_id: Optional[str] = None  # when set + staff_ids empty: scope to this center
    mode: Literal["set", "add"] = "set"  # set: overwrite allocated; add: increment
    remarks: Optional[str] = ""


class LeaveBalanceAdjustIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    delta_allocated: float = 0  # +/- to allocated
    delta_used: float = 0       # +/- to used (rare; manual correction)
    remarks: str = Field(min_length=3)


class ReimbursementIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    staff_id: str
    amount: float = Field(gt=0)
    date: str
    category: Optional[str] = ""
    description: Optional[str] = ""
    attachments: List[AttachmentRef] = Field(default_factory=list)


ReimbStatus = Literal["submitted", "l1_approved", "accountant_approved", "paid", "rejected"]


def _resolve_staff_for_user(user: dict) -> Optional[dict]:
    return None  # populated in async helper


async def _staff_for_user(user_id: str) -> Optional[dict]:
    return await db.staff.find_one({"user_id": user_id}, {"_id": 0})


# -------- Staff CRUD --------
def _center_scope_q(user: dict) -> dict:
    """Return Mongo center-scope filter for center_manager/center_staff roles.
    Returns empty dict (no restriction) for admin and other privileged roles."""
    role = user.get("role")
    if role in ("center_manager", "center_staff"):
        return {"center_id": {"$in": user.get("assigned_center_ids") or []}}
    return {}


@api.get("/staff", response_model=List[StaffOut])
async def list_staff(user=Depends(get_current_user)):
    q: dict = {}
    role = user.get("role")
    if role in ("center_manager", "center_staff"):
        q["center_id"] = {"$in": user.get("assigned_center_ids") or []}
    docs = await db.staff.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    return [StaffOut(**d) for d in docs]


@api.post("/staff")
async def create_staff(body: StaffIn, user=Depends(require_role("admin", "manager", "hr"))):
    doc = body.model_dump()
    # Only admin can assign the reports_to chain (approval hierarchy)
    if user.get("role") != "admin":
        doc["reports_to_id"] = None
    # --- Optional auto-provisioning a user login + credentials email ---
    create_login = bool(doc.pop("create_login", False))
    send_creds = bool(doc.pop("send_credentials_email", True))
    send_offer = bool(doc.pop("send_offer_letter", True))
    # Normalise contact fields (KEEP them on staff doc; do not pop)
    login_email = (doc.get("email") or "").strip().lower() or None
    mobile = (doc.get("mobile") or "").strip() or None
    doc["email"] = login_email
    doc["mobile"] = mobile
    email_result = None
    generated_password: Optional[str] = None
    if create_login:
        if not login_email:
            raise HTTPException(400, "email is required when create_login=true")
        # Idempotent: if a user with this email already exists, link to that user.
        existing_user = await db.users.find_one({"email": login_email}, {"_id": 0})
        if existing_user:
            doc["user_id"] = existing_user["id"]
        else:
            from email_utils import generate_password, send_credentials_email
            new_password = generate_password(12)
            generated_password = new_password
            user_doc = {
                "id": str(uuid.uuid4()),
                "name": doc.get("name") or login_email,
                "email": login_email,
                "password_hash": hash_password(new_password),
                "role": "center_staff",  # default lowest write-capable role for new staff
                "mobile": mobile or None,
                "assigned_center_ids": [doc["center_id"]] if doc.get("center_id") else [],
                "assigned_partner_id": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.users.insert_one(user_doc)
            doc["user_id"] = user_doc["id"]
            if send_creds:
                public_url = os.environ.get("PUBLIC_APP_URL", "").rstrip("/")
                if not public_url:
                    logger.warning("PUBLIC_APP_URL not set — staff credential email check-in link will be empty")
                check_in_url = (public_url + "/check-in") if public_url else "/check-in"
                email_result = await send_credentials_email(
                    to_email=login_email, name=user_doc["name"], password=new_password, check_in_url=check_in_url,
                )
    if mobile and doc.get("user_id"):
        # Best-effort: store mobile on the linked user record too
        await db.users.update_one({"id": doc["user_id"]}, {"$set": {"mobile": mobile}})
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.staff.insert_one(doc)
    # Offer-letter generation (fire-and-log; never blocks staff creation).
    offer_letter_result = None
    if send_offer and login_email:
        try:
            offer_letter_result = await _generate_and_deliver_offer_letter(
                staff=doc, login_email=login_email, login_password=generated_password,
            )
        except Exception as e:
            logger.exception("Offer letter generation error for staff %s", doc.get("id"))
            offer_letter_result = {"generated": False, "emailed": False, "reason": str(e)[:200]}
        # Reload the staff doc so the response carries the offer_letter_* fields
        refreshed = await db.staff.find_one({"id": doc["id"]}, {"_id": 0})
        if refreshed:
            doc = refreshed
    out = StaffOut(**{k: v for k, v in doc.items() if k in StaffOut.model_fields}).model_dump()
    if email_result is not None:
        out["email_status"] = email_result
    if offer_letter_result is not None:
        out["offer_letter_status"] = offer_letter_result
    return out


@api.put("/staff/{sid}", response_model=StaffOut)
async def update_staff(sid: str, body: StaffIn, user=Depends(require_role("admin", "manager", "hr"))):
    update = body.model_dump()
    # Strip transient login-only fields — never persist them as columns
    update.pop("create_login", None)
    update.pop("send_credentials_email", None)
    if user.get("role") != "admin":
        # Preserve existing reports_to_id; only admin may change it
        existing = await db.staff.find_one({"id": sid}, {"_id": 0, "reports_to_id": 1})
        update["reports_to_id"] = (existing or {}).get("reports_to_id")
    # Auto-unverify bank if any bank field changed
    prev = await db.staff.find_one({"id": sid}, {"_id": 0, "bank_account_no": 1, "ifsc": 1, "bank_name": 1, "account_holder_name": 1, "bank_verified": 1})
    if prev and prev.get("bank_verified"):
        bank_changed = any(
            (prev.get(k) or "") != (update.get(k) or "")
            for k in ("bank_account_no", "ifsc", "bank_name", "account_holder_name")
        )
        if bank_changed:
            update["bank_verified"] = False
            update["bank_verified_at"] = None
            update["bank_verified_by"] = None
    # Don't let the client itself flip bank_verified — only the dedicated endpoint may
    if prev and not prev.get("bank_verified"):
        update["bank_verified"] = False
        update["bank_verified_at"] = None
        update["bank_verified_by"] = None
    res = await db.staff.find_one_and_update(
        {"id": sid}, {"$set": update}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    # Best-effort: keep linked user's mobile in sync
    if update.get("mobile") and res.get("user_id"):
        await db.users.update_one({"id": res["user_id"]}, {"$set": {"mobile": update["mobile"]}})
    return StaffOut(**res)


@api.delete("/staff/{sid}")
async def delete_staff(sid: str, _=Depends(require_role("admin", "hr"))):
    r = await db.staff.delete_one({"id": sid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.post("/staff/{sid}/verify-bank")
async def verify_staff_bank(sid: str, user=Depends(require_role("admin", "hr"))):
    """HR/Admin marks a staff's bank details as verified after manual check."""
    s = await db.staff.find_one({"id": sid}, {"_id": 0, "bank_account_no": 1, "ifsc": 1})
    if not s:
        raise HTTPException(404, "Staff not found")
    if not s.get("bank_account_no") or not s.get("ifsc"):
        raise HTTPException(400, "Bank account number and IFSC required before verification")
    now = datetime.now(timezone.utc).isoformat()
    await db.staff.update_one({"id": sid}, {"$set": {
        "bank_verified": True, "bank_verified_at": now, "bank_verified_by": user["id"],
    }})
    return {"ok": True, "verified_at": now}


@api.post("/staff/{sid}/unverify-bank")
async def unverify_staff_bank(sid: str, _=Depends(require_role("admin", "hr"))):
    await db.staff.update_one({"id": sid}, {"$set": {
        "bank_verified": False, "bank_verified_at": None, "bank_verified_by": None,
    }})
    return {"ok": True}


@api.post("/staff/{sid}/send-offer-letter")
async def resend_offer_letter(sid: str, user=Depends(require_role("admin", "hr"))):
    """Regenerate the offer letter PDF for an existing staff and re-email it.

    If the staff has no linked user account yet, one will be auto-created and
    the freshly generated password will be embedded in the letter.
    """
    staff = await db.staff.find_one({"id": sid}, {"_id": 0})
    if not staff:
        raise HTTPException(404, "Staff not found")
    login_email = (staff.get("email") or "").strip().lower()
    if not login_email:
        raise HTTPException(400, "Staff has no email — cannot send offer letter")
    # If no user account, auto-create one so the letter carries valid credentials.
    login_password: Optional[str] = None
    if not staff.get("user_id"):
        existing_user = await db.users.find_one({"email": login_email}, {"_id": 0})
        if existing_user:
            await db.staff.update_one({"id": sid}, {"$set": {"user_id": existing_user["id"]}})
            staff["user_id"] = existing_user["id"]
        else:
            from email_utils import generate_password
            login_password = generate_password(12)
            new_user = {
                "id": str(uuid.uuid4()),
                "name": staff.get("name") or login_email,
                "email": login_email,
                "password_hash": hash_password(login_password),
                "role": "center_staff",
                "mobile": staff.get("mobile"),
                "assigned_center_ids": [staff.get("center_id")] if staff.get("center_id") else [],
                "assigned_partner_id": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.users.insert_one(new_user)
            await db.staff.update_one({"id": sid}, {"$set": {"user_id": new_user["id"]}})
            staff["user_id"] = new_user["id"]
    result = await _generate_and_deliver_offer_letter(
        staff=staff, login_email=login_email, login_password=login_password,
    )
    return result


@api.get("/offer-letters", response_model=List[dict])
async def list_offer_letters(
    staff_id: Optional[str] = None,
    _=Depends(require_role("admin", "hr", "manager")),
):
    q: dict = {}
    if staff_id:
        q["staff_id"] = staff_id
    docs = await db.offer_letters.find(q, {"_id": 0}).sort("generated_at", -1).to_list(500)
    return docs


@api.get("/offer-letters/{lid}/download")
async def download_offer_letter(lid: str, user=Depends(require_role("admin", "hr", "manager"))):
    """Download an offer letter (PDF or DOCX fallback). Streams from object storage."""
    rec = await db.offer_letters.find_one({"id": lid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Offer letter not found")
    try:
        data, blob_ct = _get_object(rec["pdf_path"])
    except requests.HTTPError as e:
        raise HTTPException(502, f"Storage fetch failed: {e}")
    media_type = rec.get("content_type") or blob_ct or "application/pdf"
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{rec.get("filename","offer-letter.pdf")}"'},
    )


# -------- Staff Documents --------
@api.post("/staff-documents")
async def upload_staff_document(body: StaffDocIn, user=Depends(get_current_user)):
    """Staff uploads a document (Aadhaar, PAN, certificates etc) for their own profile.
    Admin/HR can also upload on behalf via /staff-documents/admin endpoint below."""
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})
    if not staff:
        raise HTTPException(400, "Your user is not linked to any staff record.")
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "staff_id": staff["id"],
        "staff_name": staff.get("name"),
        "uploaded_by": user["id"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.staff_documents.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/staff-documents/my")
async def list_my_staff_documents(user=Depends(get_current_user)):
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
    if not staff:
        return []
    return await db.staff_documents.find({"staff_id": staff["id"]}, {"_id": 0}).sort("uploaded_at", -1).to_list(200)


@api.get("/staff/{sid}/documents")
async def list_staff_documents(sid: str, _=Depends(require_role("admin", "hr", "manager"))):
    return await db.staff_documents.find({"staff_id": sid}, {"_id": 0}).sort("uploaded_at", -1).to_list(200)


@api.delete("/staff-documents/{did}")
async def delete_staff_document(did: str, user=Depends(get_current_user)):
    """Staff can delete their own doc; admin/HR can delete any."""
    doc = await db.staff_documents.find_one({"id": did}, {"_id": 0, "staff_id": 1, "uploaded_by": 1})
    if not doc:
        raise HTTPException(404, "Not found")
    if user.get("role") not in ("admin", "hr"):
        # Only owner can delete
        if doc.get("uploaded_by") != user["id"]:
            raise HTTPException(403, "Not allowed")
    await db.staff_documents.delete_one({"id": did})
    return {"ok": True}


# -------- Attendance --------
@api.post("/attendance")
async def mark_attendance(body: AttendanceIn, user=Depends(require_role("admin", "manager", "center_manager", "hr", "center_staff"))):
    # upsert by (staff_id, date)
    doc = body.model_dump(exclude_none=True)
    if not doc.get("marked_at"):
        doc["marked_at"] = datetime.now(timezone.utc).isoformat()
    doc["marked_via"] = doc.get("marked_via") or "admin"
    doc["marked_by"] = user["id"]
    new_id = str(uuid.uuid4())
    await db.attendance.update_one(
        {"staff_id": doc["staff_id"], "date": doc["date"]},
        {"$set": doc, "$setOnInsert": {"id": new_id}},
        upsert=True,
    )
    return {"ok": True}


@api.post("/attendance/self")
async def self_check_in(body: SelfCheckInIn, user=Depends(get_current_user)):
    """Mobile self-check-in: looks up the staff record linked to the current user,
    then upserts today's attendance with location + selfie metadata.
    Enforces geofence if any active fence is configured for the staff's center.
    """
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1, "center_id": 1})
    if not staff:
        raise HTTPException(400, "Your user is not linked to any staff record. Ask admin to set it up.")
    # Enforce geofence if configured for the staff's center (or global fences exist)
    body_dict = body.model_dump(exclude_none=True)
    lat = body_dict.get("latitude")
    lng = body_dict.get("longitude")
    if lat is not None and lng is not None:
        fence_q: dict = {"active": True}
        if staff.get("center_id"):
            fence_q["$or"] = [{"center_id": staff["center_id"]}, {"center_id": None}]
        fences = await db.geofences.find(fence_q, {"_id": 0}).to_list(50)
        if fences:
            from math import radians, sin, cos, sqrt, atan2
            def _haversine_m(a_lat, a_lng, b_lat, b_lng):
                R = 6_371_000.0
                p1, p2 = radians(a_lat), radians(b_lat)
                dphi = radians(b_lat - a_lat)
                dlam = radians(b_lng - a_lng)
                a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlam / 2) ** 2
                return 2 * R * atan2(sqrt(a), sqrt(1 - a))
            inside = False
            nearest_name = None
            nearest_dist = None
            for f in fences:
                d = _haversine_m(lat, lng, f["latitude"], f["longitude"])
                if nearest_dist is None or d < nearest_dist:
                    nearest_dist = d
                    nearest_name = f.get("name")
                if d <= float(f.get("radius_m", 200)):
                    inside = True
                    break
            if not inside:
                raise HTTPException(400, f"Outside geofence. Nearest: {nearest_name or 'site'} (~{(nearest_dist or 0)/1000:.2f} km away). Move closer to mark attendance.")
    today = (body.date or datetime.now(timezone.utc).date().isoformat())[:10]
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "staff_id": staff["id"],
        "date": today,
        "marked_via": "self",
        "marked_at": now_iso,
        "marked_by": user["id"],
        "check_in_at": now_iso,
    }
    for k in ("status", "latitude", "longitude", "accuracy", "selfie_path", "selfie_filename"):
        if k in body_dict:
            doc[k] = body_dict[k]
    new_id = str(uuid.uuid4())
    await db.attendance.update_one(
        {"staff_id": staff["id"], "date": today},
        {"$set": doc, "$setOnInsert": {"id": new_id}},
        upsert=True,
    )
    return {"ok": True, "staff_id": staff["id"], "staff_name": staff.get("name"), "date": today, "marked_at": now_iso}


@api.post("/attendance/checkout")
async def self_check_out(body: CheckOutIn, user=Depends(get_current_user)):
    """Mobile check-out: staff clocks out for the day. Records location + optional selfie.
    Today's attendance row must already exist (i.e. staff checked in first)."""
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
    if not staff:
        raise HTTPException(400, "Your user is not linked to any staff record.")
    today = datetime.now(timezone.utc).date().isoformat()
    row = await db.attendance.find_one({"staff_id": staff["id"], "date": today}, {"_id": 0})
    if not row:
        raise HTTPException(400, "Please check in first before checking out.")
    if row.get("check_out_at"):
        raise HTTPException(400, "You have already checked out today.")
    now_iso = datetime.now(timezone.utc).isoformat()
    update = {"check_out_at": now_iso}
    body_dict = body.model_dump(exclude_none=True)
    for k, target in (("latitude", "check_out_latitude"), ("longitude", "check_out_longitude"),
                      ("accuracy", "check_out_accuracy"), ("selfie_path", "check_out_selfie_path"),
                      ("selfie_filename", "check_out_selfie_filename")):
        if k in body_dict:
            update[target] = body_dict[k]
    await db.attendance.update_one(
        {"staff_id": staff["id"], "date": today},
        {"$set": update},
    )
    return {"ok": True, "check_out_at": now_iso}


@api.get("/attendance/my")
async def my_attendance(
    start: Optional[str] = None,
    end: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Current logged-in staff's own attendance history."""
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
    if not staff:
        return []
    q: dict = {"staff_id": staff["id"]}
    if start or end:
        q["date"] = {}
        if start:
            q["date"]["$gte"] = start
        if end:
            q["date"]["$lte"] = end
    docs = await db.attendance.find(q, {"_id": 0}).sort("date", -1).to_list(500)
    return docs


@api.get("/attendance/today")
async def my_today_attendance(user=Depends(get_current_user)):
    """Return today's attendance row for the current logged-in user (if any)."""
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})
    if not staff:
        return {"staff": None, "attendance": None}
    today = datetime.now(timezone.utc).date().isoformat()
    row = await db.attendance.find_one({"staff_id": staff["id"], "date": today}, {"_id": 0})
    return {"staff": staff, "attendance": row}


@api.get("/attendance")
async def list_attendance(
    staff_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    _=Depends(get_current_user),
):
    q: dict = {}
    if staff_id:
        q["staff_id"] = staff_id
    if start or end:
        rng: dict = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        q["date"] = rng
    docs = await db.attendance.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return docs


# -------- Leaves --------
@api.post("/leaves")
async def apply_leave(body: LeaveIn, user=Depends(get_current_user)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "pending"
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    # Enrich with the staff's center_id so center-bound approval chains route correctly.
    # Without this, a chain bound to (say) Center-A would be skipped because the leave
    # doc has no center_id of its own.
    staff_doc = await db.staff.find_one({"id": doc["staff_id"]}, {"_id": 0, "center_id": 1, "name": 1})
    if staff_doc:
        doc["center_id"] = staff_doc.get("center_id")
        doc["staff_name"] = staff_doc.get("name")
    await _attach_chain_to_request("leave", doc)
    await db.leaves.insert_one(doc)
    doc.pop("_id", None)
    # Notify L1 approver
    if doc.get("chain_snapshot"):
        first = next((s for s in doc["chain_snapshot"] if s.get("level") == 1), None)
        if first:
            for uid in await _resolve_step_user_ids(first, doc):
                if uid and uid != user["id"]:
                    await _notify(uid, "New leave request awaiting your approval",
                                  ntype="leave_pending", ref_id=doc["id"], link="/hrms")
    return doc


@api.get("/leaves")
async def list_leaves(
    staff_id: Optional[str] = None,
    status: Optional[str] = None,
    _=Depends(get_current_user),
):
    q: dict = {}
    if staff_id:
        q["staff_id"] = staff_id
    if status:
        q["status"] = status
    docs = await db.leaves.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for d in docs:
        await _enrich_with_approval_status(d)
    return docs


@api.patch("/leaves/{lid}")
async def decide_leave(lid: str, decision: str = Query(..., pattern="^(approved|rejected)$"),
                       remarks: str = Query(..., min_length=3, description="Mandatory note (min 3 chars)"),
                       user=Depends(require_role("admin", "manager", "center_manager", "hr", "senior_manager"))):
    now = datetime.now(timezone.utc).isoformat()
    res = await db.leaves.find_one_and_update(
        {"id": lid},
        {"$set": {"status": decision, "decided_by": user["id"], "decided_at": now, "decision_remarks": remarks}},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return res


# ============================================================================
# Approval Chain Engine — generic configurable multi-level workflows
# ============================================================================
#
# Chains live in `approval_chains` collection. Each request (reimbursement /
# leave / transaction) that uses a chain stores:
#   - chain_id          : reference
#   - current_level     : 1..N while pending, 0 once final-approved, -1 if rejected
#   - chain_history     : list of {level, action, by_user_id, by_user_name, at, remarks}
#   - chain_snapshot    : snapshot of steps at submit-time so later config edits don't break in-flight items
#
# Endpoints exposed:
#   GET    /api/approval-chains
#   POST   /api/approval-chains          (admin, hr)
#   PUT    /api/approval-chains/{id}     (admin, hr)
#   DELETE /api/approval-chains/{id}     (admin, hr)
#   POST   /api/approvals/act            (any user; checked against current step's resolved approvers)
# ============================================================================


DEFAULT_CHAINS: List[dict] = [
    {
        "name": "Reimbursement — Default (4 levels)",
        "type": "reimbursement",
        "active": True,
        "steps": [
            {"level": 1, "kind": "reports_to", "value": "1", "label": "Direct Manager", "optional": False},
            {"level": 2, "kind": "role",       "value": "hr", "label": "HR", "optional": True},
            {"level": 3, "kind": "role",       "value": "accountant", "label": "Accountant", "optional": False},
            {"level": 4, "kind": "role",       "value": "admin", "label": "Account Officer (Pay)", "optional": False},
        ],
    },
    {
        "name": "Leave — Default (2 levels)",
        "type": "leave",
        "active": True,
        "steps": [
            {"level": 1, "kind": "reports_to", "value": "1", "label": "Direct Manager", "optional": False},
            {"level": 2, "kind": "role",       "value": "hr", "label": "HR", "optional": False},
        ],
    },
    {
        "name": "Transaction — Default (1 level)",
        "type": "transaction",
        "active": True,
        "steps": [
            {"level": 1, "kind": "role", "value": "admin", "label": "Admin", "optional": False},
        ],
    },
    {
        "name": "Asset Purchase — Default (4 levels)",
        "type": "asset_purchase",
        "active": True,
        "steps": [
            {"level": 1, "kind": "role", "value": "center_manager",  "label": "Center Manager (initiator)", "optional": True},
            {"level": 2, "kind": "role", "value": "senior_manager",  "label": "Senior Manager",            "optional": False},
            {"level": 3, "kind": "role", "value": "accountant",      "label": "Accountant",                "optional": False},
            {"level": 4, "kind": "role", "value": "admin",           "label": "Admin (Final)",             "optional": False},
        ],
    },
    {
        "name": "Employee Transfer — Default (3 levels)",
        "type": "employee_transfer",
        "active": True,
        "steps": [
            {"level": 1, "kind": "role", "value": "hr",             "label": "HR Verification",  "optional": False},
            {"level": 2, "kind": "role", "value": "senior_manager", "label": "Senior Manager",   "optional": False},
            {"level": 3, "kind": "role", "value": "admin",          "label": "Admin (Final)",    "optional": False},
        ],
    },
    {
        "name": "Regularisation — Default (1 level)",
        "type": "regularisation",
        "active": True,
        "steps": [
            {"level": 1, "kind": "role", "value": "hr", "label": "HR / Admin", "optional": False},
        ],
    },
    {
        "name": "Quotation — Default (3 levels)",
        "type": "quotation",
        "active": True,
        "steps": [
            {"level": 1, "kind": "role", "value": "center_manager", "label": "Center Manager (initiator)", "optional": True},
            {"level": 2, "kind": "role", "value": "senior_manager", "label": "Senior Manager",            "optional": False},
            {"level": 3, "kind": "role", "value": "admin",          "label": "Admin (Final)",             "optional": False},
        ],
    },
    {
        "name": "Payment — Default (3 levels; Accountant final)",
        "type": "payment",
        "active": True,
        "steps": [
            {"level": 1, "kind": "role", "value": "senior_manager", "label": "Senior Manager",  "optional": False},
            {"level": 2, "kind": "role", "value": "admin",          "label": "Admin",           "optional": False},
            {"level": 3, "kind": "role", "value": "accountant",     "label": "Accountant (Final)", "optional": False},
        ],
    },
]


async def _seed_default_chains():
    """Idempotent: ensure at least one active default chain exists per request type."""
    for default in DEFAULT_CHAINS:
        existing = await db.approval_chains.find_one({"type": default["type"], "active": True}, {"_id": 0})
        if existing:
            continue
        doc = {
            **default,
            "id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": None,
        }
        await db.approval_chains.insert_one(doc)


async def _find_active_chain(req_type: str, center_id: Optional[str] = None) -> Optional[dict]:
    """Find the most-specific active chain for this request type.
    - First look for an active chain matching (type, center_id)
    - Fall back to active chain with center_id=None (global default)
    """
    if center_id:
        specific = await db.approval_chains.find_one(
            {"type": req_type, "active": True, "center_id": center_id}, {"_id": 0},
        )
        if specific:
            return specific
    return await db.approval_chains.find_one(
        {"type": req_type, "active": True, "$or": [{"center_id": None}, {"center_id": {"$exists": False}}]},
        {"_id": 0},
    )


async def _resolve_reports_to_user_ids(submitter_user_id: str, depth: int) -> List[str]:
    """Walk the reports_to chain `depth` steps up from the submitter's staff record.
    Returns the linked user_id of the resolved staff (list with 0 or 1 entry)."""
    staff = await db.staff.find_one({"user_id": submitter_user_id}, {"_id": 0})
    if not staff:
        return []
    current = staff
    for _ in range(depth):
        boss_id = current.get("reports_to_id")
        if not boss_id:
            return []
        current = await db.staff.find_one({"id": boss_id}, {"_id": 0})
        if not current:
            return []
    target_user_id = current.get("user_id")
    return [target_user_id] if target_user_id else []


async def _resolve_step_user_ids(step: dict, request_doc: dict) -> List[str]:
    """Return list of user_ids who are eligible to act on this step for this request."""
    kind = step.get("kind")
    value = step.get("value", "")
    if kind == "role":
        q: dict = {"role": value}
        # Center-isolation: partner / center_partner / center_manager / center_staff
        # approvers must be MAPPED to the request's center via User Management
        # (assigned_center_ids). Without this, EVERY user of that role in the
        # system would receive every request — leaking unrelated centers'
        # workflow. Other roles (admin, hr, accountant, senior_manager, …)
        # remain GLOBAL by design.
        if value in ("partner", "center_partner", "center_manager", "center_staff"):
            cid = request_doc.get("center_id")
            if cid:
                q["assigned_center_ids"] = cid
            else:
                # No center on the request → fall back to global (admin-only scenarios).
                pass
        users = await db.users.find(q, {"_id": 0, "id": 1}).to_list(2000)
        return [u["id"] for u in users]
    if kind == "user":
        return [value] if value else []
    if kind == "staff":
        if not value:
            return []
        s = await db.staff.find_one({"id": value}, {"_id": 0, "user_id": 1, "email": 1})
        if not s:
            return []
        # Primary: linked user_id stored on the staff record
        if s.get("user_id"):
            return [s["user_id"]]
        # Fallback: resolve via staff.email → users.email (case-insensitive). Many staff are
        # added without an explicit login linkage; if their email matches a registered user
        # we still want approvals to route to that user instead of silently dead-ending.
        if s.get("email"):
            u = await db.users.find_one(
                {"email": {"$regex": f"^{re.escape(s['email'])}$", "$options": "i"}},
                {"_id": 0, "id": 1},
            )
            if u:
                # Self-heal: persist the linkage so future lookups are cheap.
                await db.staff.update_one({"id": value}, {"$set": {"user_id": u["id"]}})
                return [u["id"]]
        return []
    if kind == "reports_to":
        try:
            depth = max(1, int(value or "1"))
        except (ValueError, TypeError):
            depth = 1
        submitter_id = request_doc.get("created_by")
        if not submitter_id:
            return []
        return await _resolve_reports_to_user_ids(submitter_id, depth)
    return []


async def _attach_chain_to_request(req_type: str, request_doc: dict) -> dict:
    """Look up active chain, snapshot it onto the request_doc, set current_level=1.
    Mutates and returns the same doc. If no chain is configured, leaves doc unchanged.

    Center-scoping: if the request_doc has a center_id, prefer a chain bound to that
    center over the global default. Used so each center can have its own approvers."""
    chain = await _find_active_chain(req_type, center_id=request_doc.get("center_id"))
    if not chain or not chain.get("steps"):
        request_doc["chain_id"] = None
        request_doc["current_level"] = None
        request_doc["chain_snapshot"] = []
        request_doc["chain_history"] = []
        return request_doc
    steps = sorted(chain["steps"], key=lambda s: s.get("level", 0))
    request_doc["chain_id"] = chain["id"]
    request_doc["current_level"] = 1
    request_doc["chain_snapshot"] = _json_safe(steps)
    request_doc["chain_history"] = []
    return request_doc


async def _resolve_pending_approvers(request_doc: dict) -> List[dict]:
    """Return the list of users who can act on the CURRENT step of the request.
    Each entry: {id, name, email, role}. Used for creator-visible tracking so
    they can see whose approval is holding up their submission."""
    if request_doc.get("status") not in ("pending", "in_progress", "payment_pending"):
        return []
    step = await _current_step(request_doc)
    if not step:
        return []
    uids = await _resolve_step_user_ids(step, request_doc)
    if not uids:
        return []
    users = await db.users.find(
        {"id": {"$in": uids}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).to_list(200)
    return users


async def _enrich_with_approval_status(doc: dict) -> dict:
    """Attach `pending_with` (list of approvers), `current_step_label`, and
    `total_steps` fields to a request doc so the creator's UI can show
    'Currently pending with: Rakesh Kumar (Senior Manager)'."""
    if not doc:
        return doc
    # Sanitise any residual ObjectId that may have snuck into legacy docs
    # (particularly nested inside chain_snapshot) so this doc is safe to return.
    if "chain_snapshot" in doc:
        doc["chain_snapshot"] = _json_safe(doc.get("chain_snapshot") or [])
    if "chain_history" in doc:
        doc["chain_history"] = _json_safe(doc.get("chain_history") or [])
    step = await _current_step(doc)
    doc["current_step_label"] = (step or {}).get("label") if step else None
    doc["current_step_kind"] = (step or {}).get("kind") if step else None
    doc["current_step_value"] = (step or {}).get("value") if step else None
    doc["total_steps"] = len(doc.get("chain_snapshot") or [])
    doc["pending_with"] = await _resolve_pending_approvers(doc)
    return doc


async def _current_step(request_doc: dict) -> Optional[dict]:
    snap = request_doc.get("chain_snapshot") or []
    cur = request_doc.get("current_level")
    if not snap or not cur or cur < 1:
        return None
    for s in snap:
        if s.get("level") == cur:
            return s
    return None


async def _user_can_act_on_request(user: dict, request_doc: dict) -> bool:
    # Admin bypass: admin can always act on any pending step
    if user.get("role") == "admin":
        return True
    step = await _current_step(request_doc)
    if not step:
        return False
    eligible = await _resolve_step_user_ids(step, request_doc)
    return user["id"] in eligible


def _history_entry(level: int, action: str, user: dict, remarks: str = "") -> dict:
    return {
        "level": level,
        "action": action,
        "by_user_id": user["id"],
        "by_user_name": user.get("name") or user.get("email"),
        "at": datetime.now(timezone.utc).isoformat(),
        "remarks": remarks or "",
    }


def _approval_link(req_type: str) -> str:
    """Frontend route to open for a given approval request type's notifications."""
    return {
        "transaction":       "/transactions",
        "leave":             "/hrms",
        "reimbursement":     "/hrms",
        "asset_purchase":    "/assets",
        "employee_transfer": "/employee-transfers",
        "regularisation":    "/pending-approvals",
        "quotation":         "/quotations",
        "payment":           "/quotations",
    }.get(req_type, "/pending-approvals")


def _count_leave_days(start_date: str, end_date: str) -> float:
    """Inclusive day-count between two YYYY-MM-DD strings. Returns 1 if either parse fails."""
    try:
        s = datetime.fromisoformat(start_date)
        e = datetime.fromisoformat(end_date)
        days = (e.date() - s.date()).days + 1
        return float(max(1, days))
    except (ValueError, TypeError):
        return 1.0


async def _deduct_leave_balance_on_approve(leave_rec: dict) -> None:
    """If the leave request links a leave_type_id and the staff has a balance row for the
    leave's year, increment used + recompute balance. Silently no-ops if no balance row
    is configured (some staff may not have allocations)."""
    lt_id = leave_rec.get("leave_type_id")
    staff_id = leave_rec.get("staff_id")
    start = leave_rec.get("start_date") or ""
    if not (lt_id and staff_id and start):
        return
    try:
        year = int(start[:4])
    except (ValueError, TypeError):
        return
    days = _count_leave_days(start, leave_rec.get("end_date") or start)
    bal = await db.leave_balances.find_one(
        {"staff_id": staff_id, "leave_type_id": lt_id, "year": year}, {"_id": 0},
    )
    if not bal:
        return
    used = (bal.get("used", 0) or 0) + days
    allocated = bal.get("allocated", 0) or 0
    await db.leave_balances.update_one(
        {"id": bal["id"]},
        {"$set": {
            "used": used,
            "balance": max(0, allocated - used),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


# -------- Approval Chain CRUD --------
async def _validate_chain_steps(steps: list) -> None:
    """Validate step values resolve to a real approver. Raise 400 with a helpful message
    if a non-optional step is misconfigured (so admins don't silently dead-end approvals)."""
    for s in steps:
        kind = s.get("kind")
        value = (s.get("value") or "").strip()
        lvl = s.get("level")
        if s.get("optional"):
            continue
        if kind in ("role", "user", "staff") and not value:
            raise HTTPException(400, f"Level {lvl}: please choose a {kind} for the approver")
        if kind == "staff" and value:
            st = await db.staff.find_one({"id": value}, {"_id": 0, "user_id": 1, "email": 1, "name": 1})
            if not st:
                raise HTTPException(400, f"Level {lvl}: selected staff no longer exists")
            if not st.get("user_id"):
                # Try email-based linkage so admins don't have to provision a login first.
                if st.get("email"):
                    u = await db.users.find_one(
                        {"email": {"$regex": f"^{re.escape(st['email'])}$", "$options": "i"}},
                        {"_id": 0, "id": 1},
                    )
                    if u:
                        await db.staff.update_one({"id": value}, {"$set": {"user_id": u["id"]}})
                        continue
                raise HTTPException(
                    400,
                    f"Level {lvl}: staff '{st.get('name')}' has no linked login account. "
                    "Open Users → Add user with their email so approvals can route to them.",
                )
        if kind == "user" and value:
            u = await db.users.find_one({"id": value}, {"_id": 0, "id": 1})
            if not u:
                raise HTTPException(400, f"Level {lvl}: selected user no longer exists")


@api.get("/approval-chains", response_model=List[ApprovalChainOut])
async def list_approval_chains(_=Depends(get_current_user)):
    docs = await db.approval_chains.find({}, {"_id": 0}).sort([("type", 1), ("created_at", 1)]).to_list(200)
    return docs


@api.post("/approval-chains", response_model=ApprovalChainOut)
async def create_approval_chain(body: ApprovalChainIn, user=Depends(require_role("admin", "hr"))):
    doc = body.model_dump()
    if not doc["steps"]:
        raise HTTPException(400, "At least one approval step is required")
    # Normalise step levels: re-index 1..N to avoid duplicates/gaps
    sorted_steps = sorted(doc["steps"], key=lambda s: s.get("level", 0))
    for i, s in enumerate(sorted_steps, 1):
        s["level"] = i
    doc["steps"] = sorted_steps
    # Per-step value validation: 'staff' / 'user' / 'role' MUST have a non-empty value,
    # otherwise the chain silently dead-ends at that level and the request never reaches an approver.
    await _validate_chain_steps(sorted_steps)
    # If activated, deactivate other chains of same (type, center_id) to keep one active per scope.
    # Chains for different centers (or one center vs global) can coexist as active.
    if doc.get("active"):
        await db.approval_chains.update_many(
            {"type": doc["type"], "active": True,
             "center_id": doc.get("center_id")},
            {"$set": {"active": False}},
        )
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["created_by"] = user["id"]
    await db.approval_chains.insert_one(doc)
    return doc


@api.put("/approval-chains/{cid}", response_model=ApprovalChainOut)
async def update_approval_chain(cid: str, body: ApprovalChainIn, _=Depends(require_role("admin", "hr"))):
    update = body.model_dump()
    if not update["steps"]:
        raise HTTPException(400, "At least one approval step is required")
    sorted_steps = sorted(update["steps"], key=lambda s: s.get("level", 0))
    for i, s in enumerate(sorted_steps, 1):
        s["level"] = i
    update["steps"] = sorted_steps
    await _validate_chain_steps(sorted_steps)
    if update.get("active"):
        await db.approval_chains.update_many(
            {"type": update["type"], "active": True, "center_id": update.get("center_id"),
             "id": {"$ne": cid}},
            {"$set": {"active": False}},
        )
    res = await db.approval_chains.find_one_and_update(
        {"id": cid}, {"$set": update}, return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return res


@api.delete("/approval-chains/{cid}")
async def delete_approval_chain(cid: str, _=Depends(require_role("admin", "hr"))):
    r = await db.approval_chains.delete_one({"id": cid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# -------- Generic act-on-approval endpoint --------
@api.post("/approvals/act")
async def approval_act(body: ApprovalActionIn, user=Depends(get_current_user)):
    """Advance an in-flight reimbursement / leave / transaction along its configured chain.

    On final-approve of a reimbursement, automatically creates the offsetting expense transaction
    (preserving the existing payroll/reimbursement-ledger sync behaviour).
    """
    coll_name = APPROVAL_TYPE_COLL[body.request_type]
    coll = db[coll_name]
    rec = await coll.find_one({"id": body.request_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Request not found")
    # Already finalised?
    if rec.get("current_level") in (0, -1) or rec.get("status") in ("paid", "approved", "rejected"):
        raise HTTPException(400, f"Already finalised (status={rec.get('status')})")
    if not await _user_can_act_on_request(user, rec):
        raise HTTPException(403, "You are not the configured approver for the current step")

    snap = rec.get("chain_snapshot") or []
    cur_level = rec.get("current_level") or 1
    history = list(rec.get("chain_history") or [])
    update: dict = {}

    if body.action == "reject":
        history.append(_history_entry(cur_level, "reject", user, body.remarks or ""))
        update = {
            "current_level": -1,
            "chain_history": history,
            "status": "rejected",
            "rejected_reason": body.remarks or "",
            "rejected_at": datetime.now(timezone.utc).isoformat(),
        }
        await coll.update_one({"id": body.request_id}, {"$set": update})
        # If a payment gets rejected, free up the quotation so a fresh payment can be raised.
        if body.request_type == "payment" and rec.get("quotation_id"):
            await db.quotations.update_one(
                {"id": rec["quotation_id"]},
                {"$set": {"payment_id": None, "status": "approved"}},
            )
        # Notify creator
        if rec.get("created_by") and rec["created_by"] != user["id"]:
            await _notify(rec["created_by"],
                          f"Your {body.request_type} was rejected" + (f": {body.remarks}" if body.remarks else ""),
                          ntype=f"{body.request_type}_rejected", ref_id=body.request_id,
                          link=_approval_link(body.request_type))
        return {"ok": True, "status": "rejected"}

    # Approve flow
    history.append(_history_entry(cur_level, "approve", user, body.remarks or ""))
    # Determine next level (skipping optional steps with no resolvable approver)
    next_level = cur_level + 1
    while True:
        nxt = next((s for s in snap if s.get("level") == next_level), None)
        if nxt is None:
            break  # past the end
        eligible = await _resolve_step_user_ids(nxt, rec)
        if eligible or not nxt.get("optional"):
            break
        # Optional step with no resolvable approver → auto-skip
        history.append({"level": next_level, "action": "auto-skip", "by_user_id": None,
                        "by_user_name": "system", "at": datetime.now(timezone.utc).isoformat(),
                        "remarks": "No approver resolved; optional step skipped"})
        next_level += 1

    is_last = (next((s for s in snap if s.get("level") == next_level), None)) is None

    if is_last:
        # Final approval — finalise per type
        if body.request_type == "reimbursement":
            now = datetime.now(timezone.utc).isoformat()
            staff = await db.staff.find_one({"id": rec["staff_id"]}, {"_id": 0, "name": 1, "center_id": 1})
            center_ctx = await _derive_context_for_center((staff or {}).get("center_id"))
            txn = {
                "id": str(uuid.uuid4()),
                "type": "expense",
                "amount": rec["amount"],
                "date": rec["date"],
                "description": f"Reimbursement: {(staff or {}).get('name','')} — {rec.get('description','')}".strip(),
                "company_id": center_ctx["company_id"],
                "partner_id": center_ctx["partner_id"],
                "center_id": (staff or {}).get("center_id"),
                "project_id": None,
                "items": [], "attachments": rec.get("attachments") or [],
                "created_by": user["id"], "created_at": now,
                "status": "approved", "approved_by": user["id"], "approved_at": now,
                "rejected_reason": None,
            }
            await db.transactions.insert_one(txn)
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "paid",
                "paid_at": now,
                "paid_by": user["id"],
                "txn_id": txn["id"],
            }
        elif body.request_type == "leave":
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "approved",
                "decided_by": user["id"],
                "decided_at": datetime.now(timezone.utc).isoformat(),
            }
            # Auto-deduct from the staff's leave balance if a type is linked + balance row exists for that year.
            await _deduct_leave_balance_on_approve(rec)
        elif body.request_type == "asset_purchase":
            # Final-approval converts request → Asset record + offsetting expense transaction.
            now = datetime.now(timezone.utc).isoformat()
            asset = {
                "id": str(uuid.uuid4()),
                "name": rec.get("name") or "Asset",
                "category": rec.get("category"),
                "serial_no": rec.get("serial_no"),
                "vendor": rec.get("vendor"),
                "purchase_amount": float(rec.get("est_amount") or 0),
                "purchase_date": rec.get("required_date") or now[:10],
                "depreciation_rate_pct": float(rec.get("depreciation_rate_pct") or 0),
                "useful_life_years": rec.get("useful_life_years"),
                "center_id": rec.get("center_id"),
                "assigned_to_staff_id": None,
                "status": "active",
                "attachments": rec.get("attachments") or [],
                "purchase_request_id": rec["id"],
                "created_by": user["id"],
                "created_at": now,
            }
            await db.assets.insert_one(asset)
            txn = None
            if asset["purchase_amount"] > 0:
                asset_ctx = await _derive_context_for_center(asset.get("center_id"))
                txn = {
                    "id": str(uuid.uuid4()),
                    "type": "expense",
                    "amount": asset["purchase_amount"],
                    "date": asset["purchase_date"],
                    "description": f"Asset Purchase: {asset['name']}" + (f" (SN {asset['serial_no']})" if asset.get("serial_no") else ""),
                    "company_id": asset_ctx["company_id"],
                    "partner_id": asset_ctx["partner_id"],
                    "center_id": asset.get("center_id"),
                    "project_id": None,
                    "items": [], "attachments": asset.get("attachments") or [],
                    "created_by": user["id"], "created_at": now,
                    "status": "approved", "approved_by": user["id"], "approved_at": now,
                    "rejected_reason": None,
                    "asset_id": asset["id"],
                }
                await db.transactions.insert_one(txn)
                await db.assets.update_one({"id": asset["id"]}, {"$set": {"txn_id": txn["id"]}})
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "approved",
                "approved_by": user["id"],
                "approved_at": now,
                "asset_id": asset["id"],
                "txn_id": (txn or {}).get("id"),
            }
        elif body.request_type == "employee_transfer":
            # Final-approval applies the transfer: update staff.center_id and stamp transfer doc.
            now = datetime.now(timezone.utc).isoformat()
            if rec.get("staff_id") and rec.get("to_center_id"):
                await db.staff.update_one(
                    {"id": rec["staff_id"]},
                    {"$set": {"center_id": rec["to_center_id"]}},
                )
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "approved",
                "approved_by": user["id"],
                "approved_at": now,
                "applied_at": now,
            }
        elif body.request_type == "regularisation":
            # Final-approval upserts the attendance row for the staff/date as 'regularised'.
            now = datetime.now(timezone.utc).isoformat()
            new_id = str(uuid.uuid4())
            await db.attendance.update_one(
                {"staff_id": rec["staff_id"], "date": rec["date"]},
                {"$set": {
                    "staff_id": rec["staff_id"], "date": rec["date"],
                    "status": rec.get("attendance_status") or "present",
                    "marked_via": "regularised",
                    "marked_at": now, "marked_by": user["id"],
                    "check_in_at": now,
                    "regularised": True, "regularisation_id": rec["id"],
                }, "$setOnInsert": {"id": new_id}},
                upsert=True,
            )
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "approved",
                "decided_by": user["id"],
                "decided_at": now,
                "decision_remarks": body.remarks or "",
            }
        elif body.request_type == "quotation":
            # Final-approval: stamp a per-center QRN. Status → 'approved' (payment can now be raised).
            now = datetime.now(timezone.utc).isoformat()
            qrn = await _next_qrn(rec["center_id"])
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "approved",
                "qrn": qrn,
                "approved_by": user["id"],
                "approved_at": now,
                "rejected_reason": None,
            }
        elif body.request_type == "payment":
            # Final-approval: auto-create the offsetting ledger transaction in the center.
            now = datetime.now(timezone.utc).isoformat()
            ctx = await _derive_context_for_center(rec.get("center_id"))
            txn_type = rec.get("category") or "expense"
            pay_date = rec.get("payment_date") or now[:10]
            desc = f"Payment · QRN {rec.get('qrn','')} · {rec.get('vendor_name','')} — {rec.get('description','')}".strip(" ·—")
            txn = {
                "id": str(uuid.uuid4()),
                "type": txn_type,
                "amount": float(rec["actual_amount"]),
                "date": pay_date,
                "description": desc,
                "company_id": ctx["company_id"],
                "partner_id": ctx["partner_id"],
                "center_id": rec.get("center_id"),
                "project_id": None,
                "items": [], "attachments": rec.get("attachments") or [],
                "source": "quotation_payment",
                "quotation_id": rec.get("quotation_id"),
                "payment_id": rec.get("id"),
                "qrn": rec.get("qrn"),
                "created_by": user["id"], "created_at": now,
                "status": "approved", "approved_by": user["id"], "approved_at": now,
                "rejected_reason": None,
            }
            await db.transactions.insert_one(txn)
            # Reflect final state on both payment + quotation
            await db.quotations.update_one(
                {"id": rec.get("quotation_id")},
                {"$set": {"status": "paid", "txn_id": txn["id"], "paid_at": now}},
            )
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "paid",
                "paid_at": now,
                "paid_by": user["id"],
                "txn_id": txn["id"],
            }
        else:  # transaction
            update = {
                "current_level": 0,
                "chain_history": history,
                "status": "approved",
                "approved_by": user["id"],
                "approved_at": datetime.now(timezone.utc).isoformat(),
                "rejected_reason": None,
            }
        await coll.update_one({"id": body.request_id}, {"$set": update})
        if rec.get("created_by") and rec["created_by"] != user["id"]:
            verb = "paid" if body.request_type == "reimbursement" else "approved"
            await _notify(rec["created_by"], f"Your {body.request_type} was {verb}",
                          ntype=f"{body.request_type}_{verb}", ref_id=body.request_id,
                          link=_approval_link(body.request_type))
        return {"ok": True, "status": update["status"]}

    # Otherwise advance to next level
    update = {"current_level": next_level, "chain_history": history}
    await coll.update_one({"id": body.request_id}, {"$set": update})
    # Notify next approvers
    nxt = next((s for s in snap if s.get("level") == next_level), None)
    if nxt:
        next_uids = await _resolve_step_user_ids(nxt, rec)
        for uid in next_uids:
            if uid != user["id"]:
                await _notify(uid,
                              f"{body.request_type.replace('_',' ').title()} awaiting your approval (Level {next_level}: {nxt.get('label','')})",
                              ntype=f"{body.request_type}_pending", ref_id=body.request_id,
                              link=_approval_link(body.request_type))
    return {"ok": True, "status": "in_progress", "current_level": next_level}


@api.get("/approvals/pending")
async def list_pending_approvals(user=Depends(get_current_user)):
    """Return all requests across types where the current user is the resolved approver
    for the current step. ALSO includes transactions partner-cross-approve-eligible
    for the requesting user (so associated partners see them here)."""
    out: List[dict] = []
    seen_txn_ids: set[str] = set()
    for req_type, coll_name in APPROVAL_TYPE_COLL.items():
        rows = await db[coll_name].find({"current_level": {"$gt": 0}}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        for rec in rows:
            if await _user_can_act_on_request(user, rec):
                step = await _current_step(rec)
                out.append({
                    "request_type": req_type,
                    "request_id": rec["id"],
                    "current_level": rec.get("current_level"),
                    "step_label": (step or {}).get("label"),
                    "summary": {
                        "amount": rec.get("amount") or rec.get("est_amount") or rec.get("actual_amount") or rec.get("estimated_amount"),
                        "date": rec.get("date") or rec.get("start_date") or rec.get("required_date") or rec.get("effective_date") or rec.get("payment_date"),
                        "description": (
                            rec.get("description")
                            or rec.get("reason")
                            or (f"{rec.get('name','Asset')} → {rec.get('category') or ''}".strip(" →")
                                if req_type == "asset_purchase" else None)
                            or (f"{rec.get('staff_name','Staff')} → center {rec.get('to_center_id','')[:8]}"
                                if req_type == "employee_transfer" else None)
                            or (f"Regularise {rec.get('attendance_status','present').upper()} on {rec.get('date','')}"
                                if req_type == "regularisation" else None)
                        ),
                        # Payment-only extras: give the approver full payee context inline so
                        # they don't need to open a second screen to verify account details.
                        "vendor_name": rec.get("vendor_name"),
                        "qrn": rec.get("qrn"),
                        "payment_mode": rec.get("payment_mode"),
                        "payee_account_holder": rec.get("payee_account_holder"),
                        "payee_account_no": rec.get("payee_account_no"),
                        "payee_ifsc": rec.get("payee_ifsc"),
                        "payee_bank_name": rec.get("payee_bank_name"),
                        "payee_upi_id": rec.get("payee_upi_id"),
                        "payee_proof_attachments": rec.get("payee_proof_attachments") or [],
                        "attachments": rec.get("attachments") or [],
                        "chain_history": rec.get("chain_history") or [],
                    },
                    "created_at": rec.get("created_at"),
                    "via": "chain",
                })
                if req_type == "transaction":
                    seen_txn_ids.add(rec["id"])
    # Add partner-cross-approve-eligible transactions (not already in chain list)
    if user.get("role") == "partner":
        pending_txns = await db.transactions.find(
            {"status": "pending"}, {"_id": 0},
        ).sort("created_at", -1).to_list(2000)
        for t in pending_txns:
            if t["id"] in seen_txn_ids:
                continue
            allowed, _reason = await _can_partner_approve(user, t)
            if allowed:
                out.append({
                    "request_type": "transaction",
                    "request_id": t["id"],
                    "current_level": t.get("current_level"),
                    "step_label": "Partner cross-approval",
                    "summary": {
                        "amount": t.get("amount"),
                        "date": t.get("date"),
                        "description": t.get("description"),
                    },
                    "created_at": t.get("created_at"),
                    "via": "partner_cross",
                })
    # Sort newest first
    out.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return out


@api.get("/approvals/status/{request_type}/{request_id}")
async def approval_status(request_type: str, request_id: str, user=Depends(get_current_user)):
    """Return the LIVE approval tracking status for any request — current step
    label, pending approvers (name+role), total steps, chain_history — so the
    creator can see 'Pending with: Rakesh Kumar (Senior Manager)' in the UI.
    """
    if request_type not in APPROVAL_TYPE_COLL:
        raise HTTPException(400, "Invalid request_type")
    coll_name = APPROVAL_TYPE_COLL[request_type]
    rec = await db[coll_name].find_one({"id": request_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    await _enrich_with_approval_status(rec)
    return {
        "request_type": request_type,
        "request_id": request_id,
        "status": rec.get("status"),
        "current_level": rec.get("current_level"),
        "current_step_label": rec.get("current_step_label"),
        "total_steps": rec.get("total_steps"),
        "pending_with": rec.get("pending_with") or [],
        "chain_snapshot": rec.get("chain_snapshot") or [],
        "chain_history": rec.get("chain_history") or [],
    }


@api.post("/approvals/{request_type}/{request_id}/nudge")
async def nudge_approver(request_type: str, request_id: str, user=Depends(get_current_user)):
    """Send a polite reminder notification to the currently-pending approver(s).
    Only the request submitter (or admin/HR) can nudge."""
    if request_type not in APPROVAL_TYPE_COLL:
        raise HTTPException(400, "Invalid request_type")
    coll_name = APPROVAL_TYPE_COLL[request_type]
    rec = await db[coll_name].find_one({"id": request_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if not (user.get("role") in ("admin", "hr") or rec.get("created_by") == user["id"]):
        raise HTTPException(403, "Only the submitter (or admin/HR) can nudge")
    if not rec.get("current_level") or rec["current_level"] <= 0:
        raise HTTPException(400, "Request is not pending — nothing to nudge")
    step = await _current_step(rec)
    if not step:
        raise HTTPException(400, "No current step resolved")
    approver_ids = await _resolve_step_user_ids(step, rec)
    if not approver_ids:
        raise HTTPException(400, "No approver resolvable for current step")
    submitter = await db.users.find_one({"id": rec.get("created_by")}, {"_id": 0, "name": 1, "email": 1})
    name = (submitter or {}).get("name") or user.get("name") or "A staff member"
    for uid in approver_ids:
        if uid == user["id"]:
            continue
        await _notify(
            uid,
            f"Reminder from {name}: please review their pending {request_type} (Level {rec['current_level']}: {step.get('label','')})",
            ntype=f"{request_type}_nudge", ref_id=request_id,
            link=_approval_link(request_type),
        )
    return {"ok": True, "notified": len(approver_ids)}


@api.get("/approvals/{request_type}/{request_id}/timeline")
async def approval_timeline(request_type: str, request_id: str, _=Depends(get_current_user)):
    """Return a human-readable timeline of this request's approval chain.

    Each step shows:
      - level + label
      - resolved approver name(s) (looked up from staff / users)
      - state: "done" / "current" / "pending"
      - action taken (approve/reject/auto-skip) + by_user_name + at + remarks (from chain_history)
    """
    if request_type not in APPROVAL_TYPE_COLL:
        raise HTTPException(400, "Invalid request_type")
    coll_name = APPROVAL_TYPE_COLL[request_type]
    rec = await db[coll_name].find_one({"id": request_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Request not found")
    snap = rec.get("chain_snapshot") or []
    history = rec.get("chain_history") or []
    cur_level = rec.get("current_level") or 0
    overall_status = rec.get("status")

    # Pre-load users for name lookup
    user_ids: set = set()
    for h in history:
        if h.get("by_user_id"):
            user_ids.add(h["by_user_id"])
    if user_ids:
        users = await db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)
        user_map = {u["id"]: u for u in users}
    else:
        user_map = {}

    timeline: List[dict] = []
    for step in sorted(snap, key=lambda s: s.get("level", 0)):
        lvl = step.get("level")
        # State derivation
        if overall_status in ("rejected",) and any(h.get("level") == lvl and h.get("action") == "reject" for h in history):
            state = "rejected"
        elif cur_level == 0 or (cur_level == -1 and any(h.get("level") == lvl and h.get("action") in ("approve", "auto-skip") for h in history)):
            state = "done" if any(h.get("level") == lvl and h.get("action") in ("approve", "auto-skip") for h in history) else "skipped"
        elif lvl < cur_level:
            state = "done"
        elif lvl == cur_level:
            state = "current"
        else:
            state = "pending"

        # Resolve approver name(s)
        approver_ids = await _resolve_step_user_ids(step, rec)
        approver_names = []
        if approver_ids:
            ulist = await db.users.find({"id": {"$in": approver_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(50)
            approver_names = [u.get("name") or u.get("email") or u["id"][:8] for u in ulist]
        elif step.get("kind") == "role":
            approver_names = [f"(no user with role: {step.get('value')})"]

        # History entry for this level (if any)
        h_for_level = [h for h in history if h.get("level") == lvl]
        action_log = []
        for h in h_for_level:
            by = h.get("by_user_name") or (user_map.get(h.get("by_user_id"), {}).get("name") if h.get("by_user_id") else "system")
            action_log.append({
                "action": h.get("action"),
                "by": by,
                "at": h.get("at"),
                "remarks": h.get("remarks") or "",
            })

        timeline.append({
            "level": lvl,
            "label": step.get("label") or f"Level {lvl}",
            "kind": step.get("kind"),
            "value": step.get("value"),
            "optional": step.get("optional", False),
            "approver_names": approver_names,
            "state": state,
            "history": action_log,
        })

    return {
        "request_type": request_type,
        "request_id": request_id,
        "status": overall_status,
        "current_level": cur_level,
        "total_levels": len(snap),
        "created_by_id": rec.get("created_by"),
        "created_at": rec.get("created_at"),
        "amount": rec.get("amount"),
        "description": rec.get("description") or rec.get("reason"),
        "timeline": timeline,
    }


# -------- Reimbursements (3-stage approval) --------
@api.post("/reimbursements")
async def submit_reimbursement(body: ReimbursementIn, user=Depends(get_current_user)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "submitted"
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    # snapshot approver chain (legacy fields kept for back-compat with old endpoints)
    staff = await db.staff.find_one({"id": body.staff_id}, {"_id": 0})
    doc["l1_approver_id"] = staff.get("reports_to_id") if staff else None
    # Enrich doc with the staff's center_id so center-bound chains route correctly.
    if staff:
        doc["center_id"] = staff.get("center_id")
        doc["staff_name"] = staff.get("name")
    doc["l1_approved_at"] = None
    doc["l1_approved_by"] = None
    doc["accountant_approved_at"] = None
    doc["accountant_approved_by"] = None
    doc["paid_at"] = None
    doc["paid_by"] = None
    doc["txn_id"] = None
    doc["rejected_reason"] = None
    doc["rejected_at"] = None
    # Attach configurable approval chain
    await _attach_chain_to_request("reimbursement", doc)
    await db.reimbursements.insert_one(doc)
    doc.pop("_id", None)
    # Notify the first-level approver via the chain (fallback to legacy L1 if no chain)
    notified_uids: set = set()
    if doc.get("chain_snapshot"):
        first_step = next((s for s in doc["chain_snapshot"] if s.get("level") == 1), None)
        if first_step:
            for uid in await _resolve_step_user_ids(first_step, doc):
                if uid and uid != user["id"]:
                    notified_uids.add(uid)
    if not notified_uids:
        legacy_uid = await _user_id_for_staff(doc.get("l1_approver_id"))
        if legacy_uid and legacy_uid != user["id"]:
            notified_uids.add(legacy_uid)
    for uid in notified_uids:
        await _notify(uid, f"New reimbursement awaiting your approval (₹{doc.get('amount', 0):,.0f})",
                      ntype="reimb_pending", ref_id=doc["id"], link="/hrms")
    return doc


@api.get("/reimbursements")
async def list_reimbursements(
    staff_id: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user),
):
    q: dict = {}
    role = user.get("role")
    if staff_id:
        q["staff_id"] = staff_id
    if status:
        q["status"] = status
    # If staff (logged-in user maps to a staff record), default-scope to own + ones they need to approve
    if role not in ("admin", "accountant", "manager"):
        my_staff = await _staff_for_user(user["id"])
        my_sid = my_staff["id"] if my_staff else None
        clauses: list = [{"created_by": user["id"]}]
        if my_sid:
            clauses.append({"staff_id": my_sid})
            clauses.append({"l1_approver_id": my_sid})
        q["$or"] = clauses
    docs = await db.reimbursements.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    for d in docs:
        await _enrich_with_approval_status(d)
    return docs


async def _check_l1_approver(rid: str, user: dict) -> dict:
    rec = await db.reimbursements.find_one({"id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if user.get("role") in ("admin", "hr"):
        return rec
    # must be the snapshot l1 approver via their linked staff record
    my_staff = await _staff_for_user(user["id"])
    if not my_staff or rec.get("l1_approver_id") != my_staff["id"]:
        raise HTTPException(403, "Only the assigned higher-post approver can act on this request")
    return rec


@api.patch("/reimbursements/{rid}/l1-approve")
async def reimb_l1_approve(rid: str, user=Depends(get_current_user)):
    rec = await _check_l1_approver(rid, user)
    if rec["status"] != "submitted":
        raise HTTPException(400, f"Cannot L1-approve from status={rec['status']}")
    res = await db.reimbursements.find_one_and_update(
        {"id": rid},
        {"$set": {"status": "l1_approved",
                  "l1_approved_at": datetime.now(timezone.utc).isoformat(),
                  "l1_approved_by": user["id"]}},
        return_document=True,
    )
    res.pop("_id", None)
    # Notify all accountants + admins (next stage)
    await _notify(await _accountant_admin_user_ids(),
                  f"Reimbursement L1-approved, awaiting accountant (₹{res.get('amount', 0):,.0f})",
                  ntype="reimb_acct_pending", ref_id=rid, link="/hrms")
    return res


@api.patch("/reimbursements/{rid}/accountant-approve")
async def reimb_accountant_approve(rid: str, user=Depends(require_role("admin", "accountant", "hr"))):
    rec = await db.reimbursements.find_one({"id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec["status"] != "l1_approved":
        raise HTTPException(400, f"Cannot accountant-approve from status={rec['status']}")
    res = await db.reimbursements.find_one_and_update(
        {"id": rid},
        {"$set": {"status": "accountant_approved",
                  "accountant_approved_at": datetime.now(timezone.utc).isoformat(),
                  "accountant_approved_by": user["id"]}},
        return_document=True,
    )
    res.pop("_id", None)
    # Notify all accountants + admins (next stage: ready to pay)
    await _notify(await _accountant_admin_user_ids(),
                  f"Reimbursement ready to pay (₹{res.get('amount', 0):,.0f})",
                  ntype="reimb_pay_pending", ref_id=rid, link="/hrms")
    return res


@api.patch("/reimbursements/{rid}/pay")
async def reimb_pay(rid: str, user=Depends(require_role("admin", "accountant", "hr"))):
    rec = await db.reimbursements.find_one({"id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec["status"] != "accountant_approved":
        raise HTTPException(400, "Reimbursement must be accountant-approved before payment")
    now = datetime.now(timezone.utc).isoformat()
    staff = await db.staff.find_one({"id": rec["staff_id"]}, {"_id": 0, "name": 1, "center_id": 1})
    reimb_ctx = await _derive_context_for_center((staff or {}).get("center_id"))
    # Auto-create an expense transaction (approved) for ledger sync
    txn = {
        "id": str(uuid.uuid4()),
        "type": "expense",
        "amount": rec["amount"],
        "date": rec["date"],
        "description": f"Reimbursement: {staff.get('name','') if staff else ''} — {rec.get('description','')}".strip(),
        "company_id": reimb_ctx["company_id"],
        "partner_id": reimb_ctx["partner_id"],
        "center_id": (staff or {}).get("center_id"),
        "project_id": None,
        "items": [], "attachments": rec.get("attachments") or [],
        "created_by": user["id"], "created_at": now,
        "status": "approved", "approved_by": user["id"], "approved_at": now,
        "rejected_reason": None,
    }
    await db.transactions.insert_one(txn)
    res = await db.reimbursements.find_one_and_update(
        {"id": rid},
        {"$set": {"status": "paid", "paid_at": now, "paid_by": user["id"], "txn_id": txn["id"]}},
        return_document=True,
    )
    res.pop("_id", None)
    # Notify creator that reimbursement has been paid
    if res.get("created_by") and res["created_by"] != user["id"]:
        await _notify(res["created_by"], f"Your reimbursement was paid (₹{res.get('amount', 0):,.0f})",
                      ntype="reimb_paid", ref_id=rid, link="/hrms")
    return res


@api.patch("/reimbursements/{rid}/reject")
async def reimb_reject(rid: str, body: RejectIn, user=Depends(get_current_user)):
    rec = await db.reimbursements.find_one({"id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    role = user.get("role")
    is_admin_or_acct = role in ("admin", "accountant")
    if not is_admin_or_acct:
        # only the L1 approver can reject before they've approved
        my_staff = await _staff_for_user(user["id"])
        if not my_staff or rec.get("l1_approver_id") != my_staff["id"]:
            raise HTTPException(403, "Not allowed")
    res = await db.reimbursements.find_one_and_update(
        {"id": rid},
        {"$set": {"status": "rejected", "rejected_reason": body.reason or "",
                  "rejected_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True,
    )
    res.pop("_id", None)
    # Notify creator that reimbursement was rejected
    if res.get("created_by") and res["created_by"] != user["id"]:
        await _notify(res["created_by"],
                      "Your reimbursement was rejected" + (f": {body.reason}" if body.reason else ""),
                      ntype="reimb_rejected", ref_id=rid, link="/hrms")
    return res


# -------- Payroll --------
class PayrollLineItem(BaseModel):
    label: str
    amount: float


class PayrollEditIn(BaseModel):
    """Admin/HR can override any component; net auto-recalculated server-side."""
    model_config = ConfigDict(extra="ignore")
    days_present: Optional[float] = None
    basic: Optional[float] = None
    hra: Optional[float] = None
    da: Optional[float] = None
    conveyance: Optional[float] = None
    bonus: Optional[float] = None
    incentive: Optional[float] = None
    pf_deduction: Optional[float] = None
    esi_deduction: Optional[float] = None
    late_deduction: Optional[float] = None  # manual override of computed late
    other_deductions: Optional[List[PayrollLineItem]] = None
    remarks: Optional[str] = None


def _recalc_payroll(doc: dict) -> dict:
    """Compute gross / total_deductions / net from component fields. Mutates and returns doc."""
    earnings = sum([
        doc.get("basic", 0) or 0, doc.get("hra", 0) or 0, doc.get("da", 0) or 0,
        doc.get("conveyance", 0) or 0, doc.get("bonus", 0) or 0, doc.get("incentive", 0) or 0,
    ])
    other_sum = sum((li.get("amount", 0) or 0) for li in (doc.get("other_deductions") or []))
    deductions = sum([
        doc.get("pf_deduction", 0) or 0, doc.get("esi_deduction", 0) or 0,
        doc.get("late_deduction", 0) or 0, other_sum,
    ])
    doc["gross"] = round(earnings, 2)
    doc["deductions"] = round(deductions, 2)
    doc["net"] = round(earnings - deductions, 2)
    return doc


def _compute_late_buckets(rows: List[dict], shift: Optional[dict]) -> dict:
    """Walk attendance rows; for each present day compute late_minutes vs shift start+grace.
    Returns {minor: N, half_day: N, full_day: N, total_late_minutes: M} per user-defined rules:
      - <2h late  → minor (every 3 minor = 1 full day deduct)
      - 2h ≤ x < 6h → half_day count
      - ≥6h → full_day count
    If no shift configured for the staff, returns all zeros (no penalty).
    """
    out = {"minor": 0, "half_day": 0, "full_day": 0, "total_late_minutes": 0}
    if not shift or not shift.get("start_time"):
        return out
    try:
        sh_h, sh_m = (int(x) for x in shift["start_time"].split(":"))
    except (ValueError, AttributeError):
        return out
    shift_start_min = sh_h * 60 + sh_m
    grace = int(shift.get("grace_minutes") or 0)
    for r in rows:
        if r.get("status") != "present":
            continue
        check_in = r.get("check_in_at") or r.get("marked_at")
        if not check_in:
            continue
        try:
            dt = datetime.fromisoformat(check_in.replace("Z", "+00:00"))
            ci_min = dt.hour * 60 + dt.minute
        except (ValueError, AttributeError):
            continue
        late = ci_min - shift_start_min - grace
        if late <= 0:
            continue
        out["total_late_minutes"] += late
        if late >= 360:           # ≥ 6 hours
            out["full_day"] += 1
        elif late >= 120:         # 2 – 6 hours
            out["half_day"] += 1
        else:                     # < 2 hours
            out["minor"] += 1
    return out


@api.post("/payroll/run")
async def payroll_run(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020, le=2100),
    _=Depends(require_role("admin", "accountant", "hr")),
):
    """Generate payroll rows for all staff for the given month.

    Late penalty (per user-defined formula):
      - <2h late  → minor: every 3 minor counts = 1 day deducted
      - 2h-6h     → half-day (0.5 day deducted)
      - ≥6h       → full-day (1 day deducted)
      Final late_days = (minor // 3) + 0.5*half_day + 1.0*full_day
      late_deduction = late_days × per_day_rate (or pro-rated monthly_salary/working_days)
    """
    import calendar
    last_day = calendar.monthrange(year, month)[1]
    start = f"{year:04d}-{month:02d}-01"
    end = f"{year:04d}-{month:02d}-{last_day:02d}"

    staff_docs = await db.staff.find({}, {"_id": 0}).to_list(2000)
    created: list = []
    for s in staff_docs:
        rows = await db.attendance.find({"staff_id": s["id"], "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(1000)
        days_present = 0.0
        for r in rows:
            st = r.get("status")
            if st == "present":
                days_present += 1
            elif st == "half":
                days_present += 0.5
        # Late penalty
        shift = None
        if s.get("shift_id"):
            shift = await db.shifts.find_one({"id": s["shift_id"]}, {"_id": 0})
        buckets = _compute_late_buckets(rows, shift)
        late_days = (buckets["minor"] // 3) + 0.5 * buckets["half_day"] + 1.0 * buckets["full_day"]
        per_day = s.get("per_day_rate", 0) or ((s.get("monthly_salary", 0) or 0) / last_day if last_day else 0)
        late_deduction = round(late_days * per_day, 2)
        # Base (basic only; HRA/DA/etc. start at 0 and HR can configure later)
        if s.get("per_day_rate", 0) and days_present > 0:
            basic = s["per_day_rate"] * days_present
        elif s.get("monthly_salary", 0) and days_present > 0:
            basic = (s["monthly_salary"] or 0) * (days_present / last_day)
        else:
            basic = 0

        existing = await db.payroll.find_one({"staff_id": s["id"], "month": month, "year": year})
        if existing:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "staff_id": s["id"],
            "staff_name": s.get("name"),
            "month": month, "year": year,
            "days_present": days_present,
            "working_days": last_day,
            "base_salary": s.get("monthly_salary", 0),
            "per_day_rate": s.get("per_day_rate", 0),
            # Earnings breakdown
            "basic": round(basic, 2),
            "hra": 0.0, "da": 0.0, "conveyance": 0.0,
            "bonus": 0.0, "incentive": 0.0,
            # Deductions
            "pf_deduction": 0.0, "esi_deduction": 0.0,
            "late_deduction": late_deduction,
            "other_deductions": [],
            # Late buckets snapshot
            "late_buckets": buckets,
            "late_days": late_days,
            # Computed
            "gross": 0.0, "deductions": 0.0, "net": 0.0,
            # Lifecycle
            "status": "draft",
            "txn_id": None, "paid_at": None,
            "remarks": None,
            "edited_by": None, "edited_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _recalc_payroll(doc)
        await db.payroll.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)
    return {"created": len(created), "rows": created}


@api.patch("/payroll/{pid}")
async def edit_payroll(pid: str, body: PayrollEditIn, user=Depends(require_role("admin", "hr"))):
    """Admin/HR can override any payroll component. Net auto-recalculated."""
    rec = await db.payroll.find_one({"id": pid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec.get("status") == "paid":
        raise HTTPException(400, "Cannot edit a paid payslip. Reverse the payment first.")
    update = body.model_dump(exclude_none=True)
    if "other_deductions" in update:
        update["other_deductions"] = [li if isinstance(li, dict) else li.model_dump() for li in update["other_deductions"]]
    merged = {**rec, **update}
    _recalc_payroll(merged)
    merged["edited_by"] = user["id"]
    merged["edited_at"] = datetime.now(timezone.utc).isoformat()
    await db.payroll.update_one({"id": pid}, {"$set": {k: merged[k] for k in (
        "days_present", "basic", "hra", "da", "conveyance", "bonus", "incentive",
        "pf_deduction", "esi_deduction", "late_deduction", "other_deductions",
        "gross", "deductions", "net", "remarks", "edited_by", "edited_at",
    ) if k in merged}})
    res = await db.payroll.find_one({"id": pid}, {"_id": 0})
    return res


@api.get("/payroll")
async def list_payroll(month: Optional[int] = None, year: Optional[int] = None, _=Depends(get_current_user)):
    q: dict = {}
    if month:
        q["month"] = month
    if year:
        q["year"] = year
    docs = await db.payroll.find(q, {"_id": 0}).sort([("year", -1), ("month", -1)]).to_list(5000)
    return docs


@api.get("/payroll/bank-csv")
async def payroll_bank_csv(month: int = Query(..., ge=1, le=12), year: int = Query(..., ge=2020, le=2100),
                           status: str = Query("draft", pattern="^(draft|paid|all)$"),
                           _=Depends(require_role("admin", "accountant", "hr"))):
    """Download a bank-transfer CSV for the given month — one row per staff with
    bank details + net amount. Only includes staff with verified bank + non-zero net.
    """
    import io
    q: dict = {"month": month, "year": year}
    if status != "all":
        q["status"] = status
    rows = await db.payroll.find(q, {"_id": 0}).sort("staff_name", 1).to_list(5000)
    staff_ids = [r["staff_id"] for r in rows]
    staff_map = {s["id"]: s for s in await db.staff.find({"id": {"$in": staff_ids}}, {"_id": 0}).to_list(5000)}
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Staff Name", "Account Holder", "Bank Name", "Account No", "IFSC", "Verified", "Net Amount (₹)", "Period", "Notes"])
    skipped = 0
    written = 0
    for r in rows:
        s = staff_map.get(r["staff_id"]) or {}
        if not s.get("bank_account_no") or not s.get("ifsc"):
            skipped += 1
            continue
        if (r.get("net") or 0) <= 0:
            skipped += 1
            continue
        writer.writerow([
            r.get("staff_name") or s.get("name") or "",
            s.get("account_holder_name") or s.get("name") or "",
            s.get("bank_name") or "",
            s.get("bank_account_no") or "",
            s.get("ifsc") or "",
            "Yes" if s.get("bank_verified") else "No",
            round(r.get("net") or 0, 2),
            f"{month:02d}/{year}",
            r.get("remarks") or "",
        ])
        written += 1
    csv_bytes = buf.getvalue().encode("utf-8")
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="payroll_bank_{year}_{month:02d}.csv"',
            "X-Rows-Written": str(written),
            "X-Rows-Skipped": str(skipped),
        },
    )


@api.get("/payroll/my")
async def my_payroll(year: Optional[int] = None, user=Depends(get_current_user)):
    """Current logged-in staff's own payroll/salary history."""
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1, "designation": 1, "monthly_salary": 1, "per_day_rate": 1, "bank_name": 1, "bank_account_no": 1, "ifsc": 1, "bank_verified": 1, "bank_verified_at": 1})
    if not staff:
        return {"staff": None, "payroll": []}
    q: dict = {"staff_id": staff["id"]}
    if year:
        q["year"] = year
    docs = await db.payroll.find(q, {"_id": 0}).sort([("year", -1), ("month", -1)]).to_list(120)
    # Mask bank_account_no for safety
    if staff.get("bank_account_no"):
        staff["bank_account_no_masked"] = "****" + staff["bank_account_no"][-4:]
        staff.pop("bank_account_no", None)
    return {"staff": staff, "payroll": docs}


# -------- Holidays --------
@api.get("/holidays")
async def list_holidays(year: Optional[int] = None, _=Depends(get_current_user)):
    docs = await db.holidays.find({}, {"_id": 0}).sort("date", 1).to_list(500)
    if year:
        docs = [d for d in docs if d.get("is_recurring") or (d.get("date", "")[:4] == str(year))]
    return docs


@api.post("/holidays")
async def create_holiday(body: HolidayIn, user=Depends(require_role("admin", "hr"))):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.holidays.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/holidays/{hid}")
async def delete_holiday(hid: str, _=Depends(require_role("admin", "hr"))):
    r = await db.holidays.delete_one({"id": hid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# -------- Geofences --------
@api.get("/geofences")
async def list_geofences(center_id: Optional[str] = None, _=Depends(get_current_user)):
    q: dict = {"active": True}
    if center_id:
        q["$or"] = [{"center_id": center_id}, {"center_id": None}]
    docs = await db.geofences.find(q, {"_id": 0}).sort("name", 1).to_list(200)
    return docs


@api.post("/geofences")
async def create_geofence(body: GeofenceIn, user=Depends(require_role("admin", "hr"))):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.geofences.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/geofences/{gid}")
async def delete_geofence(gid: str, _=Depends(require_role("admin", "hr"))):
    r = await db.geofences.delete_one({"id": gid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# -------- Shifts --------
@api.get("/shifts")
async def list_shifts(_=Depends(get_current_user)):
    docs = await db.shifts.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return docs


@api.post("/shifts")
async def create_shift(body: ShiftIn, user=Depends(require_role("admin", "hr"))):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.shifts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/shifts/{sid}")
async def update_shift(sid: str, body: ShiftIn, _=Depends(require_role("admin", "hr"))):
    res = await db.shifts.find_one_and_update({"id": sid}, {"$set": body.model_dump()}, return_document=True)
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return res


@api.delete("/shifts/{sid}")
async def delete_shift(sid: str, _=Depends(require_role("admin", "hr"))):
    r = await db.shifts.delete_one({"id": sid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    # Detach from staff to avoid dangling references
    await db.staff.update_many({"shift_id": sid}, {"$set": {"shift_id": None}})
    return {"ok": True}


# -------- Regularisation requests (missed-attendance fix) --------
@api.post("/regularisations")
async def submit_regularisation(body: RegularisationIn, user=Depends(get_current_user)):
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1, "center_id": 1})
    if not staff:
        raise HTTPException(400, "Your user is not linked to any staff record.")
    doc = body.model_dump()
    # Rename `status` → `attendance_status` so it doesn't clash with the chain status
    # ('pending'/'approved'/'rejected') that the unified approval engine writes.
    doc["attendance_status"] = doc.pop("status", "present")
    doc["id"] = str(uuid.uuid4())
    doc["staff_id"] = staff["id"]
    doc["staff_name"] = staff.get("name")
    # Enrich with center_id so center-bound regularisation chains can route correctly.
    doc["center_id"] = staff.get("center_id")
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["status"] = "pending"
    doc["decided_by"] = None
    doc["decided_at"] = None
    doc["decision_remarks"] = None
    # Attach the configurable approval chain so it appears in the unified Pending Approvals inbox.
    await _attach_chain_to_request("regularisation", doc)
    await db.regularisations.insert_one(doc)
    doc.pop("_id", None)
    # Notify L1 approvers (via chain). Fallback to admin/HR broadcast if no chain configured.
    notified = set()
    if doc.get("chain_snapshot"):
        first = next((s for s in doc["chain_snapshot"] if s.get("level") == 1), None)
        if first:
            for uid in await _resolve_step_user_ids(first, doc):
                if uid and uid != user["id"]:
                    notified.add(uid)
    if not notified:
        admins = await db.users.find({"role": {"$in": ["admin", "hr"]}}, {"_id": 0, "id": 1}).to_list(50)
        for a in admins:
            if a["id"] != user["id"]:
                notified.add(a["id"])
    for uid in notified:
        await _notify(uid, f"New attendance regularisation request from {staff.get('name')} for {doc['date']}",
                      ntype="regularisation_pending", ref_id=doc["id"], link="/pending-approvals")
    return doc


@api.get("/regularisations")
async def list_regularisations(status: Optional[str] = None, user=Depends(get_current_user)):
    q: dict = {}
    if status:
        q["status"] = status
    # Staff see only their own; admin/HR see all
    if user.get("role") not in ("admin", "hr", "manager"):
        q["created_by"] = user["id"]
    docs = await db.regularisations.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Lazy chain attach for legacy docs that were created BEFORE iter-26 (no chain_id).
    # We patch them in-place so the unified Pending Approvals inbox + UI can show meaningful
    # progress immediately. Only pending docs are migrated — finalised ones keep their state.
    for d in docs:
        if d.get("status") == "pending" and not d.get("chain_id"):
            await _attach_chain_to_request("regularisation", d)
            if d.get("chain_id"):
                await db.regularisations.update_one(
                    {"id": d["id"]},
                    {"$set": {
                        "chain_id": d.get("chain_id"),
                        "current_level": d.get("current_level"),
                        "chain_snapshot": d.get("chain_snapshot") or [],
                        "chain_history": d.get("chain_history") or [],
                    }},
                )
    for d in docs:
        await _enrich_with_approval_status(d)
    return docs


@api.get("/regularisations/my")
async def my_regularisations(user=Depends(get_current_user)):
    docs = await db.regularisations.find({"created_by": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Same lazy migration so the mobile staff app shows chain progress for older requests.
    for d in docs:
        if d.get("status") == "pending" and not d.get("chain_id"):
            await _attach_chain_to_request("regularisation", d)
            if d.get("chain_id"):
                await db.regularisations.update_one(
                    {"id": d["id"]},
                    {"$set": {
                        "chain_id": d.get("chain_id"),
                        "current_level": d.get("current_level"),
                        "chain_snapshot": d.get("chain_snapshot") or [],
                        "chain_history": d.get("chain_history") or [],
                    }},
                )
    return docs


@api.patch("/regularisations/{rid}")
async def decide_regularisation(rid: str, decision: str = Query(..., pattern="^(approved|rejected)$"),
                                remarks: Optional[str] = Query(None),
                                user=Depends(require_role("admin", "hr", "manager"))):
    rec = await db.regularisations.find_one({"id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec.get("status") != "pending":
        raise HTTPException(400, f"Already {rec.get('status')}")
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "status": decision,
        "decided_by": user["id"],
        "decided_at": now,
        "decision_remarks": remarks or "",
    }
    # On approve, upsert into attendance
    if decision == "approved":
        new_id = str(uuid.uuid4())
        await db.attendance.update_one(
            {"staff_id": rec["staff_id"], "date": rec["date"]},
            {"$set": {
                "staff_id": rec["staff_id"], "date": rec["date"],
                "status": rec.get("attendance_status") or rec.get("status") or "present",
                "marked_via": "regularised",
                "marked_at": now,
                "marked_by": user["id"],
                "check_in_at": now,
                "regularised": True,
                "regularisation_id": rid,
            }, "$setOnInsert": {"id": new_id}},
            upsert=True,
        )
    res = await db.regularisations.find_one_and_update({"id": rid}, {"$set": update}, return_document=True)
    res.pop("_id", None)
    if rec.get("created_by") and rec["created_by"] != user["id"]:
        await _notify(rec["created_by"], f"Your regularisation request for {rec['date']} was {decision}",
                      ntype=f"regularisation_{decision}", ref_id=rid, link="/check-in")
    return res


# ============================================================================
# Vendor Master
# ============================================================================
# Reusable vendor directory — GST, PAN, bank details, contact. Referenced by
# quotations (vendor_id) so procurement analytics (Top-N vendors by spend)
# can roll up spend without string-matching typo'd vendor names.
class VendorIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    contact_person: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_name: Optional[str] = None
    ifsc: Optional[str] = None
    account_holder_name: Optional[str] = None
    notes: Optional[str] = None
    active: bool = True


@api.get("/vendors")
async def list_vendors(user=Depends(get_current_user)):
    """All logged-in users can browse the vendor directory (needed for the
    dropdown in the Quotation form). Only admin/hr/manager/accountant can
    mutate — enforced on write endpoints."""
    docs = await db.vendors.find({}, {"_id": 0}).sort("name", 1).to_list(2000)
    return docs


@api.get("/vendors/{vid}")
async def get_vendor(vid: str, user=Depends(get_current_user)):
    v = await db.vendors.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vendor not found")
    return v


@api.post("/vendors", status_code=201)
async def create_vendor(body: VendorIn, user=Depends(require_role("admin", "hr", "manager", "senior_manager", "accountant"))):
    if not (body.name or "").strip():
        raise HTTPException(400, "Vendor name is required")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_by"] = user["id"]
    doc["created_by_name"] = user.get("name") or user.get("email")
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.vendors.insert_one(doc)
    doc.pop("_id", None)
    return _json_safe(doc)


@api.put("/vendors/{vid}")
async def update_vendor(vid: str, body: VendorIn, user=Depends(require_role("admin", "hr", "manager", "senior_manager", "accountant"))):
    v = await db.vendors.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vendor not found")
    update = body.model_dump()
    update["updated_by"] = user["id"]
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.vendors.update_one({"id": vid}, {"$set": update})
    merged = {**v, **update}
    merged.pop("_id", None)
    return merged


@api.delete("/vendors/{vid}", status_code=204)
async def delete_vendor(vid: str, _=Depends(require_role("admin"))):
    r = await db.vendors.delete_one({"id": vid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Vendor not found")
    return None


@api.get("/reports/top-vendors")
async def top_vendors(
    limit: int = 10,
    days: Optional[int] = None,
    user=Depends(require_finance_visible),
):
    """Aggregate spend per vendor from approved payments (which represent
    real procurement outflows). Returns list sorted by total_spend desc.

    ``days`` filters payments where created_at is within the last N days.
    """
    q: dict = {"status": "paid"}
    if days and days > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        q["created_at"] = {"$gte": cutoff}
    pipe = [
        {"$match": q},
        {"$group": {
            "_id": {"vendor": "$vendor_name", "vendor_id": "$vendor_id"},
            "total_spend": {"$sum": "$actual_amount"},
            "invoice_count": {"$sum": 1},
            "last_paid_at": {"$max": "$created_at"},
        }},
        {"$sort": {"total_spend": -1}},
        {"$limit": int(limit)},
    ]
    rows = await db.payments.aggregate(pipe).to_list(int(limit))
    return [{
        "vendor_id": r["_id"].get("vendor_id"),
        "vendor_name": r["_id"].get("vendor") or "Unknown",
        "total_spend": round(r["total_spend"] or 0, 2),
        "invoice_count": r["invoice_count"],
        "last_paid_at": r["last_paid_at"],
    } for r in rows]


# ============================================================================
# Quotation → QRN → Payment workflow
# ============================================================================
# Two-stage procurement flow:
#   Stage 1: Any non-partner role raises a QUOTATION with vendor+amount+attachments.
#            Approval flows through the configured `quotation` chain (default 3 levels).
#            On final approve, a per-center QRN (Quotation Request Number) is stamped:
#            e.g. `PALOJORI-QRN-0042`. The QRN is unique per center.
#   Stage 2: Once approved, the initiator (or admin/CM) raises a PAYMENT request that
#            references the QRN. Actual amount is editable. Approval flows through the
#            configured `payment` chain. On final approve, an approved EXPENSE
#            transaction is auto-created in the center's ledger, tagged with the QRN,
#            with company_id/partner_id auto-derived (Phase 13).
QuotationCategory = Literal["expense", "investment", "asset"]


class QuotationIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    center_id: str
    category: QuotationCategory = "expense"
    description: str
    vendor_id: Optional[str] = None       # optional — auto-fills from Vendor Master
    vendor_name: str
    estimated_amount: float = Field(gt=0)
    expected_delivery_date: Optional[str] = None
    purpose: Optional[str] = None
    attachments: List[AttachmentRef] = Field(default_factory=list)


class PaymentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    quotation_id: str
    actual_amount: float = Field(gt=0)
    payment_mode: str = Field(..., description="cash | bank | upi | cheque | card")
    payment_date: Optional[str] = None       # YYYY-MM-DD; defaults to today at approval
    txn_type_override: Optional[QuotationCategory] = None  # overrides quotation.category
    notes: Optional[str] = None
    # Payee details — mandatory for bank/upi/cheque so the approver knows exactly WHERE
    # money will land. Cash/card modes skip these (validated in the endpoint).
    payee_account_holder: Optional[str] = None
    payee_account_no: Optional[str] = None
    payee_ifsc: Optional[str] = None
    payee_bank_name: Optional[str] = None
    payee_upi_id: Optional[str] = None
    # Regular payment supporting docs (invoice / receipt / bank slip).
    attachments: List[AttachmentRef] = Field(default_factory=list)
    # Payee proof: cancelled cheque / QR screenshot / bank passbook — REQUIRED for
    # bank/upi/cheque modes so Finance can cross-verify the account before releasing funds.
    payee_proof_attachments: List[AttachmentRef] = Field(default_factory=list)


def _slug_center_prefix(name: str) -> str:
    """Return an uppercase 8-char alnum prefix of the center name, used inside the QRN."""
    if not name:
        return "CENTER"
    stripped = "".join(ch for ch in name.upper() if ch.isalnum())
    return (stripped or "CENTER")[:8]


async def _next_qrn(center_id: str) -> str:
    """Atomically bump the per-center QRN counter and return the formatted QRN string."""
    doc = await db.qrn_counters.find_one_and_update(
        {"center_id": center_id},
        {"$inc": {"counter": 1},
         "$setOnInsert": {"center_id": center_id, "id": str(uuid.uuid4())}},
        upsert=True, return_document=True,
    )
    counter = doc.get("counter") or 1
    center = await db.centers.find_one({"id": center_id}, {"_id": 0, "name": 1})
    prefix = _slug_center_prefix((center or {}).get("name") or "")
    return f"{prefix}-QRN-{counter:04d}"


QUOTATION_CREATORS = ("admin", "hr", "manager", "senior_manager", "accountant", "center_manager", "center_staff")


@api.post("/quotations")
async def create_quotation(body: QuotationIn, user=Depends(get_current_user)):
    """Any non-partner role can raise a quotation request for a center they belong to."""
    if user.get("role") not in QUOTATION_CREATORS:
        raise HTTPException(403, "Partners cannot raise quotations")
    # Center-scope check for center_manager / center_staff
    if user.get("role") in ("center_manager", "center_staff"):
        assigned = user.get("assigned_center_ids") or []
        if body.center_id not in assigned:
            raise HTTPException(403, "You can only raise quotations for centers you are assigned to")
    center = await db.centers.find_one({"id": body.center_id}, {"_id": 0, "name": 1})
    if not center:
        raise HTTPException(404, "Center not found")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "pending"
    doc["center_name"] = center.get("name")
    doc["created_by"] = user["id"]
    doc["created_by_name"] = user.get("name") or user.get("email")
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    # Do NOT materialise qrn=None here — the unique+sparse index on `qrn` still indexes
    # explicit-null values (sparse only skips *missing* fields), so writing null would
    # cause a duplicate-key error on the 2nd pending quotation. Leaving the field absent
    # lets the sparse index correctly skip pre-approval docs. `$set` stamps it on final approve.
    doc["payment_id"] = None
    doc = await _attach_chain_to_request("quotation", doc)
    await db.quotations.insert_one(doc)
    # Notify first-step approvers
    cur = await _current_step(doc)
    if cur:
        for uid in await _resolve_step_user_ids(cur, doc):
            if uid != user["id"]:
                await _notify(uid,
                              f"New quotation from {doc['created_by_name']} — {doc['vendor_name']} · ₹{doc['estimated_amount']:,.0f}",
                              ntype="quotation_pending", ref_id=doc["id"], link="/quotations")
    doc.pop("_id", None)
    return _json_safe(doc)


@api.get("/quotations")
async def list_quotations(
    status_filter: Optional[str] = Query(None, alias="status"),
    center_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    """List quotations. Role scope:
      • admin/hr/senior_manager/accountant → see everything (with optional filters).
      • center_manager/center_staff → see quotations at their assigned centers only.
      • partner → see quotations at centers mapped to them.
      • Everyone also sees quotations they personally raised.
    """
    q: dict = {}
    if status_filter:
        q["status"] = status_filter
    if center_id:
        q["center_id"] = center_id
    role = user.get("role")
    if role in ("center_manager", "center_staff"):
        assigned = user.get("assigned_center_ids") or []
        q["$or"] = [{"center_id": {"$in": assigned}}, {"created_by": user["id"]}]
    elif role == "partner":
        own_pid = user.get("assigned_partner_id")
        centers = await _centers_for_partner(own_pid) if own_pid else []
        q["$or"] = [{"center_id": {"$in": centers}}, {"created_by": user["id"]}]
    docs = await db.quotations.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        await _enrich_with_approval_status(d)
    return docs


@api.get("/quotations/{qid}")
async def get_quotation(qid: str, user=Depends(get_current_user)):
    q = await db.quotations.find_one({"id": qid}, {"_id": 0})
    if not q:
        raise HTTPException(404, "Not found")
    await _enrich_with_approval_status(q)
    return q


@api.delete("/quotations/{qid}")
async def delete_quotation(qid: str, user=Depends(get_current_user)):
    """Creator can delete their own PENDING quotation; admin can delete any non-paid quotation."""
    q = await db.quotations.find_one({"id": qid}, {"_id": 0})
    if not q:
        raise HTTPException(404, "Not found")
    role = user.get("role")
    is_owner = q.get("created_by") == user["id"]
    if not (role == "admin" or (is_owner and q.get("status") == "pending")):
        raise HTTPException(403, "Cannot delete this quotation")
    if q.get("status") == "paid":
        raise HTTPException(400, "Cannot delete a quotation with a linked payment — undo the payment first")
    await db.quotations.delete_one({"id": qid})
    return {"ok": True}


@api.post("/payments")
async def create_payment(body: PaymentIn, user=Depends(get_current_user)):
    """Raise a payment request against an APPROVED quotation."""
    if user.get("role") not in QUOTATION_CREATORS:
        raise HTTPException(403, "Partners cannot raise payment requests")
    q = await db.quotations.find_one({"id": body.quotation_id}, {"_id": 0})
    if not q:
        raise HTTPException(404, "Quotation not found")
    if q.get("status") != "approved":
        raise HTTPException(400, f"Quotation is not approved (status={q.get('status')})")
    if q.get("payment_id"):
        raise HTTPException(400, "A payment request already exists for this quotation")
    if user.get("role") in ("center_manager", "center_staff"):
        assigned = user.get("assigned_center_ids") or []
        if q["center_id"] not in assigned:
            raise HTTPException(403, "You can only raise payments for centers you are assigned to")
    # ---- Payee details validation ----
    mode = (body.payment_mode or "").lower().strip()
    if mode not in ("cash", "bank", "upi", "cheque", "card"):
        raise HTTPException(400, "Invalid payment_mode — must be cash / bank / upi / cheque / card")
    if mode in ("bank", "cheque"):
        missing = [k for k, v in {
            "Account Holder Name": body.payee_account_holder,
            "Account Number": body.payee_account_no,
            "IFSC Code": body.payee_ifsc,
            "Bank Name": body.payee_bank_name,
        }.items() if not (v or "").strip()]
        if missing:
            raise HTTPException(400, f"Bank / Cheque payment requires: {', '.join(missing)}")
        if len(body.payee_proof_attachments or []) == 0:
            raise HTTPException(400, "Please attach a cancelled cheque / bank passbook as proof for Bank/Cheque payment")
    elif mode == "upi":
        if not (body.payee_upi_id or "").strip():
            raise HTTPException(400, "UPI payment requires a valid UPI ID")
        if len(body.payee_proof_attachments or []) == 0:
            raise HTTPException(400, "Please attach a UPI QR screenshot as proof for UPI payment")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["quotation_id"] = q["id"]
    doc["qrn"] = q.get("qrn")
    doc["center_id"] = q["center_id"]
    doc["center_name"] = q.get("center_name")
    doc["category"] = doc.get("txn_type_override") or q.get("category") or "expense"
    doc["description"] = q.get("description")
    doc["vendor_name"] = q.get("vendor_name")
    doc["status"] = "pending"
    doc["created_by"] = user["id"]
    doc["created_by_name"] = user.get("name") or user.get("email")
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["txn_id"] = None
    doc = await _attach_chain_to_request("payment", doc)
    await db.payments.insert_one(doc)
    # Link back to quotation
    await db.quotations.update_one({"id": q["id"]}, {"$set": {"payment_id": doc["id"], "status": "payment_pending"}})
    cur = await _current_step(doc)
    if cur:
        for uid in await _resolve_step_user_ids(cur, doc):
            if uid != user["id"]:
                await _notify(uid,
                              f"Payment approval — QRN {doc.get('qrn')} · ₹{doc['actual_amount']:,.0f}",
                              ntype="payment_pending", ref_id=doc["id"], link="/quotations")
    doc.pop("_id", None)
    return _json_safe(doc)


@api.get("/payments")
async def list_payments(
    status_filter: Optional[str] = Query(None, alias="status"),
    center_id: Optional[str] = None,
    quotation_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    q: dict = {}
    if status_filter:
        q["status"] = status_filter
    if center_id:
        q["center_id"] = center_id
    if quotation_id:
        q["quotation_id"] = quotation_id
    role = user.get("role")
    if role in ("center_manager", "center_staff"):
        assigned = user.get("assigned_center_ids") or []
        q["$or"] = [{"center_id": {"$in": assigned}}, {"created_by": user["id"]}]
    elif role == "partner":
        own_pid = user.get("assigned_partner_id")
        centers = await _centers_for_partner(own_pid) if own_pid else []
        q["$or"] = [{"center_id": {"$in": centers}}, {"created_by": user["id"]}]
    docs = await db.payments.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        await _enrich_with_approval_status(d)
    return docs


@api.get("/payments/{pid}")
async def get_payment(pid: str, user=Depends(get_current_user)):
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Not found")
    await _enrich_with_approval_status(p)
    return p


# -------- Personal endpoints for mobile staff app --------
@api.get("/leaves/my")
async def my_leaves(user=Depends(get_current_user)):
    docs = await db.leaves.find({"created_by": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/reimbursements/my")
async def my_reimbursements(user=Depends(get_current_user)):
    docs = await db.reimbursements.find({"created_by": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api.get("/me/summary")
async def my_summary(user=Depends(get_current_user)):
    """Combined dashboard data for the mobile staff app home tab."""
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0})
    if not staff:
        # Non-staff user (e.g. admin viewing /check-in): keep response shape stable so the
        # frontend can iterate over the arrays without optional-chaining everywhere.
        return {
            "staff": None, "today": None, "month_stats": {}, "pending_counts": {},
            "upcoming_holidays": [], "all_holidays": [], "leave_balances": [],
        }
    today = datetime.now(timezone.utc).date().isoformat()
    today_row = await db.attendance.find_one({"staff_id": staff["id"], "date": today}, {"_id": 0})
    # This month stats — "complete present" = has both check_in_at + check_out_at
    yyyy_mm = today[:7]
    month_rows = await db.attendance.find({"staff_id": staff["id"], "date": {"$regex": f"^{yyyy_mm}"}}, {"_id": 0}).to_list(40)

    def _effective_status(r):
        s = r.get("status")
        if s in ("absent", "leave", "half"):
            return s
        if s == "present" and r.get("check_in_at") and r.get("check_out_at"):
            return "present"
        if s == "present" and r.get("check_in_at") and not r.get("check_out_at"):
            return "incomplete"
        return s or "absent"

    counts = {"present": 0, "absent": 0, "half": 0, "leave": 0, "incomplete": 0}
    for r in month_rows:
        eff = _effective_status(r)
        counts[eff] = counts.get(eff, 0) + 1
    month_stats = {**counts, "total_days": len(month_rows)}
    # Decorate today's row with effective status
    if today_row:
        today_row["effective_status"] = _effective_status(today_row)
    # Pending counts
    pending_leaves = await db.leaves.count_documents({"created_by": user["id"], "status": "pending"})
    pending_reimb = await db.reimbursements.count_documents({"created_by": user["id"], "status": {"$nin": ["paid", "rejected"]}})
    pending_reg = await db.regularisations.count_documents({"created_by": user["id"], "status": "pending"})
    upcoming = await db.holidays.find({"date": {"$gte": today}}, {"_id": 0}).sort("date", 1).to_list(3)
    # Full holiday list for the current calendar year (used by mobile Holidays section)
    yyyy = today[:4]
    all_holidays = await db.holidays.find(
        {"date": {"$regex": f"^{yyyy}"}}, {"_id": 0},
    ).sort("date", 1).to_list(120)
    # Leave balances for the current year + the type definitions (mobile staff app dashboard).
    current_year = int(yyyy)
    raw_balances = await db.leave_balances.find(
        {"staff_id": staff["id"], "year": current_year}, {"_id": 0},
    ).to_list(50)
    leave_types_list = await db.leave_types.find({}, {"_id": 0}).to_list(50)
    types_by_id = {t["id"]: t for t in leave_types_list}
    leave_balances = [
        {**b,
         "leave_type_name": (types_by_id.get(b.get("leave_type_id")) or {}).get("name"),
         "leave_type_color": (types_by_id.get(b.get("leave_type_id")) or {}).get("color")}
        for b in raw_balances
    ]
    # Shift info if assigned
    shift = None
    if staff.get("shift_id"):
        shift = await db.shifts.find_one({"id": staff["shift_id"]}, {"_id": 0})
    return {
        "staff": {k: staff.get(k) for k in ("id", "name", "designation", "monthly_salary", "per_day_rate", "joining_date", "center_id", "bank_name", "shift_id")},
        "shift": shift,
        "today": today_row,
        "month_stats": month_stats,
        "pending_counts": {"leaves": pending_leaves, "reimbursements": pending_reimb, "regularisations": pending_reg},
        "upcoming_holidays": upcoming,
        "all_holidays": all_holidays,
        "leave_balances": leave_balances,
    }


@api.patch("/payroll/{pid}/pay")
async def payroll_pay(pid: str, user=Depends(require_role("admin", "accountant", "hr"))):
    rec = await db.payroll.find_one({"id": pid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec["status"] == "paid":
        raise HTTPException(400, "Already paid")
    now = datetime.now(timezone.utc).isoformat()
    if (rec.get("net") or 0) <= 0:
        # Nothing to pay (0 days_present etc.). Mark paid without creating a zero-amount transaction.
        res = await db.payroll.find_one_and_update(
            {"id": pid},
            {"$set": {"status": "paid", "paid_at": now, "txn_id": None}},
            return_document=True,
        )
        res.pop("_id", None)
        return res
    staff = await db.staff.find_one({"id": rec["staff_id"]}, {"_id": 0, "name": 1, "center_id": 1})
    payroll_ctx = await _derive_context_for_center((staff or {}).get("center_id"))
    txn = {
        "id": str(uuid.uuid4()),
        "type": "expense",
        "amount": rec["net"],
        "date": f"{rec['year']:04d}-{rec['month']:02d}-{rec['working_days']:02d}",
        "description": f"Salary: {staff.get('name','') if staff else ''} {rec['month']}/{rec['year']}",
        "company_id": payroll_ctx["company_id"],
        "partner_id": payroll_ctx["partner_id"],
        "center_id": (staff or {}).get("center_id"),
        "project_id": None,
        "items": [], "attachments": [],
        "created_by": user["id"], "created_at": now,
        "status": "approved", "approved_by": user["id"], "approved_at": now,
        "rejected_reason": None,
    }
    await db.transactions.insert_one(txn)
    res = await db.payroll.find_one_and_update(
        {"id": pid},
        {"$set": {"status": "paid", "paid_at": now, "txn_id": txn["id"]}},
        return_document=True,
    )
    res.pop("_id", None)
    return res


# ---------- Stock View ----------
@api.get("/stock")
async def list_stock(
    center_id: Optional[str] = None,
    txn_type: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    search: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Flatten transaction line-items into a stock-view list.

    Returns one row per item across every transaction (filtered by center / type / date).
    Adds a `is_duplicate` flag = True if the same lowercased item-name appears in
    an earlier transaction (globally, across all centers — chronological by date+created_at).
    The earliest occurrence per name is marked is_duplicate=False ("First").
    """
    q: dict = {}
    if center_id:
        q["center_id"] = center_id
    # Center-manager / center-staff scoping
    role = user.get("role")
    if role in ("center_manager", "center_staff"):
        scoped_ids = user.get("assigned_center_ids") or []
        if center_id and center_id not in scoped_ids:
            return []
        q["center_id"] = {"$in": scoped_ids}
    if txn_type:
        q["type"] = txn_type
    if start or end:
        rng: dict = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        q["date"] = rng

    # Need *all* transactions globally (regardless of center filter) to compute duplicates
    # but we only emit rows for the filtered set. Strategy: load all matching + a separate
    # pass to find first-occurrence-per-name across the *entire* collection (ignoring filters
    # so duplicate flag stays stable across views).
    docs = await db.transactions.find(q, {"_id": 0}).sort([("date", 1), ("created_at", 1)]).to_list(20000)

    # First-occurrence lookup: scan transactions in chronological order (bounded to 50000
    # to keep memory + time predictable on large datasets — the goal is just to find the
    # earliest occurrence per item name, so a sorted scan within this bound is sufficient
    # for any realistic finance-tracker volume).
    seen_first = {}
    cursor = db.transactions.find(
        {}, {"_id": 0, "id": 1, "date": 1, "created_at": 1, "items": 1}
    ).sort([("date", 1), ("created_at", 1)]).limit(50000)
    async for d in cursor:
        for it in (d.get("items") or []):
            n = (it.get("name") or "").strip().lower()
            if not n:
                continue
            if n not in seen_first:
                seen_first[n] = (d.get("date"), d.get("created_at"), d.get("id"))

    # Centers map for names
    cdocs = await db.centers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    cname_by_id = {c["id"]: c["name"] for c in cdocs}

    rows: list = []
    needle = (search or "").strip().lower()
    for d in docs:
        for it in (d.get("items") or []):
            name = (it.get("name") or "").strip()
            if needle and needle not in name.lower():
                continue
            n_low = name.lower()
            first = seen_first.get(n_low)
            is_first_here = first and first[2] == d.get("id") and \
                (first[0] == d.get("date") and first[1] == d.get("created_at"))
            rows.append({
                "txn_id": d.get("id"),
                "txn_type": d.get("type"),
                "txn_status": d.get("status"),
                "date": d.get("date"),
                "center_id": d.get("center_id"),
                "center_name": cname_by_id.get(d.get("center_id")) if d.get("center_id") else None,
                "name": name,
                "quantity": it.get("quantity") or 0,
                "rate": it.get("rate") or 0,
                "amount": it.get("amount") or 0,
                "is_duplicate": bool(first) and not is_first_here,
            })
    # Sort newest first for display
    rows.sort(key=lambda r: (r.get("date") or "", r.get("txn_id") or ""), reverse=True)
    return rows


# ---------- Item Suggestions (autocomplete) ----------
@api.get("/items/suggestions")
async def item_suggestions(q: Optional[str] = None, limit: int = 50, _=Depends(get_current_user)):
    """Return distinct item names previously used in any transaction (case-insensitive prefix match)."""
    pipeline = [
        {"$unwind": "$items"},
        {"$match": {"items.name": {"$ne": ""}}},
        {"$group": {"_id": {"$toLower": "$items.name"}, "name": {"$first": "$items.name"}, "count": {"$sum": 1}}},
    ]
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        pipeline.append({"$match": {"name": rx}})
    pipeline += [
        {"$sort": {"count": -1, "name": 1}},
        {"$limit": max(1, min(limit, 500))},
        {"$project": {"_id": 0, "name": 1, "count": 1}},
    ]
    out = await db.transactions.aggregate(pipeline).to_list(500)
    return out


# ---------- Approval Log (admin-only) ----------
@api.get("/approval-log")
async def approval_log(
    type_filter: Optional[str] = None,  # 'transaction', 'reimbursement', 'leave', 'payroll'
    action: Optional[str] = None,        # 'approved', 'rejected', 'paid', 'l1_approved', 'accountant_approved'
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 500,
    _=Depends(require_role("admin")),
):
    """Unified final-approval feed across transactions, reimbursements, leaves, payroll."""
    rows: list = []

    # User name lookup
    users = await db.users.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(2000)
    uname = {u["id"]: (u.get("name") or u.get("email") or "—") for u in users}

    def _in_range(iso: Optional[str]) -> bool:
        if not iso:
            return False
        d = iso[:10]
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    # Transactions: approved/rejected
    if not type_filter or type_filter == "transaction":
        async for d in db.transactions.find(
            {"status": {"$in": ["approved", "rejected"]}}, {"_id": 0}
        ).sort("approved_at", -1).limit(2000):
            ts = d.get("approved_at") or d.get("created_at")
            if (start or end) and not _in_range(ts):
                continue
            act = d.get("status")
            if action and action != act:
                continue
            rows.append({
                "type": "transaction",
                "action": act,
                "ref_id": d.get("id"),
                "at": ts,
                "by": uname.get(d.get("approved_by")) or "—",
                "amount": d.get("amount"),
                "summary": f"{d.get('type','').title()} — {d.get('description','') or ''}".strip(" —"),
                "remarks": d.get("rejected_reason") or "",
            })

    # Pre-load staff names once for both reimbursement and leave blocks (avoids N+1)
    sdocs = await db.staff.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(5000)
    sname_by_id = {s["id"]: s.get("name", "") for s in sdocs}

    # Reimbursements: emit a row for each completed stage
    if not type_filter or type_filter == "reimbursement":
        async for d in db.reimbursements.find({}, {"_id": 0}).sort("created_at", -1).limit(2000):
            sname = sname_by_id.get(d.get("staff_id"), "")
            base = {"type": "reimbursement", "ref_id": d.get("id"), "amount": d.get("amount"),
                    "summary": f"Reimbursement — {sname}".strip(" —")}
            stages = [
                ("l1_approved",      d.get("l1_approved_at"),       d.get("l1_approved_by")),
                ("accountant_approved", d.get("accountant_approved_at"), d.get("accountant_approved_by")),
                ("paid",             d.get("paid_at"),              d.get("paid_by")),
            ]
            if d.get("status") == "rejected":
                stages.append(("rejected", d.get("rejected_at"), None))
            for act, at, by in stages:
                if not at:
                    continue
                if (start or end) and not _in_range(at):
                    continue
                if action and action != act:
                    continue
                rows.append({**base, "action": act, "at": at,
                             "by": uname.get(by) or "—",
                             "remarks": d.get("rejected_reason", "") if act == "rejected" else ""})

    # Leaves (approved/rejected)
    if not type_filter or type_filter == "leave":
        async for d in db.leaves.find({"status": {"$in": ["approved", "rejected"]}}, {"_id": 0}).sort("decided_at", -1).limit(2000):
            sname = sname_by_id.get(d.get("staff_id"), "")
            at = d.get("decided_at") or d.get("created_at")
            if (start or end) and not _in_range(at):
                continue
            act = d.get("status")
            if action and action != act:
                continue
            rows.append({
                "type": "leave", "action": act, "ref_id": d.get("id"),
                "at": at, "by": uname.get(d.get("decided_by")) or "—", "amount": None,
                "summary": f"Leave — {sname} ({d.get('start_date')} → {d.get('end_date')})",
                "remarks": d.get("reason", "") or "",
            })

    # Payroll (paid)
    if not type_filter or type_filter == "payroll":
        async for d in db.payroll.find({"status": "paid"}, {"_id": 0}).sort("paid_at", -1).limit(2000):
            at = d.get("paid_at")
            if (start or end) and not _in_range(at):
                continue
            if action and action != "paid":
                continue
            rows.append({
                "type": "payroll", "action": "paid", "ref_id": d.get("id"),
                "at": at, "by": uname.get(d.get("paid_by")) or "—",
                "amount": d.get("net"),
                "summary": f"Payroll — {d.get('staff_name','')} {d.get('month')}/{d.get('year')}",
                "remarks": "",
            })

    rows.sort(key=lambda r: r.get("at") or "", reverse=True)
    return rows[: max(1, min(limit, 2000))]


# ---------- Programs (Batches + Milestone Payments) ----------
class BatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    project_id: str
    center_id: Optional[str] = None
    # Company under which this batch's company-share income will be tagged on every
    # milestone receive. Can be overridden at receive-time per milestone.
    company_id: Optional[str] = None
    partner_ids: List[str] = Field(default_factory=list)
    name: str = Field(min_length=1)
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    total_beneficiaries: int = 0
    description: Optional[str] = ""
    # Job-role rows drive the batch role-total: rows of {category 1/2/3, job_role, candidates, hours}
    job_roles: List[dict] = Field(default_factory=list)
    # Outcome counters used for 2nd / 3rd milestone proportional splits + failed-candidate recovery
    passed_candidates: int = Field(default=0, ge=0)
    placed_candidates: int = Field(default=0, ge=0)
    # Partner profit-share % of GROSS milestone income that goes to partners (split equally among
    # partner_ids). Company keeps (100 − this). Default 0 = no partner share (all to company).
    partner_share_percent: float = Field(default=0, ge=0, le=100)
    # When True, batch is closed — no new fooding entries can be created.
    # Set/unset via /batches/{id}/close and /batches/{id}/reopen endpoints.
    closed: bool = False


class BatchOut(BatchIn):
    id: str
    created_at: str


# Category hourly rates (fixed business config — change here if statutory rates revise).
# Category "other" is a custom-rate row — admin enters the rate manually per row (stored
# in r["custom_rate"]). JOB_CATEGORY_RATES lookup returns 0.0 for "other"; effective rate
# is resolved in _compute_batch_milestones.
JOB_CATEGORY_RATES = {"1": 56.35, "2": 52.50, "3": 36.85}
UNIFORM_PER_CANDIDATE = 1000.0  # one-time uniform allowance, applied ONLY on 1st milestone

# Milestone shares of role_total (Σ candidates × rate × hours). Uniform is added on top of 1st only.
MILESTONE_SHARES = {"1st": 0.30, "2nd": 0.40, "3rd": 0.30}


def _compute_batch_milestones(job_roles: list, passed: int = 0, placed: int = 0) -> dict:
    """Return per-milestone breakdown.

    Formula (per user spec):
      role_total      = Σ(candidates × CATEGORY_RATE × hours)
      uniform_total   = total_candidates × ₹1000     (1st milestone only)
      1st_amount      = 30% × role_total + uniform_total
      2nd_gross       = 40% × role_total × (passed / total)
      2nd_recovery    = 30% × role_total × (failed / total)   # already-disbursed for failed
      2nd_net         = 2nd_gross − 2nd_recovery
      3rd_amount      = 30% × role_total × (placed / total)
    """
    rows_out = []
    role_total = 0.0
    total_candidates = 0
    for r in (job_roles or []):
        cat = str(r.get("category", "")).strip()
        # "other" → use per-row custom_rate (default 0 if not set). Cat 1/2/3 use the fixed table.
        if cat == "other":
            rate = float(r.get("custom_rate") or 0)
        else:
            rate = JOB_CATEGORY_RATES.get(cat, 0.0)
        candidates = int(r.get("candidates") or 0)
        hours = float(r.get("hours") or 0)
        row_total = round(candidates * rate * hours, 2)
        role_total += row_total
        total_candidates += candidates
        rows_out.append({
            "category": cat, "job_role": r.get("job_role", "") or "",
            "candidates": candidates, "hours": hours, "rate": rate,
            "row_total": row_total,
            "custom_rate": float(r.get("custom_rate") or 0) if cat == "other" else None,
        })
    role_total = round(role_total, 2)
    uniform_total = round(total_candidates * UNIFORM_PER_CANDIDATE, 2)
    total_candidates = int(total_candidates or 0)
    passed = max(0, min(int(passed or 0), total_candidates))
    placed = max(0, min(int(placed or 0), total_candidates))
    failed = max(0, total_candidates - passed)

    # Compute explicit milestone amounts
    first_amount = round(role_total * MILESTONE_SHARES["1st"] + uniform_total, 2)
    second_gross = round(role_total * MILESTONE_SHARES["2nd"] * (passed / total_candidates), 2) if total_candidates else 0.0
    second_recovery = round(role_total * MILESTONE_SHARES["1st"] * (failed / total_candidates), 2) if total_candidates else 0.0
    second_net = round(second_gross - second_recovery, 2)
    third_amount = round(role_total * MILESTONE_SHARES["3rd"] * (placed / total_candidates), 2) if total_candidates else 0.0

    return {
        "rows": rows_out,
        "role_total": role_total,
        "uniform_total": uniform_total,
        "total_candidates": total_candidates,
        "passed_candidates": passed,
        "failed_candidates": failed,
        "placed_candidates": placed,
        "shares": MILESTONE_SHARES,
        "rates": JOB_CATEGORY_RATES,
        "uniform_per_candidate": UNIFORM_PER_CANDIDATE,
        "by_milestone": {
            "1st": {
                "share_of_role": MILESTONE_SHARES["1st"],
                "role_portion": round(role_total * MILESTONE_SHARES["1st"], 2),
                "uniform": uniform_total,
                "amount": first_amount,
                "based_on": total_candidates,
                "based_on_label": "total candidates",
            },
            "2nd": {
                "share_of_role": MILESTONE_SHARES["2nd"],
                "gross": second_gross,
                "recovery": second_recovery,
                "amount": second_net,
                "based_on": passed,
                "based_on_label": f"{passed}/{total_candidates} passed",
                "failed_count": failed,
            },
            "3rd": {
                "share_of_role": MILESTONE_SHARES["3rd"],
                "amount": third_amount,
                "based_on": placed,
                "based_on_label": f"{placed}/{total_candidates} placed",
            },
        },
    }


# Backward-compat alias for the older endpoint name
def _compute_1st_milestone(job_roles: list) -> dict:
    """Legacy: returns the 1st-milestone-only breakdown (role + uniform). Retained for back-compat."""
    bd = _compute_batch_milestones(job_roles, passed=0, placed=0)
    first = bd["by_milestone"]["1st"]
    return {
        "rows": bd["rows"],
        "role_total": bd["role_total"],
        "uniform_total": bd["uniform_total"],
        "total": first["amount"],
        "total_candidates": bd["total_candidates"],
    }


MilestoneType = Literal["1st", "2nd", "3rd", "other"]


class BatchPaymentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    batch_id: str
    milestone: MilestoneType
    amount: float = Field(gt=0)
    expected_date: Optional[str] = ""
    description: Optional[str] = ""
    # Company under which this milestone's company-share income will be recorded.
    # Optional; if None, the income txn is created without a company tag.
    company_id: Optional[str] = None
    # Uniform amount portion (only relevant on 1st milestone). Excluded from TDS.
    uniform_amount: float = Field(default=0, ge=0)
    # Recovery (only relevant on 2nd milestone): the portion of already-disbursed 1st milestone
    # being claw-backed for candidates who failed the exam. Reduces credited income.
    recovery_amount: float = Field(default=0, ge=0)
    # Assessment fee per passed candidate (only relevant on 2nd milestone, variable per batch
    # so admin enters manually). Total assessment expense = this × passed_candidates.
    assessment_fee_per_candidate: float = Field(default=0, ge=0)
    assessment_fee_total: float = Field(default=0, ge=0)


class BatchPaymentOut(BatchPaymentIn):
    id: str
    status: Literal["pending", "received"] = "pending"
    received_date: Optional[str] = None
    received_by: Optional[str] = None
    txn_id: Optional[str] = None
    txn_ids: List[str] = Field(default_factory=list)
    tds_percent: float = 0
    tds_amount: float = 0
    tds_txn_id: Optional[str] = None
    recovery_txn_id: Optional[str] = None
    assessment_fee_txn_id: Optional[str] = None
    net_amount: Optional[float] = None  # gross − tds − recovery − assessment_fee
    created_at: str


class ReceivePaymentIn(BaseModel):
    """Body for marking a milestone payment as received."""
    model_config = ConfigDict(extra="ignore")
    tds_percent: Literal[0, 2, 10] = 0
    # Optional company override at receive-time. If provided, the company-share income
    # txn is tagged with this company. Falls back to BatchPayment.company_id when omitted.
    company_id: Optional[str] = None


@api.get("/batches", response_model=List[BatchOut])
async def list_batches(project_id: Optional[str] = None, center_id: Optional[str] = None,
                       user=Depends(require_finance_visible)):
    q: dict = {}
    if project_id:
        q["project_id"] = project_id
    if center_id:
        q["center_id"] = center_id
    role = user.get("role")
    if role in ("center_manager", "center_staff"):
        scoped_ids = user.get("assigned_center_ids") or []
        if center_id and center_id not in scoped_ids:
            return []
        q["center_id"] = {"$in": scoped_ids}
    elif role == "partner":
        # Partner sees only batches at centers where they are mapped.
        await _enrich_user_with_associations(user)
        scoped_ids = user.get("_associated_center_ids") or []
        if center_id and center_id not in scoped_ids:
            return []
        if not scoped_ids:
            return []
        q["center_id"] = {"$in": scoped_ids}
    docs = await db.batches.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [BatchOut(**d) for d in docs]


@api.post("/batches", response_model=BatchOut)
async def create_batch(body: BatchIn, _=Depends(require_role("admin", "manager", "senior_manager"))):
    # Validate referenced project / center actually exist
    if not await db.projects.find_one({"id": body.project_id}, {"_id": 0, "id": 1}):
        raise HTTPException(400, "project_id does not exist")
    if body.center_id and not await db.centers.find_one({"id": body.center_id}, {"_id": 0, "id": 1}):
        raise HTTPException(400, "center_id does not exist")
    # Validate all partner_ids
    if body.partner_ids:
        cnt = await db.partners.count_documents({"id": {"$in": body.partner_ids}})
        if cnt != len(set(body.partner_ids)):
            raise HTTPException(400, "one or more partner_ids do not exist")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.batches.insert_one(doc)
    return BatchOut(**doc)


@api.put("/batches/{bid}", response_model=BatchOut)
async def update_batch(bid: str, body: BatchIn, _=Depends(require_role("admin", "manager", "senior_manager"))):
    # Re-validate same FKs as create (project/center/partners)
    if not await db.projects.find_one({"id": body.project_id}, {"_id": 0, "id": 1}):
        raise HTTPException(400, "project_id does not exist")
    if body.center_id and not await db.centers.find_one({"id": body.center_id}, {"_id": 0, "id": 1}):
        raise HTTPException(400, "center_id does not exist")
    if body.partner_ids:
        cnt = await db.partners.count_documents({"id": {"$in": body.partner_ids}})
        if cnt != len(set(body.partner_ids)):
            raise HTTPException(400, "one or more partner_ids do not exist")
    res = await db.batches.find_one_and_update({"id": bid}, {"$set": body.model_dump()}, return_document=True)
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return BatchOut(**res)


@api.delete("/batches/{bid}")
async def delete_batch(bid: str, _=Depends(require_role("admin"))):
    # Cascade delete payments under this batch
    await db.batch_payments.delete_many({"batch_id": bid})
    r = await db.batches.delete_one({"id": bid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.get("/batch-payments", response_model=List[BatchPaymentOut])
async def list_batch_payments(batch_id: Optional[str] = None, user=Depends(require_finance_visible)):
    q: dict = {}
    if batch_id:
        q["batch_id"] = batch_id
    # Partner: restrict to batches at centers where they are mapped.
    if user.get("role") == "partner":
        await _enrich_user_with_associations(user)
        center_ids = user.get("_associated_center_ids") or []
        if not center_ids:
            return []
        scoped_batches = await db.batches.find(
            {"center_id": {"$in": center_ids}}, {"_id": 0, "id": 1},
        ).to_list(5000)
        allowed = [b["id"] for b in scoped_batches]
        if batch_id and batch_id not in allowed:
            return []
        q["batch_id"] = {"$in": allowed}
    docs = await db.batch_payments.find(q, {"_id": 0}).sort([("batch_id", 1), ("milestone", 1)]).to_list(5000)
    return [BatchPaymentOut(**d) for d in docs]


@api.get("/batches/{bid}/compute-1st-milestone")
async def compute_first_milestone(bid: str, _=Depends(get_current_user)):
    """Returns the auto-computed 1st milestone breakdown for the batch's job_roles.
    (Legacy endpoint — for full 3-milestone breakdown use /compute-milestones.)"""
    batch = await db.batches.find_one({"id": bid}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    breakdown = _compute_1st_milestone(batch.get("job_roles") or [])
    breakdown["rates"] = JOB_CATEGORY_RATES
    breakdown["uniform_per_candidate"] = UNIFORM_PER_CANDIDATE
    return breakdown


@api.get("/batches/{bid}/compute-milestones")
async def compute_milestones(bid: str, _=Depends(get_current_user)):
    """Full 3-milestone breakdown including 2nd-milestone recovery for failed candidates.

    Formula (per spec):
      1st = 30% × role_total + uniform_total
      2nd = (40% × role_total × passed/total) − (30% × role_total × failed/total)  ← recovery
      3rd = 30% × role_total × placed/total
    """
    batch = await db.batches.find_one({"id": bid}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    return _compute_batch_milestones(
        batch.get("job_roles") or [],
        passed=int(batch.get("passed_candidates") or 0),
        placed=int(batch.get("placed_candidates") or 0),
    )


@api.post("/batch-payments", response_model=BatchPaymentOut)
async def create_batch_payment(body: BatchPaymentIn, _=Depends(require_role("admin", "manager", "senior_manager", "accountant"))):
    # Enforce one-row-per (batch_id, milestone)
    existing = await db.batch_payments.find_one({"batch_id": body.batch_id, "milestone": body.milestone})
    if existing:
        raise HTTPException(400, f"{body.milestone} milestone already exists for this batch")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "pending"
    doc["received_date"] = None
    doc["received_by"] = None
    doc["txn_id"] = None
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.batch_payments.insert_one(doc)
    return BatchPaymentOut(**doc)


@api.put("/batch-payments/{pid}", response_model=BatchPaymentOut)
async def update_batch_payment(pid: str, body: BatchPaymentIn, _=Depends(require_role("admin", "manager", "senior_manager", "accountant"))):
    res = await db.batch_payments.find_one_and_update(
        {"id": pid},
        {"$set": {"amount": body.amount, "expected_date": body.expected_date, "description": body.description}},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return BatchPaymentOut(**res)


@api.patch("/batch-payments/{pid}/receive", response_model=BatchPaymentOut)
async def receive_batch_payment(pid: str, body: ReceivePaymentIn = ReceivePaymentIn(),
                                 user=Depends(require_role("admin", "accountant", "senior_manager"))):
    """Mark a milestone payment as received and auto-create approved transactions.

    Behaviour:
    - Income transaction(s) created at the GROSS milestone amount (per partner split if applicable).
    - If recovery_amount > 0 (only relevant on 2nd milestone): an additional EXPENSE transaction
      (source='candidate_recovery') is created — represents the claw-back of 1st-milestone money
      already paid for candidates who failed the exam. Reduces net P&L.
    - If tds_percent > 0: an additional EXPENSE transaction (source='tds_deduction') is created.
      Taxable base = (gross − uniform_amount − recovery_amount). Uniform (1st milestone only) and
      recovery (2nd milestone) are both excluded from the taxable base by spec.
    - If assessment_fee_total > 0 (2nd milestone only): a separate EXPENSE transaction
      (source='assessment_fee') is recorded for the per-passed-candidate assessment fee.
    - net_amount on the payment row = gross − tds_amount − recovery_amount − assessment_fee_total.
    """
    rec = await db.batch_payments.find_one({"id": pid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec["status"] == "received":
        raise HTTPException(400, "Already received")
    batch = await db.batches.find_one({"id": rec["batch_id"]}, {"_id": 0})
    project_name = ""
    if batch:
        proj = await db.projects.find_one({"id": batch.get("project_id")}, {"_id": 0, "name": 1})
        project_name = (proj or {}).get("name", "")
    now = datetime.now(timezone.utc).isoformat()
    today = now[:10]
    partner_ids = list((batch or {}).get("partner_ids") or [])
    partner_share_pct = float((batch or {}).get("partner_share_percent") or 0)
    gross = float(rec["amount"])
    description_base = f"{project_name} — {batch.get('name','') if batch else ''} — {rec['milestone']} milestone"
    created_txn_ids: list[str] = []

    # Income split: partners get partner_share_pct% of gross (split equally among them),
    # company keeps the rest. If no partners OR partner_share_pct == 0, the whole amount
    # is recorded as company income (partner_id=null).
    partner_pool = round(gross * partner_share_pct / 100.0, 2) if partner_ids and partner_share_pct > 0 else 0.0
    company_amount = round(gross - partner_pool, 2)
    # Resolve company tag for the company-share txn (priority: body override → BatchPayment → Batch)
    company_id_resolved = body.company_id or rec.get("company_id") or (batch or {}).get("company_id")
    splits: list[tuple[Optional[str], float, str]] = []  # (partner_id, amount, suffix)
    if company_amount > 0:
        suffix = f" (company {round(100.0 - partner_share_pct, 2)}% share)" if partner_pool > 0 else ""
        splits.append((None, company_amount, suffix))
    if partner_pool > 0:
        per_partner = round(partner_pool / len(partner_ids), 2)
        # Distribute rounding tail to last partner so the sum is exact
        last = round(partner_pool - per_partner * (len(partner_ids) - 1), 2)
        for idx, pid_split in enumerate(partner_ids):
            amt = last if idx == len(partner_ids) - 1 else per_partner
            sfx = f" (partner share {partner_share_pct}% ÷ {len(partner_ids)} = {round(partner_share_pct / len(partner_ids), 2)}%)"
            splits.append((pid_split, amt, sfx))

    for pid_split, amt, sfx in splits:
        if amt <= 0:
            continue
        txn = {
            "id": str(uuid.uuid4()),
            "type": "income",
            "amount": amt,
            "date": today,
            "description": description_base + sfx,
            # Only the company-share txn carries the company_id; partner txns leave it null
            "company_id": company_id_resolved if pid_split is None else None,
            "partner_id": pid_split,
            "center_id": (batch or {}).get("center_id"),
            "project_id": (batch or {}).get("project_id"),
            "items": [], "attachments": [],
            "source": "milestone",
            "milestone": rec["milestone"],
            "created_by": user["id"], "created_at": now,
            "status": "approved", "approved_by": user["id"], "approved_at": now,
            "rejected_reason": None,
        }
        await db.transactions.insert_one(txn)
        created_txn_ids.append(txn["id"])

    # Candidate-failure recovery (2nd milestone): separate expense to claw back 1st-milestone
    recovery_amount = float(rec.get("recovery_amount") or 0)
    recovery_txn_id = None
    # For non-income auto-txns tagged to this batch, tag with batch's company + first partner
    # (if only one) so they don't dangle in the ledger.
    batch_partner_id = partner_ids[0] if len(partner_ids) == 1 else None
    if recovery_amount > 0:
        rec_txn = {
            "id": str(uuid.uuid4()),
            "type": "expense",
            "amount": recovery_amount,
            "date": today,
            "description": f"Candidate-failure recovery (claw-back of 1st-milestone) on {description_base}",
            "company_id": company_id_resolved,
            "partner_id": batch_partner_id,
            "center_id": (batch or {}).get("center_id"),
            "project_id": (batch or {}).get("project_id"),
            "items": [], "attachments": [],
            "source": "candidate_recovery",
            "milestone": rec["milestone"],
            "created_by": user["id"], "created_at": now,
            "status": "approved", "approved_by": user["id"], "approved_at": now,
            "rejected_reason": None,
        }
        await db.transactions.insert_one(rec_txn)
        recovery_txn_id = rec_txn["id"]

    # Assessment fee (2nd milestone): per-passed-candidate fee, manually entered
    assessment_fee_total = float(rec.get("assessment_fee_total") or 0)
    assessment_fee_per = float(rec.get("assessment_fee_per_candidate") or 0)
    assessment_fee_txn_id = None
    if assessment_fee_total > 0:
        passed_n = int((batch or {}).get("passed_candidates") or 0)
        af_txn = {
            "id": str(uuid.uuid4()),
            "type": "expense",
            "amount": assessment_fee_total,
            "date": today,
            "description": f"Assessment fee on {description_base} "
                           f"(₹{assessment_fee_per:,.2f} × {passed_n} passed)" if assessment_fee_per > 0
                           else f"Assessment fee on {description_base}",
            "company_id": company_id_resolved,
            "partner_id": batch_partner_id,
            "center_id": (batch or {}).get("center_id"),
            "project_id": (batch or {}).get("project_id"),
            "items": [], "attachments": [],
            "source": "assessment_fee",
            "milestone": rec["milestone"],
            "created_by": user["id"], "created_at": now,
            "status": "approved", "approved_by": user["id"], "approved_at": now,
            "rejected_reason": None,
        }
        await db.transactions.insert_one(af_txn)
        assessment_fee_txn_id = af_txn["id"]

    # TDS deduction: calculated on (gross − uniform − recovery) per spec.
    # Uniform (1st milestone only) and recovery (2nd milestone) are both excluded from
    # the taxable base. Assessment fee is a separate post-TDS expense.
    tds_percent = float(body.tds_percent or 0)
    uniform_amount = float(rec.get("uniform_amount") or 0)
    tds_amount = 0.0
    tds_txn_id = None
    if tds_percent > 0:
        taxable = max(0.0, gross - uniform_amount - recovery_amount)
        tds_amount = round(taxable * tds_percent / 100.0, 2)
        if tds_amount > 0:
            tds_txn = {
                "id": str(uuid.uuid4()),
                "type": "expense",
                "amount": tds_amount,
                "date": today,
                "description": f"TDS {tds_percent}% deducted by department on {description_base} (taxable ₹{taxable:,.2f})",
                "company_id": company_id_resolved,
                "partner_id": batch_partner_id,
                "center_id": (batch or {}).get("center_id"),
                "project_id": (batch or {}).get("project_id"),
                "items": [], "attachments": [],
                "source": "tds_deduction",
                "milestone": rec["milestone"],
                "created_by": user["id"], "created_at": now,
                "status": "approved", "approved_by": user["id"], "approved_at": now,
                "rejected_reason": None,
            }
            await db.transactions.insert_one(tds_txn)
            tds_txn_id = tds_txn["id"]

    net_amount = round(gross - tds_amount - recovery_amount - assessment_fee_total, 2)
    res = await db.batch_payments.find_one_and_update(
        {"id": pid},
        {"$set": {
            "status": "received", "received_date": today, "received_by": user["id"],
            "txn_id": created_txn_ids[0] if created_txn_ids else None,
            "txn_ids": created_txn_ids,
            "tds_percent": tds_percent,
            "tds_amount": tds_amount,
            "tds_txn_id": tds_txn_id,
            "recovery_amount": recovery_amount,
            "recovery_txn_id": recovery_txn_id,
            "assessment_fee_total": assessment_fee_total,
            "assessment_fee_per_candidate": assessment_fee_per,
            "assessment_fee_txn_id": assessment_fee_txn_id,
            "company_id": company_id_resolved,
            "net_amount": net_amount,
        }},
        return_document=True,
    )
    res.pop("_id", None)
    return BatchPaymentOut(**res)


@api.delete("/batch-payments/{pid}")
async def delete_batch_payment(pid: str, _=Depends(require_role("admin"))):
    r = await db.batch_payments.delete_one({"id": pid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Batch Close / Reopen ----------
@api.patch("/batches/{bid}/close")
async def close_batch(bid: str, _=Depends(require_role("admin", "manager", "senior_manager"))):
    """Mark a batch as closed. Closed batches reject new fooding entry creation."""
    r = await db.batches.find_one_and_update({"id": bid}, {"$set": {"closed": True}}, return_document=True)
    if not r:
        raise HTTPException(404, "Batch not found")
    r.pop("_id", None)
    return BatchOut(**r)


@api.patch("/batches/{bid}/reopen")
async def reopen_batch(bid: str, _=Depends(require_role("admin"))):
    r = await db.batches.find_one_and_update({"id": bid}, {"$set": {"closed": False}}, return_document=True)
    if not r:
        raise HTTPException(404, "Batch not found")
    r.pop("_id", None)
    return BatchOut(**r)


# ---------- Fooding Income (per-month boarding cost × mandays) ----------
# Each batch can have N monthly fooding entries until it's closed.
# Formula: gross = mandays_claimed × boarding_cost_per_manday.
# On Mark-Received, income transactions are split using the SAME partner_share_percent
# logic as milestone payments. TDS is NOT applied to fooding income (admin spec).

class FoodingEntryIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    batch_id: str
    month: str = Field(min_length=7, max_length=7)  # 'YYYY-MM'
    mandays_claimed: float = Field(ge=0)
    boarding_cost_per_manday: float = Field(ge=0)
    description: Optional[str] = ""


class FoodingEntryOut(FoodingEntryIn):
    id: str
    gross_amount: float = 0
    status: Literal["pending", "received"] = "pending"
    company_id: Optional[str] = None  # tagged at receive time (override or inherits from batch)
    received_date: Optional[str] = None
    received_by: Optional[str] = None
    txn_ids: List[str] = Field(default_factory=list)
    created_at: str
    created_by: Optional[str] = None


def _month_re_ok(m: str) -> bool:
    if not m or len(m) != 7 or m[4] != "-":
        return False
    try:
        y, mm = int(m[:4]), int(m[5:7])
        return 1 <= mm <= 12 and 2000 <= y <= 2100
    except ValueError:
        return False


@api.get("/fooding-entries", response_model=List[FoodingEntryOut])
async def list_fooding(batch_id: Optional[str] = None, _=Depends(get_current_user)):
    q: dict = {}
    if batch_id:
        q["batch_id"] = batch_id
    docs = await db.fooding_entries.find(q, {"_id": 0}).sort([("batch_id", 1), ("month", 1)]).to_list(5000)
    return [FoodingEntryOut(**d) for d in docs]


@api.post("/fooding-entries", response_model=FoodingEntryOut)
async def create_fooding(body: FoodingEntryIn, user=Depends(require_role("admin", "manager", "senior_manager", "accountant"))):
    if not _month_re_ok(body.month):
        raise HTTPException(400, "month must be YYYY-MM")
    batch = await db.batches.find_one({"id": body.batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(400, "batch_id does not exist")
    if batch.get("closed"):
        raise HTTPException(400, "Batch is closed — reopen it before adding fooding entries")
    # Enforce one entry per (batch, month) to avoid double-counting
    if await db.fooding_entries.find_one({"batch_id": body.batch_id, "month": body.month}):
        raise HTTPException(400, f"Fooding entry for {body.month} already exists on this batch")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["gross_amount"] = round(body.mandays_claimed * body.boarding_cost_per_manday, 2)
    doc["status"] = "pending"
    doc["company_id"] = batch.get("company_id")
    doc["received_date"] = None
    doc["received_by"] = None
    doc["txn_ids"] = []
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["created_by"] = user["id"]
    await db.fooding_entries.insert_one(doc)
    return FoodingEntryOut(**doc)


@api.put("/fooding-entries/{fid}", response_model=FoodingEntryOut)
async def update_fooding(fid: str, body: FoodingEntryIn, _=Depends(require_role("admin", "manager", "senior_manager", "accountant"))):
    if not _month_re_ok(body.month):
        raise HTTPException(400, "month must be YYYY-MM")
    rec = await db.fooding_entries.find_one({"id": fid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec.get("status") == "received":
        raise HTTPException(400, "Cannot edit a received entry — delete the linked transactions first")
    update = body.model_dump()
    update["gross_amount"] = round(body.mandays_claimed * body.boarding_cost_per_manday, 2)
    res = await db.fooding_entries.find_one_and_update({"id": fid}, {"$set": update}, return_document=True)
    res.pop("_id", None)
    return FoodingEntryOut(**res)


@api.delete("/fooding-entries/{fid}")
async def delete_fooding(fid: str, _=Depends(require_role("admin"))):
    rec = await db.fooding_entries.find_one({"id": fid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec.get("status") == "received":
        # Cascade delete the linked income transactions
        if rec.get("txn_ids"):
            await db.transactions.delete_many({"id": {"$in": rec["txn_ids"]}})
    await db.fooding_entries.delete_one({"id": fid})
    return {"ok": True}


class FoodingReceiveIn(BaseModel):
    """Optional company_id override at receive-time (else uses Batch.company_id)."""
    model_config = ConfigDict(extra="ignore")
    company_id: Optional[str] = None


@api.patch("/fooding-entries/{fid}/receive", response_model=FoodingEntryOut)
async def receive_fooding(fid: str, body: FoodingReceiveIn = FoodingReceiveIn(),
                          user=Depends(require_role("admin", "accountant", "senior_manager"))):
    """Mark fooding entry as received — creates split income transactions using same
    partner_share_percent logic as milestone payments. NO TDS deduction."""
    rec = await db.fooding_entries.find_one({"id": fid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec.get("status") == "received":
        raise HTTPException(400, "Already received")
    batch = await db.batches.find_one({"id": rec["batch_id"]}, {"_id": 0})
    project_name = ""
    if batch:
        proj = await db.projects.find_one({"id": batch.get("project_id")}, {"_id": 0, "name": 1})
        project_name = (proj or {}).get("name", "")
    gross = float(rec["gross_amount"])
    if gross <= 0:
        raise HTTPException(400, "Cannot receive zero-amount entry")
    now = datetime.now(timezone.utc).isoformat()
    today = now[:10]
    partner_ids = list((batch or {}).get("partner_ids") or [])
    partner_share_pct = float((batch or {}).get("partner_share_percent") or 0)
    company_id_resolved = body.company_id or rec.get("company_id") or (batch or {}).get("company_id")
    description_base = f"Fooding — {project_name} — {batch.get('name','') if batch else ''} — {rec['month']}"
    created_txn_ids: list[str] = []

    partner_pool = round(gross * partner_share_pct / 100.0, 2) if partner_ids and partner_share_pct > 0 else 0.0
    company_amount = round(gross - partner_pool, 2)
    splits: list[tuple[Optional[str], float, str]] = []
    if company_amount > 0:
        sfx = f" (company {round(100.0 - partner_share_pct, 2)}% share)" if partner_pool > 0 else ""
        splits.append((None, company_amount, sfx))
    if partner_pool > 0:
        per_partner = round(partner_pool / len(partner_ids), 2)
        last = round(partner_pool - per_partner * (len(partner_ids) - 1), 2)
        for idx, pid_split in enumerate(partner_ids):
            amt = last if idx == len(partner_ids) - 1 else per_partner
            sfx = f" (partner share {partner_share_pct}% ÷ {len(partner_ids)})"
            splits.append((pid_split, amt, sfx))

    for pid_split, amt, sfx in splits:
        if amt <= 0:
            continue
        txn = {
            "id": str(uuid.uuid4()),
            "type": "income",
            "amount": amt,
            "date": today,
            "description": description_base + sfx,
            "company_id": company_id_resolved if pid_split is None else None,
            "partner_id": pid_split,
            "center_id": (batch or {}).get("center_id"),
            "project_id": (batch or {}).get("project_id"),
            "items": [], "attachments": [],
            "source": "fooding",
            "milestone": None,
            "created_by": user["id"], "created_at": now,
            "status": "approved", "approved_by": user["id"], "approved_at": now,
            "rejected_reason": None,
        }
        await db.transactions.insert_one(txn)
        created_txn_ids.append(txn["id"])

    res = await db.fooding_entries.find_one_and_update(
        {"id": fid},
        {"$set": {
            "status": "received", "received_date": today, "received_by": user["id"],
            "txn_ids": created_txn_ids, "company_id": company_id_resolved,
        }},
        return_document=True,
    )
    res.pop("_id", None)
    return FoodingEntryOut(**res)


@api.get("/batches/{bid}/mandays-suggestion")
async def suggest_mandays(bid: str, month: str, _=Depends(get_current_user)):
    """Auto-suggest mandays for a given YYYY-MM:
    Sum of 'present' attendance records for staff at this batch's center in that month.
    Falls back to total_beneficiaries × working_days estimate when no attendance present."""
    if not _month_re_ok(month):
        raise HTTPException(400, "month must be YYYY-MM")
    batch = await db.batches.find_one({"id": bid}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    start = f"{month}-01"
    # naive month-end: last day prefix YYYY-MM-31 works because date is ISO string compare
    end = f"{month}-31"
    center_id = batch.get("center_id")
    present_count = 0
    if center_id:
        present_count = await db.attendance.count_documents({
            "center_id": center_id,
            "date": {"$gte": start, "$lte": end},
            "status": "present",
        })
    # Fallback estimate when no HRMS data: candidates × 26 working days
    if present_count == 0:
        present_count = int((batch.get("total_beneficiaries") or 0) * 26)
    return {"month": month, "mandays_suggestion": present_count, "source": "attendance" if center_id and present_count > 0 else "estimate"}


# ---------- TDS Register (Form 26Q quarterly filing helper) ----------
def _fy_bounds(fy_label: str) -> tuple[str, str]:
    """Convert 'YYYY-YY' (e.g. '2025-26') into (start_iso, end_iso_exclusive) for Indian FY (Apr-Mar)."""
    try:
        start_year = int(fy_label.split("-")[0])
    except (ValueError, IndexError):
        raise HTTPException(400, "fy must be in format YYYY-YY, e.g. 2025-26")
    return f"{start_year}-04-01", f"{start_year + 1}-04-01"


# Indian FY quarter boundaries (Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar)
def _quarter_bounds(fy_label: str, q: str) -> tuple[str, str]:
    try:
        start_year = int(fy_label.split("-")[0])
    except (ValueError, IndexError, AttributeError):
        raise HTTPException(400, "fy must be in format YYYY-YY, e.g. 2025-26")
    q = (q or "all").upper()
    table = {
        "Q1": (f"{start_year}-04-01", f"{start_year}-07-01"),
        "Q2": (f"{start_year}-07-01", f"{start_year}-10-01"),
        "Q3": (f"{start_year}-10-01", f"{start_year + 1}-01-01"),
        "Q4": (f"{start_year + 1}-01-01", f"{start_year + 1}-04-01"),
        "ALL": (f"{start_year}-04-01", f"{start_year + 1}-04-01"),
    }
    if q not in table:
        raise HTTPException(400, "quarter must be Q1, Q2, Q3, Q4 or all")
    return table[q]


def _date_to_quarter(date_str: str, fy_start_year: int) -> str:
    """Return 'Q1'..'Q4' for a YYYY-MM-DD date relative to FY start year."""
    try:
        m = int(date_str[5:7])
    except (ValueError, IndexError):
        return "Q?"
    if 4 <= m <= 6:
        return "Q1"
    if 7 <= m <= 9:
        return "Q2"
    if 10 <= m <= 12:
        return "Q3"
    if 1 <= m <= 3:
        return "Q4"
    return "Q?"


@api.get("/reports/tds-register")
async def tds_register(
    fy: str = Query("2025-26", description="Financial year, e.g. 2025-26"),
    quarter: str = Query("all", description="Q1/Q2/Q3/Q4 or all"),
    project_id: Optional[str] = None,
    user=Depends(require_role("admin", "accountant", "senior_manager", "hr", "partner")),
):
    """Returns the TDS register for a given FY/quarter — all transactions with
    source='tds_deduction', grouped + summarised for Form 26Q quarterly filing.

    Response:
      {
        fy, quarter, range: {start, end},
        rows: [{date, txn_id, project_id/name, center_id/name, batch info,
                gross_taxable, tds_percent, tds_amount, milestone, partner_id, description}],
        by_quarter: { "Q1": amount, ... },
        by_project: [{project_id, project_name, tds_amount}],
        totals: { tds_amount, count }
      }
    """
    start, end = _quarter_bounds(fy, quarter)
    fy_start_year = int(fy.split("-")[0])

    q: dict = {"source": "tds_deduction", "status": "approved", "date": {"$gte": start, "$lt": end}}
    if project_id:
        q["project_id"] = project_id

    txns = await db.transactions.find(q, {"_id": 0}).sort("date", 1).to_list(5000)

    # Resolve project / center names in bulk
    proj_ids = {t.get("project_id") for t in txns if t.get("project_id")}
    cent_ids = {t.get("center_id") for t in txns if t.get("center_id")}
    proj_map = {p["id"]: p["name"] for p in await db.projects.find({"id": {"$in": list(proj_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    cent_map = {c["id"]: c["name"] for c in await db.centers.find({"id": {"$in": list(cent_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}

    rows = []
    by_quarter = {"Q1": 0.0, "Q2": 0.0, "Q3": 0.0, "Q4": 0.0}
    by_project: dict[str, float] = {}
    total_tds = 0.0

    for t in txns:
        amt = float(t.get("amount") or 0)
        qkey = _date_to_quarter(t.get("date", ""), fy_start_year)
        if qkey in by_quarter:
            by_quarter[qkey] += amt
        total_tds += amt
        pid = t.get("project_id") or "__unassigned"
        by_project[pid] = by_project.get(pid, 0.0) + amt
        rows.append({
            "date": t.get("date"),
            "txn_id": t.get("id"),
            "project_id": t.get("project_id"),
            "project_name": proj_map.get(t.get("project_id"), ""),
            "center_id": t.get("center_id"),
            "center_name": cent_map.get(t.get("center_id"), ""),
            "milestone": t.get("milestone"),
            "tds_amount": round(amt, 2),
            "description": t.get("description", ""),
            "quarter": qkey,
            "partner_id": t.get("partner_id"),
        })

    by_project_list = [
        {"project_id": k if k != "__unassigned" else None,
         "project_name": proj_map.get(k, "Unassigned" if k == "__unassigned" else k),
         "tds_amount": round(v, 2)}
        for k, v in sorted(by_project.items(), key=lambda kv: -kv[1])
    ]

    return {
        "fy": fy,
        "quarter": quarter.upper() if quarter else "ALL",
        "range": {"start": start, "end": end},
        "rows": rows,
        "by_quarter": {k: round(v, 2) for k, v in by_quarter.items()},
        "by_project": by_project_list,
        "totals": {"tds_amount": round(total_tds, 2), "count": len(rows)},
    }


@api.get("/reports/tds-register/csv")
async def tds_register_csv(
    fy: str = Query("2025-26"),
    quarter: str = Query("all"),
    project_id: Optional[str] = None,
    user=Depends(require_role("admin", "accountant", "senior_manager", "hr", "partner")),
):
    """CSV download of the TDS register — ready to feed into 26Q upload tools / TRACES."""
    data = await tds_register(fy=fy, quarter=quarter, project_id=project_id, user=user)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Date", "Quarter", "Project", "Center", "Milestone", "Description", "TDS Amount (INR)", "Txn ID"])
    for r in data["rows"]:
        writer.writerow([
            r["date"], r["quarter"], r["project_name"], r["center_name"],
            r["milestone"] or "", r["description"], f"{r['tds_amount']:.2f}", r["txn_id"],
        ])
    writer.writerow([])
    writer.writerow(["TOTAL", "", "", "", "", "", f"{data['totals']['tds_amount']:.2f}", ""])
    csv_bytes = buf.getvalue().encode("utf-8")
    qsuffix = quarter.upper() if quarter else "ALL"
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="tds_register_{fy}_{qsuffix}.csv"'},
    )




# ---------- Notifications ----------
async def _notify(user_ids, message: str, ntype: str = "info", ref_id: Optional[str] = None, link: Optional[str] = None):
    """Insert a notification for each user_id (skip falsy / duplicates)."""
    if not user_ids:
        return
    if isinstance(user_ids, str):
        user_ids = [user_ids]
    seen = set()
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for uid in user_ids:
        if not uid or uid in seen:
            continue
        seen.add(uid)
        docs.append({
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "type": ntype,
            "ref_id": ref_id,
            "message": message,
            "link": link,
            "read": False,
            "created_at": now,
        })
    if docs:
        await db.notifications.insert_many(docs)


async def _accountant_admin_user_ids() -> list:
    docs = await db.users.find({"role": {"$in": ["admin", "accountant"]}}, {"_id": 0, "id": 1}).to_list(1000)
    return [d["id"] for d in docs]


async def _user_id_for_staff(sid: Optional[str]) -> Optional[str]:
    if not sid:
        return None
    s = await db.staff.find_one({"id": sid}, {"_id": 0, "user_id": 1})
    return (s or {}).get("user_id")


@api.get("/notifications")
async def list_notifications(user=Depends(get_current_user), limit: int = 50):
    docs = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort([("read", 1), ("created_at", -1)]).to_list(limit)
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"items": docs, "unread": unread}


@api.patch("/notifications/mark-all-read")
async def mark_all_read(user=Depends(get_current_user)):
    r = await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"updated": r.modified_count}


@api.patch("/notifications/{nid}/read")
async def mark_read(nid: str, user=Depends(get_current_user)):
    r = await db.notifications.update_one({"id": nid, "user_id": user["id"]}, {"$set": {"read": True}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- My Tasks ----------
@api.get("/tasks/my")
async def my_tasks(user=Depends(get_current_user)):
    role = user.get("role")
    counts = {"txn_pending": 0, "reimb_l1": 0, "reimb_accountant": 0, "reimb_pay": 0, "payroll_pay": 0, "pending_approvals": 0}
    if role == "admin":
        counts["txn_pending"] = await db.transactions.count_documents({"status": "pending"})
    my_staff = await _staff_for_user(user["id"])
    if my_staff:
        counts["reimb_l1"] = await db.reimbursements.count_documents({"l1_approver_id": my_staff["id"], "status": "submitted"})
    if role in ("admin", "accountant"):
        counts["reimb_accountant"] = await db.reimbursements.count_documents({"status": "l1_approved"})
        counts["reimb_pay"] = await db.reimbursements.count_documents({"status": "accountant_approved"})
        counts["payroll_pay"] = await db.payroll.count_documents({"status": {"$ne": "paid"}})
    # Cross-functional badge — anything across types that needs MY action right now
    try:
        pending = await list_pending_approvals(user=user)
        counts["pending_approvals"] = len(pending)
    except Exception:
        counts["pending_approvals"] = 0
    counts["total"] = sum(v for k, v in counts.items() if k != "total")
    return counts


# ============================================================================
# Assets & Asset Purchase Requests (Phase-3 RBAC)
# ----------------------------------------------------------------------------
# Workflow:
#   Center Manager creates an Asset-Purchase Request  →  Senior Manager → Accountant → Admin
#   (chain configurable via /api/approval-chains, default seeded on startup)
#   On final-approve: an `assets` doc is created AND an offsetting expense `transactions` doc
#   is recorded against the center. Assets can subsequently be transferred between centers.
# ============================================================================


class AssetPurchaseRequestIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=2)
    category: Optional[str] = None
    description: Optional[str] = None
    serial_no: Optional[str] = None
    vendor: Optional[str] = None
    est_amount: float = Field(ge=0)
    required_date: Optional[str] = None
    depreciation_rate_pct: float = Field(ge=0, default=0)
    useful_life_years: Optional[float] = Field(ge=0, default=None)
    center_id: Optional[str] = None
    attachments: List[dict] = Field(default_factory=list)


class AssetIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=2)
    category: Optional[str] = None
    serial_no: Optional[str] = None
    vendor: Optional[str] = None
    purchase_amount: float = Field(ge=0, default=0)
    purchase_date: Optional[str] = None
    depreciation_rate_pct: float = Field(ge=0, default=0)
    useful_life_years: Optional[float] = Field(ge=0, default=None)
    center_id: Optional[str] = None
    assigned_to_staff_id: Optional[str] = None
    status: Literal["active", "transferred", "disposed", "maintenance"] = "active"
    attachments: List[dict] = Field(default_factory=list)


class AssetTransferIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    asset_id: str
    to_center_id: str
    reason: str = Field(min_length=3)


def _asset_scope_for_user(user: dict) -> dict:
    """Mongo filter restricting assets/requests to centers a user can see.
    (Plain helper, currently inlined in each endpoint — kept for future reuse.)"""
    role = user.get("role")
    if role in ("admin", "senior_manager", "accountant", "hr"):
        return {}
    if role in ("center_manager", "center_staff", "center_partner"):
        cids = user.get("assigned_center_ids") or []
        return {"center_id": {"$in": cids}} if cids else {"center_id": "__none__"}
    return {}


# ---------- Asset Purchase Requests ----------
@api.post("/asset-purchase-requests")
async def create_asset_purchase_request(body: AssetPurchaseRequestIn, user=Depends(get_current_user)):
    role = user.get("role")
    if role not in ("admin", "center_manager", "senior_manager"):
        raise HTTPException(403, "Only Center Manager, Senior Manager or Admin can raise asset purchase requests")
    doc = body.model_dump()
    # Default center_id from user's first assigned center when not provided
    if not doc.get("center_id"):
        cids = user.get("assigned_center_ids") or []
        doc["center_id"] = cids[0] if cids else None
    if not doc.get("center_id"):
        raise HTTPException(400, "center_id is required (either via body or via your assigned centers)")
    doc.update({
        "id": str(uuid.uuid4()),
        "created_by": user["id"],
        "created_by_name": user.get("name") or user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
    })
    await _attach_chain_to_request("asset_purchase", doc)
    await db.asset_purchase_requests.insert_one(doc)
    # Notify level-1 approvers
    snap = doc.get("chain_snapshot") or []
    if snap:
        step1 = snap[0]
        for uid in await _resolve_step_user_ids(step1, doc):
            if uid != user["id"]:
                await _notify(uid,
                              f"Asset purchase request awaiting your approval: {doc['name']} (₹{doc['est_amount']:,.0f})",
                              ntype="asset_purchase_pending", ref_id=doc["id"], link="/assets")
    doc.pop("_id", None)
    return doc


@api.get("/asset-purchase-requests")
async def list_asset_purchase_requests(
    status: Optional[str] = None,
    center_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    q: dict = {}
    role = user.get("role")
    if role in ("center_manager", "center_staff", "center_partner"):
        cids = user.get("assigned_center_ids") or []
        q["center_id"] = {"$in": cids} if cids else "__none__"
    if center_id:
        q["center_id"] = center_id
    if status:
        q["status"] = status
    docs = await db.asset_purchase_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for d in docs:
        await _enrich_with_approval_status(d)
    return docs


@api.delete("/asset-purchase-requests/{rid}")
async def delete_asset_purchase_request(rid: str, user=Depends(get_current_user)):
    rec = await db.asset_purchase_requests.find_one({"id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    # Only initiator or admin can delete, and only while pending
    if user.get("role") != "admin" and rec.get("created_by") != user["id"]:
        raise HTTPException(403, "Only the initiator or admin can delete")
    if rec.get("status") not in ("pending",):
        raise HTTPException(400, f"Cannot delete (status={rec.get('status')})")
    await db.asset_purchase_requests.delete_one({"id": rid})
    return {"ok": True}


# ---------- Assets registry ----------
@api.get("/assets")
async def list_assets(
    center_id: Optional[str] = None,
    status: Optional[str] = None,
    user=Depends(get_current_user),
):
    q: dict = {}
    role = user.get("role")
    if role in ("center_manager", "center_staff", "center_partner"):
        cids = user.get("assigned_center_ids") or []
        q["center_id"] = {"$in": cids} if cids else "__none__"
    if center_id:
        q["center_id"] = center_id
    if status:
        q["status"] = status
    docs = await db.assets.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return docs


@api.post("/assets")
async def create_asset_direct(body: AssetIn, user=Depends(require_role("admin", "accountant"))):
    """Admin/Accountant can directly register an existing/legacy asset (bypassing the purchase chain).
    Useful for migrating pre-existing inventory into the new Asset register."""
    doc = body.model_dump()
    now = datetime.now(timezone.utc).isoformat()
    doc.update({
        "id": str(uuid.uuid4()),
        "purchase_date": doc.get("purchase_date") or now[:10],
        "created_by": user["id"],
        "created_at": now,
        "manual_entry": True,
    })
    await db.assets.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/assets/{aid}")
async def update_asset(aid: str, body: dict, user=Depends(require_role("admin", "accountant", "center_manager"))):
    allowed = {"name", "category", "serial_no", "vendor", "purchase_amount", "purchase_date",
               "depreciation_rate_pct", "useful_life_years", "assigned_to_staff_id", "status", "attachments"}
    upd = {k: v for k, v in (body or {}).items() if k in allowed}
    if not upd:
        raise HTTPException(400, "No allowed fields to update")
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    upd["updated_by"] = user["id"]
    res = await db.assets.find_one_and_update({"id": aid}, {"$set": upd}, return_document=True)
    if not res:
        raise HTTPException(404, "Asset not found")
    res.pop("_id", None)
    return res


@api.delete("/assets/{aid}")
async def delete_asset(aid: str, _=Depends(require_role("admin"))):
    r = await db.assets.delete_one({"id": aid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Asset not found")
    return {"ok": True}


# ---------- Asset Transfers (lightweight 2-step approval: requester → admin) ----------
@api.post("/asset-transfers")
async def create_asset_transfer(body: AssetTransferIn, user=Depends(get_current_user)):
    asset = await db.assets.find_one({"id": body.asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(404, "Asset not found")
    if asset.get("status") != "active":
        raise HTTPException(400, f"Asset is not active (status={asset.get('status')})")
    role = user.get("role")
    if role not in ("admin", "senior_manager", "center_manager"):
        raise HTTPException(403, "Only Center Manager, Senior Manager or Admin can initiate asset transfers")
    if role == "center_manager":
        cids = user.get("assigned_center_ids") or []
        if asset.get("center_id") not in cids:
            raise HTTPException(403, "You do not manage this asset's center")
    doc = {
        "id": str(uuid.uuid4()),
        "asset_id": body.asset_id,
        "asset_name": asset.get("name"),
        "from_center_id": asset.get("center_id"),
        "to_center_id": body.to_center_id,
        "reason": body.reason,
        "status": "pending",
        "created_by": user["id"],
        "created_by_name": user.get("name") or user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.asset_transfers.insert_one(doc)
    # Notify admins
    admins = await db.users.find({"role": "admin"}, {"_id": 0, "id": 1}).to_list(50)
    for a in admins:
        if a["id"] != user["id"]:
            await _notify(a["id"], f"Asset transfer requested: {asset.get('name')}",
                          ntype="asset_transfer_pending", ref_id=doc["id"], link="/assets")
    doc.pop("_id", None)
    return doc


@api.get("/asset-transfers")
async def list_asset_transfers(status: Optional[str] = None, user=Depends(get_current_user)):
    q: dict = {}
    role = user.get("role")
    if role in ("center_manager", "center_staff", "center_partner"):
        cids = user.get("assigned_center_ids") or []
        q["$or"] = [{"from_center_id": {"$in": cids}}, {"to_center_id": {"$in": cids}}]
    if status:
        q["status"] = status
    docs = await db.asset_transfers.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return docs


@api.post("/asset-transfers/{tid}/decide")
async def decide_asset_transfer(tid: str, body: dict, user=Depends(require_role("admin", "senior_manager"))):
    action = (body or {}).get("action")
    remarks = (body or {}).get("remarks", "")
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action must be 'approve' or 'reject'")
    rec = await db.asset_transfers.find_one({"id": tid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if rec.get("status") != "pending":
        raise HTTPException(400, f"Already finalised ({rec.get('status')})")
    now = datetime.now(timezone.utc).isoformat()
    if action == "approve":
        # Apply: move asset.center_id, mark asset as transferred-history (still active)
        await db.assets.update_one({"id": rec["asset_id"]}, {"$set": {"center_id": rec["to_center_id"], "updated_at": now}})
        upd = {"status": "approved", "decided_by": user["id"], "decided_at": now, "remarks": remarks}
    else:
        upd = {"status": "rejected", "decided_by": user["id"], "decided_at": now, "remarks": remarks}
    await db.asset_transfers.update_one({"id": tid}, {"$set": upd})
    if rec.get("created_by") and rec["created_by"] != user["id"]:
        await _notify(rec["created_by"], f"Asset transfer {action}d: {rec.get('asset_name','')}",
                      ntype=f"asset_transfer_{action}d", ref_id=tid, link="/assets")
    return {"ok": True, "status": upd["status"]}


# ============================================================================
# Employee Transfers (Phase-4 RBAC)
# ----------------------------------------------------------------------------
# Workflow: HR → Senior Manager → Admin. On final-approve staff.center_id is updated.
# ============================================================================


class EmployeeTransferIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    staff_id: str
    to_center_id: str
    effective_date: str  # YYYY-MM-DD
    reason: str = Field(min_length=3)
    new_designation: Optional[str] = None
    new_reports_to_id: Optional[str] = None


@api.post("/employee-transfers")
async def create_employee_transfer(body: EmployeeTransferIn, user=Depends(get_current_user)):
    role = user.get("role")
    if role not in ("admin", "hr", "senior_manager", "manager", "center_manager"):
        raise HTTPException(403, "You cannot raise an employee transfer")
    staff = await db.staff.find_one({"id": body.staff_id}, {"_id": 0})
    if not staff:
        raise HTTPException(404, "Staff not found")
    if staff.get("center_id") == body.to_center_id:
        raise HTTPException(400, "Source and destination centers are the same")
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "staff_name": staff.get("name"),
        "from_center_id": staff.get("center_id"),
        # We route the transfer through the destination center's chain so that center's HR/SrMgr can be involved.
        "center_id": body.to_center_id,
        "created_by": user["id"],
        "created_by_name": user.get("name") or user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
    })
    await _attach_chain_to_request("employee_transfer", doc)
    await db.employee_transfers.insert_one(doc)
    snap = doc.get("chain_snapshot") or []
    if snap:
        for uid in await _resolve_step_user_ids(snap[0], doc):
            if uid != user["id"]:
                await _notify(uid,
                              f"Employee transfer awaiting your approval: {staff.get('name')}",
                              ntype="employee_transfer_pending", ref_id=doc["id"], link="/employee-transfers")
    doc.pop("_id", None)
    return doc


@api.get("/employee-transfers")
async def list_employee_transfers(status: Optional[str] = None, user=Depends(get_current_user)):
    q: dict = {}
    role = user.get("role")
    if role in ("center_manager", "center_staff", "center_partner"):
        cids = user.get("assigned_center_ids") or []
        q["$or"] = [{"from_center_id": {"$in": cids}}, {"to_center_id": {"$in": cids}}]
    if status:
        q["status"] = status
    docs = await db.employee_transfers.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for d in docs:
        await _enrich_with_approval_status(d)
    return docs


@api.delete("/employee-transfers/{tid}")
async def delete_employee_transfer(tid: str, user=Depends(get_current_user)):
    rec = await db.employee_transfers.find_one({"id": tid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    if user.get("role") != "admin" and rec.get("created_by") != user["id"]:
        raise HTTPException(403, "Only the initiator or admin can delete")
    if rec.get("status") not in ("pending",):
        raise HTTPException(400, f"Cannot delete (status={rec.get('status')})")
    await db.employee_transfers.delete_one({"id": tid})
    return {"ok": True}


# ============================================================



# ============================================================================
# Leave Allocation (HR provisioning)
# ----------------------------------------------------------------------------
# HR/Admin defines leave types (CL/SL/PL/COMP_OFF) with annual quotas, then allocates
# day-balances to individual staff or in bulk by center. Used balance is auto-incremented
# when a leave request is final-approved (links via leaves.leave_type_id).
# ============================================================================


DEFAULT_LEAVE_TYPES = [
    {"code": "CL",   "name": "Casual Leave",  "annual_quota": 12, "paid": True,  "carry_forward": False, "color": "blue"},
    {"code": "SL",   "name": "Sick Leave",    "annual_quota": 10, "paid": True,  "carry_forward": False, "color": "amber"},
    {"code": "PL",   "name": "Privilege/Earned Leave", "annual_quota": 15, "paid": True, "carry_forward": True, "color": "emerald"},
    {"code": "COMP", "name": "Comp-off",      "annual_quota": 0,  "paid": True,  "carry_forward": True,  "color": "purple"},
    {"code": "LWP",  "name": "Leave Without Pay", "annual_quota": 0, "paid": False, "carry_forward": False, "color": "rose"},
]


async def _seed_default_leave_types() -> None:
    """Idempotent: ensure default leave-type rows exist (CL/SL/PL/COMP/LWP)."""
    for d in DEFAULT_LEAVE_TYPES:
        if await db.leave_types.find_one({"code": d["code"]}, {"_id": 0}):
            continue
        doc = {**d, "id": str(uuid.uuid4()), "active": True,
               "created_at": datetime.now(timezone.utc).isoformat()}
        try:
            await db.leave_types.insert_one(doc)
        except Exception:
            # benign race on dup-key during concurrent reloads — ignore
            pass


@api.get("/leave-types")
async def list_leave_types(_=Depends(get_current_user)):
    # Lazy-seed on first call so we don't have to forward-declare in startup hook
    if await db.leave_types.count_documents({}) == 0:
        await _seed_default_leave_types()
    docs = await db.leave_types.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return docs


@api.post("/leave-types")
async def create_leave_type(body: LeaveTypeIn, user=Depends(require_role("admin", "hr"))):
    doc = body.model_dump()
    doc["code"] = doc["code"].upper().strip()
    if await db.leave_types.find_one({"code": doc["code"]}, {"_id": 0}):
        raise HTTPException(400, f"Leave type with code '{doc['code']}' already exists")
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["created_by"] = user["id"]
    await db.leave_types.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/leave-types/{lt_id}")
async def update_leave_type(lt_id: str, body: LeaveTypeIn, _=Depends(require_role("admin", "hr"))):
    upd = body.model_dump()
    upd["code"] = upd["code"].upper().strip()
    # ensure code uniqueness against other docs
    dup = await db.leave_types.find_one({"code": upd["code"], "id": {"$ne": lt_id}}, {"_id": 0})
    if dup:
        raise HTTPException(400, f"Another leave type already uses code '{upd['code']}'")
    res = await db.leave_types.find_one_and_update({"id": lt_id}, {"$set": upd}, return_document=True)
    if not res:
        raise HTTPException(404, "Leave type not found")
    res.pop("_id", None)
    return res


@api.delete("/leave-types/{lt_id}")
async def delete_leave_type(lt_id: str, _=Depends(require_role("admin"))):
    # Soft-protect: refuse if any balance refers to this type
    if await db.leave_balances.find_one({"leave_type_id": lt_id}, {"_id": 0, "id": 1}):
        raise HTTPException(400, "This leave type is used in staff balances — deactivate instead of deleting")
    r = await db.leave_types.delete_one({"id": lt_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Leave type not found")
    return {"ok": True}


# -------- Leave Balances --------
@api.get("/leave-balances")
async def list_leave_balances(
    staff_id: Optional[str] = None,
    year: Optional[int] = None,
    center_id: Optional[str] = None,
    user=Depends(get_current_user),
):
    """List balances. HR/Admin see all; center_manager sees own centers; others see only own row."""
    role = user.get("role")
    q: dict = {}
    if year:
        q["year"] = year
    # Scope by role
    if role in ("admin", "hr"):
        if staff_id:
            q["staff_id"] = staff_id
        if center_id:
            staff_in_center = await db.staff.find({"center_id": center_id}, {"_id": 0, "id": 1}).to_list(5000)
            q["staff_id"] = {"$in": [s["id"] for s in staff_in_center]}
    elif role in ("senior_manager", "manager", "accountant", "center_manager"):
        # See balances of staff in centers they manage (and any specific staff filter)
        cids = user.get("assigned_center_ids") or []
        if role == "senior_manager" and not cids:
            # senior_manager without explicit center assignment → see all
            pass
        else:
            staff_in_centers = await db.staff.find({"center_id": {"$in": cids}}, {"_id": 0, "id": 1}).to_list(5000)
            q["staff_id"] = {"$in": [s["id"] for s in staff_in_centers]}
        if staff_id:
            q["staff_id"] = staff_id
    else:
        # All other roles: scope to own staff record
        own = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
        if not own:
            return []
        q["staff_id"] = own["id"]
    docs = await db.leave_balances.find(q, {"_id": 0}).sort([("year", -1), ("staff_id", 1)]).to_list(10000)
    return docs


@api.get("/leave-balances/my")
async def my_leave_balances(year: Optional[int] = None, user=Depends(get_current_user)):
    own = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})
    if not own:
        return {"staff": None, "balances": [], "types": []}
    q: dict = {"staff_id": own["id"]}
    if year:
        q["year"] = year
    balances = await db.leave_balances.find(q, {"_id": 0}).sort("year", -1).to_list(200)
    types = await db.leave_types.find({}, {"_id": 0}).to_list(50)
    return {"staff": own, "balances": balances, "types": types}


@api.post("/leave-balances/allocate")
async def allocate_leaves(body: LeaveAllocateIn, user=Depends(require_role("admin", "hr"))):
    """Bulk-allocate days to selected staff (or all staff in a center / globally).
    `mode=set` overwrites the allocated column; `mode=add` adds to existing allocated."""
    lt = await db.leave_types.find_one({"id": body.leave_type_id}, {"_id": 0})
    if not lt:
        raise HTTPException(404, "Leave type not found")

    # Build target staff list
    target_q: dict = {}
    if body.staff_ids:
        target_q["id"] = {"$in": body.staff_ids}
    elif body.center_id:
        target_q["center_id"] = body.center_id
    # else: all staff (no extra filter)
    targets = await db.staff.find(target_q, {"_id": 0, "id": 1, "name": 1}).to_list(10000)
    if not targets:
        raise HTTPException(400, "No staff matched the allocation filter")

    now = datetime.now(timezone.utc).isoformat()
    upserts = 0
    for s in targets:
        existing = await db.leave_balances.find_one(
            {"staff_id": s["id"], "leave_type_id": body.leave_type_id, "year": body.year},
            {"_id": 0},
        )
        if existing:
            allocated = existing.get("allocated", 0)
            new_allocated = body.days if body.mode == "set" else (allocated + body.days)
            await db.leave_balances.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "allocated": new_allocated,
                    "balance": max(0, new_allocated - (existing.get("used", 0) or 0)),
                    "updated_at": now,
                    "updated_by": user["id"],
                    "last_remarks": body.remarks or "",
                }},
            )
        else:
            doc = {
                "id": str(uuid.uuid4()),
                "staff_id": s["id"],
                "leave_type_id": body.leave_type_id,
                "leave_type_code": lt["code"],
                "year": body.year,
                "allocated": body.days,
                "used": 0,
                "balance": body.days,
                "created_at": now,
                "created_by": user["id"],
                "last_remarks": body.remarks or "",
            }
            await db.leave_balances.insert_one(doc)
        upserts += 1
    return {"ok": True, "updated": upserts, "leave_type": lt["code"], "year": body.year}


@api.patch("/leave-balances/{bid}")
async def adjust_leave_balance(bid: str, body: LeaveBalanceAdjustIn, user=Depends(require_role("admin", "hr"))):
    rec = await db.leave_balances.find_one({"id": bid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Balance not found")
    allocated = (rec.get("allocated", 0) or 0) + body.delta_allocated
    used = max(0, (rec.get("used", 0) or 0) + body.delta_used)
    balance = max(0, allocated - used)
    upd = {
        "allocated": allocated,
        "used": used,
        "balance": balance,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": user["id"],
        "last_remarks": body.remarks,
    }
    await db.leave_balances.update_one({"id": bid}, {"$set": upd})
    rec.update(upd)
    return rec


# ============================================================


# ---------- Register router + CORS ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
