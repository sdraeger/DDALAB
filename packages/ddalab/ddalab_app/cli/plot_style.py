from __future__ import annotations

import shutil
from pathlib import Path

import matplotlib as mpl
from matplotlib.figure import Figure

FIGURE_WIDTHS = {
    "single": 3.35,
    "double": 6.90,
    "wide": 5.50,
}


def use_clean_tex_style() -> None:
    """Reset Matplotlib and use external TeX for figure text."""
    if shutil.which("latex") is None:
        raise RuntimeError("External TeX rendering requires `latex` on PATH.")
    mpl.rcdefaults()
    mpl.rcParams["text.usetex"] = True


def figure_size(width: str, height_ratio: float) -> tuple[float, float]:
    try:
        figure_width = FIGURE_WIDTHS[width]
    except KeyError as exc:
        raise ValueError(f"Unknown figure width: {width}") from exc
    return figure_width, figure_width * height_ratio


def save_figure(figure: Figure, path: str | Path) -> None:
    """Save a vector PDF and a 600-DPI PNG preview."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(destination.with_suffix(".pdf"), bbox_inches="tight")
    figure.savefig(destination.with_suffix(".png"), dpi=600, bbox_inches="tight")
