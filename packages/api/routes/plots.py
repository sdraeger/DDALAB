"""Routes for generating plots."""

from typing import List

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services import PlotService
from fastapi import APIRouter, Depends
from schemas.plots import PlotResponse

router = APIRouter()


@router.get("", response_model=List[PlotResponse])
async def list_plots(
    current_user: User = Depends(get_current_user),
    plot_service: PlotService = Depends(get_service(PlotService)),
):
    """
    Get plots for artifacts owned or shared with the current user.
    """
    plots = await plot_service.get_user_plots(current_user.id)
    return plots
