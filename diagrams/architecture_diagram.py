#!/usr/bin/env python3
"""
Generate a diagram of the DDALAB client-server architecture.

This script creates a visual representation of the client-server architecture
and saves it as a PDF in the diagrams folder.
"""

from pathlib import Path

import matplotlib.patches as patches
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch

# Configure matplotlib to use LaTeX with Source Sans Pro
plt.rcParams.update(
    {
        "text.usetex": True,
        "text.latex.preamble": r"\usepackage{sourcesanspro} \usepackage[T1]{fontenc} \renewcommand{\familydefault}{\sfdefault}",
        "font.family": "sans-serif",
        "mathtext.fontset": "cm",
        "axes.labelsize": 10,
        "font.size": 10,
        "legend.fontsize": 8,
        "xtick.labelsize": 8,
        "ytick.labelsize": 8,
    }
)

# Create figure and axis
fig, ax = plt.subplots(figsize=(10, 8))
ax.set_xlim(0, 10)
ax.set_ylim(0, 8)
ax.axis("off")

# Colors
client_color = "#e6f2ff"  # Light blue
server_color = "#e6ffe6"  # Light green
db_color = "#fffae6"  # Light yellow
ssl_color = "#ffe6e6"  # Light red


# Function to create a box
def create_box(x, y, width, height, label, color, fontsize=10):
    # Create box with LaTeX-style
    rect = patches.FancyBboxPatch(
        (x, y),
        width,
        height,
        boxstyle=patches.BoxStyle("Round", pad=0.3, rounding_size=0.1),
        linewidth=0.8,
        edgecolor="black",
        facecolor=color,
        alpha=0.85,
    )
    ax.add_patch(rect)
    ax.text(
        x + width / 2,
        y + height / 2,
        r"{}".format(label),
        ha="center",
        va="center",
        fontsize=fontsize,
        fontweight="bold",
    )
    return rect


# Function to create a cylinder (database)
def create_cylinder(x, y, width, height, label):
    ellipse1 = patches.Ellipse(
        (x + width / 2, y + height),
        width,
        height * 0.2,
        linewidth=0.8,
        edgecolor="black",
        facecolor=db_color,
        alpha=0.85,
    )
    ellipse2 = patches.Ellipse(
        (x + width / 2, y),
        width,
        height * 0.2,
        linewidth=0.8,
        edgecolor="black",
        facecolor=db_color,
        alpha=0.85,
    )
    rect = patches.Rectangle(
        (x, y),
        width,
        height,
        linewidth=0.8,
        edgecolor="black",
        facecolor=db_color,
        alpha=0.85,
    )

    ax.add_patch(rect)
    ax.add_patch(ellipse1)
    ax.add_patch(ellipse2)
    ax.text(
        x + width / 2,
        y + height / 2,
        r"{}".format(label),
        ha="center",
        va="center",
        fontweight="bold",
    )
    return (rect, ellipse1, ellipse2)


# Function to draw an arrow
def draw_arrow(start_x, start_y, end_x, end_y, label, label_pos="above"):
    dx = end_x - start_x
    dy = end_y - start_y

    # Create LaTeX-style arrow
    arrow = FancyArrowPatch(
        (start_x, start_y),
        (end_x, end_y),
        arrowstyle="-|>",  # LaTeX-style arrow
        connectionstyle="arc3,rad=0.0",  # Straight lines by default
        shrinkA=2,  # Small gap at the start point
        shrinkB=2,  # Small gap at the end point
        linewidth=0.8,  # Thinner line for LaTeX style
        color="black",
        mutation_scale=12,  # Controls the arrow head size
    )
    ax.add_patch(arrow)

    # Label
    if label_pos == "above":
        ax.text(
            start_x + dx / 2,
            start_y + dy / 2 + 0.1,
            r"{}".format(label),
            ha="center",
            va="bottom",
            fontsize=8,
        )
    elif label_pos == "below":
        ax.text(
            start_x + dx / 2,
            start_y + dy / 2 - 0.1,
            r"{}".format(label),
            ha="center",
            va="top",
            fontsize=8,
        )
    elif label_pos == "right":
        ax.text(
            start_x + dx / 2 + 0.1,
            start_y + dy / 2,
            r"{}".format(label),
            ha="left",
            va="center",
            fontsize=8,
        )
    elif label_pos == "left":
        ax.text(
            start_x + dx / 2 - 0.1,
            start_y + dy / 2,
            r"{}".format(label),
            ha="right",
            va="center",
            fontsize=8,
        )


# Client side components
gui = create_box(1, 6, 2, 0.8, r"PyQt6 GUI\\(DDALabWindow)", client_color)
client = create_box(1, 5, 2, 0.8, r"GraphQL Client", client_color)
state = create_box(1, 4, 2, 0.8, r"State Manager", client_color)

# Server side components
fastapi = create_box(7, 6, 2, 0.8, r"FastAPI Server", server_color)
graphql = create_box(7, 5, 2, 0.8, r"GraphQL API", server_color)
core = create_box(7, 4, 2, 0.8, r"Server Core", server_color)
db = create_cylinder(7, 2.5, 2, 0.8, r"Database")

# Draw client group box
client_group = patches.FancyBboxPatch(
    (0.5, 3.5),
    3,
    3.8,
    boxstyle="round,pad=0.1",
    linewidth=0.8,
    edgecolor="black",
    facecolor="none",
    linestyle="--",
)
ax.add_patch(client_group)
ax.text(2, 7.5, r"\textsf{\textbf{Client}}", ha="center", va="center", fontsize=12)

# Draw server group box
server_group = patches.FancyBboxPatch(
    (6.5, 2),
    3,
    5.3,
    boxstyle="round,pad=0.1",
    linewidth=0.8,
    edgecolor="black",
    facecolor="none",
    linestyle="--",
)
ax.add_patch(server_group)
ax.text(8, 7.5, r"\textsf{\textbf{Server}}", ha="center", va="center", fontsize=12)

# Draw SSL connection
ssl_ellipse = patches.Ellipse(
    (5, 5.5),
    1.5,
    0.6,
    linewidth=0.8,
    edgecolor="black",
    facecolor=ssl_color,
    alpha=0.85,
)
ax.add_patch(ssl_ellipse)
ax.text(5, 5.5, r"\textsf{\textbf{SSL}}", ha="center", va="center", fontsize=8)

# Draw connections
draw_arrow(2, 6, 2, 5.8, r"UI Events", "right")
draw_arrow(2, 5, 2, 4.8, r"Data Updates", "right")
draw_arrow(1.8, 4.8, 1.8, 5, r"State Changes", "left")

# HTTP/HTTPS with slight curve
http_arrow = FancyArrowPatch(
    (3, 6.4),
    (7, 6.4),
    arrowstyle="-|>",
    connectionstyle="arc3,rad=0.0",  # Straight line
    shrinkA=2,
    shrinkB=2,
    linewidth=0.8,
    color="black",
    mutation_scale=12,
)
ax.add_patch(http_arrow)
ax.text(5, 6.5, r"HTTP/HTTPS", ha="center", va="bottom", fontsize=8)

# JSON Responses with slight downward curve
json_arrow = FancyArrowPatch(
    (7, 6.2),
    (3, 6.2),
    arrowstyle="-|>",
    connectionstyle="arc3,rad=0.0",  # Straight line
    shrinkA=2,
    shrinkB=2,
    linewidth=0.8,
    color="black",
    mutation_scale=12,
)
ax.add_patch(json_arrow)
ax.text(5, 6.1, r"JSON Responses", ha="center", va="top", fontsize=8)

draw_arrow(8, 6, 8, 5.8, r"Requests", "right")
draw_arrow(8, 5, 8, 4.8, r"Data Ops", "right")
draw_arrow(8, 3.9, 8, 3.2, r"Queries", "right")
draw_arrow(7.8, 3.2, 7.8, 3.9, r"Results", "left")

# Add dashed arrow from SSL to connection
dashed_arrow = FancyArrowPatch(
    (5, 5.7),
    (5, 6),
    arrowstyle="-|>",
    connectionstyle="arc3,rad=0.0",
    linestyle="--",
    linewidth=0.8,
    color="black",
    mutation_scale=12,
    shrinkA=1,
    shrinkB=1,
)
ax.add_patch(dashed_arrow)

# Add title
plt.title(r"\textsf{\textbf{DDALAB Python Client-Server Architecture}}", fontsize=14)

# Save the diagram
plt.tight_layout()

# Use the current directory when the script is run from the diagrams folder
output_path = Path("architecture_diagram.pdf")

plt.savefig(output_path, format="pdf", bbox_inches="tight")
plt.close()

print(f"Architecture diagram saved as '{output_path}'")
