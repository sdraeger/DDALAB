import json
import os
from datetime import timedelta
from io import BytesIO

from fastapi import APIRouter, HTTPException
from minio import Minio
from minio.error import S3Error

from ..core.config import get_server_settings
from ..schemas.results import SnapshotData

router = APIRouter()
settings = get_server_settings()

minio_client = Minio(
    settings.minio_host,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=False,
)


async def get_snapshot_data(snapshot_name: str):
    """
    Get all objects in a snapshot.
    """
    try:
        # Check if the snapshot exists
        minio_client.stat_object(settings.minio_bucket_name, snapshot_name)

        # Get all objects in the snapshot
        objects = minio_client.list_objects(
            settings.minio_bucket_name, prefix=snapshot_name, recursive=True
        )

        return {"objects": objects}
    except S3Error as e:
        raise HTTPException(status_code=404, detail=f"Snapshot not found: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


# Endpoint to upload analysis results
@router.post("/share-results")
async def upload_results(snapshot_data: SnapshotData):
    try:
        uploaded_blobs = []
        prefix = f"{snapshot_data.name}/{os.urandom(8).hex()}"

        # Upload blobs
        for descr, blob in snapshot_data.data.items():
            object_name = f"{prefix}/blobs/{descr}"
            minio_client.put_object(
                settings.minio_bucket_name,
                object_name,
                BytesIO(blob),
                length=len(blob),
                content_type="application/octet-stream",
            )
            presigned_url = minio_client.presigned_get_object(
                settings.minio_bucket_name, object_name, expires=timedelta(days=7)
            )
            uploaded_blobs.append(
                {
                    "object_name": object_name,
                    "shareable_link": presigned_url,
                    "original_blobname": descr,
                }
            )

        # Upload description (if present)
        if snapshot_data.description:
            minio_client.put_object(
                settings.minio_bucket_name,
                f"{prefix}/description.txt",
                BytesIO(snapshot_data.description.encode("utf-8")),
                length=len(snapshot_data.description),
                content_type="text/plain",
            )

        # Upload metadata (if present)
        if snapshot_data.metadata:
            metadata_json = json.dumps(snapshot_data.metadata).encode("utf-8")
            minio_client.put_object(
                settings.minio_bucket_name,
                f"{prefix}/metadata.json",
                BytesIO(metadata_json),
                length=len(metadata_json),
                content_type="application/json",
            )

        response = {
            "message": "Snapshot uploaded successfully",
            "uploaded_blobs": uploaded_blobs,
            "description": snapshot_data.description,
            "metadata": snapshot_data.metadata,
        }
        return response
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"MinIO error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")


# Endpoint to get a shareable link by object name
@router.get("/{snapshot_name}")
async def get_result_link(snapshot_name: str):
    """
    Get a shareable link for a snapshot
    """
    try:
        # Check if the object exists
        minio_client.stat_object(settings.minio_bucket_name, snapshot_name)

        # Generate a presigned URL
        presigned_url = minio_client.presigned_get_object(
            settings.minio_bucket_name, snapshot_name, expires=timedelta(days=7)
        )

        return {"shareable_link": presigned_url}
    except S3Error as e:
        raise HTTPException(status_code=404, detail=f"Result not found: {str(e)}")


@router.get("/{snapshot_name}")
async def get_snapshot(snapshot_name: str):
    """
    Get all objects in a snapshot
    """
    return await get_snapshot_data(snapshot_name)
