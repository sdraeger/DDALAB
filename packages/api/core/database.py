"""Database configuration and models."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    UUID,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

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
    edf_configs = relationship(
        "EdfConfig", back_populates="user", cascade="all, delete-orphan"
    )
    artifacts = relationship(
        "Artifact", back_populates="owner", cascade="all, delete-orphan"
    )
    artifact_shares = relationship(
        "ArtifactShare",
        back_populates="user",
        foreign_keys="ArtifactShare.user_id",
        cascade="all, delete-orphan",
    )
    shared_artifacts = relationship(
        "ArtifactShare",
        back_populates="shared_with_user",
        foreign_keys="ArtifactShare.shared_with_user_id",
        cascade="all, delete-orphan",
    )
    layouts = relationship(
        "UserLayout", back_populates="user", cascade="all, delete-orphan"
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


class EdfConfig(Base):
    __tablename__ = "edf_configs"

    id = Column(Integer, primary_key=True, index=True)
    file_hash = Column(String(255), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="edf_configs")
    channels = relationship("EdfConfigChannel", back_populates="config")


class EdfConfigChannel(Base):
    __tablename__ = "edf_config_channels"

    id = Column(Integer, primary_key=True, index=True)
    config_id = Column(Integer, ForeignKey("edf_configs.id"), nullable=False)
    channel = Column(String(100), nullable=False)

    config = relationship("EdfConfig", back_populates="channels")


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

    id = Column(
        Integer,
        primary_key=True,
        index=True,
        autoincrement=True,
        nullable=False,
    )
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


class Artifact(Base):
    __tablename__ = "artifacts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=True)
    file_path = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(
        DateTime,
        default=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    owner = relationship("User", back_populates="artifacts")
    shares = relationship("ArtifactShare", back_populates="artifact")


class ArtifactShare(Base):
    __tablename__ = "artifact_shares"
    id = Column(Integer, primary_key=True, index=True)
    artifact_id = Column(UUID(as_uuid=True), ForeignKey("artifacts.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    shared_with_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    artifact = relationship("Artifact", back_populates="shares")
    user = relationship(
        "User", back_populates="artifact_shares", foreign_keys=[user_id]
    )
    shared_with_user = relationship(
        "User", back_populates="shared_artifacts", foreign_keys=[shared_with_user_id]
    )


class UserLayout(Base):
    __tablename__ = "user_layouts"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    layout_data = Column(JSONB, nullable=False)
    created_at = Column(
        DateTime, default=datetime.now(timezone.utc).replace(tzinfo=None)
    )
    user = relationship("User", back_populates="layouts")
