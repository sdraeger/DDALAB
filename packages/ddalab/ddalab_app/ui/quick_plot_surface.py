from __future__ import annotations

import math
from importlib.resources import files
from pathlib import Path
from time import perf_counter_ns
from typing import Sequence

from PySide6.QtCore import Property, QObject, QRectF, Signal, Slot
from PySide6.QtGui import QImage
from PySide6.QtQml import qmlRegisterType
from PySide6.QtQuick import (
    QQuickItem,
    QSGNode,
    QSGSimpleTextureNode,
)

from ..app.runtime.perf_logging import perf_logger
from ..domain.models import DdaVariantResult, WaveformAnnotation
from .plot_data import (
    DdaVariantPlotProvider,
    MatrixTileCache,
    MatrixView,
    MatrixViewRenderKey,
    MatrixViewRequest,
    matrix_view_render_key,
)
from .plot_layers import PlotLayerConfig
from .qt_plot_renderer import (
    MatrixPlotRenderer,
    MatrixRenderArtifacts,
    QtCpuMatrixPlotRenderer,
)
from .render_cache import LruRenderCache
from .style import current_theme_colors

_QML_MODULE = "DDALAB.Plots"
_QML_MAJOR_VERSION = 1
_QML_MINOR_VERSION = 0
_QML_TYPES_REGISTERED = False
_RENDER_CACHE_CAPACITY = 8


class QuickPlotSurfaceBridge(QObject):
    changed = Signal()
    view_window_requested = Signal(float, float)
    cursor_fraction_requested = Signal(float)
    annotation_context_requested = Signal(float, float)

    def __init__(
        self,
        parent: QObject | None = None,
        *,
        renderer: MatrixPlotRenderer | None = None,
    ) -> None:
        super().__init__(parent)
        self._renderer = renderer or QtCpuMatrixPlotRenderer()
        self._title = "DDALAB plot"
        self._renderer_name = self._renderer.name
        self._row_start = 0
        self._row_count = 0
        self._total_row_count = 0
        self._visible_column_count = 0
        self._source_column_count = 0
        self._source_column_start = 0
        self._source_column_end = 0
        self._status_text = "No plot data loaded"
        self._image_revision = 0
        self._image = QImage()
        self._line_image = QImage()
        self._cursor_fraction = -1.0
        self._view_start_fraction = 0.0
        self._view_span_fraction = 1.0
        self._annotations: list[WaveformAnnotation] = []
        self._window_centers_seconds: list[float] = []
        self._row_labels: list[str] = []
        self._annotation_items: list[dict[str, object]] = []
        self._plot_layers = PlotLayerConfig()
        self._active_render_key: MatrixViewRenderKey | None = None
        self._matrix_tile_cache = MatrixTileCache()
        self._render_cache = LruRenderCache[
            MatrixViewRenderKey,
            MatrixRenderArtifacts,
        ](_RENDER_CACHE_CAPACITY)

    def clear(self) -> None:
        self._title = "DDALAB plot"
        self._renderer_name = "Qt Quick"
        self._row_start = 0
        self._row_count = 0
        self._total_row_count = 0
        self._visible_column_count = 0
        self._source_column_count = 0
        self._source_column_start = 0
        self._source_column_end = 0
        self._status_text = "No plot data loaded"
        self._image = QImage()
        self._line_image = QImage()
        self._cursor_fraction = -1.0
        self._view_start_fraction = 0.0
        self._view_span_fraction = 1.0
        self._annotations = []
        self._window_centers_seconds = []
        self._row_labels = []
        self._annotation_items = []
        self._active_render_key = None
        self._matrix_tile_cache.clear()
        self._render_cache.clear()
        self._image_revision += 1
        self.changed.emit()

    def set_matrix_view(
        self,
        view: MatrixView,
        *,
        title: str,
        renderer_name: str | None = None,
        color_scheme: str = "viridis",
    ) -> None:
        self._title = title
        self._renderer_name = renderer_name or self._renderer.name
        self._row_start = view.row_start
        self._row_count = view.source_row_count
        self._total_row_count = view.total_row_count
        self._visible_column_count = view.target_column_count
        self._source_column_count = view.source_column_count
        self._source_column_start = view.source_column_start
        self._source_column_end = view.source_column_end
        row_text = f"{self._row_count} rows"
        if self._total_row_count != self._row_count or self._row_start != 0:
            row_text = (
                f"{self._row_count} rows from row {self._row_start + 1} "
                f"of {self._total_row_count}"
            )
        self._status_text = (
            f"{row_text}, {self._visible_column_count} visible columns "
            f"from {self._source_column_count} source columns"
        )
        render_key = matrix_view_render_key(view, color_scheme)
        artifacts = self._render_cache.get(render_key)
        cache_hit = artifacts is not None
        if artifacts is None:
            render_started_ns = perf_counter_ns()
            artifacts = self._renderer.render(view, color_scheme=color_scheme)
            _log_slow_plot_build("matrix_renderer", render_started_ns, view)
            self._render_cache.put(render_key, artifacts)
        _log_render_cache_lookup(
            surface="result",
            hit=cache_hit,
            entries=self._render_cache.size,
            rows=view.source_row_count,
            row_start=view.row_start,
            total_rows=view.total_row_count,
            source_columns=view.source_column_count,
            source_column_start=view.source_column_start,
            source_column_end=view.source_column_end,
            target_columns=view.target_column_count,
            layers=self._plot_layers,
        )
        self._image = artifacts.image
        self._line_image = artifacts.line_image
        if render_key != self._active_render_key:
            self._active_render_key = render_key
            self._image_revision += 1
        self.changed.emit()

    def set_cursor_fraction(self, fraction: float | None) -> bool:
        next_fraction = _normalize_cursor_fraction(fraction)
        if next_fraction == self._cursor_fraction:
            return False
        self._cursor_fraction = next_fraction
        self.changed.emit()
        return True

    def set_view_window(self, start: float, span: float) -> bool:
        next_span = max(0.01, min(1.0, float(span)))
        next_start = max(0.0, min(1.0 - next_span, float(start)))
        if (
            abs(next_start - self._view_start_fraction) < 1e-9
            and abs(next_span - self._view_span_fraction) < 1e-9
        ):
            return False
        self._view_start_fraction = next_start
        self._view_span_fraction = next_span
        self._refresh_annotation_items()
        self.changed.emit()
        return True

    def view_window(self) -> tuple[float, float]:
        return self._view_start_fraction, self._view_span_fraction

    def set_annotations(
        self,
        annotations: Sequence[WaveformAnnotation],
        window_centers_seconds: Sequence[float],
        row_labels: Sequence[str],
    ) -> bool:
        self._annotations = list(annotations)
        self._window_centers_seconds = [
            float(value) for value in window_centers_seconds
        ]
        self._row_labels = [str(value) for value in row_labels]
        previous = self._annotation_items
        self._refresh_annotation_items()
        if previous == self._annotation_items:
            return False
        self.changed.emit()
        return True

    def visible_time_range(self) -> tuple[float, float] | None:
        centers = self._window_centers_seconds
        if not centers:
            return None
        first = min(len(centers) - 1, int(self._view_start_fraction * len(centers)))
        last = min(
            len(centers) - 1,
            max(
                first,
                int(
                    (self._view_start_fraction + self._view_span_fraction)
                    * len(centers)
                )
                - 1,
            ),
        )
        return centers[first], centers[last]

    def annotation_context(
        self,
        x_fraction: float,
        y_fraction: float,
    ) -> tuple[float, str | None, WaveformAnnotation | None]:
        visible_range = self.visible_time_range()
        if visible_range is None:
            seconds = 0.0
        else:
            seconds = visible_range[0] + max(0.0, min(1.0, x_fraction)) * (
                visible_range[1] - visible_range[0]
            )
        channel_name = None
        if self._row_labels:
            row = min(
                len(self._row_labels) - 1,
                int(max(0.0, min(0.999999, y_fraction)) * len(self._row_labels)),
            )
            channel_name = self._row_labels[row]
        return (
            seconds,
            channel_name,
            _result_annotation_at(
                self._annotations,
                channel_name,
                seconds,
                visible_range,
            ),
        )

    def _refresh_annotation_items(self) -> None:
        self._annotation_items = _result_annotation_items(
            self._annotations,
            self._row_labels,
            self.visible_time_range(),
        )

    @Slot(float, float)
    def requestZoom(self, factor: float, anchor_fraction: float) -> None:
        anchor = max(0.0, min(1.0, float(anchor_fraction)))
        next_span = max(
            0.01,
            min(1.0, self._view_span_fraction * max(0.05, float(factor))),
        )
        source_anchor = self._view_start_fraction + anchor * self._view_span_fraction
        next_start = source_anchor - anchor * next_span
        next_start = max(0.0, min(1.0 - next_span, next_start))
        self.view_window_requested.emit(next_start, next_span)

    @Slot(float)
    def requestPan(self, delta_fraction: float) -> None:
        next_start = self._view_start_fraction + (
            float(delta_fraction) * self._view_span_fraction
        )
        next_start = max(
            0.0,
            min(1.0 - self._view_span_fraction, next_start),
        )
        self.view_window_requested.emit(next_start, self._view_span_fraction)

    @Slot(float)
    def requestCursor(self, fraction: float) -> None:
        self.cursor_fraction_requested.emit(max(0.0, min(1.0, float(fraction))))

    @Slot(float, float)
    def requestAnnotationContext(self, x_fraction: float, y_fraction: float) -> None:
        self.annotation_context_requested.emit(
            max(0.0, min(1.0, float(x_fraction))),
            max(0.0, min(1.0, float(y_fraction))),
        )

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        if layers == self._plot_layers:
            return False
        self._plot_layers = layers
        self.changed.emit()
        return True

    def refresh_theme(self) -> None:
        self.changed.emit()

    def image(self) -> QImage:
        return self._image

    def line_image(self) -> QImage:
        return self._line_image

    def render_revision(self) -> int:
        return self._image_revision

    def matrix_tile_cache(self) -> MatrixTileCache:
        return self._matrix_tile_cache

    @Property(str, notify=changed)
    def title(self) -> str:
        return self._title

    @Property(str, notify=changed)
    def rendererName(self) -> str:
        return self._renderer_name

    @Property(int, notify=changed)
    def rowStart(self) -> int:
        return self._row_start

    @Property(int, notify=changed)
    def rowCount(self) -> int:
        return self._row_count

    @Property(int, notify=changed)
    def totalRowCount(self) -> int:
        return self._total_row_count

    @Property(int, notify=changed)
    def visibleColumnCount(self) -> int:
        return self._visible_column_count

    @Property(int, notify=changed)
    def sourceColumnCount(self) -> int:
        return self._source_column_count

    @Property(int, notify=changed)
    def sourceColumnStart(self) -> int:
        return self._source_column_start

    @Property(int, notify=changed)
    def sourceColumnEnd(self) -> int:
        return self._source_column_end

    @Property(str, notify=changed)
    def statusText(self) -> str:
        return self._status_text

    @Property(bool, notify=changed)
    def hasImage(self) -> bool:
        return not self._image.isNull()

    @Property(bool, notify=changed)
    def hasLineImage(self) -> bool:
        return not self._line_image.isNull()

    @Property(int, notify=changed)
    def lineGeometryRevision(self) -> int:
        return self._image_revision

    @Property(float, notify=changed)
    def cursorFraction(self) -> float:
        return self._cursor_fraction

    @Property(bool, notify=changed)
    def showHeatmapLayer(self) -> bool:
        return self._plot_layers.heatmap

    @Property(bool, notify=changed)
    def showLineLayer(self) -> bool:
        return self._plot_layers.line

    @Property(bool, notify=changed)
    def showCursorLayer(self) -> bool:
        return self._plot_layers.cursor

    @Property(bool, notify=changed)
    def showAnnotationsLayer(self) -> bool:
        return self._plot_layers.annotations

    @Property("QVariantList", notify=changed)
    def annotationItems(self) -> list[dict[str, object]]:
        return self._annotation_items

    @Property("QVariantMap", notify=changed)
    def theme(self) -> dict[str, str]:
        colors = current_theme_colors()
        return {
            "surface": colors.plot_surface,
            "surfaceAlt": colors.plot_surface_alt,
            "canvas": colors.plot_canvas,
            "text": colors.plot_text,
            "mutedText": colors.plot_muted_text,
            "border": colors.plot_border,
            "cursor": colors.plot_text,
            "annotationChannel": colors.annotation_channel,
            "annotationGlobal": colors.annotation_global,
        }


class _QuickBridgeTextureItem(QQuickItem):
    bridgeChanged = Signal()
    _log_surface = "texture"

    def __init__(self, parent: QQuickItem | None = None) -> None:
        super().__init__(parent)
        self._bridge: QuickPlotSurfaceBridge | None = None
        self._texture_revision = -1
        self.setFlag(QQuickItem.ItemHasContents, True)

    def bridge(self) -> QObject | None:
        return self._bridge

    def setBridge(self, bridge: QObject | None) -> None:
        next_bridge = bridge if isinstance(bridge, QuickPlotSurfaceBridge) else None
        if next_bridge is self._bridge:
            return
        if self._bridge is not None:
            try:
                self._bridge.changed.disconnect(self._on_bridge_changed)
            except RuntimeError:
                pass
        self._bridge = next_bridge
        self._texture_revision = -1
        if self._bridge is not None:
            self._bridge.changed.connect(self._on_bridge_changed)
        self.bridgeChanged.emit()
        self.update()

    bridge = Property(QObject, bridge, setBridge, notify=bridgeChanged)

    def _on_bridge_changed(self) -> None:
        self.update()

    def _image(self) -> QImage:
        return QImage()

    def updatePaintNode(
        self,
        old_node: QSGNode | None,
        update_data: QQuickItem.UpdatePaintNodeData | None,
    ) -> QSGNode | None:
        _ = update_data
        if self._bridge is None or self.window() is None:
            return None
        image = self._image()
        if image.isNull() or self.width() <= 0 or self.height() <= 0:
            return None

        revision = self._bridge.render_revision()
        node = old_node if isinstance(old_node, QSGSimpleTextureNode) else None
        if node is None:
            node = QSGSimpleTextureNode()
            node.setOwnsTexture(True)
        if revision != self._texture_revision:
            started_ns = perf_counter_ns()
            old_texture = node.texture()
            if old_texture is not None:
                node.setOwnsTexture(False)
            node.setTexture(self.window().createTextureFromImage(image))
            node.setOwnsTexture(True)
            if old_texture is not None:
                old_texture.deleteLater()
            node.markDirty(QSGNode.DirtyMaterial)
            self._texture_revision = revision
            _log_slow_texture_node_update(
                self._log_surface,
                started_ns,
                image_width=image.width(),
                image_height=image.height(),
                width=float(self.width()),
                height=float(self.height()),
            )
        node.setRect(QRectF(0.0, 0.0, self.width(), self.height()))
        return node


class QuickHeatmapTextureItem(_QuickBridgeTextureItem):
    _log_surface = "result_heatmap"

    def _image(self) -> QImage:
        return self._bridge.image() if self._bridge is not None else QImage()


class QuickLineTextureItem(_QuickBridgeTextureItem):
    _log_surface = "result_line"

    def _image(self) -> QImage:
        return self._bridge.line_image() if self._bridge is not None else QImage()


def quick_plot_surface_qml_path() -> Path:
    return Path(str(files("ddalab_app.ui.qml").joinpath("QuickPlotSurface.qml")))


def register_quick_plot_types() -> bool:
    global _QML_TYPES_REGISTERED
    if _QML_TYPES_REGISTERED:
        return True
    qmlRegisterType(
        QuickHeatmapTextureItem,
        _QML_MODULE,
        _QML_MAJOR_VERSION,
        _QML_MINOR_VERSION,
        "QuickHeatmapTextureItem",
    )
    qmlRegisterType(
        QuickLineTextureItem,
        _QML_MODULE,
        _QML_MAJOR_VERSION,
        _QML_MINOR_VERSION,
        "QuickLineTextureItem",
    )
    _QML_TYPES_REGISTERED = True
    return True


def update_quick_variant_bridge(
    bridge: QuickPlotSurfaceBridge,
    variant: DdaVariantResult,
    *,
    target_columns: int,
    title: str | None = None,
    color_scheme: str = "viridis",
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
    row_start: int = 0,
    row_count: int | None = None,
) -> None:
    provider = DdaVariantPlotProvider(
        variant,
        tile_cache=bridge.matrix_tile_cache(),
    )
    request = MatrixViewRequest(
        target_columns=target_columns,
        start_fraction=start_fraction,
        span_fraction=span_fraction,
        row_start=row_start,
        row_count=row_count,
    )
    matrix_started_ns = perf_counter_ns()
    view = provider.matrix_view(request)
    _log_slow_matrix_view_build(matrix_started_ns, view, request)
    bridge.set_matrix_view(
        view,
        title=title or variant.label,
        renderer_name="Qt Quick scene graph texture",
        color_scheme=color_scheme,
    )


def update_quick_heatmap_bridge(
    bridge: QuickPlotSurfaceBridge,
    variant: DdaVariantResult,
    *,
    target_columns: int,
    title: str | None = None,
    color_scheme: str = "viridis",
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
    row_start: int = 0,
    row_count: int | None = None,
) -> None:
    update_quick_variant_bridge(
        bridge,
        variant,
        target_columns=target_columns,
        title=title,
        color_scheme=color_scheme,
        start_fraction=start_fraction,
        span_fraction=span_fraction,
        row_start=row_start,
        row_count=row_count,
    )


def _log_slow_matrix_view_build(
    start_ns: int,
    view: MatrixView,
    request: MatrixViewRequest,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        "qml.matrix_view",
        "qml.matrix_view.build",
        duration_ms,
        threshold_ms=12.0,
        rows=view.source_row_count,
        rowStart=view.row_start,
        totalRows=view.total_row_count,
        sourceCols=view.source_column_count,
        sourceColStart=view.source_column_start,
        sourceColEnd=view.source_column_end,
        targetCols=view.target_column_count,
        rowCount=request.row_count,
        startFraction=request.start_fraction,
        spanFraction=request.span_fraction,
    )


def _log_render_cache_lookup(
    *,
    surface: str,
    hit: bool,
    entries: int,
    rows: int,
    row_start: int,
    total_rows: int,
    source_columns: int,
    source_column_start: int,
    source_column_end: int,
    target_columns: int,
    layers: PlotLayerConfig,
) -> None:
    perf_logger().log(
        "qml.render_cache.lookup",
        surface=surface,
        hit=hit,
        entries=entries,
        rows=rows,
        rowStart=row_start,
        totalRows=total_rows,
        sourceCols=source_columns,
        sourceColStart=source_column_start,
        sourceColEnd=source_column_end,
        targetCols=target_columns,
        layerHeatmap=layers.heatmap,
        layerLine=layers.line,
        layerAnnotations=layers.annotations,
        layerCursor=layers.cursor,
    )


def _log_slow_plot_build(kind: str, start_ns: int, view: MatrixView) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        f"qml.{kind}",
        f"qml.{kind}.build",
        duration_ms,
        threshold_ms=12.0,
        rows=view.source_row_count,
        rowStart=view.row_start,
        totalRows=view.total_row_count,
        sourceCols=view.source_column_count,
        targetCols=view.target_column_count,
    )


def _log_slow_texture_node_update(
    surface: str,
    start_ns: int,
    *,
    image_width: int,
    image_height: int,
    width: float,
    height: float,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        f"qml.scene_graph.{surface}",
        f"qml.scene_graph.{surface}.update",
        duration_ms,
        threshold_ms=8.0,
        imageWidth=image_width,
        imageHeight=image_height,
        width=round(width, 2),
        height=round(height, 2),
    )


def _normalize_cursor_fraction(fraction: float | None) -> float:
    if fraction is None:
        return -1.0
    try:
        numeric = float(fraction)
    except (TypeError, ValueError):
        return -1.0
    if not math.isfinite(numeric) or numeric < 0.0:
        return -1.0
    return max(0.0, min(1.0, numeric))


def _result_annotation_items(
    annotations: Sequence[WaveformAnnotation],
    row_labels: Sequence[str],
    visible_range: tuple[float, float] | None,
) -> list[dict[str, object]]:
    if visible_range is None or visible_range[1] <= visible_range[0]:
        return []
    start_seconds, end_seconds = visible_range
    duration = end_seconds - start_seconds
    row_lookup = {label: index for index, label in enumerate(row_labels)}
    row_count = max(len(row_labels), 1)
    items: list[dict[str, object]] = []
    for annotation in annotations:
        channel_name = annotation.channel_name or ""
        if channel_name and channel_name not in row_lookup:
            continue
        row = row_lookup.get(channel_name, 0)
        height = 1.0 / row_count if channel_name else 1.0
        y = row / row_count if channel_name else 0.0
        if annotation.is_range and annotation.end_seconds is not None:
            left = max(float(annotation.start_seconds), start_seconds)
            right = min(float(annotation.end_seconds), end_seconds)
            if right <= left:
                continue
            items.append(
                {
                    "x": (left - start_seconds) / duration,
                    "width": (right - left) / duration,
                    "y": y,
                    "height": height,
                    "channelName": channel_name,
                }
            )
            continue
        timestamp = float(annotation.center_seconds)
        if start_seconds <= timestamp <= end_seconds:
            items.append(
                {
                    "x": (timestamp - start_seconds) / duration,
                    "width": 0.0,
                    "y": y,
                    "height": height,
                    "channelName": channel_name,
                }
            )
    return items


def _result_annotation_at(
    annotations: Sequence[WaveformAnnotation],
    channel_name: str | None,
    seconds: float,
    visible_range: tuple[float, float] | None,
) -> WaveformAnnotation | None:
    if visible_range is None:
        return None
    threshold = max((visible_range[1] - visible_range[0]) / 200.0, 0.05)
    closest = None
    best_distance = float("inf")
    for annotation in annotations:
        if (
            annotation.channel_name is not None
            and annotation.channel_name != channel_name
        ):
            continue
        if annotation.is_range and annotation.end_seconds is not None:
            if (
                annotation.start_seconds - threshold
                <= seconds
                <= annotation.end_seconds + threshold
            ):
                return annotation
            distance = min(
                abs(seconds - annotation.start_seconds),
                abs(seconds - annotation.end_seconds),
            )
        else:
            distance = abs(seconds - annotation.center_seconds)
        if distance <= threshold and distance < best_distance:
            closest = annotation
            best_distance = distance
    return closest
