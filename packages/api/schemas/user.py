from pydantic import BaseModel, Field


class User(BaseModel):
    """User response schema."""

    id: int = Field(..., description="User ID")
    username: str = Field(..., description="Username")
    email: str = Field(..., description="Email")
    first_name: str | None = Field(None, description="First name")
    last_name: str | None = Field(None, description="Last name")
    is_active: bool = Field(..., description="Active status")
    is_admin: bool = Field(..., description="Admin status")

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "username": "user",
                "email": "user@example.com",
                "first_name": "First",
                "last_name": "Last",
                "is_active": True,
                "is_admin": False,
            }
        }


class UserCreate(BaseModel):
    """User creation request model."""

    username: str
    password: str
    email: str
    first_name: str
    last_name: str
    is_admin: bool = False


class UserUpdate(BaseModel):
    """User update request model."""

    username: str | None = None
    password: str | None = None
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    is_admin: bool | None = None
