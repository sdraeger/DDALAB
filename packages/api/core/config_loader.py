"""
Configuration loader that supports both environment variables and YAML files.
This enables the Docker container to use YAML config files without host dependencies.
"""

import os
import yaml
from typing import Dict, Any, Optional
from pathlib import Path
from loguru import logger


class ConfigLoader:
    """Loads configuration from YAML files and merges with environment variables."""
    
    @staticmethod
    def load_yaml_config(config_path: str) -> Dict[str, Any]:
        """Load configuration from a YAML file."""
        try:
            path = Path(config_path)
            if not path.exists():
                logger.warning(f"Config file not found: {config_path}")
                return {}
                
            with open(path, 'r') as f:
                config = yaml.safe_load(f) or {}
                logger.info(f"Loaded configuration from: {config_path}")
                return config
        except Exception as e:
            logger.error(f"Error loading config from {config_path}: {e}")
            return {}
    
    @staticmethod
    def flatten_config(config: Dict[str, Any], prefix: str = "") -> Dict[str, str]:
        """Flatten nested configuration into environment variable format."""
        result = {}
        
        for key, value in config.items():
            # Convert to uppercase environment variable format
            env_key = f"{prefix}{key}".upper().replace(".", "_")
            
            if isinstance(value, dict):
                # Recursively flatten nested dictionaries
                nested = ConfigLoader.flatten_config(value, f"{env_key}_")
                result.update(nested)
            elif isinstance(value, list):
                # Convert lists to comma-separated strings
                result[env_key] = ",".join(str(v) for v in value)
            elif isinstance(value, bool):
                # Convert booleans to strings
                result[env_key] = str(value).lower()
            elif value is not None:
                # Convert other values to strings
                result[env_key] = str(value)
                
        return result
    
    @staticmethod
    def apply_config_to_environment(config_path: Optional[str] = None):
        """Load YAML config and apply it to environment variables."""
        # Check if a config file path is provided via environment
        if not config_path:
            config_path = os.getenv("DDALAB_CONFIG_FILE")
            
        if not config_path:
            logger.info("No config file specified, using environment variables only")
            return
            
        # Load the YAML configuration
        config = ConfigLoader.load_yaml_config(config_path)
        if not config:
            return
            
        # Flatten the configuration
        flat_config = ConfigLoader.flatten_config(config, "DDALAB_")
        
        # Apply to environment variables (only if not already set)
        for key, value in flat_config.items():
            if key not in os.environ:
                os.environ[key] = value
                logger.debug(f"Set {key} from config file")
            else:
                logger.debug(f"Keeping existing {key} from environment")
                
        # Also set some legacy environment variables for backward compatibility
        legacy_mappings = {
            "DDALAB_DATABASE_HOST": "DB_HOST",
            "DDALAB_DATABASE_PORT": "DB_PORT",
            "DDALAB_DATABASE_NAME": "DB_NAME",
            "DDALAB_DATABASE_USER": "DB_USER",
            "DDALAB_DATABASE_PASSWORD": "DB_PASSWORD",
            "DDALAB_AUTH_JWT_SECRET_KEY": "JWT_SECRET_KEY",
            "DDALAB_STORAGE_MINIO_HOST": "MINIO_HOST",
            "DDALAB_STORAGE_MINIO_ACCESS_KEY": "MINIO_ACCESS_KEY",
            "DDALAB_STORAGE_MINIO_SECRET_KEY": "MINIO_SECRET_KEY",
            "DDALAB_STORAGE_DATA_DIR": "DATA_DIR",
            "DDALAB_STORAGE_ALLOWED_DIRS": "ALLOWED_DIRS",
            "DDALAB_DDA_BINARY_PATH": "DDA_BINARY_PATH",
        }
        
        for new_key, legacy_key in legacy_mappings.items():
            if new_key in os.environ and legacy_key not in os.environ:
                os.environ[legacy_key] = os.environ[new_key]
                logger.debug(f"Set legacy {legacy_key} from {new_key}")


# Initialize configuration on module import
ConfigLoader.apply_config_to_environment()