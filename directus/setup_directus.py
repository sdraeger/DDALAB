#!/usr/bin/env python3
"""
Setup script for Directus to create the signup_requests collection
and necessary fields.

Run this script after setting up your Directus instance and configuring .env file.
"""

import logging
import os

import requests
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("directus_setup")

# Load environment variables
load_dotenv()

# Directus settings
DIRECTUS_URL = os.getenv("DIRECTUS_URL", "http://localhost:8055")
DIRECTUS_EMAIL = os.getenv("DIRECTUS_EMAIL", "admin@example.com")
DIRECTUS_PASSWORD = os.getenv("DIRECTUS_PASSWORD", "admin")
SIGNUP_COLLECTION = os.getenv("SIGNUP_COLLECTION", "signup_requests")
CONTACT_COLLECTION = os.getenv("CONTACT_COLLECTION", "contact_inquiries")
HELP_TICKETS_COLLECTION = os.getenv("HELP_TICKETS_COLLECTION", "help_tickets")
USER_COLLECTION = os.getenv("USER_COLLECTION", "users")


def get_token():
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


def check_collection_exists(token, collection_name):
    """Check if the collection already exists"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{DIRECTUS_URL}/collections/{collection_name}", headers=headers
        )
        return response.status_code == 200
    except Exception:
        return False


def create_collection(token, collection_name):
    """Create a new collection in Directus"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    collection_data = {
        "collection": collection_name,
        "meta": {
            "icon": "account_circle",
            "note": "Signup requests from the Flask application",
            "display_template": "{{first_name}} {{last_name}}",
        },
        "schema": {
            "name": collection_name,
            "comment": "Stores signup requests for DDA Access",
        },
    }

    # Override metadata for contact collection
    if collection_name == CONTACT_COLLECTION:
        collection_data["meta"] = {
            "icon": "mail",
            "note": "Contact inquiries from the Flask application",
            "display_template": "{{email}}",
        }
        collection_data["schema"] = {
            "name": collection_name,
            "comment": "Stores contact inquiries for DDA Access",
        }

    # Override metadata for help tickets collection
    elif collection_name == HELP_TICKETS_COLLECTION:
        collection_data["meta"] = {
            "icon": "help",
            "note": "Help tickets from users",
            "display_template": "{{subject}}",
        }
        collection_data["schema"] = {
            "name": collection_name,
            "comment": "Stores help tickets from users",
        }

    # Override metadata for user collection
    elif collection_name == USER_COLLECTION:
        collection_data["meta"] = {
            "icon": "person",
            "note": "System users",
            "display_template": "{{username}}",
        }
        collection_data["schema"] = {
            "name": collection_name,
            "comment": "Stores user information for authentication",
        }

    try:
        logger.info(f"Creating collection: {collection_name}")
        response = requests.post(
            f"{DIRECTUS_URL}/collections", headers=headers, json=collection_data
        )
        response.raise_for_status()
        logger.info(f"Collection {collection_name} created successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to create collection: {e}")
        logger.error(
            f"Response: {response.text if 'response' in locals() else 'No response'}"
        )
        return False


def create_fields(token, collection_name):
    """Create fields in the collection"""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    fields = []

    if collection_name == SIGNUP_COLLECTION:
        fields = [
            {
                "field": "first_name",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "First Name"},
                    "width": "half",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "last_name",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "Last Name"},
                    "width": "half",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "affiliation",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "Affiliation"},
                    "width": "full",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "email",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "Email Address"},
                    "width": "full",
                    "required": True,
                    "special": ["email"],
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "status",
                "type": "string",
                "meta": {
                    "interface": "select-dropdown",
                    "options": {
                        "choices": [
                            {"text": "Pending", "value": "pending"},
                            {"text": "Approved", "value": "approved"},
                            {"text": "Rejected", "value": "rejected"},
                        ]
                    },
                    "width": "full",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": "pending"},
            },
        ]
    elif collection_name == CONTACT_COLLECTION:
        fields = [
            {
                "field": "email",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "Email Address"},
                    "width": "full",
                    "required": True,
                    "special": ["email"],
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "message",
                "type": "text",
                "meta": {
                    "interface": "input-multiline",
                    "options": {"placeholder": "Message"},
                    "width": "full",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
        ]
    elif collection_name == HELP_TICKETS_COLLECTION:
        fields = [
            {
                "field": "title",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "Title"},
                    "width": "full",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "description",
                "type": "text",
                "meta": {
                    "interface": "input-multiline",
                    "options": {"placeholder": "Description"},
                    "width": "full",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "user_id",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "User ID"},
                    "width": "full",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "created_at",
                "type": "timestamp",
                "meta": {
                    "interface": "datetime",
                    "width": "full",
                    "readonly": True,
                },
                "schema": {"is_nullable": False, "default_value": "CURRENT_TIMESTAMP"},
            },
            {
                "field": "status",
                "type": "string",
                "meta": {
                    "interface": "select-dropdown",
                    "options": {
                        "choices": [
                            {"text": "Open", "value": "open"},
                            {"text": "In Progress", "value": "in_progress"},
                            {"text": "Resolved", "value": "resolved"},
                            {"text": "Closed", "value": "closed"},
                        ]
                    },
                    "width": "full",
                    "required": True,
                },
                "schema": {"is_nullable": False, "default_value": "open"},
            },
        ]
    elif collection_name == USER_COLLECTION:
        fields = [
            {
                "field": "id",
                "type": "integer",
                "meta": {
                    "interface": "input",
                    "readonly": True,
                    "hidden": True,
                    "width": "full",
                    "required": False,
                },
                "schema": {"is_primary_key": True, "has_auto_increment": True},
            },
            {
                "field": "username",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "Username"},
                    "width": "full",
                    "required": True,
                },
                "schema": {
                    "is_nullable": False,
                    "default_value": None,
                    "is_unique": True,
                },
            },
            {
                "field": "password_hash",
                "type": "string",
                "meta": {
                    "interface": "input",
                    "options": {"placeholder": "Password Hash"},
                    "width": "full",
                    "required": True,
                    "note": "Hashed password, not plaintext",
                },
                "schema": {"is_nullable": False, "default_value": None},
            },
            {
                "field": "is_active",
                "type": "boolean",
                "meta": {
                    "interface": "boolean",
                    "width": "half",
                    "required": False,
                },
                "schema": {"is_nullable": False, "default_value": True},
            },
            {
                "field": "is_superuser",
                "type": "boolean",
                "meta": {
                    "interface": "boolean",
                    "width": "half",
                    "required": False,
                },
                "schema": {"is_nullable": False, "default_value": False},
            },
        ]

    success = True
    for field_data in fields:
        try:
            logger.info(f"Creating field: {field_data['field']}")
            response = requests.post(
                f"{DIRECTUS_URL}/fields/{collection_name}",
                headers=headers,
                json=field_data,
            )
            response.raise_for_status()
            logger.info(f"Field {field_data['field']} created successfully")
        except Exception as e:
            logger.error(f"Failed to create field {field_data['field']}: {e}")
            logger.error(
                f"Response: {response.text if 'response' in locals() else 'No response'}"
            )
            success = False

    return success


def main():
    """Main function to set up Directus"""
    logger.info("Starting Directus setup")

    # Get token
    token = get_token()
    if not token:
        logger.error("Failed to authenticate with Directus. Check your credentials.")
        return False

    # Check if collection exists
    if check_collection_exists(token, SIGNUP_COLLECTION):
        logger.info(f"Collection {SIGNUP_COLLECTION} already exists")
    else:
        # Create collection
        if not create_collection(token, SIGNUP_COLLECTION):
            logger.error("Failed to create collection. Exiting.")
            return False

        # Create fields
        if not create_fields(token, SIGNUP_COLLECTION):
            logger.warning("Some fields may not have been created correctly.")

    # Check if contact collection exists
    if check_collection_exists(token, CONTACT_COLLECTION):
        logger.info(f"Collection {CONTACT_COLLECTION} already exists")
    else:
        # Create contact collection
        if not create_collection(token, CONTACT_COLLECTION):
            logger.error(f"Failed to create {CONTACT_COLLECTION} collection. Exiting.")
            return False

        # Create contact fields
        if not create_fields(token, CONTACT_COLLECTION):
            logger.warning(
                f"Some fields for {CONTACT_COLLECTION} may not have been created correctly."
            )

    # Check if help tickets collection exists
    if check_collection_exists(token, HELP_TICKETS_COLLECTION):
        logger.info(f"Collection {HELP_TICKETS_COLLECTION} already exists")
    else:
        # Create help tickets collection
        if not create_collection(token, HELP_TICKETS_COLLECTION):
            logger.error(
                f"Failed to create {HELP_TICKETS_COLLECTION} collection. Exiting."
            )
            return False

        # Create help tickets fields
        if not create_fields(token, HELP_TICKETS_COLLECTION):
            logger.warning(
                f"Some fields for {HELP_TICKETS_COLLECTION} may not have been created correctly."
            )

    # Check if user collection exists
    if check_collection_exists(token, USER_COLLECTION):
        logger.info(f"Collection {USER_COLLECTION} already exists")
    else:
        # Create user collection
        if not create_collection(token, USER_COLLECTION):
            logger.error(f"Failed to create {USER_COLLECTION} collection. Exiting.")
            return False

        # Create user fields
        if not create_fields(token, USER_COLLECTION):
            logger.warning(
                f"Some fields for {USER_COLLECTION} may not have been created correctly."
            )

    logger.info("Directus setup completed successfully")
    return True


if __name__ == "__main__":
    if main():
        logger.info("\nDirectus setup completed successfully!")
        logger.info(
            f"You can now access your collections at:\n"
            f"- {DIRECTUS_URL}/admin/content/{SIGNUP_COLLECTION}\n"
            f"- {DIRECTUS_URL}/admin/content/{CONTACT_COLLECTION}\n"
            f"- {DIRECTUS_URL}/admin/content/{HELP_TICKETS_COLLECTION}\n"
            f"- {DIRECTUS_URL}/admin/content/{USER_COLLECTION}"
        )
    else:
        logger.error("\nDirectus setup failed. Please check the logs and try again.")
