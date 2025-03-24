"""Ticket schema definitions."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class TicketBase(BaseModel):
    """Base schema for tickets."""

    title: str
    description: Optional[str] = None
    priority: Optional[str] = "medium"
    status: Optional[str] = "new"


class TicketCreate(TicketBase):
    """Schema for creating tickets."""

    pass


class TicketUpdate(BaseModel):
    """Schema for updating tickets."""

    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None


class Ticket(TicketBase):
    """Schema for retrieving tickets."""

    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True
