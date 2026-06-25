from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import re
import csv
import uuid
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

logger = logging.getLogger(__name__)


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


# ---------- Models ----------
ROLE_LITERAL = Literal["admin", "manager", "senior_manager", "center_manager", "center_staff", "partner", "accountant", "hr", "viewer"]


class UserOut(BaseModel):
    id: str
    email: EmailStr
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
    name: str
    description: Optional[str] = ""


class EntityOut(EntityIn):
    id: str
    type: str
    created_at: str


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
    rejected_reason: Optional[str] = None


class RejectIn(BaseModel):
    reason: Optional[str] = ""


# ============================================================================
# Approval Chains — configurable multi-level approval workflows
# ============================================================================
ApprovalType = Literal["reimbursement", "leave", "transaction"]
ApproverKind = Literal["role", "staff", "user", "reports_to"]


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
    - partner: only transactions where partner_id == their assigned_partner_id
    - viewer: only their own created transactions
    """
    role = user.get("role")
    if role in ("admin", "manager", "senior_manager", "accountant", "hr"):
        return {}
    if role in ("center_manager", "center_staff"):
        return {"center_id": {"$in": user.get("assigned_center_ids") or []}}
    if role == "partner":
        pid = user.get("assigned_partner_id")
        return {"partner_id": pid} if pid else {"_never_": True}
    # viewer / any other → own data only
    return {"created_by": user["id"]}


def _can_auto_approve(user: dict) -> bool:
    return user.get("role") == "admin"


# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    for col in ("companies", "partners", "centers", "projects", "transactions", "staff", "attendance", "leaves", "reimbursements", "payroll", "notifications", "batches", "batch_payments", "approval_chains", "holidays", "geofences", "shifts", "regularisations", "staff_documents"):
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
async def login(body: LoginIn, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"])
    set_auth_cookie(response, token)
    return UserOut(**user)


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(**user)


@api.get("/auth/users", response_model=List[UserOut])
async def list_users(_=Depends(require_role("admin", "hr"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return [UserOut(**d) for d in docs]


@api.patch("/auth/users/{uid}", response_model=UserOut)
async def update_user(uid: str, body: UserUpdateIn, _=Depends(require_role("admin"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
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
    """Returns (allowed, reason). True if user (partner role) can cross-approve this txn."""
    if user.get("role") != "partner":
        return (False, "Only partner role can perform partner-approval")
    approver_pid = user.get("assigned_partner_id")
    if not approver_pid:
        return (False, "Your account is not linked to a partner profile")
    owner_pid = txn.get("partner_id")
    if not owner_pid:
        return (False, "Transaction has no partner attached")
    if approver_pid == owner_pid:
        return (False, "You cannot approve your own partner's transactions")
    if txn.get("created_by") == user["id"]:
        return (False, "You cannot approve a transaction you created")
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
    return {
        "id": str(uuid.uuid4()),
        "type": etype,
        "name": body.name,
        "description": body.description or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@api.get("/entities/{etype}", response_model=List[EntityOut])
async def list_entities(etype: EntityType, _=Depends(get_current_user)):
    col = ENTITY_COLLECTION[etype]
    docs = await db[col].find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [EntityOut(**d) for d in docs]


@api.post("/entities/{etype}", response_model=EntityOut)
async def create_entity(etype: EntityType, body: EntityIn, _=Depends(require_role("admin", "manager"))):
    col = ENTITY_COLLECTION[etype]
    doc = _entity_doc(body, etype)
    await db[col].insert_one(doc)
    return EntityOut(**doc)


@api.put("/entities/{etype}/{eid}", response_model=EntityOut)
async def update_entity(etype: EntityType, eid: str, body: EntityIn, _=Depends(require_role("admin", "manager"))):
    col = ENTITY_COLLECTION[etype]
    res = await db[col].find_one_and_update(
        {"id": eid},
        {"$set": {"name": body.name, "description": body.description or ""}},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return EntityOut(**res)


@api.delete("/entities/{etype}/{eid}")
async def delete_entity(etype: EntityType, eid: str, _=Depends(require_role("admin"))):
    col = ENTITY_COLLECTION[etype]
    r = await db[col].delete_one({"id": eid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Transactions ----------
@api.get("/transactions", response_model=List[TransactionOut])
async def list_transactions(
    user=Depends(get_current_user),
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
    user=Depends(get_current_user),
    company_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    center_id: Optional[str] = None,
    project_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    include_pending: bool = False,
):
    match: dict = {}
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
    user=Depends(get_current_user),
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
    q.update(_txn_scope_for_user(user))

    docs = await db.transactions.find(q, {"_id": 0}).to_list(20000)

    pmap = await db.partners.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    pname_by_id = {p["id"]: p["name"] for p in pmap}
    projmap = await db.projects.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)
    proj_by_id = {p["id"]: p["name"] for p in projmap}

    total = 0.0
    by_milestone: dict = {"1st": 0.0, "2nd": 0.0, "3rd": 0.0}
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


@api.get("/dashboard/settlement")
async def settlement_view(
    user=Depends(get_current_user),
    center_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    """Co-partner settlement view for a center.

    - partner role: scoped to centers where the logged-in partner has activity (own_partner_id derived from assigned_partner_id).
    - admin/manager/accountant: can pass any center_id (or partner_id) to inspect.

    Returns list of centers; for each center, list of partners with their investment/income/expense
    plus fair-share (equal split) adjustment: how much each partner should pay to / receive from
    the group to balance NET CONTRIBUTION (= investment + expense - income).
    """
    role = user.get("role")
    own_partner_id = user.get("assigned_partner_id") if role == "partner" else partner_id

    # Build base match — only approved entries count
    base: dict = {"status": "approved"}
    if start or end:
        rng: dict = {}
        if start:
            rng["$gte"] = start
        if end:
            rng["$lte"] = end
        base["date"] = rng

    # Find which centers to include
    center_ids: list[str] = []
    if center_id:
        center_ids = [center_id]
    elif own_partner_id:
        center_ids = await db.transactions.distinct(
            "center_id",
            {**base, "partner_id": own_partner_id, "center_id": {"$ne": None}},
        )
    else:
        # admin without filter: all centers that have any partner transaction
        center_ids = await db.transactions.distinct(
            "center_id",
            {**base, "partner_id": {"$ne": None}, "center_id": {"$ne": None}},
        )

    # Fetch entity name lookups
    center_docs = await db.centers.find({"id": {"$in": center_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    center_name = {c["id"]: c["name"] for c in center_docs}

    out_centers = []
    for cid in center_ids:
        # Aggregate per partner inside this center
        pipe = [
            {"$match": {**base, "center_id": cid, "partner_id": {"$ne": None}}},
            {"$group": {"_id": {"pid": "$partner_id", "type": "$type"}, "total": {"$sum": "$amount"}}},
        ]
        rows = await db.transactions.aggregate(pipe).to_list(5000)
        if not rows:
            continue
        partner_ids = list({r["_id"]["pid"] for r in rows})
        p_docs = await db.partners.find({"id": {"$in": partner_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        p_name = {p["id"]: p["name"] for p in p_docs}

        agg: dict = {}
        for r in rows:
            pid = r["_id"]["pid"]
            agg.setdefault(pid, {"id": pid, "name": p_name.get(pid, "Unknown"),
                                 "investment": 0, "income": 0, "expense": 0})
            agg[pid][r["_id"]["type"]] += r["total"]

        partners = list(agg.values())
        # Net contribution per partner = investment + expense - income (money they put into the venture)
        for p in partners:
            p["net_contribution"] = p["investment"] + p["expense"] - p["income"]
            p["profit_share"] = p["income"] - p["expense"]  # individual P&L
        total_contrib = sum(p["net_contribution"] for p in partners)
        n = len(partners) or 1
        fair_share = total_contrib / n
        for p in partners:
            # adjustment > 0 ⇒ this partner needs to PAY this amount to balance
            # adjustment < 0 ⇒ this partner should RECEIVE this amount
            p["fair_share"] = round(fair_share, 2)
            p["adjustment"] = round(fair_share - p["net_contribution"], 2)

        out_centers.append({
            "center_id": cid,
            "center_name": center_name.get(cid, "Unknown"),
            "total_contribution": round(total_contrib, 2),
            "fair_share_each": round(fair_share, 2),
            "partner_count": n,
            "partners": sorted(partners, key=lambda x: x["adjustment"]),
        })

    return {"centers": sorted(out_centers, key=lambda x: x["center_name"])}


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
    status: Literal["present", "half", "leave"] = "present"
    reason: str  # mandatory explanation


class LeaveIn(BaseModel):
    staff_id: str
    start_date: str
    end_date: str
    reason: Optional[str] = ""


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
@api.get("/staff", response_model=List[StaffOut])
async def list_staff(_=Depends(get_current_user)):
    docs = await db.staff.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
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
    # Normalise contact fields (KEEP them on staff doc; do not pop)
    login_email = (doc.get("email") or "").strip().lower() or None
    mobile = (doc.get("mobile") or "").strip() or None
    doc["email"] = login_email
    doc["mobile"] = mobile
    email_result = None
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
    out = StaffOut(**{k: v for k, v in doc.items() if k in StaffOut.model_fields}).model_dump()
    if email_result is not None:
        out["email_status"] = email_result
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


async def _find_active_chain(req_type: str) -> Optional[dict]:
    return await db.approval_chains.find_one({"type": req_type, "active": True}, {"_id": 0})


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
        users = await db.users.find({"role": value}, {"_id": 0, "id": 1}).to_list(2000)
        return [u["id"] for u in users]
    if kind == "user":
        return [value] if value else []
    if kind == "staff":
        s = await db.staff.find_one({"id": value}, {"_id": 0, "user_id": 1})
        return [s["user_id"]] if s and s.get("user_id") else []
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
    Mutates and returns the same doc. If no chain is configured, leaves doc unchanged."""
    chain = await _find_active_chain(req_type)
    if not chain or not chain.get("steps"):
        request_doc["chain_id"] = None
        request_doc["current_level"] = None
        request_doc["chain_snapshot"] = []
        request_doc["chain_history"] = []
        return request_doc
    steps = sorted(chain["steps"], key=lambda s: s.get("level", 0))
    request_doc["chain_id"] = chain["id"]
    request_doc["current_level"] = 1
    request_doc["chain_snapshot"] = steps
    request_doc["chain_history"] = []
    return request_doc


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


# -------- Approval Chain CRUD --------
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
    # If activated, deactivate other chains of the same type to keep one active per type
    if doc.get("active"):
        await db.approval_chains.update_many({"type": doc["type"], "active": True}, {"$set": {"active": False}})
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
    if update.get("active"):
        await db.approval_chains.update_many({"type": update["type"], "active": True, "id": {"$ne": cid}}, {"$set": {"active": False}})
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
    coll_name = {"reimbursement": "reimbursements", "leave": "leaves", "transaction": "transactions"}[body.request_type]
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
        # Notify creator
        if rec.get("created_by") and rec["created_by"] != user["id"]:
            await _notify(rec["created_by"],
                          f"Your {body.request_type} was rejected" + (f": {body.remarks}" if body.remarks else ""),
                          ntype=f"{body.request_type}_rejected", ref_id=body.request_id,
                          link=("/hrms" if body.request_type != "transaction" else "/transactions"))
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
            txn = {
                "id": str(uuid.uuid4()),
                "type": "expense",
                "amount": rec["amount"],
                "date": rec["date"],
                "description": f"Reimbursement: {(staff or {}).get('name','')} — {rec.get('description','')}".strip(),
                "company_id": None, "partner_id": None,
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
                          link=("/hrms" if body.request_type != "transaction" else "/transactions"))
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
                              f"{body.request_type.title()} awaiting your approval (Level {next_level}: {nxt.get('label','')})",
                              ntype=f"{body.request_type}_pending", ref_id=body.request_id,
                              link=("/hrms" if body.request_type != "transaction" else "/transactions"))
    return {"ok": True, "status": "in_progress", "current_level": next_level}


@api.get("/approvals/pending")
async def list_pending_approvals(user=Depends(get_current_user)):
    """Return all requests across types where the current user is the resolved approver for the current step."""
    out: List[dict] = []
    for req_type, coll_name in [("reimbursement", "reimbursements"), ("leave", "leaves"), ("transaction", "transactions")]:
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
                        "amount": rec.get("amount"),
                        "date": rec.get("date") or rec.get("start_date"),
                        "description": rec.get("description") or rec.get("reason"),
                    },
                    "created_at": rec.get("created_at"),
                })
    return out


@api.post("/approvals/{request_type}/{request_id}/nudge")
async def nudge_approver(request_type: str, request_id: str, user=Depends(get_current_user)):
    """Send a polite reminder notification to the currently-pending approver(s).
    Only the request submitter (or admin/HR) can nudge."""
    if request_type not in ("reimbursement", "leave", "transaction"):
        raise HTTPException(400, "Invalid request_type")
    coll_name = {"reimbursement": "reimbursements", "leave": "leaves", "transaction": "transactions"}[request_type]
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
            link=("/hrms" if request_type != "transaction" else "/transactions"),
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
    if request_type not in ("reimbursement", "leave", "transaction"):
        raise HTTPException(400, "Invalid request_type")
    coll_name = {"reimbursement": "reimbursements", "leave": "leaves", "transaction": "transactions"}[request_type]
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
    # Auto-create an expense transaction (approved) for ledger sync
    txn = {
        "id": str(uuid.uuid4()),
        "type": "expense",
        "amount": rec["amount"],
        "date": rec["date"],
        "description": f"Reimbursement: {staff.get('name','') if staff else ''} — {rec.get('description','')}".strip(),
        "company_id": None, "partner_id": None,
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
    staff = await db.staff.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})
    if not staff:
        raise HTTPException(400, "Your user is not linked to any staff record.")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["staff_id"] = staff["id"]
    doc["staff_name"] = staff.get("name")
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["status"] = "pending"  # pending | approved | rejected
    doc["decided_by"] = None
    doc["decided_at"] = None
    doc["decision_remarks"] = None
    await db.regularisations.insert_one(doc)
    doc.pop("_id", None)
    # Notify admin + HR
    admins = await db.users.find({"role": {"$in": ["admin", "hr"]}}, {"_id": 0, "id": 1}).to_list(50)
    for a in admins:
        if a["id"] != user["id"]:
            await _notify(a["id"], f"New attendance regularisation request from {staff.get('name')} for {doc['date']}",
                          ntype="regularisation_pending", ref_id=doc["id"], link="/hr-settings")
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
    return docs


@api.get("/regularisations/my")
async def my_regularisations(user=Depends(get_current_user)):
    docs = await db.regularisations.find({"created_by": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
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
                "status": rec.get("status") or "present",
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
        return {"staff": None, "today": None, "month_stats": {}, "pending_counts": {}}
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
    txn = {
        "id": str(uuid.uuid4()),
        "type": "expense",
        "amount": rec["net"],
        "date": f"{rec['year']:04d}-{rec['month']:02d}-{rec['working_days']:02d}",
        "description": f"Salary: {staff.get('name','') if staff else ''} {rec['month']}/{rec['year']}",
        "company_id": None, "partner_id": None,
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
    _=Depends(get_current_user),
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
    partner_ids: List[str] = Field(default_factory=list)
    name: str = Field(min_length=1)
    start_date: Optional[str] = ""
    end_date: Optional[str] = ""
    total_beneficiaries: int = 0
    description: Optional[str] = ""


class BatchOut(BatchIn):
    id: str
    created_at: str


MilestoneType = Literal["1st", "2nd", "3rd"]


class BatchPaymentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    batch_id: str
    milestone: MilestoneType
    amount: float = Field(gt=0)
    expected_date: Optional[str] = ""
    description: Optional[str] = ""


class BatchPaymentOut(BatchPaymentIn):
    id: str
    status: Literal["pending", "received"] = "pending"
    received_date: Optional[str] = None
    received_by: Optional[str] = None
    txn_id: Optional[str] = None
    created_at: str


@api.get("/batches", response_model=List[BatchOut])
async def list_batches(project_id: Optional[str] = None, center_id: Optional[str] = None,
                       _=Depends(get_current_user)):
    q: dict = {}
    if project_id:
        q["project_id"] = project_id
    if center_id:
        q["center_id"] = center_id
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
async def list_batch_payments(batch_id: Optional[str] = None, _=Depends(get_current_user)):
    q: dict = {}
    if batch_id:
        q["batch_id"] = batch_id
    docs = await db.batch_payments.find(q, {"_id": 0}).sort([("batch_id", 1), ("milestone", 1)]).to_list(5000)
    return [BatchPaymentOut(**d) for d in docs]


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
async def receive_batch_payment(pid: str, user=Depends(require_role("admin", "accountant", "senior_manager"))):
    """Mark a milestone payment as received and auto-create approved income transaction(s).

    If the parent batch has `partner_ids`, the amount is split equally and one approved
    income transaction is created per partner (each carrying source='milestone' and
    milestone='1st|2nd|3rd' for downstream aggregations). Otherwise a single transaction
    is created with no partner_id.
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
    splits = partner_ids if partner_ids else [None]
    share = round(rec["amount"] / len(splits), 2)
    # Adjust last split so the sum exactly equals total (handle rounding tail)
    last_share = round(rec["amount"] - share * (len(splits) - 1), 2)
    description_base = f"{project_name} — {batch.get('name','') if batch else ''} — {rec['milestone']} milestone"
    created_txn_ids: list[str] = []
    for idx, pid_split in enumerate(splits):
        amt = last_share if idx == len(splits) - 1 else share
        if amt <= 0:
            continue
        txn = {
            "id": str(uuid.uuid4()),
            "type": "income",
            "amount": amt,
            "date": today,
            "description": description_base + (f" (partner split {idx+1}/{len(splits)})" if pid_split else ""),
            "company_id": None,
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
    res = await db.batch_payments.find_one_and_update(
        {"id": pid},
        {"$set": {
            "status": "received", "received_date": today, "received_by": user["id"],
            "txn_id": created_txn_ids[0] if created_txn_ids else None,
            "txn_ids": created_txn_ids,
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
    counts = {"txn_pending": 0, "reimb_l1": 0, "reimb_accountant": 0, "reimb_pay": 0, "payroll_pay": 0}
    if role == "admin":
        counts["txn_pending"] = await db.transactions.count_documents({"status": "pending"})
    my_staff = await _staff_for_user(user["id"])
    if my_staff:
        counts["reimb_l1"] = await db.reimbursements.count_documents({"l1_approver_id": my_staff["id"], "status": "submitted"})
    if role in ("admin", "accountant"):
        counts["reimb_accountant"] = await db.reimbursements.count_documents({"status": "l1_approved"})
        counts["reimb_pay"] = await db.reimbursements.count_documents({"status": "accountant_approved"})
        counts["payroll_pay"] = await db.payroll.count_documents({"status": {"$ne": "paid"}})
    counts["total"] = sum(v for k, v in counts.items() if k != "total")
    return counts


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
