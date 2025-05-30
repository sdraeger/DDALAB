from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from ..core.auth import get_current_user
from ..core.database import UserPreferences as UserPreferencesDB
from ..core.dependencies import get_service
from ..core.services import UserPreferencesService
from ..schemas.user import User
from ..schemas.user_preferences import UserPreferences

# Create router with explicit prefix
router = APIRouter()


@router.get("", response_model=UserPreferences)
async def get_user_preferences(
    prefs_service: UserPreferencesService = Depends(
        get_service(UserPreferencesService)
    ),
    current_user: User = Depends(get_current_user),
):
    """Get user preferences."""

    try:
        # Get user preferences from database
        preferences = await prefs_service.get_preferences(current_user.id)
        logger.info(f"preferences: {preferences}")

        # If no preferences exist, create with defaults
        if not preferences:
            preferences = UserPreferencesDB(user_id=current_user.id)
            await prefs_service.update_preferences(current_user.id, preferences)

        return UserPreferences(
            theme=preferences.theme,
            eeg_zoom_factor=preferences.eeg_zoom_factor,
        )
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.put("", response_model=UserPreferences)
async def update_user_preferences(
    preferences: dict,
    prefs_service: UserPreferencesService = Depends(
        get_service(UserPreferencesService)
    ),
    current_user: User = Depends(get_current_user),
):
    """Update user preferences using repository pattern"""
    try:
        logger.debug(f"Updating preferences for user: {current_user.id}")

        updated_prefs = await prefs_service.update_preferences(
            current_user.id, preferences
        )

        return UserPreferences(
            theme=updated_prefs.theme,
            eeg_zoom_factor=updated_prefs.eeg_zoom_factor,
        )
    except Exception as e:
        logger.error(f"Error updating preferences: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating preferences: {str(e)}"
        )


@router.delete("", response_model=UserPreferences)
async def reset_user_preferences(
    prefs_service: UserPreferencesService = Depends(
        get_service(UserPreferencesService)
    ),
    current_user: User = Depends(get_current_user),
):
    """Reset user preferences to defaults using repository pattern"""
    try:
        logger.debug(f"Resetting preferences for user: {current_user.id}")

        reset_prefs = await prefs_service.reset_to_defaults(current_user.id)

        if reset_prefs:
            return UserPreferences(
                theme=reset_prefs.theme,
                eeg_zoom_factor=reset_prefs.eeg_zoom_factor,
            )
        return UserPreferences()  # Return defaults if no prefs existed
    except Exception as e:
        logger.error(f"Error resetting preferences: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error resetting preferences: {str(e)}"
        )
