from pydantic import BaseModel, Field


class User(BaseModel):
    """User schema with validation."""

    id: int = Field(..., description="User ID")
    username: str = Field(..., description="Username")
    password_hash: str = Field(..., description="Password hash")
    is_active: bool = Field(..., description="Active status")
    is_admin: bool = Field(..., description="Admin status")

    class Config:
        json_schema_extra = {
            "example": {
                "id": 1,
                "username": "user",
                "password_hash": "password",
                "is_active": True,
                "is_admin": False,
            }
        }
