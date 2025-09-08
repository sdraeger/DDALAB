"""MinIO storage service for object storage operations."""

from typing import BinaryIO, Optional, List
from minio import Minio
from minio.error import S3Error
from loguru import logger


class MinioService:
    """Service for interacting with MinIO object storage."""
    
    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket_name: str,
        secure: bool = False
    ):
        """Initialize MinIO service.
        
        Args:
            endpoint: MinIO server endpoint
            access_key: Access key for authentication
            secret_key: Secret key for authentication
            bucket_name: Default bucket name
            secure: Whether to use HTTPS
        """
        self.endpoint = endpoint
        self.bucket_name = bucket_name
        self.client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure
        )
        
    def ensure_bucket_exists(self) -> None:
        """Ensure the default bucket exists."""
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
                logger.info(f"Created MinIO bucket: {self.bucket_name}")
            else:
                logger.debug(f"MinIO bucket already exists: {self.bucket_name}")
        except S3Error as e:
            logger.error(f"Failed to ensure bucket exists: {e}")
            raise
            
    def upload_file(
        self,
        object_name: str,
        data: BinaryIO,
        length: int,
        content_type: Optional[str] = "application/octet-stream"
    ) -> str:
        """Upload a file to MinIO.
        
        Args:
            object_name: Name of the object in the bucket
            data: File data to upload
            length: Length of the data
            content_type: MIME type of the content
            
        Returns:
            The object path
        """
        try:
            self.client.put_object(
                self.bucket_name,
                object_name,
                data,
                length,
                content_type=content_type
            )
            logger.info(f"Uploaded object: {object_name}")
            return f"{self.bucket_name}/{object_name}"
        except S3Error as e:
            logger.error(f"Failed to upload object: {e}")
            raise
            
    def download_file(self, object_name: str) -> bytes:
        """Download a file from MinIO.
        
        Args:
            object_name: Name of the object to download
            
        Returns:
            File content as bytes
        """
        try:
            response = self.client.get_object(self.bucket_name, object_name)
            data = response.read()
            response.close()
            response.release_conn()
            return data
        except S3Error as e:
            logger.error(f"Failed to download object: {e}")
            raise
            
    def delete_file(self, object_name: str) -> None:
        """Delete a file from MinIO.
        
        Args:
            object_name: Name of the object to delete
        """
        try:
            self.client.remove_object(self.bucket_name, object_name)
            logger.info(f"Deleted object: {object_name}")
        except S3Error as e:
            logger.error(f"Failed to delete object: {e}")
            raise
            
    def list_objects(self, prefix: Optional[str] = None) -> List[str]:
        """List objects in the bucket.
        
        Args:
            prefix: Prefix to filter objects
            
        Returns:
            List of object names
        """
        try:
            objects = self.client.list_objects(
                self.bucket_name,
                prefix=prefix,
                recursive=True
            )
            return [obj.object_name for obj in objects]
        except S3Error as e:
            logger.error(f"Failed to list objects: {e}")
            raise
            
    def get_presigned_url(
        self,
        object_name: str,
        expires_in: int = 3600
    ) -> str:
        """Get a presigned URL for downloading an object.
        
        Args:
            object_name: Name of the object
            expires_in: URL expiration time in seconds
            
        Returns:
            Presigned URL
        """
        try:
            return self.client.presigned_get_object(
                self.bucket_name,
                object_name,
                expires=expires_in
            )
        except S3Error as e:
            logger.error(f"Failed to generate presigned URL: {e}")
            raise