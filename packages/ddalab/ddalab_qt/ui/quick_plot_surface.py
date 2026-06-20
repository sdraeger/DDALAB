from __future__ import annotations

import math
import os
from importlib.resources import files
from pathlib import Path
from time import perf_counter_ns
from typing import Mapping

from PySide6.QtCore import Property, QObject, QRectF, QSize, QUrl, Signal
from PySide6.QtGui import QImage
from PySide6.QtQml import qmlRegisterType
from PySide6.QtQuick import (
    QQuickImageProvider,
    QQuickItem,
    QSGNode,
    QSGSimpleTextureNode,
)
from PySide6.QtQuickWidgets import QQuickWidget
from PySide6.QtWidgets import QWidget

from ..app.perf_logging import perf_logger
from ..domain.models import DdaVariantResult
from .plot_data import (
    DdaVariantPlotProvider,
    LineGeometryView,
    MatrixView,
    MatrixViewRenderKey,
    MatrixViewRequest,
    matrix_view_render_key,
)
from .plot_layers import PlotLayerConfig
from .qt_scene_graph import line_geometry_node
from .qt_plot_renderer import (
    MatrixPlotRenderer,
    MatrixRenderArtifacts,
    QtCpuMatrixPlotRenderer,
)
from .render_cache import LruRenderCache

_IMAGE_PROVIDER_NAME = "ddalab-plot"
_QML_MODULE = "DDALAB.Plots"
_QML_MAJOR_VERSION = 1
_QML_MINOR_VERSION = 0
_QML_TYPES_REGISTERED = False
_RENDER_CACHE_CAPACITY = 8


class QuickPlotSurfaceBridge(QObject):
    changed = Signal()

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
        self._status_text = "No plot data loaded"
        self._image_revision = 0
        self._image = QImage()
        self._line_geometry = _empty_line_geometry()
        self._cursor_fraction = -1.0
        self._plot_layers = PlotLayerConfig()
        self._active_render_key: MatrixViewRenderKey | None = None
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
        self._status_text = "No plot data loaded"
        self._image = QImage()
        self._line_geometry = _empty_line_geometry()
        self._cursor_fraction = -1.0
        self._active_render_key = None
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
            target_columns=view.target_column_count,
            layers=self._plot_layers,
        )
        self._image = artifacts.image
        self._line_geometry = artifacts.line_geometry
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

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        if layers == self._plot_layers:
            return False
        self._plot_layers = layers
        self.changed.emit()
        return True

    def image(self) -> QImage:
        return self._image

    def line_geometry(self) -> LineGeometryView:
        return self._line_geometry

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

    @Property(str, notify=changed)
    def statusText(self) -> str:
        return self._status_text

    @Property(str, notify=changed)
    def imageSource(self) -> str:
        if self._image.isNull():
            return ""
        return f"image://{_IMAGE_PROVIDER_NAME}/heatmap-{self._image_revision}"

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


class QuickHeatmapImageProvider(QQuickImageProvider):
    def __init__(self, bridge: QuickPlotSurfaceBridge) -> None:
        super().__init__(QQuickImageProvider.Image)
        self._bridge = bridge

    def requestImage(
        self,
        image_id: str,
        size: QSize | None,
        requested_size: QSize | None,
    ) -> tuple[QImage, QSize]:
        started_ns = perf_counter_ns()
        image = self._bridge.image()
        if image.isNull():
            image = QImage(1, 1, QImage.Format_RGBA8888)
            image.fill(0)
        if requested_size is not None and requested_size.isValid():
            image = image.scaled(requested_size)
        image_size = image.size()
        _log_slow_heatmap_provider_request(
            started_ns,
            image_id=image_id,
            image_size=image_size,
            requested_size=requested_size,
        )
        return image, image_size


class _QuickBridgeTextureItem(QQuickItem):
    bridgeChanged = Signal()

    def __init__(self, parent: QQuickItem | None = None) -> None:
        super().__init__(parent)
        self._bridge: QuickPlotSurfaceBridge | None = None
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

        node = old_node if isinstance(old_node, QSGSimpleTextureNode) else None
        if node is None:
            node = QSGSimpleTextureNode()
            node.setOwnsTexture(True)
        texture = self.window().createTextureFromImage(image)
        node.setTexture(texture)
        node.setRect(QRectF(0.0, 0.0, self.width(), self.height()))
        return node


class QuickHeatmapTextureItem(_QuickBridgeTextureItem):
    def _image(self) -> QImage:
        return self._bridge.image() if self._bridge is not None else QImage()


class QuickLineGeometryItem(QQuickItem):
    bridgeChanged = Signal()

    def __init__(self, parent: QQuickItem | None = None) -> None:
        super().__init__(parent)
        self._bridge: QuickPlotSurfaceBridge | None = None
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
        if self._bridge is not None:
            self._bridge.changed.connect(self._on_bridge_changed)
        self.bridgeChanged.emit()
        self.update()

    bridge = Property(QObject, bridge, setBridge, notify=bridgeChanged)

    def _on_bridge_changed(self) -> None:
        self.update()

    def updatePaintNode(
        self,
        old_node: QSGNode | None,
        update_data: QQuickItem.UpdatePaintNodeData | None,
    ) -> QSGNode | None:
        _ = update_data
        if self._bridge is None or self.width() <= 0 or self.height() <= 0:
            return None
        geometry = self._bridge.line_geometry()
        if not geometry.lines:
            return None
        started_ns = perf_counter_ns()
        root = old_node if isinstance(old_node, QSGNode) else QSGNode()
        root.removeAllChildNodes()
        width = float(self.width())
        height = float(self.height())
        node_count = 0
        vertex_count = 0
        for line, color in zip(geometry.lines, geometry.colors):
            if len(line) < 2:
                continue
            root.appendChildNode(line_geometry_node(line, color, width, height))
            node_count += 1
            vertex_count += len(line)
        _log_slow_scene_graph_update(
            "result_line",
            started_ns,
            nodes=node_count,
            vertices=vertex_count,
            width=width,
            height=height,
        )
        return root if root.childCount() else None


def quick_plot_surface_qml_path() -> Path:
    return Path(str(files("ddalab_qt.ui.qml").joinpath("QuickPlotSurface.qml")))


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
        QuickLineGeometryItem,
        _QML_MODULE,
        _QML_MAJOR_VERSION,
        _QML_MINOR_VERSION,
        "QuickLineGeometryItem",
    )
    _QML_TYPES_REGISTERED = True
    return True


def quick_plots_enabled(environ: Mapping[str, str] | None = None) -> bool:
    env = os.environ if environ is None else environ
    value = env.get("DDALAB_ENABLE_QML_PLOTS")
    if value is None:
        return True
    normalized = value.strip().lower()
    if normalized in {"0", "false", "no", "off"}:
        return False
    return normalized in {"", "1", "true", "yes", "on"}


def create_quick_plot_surface_widget(
    bridge: QuickPlotSurfaceBridge,
    parent: QWidget | None = None,
) -> QQuickWidget:
    widget = QQuickWidget(parent)
    widget.ddalabSceneGraphTypesRegistered = register_quick_plot_types()
    widget.setResizeMode(QQuickWidget.SizeRootObjectToView)
    widget.rootContext().setContextProperty("plotBridge", bridge)
    widget.ddalabImageProvider = QuickHeatmapImageProvider(bridge)
    widget.engine().addImageProvider(_IMAGE_PROVIDER_NAME, widget.ddalabImageProvider)
    widget.setSource(QUrl.fromLocalFile(str(quick_plot_surface_qml_path())))
    return widget


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
    provider = DdaVariantPlotProvider(variant)
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
        targetCols=target_columns,
        layerHeatmap=layers.heatmap,
        layerLine=layers.line,
        layerAnnotations=layers.annotations,
        layerCursor=layers.cursor,
    )


def _log_slow_heatmap_provider_request(
    start_ns: int,
    *,
    image_id: str,
    image_size: QSize,
    requested_size: QSize | None,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    requested_width = requested_size.width() if requested_size is not None else None
    requested_height = requested_size.height() if requested_size is not None else None
    perf_logger().log_slow(
        "qml.heatmap_provider",
        "qml.heatmap_provider.request",
        duration_ms,
        threshold_ms=8.0,
        imageId=image_id,
        width=image_size.width(),
        height=image_size.height(),
        requestedWidth=requested_width,
        requestedHeight=requested_height,
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


def _log_slow_scene_graph_update(
    surface: str,
    start_ns: int,
    *,
    nodes: int,
    vertices: int,
    width: float,
    height: float,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        f"qml.scene_graph.{surface}",
        f"qml.scene_graph.{surface}.update",
        duration_ms,
        threshold_ms=8.0,
        nodes=nodes,
        vertices=vertices,
        width=round(width, 2),
        height=round(height, 2),
    )


def _empty_line_geometry() -> LineGeometryView:
    return LineGeometryView(
        lines=(),
        colors=(),
        source_row_count=0,
        source_column_count=0,
        target_column_count=0,
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
