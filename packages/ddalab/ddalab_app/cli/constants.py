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
        "description": "Pairwise ergodicity metrics.",
    },
    {
        "id": "SY",
        "app_id": "synchronization",
        "label": "Synchronization",
        "description": "Pairwise synchronization metrics.",
    },
    # conditional CD extensions of the Rust engine (CPU only); pairs as for CD
    *(
        {"id": variant_id, "app_id": app_id, "label": label, "description": description}
        for variant_id, app_id, label, description in (
            (
                "CCD",
                "conditional_cross_dynamical",
                "Conditional Cross Dynamical",
                "CD conditioned on the other selected channels.",
            ),
            (
                "CCDLOG",
                "conditional_cross_dynamical_log_mse_ratio",
                "Conditional CD (log MSE ratio)",
                "Log ratio of conditional fit errors.",
            ),
            (
                "CCDPR2",
                "conditional_cross_dynamical_partial_r2",
                "Conditional CD (partial R2)",
                "Partial R2 of the source given the conditioning set.",
            ),
            (
                "CCDSIG",
                "conditional_cross_dynamical_significance",
                "Conditional CD (significance)",
                "Surrogate significance of conditional CD.",
            ),
            (
                "CCDSTAB",
                "conditional_cross_dynamical_stability",
                "Conditional CD (stability)",
                "Stability of conditional CD under perturbation.",
            ),
            (
                "TRCCD",
                "temporally_regularized_conditional_cross_dynamical",
                "Temporally regularized CCD",
                "Conditional CD smoothed across windows.",
            ),
            (
                "MVCCD",
                "multivariate_conditional_cross_dynamical",
                "Multivariate CCD",
                "Conditional CD with several active sources.",
            ),
        )
    ),
]
_DDA_VARIANT_ALIAS_MAP = {
    alias: spec["id"]
    for spec in _DDA_VARIANT_SPECS
    for alias in (str(spec["id"]).lower(), str(spec["app_id"]).lower())
}
_DEFAULT_DDA_WINDOW_LENGTH = 64
_DEFAULT_DDA_WINDOW_STEP = 10
_DEFAULT_DDA_DELAYS = [7, 10]
_DEFAULT_DDA_MODEL_DIMENSION = 4
_DEFAULT_DDA_POLYNOMIAL_ORDER = 4
_DEFAULT_DDA_NR_TAU = 2
_DEFAULT_DDA_MODEL_TERMS = [1, 2, 10]
