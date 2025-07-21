"""Routes for plot caching operations."""

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services import PlotCacheService
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from schemas.plot_cache import (
    CachePlotRequest,
    CachePlotResponse,
    CleanupResponse,
    DeleteCachedPlotRequest,
    DeleteCachedPlotResponse,
    DeleteFilePlotsRequest,
    DeleteFilePlotsResponse,
    DeleteUserPlotsResponse,
    GetCachedPlotRequest,
    GetCachedPlotResponse,
    UserCachedPlotsResponse,
)

router = APIRouter()


@router.post("/cache", response_model=CachePlotResponse)
async def cache_plot(
    request: CachePlotRequest,
    current_user: User = Depends(get_current_user),
    plot_cache_service: PlotCacheService = Depends(get_service(PlotCacheService)),
):
    """
    Cache a plot for the current user.
    """
    logger.info(
        f"[PlotCacheAPI] POST /cache - User: {current_user.id}, File: {request.file_path}"
    )
    logger.debug(
        f"[PlotCacheAPI] Request details - TTL: {request.ttl}, Plot params: {request.plot_params}"
    )

    try:
        # Convert plot params to dict for caching
        plot_params = request.plot_params.model_dump()
        logger.debug(f"[PlotCacheAPI] Converted plot params: {plot_params}")

        success = await plot_cache_service.cache_plot(
            user_id=current_user.id,
            file_path=request.file_path,
            plot_params=plot_params,
            plot_data=request.plot_data,
            ttl=request.ttl,
        )

        if success:
            logger.info(
                f"[PlotCacheAPI] Successfully cached plot for user {current_user.id}"
            )
            return CachePlotResponse(
                success=True,
                message="Plot cached successfully",
                cache_key=f"plot_cache:user:{current_user.id}:file:{request.file_path}",
            )
        else:
            logger.error(
                f"[PlotCacheAPI] Failed to cache plot for user {current_user.id}"
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to cache plot",
            )

    except Exception as e:
        logger.error(
            f"[PlotCacheAPI] Error caching plot for user {current_user.id}: {e}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error caching plot: {str(e)}",
        )


@router.post("/get", response_model=GetCachedPlotResponse)
async def get_cached_plot(
    request: GetCachedPlotRequest,
    current_user: User = Depends(get_current_user),
    plot_cache_service: PlotCacheService = Depends(get_service(PlotCacheService)),
):
    """
    Retrieve a cached plot for the current user.
    """
    logger.info(
        f"[PlotCacheAPI] POST /get - User: {current_user.id}, File: {request.file_path}"
    )
    logger.debug(f"[PlotCacheAPI] Request plot params: {request.plot_params}")

    try:
        # Convert plot params to dict for retrieval
        plot_params = request.plot_params.model_dump()
        logger.debug(f"[PlotCacheAPI] Converted plot params: {plot_params}")

        plot_data = await plot_cache_service.get_cached_plot(
            user_id=current_user.id,
            file_path=request.file_path,
            plot_params=plot_params,
        )

        if plot_data is not None:
            logger.info(
                f"[PlotCacheAPI] Successfully retrieved cached plot for user {current_user.id}"
            )
            logger.debug(
                f"[PlotCacheAPI] Retrieved plot data keys: {list(plot_data.keys()) if plot_data else 'None'}"
            )
            return GetCachedPlotResponse(
                success=True,
                message="Cached plot retrieved successfully",
                plot_data=plot_data,
                cached_at="now",  # We could store this in the plot data if needed
            )
        else:
            logger.info(
                f"[PlotCacheAPI] No cached plot found for user {current_user.id}"
            )
            return GetCachedPlotResponse(
                success=False,
                message="No cached plot found",
                plot_data=None,
                cached_at=None,
            )

    except Exception as e:
        logger.error(
            f"[PlotCacheAPI] Error retrieving cached plot for user {current_user.id}: {e}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving cached plot: {str(e)}",
        )


@router.get("/user", response_model=UserCachedPlotsResponse)
async def get_user_cached_plots(
    current_user: User = Depends(get_current_user),
    plot_cache_service: PlotCacheService = Depends(get_service(PlotCacheService)),
):
    """
    Get all cached plots for the current user.
    """
    logger.info(f"[PlotCacheAPI] GET /user - User: {current_user.id}")

    try:
        plots = await plot_cache_service.get_user_cached_plots(current_user.id)
        logger.info(
            f"[PlotCacheAPI] Retrieved {len(plots)} cached plots for user {current_user.id}"
        )

        for plot in plots:
            logger.debug(
                f"[PlotCacheAPI] User plot: {plot.get('file_path', 'unknown')} - {plot.get('cached_at', 'unknown')}"
            )

        return UserCachedPlotsResponse(
            success=True,
            message=f"Retrieved {len(plots)} cached plots",
            plots=plots,
            total_count=len(plots),
        )

    except Exception as e:
        logger.error(
            f"[PlotCacheAPI] Error retrieving cached plots for user {current_user.id}: {e}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving cached plots: {str(e)}",
        )


@router.delete("/delete", response_model=DeleteCachedPlotResponse)
async def delete_cached_plot(
    request: DeleteCachedPlotRequest,
    current_user: User = Depends(get_current_user),
    plot_cache_service: PlotCacheService = Depends(get_service(PlotCacheService)),
):
    """
    Delete a specific cached plot for the current user.
    """
    try:
        # Convert plot params to dict for deletion
        plot_params = request.plot_params.model_dump()

        success = await plot_cache_service.delete_cached_plot(
            user_id=current_user.id,
            file_path=request.file_path,
            plot_params=plot_params,
        )

        return DeleteCachedPlotResponse(
            success=True,
            message="Cached plot deleted successfully"
            if success
            else "No cached plot found to delete",
            deleted=success,
        )

    except Exception as e:
        logger.error(f"Error deleting cached plot for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting cached plot: {str(e)}",
        )


@router.delete("/delete-file", response_model=DeleteFilePlotsResponse)
async def delete_file_plots(
    request: DeleteFilePlotsRequest,
    current_user: User = Depends(get_current_user),
    plot_cache_service: PlotCacheService = Depends(get_service(PlotCacheService)),
):
    """
    Delete all cached plots for a specific file for the current user.
    """
    try:
        success = await plot_cache_service.delete_file_plots(
            user_id=current_user.id, file_path=request.file_path
        )

        return DeleteFilePlotsResponse(
            success=True,
            message="File plots deleted successfully",
            deleted_count=1 if success else 0,
        )

    except Exception as e:
        logger.error(f"Error deleting file plots for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting file plots: {str(e)}",
        )


@router.delete("/delete-user", response_model=DeleteUserPlotsResponse)
async def delete_user_plots(
    current_user: User = Depends(get_current_user),
    plot_cache_service: PlotCacheService = Depends(get_service(PlotCacheService)),
):
    """
    Delete all cached plots for the current user.
    """
    try:
        success = await plot_cache_service.delete_user_plots(current_user.id)

        return DeleteUserPlotsResponse(
            success=True,
            message="All user plots deleted successfully",
            deleted_count=1 if success else 0,
        )

    except Exception as e:
        logger.error(f"Error deleting user plots for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting user plots: {str(e)}",
        )


@router.post("/cleanup", response_model=CleanupResponse)
async def cleanup_expired_plots(
    current_user: User = Depends(get_current_user),
    plot_cache_service: PlotCacheService = Depends(get_service(PlotCacheService)),
):
    """
    Clean up expired plots for all users (admin operation).
    """
    try:
        # TODO: Add admin check here if needed
        cleaned_count = await plot_cache_service.cleanup_expired_plots()

        return CleanupResponse(
            success=True,
            message=f"Cleaned up {cleaned_count} expired plots",
            cleaned_count=cleaned_count,
        )

    except Exception as e:
        logger.error(f"Error cleaning up expired plots: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error cleaning up expired plots: {str(e)}",
        )
