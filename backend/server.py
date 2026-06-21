from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import csv
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Query
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
class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: str


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["admin", "manager", "viewer"] = "manager"


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


class TransactionOut(TransactionIn):
    id: str
    created_by: str
    created_at: str


# ---------- Startup ----------
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    for col in ("companies", "partners", "centers", "projects", "transactions"):
        await db[col].create_index("id", unique=True)

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
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        log.info("Seeded admin user")
    elif not verify_password(admin_pwd, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pwd)}})


@app.on_event("shutdown")
async def on_shutdown():
    client.close()


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
        "role": body.role,
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
    company_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    center_id: Optional[str] = None,
    project_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    q: dict = {}
    if type:
        q["type"] = type
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
async def create_transaction(body: TransactionIn, user=Depends(require_role("admin", "manager"))):
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_by"] = user["id"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.transactions.insert_one(doc)
    return TransactionOut(**doc)


@api.put("/transactions/{tid}", response_model=TransactionOut)
async def update_transaction(tid: str, body: TransactionIn, _=Depends(require_role("admin", "manager"))):
    res = await db.transactions.find_one_and_update(
        {"id": tid},
        {"$set": body.model_dump()},
        return_document=True,
    )
    if not res:
        raise HTTPException(404, "Not found")
    res.pop("_id", None)
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
                "created_by": user["id"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.transactions.insert_one(doc)
            inserted += 1
        except Exception as e:
            errors.append(f"row {i}: {e}")

    return {"inserted": inserted, "errors": errors}


# ---------- Dashboard ----------
@api.get("/dashboard/summary")
async def dashboard_summary(
    _=Depends(get_current_user),
    company_id: Optional[str] = None,
    partner_id: Optional[str] = None,
    center_id: Optional[str] = None,
    project_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    match: dict = {}
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
    }


@api.get("/")
async def root():
    return {"service": "finance-tracker", "ok": True}


# ---------- Register router + CORS ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
