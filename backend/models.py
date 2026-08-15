"""
SQLAlchemy ORM models for the Reconciliation app.

Every table the app owns is modelled here so Alembic has a single,
complete picture of the schema (`Base.metadata`) to diff against and
autogenerate from. Schema changes to these models must always be
accompanied by an Alembic migration (see backend/alembic/versions/) —
the app never creates or alters tables via Base.metadata.create_all();
`alembic upgrade head` is the only thing that touches DDL.

Tables:
    User             Registered users / authentication (see auth.py).
    Series           One row per uploaded dataset ("series") a user is
                      tracking over time — the parent of everything else.
    Dataset          Denormalised companion to Series, one-to-one on
                      the same id, purpose-built to answer the Ollama
                      chatbot's questions about a dataset quickly.
    SeriesVersion    One row per upload/version of a Series (Source,
                      Day 1, Day 2, ...).
    SeriesRowValue   One row per (series, version, key-row) snapshot —
                      the raw material the "days as columns" value
                      history view is pivoted from.

NOTE on JSONB usage: several columns below (key_columns, column_names,
diff_summary, reconciliation_history, row_data) are JSONB rather than
real relational columns. This is intentional, not a shortcut. The
*shape* of an uploaded file (how many columns, what they're called) is
decided by the user at upload time and differs from file to file, so
it can't be pinned down as fixed SQL columns without a schema
migration per upload. JSONB lets one fixed set of tables hold
arbitrarily-shaped uploaded data while the parts that ARE always the
same across every upload — ids, ownership, timestamps, version numbers
— stay as real, indexed, foreign-keyed relational columns. See
alembic/versions/20260729_..._0002_create_series_datasets_tables.py
for the full rationale.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Float,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    """A registered user of the application.

    Fields:
        id            Primary key.
        full_name     User's display name.
        email         Unique login identifier. Stored lower-cased.
        password_hash bcrypt hash of the user's password — plaintext
                       passwords are never stored.
        created_at    Row creation timestamp (UTC).
        updated_at    Last-modified timestamp (UTC), refreshed on every
                       update via the `onupdate` hook.
        last_login    Timestamp of the user's most recent successful
                       login. NULL until their first login.
        is_active     Soft-disable flag for an account. Inactive users
                       cannot log in.
        role          "ADMIN" or "USER". Authorization must always be
                       checked via this column (current_user.role ==
                       "ADMIN") — never by comparing email addresses.
                       Defaults to "USER" for every newly-created
                       account, including via signup.
    """

    __tablename__ = "users"

    ROLE_ADMIN = "ADMIN"
    ROLE_USER = "USER"

    id = Column(Integer, primary_key=True, autoincrement=True)
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    last_login = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    role = Column(String(20), nullable=False, default=ROLE_USER, server_default=ROLE_USER)

    # Reserved for future ownership relationships (e.g. datasets/series
    # created by this user). No related ORM model exists yet — series
    # ownership currently lives in the psycopg2-managed `series` table
    # in db.py, which is unrelated to this ORM layer.
    # datasets = relationship("Dataset", back_populates="owner")

    def to_dict(self, include_sensitive: bool = False) -> dict:
        """Serialize the user for API responses.

        include_sensitive=True is only used internally (e.g. by the
        login flow, which needs password_hash to verify credentials)
        and should never be set for anything returned to the client.
        """
        data = {
            "id": self.id,
            "full_name": self.full_name,
            "email": self.email,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "is_active": self.is_active,
            "role": self.role,
        }
        if include_sensitive:
            data["password_hash"] = self.password_hash
        return data

    def __repr__(self):
        return f"<User id={self.id} email={self.email!r} role={self.role!r}>"


class Series(Base):
    """A dataset a user is tracking over time ("Reconcile Over Time").

    This is the parent row: every upload of the same logical dataset
    (Source, then Day 1, Day 2, ...) is a `SeriesVersion` underneath
    one `Series`. CRUD for this table currently goes through db.py
    (raw psycopg2, for historical reasons — see the note at the top of
    db.py) rather than through this ORM class, but the table itself is
    defined here so its schema is created/evolved by Alembic like
    every other table.

    Fields:
        series_id    Caller-supplied stable id for the series (not a
                      surrogate integer — matches the id storage.py
                      already uses on disk for this series' files).
        name          Display name.
        created_at    Row creation timestamp (UTC).
        key_columns   JSONB list of column name(s) that uniquely
                       identify a row within this series (e.g.
                       ["CustomerID"]) — chosen by the user at upload
                       time, so it varies per series and can't be a
                       fixed relational column.
        user_id       Owning user. ON DELETE SET NULL: deleting a user
                       does not delete their series data, it just
                       orphans it (kept for audit/recovery purposes).
    """

    __tablename__ = "series"

    series_id = Column(Text, primary_key=True)
    name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    key_columns = Column(JSONB, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (
        Index("idx_series_user", "user_id"),
    )

    def __repr__(self):
        return f"<Series series_id={self.series_id!r} name={self.name!r}>"


class Dataset(Base):
    """Denormalised companion to `Series`, keyed by the same id
    (dataset_id == series_id). Kept deliberately flat/duplicated
    rather than joined at query time so the Ollama chatbot (see
    ollama_service.py / insights.py) can answer "what columns does
    this dataset have?" and similar questions with a single
    single-row lookup instead of assembling the answer from three
    joined tables on every chat turn.

    Fields:
        dataset_id              Same value as the owning series_id.
        dataset_name             Display name.
        original_file_name       Name of the file as uploaded.
        user_id                  Owning user. ON DELETE CASCADE here
                                  (unlike Series.user_id) — this row is
                                  purely a derived/denormalised cache,
                                  so it's fine, and preferable, for it
                                  to disappear with its owner.
        upload_timestamp         When the dataset was first uploaded.
        record_count              Row count of the current version.
        file_type                 "csv" / "xlsx" / etc.
        column_names               JSONB list of the file's column
                                    headers — varies per upload, so
                                    JSONB rather than fixed columns.
        embedding_status          Vector-store indexing state for the
                                    chatbot ("pending"/"done"/"failed").
        reconciliation_history    JSONB array, appended to on every
                                    new version upload, of
                                    {version, label, uploaded_at,
                                    diff_summary} entries — a quick
                                    audit trail without re-reading
                                    every SeriesVersion row.
    """

    __tablename__ = "datasets"

    dataset_id = Column(Text, primary_key=True)
    dataset_name = Column(Text, nullable=False)
    original_file_name = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    upload_timestamp = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    record_count = Column(Integer, nullable=True, default=0)
    file_type = Column(Text, nullable=True)
    column_names = Column(JSONB, nullable=True)
    embedding_status = Column(String(50), nullable=False, default="pending")
    reconciliation_history = Column(JSONB, nullable=True, default=list)

    __table_args__ = (
        Index("idx_datasets_user", "user_id"),
    )

    def __repr__(self):
        return f"<Dataset dataset_id={self.dataset_id!r}>"


class SeriesVersion(Base):
    """One row per upload/version of a Series — Source (version 0),
    Day 1 (version 1), Day 2 (version 2), and so on.

    Fields:
        id            Surrogate integer primary key.
        series_id     Parent series.
        version       0-based version number, unique per series.
        label         Display label ("Source", "Day 1", ...).
        filename      Uploaded filename for this version.
        uploaded_at   Timestamp this version was uploaded.
        row_count     Row count of this version's file.
        column_count  Column count of this version's file.
        key_columns   JSONB — see Series.key_columns; stored per
                      version too since it's echoed back in API
                      responses about this specific version.
        diff_summary  JSONB summary of the Source-vs-this-version diff
                      (counts of Added/Removed/Updated/Unchanged rows,
                      etc.) — structurally different for every series
                      depending on which columns changed, so JSONB
                      rather than fixed columns.
        report_file   Path/name of the generated Excel diff report.
    """

    __tablename__ = "series_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    series_id = Column(Text, ForeignKey("series.series_id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    label = Column(Text, nullable=True)
    filename = Column(Text, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    row_count = Column(Integer, nullable=True)
    column_count = Column(Integer, nullable=True)
    key_columns = Column(JSONB, nullable=True)
    diff_summary = Column(JSONB, nullable=True)
    report_file = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("series_id", "version", name="series_versions_series_id_version_key"),
    )

    def __repr__(self):
        return f"<SeriesVersion series_id={self.series_id!r} version={self.version}>"


class SeriesRowValue(Base):
    """One row per (series, version, key-row) snapshot — the full
    content of a single tracked row exactly as it looked in that
    version's upload.

    This is the table the "days as columns" value-history view
    (db.get_value_history) is built from: fetch every version's
    row_data for a given row_key and pivot it in Python into
    {row_key, column, values: {version: value}}.

    Fields:
        id         Surrogate bigint primary key (this table is by far
                   the largest — every tracked row of every version —
                   hence BIGSERIAL instead of SERIAL).
        series_id  Parent series.
        version    Which version this snapshot belongs to.
        row_key    The row's business key, built by joining its
                   key_columns values (e.g. "CustomerID: 1042").
        row_data   JSONB — the entire row exactly as uploaded, e.g.
                   {"CustomerID": 1042, "Name": "Amit", "Balance": 5000}.
                   Necessarily JSONB: the set of columns is whatever
                   that user's file happened to contain, and is the
                   whole reason this table can serve every series
                   without a per-series table or a migration per
                   upload.
    """

    __tablename__ = "series_row_values"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    series_id = Column(Text, ForeignKey("series.series_id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    row_key = Column(Text, nullable=False)
    row_data = Column(JSONB, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "series_id", "version", "row_key",
            name="series_row_values_series_id_version_row_key_key",
        ),
        Index("idx_series_row_values_lookup", "series_id", "row_key"),
    )

    def __repr__(self):
        return f"<SeriesRowValue series_id={self.series_id!r} version={self.version} row_key={self.row_key!r}>"


class UserSession(Base):
    """One row per login session, used to enforce single-active-session,
    idle-timeout, and refresh-token rotation/revocation.

    Fields:
        id              Surrogate primary key.
        user_id         Owning user. ON DELETE CASCADE: a deleted user's
                         sessions are meaningless.
        session_token   Opaque random identifier embedded as the "sid"
                         claim in both the access and refresh JWTs, so a
                         stolen/replayed token can be checked against
                         (and invalidated via) this row without needing
                         to inspect the JWT signature alone.
        refresh_token   Opaque random refresh secret. Only its bcrypt-ish
                         hash could be stored, but since it is already a
                         high-entropy server-generated value (not a
                         user password) it is stored directly and rotated
                         on every use; the column exists so it can be
                         looked up and invalidated on logout / rotation /
                         single-session eviction.
        created_at      When the session was created (login time).
        expires_at      Absolute expiry of the refresh token (7 days).
        last_activity   Updated on every authenticated request; used to
                         enforce the 30-minute idle timeout.
        ip_address      Client IP at login, for audit purposes.
        user_agent      Client User-Agent at login, for audit purposes.
        is_active       False once logged out, rotated away by a newer
                         login (single active session), or expired.
    """

    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_token = Column(String(64), nullable=False, unique=True, index=True)
    refresh_token = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_activity = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    __table_args__ = (
        Index("idx_sessions_user", "user_id"),
        Index("idx_sessions_user_active", "user_id", "is_active"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "last_activity": self.last_activity.isoformat() if self.last_activity else None,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "is_active": self.is_active,
        }

    def __repr__(self):
        return f"<UserSession id={self.id} user_id={self.user_id} is_active={self.is_active}>"


class ReconciliationMappingSession(Base):
    """Persistent mapping session record (Header Column Mode or Row Index Mode)."""

    __tablename__ = "reconciliation_mapping_sessions"

    id = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    source_dataset_id = Column(Text, nullable=True)
    target_dataset_id = Column(Text, nullable=True)
    source_version = Column(Integer, nullable=False, default=0)
    target_version = Column(Integer, nullable=False, default=0)
    mapping_mode = Column(String(30), nullable=False)  # HEADER_COLUMN or ROW_INDEX
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        Index("idx_mapping_sessions_user", "user_id"),
        Index("idx_mapping_sessions_datasets", "source_dataset_id", "target_dataset_id"),
    )


class HeaderColumnMapping(Base):
    """Stores a single column-to-column pairing for Header/Column Mapping mode."""

    __tablename__ = "header_column_mappings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(String(64), ForeignKey("reconciliation_mapping_sessions.id", ondelete="CASCADE"), nullable=False)
    source_column = Column(Text, nullable=False)
    target_column = Column(Text, nullable=False)
    confidence_score = Column(Float, nullable=False, default=1.0)
    is_key = Column(Boolean, nullable=False, default=False)
    match_explanation = Column(JSONB, nullable=True)

    __table_args__ = (
        Index("idx_header_mappings_session", "session_id"),
    )


class RowIndexMapping(Base):
    """Stores a single index-based row pair (Source Index -> Target Index) for Row-to-Row mode."""

    __tablename__ = "row_index_mappings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(String(64), ForeignKey("reconciliation_mapping_sessions.id", ondelete="CASCADE"), nullable=False)
    source_index = Column(Integer, nullable=False)
    target_index = Column(Integer, nullable=False)
    source_internal_id = Column(Text, nullable=True)
    target_internal_id = Column(Text, nullable=True)

    __table_args__ = (
        Index("idx_row_mappings_session", "session_id"),
    )

