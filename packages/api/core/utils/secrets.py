"""Utility functions for handling Docker secrets and environment variables."""

import os
from typing import Optional


def get_secret_or_env(env_name: str, default: Optional[str] = None) -> Optional[str]:
    """Get a value from environment variable or Docker secret file.
    
    Docker Swarm convention: if ENV_VAR_FILE exists, read the secret from that file.
    Otherwise, use ENV_VAR directly.
    
    Args:
        env_name: The environment variable name
        default: Default value if neither env var nor secret file exists
        
    Returns:
        The secret value or default
    """
    # First check for _FILE variant (Docker secret)
    secret_file = os.environ.get(f"{env_name}_FILE")
    if secret_file and os.path.exists(secret_file):
        try:
            with open(secret_file, 'r') as f:
                value = f.read().strip()
                if value:
                    return value
        except Exception:
            # Fall through to regular env var
            pass
    
    # Check regular environment variable
    value = os.environ.get(env_name)
    if value is not None:
        return value
        
    return default