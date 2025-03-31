"""Database configuration and models."""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from server.core.config import get_server_settings

settings = get_server_settings()

# Get PostgreSQL connection details from environment variables
DB_HOST = settings.db_host
DB_PORT = settings.db_port
DB_NAME = settings.db_name
DB_USER = settings.db_user
DB_PASSWORD = settings.db_password

# Create SQLAlchemy engine for PostgreSQL
SQLALCHEMY_DATABASE_URL = (
    f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)
engine = create_async_engine(SQLALCHEMY_DATABASE_URL, echo=True)

# Create async session factory
AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Create base class for models
Base = declarative_base()


class User(Base):
    """User model."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    email = Column(String, unique=True, index=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    created_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    updated_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
        onupdate=datetime.now(timezone.utc).replace(tzinfo=None),
    )

    # Relationships
    favorite_files = relationship(
        "FavoriteFile", back_populates="user", cascade="all, delete-orphan"
    )
    preferences = relationship(
        "UserPreferences",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class UserPreferences(Base):
    """User preferences model."""

    __tablename__ = "user_preferences"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True, index=True)
    theme = Column(String, default="system")
    eeg_zoom_factor = Column(Float, default=0.05)
    updated_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
        onupdate=datetime.now(timezone.utc).replace(tzinfo=None),
    )

    # Relationships
    user = relationship("User", back_populates="preferences")


class Annotation(Base):
    """Annotation model for EDF data."""

    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    file_path = Column(String, index=True)  # Path to the EDF file
    start_time = Column(Integer)  # Start sample position
    end_time = Column(Integer, nullable=True)  # End sample position (optional)
    text = Column(String)  # Annotation text
    created_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    updated_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
        onupdate=datetime.now(timezone.utc).replace(tzinfo=None),
    )

    # Relationships
    user = relationship("User", backref="annotations")


class FavoriteFile(Base):
    """Favorite file model for starred files."""

    __tablename__ = "favorite_files"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    file_path = Column(String, index=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    )

    user = relationship("User", back_populates="favorite_files")


class PasswordResetToken(Base):
    """Password reset token model."""

    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    expires_at = Column(DateTime)

    # Relationships
    user = relationship("User")


class InviteCode(Base):
    """Invite code model."""

    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True)
    email = Column(String)
    created_at = Column(
        DateTime,
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
    )
    expires_at = Column(DateTime)
    used_at = Column(DateTime, nullable=True)


class Ticket(Base):
    """Ticket model."""

    __tablename__ = "help_tickets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String)
    description = Column(String)
    status = Column(String)
    created_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    updated_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
        onupdate=datetime.now(timezone.utc).replace(tzinfo=None),
    )


async def get_db():
    db = AsyncSessionLocal()
    try:
        yield db
    finally:
        await db.close()
