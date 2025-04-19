"""API endpoints for help tickets."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.auth import (
    get_admin_user,
    get_current_user,
)
from ..core.database import Ticket, User
from ..core.repository import TicketRepository, get_repository
from ..schemas.tickets import TicketCreate, TicketResponse, TicketUpdate

router = APIRouter(prefix="")


def parse_date(date_str):
    """Parse a date string into a datetime object."""
    if not date_str:
        return None
    try:
        # Try ISO format first
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
    ticket_repo: TicketRepository = Depends(get_repository(TicketRepository)),
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
    await ticket_repo.add(ticket)

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
    ticket_repo: TicketRepository = Depends(get_repository(TicketRepository)),
):
    """Get all tickets for the current user."""

    tickets_data = await ticket_repo.get_by_user_id(current_user.id)

    if tickets_data is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve tickets",
        )

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
    ticket_repo: TicketRepository = Depends(get_repository(TicketRepository)),
    _: User = Depends(get_current_user),
):
    """Get ticket by ID."""

    try:
        # Get ticket by ID
        ticket = await ticket_repo.get_by_id(ticket_id)
        return ticket
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Database error retrieving ticket: {str(e)}"
        )


@router.put("/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    ticket_update: TicketUpdate,
    ticket_repo: TicketRepository = Depends(get_repository(TicketRepository)),
    _: User = Depends(get_admin_user),
):
    """Update ticket."""

    try:
        ticket = await ticket_repo.update(ticket_id, ticket_update)
        return ticket
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Database error updating ticket: {str(e)}"
        )


@router.delete("/{ticket_id}")
async def delete_ticket(
    ticket_id: str,
    ticket_repo: TicketRepository = Depends(get_repository(TicketRepository)),
    _: User = Depends(get_admin_user),
):
    """Delete ticket."""

    try:
        await ticket_repo.delete(ticket_id)
        return {"ticket_id": ticket_id, "deleted": True}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Database error deleting ticket: {str(e)}"
        )
