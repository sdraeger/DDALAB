"""List all objects in MinIO bucket."""

from core.config import get_server_settings
from minio import Minio


def list_all_objects():
    """List all objects in MinIO bucket."""
    settings = get_server_settings()

    # Initialize MinIO client directly with localhost
    minio_client = Minio(
        "localhost:9000",  # Use localhost instead of minio service name
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )

    print(f"\nListing objects in bucket: {settings.minio_bucket_name}\n")

    try:
        # Get all objects in the bucket
        objects = minio_client.list_objects(settings.minio_bucket_name, recursive=True)
        found_objects = False

        for obj in objects:
            found_objects = True
            print(f"Object: {obj.object_name}")
            print(f"Size: {obj.size} bytes")
            print(f"Last modified: {obj.last_modified}")
            print("-" * 80)

        if not found_objects:
            print("No objects found in bucket")

    except Exception as e:
        print(f"Error listing objects: {str(e)}")
        print("MinIO host: localhost:9000")
        print(f"MinIO bucket: {settings.minio_bucket_name}")


if __name__ == "__main__":
    list_all_objects()
