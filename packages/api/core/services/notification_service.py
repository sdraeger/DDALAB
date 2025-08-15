"""Notification service for managing system notifications."""

import asyncio
import psutil
import docker
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from loguru import logger

# from ..models import User  # Not needed for notification service
from ..service_registry import register_service
from .base import BaseService


@register_service
class NotificationService(BaseService):
    """Service for managing system notifications."""

    def __init__(
        self, db: AsyncSession = None, session_maker: async_sessionmaker = None
    ):
        if db is not None:
            # Regular service usage with dependency injection
            super().__init__(db)
            self.session_maker = None
        else:
            # Background service usage with session maker
            self.db = None
            self.session_maker = session_maker

        self.notifications: List[Dict[str, Any]] = []
        self._monitoring_task = None
        self._last_docker_check = None
        self._docker_check_interval = 3600  # Check every hour

    async def start_monitoring(self):
        """Start background monitoring tasks."""
        if self._monitoring_task is None or self._monitoring_task.done():
            self._monitoring_task = asyncio.create_task(self._monitoring_loop())
            logger.info("Notification monitoring started")

    async def stop_monitoring(self):
        """Stop background monitoring tasks."""
        if self._monitoring_task and not self._monitoring_task.done():
            self._monitoring_task.cancel()
            logger.info("Notification monitoring stopped")

    async def _monitoring_loop(self):
        """Main monitoring loop."""
        while True:
            try:
                await self._check_system_health()
                await self._check_docker_updates()
                await self._check_server_insights()
                await asyncio.sleep(60)  # Check every minute
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                await asyncio.sleep(60)

    async def _check_system_health(self):
        """Check system health metrics."""
        try:
            # Memory usage
            memory = psutil.virtual_memory()
            memory_percent = memory.percent

            if memory_percent > 85:
                await self._create_notification(
                    title="High Memory Usage",
                    message=f"System memory usage is at {memory_percent:.1f}%. Consider closing unused applications or restarting services.",
                    type="warning",
                    category="system",
                    metadata={"memory_percent": memory_percent},
                )

            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=1)
            if cpu_percent > 90:
                await self._create_notification(
                    title="High CPU Usage",
                    message=f"CPU usage is at {cpu_percent:.1f}%. System performance may be degraded.",
                    type="warning",
                    category="system",
                    metadata={"cpu_percent": cpu_percent},
                )

            # Disk usage
            disk = psutil.disk_usage("/")
            disk_percent = (disk.used / disk.total) * 100
            if disk_percent > 85:
                await self._create_notification(
                    title="Low Disk Space",
                    message=f"Disk usage is at {disk_percent:.1f}%. Consider cleaning up files.",
                    type="warning",
                    category="system",
                    metadata={"disk_percent": disk_percent},
                )

        except Exception as e:
            logger.error(f"Error checking system health: {e}")

    async def _check_docker_updates(self):
        """Check for Docker image updates."""
        try:
            now = datetime.now(timezone.utc)

            # Only check once per hour
            if self._last_docker_check and now - self._last_docker_check < timedelta(
                seconds=self._docker_check_interval
            ):
                return

            self._last_docker_check = now

            # Get current image info
            client = docker.from_env()
            try:
                current_image = client.images.get("ddalab-monolith:latest")
                current_id = current_image.id
            except docker.errors.ImageNotFound:
                logger.warning("ddalab-monolith image not found locally")
                return

            # Check Docker Hub for updates
            response = requests.get(
                "https://registry.hub.docker.com/v2/repositories/ddalab/ddalab-monolith/tags/latest",
                timeout=10,
            )

            if response.status_code == 200:
                registry_data = response.json()
                registry_digest = registry_data.get("digest")

                # Compare with local image
                if registry_digest and current_image.attrs.get("RepoDigests"):
                    local_digest = current_image.attrs["RepoDigests"][0].split("@")[1]

                    if registry_digest != local_digest:
                        await self._create_notification(
                            title="Docker Image Update Available",
                            message="A new version of ddalab-monolith is available on Docker Hub. Consider updating your deployment.",
                            type="info",
                            category="system",
                            action_text="View Updates",
                            action_url="/settings",
                            metadata={
                                "current_digest": local_digest,
                                "new_digest": registry_digest,
                                "image": "ddalab-monolith:latest",
                            },
                        )

        except requests.RequestException as e:
            logger.warning(f"Could not check Docker Hub: {e}")
        except docker.errors.DockerException as e:
            logger.warning(f"Docker error: {e}")
        except Exception as e:
            logger.error(f"Error checking Docker updates: {e}")

    async def _check_server_insights(self):
        """Generate server insights and recommendations."""
        try:
            # System uptime
            boot_time = datetime.fromtimestamp(psutil.boot_time(), tz=timezone.utc)
            uptime = datetime.now(timezone.utc) - boot_time

            # Notify if system has been running for more than 30 days
            if uptime.days > 30:
                await self._create_notification(
                    title="System Uptime Notice",
                    message=f"System has been running for {uptime.days} days. Consider scheduled maintenance.",
                    type="info",
                    category="system",
                    metadata={"uptime_days": uptime.days},
                )

            # Check running processes
            process_count = len(psutil.pids())
            if process_count > 500:
                await self._create_notification(
                    title="High Process Count",
                    message=f"System is running {process_count} processes. Monitor for resource leaks.",
                    type="info",
                    category="system",
                    metadata={"process_count": process_count},
                )

            # Network connections (optional - requires elevated privileges on some systems)
            try:
                connections = psutil.net_connections()
                established_count = len(
                    [c for c in connections if c.status == "ESTABLISHED"]
                )

                if established_count > 100:
                    await self._create_notification(
                        title="High Network Activity",
                        message=f"{established_count} active network connections detected.",
                        type="info",
                        category="system",
                        metadata={"connection_count": established_count},
                    )
            except (psutil.AccessDenied, PermissionError) as e:
                logger.debug(
                    f"Cannot access network connections (insufficient privileges): {e}"
                )
            except Exception as e:
                logger.warning(f"Error checking network connections: {e}")

        except Exception as e:
            import traceback

            logger.error(f"Error generating server insights: {e}")
            logger.debug(f"Traceback: {traceback.format_exc()}")

    async def _create_notification(
        self,
        title: str,
        message: str,
        type: str = "info",
        category: str = "system",
        action_text: Optional[str] = None,
        action_url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Create a new notification."""

        # Check for duplicate notifications (same title within last hour)
        now = datetime.now(timezone.utc)
        recent_notifications = [
            n
            for n in self.notifications
            if (
                n["title"] == title
                and datetime.fromisoformat(n["timestamp"].replace("Z", "+00:00"))
                > now - timedelta(hours=1)
            )
        ]

        if recent_notifications:
            logger.debug(f"Skipping duplicate notification: {title}")
            return

        notification = {
            "id": str(uuid4()),
            "title": title,
            "message": message,
            "type": type,
            "category": category,
            "timestamp": now.isoformat(),
            "read": False,
            "action_text": action_text,
            "action_url": action_url,
            "metadata": metadata or {},
        }

        self.notifications.append(notification)

        # Keep only last 100 notifications
        if len(self.notifications) > 100:
            self.notifications = self.notifications[-100:]

        logger.info(f"Created notification: {title}")

    async def get_notifications(
        self, user_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Get all notifications."""
        # Sort by timestamp (newest first)
        return sorted(self.notifications, key=lambda x: x["timestamp"], reverse=True)

    async def mark_as_read(self, notification_id: str) -> bool:
        """Mark a notification as read."""
        for notification in self.notifications:
            if notification["id"] == notification_id:
                notification["read"] = True
                return True
        return False

    async def mark_all_as_read(self) -> int:
        """Mark all notifications as read."""
        count = 0
        for notification in self.notifications:
            if not notification["read"]:
                notification["read"] = True
                count += 1
        return count

    async def delete_notification(self, notification_id: str) -> bool:
        """Delete a notification."""
        for i, notification in enumerate(self.notifications):
            if notification["id"] == notification_id:
                del self.notifications[i]
                return True
        return False

    async def get_unread_count(self) -> int:
        """Get count of unread notifications."""
        return len([n for n in self.notifications if not n["read"]])

    async def get_system_status(self) -> Dict[str, Any]:
        """Get current system status for status bar."""
        try:
            # Memory usage
            memory = psutil.virtual_memory()
            memory_percent = round(memory.percent, 1)
            
            # CPU usage
            cpu_percent = round(psutil.cpu_percent(interval=0.1), 1)
            
            # Disk usage
            disk = psutil.disk_usage('/')
            disk_percent = round((disk.used / disk.total) * 100, 1)
            
            # System uptime
            boot_time = psutil.boot_time()
            uptime_seconds = int(datetime.now().timestamp() - boot_time)
            
            # Database connection status (simplified)
            db_status = "active"  # Since we're using the service, DB is likely active
            
            # Network status (simplified)
            network_status = "connected"  # If we're responding, network is connected
            
            return {
                "cpu_percent": cpu_percent,
                "memory_percent": memory_percent,
                "disk_percent": disk_percent,
                "uptime_seconds": uptime_seconds,
                "db_status": db_status,
                "network_status": network_status,
                "status": "online",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        except Exception as e:
            logger.error(f"Error getting system status: {e}")
            return {
                "cpu_percent": 0,
                "memory_percent": 0,
                "disk_percent": 0,
                "uptime_seconds": 0,
                "db_status": "unknown",
                "network_status": "unknown",
                "status": "error",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        return True

    @classmethod
    def from_db(cls, db: AsyncSession) -> "NotificationService":
        return cls(db=db)
