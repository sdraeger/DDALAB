"""Routes for managing help tickets."""

from datetime import datetime, timezone

from core.auth import get_admin_user, get_current_user
from core.dependencies import get_service
from core.models import User
from core.services import TicketService
from fastapi import APIRouter, Depends, HTTPException, status
from schemas.tickets import Ticket, TicketCreate, TicketResponse, TicketUpdate

router = APIRouter()


def parse_date(date_str: str | None) -> datetime | None:
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
    ticket_service: TicketService = Depends(get_service(TicketService)),
):
    """Create a help ticket."""

    # Set created date as now
    created_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # Create the ticket
    ticket = Ticket(
        title=ticket_data.title,
        description=ticket_data.description,
        status="open",
        user_id=current_user.id,
        created_at=created_at,
        updated_at=created_at,
    )

    # Add the ticket to the database
    created_ticket = await ticket_service.create_ticket(ticket)

    # Return the created ticket
    return TicketResponse(
        id=created_ticket.id,
        user_id=str(current_user.id),
        title=created_ticket.title,
        description=created_ticket.description,
        status=created_ticket.status,
        created_at=created_ticket.created_at,
        updated_at=created_ticket.updated_at,
    )


@router.get("", response_model=list[TicketResponse])
async def get_tickets(
    current_user: User = Depends(get_current_user),
    ticket_service: TicketService = Depends(get_service(TicketService)),
):
    """Get all tickets for the current user."""

    tickets_data = await ticket_service.get_tickets_by_user_id(current_user.id)

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
    ticket_service: TicketService = Depends(get_service(TicketService)),
    _: User = Depends(get_current_user),
):
    """Get ticket by ID."""

    try:
        # Get ticket by ID
        ticket = await ticket_service.get_ticket(ticket_id)
        return ticket
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Database error retrieving ticket: {str(e)}"
        )


@router.put("/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    ticket_update: TicketUpdate,
    ticket_service: TicketService = Depends(get_service(TicketService)),
    _: User = Depends(get_admin_user),
):
    """Update ticket."""

    try:
        ticket = await ticket_service.update_ticket(ticket_id, ticket_update)
        return ticket
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Database error updating ticket: {str(e)}"
        )


@router.delete("/{ticket_id}")
async def delete_ticket(
    ticket_id: str,
    ticket_service: TicketService = Depends(get_service(TicketService)),
    _: User = Depends(get_admin_user),
):
    """Delete ticket."""

    try:
        await ticket_service.delete_ticket(ticket_id)
        return {"ticket_id": ticket_id, "deleted": True}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Database error deleting ticket: {str(e)}"
        )
