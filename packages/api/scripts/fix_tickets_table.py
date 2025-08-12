#!/usr/bin/env python3
"""Script to fix the help_tickets table constraint issue."""

import asyncio
import sys
from pathlib import Path

# Add the parent directory to the path so we can import from the API
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import async_session_maker
from sqlalchemy import text


async def fix_tickets_table():
    """Fix the help_tickets table by removing the incorrect unique constraint."""
    
    print("Connecting to database...")
    
    async with async_session_maker() as session:
        try:
            # Check if the constraint exists
            check_constraint_query = text("""
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE constraint_name = 'help_tickets_user_id_key' 
                AND table_name = 'help_tickets'
                AND table_schema = 'public'
            """)
            
            result = await session.execute(check_constraint_query)
            constraint_exists = result.fetchone() is not None
            
            if constraint_exists:
                print("Found incorrect unique constraint on help_tickets.user_id")
                print("Dropping the constraint...")
                
                # Drop the constraint
                drop_constraint_query = text("""
                    ALTER TABLE public.help_tickets 
                    DROP CONSTRAINT help_tickets_user_id_key
                """)
                
                await session.execute(drop_constraint_query)
                await session.commit()
                
                print("✅ Successfully dropped the unique constraint!")
            else:
                print("✅ No problematic constraint found - table is already correct")
                
            # Verify current constraints
            print("\nCurrent constraints on help_tickets table:")
            constraints_query = text("""
                SELECT constraint_name, constraint_type 
                FROM information_schema.table_constraints 
                WHERE table_name = 'help_tickets' 
                AND table_schema = 'public'
                ORDER BY constraint_type, constraint_name
            """)
            
            result = await session.execute(constraints_query)
            constraints = result.fetchall()
            
            for constraint in constraints:
                print(f"  - {constraint.constraint_name} ({constraint.constraint_type})")
                
        except Exception as e:
            print(f"❌ Error: {e}")
            await session.rollback()
            raise


if __name__ == "__main__":
    asyncio.run(fix_tickets_table())