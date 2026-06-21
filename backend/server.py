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
    for col in ("companies", "partners", "centers", "projects", "transactions", "staff", "attendance", "leaves", "reimbursements", "payroll", "notifications", "batches", "batch_payments"):
        await db[col].create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.batches.create_index([("project_id", 1), ("center_id", 1)])
    await db.batch_payments.create_index([("batch_id", 1), ("milestone", 1)])

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
async def upload_file(file: UploadFile = File(...), user=Depends(require_role("admin", "manager"))):
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
async def list_users(_=Depends(require_role("admin"))):
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
    else:
        doc["status"] = "pending"
        doc["approved_by"] = None
        doc["approved_at"] = None
    doc["rejected_reason"] = None
    await db.transactions.insert_one(doc)
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


@api.delete("/transactions/{tid}")
async def delete_transaction(tid: str, _=Depends(require_role("admin"))):
    r = await db.transactions.delete_one({"id": tid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


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


class StaffOut(StaffIn):
    id: str
    created_at: str


class AttendanceIn(BaseModel):
    staff_id: str
    date: str  # YYYY-MM-DD
    status: Literal["present", "absent", "half", "leave"] = "present"


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


@api.post("/staff", response_model=StaffOut)
async def create_staff(body: StaffIn, user=Depends(require_role("admin", "manager", "hr"))):
    doc = body.model_dump()
    # Only admin can assign the reports_to chain (approval hierarchy)
    if user.get("role") != "admin":
        doc["reports_to_id"] = None
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.staff.insert_one(doc)
    return StaffOut(**doc)


@api.put("/staff/{sid}", response_model=StaffOut)
async def update_staff(sid: str, body: StaffIn, user=Depends(require_role("admin", "manager", "hr"))):
    update = body.model_dump()
    if user.get("role") != "admin":
        # Preserve existing reports_to_id; only admin may change it
        existing = await db.staff.find_one({"id": sid}, {"_id": 0, "reports_to_id": 1})
        update["reports_to_id"] = (existing or {}).get("reports_to_id")
    res = await db.staff.find_one_and_update(
        {"id": sid}, {"$set": update}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return StaffOut(**res)


@api.delete("/staff/{sid}")
async def delete_staff(sid: str, _=Depends(require_role("admin"))):
    r = await db.staff.delete_one({"id": sid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# -------- Attendance --------
@api.post("/attendance")
async def mark_attendance(body: AttendanceIn, _=Depends(require_role("admin", "manager", "center_manager", "hr", "center_staff"))):
    # upsert by (staff_id, date)
    doc = body.model_dump()
    new_id = str(uuid.uuid4())
    await db.attendance.update_one(
        {"staff_id": doc["staff_id"], "date": doc["date"]},
        {"$set": doc, "$setOnInsert": {"id": new_id}},
        upsert=True,
    )
    return {"ok": True}


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
    await db.leaves.insert_one(doc)
    doc.pop("_id", None)
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
                       user=Depends(require_role("admin", "manager", "center_manager", "hr", "senior_manager"))):
    now = datetime.now(timezone.utc).isoformat()
    res = await db.leaves.find_one_and_update(
        {"id": lid},
        {"$set": {"status": decision, "decided_by": user["id"], "decided_at": now}},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
    return res


# -------- Reimbursements (3-stage approval) --------
@api.post("/reimbursements")
async def submit_reimbursement(body: ReimbursementIn, user=Depends(get_current_user)):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["status"] = "submitted"
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    # snapshot approver chain
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
    await db.reimbursements.insert_one(doc)
    doc.pop("_id", None)
    # Notify L1 approver (via their linked user_id)
    l1_uid = await _user_id_for_staff(doc.get("l1_approver_id"))
    if l1_uid and l1_uid != user["id"]:
        await _notify(l1_uid, f"New reimbursement awaiting your approval (₹{doc.get('amount', 0):,.0f})",
                      ntype="reimb_l1_pending", ref_id=doc["id"], link="/hrms")
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
    if user.get("role") == "admin":
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
async def reimb_accountant_approve(rid: str, user=Depends(require_role("admin", "accountant"))):
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
async def reimb_pay(rid: str, user=Depends(require_role("admin", "accountant"))):
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
@api.post("/payroll/run")
async def payroll_run(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020, le=2100),
    _=Depends(require_role("admin", "accountant", "hr")),
):
    """Generate payroll rows for all staff for the given month based on attendance × per_day_rate.

    days_present is counted as: present=1, half=0.5, absent/leave=0.
    net_pay = base_salary OR (days_worked × per_day_rate) — we use per_day_rate × days when > 0
    else fall back to monthly_salary prorated by (days_present / working_days_in_month).
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
            if r["status"] == "present":
                days_present += 1
            elif r["status"] == "half":
                days_present += 0.5
        if s.get("per_day_rate", 0) and days_present > 0:
            gross = s["per_day_rate"] * days_present
        else:
            gross = (s.get("monthly_salary", 0) or 0) * (days_present / last_day) if days_present else 0

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
            "gross": round(gross, 2),
            "deductions": 0.0,
            "net": round(gross, 2),
            "status": "draft",
            "txn_id": None,
            "paid_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.payroll.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)
    return {"created": len(created), "rows": created}


@api.get("/payroll")
async def list_payroll(month: Optional[int] = None, year: Optional[int] = None, _=Depends(get_current_user)):
    q: dict = {}
    if month:
        q["month"] = month
    if year:
        q["year"] = year
    docs = await db.payroll.find(q, {"_id": 0}).sort([("year", -1), ("month", -1)]).to_list(5000)
    return docs


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

    # First-occurrence lookup: scan entire transactions collection (just the items + dates).
    seen_first = {}
    cursor = db.transactions.find({}, {"_id": 0, "id": 1, "date": 1, "created_at": 1, "items": 1}).sort([("date", 1), ("created_at", 1)])
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

    # Reimbursements: emit a row for each completed stage
    if not type_filter or type_filter == "reimbursement":
        async for d in db.reimbursements.find({}, {"_id": 0}).sort("created_at", -1).limit(2000):
            staff = await db.staff.find_one({"id": d.get("staff_id")}, {"_id": 0, "name": 1})
            sname = (staff or {}).get("name", "")
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
            staff = await db.staff.find_one({"id": d.get("staff_id")}, {"_id": 0, "name": 1})
            sname = (staff or {}).get("name", "")
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
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.batches.insert_one(doc)
    return BatchOut(**doc)


@api.put("/batches/{bid}", response_model=BatchOut)
async def update_batch(bid: str, body: BatchIn, _=Depends(require_role("admin", "manager", "senior_manager"))):
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
    """Mark a milestone payment as received and auto-create an approved income transaction."""
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
    txn = {
        "id": str(uuid.uuid4()),
        "type": "income",
        "amount": rec["amount"],
        "date": today,
        "description": f"{project_name} — {batch.get('name','') if batch else ''} — {rec['milestone']} milestone",
        "company_id": None,
        "partner_id": None,
        "center_id": (batch or {}).get("center_id"),
        "project_id": (batch or {}).get("project_id"),
        "items": [], "attachments": [],
        "created_by": user["id"], "created_at": now,
        "status": "approved", "approved_by": user["id"], "approved_at": now,
        "rejected_reason": None,
    }
    await db.transactions.insert_one(txn)
    res = await db.batch_payments.find_one_and_update(
        {"id": pid},
        {"$set": {"status": "received", "received_date": today, "received_by": user["id"], "txn_id": txn["id"]}},
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
