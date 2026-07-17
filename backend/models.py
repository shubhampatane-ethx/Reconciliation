"""
SQLAlchemy ORM models for the Reconciliation app.

Currently contains the `User` model backing authentication. Schema
changes to these models must be accompanied by an Alembic migration
(see backend/alembic/versions/) — the app never creates or alters
tables via Base.metadata.create_all().
"""

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String
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
    """

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    last_login = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

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
        }
        if include_sensitive:
            data["password_hash"] = self.password_hash
        return data

    def __repr__(self):
        return f"<User id={self.id} email={self.email!r}>"
