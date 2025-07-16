"""Service for managing file operations."""

from pathlib import Path
from typing import List

from core.config import get_data_settings
from core.service_registry import register_service
from core.services.base import BaseService
from core.services.errors import NotFoundError, ServiceError, ValidationError
from core.utils import is_path_allowed
from loguru import logger
from schemas.files import FileInfo
from sqlalchemy.ext.asyncio import AsyncSession

settings = get_data_settings()


@register_service
class FileService(BaseService):
    """Service for managing file operations."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "FileService":
        return cls(db)

    async def list_directory(self, path: str = "") -> List[FileInfo]:
        """List files and directories in a specific path.

        Args:
            path: Path to the directory to list

        Returns:
            List of FileInfo objects containing file/directory information

        Raises:
            ServiceError: If there is an error listing the directory
            ValidationError: If the path is not allowed
            NotFoundError: If the directory does not exist
        """
        logger.info(f"[FileService] list_directory called with path: '{path}'")

        try:
            # Validate that the requested path is allowed
            target_dir = is_path_allowed(path)

            if not target_dir.is_dir():
                logger.warning(f"Requested path is not a directory: {path}")
                raise NotFoundError("Directory", path)

            logger.info(f"Listing directory: {target_dir}")

            items = []
            for item in target_dir.iterdir():
                file_stat = item.stat()
                last_modified = file_stat.st_mtime
                file_size = file_stat.st_size if item.is_file() else None

                file_info = FileInfo(
                    name=item.name,
                    path=str(item),
                    is_directory=item.is_dir(),
                    size=file_size,
                    is_favorite=False,  # This will be set by the route handler
                    last_modified=str(last_modified),
                )
                items.append(file_info)

            return sorted(items, key=lambda x: (not x.is_directory, x.name.lower()))
        except NotFoundError:
            raise
        except ValidationError:
            raise
        except Exception as e:
            logger.error(f"Error listing directory '{path}': {e}")
            raise ServiceError(f"Failed to list directory: {str(e)}")

    async def validate_file_path(self, file_path: str | Path) -> str:
        """Validate that the file path is within the allowed directories.

        Args:
            file_path: Path to the file or directory

        Returns:
            Validated file path

        Raises:
            ValidationError: If the path is not allowed
            NotFoundError: If the path does not exist
            ServiceError: If there is an error validating the path
        """
        try:
            resolved_path = is_path_allowed(file_path)
            if not resolved_path.exists():
                raise NotFoundError("Path", file_path)

            return str(resolved_path)
        except NotFoundError:
            raise
        except ValidationError:
            raise
        except Exception as e:
            logger.error(f"Error validating path '{file_path}': {e}")
            raise ServiceError(f"Could not validate path: {str(e)}")

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            # Try listing the data directory
            await self.list_directory(settings.data_dir)
            return True
        except Exception:
            return False
