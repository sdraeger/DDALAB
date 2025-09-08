"""Service for managing DDA algorithm variants."""

from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from loguru import logger


class DDAVariant(BaseModel):
    """Individual DDA algorithm variant configuration."""
    id: str  # e.g., "single_timeseries", "cross_timeseries", etc.
    name: str  # Human-readable name
    description: str  # Brief description
    index: int  # Position in the binary array (0-based)
    enabled: bool = False
    abbreviation: str  # Short form like "ST", "CT", etc.


class DDAAlgorithmConfig(BaseModel):
    """DDA algorithm configuration with variants."""
    variants: List[DDAVariant]
    allow_multiple: bool = True  # Whether multiple variants can be selected
    
    def to_select_args(self) -> List[str]:
        """Convert to -SELECT argument format for binary."""
        # Create array with 4 known variants (extensible in future)
        select_array = ["0"] * 4
        for variant in self.variants:
            if variant.enabled and variant.index < len(select_array):
                select_array[variant.index] = "1"
        return select_array
    
    def get_enabled_variants(self) -> List[DDAVariant]:
        """Get list of enabled variants."""
        return [v for v in self.variants if v.enabled]


class DDAVariantService:
    """Service for managing DDA algorithm variants."""
    
    def __init__(self):
        self._variants_config = self._load_default_variants()
    
    def _load_default_variants(self) -> List[DDAVariant]:
        """Load default variant configurations with correct names."""
        return [
            DDAVariant(
                id="single_timeseries",
                name="Single Timeseries (ST)",
                description="Single timeseries analysis - standard temporal dynamics",
                abbreviation="ST",
                index=0,
                enabled=True  # Default selection
            ),
            DDAVariant(
                id="cross_timeseries",
                name="Cross Timeseries (CT)", 
                description="Cross timeseries analysis - inter-channel relationships",
                abbreviation="CT",
                index=1,
                enabled=False
            ),
            DDAVariant(
                id="cross_dynamical",
                name="Cross Dynamical (CD)",
                description="Cross dynamical analysis - dynamic coupling patterns",
                abbreviation="CD",
                index=2,
                enabled=False
            ),
            DDAVariant(
                id="dynamical_ergodicity",
                name="Dynamical Ergodicity (DE)",
                description="Dynamical ergodicity analysis - temporal stationarity assessment",
                abbreviation="DE",
                index=3,
                enabled=False
            )
        ]
    
    def get_available_variants(self) -> List[DDAVariant]:
        """Get all available variants."""
        return self._variants_config.copy()
    
    def get_default_config(self) -> DDAAlgorithmConfig:
        """Get default algorithm configuration."""
        return DDAAlgorithmConfig(
            variants=self._variants_config.copy(),
            allow_multiple=True
        )
    
    def create_config_from_selection(self, enabled_variant_ids: List[str]) -> DDAAlgorithmConfig:
        """Create algorithm config from list of enabled variant IDs."""
        variants = []
        for variant in self._variants_config:
            variant_copy = variant.copy()
            variant_copy.enabled = variant.id in enabled_variant_ids
            variants.append(variant_copy)
        
        return DDAAlgorithmConfig(
            variants=variants,
            allow_multiple=True
        )
    
    def validate_config(self, config: DDAAlgorithmConfig) -> tuple[bool, Optional[str]]:
        """Validate algorithm configuration."""
        enabled_variants = config.get_enabled_variants()
        
        if not enabled_variants:
            return False, "At least one algorithm variant must be selected"
        
        # Check for valid indices
        for variant in enabled_variants:
            if variant.index < 0 or variant.index >= 4:
                return False, f"Invalid variant index {variant.index} for variant {variant.name}"
        
        logger.info(f"Validated DDA config with variants: {[v.abbreviation for v in enabled_variants]}")
        return True, None
    
    def get_variant_by_id(self, variant_id: str) -> Optional[DDAVariant]:
        """Get variant by ID."""
        for variant in self._variants_config:
            if variant.id == variant_id:
                return variant
        return None