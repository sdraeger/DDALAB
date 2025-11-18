"""AUTO-GENERATED from DDA_SPEC.yaml
DO NOT EDIT - Changes will be overwritten

Generated at: 2025-11-17T20:47:03.358668+00:00
Spec version: 1.0.0
Generator: dda-codegen v0.1.0
"""

from dataclasses import dataclass
from typing import Optional, List


@dataclass(frozen=True)
class VariantMetadata:
    """DDA Variant Metadata

    Defines properties and behavior for each DDA analysis variant.
    """

    abbreviation: str
    """Variant abbreviation (e.g., "ST", "CT", "CD")"""

    name: str
    """Full variant name"""

    description: str
    """Detailed description"""

    output_suffix: str
    """Output file suffix appended by binary"""

    stride: int
    """Column stride for parsing output
    - ST/CT/DE: 4 columns per channel/pair
    - CD: 2 columns per directed pair
    - SY: 1 column per channel
    """

    requires_ct_params: bool
    """Whether this variant requires CT window parameters"""


# Registry of all DDA variants
VARIANT_REGISTRY: List[VariantMetadata] = [
    VariantMetadata(
        abbreviation="CD",
        name="Cross-Dynamical",
        description="Analyzes directed causal relationships between channels",
        output_suffix="_CD_DDA_ST",
        stride=2,
        requires_ct_params=True,
    ),
    VariantMetadata(
        abbreviation="CT",
        name="Cross-Timeseries",
        description="Analyzes relationships between channel pairs",
        output_suffix="_CT",
        stride=4,
        requires_ct_params=True,
    ),
    VariantMetadata(
        abbreviation="DE",
        name="Delay Embedding (Dynamical Ergodicity)",
        description="Analyzes dynamical ergodicity through delay embedding",
        output_suffix="_DE",
        stride=1,
        requires_ct_params=True,
    ),
    VariantMetadata(
        abbreviation="ST",
        name="Single Timeseries",
        description="Analyzes individual channels independently",
        output_suffix="_ST",
        stride=4,
        requires_ct_params=False,
    ),
    VariantMetadata(
        abbreviation="SY",
        name="Synchronization",
        description="Analyzes phase synchronization between signals",
        output_suffix="_SY",
        stride=1,
        requires_ct_params=False,
    ),
]


# SELECT mask bit positions
class SelectMaskPositions:
    """SELECT mask bit positions

    The SELECT mask is a 6-element list controlling which variants to execute.
    Format: ST CT CD RESERVED DE SY
    """
    CD = 2
    CT = 1
    DE = 4  # Position 3 is RESERVED
    ST = 0
    SY = 5
    RESERVED = 3


def get_variant_by_abbrev(abbrev: str) -> Optional[VariantMetadata]:
    """Get variant metadata by abbreviation

    Args:
        abbrev: Variant abbreviation (e.g., "ST", "CT")

    Returns:
        VariantMetadata if found, None otherwise
    """
    for variant in VARIANT_REGISTRY:
        if variant.abbreviation == abbrev:
            return variant
    return None


def get_variant_by_suffix(suffix: str) -> Optional[VariantMetadata]:
    """Get variant metadata by output suffix

    Args:
        suffix: Output file suffix (e.g., "_DDA_ST")

    Returns:
        VariantMetadata if found, None otherwise
    """
    for variant in VARIANT_REGISTRY:
        if variant.output_suffix == suffix:
            return variant
    return None


def generate_select_mask(variants: List[str]) -> List[int]:
    """Generate SELECT mask from enabled variants

    Args:
        variants: List of variant abbreviations to enable (e.g., ["ST", "CT"])

    Returns:
        6-element list with 1s for enabled variants, 0s for disabled

    Example:
        >>> mask = generate_select_mask(["ST", "SY"])
        >>> assert mask == [1, 0, 0, 0, 0, 1]  # ST and SY enabled
    """
    mask = [0, 0, 0, 0, 0, 0]

    for variant in variants:
        if variant == "CD":
            mask[SelectMaskPositions.CD] = 1
        if variant == "CT":
            mask[SelectMaskPositions.CT] = 1
        if variant == "DE":
            mask[SelectMaskPositions.DE] = 1
        if variant == "ST":
            mask[SelectMaskPositions.ST] = 1
        if variant == "SY":
            mask[SelectMaskPositions.SY] = 1

    return mask


def parse_select_mask(mask: List[int]) -> List[str]:
    """Parse SELECT mask to list of enabled variants

    Args:
        mask: 6-element SELECT mask list

    Returns:
        List of enabled variant abbreviations

    Example:
        >>> mask = [1, 0, 0, 0, 0, 1]
        >>> enabled = parse_select_mask(mask)
        >>> assert enabled == ["ST", "SY"]
    """
    if len(mask) < 6:
        raise ValueError(f"Invalid SELECT mask: expected 6 bits, got {len(mask)}")

    enabled = []
    if mask[SelectMaskPositions.CD] == 1:
        enabled.append("CD")
    if mask[SelectMaskPositions.CT] == 1:
        enabled.append("CT")
    if mask[SelectMaskPositions.DE] == 1:
        enabled.append("DE")
    if mask[SelectMaskPositions.ST] == 1:
        enabled.append("ST")
    if mask[SelectMaskPositions.SY] == 1:
        enabled.append("SY")

    return enabled
