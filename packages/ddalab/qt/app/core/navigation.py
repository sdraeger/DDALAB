from __future__ import annotations

PRIMARY_SECTIONS = ("Workspace", "Run DDA", "Results", "Settings")

SECONDARY_SECTIONS = {
    "Workspace": ("Inspect", "Annotate", "Replay", "OpenNeuro"),
    "Run DDA": ("DDA", "ICA", "Batch", "Connectivity", "Compare"),
    "Results": ("History", "Action Log", "Notifications"),
}

_PRIMARY_ALIASES = {
    "Overview": "Workspace",
    "Visualize": "Workspace",
    "Data": "Workspace",
    "DDA": "Run DDA",
    "Collaborate": "Results",
    "Notifications": "Results",
    "Learn": "Workspace",
}

_SECONDARY_ALIASES = {
    ("Workspace", "Time Series"): "Inspect",
    ("Workspace", "Annotations"): "Annotate",
    ("Workspace", "Streaming"): "Replay",
    ("Workspace", "OpenNeuro"): "OpenNeuro",
    ("Results", "Results"): "History",
    ("Results", "Workflow"): "Action Log",
}

_LEGACY_PRIMARY_DEFAULT_SECONDARY = {
    "Data": "OpenNeuro",
    "Notifications": "Notifications",
}


def normalize_primary_section(section: object) -> str:
    text = section if isinstance(section, str) else ""
    return _PRIMARY_ALIASES.get(text, text if text in PRIMARY_SECTIONS else "Workspace")


def normalize_secondary_section(primary: object, secondary: object) -> str | None:
    primary_section = normalize_primary_section(primary)
    labels = SECONDARY_SECTIONS.get(primary_section, ())
    if not labels:
        return None
    text = secondary if isinstance(secondary, str) else ""
    label = _SECONDARY_ALIASES.get((primary_section, text), text)
    return label if label in labels else labels[0]


def normalize_navigation(primary: object, secondary: object) -> tuple[str, str | None]:
    original_primary = primary if isinstance(primary, str) else ""
    primary_section = normalize_primary_section(original_primary)
    secondary_section = secondary
    if not isinstance(secondary_section, str) or not secondary_section:
        secondary_section = _LEGACY_PRIMARY_DEFAULT_SECONDARY.get(original_primary)
    return primary_section, normalize_secondary_section(
        primary_section, secondary_section
    )


def secondary_index(primary: object, secondary: object) -> int:
    label = normalize_secondary_section(primary, secondary)
    if label is None:
        return 0
    return SECONDARY_SECTIONS.get(normalize_primary_section(primary), ()).index(label)
