"""Service registry for dependency injection."""

from typing import Callable, Dict, Type, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

# Define a base type for services without importing BaseService
T = TypeVar("T")

# Global registry
_services: Dict[Type, Type] = {}


def register_service(service_class: Type[T]) -> Type[T]:
    """Register a service class for dependency injection.

    Args:
        service_class: The service class to register

    Returns:
        The registered service class
    """
    _services[service_class] = service_class
    return service_class


def get_service_factory(service_class: Type[T]) -> Callable[[AsyncSession], T]:
    """Get a service instance factory for dependency injection.

    Args:
        service_class: The service class to get an instance of

    Returns:
        A callable that creates a service instance
    """
    if service_class not in _services:
        raise ValueError(f"Service {service_class.__name__} not registered")

    def create_service(db: AsyncSession) -> T:
        return service_class.from_db(db)

    return create_service


def get_all_services() -> Dict[str, Type]:
    """Get all registered services.

    Returns:
        A dictionary of service name to service class
    """
    return {service.__name__: service for service in _services.values()}
