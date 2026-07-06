from __future__ import annotations

from typing import Literal

from PySide6.QtGui import QColor
from PySide6.QtQuick import QSGFlatColorMaterial, QSGGeometry, QSGGeometryNode, QSGNode

DrawMode = Literal["line_strip", "lines"]


def line_geometry_node(
    line: object,
    color: str,
    width: float,
    height: float,
    *,
    draw_mode: DrawMode = "line_strip",
    line_width: float = 1.4,
) -> QSGGeometryNode:
    geometry = QSGGeometry(QSGGeometry.defaultAttributes_Point2D(), len(line))
    geometry.setDrawingMode(_drawing_mode(draw_mode))
    geometry.setLineWidth(float(line_width))
    points = geometry.vertexDataAsPoint2D()
    for index, point in enumerate(line):
        points[index].set(float(point[0]) * width, float(point[1]) * height)

    material = QSGFlatColorMaterial()
    material.setColor(QColor(color))
    node = QSGGeometryNode()
    node.setGeometry(geometry)
    node.setMaterial(material)
    node.setFlag(QSGNode.Flag.OwnsGeometry, True)
    node.setFlag(QSGNode.Flag.OwnsMaterial, True)
    return node


def _drawing_mode(draw_mode: DrawMode) -> QSGGeometry.DrawingMode:
    if draw_mode == "lines":
        return QSGGeometry.DrawingMode.DrawLines
    return QSGGeometry.DrawingMode.DrawLineStrip
