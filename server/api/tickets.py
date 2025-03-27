"""API endpoints for help tickets."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from server.core.auth import (
    get_admin_user,
    get_current_user,
)
from server.core.database import Ticket, User, get_db
from server.schemas.tickets import TicketCreate, TicketResponse, TicketUpdate

router = APIRouter(prefix="")


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


@router.post("", response_model=TicketResponse)
async def create_ticket(
    ticket_data: TicketCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a help ticket."""

    # Set created date as now
    created_at = datetime.now()

    # Create the ticket
    ticket = Ticket(
        title=ticket_data.title,
        description=ticket_data.description,
        status="open",
        user_id=current_user.id,
    )

    # Add the ticket to the database
    async with db.begin():
        db.add(ticket)
        await db.commit()

    # Return the created ticket
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return TicketResponse(
        id=ticket.id,
        user_id=str(current_user.id),
        title=ticket.title,
        description=ticket.description,
        status=ticket.status,
        created_at=created_at,
        updated_at=now,
    )


@router.get("", response_model=list[TicketResponse])
async def get_tickets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all tickets for the current user."""

    async with db.begin():
        tickets_data = await db.execute(
            select(Ticket).where(Ticket.user_id == current_user.id)
        )

    if tickets_data is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve tickets",
        )

    tickets_data = tickets_data.scalars().all()

    # Convert tickets to TicketResponse format
    tickets = [
        TicketResponse(
            id=ticket.id,
            user_id=str(current_user.id),
            title=ticket.title,
            description=ticket.description,
            status=ticket.status,
            created_at=ticket.created_at,
            updated_at=ticket.updated_at,
        )
        for ticket in tickets_data
    ]

    return tickets


@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get ticket by ID."""

    async with db.begin():
        try:
            # Get ticket by ID
            ticket = await db.execute(
                select(Ticket).where(
                    Ticket.id == ticket_id and Ticket.user_id == current_user.id
                )
            )
            return ticket
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
    _: User = Depends(get_admin_user),
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
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):  # TODO
    """Delete ticket."""

    async with db.begin():
        try:
            # Placeholder implementation
            return {"ticket_id": ticket_id, "deleted": True}
        except SQLAlchemyError as e:
            db.rollback()
            raise HTTPException(
                status_code=500, detail=f"Database error deleting ticket: {str(e)}"
            )
