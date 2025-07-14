"""Check MinIO bucket configuration."""

from core.config import get_server_settings
from minio import Minio


def check_bucket():
    """Check MinIO bucket configuration."""
    settings = get_server_settings()

    # Initialize MinIO client directly with localhost
    minio_client = Minio(
        "localhost:9000",
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )

    print("\nChecking MinIO configuration\n")
    print("MinIO host: localhost:9000")
    print(f"MinIO bucket: {settings.minio_bucket_name}")

    try:
        # Check if bucket exists
        exists = minio_client.bucket_exists(settings.minio_bucket_name)
        print(f"\nBucket exists: {exists}")

        if not exists:
            print("\nCreating bucket...")
            minio_client.make_bucket(settings.minio_bucket_name)
            print("Bucket created successfully")

        # List all buckets
        buckets = minio_client.list_buckets()
        print("\nAll buckets:")
        for bucket in buckets:
            print(f"- {bucket.name} (created: {bucket.creation_date})")

    except Exception as e:
        print(f"\nError checking bucket: {str(e)}")


if __name__ == "__main__":
    check_bucket()
