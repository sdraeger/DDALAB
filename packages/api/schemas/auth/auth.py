"""Authentication schema models."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class Token(BaseModel):
    """Token schema."""

    access_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    """Schema for token refresh requests."""

    refresh_token: str = Field(
        ..., description="Refresh token to use for getting a new access token"
    )


class UserBase(BaseModel):
    """Base user schema."""

    username: str = Field(..., description="Username for login")
    email: Optional[EmailStr] = Field(None, description="Email address")
    first_name: Optional[str] = Field(None, description="User's first name")
    last_name: Optional[str] = Field(None, description="User's last name")
    is_active: bool = Field(True, description="Whether the user account is active")
    is_superuser: bool = Field(
        False, description="Whether the user has admin privileges"
    )


class UserCreate(UserBase):
    """Schema for creating a new user."""

    password: str = Field(..., description="Password for login")


class UserUpdate(UserBase):
    """Schema for updating an existing user."""

    password: Optional[str] = Field(None, description="Password for login")

    class Config:
        """Pydantic config."""

        extra = "forbid"


class UserResponse(UserBase):
    """Schema for user responses."""

    id: int = Field(..., description="User ID")
    created_at: datetime = Field(..., description="When the user was created")
    updated_at: datetime = Field(..., description="When the user was last updated")
    last_login: Optional[datetime] = Field(
        None, description="When the user last logged in"
    )

    class Config:
        """Pydantic configuration."""

        from_attributes = True


class LoginCredentials(BaseModel):
    """Schema for login credentials."""

    username: str
    password: str
