"""Ticket schema definitions."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class TicketBase(BaseModel):
    """Base schema for tickets."""

    title: str
    description: str
    status: str


class TicketUpdate(BaseModel):
    """Schema for updating tickets."""

    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


class Ticket(TicketBase):
    """Schema for retrieving tickets."""

    id: int
    user_id: int
    title: str
    description: str
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class TicketCreate(BaseModel):
    """Ticket creation request model."""

    title: str
    description: str


class TicketResponse(BaseModel):
    """Ticket response model."""

    id: int
    user_id: str
    title: str
    description: str
    status: str
    created_at: datetime
    updated_at: datetime
