from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from server.core.auth import get_current_user
from server.core.database import User, get_db
from server.core.database import UserPreferences as UserPreferencesModel
from server.core.utils.utils import camel_to_snake
from server.schemas.user_preferences import UserPreferences

# Create router with explicit prefix
router = APIRouter(prefix="")


@router.get("")
async def get_user_preferences(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get user preferences."""

    logger.info(f"request: {request}")
    logger.info(f"current_user: {current_user}")

    async with db.begin():
        try:
            # Get user preferences from database
            stmt = select(UserPreferencesModel).where(
                UserPreferencesModel.user_id == current_user.id
            )
            logger.info("before execute")
            logger.info(f"stmt: {stmt}")
            result = await db.execute(stmt)
            logger.info("after execute")
            preferences = result.scalar_one_or_none()
            logger.info(f"preferences: {preferences}")

            # If no preferences exist, create with defaults
            if not preferences:
                preferences = UserPreferencesModel(user_id=current_user.id)
                db.add(preferences)
                db.commit()
                db.refresh(preferences)

            # Convert to Pydantic model
            return UserPreferences(
                theme=preferences.theme,
                session_expiration=preferences.session_expiration,
                eeg_zoom_factor=preferences.eeg_zoom_factor,
            )
        except Exception as e:
            logger.error(f"Error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.put("")
async def update_user_preferences(
    preferences: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update user preferences."""

    logger.debug(f"model_dump(): {preferences}")
    # logger.debug(
    #     f"model_dump(exclude_unset=True): {preferences.model_dump(exclude_unset=True)}"
    # )

    async with db.begin():
        try:
            logger.debug(f"current_user: {current_user}")

            # Get existing preferences or create new
            stmt = select(UserPreferencesModel).where(
                UserPreferencesModel.user_id == current_user.id
            )
            logger.debug("before execute")
            result = await db.execute(stmt)
            logger.debug("after execute")
            db_preferences = result.scalar_one_or_none()
            logger.debug(f"db_preferences: {db_preferences}")

            if not db_preferences:
                db_preferences = UserPreferencesModel(user_id=current_user.id)
                db.add(db_preferences)

            # Update only provided fields
            for key, value in preferences.items():
                logger.debug(f"key: {key}, value: {value}")
                setattr(db_preferences, camel_to_snake(key), value)

            logger.debug(
                f"db_preferences: {db_preferences.eeg_zoom_factor}, {db_preferences.session_expiration}, {db_preferences.theme}, {db_preferences.user_id}"
            )
            logger.debug("before commit")
            await db.commit()
            # logger.debug("after commit")

            # await db.refresh(db_preferences)
            logger.debug("after refresh")

            # Return updated preferences
            return UserPreferences(
                theme=db_preferences.theme,
                session_expiration=db_preferences.session_expiration,
                eeg_zoom_factor=db_preferences.eeg_zoom_factor,
            )
        except SQLAlchemyError as e:
            await db.rollback()
            logger.error(f"Database error updating preferences: {str(e)}")
            raise HTTPException(
                status_code=500, detail=f"Database error updating preferences: {str(e)}"
            )


@router.delete("")
async def reset_user_preferences(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Reset user preferences to defaults."""

    async with db.begin():
        try:
            # Get current user
            current_user = await get_current_user(request)

            # Get existing preferences
            db_preferences = (
                db.query(UserPreferencesModel)
                .filter(UserPreferencesModel.user_id == current_user.id)
                .first()
            )

            if db_preferences:
                # Create new preferences with defaults
                new_preferences = UserPreferences()

                # Update all fields to defaults
                for key, value in new_preferences.dict().items():
                    setattr(db_preferences, key, value)

                db.commit()
                db.refresh(db_preferences)

                return UserPreferences(
                    theme=db_preferences.theme,
                    session_expiration=db_preferences.session_expiration,
                    eeg_zoom_factor=db_preferences.eeg_zoom_factor,
                )
            else:
                # If no preferences exist, return defaults
                return UserPreferences()
        except SQLAlchemyError as e:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail=f"Database error resetting preferences: {str(e)}",
            )
