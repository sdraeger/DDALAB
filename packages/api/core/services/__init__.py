"""Service layer initialization."""

# First import base classes and utilities
from .annotation_service import AnnotationService
from .artifact_service import ArtifactService
from .base import BaseService, CRUDService
from .dda_service import DDAService
from .edf_config_service import EdfConfigService
from .errors import (
    AuthorizationError,
    DatabaseError,
    NotFoundError,
    ServiceError,
    ValidationError,
)
from .favorite_files_service import FavoriteFilesService
from .file_service import FileService
from .layout_service import LayoutService
from .local_user_service import LocalUserService
from .plot_cache_service import PlotCacheService
from .plot_service import PlotService
from .redis_service import RedisService
from .stats_service import StatsService
from .ticket_service import TicketService
from .user_preferences_service import UserPreferencesService

# Then import concrete service implementations
from .user_service import UserService
from .widget_layout_service import WidgetLayoutService

__all__ = [
    # Base classes
    "BaseService",
    "CRUDService",
    # Error classes
    "ServiceError",
    "NotFoundError",
    "ValidationError",
    "AuthorizationError",
    "DatabaseError",
    # Service implementations
    "UserService",
    "LocalUserService",
    "ArtifactService",
    "DDAService",
    "EdfConfigService",
    "FavoriteFilesService",
    "FileService",
    "LayoutService",
    "PlotCacheService",
    "PlotService",
    "RedisService",
    "StatsService",
    "TicketService",
    "UserPreferencesService",
    "WidgetLayoutService",
    "AnnotationService",
]
