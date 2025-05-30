"""User management script for DDALAB server.

Usage:
    python manage_users.py create <username> [--superuser]
    python manage_users.py list
    python manage_users.py delete <username>
    python manage_users.py modify <username> [--password] [--superuser] [--active]
"""

import argparse
import asyncio

import setup_paths
from server.core.auth import create_user, get_password_hash
from server.core.database import User, get_db
from sqlalchemy import select

# Placeholder so the linter doesn't complain about the import.
setup_paths.configure_paths()


async def create_user_cmd(
    username: str, password: str = None, is_superuser: bool = False
) -> None:
    """Create a new user."""
    async with get_db() as db:
        # Check if user already exists
        stmt = select(User).filter(User.username == username)
        if await db.execute(stmt).scalars().first():
            print(f"Error: User '{username}' already exists")
            return

        # If no password provided, prompt for it
        if not password:
            import getpass

            password = getpass.getpass("Enter password: ")
            confirm = getpass.getpass("Confirm password: ")
            if password != confirm:
                print("Error: Passwords do not match")
                return

        # Create user
        _ = create_user(db, username, password, is_superuser)
        print(f"Created {'superuser' if is_superuser else 'user'} '{username}'")


async def list_users() -> None:
    """List all users."""
    async with get_db() as db:
        stmt = select(User)
        users = (await db.execute(stmt)).scalars().all()
        if not users:
            print("No users found")
            return

        print("\nUser List:")
        print("-" * 60)
        print(f"{'Username':<20} {'Superuser':<10} {'Active':<10}")
        print("-" * 60)
        for user in users:
            print(
                f"{user.username:<20} {str(user.is_superuser):<10} {str(user.is_active):<10}"
            )
        print("-" * 60)


async def delete_user(username: str) -> None:
    """Delete a user."""
    async with get_db() as db:
        stmt = select(User).filter(User.username == username)
        user = (await db.execute(stmt)).scalars().first()
        if not user:
            print(f"Error: User '{username}' not found")
            return

        # Prevent deleting the last superuser
        if user.is_superuser:
            stmt = select(User).filter(User.is_superuser)
            superuser_count = (await db.execute(stmt)).scalars().first()
            if superuser_count <= 1:
                print("Error: Cannot delete the last superuser")
                return

        db.delete(user)
        db.commit()
        print(f"Deleted user '{username}'")


async def modify_user(
    username: str, password: bool = False, superuser: bool = None, active: bool = None
) -> None:
    """Modify a user's attributes."""
    async with get_db() as db:
        stmt = select(User).filter(User.username == username)
        user = (await db.execute(stmt)).scalars().first()
        if not user:
            print(f"Error: User '{username}' not found")
            return

        if password:
            import getpass

            new_password = getpass.getpass("Enter new password: ")
            confirm = getpass.getpass("Confirm new password: ")
            if new_password != confirm:
                print("Error: Passwords do not match")
                return
            user.hashed_password = get_password_hash(new_password)
            print("Password updated")

        if superuser is not None:
            # Prevent removing superuser status from the last superuser
            if not superuser and user.is_superuser:
                stmt = select(User).filter(User.is_superuser)
                superuser_count = (await db.execute(stmt)).scalars().first()
                if superuser_count <= 1:
                    print(
                        "Error: Cannot remove superuser status from the last superuser"
                    )
                    return
            user.is_superuser = superuser
            print(f"Superuser status {'enabled' if superuser else 'disabled'}")

        if active is not None:
            # Prevent deactivating the last active superuser
            if not active and user.is_superuser:
                stmt = select(User).filter(User.is_superuser, User.is_active)
                active_superuser_count = (await db.execute(stmt)).scalars().first()
                if active_superuser_count <= 1:
                    print("Error: Cannot deactivate the last active superuser")
                    return
            user.is_active = active
            print(f"User {'activated' if active else 'deactivated'}")

        db.commit()


async def main():
    """Main entry point for the script."""
    parser = argparse.ArgumentParser(description="Manage DDALAB users")
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Create user command
    create_parser = subparsers.add_parser("create", help="Create a new user")
    create_parser.add_argument("username", help="Username")
    create_parser.add_argument(
        "--password", help="Password (if not provided, will prompt)"
    )
    create_parser.add_argument(
        "--superuser", action="store_true", help="Create as superuser"
    )

    # List users command
    subparsers.add_parser("list", help="List all users")

    # Delete user command
    delete_parser = subparsers.add_parser("delete", help="Delete a user")
    delete_parser.add_argument("username", help="Username to delete")

    # Modify user command
    modify_parser = subparsers.add_parser("modify", help="Modify a user")
    modify_parser.add_argument("username", help="Username to modify")
    modify_parser.add_argument(
        "--password", action="store_true", help="Change password"
    )
    modify_parser.add_argument("--superuser", type=bool, help="Set superuser status")
    modify_parser.add_argument("--active", type=bool, help="Set active status")

    args = parser.parse_args()

    if args.command == "create":
        create_user_cmd(args.username, args.password, args.superuser)
    elif args.command == "list":
        list_users()
    elif args.command == "delete":
        delete_user(args.username)
    elif args.command == "modify":
        modify_user(args.username, args.password, args.superuser, args.active)
    else:
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
