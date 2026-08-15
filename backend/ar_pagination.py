"""
AR result pagination — server-side pagination / lazy loading for the AR
reconciliation result buckets (matched, disputed, unmatched, etc.).

Purely additive: does not touch PostgreSQL, Qdrant, Master Data, or Admin
code, and does not change any reconciliation logic. It only controls how
already-computed result rows are filtered/sorted/paginated before being
sent to the client, so the frontend never has to load an entire result
set at once for large files.

Results are computed once per /api/ar/reconcile call (same as before) and
then cached in-memory, keyed by a generated job_id, so subsequent page
requests are a cheap in-memory slice instead of recomputation or a
re-upload. The cache is bounded (max jobs) and time-limited (TTL) so it
can't grow unbounded — it is a request-scoped convenience cache, not a
system of record.
"""
import time
import uuid
from threading import Lock

DEFAULT_PAGE_SIZE = 50
ALLOWED_PAGE_SIZES = (25, 50, 100, 250)
MAX_PAGE_SIZE = 500
_MAX_JOBS = 200
_TTL_SECONDS = 30 * 60  # 30 minutes

_JOBS = {}
_LOCK = Lock()


def _evict_stale():
    now = time.time()
    stale = [jid for jid, job in _JOBS.items() if now - job["created"] > _TTL_SECONDS]
    for jid in stale:
        _JOBS.pop(jid, None)
    # Bound by count too, evicting oldest first
    if len(_JOBS) > _MAX_JOBS:
        for jid, _ in sorted(_JOBS.items(), key=lambda kv: kv[1]["created"])[: len(_JOBS) - _MAX_JOBS]:
            _JOBS.pop(jid, None)


def store_job(buckets: dict, meta: dict = None) -> str:
    """buckets: {bucket_name: [row_dict, ...]}. Returns a job_id."""
    with _LOCK:
        _evict_stale()
        job_id = uuid.uuid4().hex
        _JOBS[job_id] = {"created": time.time(), "buckets": buckets, "meta": meta or {}}
        return job_id


def get_job(job_id: str):
    with _LOCK:
        _evict_stale()
        return _JOBS.get(job_id)


def normalize_page_size(page_size) -> int:
    """Snap a requested page_size to the nearest supported value in
    ALLOWED_PAGE_SIZES (25, 50, 100, 250). Invalid/missing input falls back
    to DEFAULT_PAGE_SIZE (50). This is the single choke point every route
    uses, so the UI's page-size selector and the API can never drift apart."""
    try:
        requested = int(page_size)
    except (TypeError, ValueError):
        return DEFAULT_PAGE_SIZE
    if requested in ALLOWED_PAGE_SIZES:
        return requested
    return min(ALLOWED_PAGE_SIZES, key=lambda allowed: abs(allowed - requested))


def paginate_list(items, page: int = 1, page_size: int = DEFAULT_PAGE_SIZE,
                   sort_by: str = None, sort_dir: str = "asc", q: str = None):
    """
    Deterministic server-side filter -> sort -> paginate, applied in that
    order (filtering/sorting always happen before the page slice, and the
    full list is never handed back to the caller — only the requested
    page plus counts).
    """
    page = max(1, int(page or 1))
    page_size = normalize_page_size(page_size)

    filtered = items
    if q:
        needle = str(q).strip().lower()
        if needle:
            filtered = [
                row for row in items
                if any(needle in str(v).lower() for v in row.values())
            ]

    if sort_by:
        reverse = str(sort_dir).lower() == "desc"

        def _key(row):
            v = row.get(sort_by)
            # None-safe, type-mixed sort: push missing values last
            return (v is None, v if v is not None else "")

        try:
            filtered = sorted(filtered, key=_key, reverse=reverse)
        except TypeError:
            # Mixed incomparable types under the same key — fall back to
            # string comparison rather than erroring the request.
            filtered = sorted(filtered, key=lambda r: str(r.get(sort_by, "")), reverse=reverse)

    total = len(filtered)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, total_pages)
    start = (page - 1) * page_size
    page_items = filtered[start: start + page_size]

    return {
        "items": page_items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }
