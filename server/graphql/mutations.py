"""GraphQL mutation resolvers."""

from datetime import datetime, timezone
from typing import Optional

import strawberry
from sqlalchemy import select

from ..core.auth import get_current_user_from_request
from ..core.database import Annotation, FavoriteFile
from ..core.dda import run_dda as run_dda_core
from ..core.files import validate_file_path
from ..schemas.preprocessing import PreprocessingOptionsInput
from .context import Context
from .types import AnnotationInput, AnnotationType, DDAResult


@strawberry.type
class Mutation:
    """GraphQL mutation type."""

    @strawberry.mutation
    async def run_dda(
        self,
        file_path: str,
        channel_list: list[int],
        preprocessing_options: Optional[PreprocessingOptionsInput] = None,
    ) -> DDAResult:
        """Run DDA synchronously.

        Args:
            file_path: Path to the file
            channel_list: List of channels to analyze
            preprocessing_options: Optional[PreprocessingOptionsInput] = None

        Returns:
            Complete DDA results
        """
        result = await run_dda_core(
            file_path=file_path,
            channel_list=channel_list,
            preprocessing_options=(
                strawberry.asdict(preprocessing_options)
                if preprocessing_options
                else None
            ),
        )
        return DDAResult(
            file_path=file_path,
            Q=result["Q"],
            metadata=result.get("metadata"),
        )

    @strawberry.mutation
    async def create_annotation(
        self,
        annotation_input: AnnotationInput,
        info: strawberry.Info[Context, None],
    ) -> AnnotationType:
        """Create a new annotation."""
        current_user = await get_current_user_from_request(info.context.request)
        if not current_user:
            raise Exception("Not authenticated")

        await validate_file_path(annotation_input.file_path)
        now = datetime.now(timezone.utc)

        annotation = Annotation(
            user_id=current_user.id,
            file_path=annotation_input.file_path,
            start_time=annotation_input.start_time,
            end_time=annotation_input.end_time,
            text=annotation_input.text,
            created_at=now,
            updated_at=now,
        )

        info.context.session.add(annotation)
        await info.context.session.commit()
        await info.context.session.refresh(annotation)

        return AnnotationType(
            id=annotation.id,
            user_id=annotation.user_id,
            file_path=annotation.file_path,
            start_time=annotation.start_time,
            end_time=annotation.end_time,
            text=annotation.text,
            created_at=annotation.created_at.isoformat(),
            updated_at=annotation.updated_at.isoformat(),
        )

    @strawberry.mutation
    async def update_annotation(
        self,
        id: int,
        annotation_input: AnnotationInput,
        info: strawberry.Info[Context, None],
    ) -> AnnotationType:
        """Update an existing annotation."""
        current_user = await get_current_user_from_request(
            info.context.request, info.context.session
        )
        if not current_user:
            raise Exception("Not authenticated")

        result = await info.context.session.execute(
            select(Annotation).where(
                Annotation.id == id,
                Annotation.user_id == current_user.id,
            )
        )
        annotation = result.scalar_one_or_none()
        if not annotation:
            raise Exception("Annotation not found")

        await validate_file_path(annotation_input.file_path)

        annotation.file_path = annotation_input.file_path
        annotation.start_time = annotation_input.start_time
        annotation.end_time = annotation_input.end_time
        annotation.text = annotation_input.text
        annotation.updated_at = datetime.now(timezone.utc)

        await info.context.session.commit()
        await info.context.session.refresh(annotation)

        return AnnotationType(
            id=annotation.id,
            user_id=annotation.user_id,
            file_path=annotation.file_path,
            start_time=annotation.start_time,
            end_time=annotation.end_time,
            text=annotation.text,
            created_at=annotation.created_at.isoformat(),
            updated_at=annotation.updated_at.isoformat(),
        )

    @strawberry.mutation
    async def delete_annotation(
        self,
        id: int,
        info: strawberry.Info[Context, None],
    ) -> bool:
        """Delete an annotation."""
        current_user = await get_current_user_from_request(
            info.context.request, info.context.session
        )
        if not current_user:
            raise Exception("Not authenticated")

        result = await info.context.session.execute(
            select(Annotation).where(
                Annotation.id == id,
                Annotation.user_id == current_user.id,
            )
        )
        annotation = result.scalar_one_or_none()
        if not annotation:
            raise Exception("Annotation not found")

        await info.context.session.delete(annotation)
        await info.context.session.commit()
        return True

    @strawberry.mutation
    async def toggle_favorite_file(
        self,
        file_path: str,
        info: strawberry.Info[Context, None],
    ) -> bool:
        """Toggle favorite status for a file."""
        current_user = await get_current_user_from_request(
            info.context.request, info.context.session
        )
        if not current_user:
            raise Exception("Not authenticated")

        await validate_file_path(file_path)

        result = await info.context.session.execute(
            select(FavoriteFile).where(
                FavoriteFile.user_id == current_user.id,
                FavoriteFile.file_path == file_path,
            )
        )
        favorite = result.scalar_one_or_none()

        if favorite:
            await info.context.session.delete(favorite)
            await info.context.session.commit()
            return False
        else:
            favorite = FavoriteFile(
                user_id=current_user.id,
                file_path=file_path,
                created_at=datetime.now(timezone.utc),
            )
            info.context.session.add(favorite)
            await info.context.session.commit()
            return True
