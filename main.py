"""
WHO?gle Dataset Search Engine — Turbo Backend (DuckDB + Parquet)

Optimized for 5,009,587,740 records across ICMR + HiTek datasets.
Architecture:
  - Zero local disk space required (queries remote Parquet shards via DuckDB httpfs range requests)
  - Auto-routes phone queries to sorted phone index shards (zone-map pruning in 1-5s)
  - Auto-routes Aadhaar queries to sorted Aadhaar index shards (zone-map pruning in 1-5s)
  - Auto-detects local index shards if downloaded into ./data/ or ./.parquet_cache/
  - Cleans \x00 null bytes and infers districts from addresses
  - Deduplicates records (caps at 2 per identity)
  - Serves Google-style SERP Web UI via FastAPI StaticFiles
"""

from contextlib import asynccontextmanager
import asyncio
import glob
import json
import logging
import os
import re
import time
from typing import Any, Optional

import duckdb
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx
from pydantic import BaseModel, Field

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------
DATASET_REPO = os.getenv("HF_DATASET_REPO", "Hfzune/Duplicate-mix")
TOTAL_DATASET_ROWS = 5009587740
DUPLICATE_CAP = 2

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_OUT_DIR = os.path.join(BASE_DIR, "frontend", "out")
DATA_DIR = os.getenv("DATA_DIR", os.path.join(BASE_DIR, "data"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("whoogle")


# ------------------------------------------------------------------------------
# Schemas
# ------------------------------------------------------------------------------
class SearchMetadata(BaseModel):
    query: str
    total_matches: int
    page: int
    limit: int
    offset: int
    scanned_rows: int
    results: list[dict[str, Any]]
    elapsed: float = 0.0


class HealthStatus(BaseModel):
    status: str
    target_dataset: str
    engine: str = "duckdb"
    total_rows: int = TOTAL_DATASET_ROWS
    ui_attached: bool
    phone_shards: int = 7
    aadhar_shards: int = 7


# ------------------------------------------------------------------------------
# Normalization & Helpers
# ------------------------------------------------------------------------------
def clean_val(v: Any) -> Optional[str]:
    """Strip null bytes, whitespace, and leading/trailing markers."""
    if v is None:
        return None
    s = str(v).replace("\x00", "").strip()
    if not s or set(s) <= {".", " ", "-", "!"}:
        return None
    return s


def clean_phone(v: Any) -> Optional[str]:
    """Extract standard Indian mobile (10 digits starting with 6-9) or clean phone."""
    if not v:
        return None
    s = str(v).replace("\x00", "").strip()
    nums = re.findall(r"\b[6-9]\d{9}\b", s)
    if nums:
        return nums[-1]
    c = re.sub(r'[\t\n\r"\'\\]+', ' ', s).strip()
    return c if c else None


def clean_aadhar(v: Any) -> Optional[str]:
    """Clean Aadhaar string and strip null byte strings."""
    if not v:
        return None
    s = str(v).replace("\x00", "").strip()
    if not s or len(s) < 12:
        return None
    # If it is 12 digits, return it
    nums = re.findall(r"\b\d{12}\b", s)
    if nums:
        return nums[0]
    return s if any(c.isdigit() for c in s) else None


def extract_district(row: dict) -> Optional[str]:
    d = clean_val(row.get("district"))
    if d:
        return d
    addr = clean_val(row.get("address"))
    if addr and "!" in addr:
        parts = [p.strip() for p in addr.split("!") if p.strip()]
        if len(parts) >= 3:
            return parts[-3]
    return None


def normalize_record(raw: dict[str, Any], row_idx: int = 0) -> dict[str, Any]:
    pp = clean_phone(raw.get("phoneNumber") or raw.get("Number"))
    ap = clean_phone(raw.get("otherNumber"))
    aadhar = clean_aadhar(raw.get("aadharNumber"))
    district = extract_district(raw)
    carrier = clean_val(raw.get("Carrier") or raw.get("carrier"))
    gender = clean_val(raw.get("Gender") or raw.get("gender"))
    default_src = "Truecaller 285M" if (carrier or "Number" in raw) else "inddata"

    return {
        "id": row_idx,
        "dataset_id": row_idx,
        "row_idx": row_idx,
        "name": clean_val(raw.get("name") or raw.get("Name")),
        "phone": pp or ap,
        "email": clean_val(raw.get("email") or raw.get("Email")),
        "district": district,
        "aadhar": aadhar,
        "address": clean_val(raw.get("address") or raw.get("Address")),
        "fathersName": clean_val(raw.get("fathersName")),
        "phoneNumber": pp,
        "otherNumber": ap,
        "aadharNumber": aadhar,
        "source": clean_val(raw.get("source")) or default_src,
        "state": clean_val(raw.get("state")),
        "town": clean_val(raw.get("town")),
        "pincode": clean_val(raw.get("pincode")),
        "carrier": carrier,
        "gender": gender,
    }


def _person_identity_key(row: dict[str, Any]) -> tuple:
    p = row.get("phone") or ""
    a = row.get("aadhar") or ""
    n = (row.get("name") or "").lower()
    return (p, a, n)


# ------------------------------------------------------------------------------
# DuckDB Zero-Download Engine
# ------------------------------------------------------------------------------
class DuckDBEngine:
    """
    High-performance zero-download search engine over 5.01B rows.
    Uses DuckDB's httpfs extension to query remote Parquet files via HTTP range requests.
    """

    def __init__(self):
        self.con: Optional[duckdb.DuckDBPyConnection] = None
        self.ready = False
        self.total_rows = TOTAL_DATASET_ROWS
        self.loading = False
        self.load_error: Optional[str] = None
        self._phone_shards: list[str] = []
        self._aadhar_shards: list[str] = []
        self._cache: dict[str, tuple[list[dict], int, float]] = {}

    def initialize(self):
        """Configure DuckDB with httpfs and create virtual views over sorted index shards."""
        if self.loading or self.ready:
            return
        self.loading = True

        try:
            logger.info("Initializing DuckDB with httpfs for 5B rows dataset...")
            con = duckdb.connect()
            con.execute("INSTALL httpfs; LOAD httpfs;")
            con.execute("SET enable_http_metadata_cache = true;")
            con.execute("SET threads = 8;")
            con.execute("SET memory_limit = '4GB';")

            # Check if user has local index files in ./data, ./.parquet_cache, or root
            local_phone = sorted(glob.glob(os.path.join(DATA_DIR, "idx_phone.*.parquet")) +
                                glob.glob(os.path.join(BASE_DIR, ".parquet_cache", "idx_phone.*.parquet")) +
                                glob.glob(os.path.join(BASE_DIR, "idx_phone.*.parquet")))

            local_aadhar = sorted(glob.glob(os.path.join(DATA_DIR, "idx_aadhar.*.parquet")) +
                                 glob.glob(os.path.join(BASE_DIR, ".parquet_cache", "idx_aadhar.*.parquet")) +
                                 glob.glob(os.path.join(BASE_DIR, "idx_aadhar.*.parquet")))

            if local_phone:
                self._phone_shards = local_phone
                logger.info("Using %d local phone index shard(s)", len(local_phone))
            else:
                self._phone_shards = [
                    f"https://huggingface.co/datasets/{DATASET_REPO}/resolve/main/idx_phone.{i}.parquet"
                    for i in range(7)
                ]
                logger.info("Using 7 remote Hugging Face phone shards: %s", DATASET_REPO)

            if local_aadhar:
                self._aadhar_shards = local_aadhar
                logger.info("Using %d local Aadhaar index shard(s)", len(local_aadhar))
            else:
                self._aadhar_shards = [
                    f"https://huggingface.co/datasets/{DATASET_REPO}/resolve/main/idx_aadhar.{i}.parquet"
                    for i in range(7)
                ]
                logger.info("Using 7 remote Hugging Face Aadhaar shards: %s", DATASET_REPO)

            # Create virtual views
            phone_lst = ", ".join(f"'{u}'" for u in self._phone_shards)
            aadhar_lst = ", ".join(f"'{u}'" for u in self._aadhar_shards)

            con.execute(f"CREATE VIEW IF NOT EXISTS people_phone AS SELECT * FROM read_parquet([{phone_lst}])")
            con.execute(f"CREATE VIEW IF NOT EXISTS people_aadhar AS SELECT * FROM read_parquet([{aadhar_lst}])")

            # Truecaller shards (first 4 shards for fast sub-3s index search)
            tc_shards = [f"https://huggingface.co/datasets/ishdatt/Truecaller285m/resolve/main/idx_phone.{i}.parquet" for i in range(4)]
            tc_lst = ", ".join(f"'{u}'" for u in tc_shards)
            con.execute(f"CREATE VIEW IF NOT EXISTS truecaller_phone AS SELECT Number as phoneNumber, Name as name, Carrier as carrier, Gender as gender, Address as address, Email as email FROM read_parquet([{tc_lst}])")

            self.con = con
            self.ready = True
            self.load_error = None
            logger.info("DuckDB Index Engine Ready! Total searchable records: %s (Duplicate-mix + Truecaller)", f"{self.total_rows:,}")

        except Exception as e:
            self.load_error = str(e)
            logger.exception("DuckDB initialization failed: %s", e)
        finally:
            self.loading = False

    def search(
        self, query: str, field: str = "auto", limit: int = 50, offset: int = 0, max_scan: int = 10000, dataset: str = "all"
    ) -> tuple[list[dict], int, float]:
        """
        Execute an index-aware query with zone-map pruning and deduplication.
        """
        if not self.ready or not self.con:
            raise RuntimeError("DuckDB index engine is not initialized yet.")

        q = query.strip()
        if not q:
            return [], 0, 0.0

        t0 = time.time()
        cache_key = f"{q.lower()}:{field}:{limit}:{offset}:{max_scan}:{dataset}"
        if cache_key in self._cache:
            cached_res, cached_total, _ = self._cache[cache_key]
            return cached_res, cached_total, round(time.time() - t0, 4)
        digits = re.sub(r"\D", "", q)
        q_escaped = q.replace("'", "''")
        q_lower = q_escaped.lower()

        # Target routing
        is_phone = (len(digits) == 10 and digits[0] in "6789") or (field == "phone" and digits)
        is_aadhar = len(digits) == 12 or (field in ("aadhar", "aadhaar") and digits)

        fetch_limit = min(limit * DUPLICATE_CAP + 20, 200)

        if is_phone:
            target_phone = digits[-10:]
            if dataset == "truecaller":
                sql = f"""
                    SELECT phoneNumber, name, carrier, gender, address, email,
                           NULL as fathersName, NULL as otherNumber, NULL as aadharNumber,
                           NULL as district, NULL as state, NULL as town, NULL as pincode,
                           'Truecaller 285M' as source
                    FROM truecaller_phone
                    WHERE phoneNumber = '{target_phone}'
                    LIMIT {fetch_limit}
                """
            else:
                sql = f"""
                    SELECT phoneNumber, name, NULL as carrier, NULL as gender, address, NULL as email,
                           fathersName, otherNumber, aadharNumber, district, state, town, pincode,
                           'inddata' as source
                    FROM people_phone
                    WHERE phoneNumber = '{target_phone}'
                    LIMIT {fetch_limit}
                """
        elif is_aadhar:
            target_aadhar = digits[-12:]
            sql = f"""
                SELECT phoneNumber, name, NULL as carrier, NULL as gender, address, NULL as email,
                       fathersName, otherNumber, aadharNumber, district, state, town, pincode,
                       'inddata' as source
                FROM people_aadhar
                WHERE aadharNumber = '{target_aadhar}'
                LIMIT {fetch_limit}
            """
        elif field == "district":
            # District lookup on shard 0 with scan limit for speed
            first_shard = self._phone_shards[0]
            scan_limit = max(1000, min(max_scan, 100000))
            sql = f"""
                SELECT phoneNumber, name, NULL as carrier, NULL as gender, address, NULL as email,
                       fathersName, otherNumber, aadharNumber, district, state, town, pincode,
                       'inddata' as source
                FROM (SELECT * FROM read_parquet('{first_shard}') LIMIT {scan_limit})
                WHERE LOWER(district) = '{q_lower}' OR LOWER(state) = '{q_lower}'
                LIMIT {fetch_limit}
            """
        else:
            # Freeform text / name search on first shard with scan limit for fast response
            first_shard = self._phone_shards[0]
            scan_limit = max(1000, min(max_scan, 100000))
            sql = f"""
                SELECT phoneNumber, name, NULL as carrier, NULL as gender, address, NULL as email,
                       fathersName, otherNumber, aadharNumber, district, state, town, pincode,
                       'inddata' as source
                FROM (SELECT * FROM read_parquet('{first_shard}') LIMIT {scan_limit})
                WHERE LOWER(name) LIKE '%{q_lower}%' OR LOWER(fathersName) LIKE '%{q_lower}%'
                LIMIT {fetch_limit}
            """

        try:
            cursor = self.con.execute(sql)
            col_names = [d[0] for d in cursor.description]
            raw_rows = cursor.fetchall()

            # If searching all datasets and is_phone, check Truecaller if fewer than limit
            if is_phone and dataset == "all" and len(raw_rows) < limit:
                try:
                    tc_cursor = self.con.execute(f"""
                        SELECT phoneNumber, name, carrier, gender, address, email,
                               NULL as fathersName, NULL as otherNumber, NULL as aadharNumber,
                               NULL as district, NULL as state, NULL as town, NULL as pincode,
                               'Truecaller 285M' as source
                        FROM truecaller_phone
                        WHERE phoneNumber = '{target_phone}'
                        LIMIT {limit - len(raw_rows)}
                    """)
                    tc_rows = tc_cursor.fetchall()
                    if tc_rows:
                        raw_rows.extend(tc_rows)
                except Exception as ex:
                    logger.warning("Truecaller query fallback: %s", ex)
        except Exception as e:
            logger.error("DuckDB execution error: %s on SQL: %s", e, sql)
            return [], 0, time.time() - t0

        # Normalization and identity deduplication (cap at DUPLICATE_CAP)
        seen: dict[tuple, int] = {}
        deduped: list[dict] = []

        for idx, row in enumerate(raw_rows):
            raw_dict = dict(zip(col_names, row))
            norm = normalize_record(raw_dict, row_idx=offset + idx + 1)
            ident = _person_identity_key(norm)
            count = seen.get(ident, 0)
            if count < DUPLICATE_CAP:
                seen[ident] = count + 1
                deduped.append(norm)

        total_matches = len(deduped)
        paginated_results = deduped[offset : offset + limit]
        elapsed = time.time() - t0

        result_tuple = (paginated_results, total_matches, elapsed)
        self._cache[cache_key] = result_tuple
        return result_tuple


# Global Engine Instance
db_engine = DuckDBEngine()


# ------------------------------------------------------------------------------
# Lifespan
# ------------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DuckDB views synchronously/asynchronously on boot
    db_engine.initialize()
    logger.info("WHO?gle 5B Search Server started.")
    yield
    logger.info("WHO?gle Server shutting down.")


# ------------------------------------------------------------------------------
# App & CORS
# ------------------------------------------------------------------------------
app = FastAPI(
    title="WHO?gle 5-Billion Dataset Search Engine",
    version="4.0.0",
    description="DuckDB-powered zero-download index search over 5,009,587,740 records",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------
@app.get("/search", response_model=SearchMetadata)
async def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    field: str = Query(default="auto"),
    dataset: str = Query(default="all"),
    max_scan: int = Query(default=10000, ge=100, le=100000),
):
    """Instant JSON search with Parquet zone-map pruning."""
    if not db_engine.ready:
        db_engine.initialize()

    digits = re.sub(r"\D", "", q)
    is_indexed = (len(digits) == 10 and digits[0] in "6789") or (field == "phone" and digits) or len(digits) == 12 or (field in ("aadhar", "aadhaar") and digits)
    scanned = db_engine.total_rows if is_indexed else min(max_scan, 100000)

    results, total, elapsed = db_engine.search(q, field, limit, offset, max_scan, dataset)

    return SearchMetadata(
        query=q.strip(),
        total_matches=total,
        page=(offset // limit) + 1 if limit > 0 else 1,
        limit=limit,
        offset=offset,
        scanned_rows=scanned,
        results=results,
        elapsed=round(elapsed, 4),
    )


@app.get("/search/stream")
async def search_stream(
    request: Request,
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    field: str = Query(default="auto"),
    dataset: str = Query(default="all"),
    max_scan: int = Query(default=10000, ge=100, le=100000),
):
    """SSE streaming endpoint for real-time frontend UI updates."""
    if not db_engine.ready:
        db_engine.initialize()

    digits = re.sub(r"\D", "", q)
    is_indexed = (len(digits) == 10 and digits[0] in "6789") or (field == "phone" and digits) or len(digits) == 12 or (field in ("aadhar", "aadhaar") and digits)
    scanned_count = db_engine.total_rows if is_indexed else min(max_scan, 100000)

    async def event_generator():
        t0 = time.time()
        # Initial starting progress
        yield f"event: progress\ndata: {json.dumps({'scanned': scanned_count, 'matches': 0, 'wave': 1, 'elapsed': 0.0, 'status': 'Querying remote 5.29B-row index...' if is_indexed else f'Scanning {scanned_count:,} records...'})}\n\n"

        loop = asyncio.get_running_loop()
        try:
            results, total, elapsed = await loop.run_in_executor(
                None, db_engine.search, q, field, limit, offset, max_scan, dataset
            )
        except Exception as e:
            logger.exception("Search stream error: %s", e)
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"
            return

        for rec in results:
            if await request.is_disconnected():
                return
            yield f"event: match\ndata: {json.dumps(rec, default=str)}\n\n"

        total_elapsed = round(time.time() - t0, 3)
        yield f"event: progress\ndata: {json.dumps({'scanned': scanned_count, 'matches': total, 'wave': 1, 'elapsed': total_elapsed, 'status': 'Done'})}\n\n"
        yield f"event: done\ndata: {json.dumps({'scanned': scanned_count, 'matches': total, 'elapsed': total_elapsed})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/engine/status")
async def engine_status():
    return {
        "ready": db_engine.ready,
        "loading": db_engine.loading,
        "total_rows": db_engine.total_rows,
        "phone_shards": len(db_engine._phone_shards),
        "aadhar_shards": len(db_engine._aadhar_shards),
        "error": db_engine.load_error,
        "engine": "duckdb_httpfs",
    }


@app.get("/health", response_model=HealthStatus)
async def health():
    return HealthStatus(
        status="healthy" if db_engine.ready else "initializing",
        target_dataset=DATASET_REPO,
        engine="duckdb_httpfs",
        total_rows=db_engine.total_rows,
        ui_attached=os.path.exists(FRONTEND_OUT_DIR),
        phone_shards=len(db_engine._phone_shards),
        aadhar_shards=len(db_engine._aadhar_shards),
    )


# ------------------------------------------------------------------------------
# Mount Frontend
# ------------------------------------------------------------------------------
if os.path.exists(FRONTEND_OUT_DIR):
    logger.info("Mounting WHO?gle UI from %s", FRONTEND_OUT_DIR)
    app.mount("/", StaticFiles(directory=FRONTEND_OUT_DIR, html=True), name="frontend")
else:
    @app.get("/")
    async def root():
        return {
            "service": "WHO?gle 5-Billion Dataset Search Engine",
            "docs": "/docs",
            "search": "/search?q=9431472865",
            "total_rows": TOTAL_DATASET_ROWS,
        }
