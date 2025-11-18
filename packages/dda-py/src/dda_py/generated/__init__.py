"""AUTO-GENERATED from DDA_SPEC.yaml
DO NOT EDIT - Changes will be overwritten

Generated at: 2025-11-17T20:47:03.358668+00:00
Spec version: 1.0.0
Generator: dda-codegen v0.1.0

DDA Generated Package - Python Bindings
"""

from .variants import (
    VariantMetadata,
    VARIANT_REGISTRY,
    SelectMaskPositions,
    get_variant_by_abbrev,
    get_variant_by_suffix,
    generate_select_mask,
    parse_select_mask,
)

from .dda import (
    DDARunner,
    DDARequest,
    BINARY_NAME,
    REQUIRES_SHELL_WRAPPER,
    Flags,
    Defaults,
)

__all__ = [
    # Variant metadata
    "VariantMetadata",
    "VARIANT_REGISTRY",
    "SelectMaskPositions",
    "get_variant_by_abbrev",
    "get_variant_by_suffix",
    "generate_select_mask",
    "parse_select_mask",
    # DDA Execution
    "DDARunner",
    "DDARequest",
    "BINARY_NAME",
    "REQUIRES_SHELL_WRAPPER",
    # Constants
    "Flags",
    "Defaults",
]

__version__ = "1.0.0"
