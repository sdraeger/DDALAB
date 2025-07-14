from typing import Optional


class ServiceError(Exception):
    """Base class for service errors."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class NotFoundError(ServiceError):
    """Raised when a resource is not found."""

    def __init__(self, resource: str, resource_id: Optional[str | int] = None):
        message = f"{resource} not found"
        if resource_id is not None:
            message += f": {resource_id}"
        super().__init__(message, status_code=404)


class ValidationError(ServiceError):
    """Raised when input validation fails."""

    def __init__(self, message: str):
        super().__init__(message, status_code=400)


class AuthorizationError(ServiceError):
    """Raised when a user is not authorized to perform an action."""

    def __init__(self, message: str = "Not authorized"):
        super().__init__(message, status_code=403)


class ConflictError(ServiceError):
    """Raised when there is a conflict with existing data."""

    def __init__(self, message: str):
        super().__init__(message, status_code=409)


class DatabaseError(ServiceError):
    """Raised when there is a database error."""

    def __init__(self, message: str = "Database error"):
        super().__init__(message, status_code=500)
