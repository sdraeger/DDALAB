"""API endpoints for help tickets."""

from datetime import datetime
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from server.core.auth import get_current_user
from server.core.database import User, get_db
from server.core.directus_sync import (
    get_directus_token,
    get_user_tickets_from_directus,
    submit_ticket_to_directus,
    sync_users_to_directus,
)
from server.schemas.tickets import TicketUpdate

router = APIRouter(prefix="")


class TicketCreate(BaseModel):
    """Ticket creation request model."""

    title: str
    description: str


class TicketResponse(BaseModel):
    """Ticket response model."""

    id: Optional[int] = None
    title: str
    description: str
    status: str
    user_id: str
    created_at: Optional[Union[datetime, str]] = None


def parse_date(date_str):
    """Parse a date string into a datetime object."""
    if not date_str:
        return None
    try:
        # Try ISO format first (which is what Directus typically uses)
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        try:
            # Fallback to a more flexible parser
            return datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%S.%fZ")
        except (ValueError, AttributeError):
            # Return the original string if all parsing fails
            return date_str


@router.post("/", response_model=TicketResponse)
async def create_ticket(
    ticket_data: TicketCreate,
    current_user: User = Depends(get_current_user),
):
    """Create a help ticket and sync it to Directus."""

    # Get Directus token
    directus_token = get_directus_token()
    if not directus_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not connect to the ticket system",
        )

    # Submit the ticket to Directus
    ticket_result = submit_ticket_to_directus(
        directus_token,
        ticket_data.title,
        ticket_data.description,
        str(current_user.id),
    )

    if not ticket_result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create ticket",
        )

    # Get created date
    created_at = parse_date(ticket_result.get("created_at"))

    # Return the created ticket
    return TicketResponse(
        id=ticket_result.get("id"),
        title=ticket_result.get("title"),
        description=ticket_result.get("description"),
        status=ticket_result.get("status", "open"),
        user_id=str(current_user.id),
        created_at=created_at,
    )


@router.get("/", response_model=List[TicketResponse])
async def get_tickets(
    current_user: User = Depends(get_current_user),
):
    """Get all tickets for the current user."""

    # Get Directus token
    directus_token = get_directus_token()
    if not directus_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not connect to the ticket system",
        )

    # Fetch tickets from Directus for the current user
    tickets_data = get_user_tickets_from_directus(directus_token, str(current_user.id))

    if tickets_data is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve tickets",
        )

    # Convert tickets to TicketResponse format
    tickets = [
        TicketResponse(
            id=ticket.get("id"),
            title=ticket.get("title"),
            description=ticket.get("description"),
            status=ticket.get("status", "open"),
            user_id=str(current_user.id),
            created_at=parse_date(ticket.get("created_at")),
        )
        for ticket in tickets_data
    ]

    return tickets


@router.get("/sync-users", status_code=status.HTTP_200_OK)
async def sync_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually trigger user synchronization (admin only)."""

    async with db.begin():
        # Check if the user is an admin
        if not current_user.is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can sync users",
            )

        # Sync users
        result = sync_users_to_directus(db)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="User synchronization failed",
            )

        return {"message": "User synchronization completed successfully"}


@router.get("/{ticket_id}")
async def get_ticket(
    request: Request,
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get ticket by ID."""

    async with db.begin():
        try:
            # Get current user
            current_user = await get_current_user(request)

            # Placeholder implementation
            return {"ticket_id": ticket_id, "user_id": current_user.id}
        except SQLAlchemyError as e:
            db.rollback()
            raise HTTPException(
                status_code=500, detail=f"Database error retrieving ticket: {str(e)}"
            )


@router.put("/{ticket_id}")
async def update_ticket(
    request: Request,
    ticket_id: str,
    ticket_update: TicketUpdate,  # TODO
    db: AsyncSession = Depends(get_db),
):
    """Update ticket."""

    async with db.begin():
        try:
            # Get current user
            current_user = await get_current_user(request)

            # TODO: Update ticket

            # Placeholder implementation
            return {"ticket_id": ticket_id, "user_id": current_user.id, "updated": True}
        except SQLAlchemyError as e:
            db.rollback()
            raise HTTPException(
                status_code=500, detail=f"Database error updating ticket: {str(e)}"
            )


@router.delete("/{ticket_id}")
async def delete_ticket(
    request: Request,
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete ticket."""
    async with db.begin():
        try:
            # Get current user
            current_user = await get_current_user(request)

            # Placeholder implementation
            return {"ticket_id": ticket_id, "user_id": current_user.id, "deleted": True}
        except SQLAlchemyError as e:
            db.rollback()
            raise HTTPException(
                status_code=500, detail=f"Database error deleting ticket: {str(e)}"
            )
