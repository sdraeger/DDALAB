"""
AUTO-GENERATED from DDA Specification v1.0.0
Generated: 2025-12-02

DO NOT EDIT MANUALLY - Run `cargo run --package dda-spec` to regenerate.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

# =============================================================================
# CONSTANTS
# =============================================================================

SPEC_VERSION = "1.0.0"
SELECT_MASK_SIZE = 6
BINARY_NAME = "run_DDA_AsciiEdf"
REQUIRES_SHELL_WRAPPER = True
SHELL_COMMAND = "sh"
SUPPORTED_PLATFORMS = [
    "linux",
    "macos",
    "windows",
]


# =============================================================================
# ENUMS
# =============================================================================

class ChannelFormat(Enum):
    """Channel format for variant input."""
    INDIVIDUAL = "individual"
    PAIRS = "pairs"
    DIRECTED_PAIRS = "directed_pairs"


class FileType(Enum):
    """Supported input file types."""
    EDF = "EDF"
    ASCII = "ASCII"

    @property
    def flag(self) -> str:
        """Get the CLI flag for this file type."""
        flags = {
            FileType.EDF: "-EDF",
            FileType.ASCII: "-ASCII",
        }
        return flags[self]

    @classmethod
    def from_extension(cls, ext: str) -> Optional["FileType"]:
        """Detect file type from extension."""
        ext = ext.lower().lstrip(".")
        mapping = {
            "edf": cls.EDF,
            "ascii": cls.ASCII,
            "txt": cls.ASCII,
            "csv": cls.ASCII,
        }
        return mapping.get(ext)


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass(frozen=True)
class OutputColumns:
    """Output column specification for a variant."""
    coefficients: int
    has_error: bool
    description: str


@dataclass(frozen=True)
class VariantMetadata:
    """Complete variant metadata."""
    abbreviation: str
    name: str
    position: int
    output_suffix: str
    stride: int
    reserved: bool
    required_params: tuple
    channel_format: ChannelFormat
    output_columns: OutputColumns
    documentation: str

    def requires_ct_params(self) -> bool:
        """Check if this variant requires CT window parameters."""
        return "-WL_CT" in self.required_params


# =============================================================================
# VARIANT DEFINITIONS
# =============================================================================


ST = VariantMetadata(
    abbreviation="ST",
    name="Single Timeseries",
    position=0,
    output_suffix="_ST",
    stride=4,
    reserved=False,
    required_params=(),
    channel_format=ChannelFormat.INDIVIDUAL,
    output_columns=OutputColumns(
        coefficients=3,
        has_error=True,
        description="4 columns per channel: a_1, a_2, a_3 coefficients + error",
    ),
    documentation="Analyzes individual channels independently. Most basic variant. One result row per channel.",
)


CT = VariantMetadata(
    abbreviation="CT",
    name="Cross-Timeseries",
    position=1,
    output_suffix="_CT",
    stride=4,
    reserved=False,
    required_params=("-WL_CT", "-WS_CT", ),
    channel_format=ChannelFormat.PAIRS,
    output_columns=OutputColumns(
        coefficients=3,
        has_error=True,
        description="4 columns per pair: a_1, a_2, a_3 coefficients + error",
    ),
    documentation="Analyzes relationships between channel pairs. Symmetric: pair (1,2) equals (2,1). When enabled with ST, wrapper must run CT pairs separately.",
)


CD = VariantMetadata(
    abbreviation="CD",
    name="Cross-Dynamical",
    position=2,
    output_suffix="_CD_DDA_ST",
    stride=2,
    reserved=False,
    required_params=("-WL_CT", "-WS_CT", ),
    channel_format=ChannelFormat.DIRECTED_PAIRS,
    output_columns=OutputColumns(
        coefficients=1,
        has_error=True,
        description="2 columns per directed pair: a_1 coefficient + error",
    ),
    documentation="Analyzes directed causal relationships. Asymmetric: (1->2) differs from (2->1). CD is independent (no longer requires ST+CT).",
)


RESERVED = VariantMetadata(
    abbreviation="RESERVED",
    name="Reserved",
    position=3,
    output_suffix="_RESERVED",
    stride=1,
    reserved=True,
    required_params=(),
    channel_format=ChannelFormat.INDIVIDUAL,
    output_columns=OutputColumns(
        coefficients=0,
        has_error=False,
        description="Reserved for internal development",
    ),
    documentation="Internal development function. Should always be set to 0 in production.",
)


DE = VariantMetadata(
    abbreviation="DE",
    name="Delay Embedding",
    position=4,
    output_suffix="_DE",
    stride=1,
    reserved=False,
    required_params=("-WL_CT", "-WS_CT", ),
    channel_format=ChannelFormat.INDIVIDUAL,
    output_columns=OutputColumns(
        coefficients=0,
        has_error=False,
        description="1 column: single ergodicity measure per time window",
    ),
    documentation="Tests for ergodic behavior in dynamical systems. Produces single aggregate measure per time window (not per-channel).",
)


SY = VariantMetadata(
    abbreviation="SY",
    name="Synchronization",
    position=5,
    output_suffix="_SY",
    stride=1,
    reserved=False,
    required_params=(),
    channel_format=ChannelFormat.INDIVIDUAL,
    output_columns=OutputColumns(
        coefficients=0,
        has_error=False,
        description="1 column per channel/measure: synchronization coefficient",
    ),
    documentation="Detects synchronized behavior between signals. Produces one value per channel/measure per time window.",
)



# All variants in SELECT mask order
VARIANT_REGISTRY: tuple = (
    ST,
    CT,
    CD,
    RESERVED,
    DE,
    SY,
)

# Variant abbreviations in SELECT mask order
VARIANT_ORDER: tuple = (
    "ST",
    "CT",
    "CD",
    "RESERVED",
    "DE",
    "SY",
)


# =============================================================================
# SELECT MASK POSITIONS
# =============================================================================

class SelectMaskPositions:
    """Position constants for SELECT mask."""
    ST: int = 0
    CT: int = 1
    CD: int = 2
    RESERVED: int = 3
    DE: int = 4
    SY: int = 5


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_variant_by_abbrev(abbrev: str) -> Optional[VariantMetadata]:
    """Look up variant by abbreviation."""
    for variant in VARIANT_REGISTRY:
        if variant.abbreviation == abbrev:
            return variant
    return None


def get_variant_by_suffix(suffix: str) -> Optional[VariantMetadata]:
    """Look up variant by output suffix."""
    for variant in VARIANT_REGISTRY:
        if variant.output_suffix == suffix:
            return variant
    return None


def get_variant_by_position(position: int) -> Optional[VariantMetadata]:
    """Look up variant by position in SELECT mask."""
    for variant in VARIANT_REGISTRY:
        if variant.position == position:
            return variant
    return None


def active_variants() -> List[VariantMetadata]:
    """Get all non-reserved variants."""
    return [v for v in VARIANT_REGISTRY if not v.reserved]


def generate_select_mask(variants: List[str]) -> List[int]:
    """Generate a SELECT mask from variant abbreviations.

    Args:
        variants: List of variant abbreviations (e.g., ["ST", "SY"])

    Returns:
        6-element list of 0s and 1s

    Example:
        >>> generate_select_mask(["ST", "SY"])
        [1, 0, 0, 0, 0, 1]
    """
    mask = [0] * SELECT_MASK_SIZE
    for abbrev in variants:
        variant = get_variant_by_abbrev(abbrev)
        if variant:
            mask[variant.position] = 1
    return mask


def parse_select_mask(mask: List[int]) -> List[str]:
    """Parse a SELECT mask back to variant abbreviations.

    Args:
        mask: 6-element list of 0s and 1s

    Returns:
        List of variant abbreviations (excludes RESERVED)

    Example:
        >>> parse_select_mask([1, 0, 0, 0, 0, 1])
        ['ST', 'SY']
    """
    result = []
    for pos, bit in enumerate(mask):
        if bit == 1:
            variant = get_variant_by_position(pos)
            if variant and not variant.reserved:
                result.append(variant.abbreviation)
    return result


def format_select_mask(mask: List[int]) -> str:
    """Format SELECT mask as space-separated string for CLI.

    Example:
        >>> format_select_mask([1, 1, 0, 0, 0, 1])
        '1 1 0 0 0 1'
    """
    return " ".join(str(b) for b in mask)


# =============================================================================
# SCALE PARAMETERS
# =============================================================================

@dataclass
class ScaleParameters:
    """Parameters for generating delay values from scale range."""
    scale_min: float = 1
    scale_max: float = 20
    scale_num: int = 20

    def generate_delays(self) -> List[int]:
        """Generate delay values from scale parameters.

        Returns:
            List of integer delay values
        """
        if self.scale_num == 1:
            return [round(self.scale_min)]

        step = (self.scale_max - self.scale_min) / (self.scale_num - 1)
        return [round(self.scale_min + i * step) for i in range(self.scale_num)]


# =============================================================================
# EXPORT
# =============================================================================

__all__ = [
    # Constants
    "SPEC_VERSION",
    "SELECT_MASK_SIZE",
    "BINARY_NAME",
    "REQUIRES_SHELL_WRAPPER",
    "SHELL_COMMAND",
    "SUPPORTED_PLATFORMS",
    # Enums
    "ChannelFormat",
    "FileType",
    # Data classes
    "OutputColumns",
    "VariantMetadata",
    # Variants
    "ST",
    "CT",
    "CD",
    "RESERVED",
    "DE",
    "SY",
    "VARIANT_REGISTRY",
    "VARIANT_ORDER",
    # Utilities
    "SelectMaskPositions",
    "get_variant_by_abbrev",
    "get_variant_by_suffix",
    "get_variant_by_position",
    "active_variants",
    "generate_select_mask",
    "parse_select_mask",
    "format_select_mask",
    "ScaleParameters",
]
