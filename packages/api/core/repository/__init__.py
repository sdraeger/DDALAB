from typing import Callable, Type, TypeVar

from fastapi import Request

from .annotation_repository import AnnotationRepository
from .base_repository import BaseRepository
from .edf_config_channel_repository import EdfConfigChannelRepository
from .edf_config_repository import EdfConfigRepository
from .favorite_files_repository import FavoriteFilesRepository
from .ticket_repository import TicketRepository
from .user_preferences_repository import UserPreferencesRepository
from .user_repository import UserRepository

__all__ = [
    "UserRepository",
    "BaseRepository",
    "AnnotationRepository",
    "EdfConfigChannelRepository",
    "EdfConfigRepository",
    "FavoriteFilesRepository",
    "TicketRepository",
    "UserPreferencesRepository",
]

T = TypeVar("T")


def get_repository(
    repo_type: Type[BaseRepository[T]],
) -> Callable[[Request], BaseRepository[T]]:
    def _get_repo(request: Request) -> BaseRepository[T]:
        return repo_type(request)

    return _get_repo
