from __future__ import annotations

_DDA_VARIANT_SPECS = [
    {
        "id": "ST",
        "app_id": "single_timeseries",
        "label": "Single Timeseries",
        "description": "Per-channel delay differential analysis.",
    },
    {
        "id": "CT",
        "app_id": "cross_timeseries",
        "label": "Cross Timeseries",
        "description": "Undirected pairwise coupling metrics.",
    },
    {
        "id": "CD",
        "app_id": "cross_dynamical",
        "label": "Cross Dynamical",
        "description": "Directed pairwise coupling metrics.",
    },
    {
        "id": "DE",
        "app_id": "dynamical_ergodicity",
        "label": "Dynamical Ergodicity",
        "description": "Per-channel ergodicity metrics.",
    },
    {
        "id": "SY",
        "app_id": "synchronization",
        "label": "Synchronization",
        "description": "Per-channel synchronization metrics.",
    },
]
_DDA_VARIANT_ALIAS_MAP = {
    alias: spec["id"]
    for spec in _DDA_VARIANT_SPECS
    for alias in (str(spec["id"]).lower(), str(spec["app_id"]).lower())
}
_DEFAULT_DDA_WINDOW_LENGTH = 64
_DEFAULT_DDA_WINDOW_STEP = 10
_DEFAULT_DDA_DELAYS = [7, 10]
_DEFAULT_DDA_END_SECONDS = 30.0
_DEFAULT_DDA_MODEL_DIMENSION = 4
_DEFAULT_DDA_POLYNOMIAL_ORDER = 4
_DEFAULT_DDA_NR_TAU = 2
_DEFAULT_DDA_MODEL_TERMS = [1, 2, 10]
