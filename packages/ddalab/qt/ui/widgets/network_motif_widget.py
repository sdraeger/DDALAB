from __future__ import annotations

import math
from typing import List, Optional

from PySide6.QtCore import QPointF, QRectF, QSize, Qt
from PySide6.QtGui import (
    QColor,
    QPainter,
    QPainterPath,
    QPen,
)
from PySide6.QtWidgets import QWidget

from ...domain.models import (
    NetworkMotifData,
)
from ..style import current_theme_colors


class NetworkMotifWidget(QWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._motif_data: Optional[NetworkMotifData] = None
        self._card_width = 308
        self._card_height = 320
        self.setMinimumHeight(self._card_height)

    def set_motif_data(self, motif_data: Optional[NetworkMotifData]) -> None:
        self._motif_data = motif_data
        hint = self.sizeHint()
        self.setMinimumSize(hint)
        self.resize(hint)
        self.updateGeometry()
        self.update()

    def refresh_theme(self) -> None:
        self.update()

    def sizeHint(self) -> QSize:  # type: ignore[override]
        motif_count = (
            len(self._motif_data.adjacency_matrices)
            if self._motif_data is not None
            else 0
        )
        if motif_count <= 0:
            return QSize(720, self._card_height)
        spacing = 16
        width = 16 + motif_count * self._card_width + max(0, motif_count - 1) * spacing
        return QSize(width, self._card_height)

    def minimumSizeHint(self) -> QSize:  # type: ignore[override]
        return self.sizeHint()

    def paintEvent(self, event) -> None:  # type: ignore[override]
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        theme = current_theme_colors(self)
        painter.fillRect(self.rect(), QColor(theme.plot_surface))

        motif_data = self._motif_data
        if motif_data is None or not motif_data.adjacency_matrices:
            painter.setPen(QColor(theme.plot_muted_text))
            painter.drawText(
                self.rect(),
                Qt.AlignCenter,
                "CD motif plots will appear here when directed connectivity is available.",
            )
            return

        margin = 8.0
        spacing = 16.0
        for index, adjacency in enumerate(motif_data.adjacency_matrices):
            left = margin + index * (self._card_width + spacing)
            card_rect = QRectF(
                left,
                margin,
                self._card_width,
                max(220.0, self.height() - margin * 2.0),
            )
            self._draw_motif_card(
                painter,
                card_rect,
                motif_data,
                adjacency_index=index,
            )

    def _draw_motif_card(
        self,
        painter: QPainter,
        card_rect: QRectF,
        motif_data: NetworkMotifData,
        *,
        adjacency_index: int,
    ) -> None:
        theme = current_theme_colors(self)
        adjacency = motif_data.adjacency_matrices[adjacency_index]
        card_fill = QColor(theme.plot_surface_alt)
        card_border = QColor(theme.plot_border)
        painter.save()
        painter.setPen(QPen(card_border, 1.2))
        painter.setBrush(card_fill)
        painter.drawRoundedRect(card_rect, 14.0, 14.0)

        header_rect = QRectF(
            card_rect.left() + 14.0,
            card_rect.top() + 10.0,
            card_rect.width() - 28.0,
            22.0,
        )
        painter.setPen(QColor(theme.plot_text))
        title_font = painter.font()
        title_font.setPointSize(max(9, title_font.pointSize()))
        painter.setFont(title_font)
        painter.drawText(
            header_rect,
            Qt.AlignLeft | Qt.AlignVCenter,
            f"Causality motif {adjacency_index + 1}",
        )

        meta_font = painter.font()
        meta_font.setPointSize(max(8, meta_font.pointSize() - 1))
        painter.setFont(meta_font)
        painter.setPen(QColor(theme.plot_muted_text))
        painter.drawText(
            QRectF(
                card_rect.left() + 14.0,
                card_rect.top() + 32.0,
                card_rect.width() - 28.0,
                16.0,
            ),
            Qt.AlignLeft | Qt.AlignVCenter,
            f"tau = {adjacency.delay:.2f}    {len(adjacency.edges)} directed edges",
        )

        graph_rect = QRectF(
            card_rect.left() + 18.0,
            card_rect.top() + 56.0,
            card_rect.width() - 36.0,
            card_rect.height() - 108.0,
        )
        self._draw_motif_graph(
            painter,
            graph_rect,
            motif_data,
            adjacency_index=adjacency_index,
        )

        edge_count = len(adjacency.edges)
        average_weight = (
            sum(edge.weight for edge in adjacency.edges) / edge_count
            if edge_count
            else 0.0
        )
        max_weight = max((edge.weight for edge in adjacency.edges), default=0.0)
        painter.setPen(QColor(theme.plot_muted_text))
        painter.drawText(
            QRectF(
                card_rect.left() + 14.0,
                card_rect.bottom() - 34.0,
                card_rect.width() - 28.0,
                18.0,
            ),
            Qt.AlignLeft | Qt.AlignVCenter,
            (f"Avg weight {average_weight:.3f}    Peak {max_weight:.3f}"),
        )
        painter.restore()

    def _draw_motif_graph(
        self,
        painter: QPainter,
        graph_rect: QRectF,
        motif_data: NetworkMotifData,
        *,
        adjacency_index: int,
    ) -> None:
        theme = current_theme_colors(self)
        adjacency = motif_data.adjacency_matrices[adjacency_index]
        node_count = max(motif_data.num_nodes, 1)
        radius = max(24.0, min(graph_rect.width(), graph_rect.height()) * 0.32)
        node_radius = 12.0 if node_count > 10 else 14.0
        center = graph_rect.center()
        positions: List[QPointF] = []
        for node_index in range(node_count):
            angle = (-math.pi / 2.0) + (2.0 * math.pi * node_index / node_count)
            positions.append(
                QPointF(
                    center.x() + radius * math.cos(angle),
                    center.y() + radius * math.sin(angle),
                )
            )

        bidirectional_pairs = {
            tuple(sorted((edge.from_node, edge.to_node)))
            for edge in adjacency.edges
            if edge.from_node != edge.to_node
            and any(
                candidate.from_node == edge.to_node
                and candidate.to_node == edge.from_node
                for candidate in adjacency.edges
            )
        }

        painter.save()
        painter.setPen(QPen(QColor(theme.plot_grid), 1.0))
        painter.setBrush(Qt.NoBrush)
        painter.drawEllipse(center, radius + 18.0, radius + 18.0)

        for edge in adjacency.edges:
            if not (
                0 <= edge.from_node < len(positions)
                and 0 <= edge.to_node < len(positions)
            ):
                continue
            start = positions[edge.from_node]
            end = positions[edge.to_node]
            pair_key = tuple(sorted((edge.from_node, edge.to_node)))
            curve_offset = (
                26.0
                if pair_key in bidirectional_pairs and edge.from_node < edge.to_node
                else (-26.0 if pair_key in bidirectional_pairs else 10.0)
            )
            self._draw_directed_edge(
                painter,
                start,
                end,
                node_radius=node_radius,
                weight=float(edge.weight),
                curve_offset=curve_offset,
                self_loop=edge.from_node == edge.to_node,
            )

        node_fill = QColor("#60a5fa" if theme.mode == "dark" else "#2563eb")
        node_border = QColor("#dbeafe" if theme.mode == "dark" else "#eff6ff")
        label_fill = QColor(theme.plot_surface)
        label_fill.setAlpha(236)
        label_border = QColor(theme.plot_border)

        for node_index, center_point in enumerate(positions):
            painter.setPen(QPen(node_border, 1.4))
            painter.setBrush(node_fill)
            painter.drawEllipse(center_point, node_radius, node_radius)

            label_text = (
                motif_data.node_labels[node_index]
                if node_index < len(motif_data.node_labels)
                else f"Ch{node_index + 1}"
            )
            angle = (-math.pi / 2.0) + (2.0 * math.pi * node_index / node_count)
            label_anchor = QPointF(
                center_point.x() + math.cos(angle) * 26.0,
                center_point.y() + math.sin(angle) * 26.0,
            )
            label_width = min(
                96.0,
                max(54.0, painter.fontMetrics().horizontalAdvance(label_text) + 16.0),
            )
            label_rect = QRectF(
                label_anchor.x() - label_width / 2.0,
                label_anchor.y() - 10.0,
                label_width,
                20.0,
            )
            label_rect.moveLeft(
                max(
                    graph_rect.left(),
                    min(label_rect.left(), graph_rect.right() - label_rect.width()),
                )
            )
            label_rect.moveTop(
                max(
                    graph_rect.top(),
                    min(label_rect.top(), graph_rect.bottom() - label_rect.height()),
                )
            )
            painter.setPen(QPen(label_border, 1.0))
            painter.setBrush(label_fill)
            painter.drawRoundedRect(label_rect, 8.0, 8.0)
            painter.setPen(QColor(theme.plot_text))
            painter.drawText(
                label_rect.adjusted(6.0, 0.0, -6.0, 0.0),
                Qt.AlignCenter,
                painter.fontMetrics().elidedText(
                    label_text, Qt.ElideRight, int(label_rect.width() - 10.0)
                ),
            )
        painter.restore()

    def _draw_directed_edge(
        self,
        painter: QPainter,
        start: QPointF,
        end: QPointF,
        *,
        node_radius: float,
        weight: float,
        curve_offset: float,
        self_loop: bool,
    ) -> None:
        color = self._edge_color(weight)
        pen = QPen(color, 1.2 + weight * 2.8)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)

        if self_loop:
            loop_rect = QRectF(
                start.x() - node_radius * 0.2,
                start.y() - node_radius * 2.4,
                node_radius * 1.8,
                node_radius * 1.8,
            )
            path = QPainterPath()
            path.arcMoveTo(loop_rect, 210.0)
            path.arcTo(loop_rect, 210.0, 280.0)
            painter.drawPath(path)
            end_point = path.pointAtPercent(0.96)
            tangent = QPointF(0.8, -0.2)
            self._draw_arrowhead(painter, end_point, tangent, color)
            return

        delta_x = end.x() - start.x()
        delta_y = end.y() - start.y()
        length = math.hypot(delta_x, delta_y)
        if length <= 1e-6:
            return
        unit_x = delta_x / length
        unit_y = delta_y / length
        start_point = QPointF(
            start.x() + unit_x * (node_radius + 1.5),
            start.y() + unit_y * (node_radius + 1.5),
        )
        end_point = QPointF(
            end.x() - unit_x * (node_radius + 7.5),
            end.y() - unit_y * (node_radius + 7.5),
        )
        midpoint = QPointF(
            (start_point.x() + end_point.x()) / 2.0,
            (start_point.y() + end_point.y()) / 2.0,
        )
        normal = QPointF(-unit_y, unit_x)
        control = QPointF(
            midpoint.x() + normal.x() * curve_offset,
            midpoint.y() + normal.y() * curve_offset,
        )
        path = QPainterPath(start_point)
        path.quadTo(control, end_point)
        painter.drawPath(path)
        tangent = QPointF(
            end_point.x() - control.x(),
            end_point.y() - control.y(),
        )
        self._draw_arrowhead(painter, end_point, tangent, color)

    def _draw_arrowhead(
        self,
        painter: QPainter,
        tip: QPointF,
        tangent: QPointF,
        color: QColor,
    ) -> None:
        length = math.hypot(tangent.x(), tangent.y())
        if length <= 1e-6:
            return
        unit_x = tangent.x() / length
        unit_y = tangent.y() / length
        left = QPointF(
            tip.x() - unit_x * 10.0 + (-unit_y) * 4.5,
            tip.y() - unit_y * 10.0 + unit_x * 4.5,
        )
        right = QPointF(
            tip.x() - unit_x * 10.0 - (-unit_y) * 4.5,
            tip.y() - unit_y * 10.0 - unit_x * 4.5,
        )
        arrow_path = QPainterPath(tip)
        arrow_path.lineTo(left)
        arrow_path.lineTo(right)
        arrow_path.closeSubpath()
        painter.save()
        painter.setPen(Qt.NoPen)
        painter.setBrush(color)
        painter.drawPath(arrow_path)
        painter.restore()

    def _edge_color(self, weight: float) -> QColor:
        normalized = max(0.0, min(1.0, float(weight)))
        if normalized >= 0.75:
            color = QColor("#f59e0b")
        elif normalized >= 0.5:
            color = QColor("#10b981")
        elif normalized >= 0.25:
            color = QColor("#3b82f6")
        else:
            color = QColor("#64748b")
        color.setAlpha(112 + int(normalized * 120.0))
        return color
