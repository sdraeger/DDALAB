"""
Synchronization utilities for keeping database users and Directus users in sync.
"""

import logging
import os
from typing import Any, Optional, Type

import requests
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("directus_sync")

# Load environment variables
load_dotenv()

# Directus settings
DIRECTUS_URL = os.getenv("DIRECTUS_URL", "http://localhost:8055")
DIRECTUS_EMAIL = os.getenv("DIRECTUS_EMAIL", "admin@example.com")
DIRECTUS_PASSWORD = os.getenv("DIRECTUS_PASSWORD", "admin")
USER_COLLECTION = os.getenv("USER_COLLECTION", "users")


def get_directus_token():
    """Get authentication token from Directus"""
    try:
        logger.info(f"Authenticating with Directus at {DIRECTUS_URL}")
        response = requests.post(
            f"{DIRECTUS_URL}/auth/login",
            json={"email": DIRECTUS_EMAIL, "password": DIRECTUS_PASSWORD},
        )
        response.raise_for_status()
        token = response.json()["data"]["access_token"]
        logger.info("Authentication successful")
        return token
    except Exception as e:
        logger.error(f"Authentication failed: {e}")
        return None


def get_directus_users(token):
    """Get all users from Directus"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{DIRECTUS_URL}/items/{USER_COLLECTION}", headers=headers
        )
        response.raise_for_status()
        return response.json()["data"]
    except Exception as e:
        logger.error(f"Failed to get users from Directus: {e}")
        return None


def create_directus_user(token, user):
    """Create a user in Directus"""
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        # Log the user object to debug
        logger.info(f"Creating user in Directus: {user.username}")

        # Get the appropriate password hash attribute
        password_hash = getattr(
            user, "hashed_password", getattr(user, "password_hash", "")
        )

        # Map fields to match Directus expectations
        data = {
            "username": user.username,
            "email": f"{user.username}@example.com",  # Directus might require email
            "password": "TemporaryPassword123!",  # Temporary password
            "hashed_password": password_hash,  # Required by Directus schema
            "is_active": getattr(user, "is_active", True),
            "is_superuser": getattr(user, "is_admin", False)
            or getattr(user, "is_superuser", False),
            "role": "3"
            if getattr(user, "is_admin", False) or getattr(user, "is_superuser", False)
            else "2",
            "status": "active" if getattr(user, "is_active", True) else "inactive",
        }

        # Debug the payload
        logger.info(f"Sending data to Directus: {data}")

        response = requests.post(
            f"{DIRECTUS_URL}/items/{USER_COLLECTION}", headers=headers, json=data
        )

        # Debug any error responses
        if response.status_code >= 400:
            logger.error(f"Error response from Directus: {response.text}")

        response.raise_for_status()
        logger.info(f"Created user {user.username} in Directus")
        return response.json()["data"]
    except Exception as e:
        logger.error(f"Failed to create user in Directus: {e}")
        return None


def update_directus_user(token, directus_id, user):
    """Update a user in Directus"""
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        # Get the appropriate password hash attribute
        password_hash = getattr(
            user, "hashed_password", getattr(user, "password_hash", "")
        )

        # Map fields to match Directus expectations
        data = {
            "username": user.username,
            "hashed_password": password_hash,  # Required by Directus schema
            "is_active": getattr(user, "is_active", True),
            "is_superuser": getattr(user, "is_admin", False)
            or getattr(user, "is_superuser", False),
            "status": "active" if getattr(user, "is_active", True) else "inactive",
            "role": "3"
            if getattr(user, "is_admin", False) or getattr(user, "is_superuser", False)
            else "2",
        }

        # Debug the payload
        logger.info(f"Updating user in Directus with ID {directus_id}: {data}")

        response = requests.patch(
            f"{DIRECTUS_URL}/items/{USER_COLLECTION}/{directus_id}",
            headers=headers,
            json=data,
        )

        # Debug any error responses
        if response.status_code >= 400:
            logger.error(f"Error response from Directus: {response.text}")

        response.raise_for_status()
        logger.info(f"Updated user {user.username} in Directus")
        return True
    except Exception as e:
        logger.error(f"Failed to update user in Directus: {e}")
        return False


def delete_directus_user(token, directus_id):
    """Delete a user in Directus"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.delete(
            f"{DIRECTUS_URL}/items/{USER_COLLECTION}/{directus_id}", headers=headers
        )
        response.raise_for_status()
        logger.info(f"Deleted user with ID {directus_id} from Directus")
        return True
    except Exception as e:
        logger.error(f"Failed to delete user in Directus: {e}")
        return False


def ensure_user_collection_exists(token):
    """
    Check if the user collection exists in Directus and create it if needed
    """
    try:
        headers = {"Authorization": f"Bearer {token}"}

        # Check if collection exists
        response = requests.get(
            f"{DIRECTUS_URL}/collections/{USER_COLLECTION}", headers=headers
        )

        if response.status_code == 200:
            logger.info(f"Collection {USER_COLLECTION} already exists in Directus")
            return True

        elif response.status_code == 404:
            logger.info(
                f"Collection {USER_COLLECTION} does not exist in Directus, creating it"
            )

            # Create collection
            collection_data = {
                "collection": USER_COLLECTION,
                "schema": {
                    "name": USER_COLLECTION,
                    "comment": "Users synchronized from PostgreSQL database",
                },
                "meta": {
                    "singleton": False,
                    "archive_field": "status",
                    "archive_value": "archived",
                    "unarchive_value": "active",
                    "sort_field": "sort",
                },
            }

            create_response = requests.post(
                f"{DIRECTUS_URL}/collections",
                headers={**headers, "Content-Type": "application/json"},
                json=collection_data,
            )

            if create_response.status_code >= 400:
                logger.error(f"Failed to create collection: {create_response.text}")
                return False

            logger.info(f"Collection {USER_COLLECTION} created successfully")

            # Now create required fields
            fields = [
                {
                    "field": "username",
                    "type": "string",
                    "schema": {"is_unique": True, "is_nullable": False},
                    "meta": {"interface": "input", "required": True},
                },
                {
                    "field": "email",
                    "type": "string",
                    "schema": {"is_unique": True, "is_nullable": False},
                    "meta": {"interface": "input", "required": True},
                },
                {
                    "field": "hashed_password",
                    "type": "string",
                    "schema": {"is_nullable": False},
                    "meta": {"interface": "input", "required": True},
                },
                {
                    "field": "is_active",
                    "type": "boolean",
                    "schema": {"default_value": True},
                    "meta": {"interface": "boolean"},
                },
                {
                    "field": "is_superuser",
                    "type": "boolean",
                    "schema": {"default_value": False},
                    "meta": {"interface": "boolean"},
                },
                {
                    "field": "status",
                    "type": "string",
                    "schema": {"default_value": "active"},
                    "meta": {
                        "interface": "select-dropdown",
                        "options": {
                            "choices": [
                                {"text": "Active", "value": "active"},
                                {"text": "Inactive", "value": "inactive"},
                                {"text": "Archived", "value": "archived"},
                            ]
                        },
                    },
                },
                {
                    "field": "role",
                    "type": "string",
                    "schema": {"default_value": "2"},
                    "meta": {
                        "interface": "select-dropdown",
                        "options": {
                            "choices": [
                                {"text": "Admin", "value": "3"},
                                {"text": "User", "value": "2"},
                            ]
                        },
                    },
                },
            ]

            for field in fields:
                field_response = requests.post(
                    f"{DIRECTUS_URL}/fields/{USER_COLLECTION}",
                    headers={**headers, "Content-Type": "application/json"},
                    json=field,
                )

                if field_response.status_code >= 400:
                    logger.error(
                        f"Failed to create field {field['field']}: {field_response.text}"
                    )
                else:
                    logger.info(f"Field {field['field']} created successfully")

            return True

        else:
            logger.error(
                f"Unexpected response when checking collection: {response.status_code} {response.text}"
            )
            return False

    except Exception as e:
        logger.error(f"Error ensuring collection exists: {e}")
        return False


def sync_users_to_directus(db: Any, user_class: Optional[Type] = None):
    """
    Sync users from database to Directus

    Args:
        db: Database connection or session (SQLAlchemy Session or PostgreSQL adapter)
        user_class: Optional user model class for SQLAlchemy compatibility
    """
    token = get_directus_token()
    if not token:
        logger.error("Failed to authenticate with Directus. Sync aborted.")
        return False

    # Ensure the collection exists
    if not ensure_user_collection_exists(token):
        logger.error("Failed to ensure collection exists. Sync aborted.")
        return False

    # Get all users from Directus
    directus_users = get_directus_users(token)
    if directus_users is None:
        directus_users = []

    # Get users from the database (works with both SQLAlchemy and our PostgreSQL adapter)
    if user_class:
        db_users = db.query(user_class).all()
    else:
        # For SQLAlchemy without specifying a class
        from server.core.database import User

        db_users = db.query(User).all()

    logger.info(
        f"Found {len(db_users)} users in database and {len(directus_users)} users in Directus"
    )

    # Check if we can access the schema first to validate our approach
    try:
        headers = {"Authorization": f"Bearer {token}"}
        schema_response = requests.get(
            f"{DIRECTUS_URL}/collections/{USER_COLLECTION}", headers=headers
        )
        if schema_response.status_code == 200:
            logger.info(
                f"Directus collection schema for {USER_COLLECTION}: {schema_response.json()}"
            )
        else:
            logger.warning(
                f"Could not access schema for {USER_COLLECTION}: {schema_response.status_code}"
            )
    except Exception as e:
        logger.warning(f"Error checking collection schema: {e}")

    # Create a mapping of usernames to Directus user IDs
    directus_user_map = {}
    for user in directus_users:
        # Handle field name variations
        username = user.get("username")
        if username:
            directus_user_map[username] = user.get("id")

    # Sync each database user to Directus
    for db_user in db_users:
        if db_user.username in directus_user_map:
            # Update existing user
            update_directus_user(token, directus_user_map[db_user.username], db_user)
            # Remove from the map to track remaining users
            del directus_user_map[db_user.username]
        else:
            # Create new user
            create_directus_user(token, db_user)

    # Delete Directus users that don't exist in the database
    for directus_id in directus_user_map.values():
        delete_directus_user(token, directus_id)

    logger.info("User synchronization completed")
    return True


def ensure_help_tickets_collection_exists(token):
    """
    Check if the help_tickets collection exists in Directus and create it if needed
    """
    try:
        headers = {"Authorization": f"Bearer {token}"}

        # Check if collection exists
        response = requests.get(
            f"{DIRECTUS_URL}/collections/help_tickets", headers=headers
        )

        collection_exists = False
        if response.status_code == 200:
            logger.info("Collection help_tickets already exists in Directus")
            collection_exists = True
        elif response.status_code == 404:
            logger.info(
                "Collection help_tickets does not exist in Directus, creating it"
            )

            # Create collection
            collection_data = {
                "collection": "help_tickets",
                "schema": {
                    "name": "help_tickets",
                    "comment": "Help tickets submitted by users",
                },
                "meta": {
                    "singleton": False,
                    "archive_field": "status",
                    "archive_value": "closed",
                    "unarchive_value": "open",
                    "sort_field": "created_at",
                },
            }

            create_response = requests.post(
                f"{DIRECTUS_URL}/collections",
                headers={**headers, "Content-Type": "application/json"},
                json=collection_data,
            )

            if create_response.status_code >= 400:
                logger.error(f"Failed to create collection: {create_response.text}")
                return False

            logger.info("Collection help_tickets created successfully")

            # Now create required fields
            fields = [
                {
                    "field": "title",
                    "type": "string",
                    "schema": {"is_nullable": False},
                    "meta": {"interface": "input", "required": True},
                },
                {
                    "field": "description",
                    "type": "text",
                    "schema": {"is_nullable": False},
                    "meta": {"interface": "input-multiline", "required": True},
                },
                {
                    "field": "user_id",
                    "type": "string",
                    "schema": {"is_nullable": False},
                    "meta": {"interface": "input", "required": True},
                },
                {
                    "field": "status",
                    "type": "string",
                    "schema": {"default_value": "open"},
                    "meta": {
                        "interface": "select-dropdown",
                        "options": {
                            "choices": [
                                {"text": "Open", "value": "open"},
                                {"text": "In Progress", "value": "in_progress"},
                                {"text": "Closed", "value": "closed"},
                            ]
                        },
                    },
                },
                {
                    "field": "created_at",
                    "type": "timestamp",
                    "schema": {"on_create": "now()"},
                    "meta": {
                        "interface": "datetime",
                        "special": ["date-created"],
                        "readonly": True,
                    },
                },
            ]

            for field in fields:
                field_response = requests.post(
                    f"{DIRECTUS_URL}/fields/help_tickets",
                    headers={**headers, "Content-Type": "application/json"},
                    json=field,
                )

                if field_response.status_code >= 400:
                    logger.error(
                        f"Failed to create field {field['field']}: {field_response.text}"
                    )
                else:
                    logger.info(f"Field {field['field']} created successfully")

            collection_exists = True
        else:
            logger.error(
                f"Unexpected response when checking collection: {response.status_code} {response.text}"
            )
            return False

        # Set permissions regardless of whether collection was just created or already existed
        if collection_exists:
            # Check current permissions
            permissions_check = requests.get(
                f"{DIRECTUS_URL}/permissions?filter[collection][_eq]=help_tickets",
                headers=headers,
            )

            if permissions_check.status_code == 200:
                current_permissions = permissions_check.json().get("data", [])
                logger.info(
                    f"Found {len(current_permissions)} permission records for help_tickets"
                )
            else:
                logger.warning(
                    "Could not check existing permissions, will create new ones"
                )
                current_permissions = []

            # Function to check if a permission exists
            def has_permission(role_id, action):
                return any(
                    p.get("role") == role_id and p.get("action") == action
                    for p in current_permissions
                )

            # Admin role - full CRUD permissions
            for action in ["create", "read", "update", "delete"]:
                if not has_permission("1", action):
                    admin_permission = {
                        "collection": "help_tickets",
                        "role": "1",  # Admin role
                        "action": action,
                        "permissions": {},
                        "validation": {},
                        "fields": ["*"],
                        "presets": {},
                        "policy": [
                            {
                                "effect": "allow",
                                "condition": {
                                    "_and": [{"user_id": {"_eq": "$CURRENT_USER"}}]
                                },
                            }
                        ],
                    }

                    admin_response = requests.post(
                        f"{DIRECTUS_URL}/permissions",
                        headers={**headers, "Content-Type": "application/json"},
                        json=admin_permission,
                    )

                    if admin_response.status_code >= 400:
                        logger.error(
                            f"Failed to create admin {action} permission: {admin_response.text}"
                        )
                    else:
                        logger.info(
                            f"Admin {action} permission for help_tickets created successfully"
                        )

            # User role - read and create permissions
            for action, role_id in [("read", None), ("read", "2"), ("create", "2")]:
                if not has_permission(role_id, action):
                    user_permission = {
                        "collection": "help_tickets",
                        "role": role_id,  # None for public, 2 for authenticated users
                        "action": action,
                        "permissions": {},
                        "validation": {},
                        "fields": ["*"],
                        "presets": {},
                        "policy": [
                            {
                                "effect": "allow",
                                "condition": {
                                    "_and": [{"user_id": {"_eq": "$CURRENT_USER"}}]
                                },
                            }
                        ],
                    }

                    user_response = requests.post(
                        f"{DIRECTUS_URL}/permissions",
                        headers={**headers, "Content-Type": "application/json"},
                        json=user_permission,
                    )

                    if user_response.status_code >= 400:
                        logger.error(
                            f"Failed to create role {role_id} {action} permission: {user_response.text}"
                        )
                    else:
                        logger.info(
                            f"Role {role_id} {action} permission for help_tickets created successfully"
                        )

            return True

        return collection_exists

    except Exception as e:
        logger.error(f"Error ensuring help_tickets collection exists: {e}")
        return False


def submit_ticket_to_directus(token, title, description, user_id, status="open"):
    """Submit a help ticket to Directus"""
    try:
        # Ensure the help_tickets collection exists
        if not ensure_help_tickets_collection_exists(token):
            logger.error(
                "Failed to ensure help_tickets collection exists. Ticket submission aborted."
            )
            return None

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        data = {
            "title": title,
            "description": description,
            "user_id": user_id,
            "status": status,
        }
        response = requests.post(
            f"{DIRECTUS_URL}/items/help_tickets", headers=headers, json=data
        )
        response.raise_for_status()
        logger.info(f"Ticket '{title}' submitted successfully")
        return response.json()["data"]
    except Exception as e:
        logger.error(f"Failed to submit ticket: {e}")
        return None


def get_user_tickets_from_directus(token, user_id):
    """Get all help tickets for a specific user from Directus"""
    try:
        # Ensure the help_tickets collection exists
        if not ensure_help_tickets_collection_exists(token):
            logger.error(
                "Failed to ensure help_tickets collection exists. Ticket retrieval aborted."
            )
            return None

        headers = {"Authorization": f"Bearer {token}"}
        # Filter tickets by user_id
        # Include all fields and especially created_at
        fields = "id,title,description,status,user_id,created_at"
        response = requests.get(
            f"{DIRECTUS_URL}/items/help_tickets?filter[user_id][_eq]={user_id}&fields={fields}",
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()["data"]
        logger.info(f"Retrieved {len(data)} tickets for user {user_id}")
        return data
    except Exception as e:
        logger.error(f"Failed to get user tickets: {e}")
        return None
