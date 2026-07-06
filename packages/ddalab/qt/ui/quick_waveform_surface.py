from __future__ import annotations

from importlib.resources import files
from pathlib import Path
from time import perf_counter_ns
from typing import Sequence

from PySide6.QtCore import Property, QObject, QUrl, Signal
from PySide6.QtQml import qmlRegisterType
from PySide6.QtQuick import QQuickItem, QSGNode
from PySide6.QtQuickWidgets import QQuickWidget
from PySide6.QtWidgets import QWidget

from ..app.runtime.perf_logging import perf_logger
from ..domain.models import WaveformAnnotation, WaveformWindow
from .plot_data import (
    WaveformGeometryView,
    WaveformRenderKey,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
)
from .plot_layers import PlotLayerConfig
from .qt_plot_renderer import (
    QtSceneGraphWaveformRenderer,
    WaveformPlotRenderer,
    WaveformRenderArtifacts,
)
from .qt_scene_graph import line_geometry_node
from .render_cache import LruRenderCache
from .style import current_theme_colors

_QML_MODULE = "DDALAB.Plots"
_QML_MAJOR_VERSION = 1
_QML_MINOR_VERSION = 0
_QML_TYPES_REGISTERED = False
_RENDER_CACHE_CAPACITY = 8


class QuickWaveformSurfaceBridge(QObject):
    changed = Signal()

    def __init__(
        self,
        parent: QObject | None = None,
        *,
        renderer: WaveformPlotRenderer | None = None,
    ) -> None:
        super().__init__(parent)
        self._renderer = renderer or QtSceneGraphWaveformRenderer()
        self._title = "DDALAB waveform"
        self._renderer_name = self._renderer.name
        self._status_text = "No waveform loaded"
        self._geometry_revision = 0
        self._geometry = _empty_waveform_geometry()
        self._annotations: list[WaveformAnnotation] = []
        self._annotation_items: list[dict[str, object]] = []
        self._visible_start_seconds = 0.0
        self._visible_duration_seconds = 0.0
        self._plot_layers = PlotLayerConfig()
        self._active_render_key: WaveformRenderKey | None = None
        self._render_cache = LruRenderCache[
            WaveformRenderKey,
            WaveformRenderArtifacts,
        ](_RENDER_CACHE_CAPACITY)

    def clear(self) -> None:
        self._title = "DDALAB waveform"
        self._status_text = "No waveform loaded"
        self._geometry = _empty_waveform_geometry()
        self._annotations = []
        self._annotation_items = []
        self._visible_start_seconds = 0.0
        self._visible_duration_seconds = 0.0
        self._active_render_key = None
        self._render_cache.clear()
        self._geometry_revision += 1
        self.changed.emit()

    def set_waveform_window(
        self,
        window: WaveformWindow,
        *,
        title: str,
        target_width: int,
    ) -> None:
        self.set_waveform_provider(
            WaveformWindowPlotProvider(window),
            WaveformViewRequest(target_width=target_width),
            title=title,
        )

    def set_waveform_provider(
        self,
        provider: WaveformWindowPlotProvider,
        request: WaveformViewRequest,
        *,
        title: str,
    ) -> None:
        normalized_target_width = max(1, int(request.target_width))
        request = WaveformViewRequest(
            target_width=normalized_target_width,
            channel_start=request.channel_start,
            channel_count=request.channel_count,
            start_fraction=request.start_fraction,
            span_fraction=request.span_fraction,
        )
        render_key = provider.render_key(request)
        artifacts = self._render_cache.get(render_key)
        cache_hit = artifacts is not None
        if artifacts is None:
            started_ns = perf_counter_ns()
            artifacts = self._renderer.render(provider, request)
            _log_slow_waveform_renderer_build(started_ns, artifacts.geometry)
            self._render_cache.put(render_key, artifacts)
        _log_render_cache_lookup(
            hit=cache_hit,
            entries=self._render_cache.size,
            geometry=artifacts.geometry,
            request=request,
            layers=self._plot_layers,
        )
        self._geometry = artifacts.geometry
        self._visible_start_seconds, self._visible_duration_seconds = (
            _visible_waveform_time_window(provider.window, request)
        )
        self._annotation_items = _waveform_annotation_items(
            self._annotations,
            self._geometry,
            start_seconds=self._visible_start_seconds,
            duration_seconds=self._visible_duration_seconds,
        )
        if render_key != self._active_render_key:
            self._active_render_key = render_key
            self._geometry_revision += 1
        self._title = title
        self._renderer_name = self._renderer.name
        self._status_text = (
            f"{self._channel_status_text()}, "
            f"{self._geometry.sample_count} visible samples"
        )
        self.changed.emit()

    def waveform_geometry(self) -> WaveformGeometryView:
        return self._geometry

    def set_annotations(self, annotations: Sequence[WaveformAnnotation]) -> bool:
        self._annotations = list(annotations)
        next_items = _waveform_annotation_items(
            self._annotations,
            self._geometry,
            start_seconds=self._visible_start_seconds,
            duration_seconds=self._visible_duration_seconds,
        )
        if next_items == self._annotation_items:
            return False
        self._annotation_items = next_items
        self.changed.emit()
        return True

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        if layers == self._plot_layers:
            return False
        self._plot_layers = layers
        self.changed.emit()
        return True

    def refresh_theme(self) -> None:
        self.changed.emit()

    @Property(str, notify=changed)
    def title(self) -> str:
        return self._title

    @Property(str, notify=changed)
    def rendererName(self) -> str:
        return self._renderer_name

    @Property(str, notify=changed)
    def statusText(self) -> str:
        return self._status_text

    @Property(int, notify=changed)
    def channelStart(self) -> int:
        return self._geometry.channel_start

    @Property(int, notify=changed)
    def channelCount(self) -> int:
        return self._geometry.channel_count

    @Property(int, notify=changed)
    def totalChannelCount(self) -> int:
        return self._geometry.total_channel_count

    @Property(int, notify=changed)
    def geometryRevision(self) -> int:
        return self._geometry_revision

    @Property(bool, notify=changed)
    def showWaveformLayer(self) -> bool:
        return self._plot_layers.waveform

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
            "annotationChannel": colors.annotation_channel,
            "annotationGlobal": colors.annotation_global,
        }

    def _channel_status_text(self) -> str:
        if (
            self._geometry.total_channel_count != self._geometry.channel_count
            or self._geometry.channel_start != 0
        ):
            return (
                f"{self._geometry.channel_count} channels from channel "
                f"{self._geometry.channel_start + 1} of "
                f"{self._geometry.total_channel_count}"
            )
        return f"{self._geometry.channel_count} channels"


class QuickWaveformGeometryItem(QQuickItem):
    bridgeChanged = Signal()

    def __init__(self, parent: QQuickItem | None = None) -> None:
        super().__init__(parent)
        self._bridge: QuickWaveformSurfaceBridge | None = None
        self.setFlag(QQuickItem.ItemHasContents, True)

    def bridge(self) -> QObject | None:
        return self._bridge

    def setBridge(self, bridge: QObject | None) -> None:
        next_bridge = bridge if isinstance(bridge, QuickWaveformSurfaceBridge) else None
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
        geometry = self._bridge.waveform_geometry()
        if not geometry.lines:
            return None
        started_ns = perf_counter_ns()
        root = old_node if isinstance(old_node, QSGNode) else QSGNode()
        root.removeAllChildNodes()
        width = float(self.width())
        height = float(self.height())
        node_count = 0
        vertex_count = 0
        for line, color, draw_mode in zip(
            geometry.lines,
            geometry.colors,
            geometry.draw_modes,
        ):
            if len(line) < 2:
                continue
            root.appendChildNode(
                line_geometry_node(
                    line,
                    color,
                    width,
                    height,
                    draw_mode=draw_mode,
                    line_width=1.0,
                )
            )
            node_count += 1
            vertex_count += len(line)
        _log_slow_scene_graph_update(
            started_ns,
            nodes=node_count,
            vertices=vertex_count,
            width=width,
            height=height,
        )
        return root if root.childCount() else None


def quick_waveform_surface_qml_path() -> Path:
    return Path(str(files("qt.ui.qml").joinpath("QuickWaveformSurface.qml")))


def register_quick_waveform_types() -> bool:
    global _QML_TYPES_REGISTERED
    if _QML_TYPES_REGISTERED:
        return True
    qmlRegisterType(
        QuickWaveformGeometryItem,
        _QML_MODULE,
        _QML_MAJOR_VERSION,
        _QML_MINOR_VERSION,
        "QuickWaveformGeometryItem",
    )
    _QML_TYPES_REGISTERED = True
    return True


def create_quick_waveform_surface_widget(
    bridge: QuickWaveformSurfaceBridge,
    parent: QWidget | None = None,
) -> QQuickWidget:
    widget = QQuickWidget(parent)
    widget.ddalabWaveformSceneGraphTypesRegistered = register_quick_waveform_types()
    widget.setResizeMode(QQuickWidget.SizeRootObjectToView)
    widget.rootContext().setContextProperty("waveformBridge", bridge)
    widget.setSource(QUrl.fromLocalFile(str(quick_waveform_surface_qml_path())))
    return widget


def update_quick_waveform_bridge(
    bridge: QuickWaveformSurfaceBridge,
    window: WaveformWindow,
    *,
    target_width: int,
    title: str | None = None,
    channel_start: int = 0,
    channel_count: int | None = None,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
) -> None:
    provider = WaveformWindowPlotProvider(window)
    bridge.set_waveform_provider(
        provider,
        WaveformViewRequest(
            target_width=target_width,
            channel_start=channel_start,
            channel_count=channel_count,
            start_fraction=start_fraction,
            span_fraction=span_fraction,
        ),
        title=title or "Waveform",
    )


def _log_render_cache_lookup(
    *,
    hit: bool,
    entries: int,
    geometry: WaveformGeometryView,
    request: WaveformViewRequest,
    layers: PlotLayerConfig,
) -> None:
    perf_logger().log(
        "qml.render_cache.lookup",
        surface="waveform",
        hit=hit,
        entries=entries,
        channels=geometry.channel_count,
        channelStart=geometry.channel_start,
        totalChannels=geometry.total_channel_count,
        samples=geometry.sample_count,
        targetWidth=request.target_width,
        startFraction=request.start_fraction,
        spanFraction=request.span_fraction,
        channelCount=request.channel_count,
        layerWaveform=layers.waveform,
        layerAnnotations=layers.annotations,
    )


def _log_slow_waveform_renderer_build(
    start_ns: int,
    geometry: WaveformGeometryView,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        "qml.waveform_renderer",
        "qml.waveform_renderer.build",
        duration_ms,
        threshold_ms=12.0,
        channels=geometry.channel_count,
        channelStart=geometry.channel_start,
        totalChannels=geometry.total_channel_count,
        samples=geometry.sample_count,
    )


def _log_slow_scene_graph_update(
    start_ns: int,
    *,
    nodes: int,
    vertices: int,
    width: float,
    height: float,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        "qml.scene_graph.waveform",
        "qml.scene_graph.waveform.update",
        duration_ms,
        threshold_ms=8.0,
        nodes=nodes,
        vertices=vertices,
        width=round(width, 2),
        height=round(height, 2),
    )


def _empty_waveform_geometry() -> WaveformGeometryView:
    return WaveformGeometryView(
        lines=(),
        colors=(),
        draw_modes=(),
        channel_labels=(),
        channel_count=0,
        sample_count=0,
        channel_start=0,
        total_channel_count=0,
    )


def _visible_waveform_time_window(
    window: WaveformWindow | None,
    request: WaveformViewRequest,
) -> tuple[float, float]:
    start_fraction = max(0.0, min(1.0, float(request.start_fraction)))
    span_fraction = max(0.0, min(1.0 - start_fraction, float(request.span_fraction)))
    window_start = float(getattr(window, "start_time_seconds", 0.0) or 0.0)
    window_duration = max(float(getattr(window, "duration_seconds", 0.0) or 0.0), 0.0)
    return (
        window_start + window_duration * start_fraction,
        window_duration * span_fraction,
    )


def _waveform_annotation_items(
    annotations: Sequence[WaveformAnnotation],
    geometry: WaveformGeometryView,
    *,
    start_seconds: float,
    duration_seconds: float,
) -> list[dict[str, object]]:
    if duration_seconds <= 0.0 or geometry.channel_count <= 0:
        return []
    labels = tuple(geometry.channel_labels)
    label_to_index = {label: index for index, label in enumerate(labels)}
    visible_end = start_seconds + duration_seconds
    items: list[dict[str, object]] = []
    for annotation in annotations:
        channel_name = annotation.channel_name or ""
        if channel_name and channel_name not in label_to_index:
            continue
        row_index = label_to_index[channel_name] if channel_name else 0
        row_count = 1 if channel_name else geometry.channel_count
        item = _waveform_annotation_item(
            annotation,
            start_seconds=start_seconds,
            end_seconds=visible_end,
            duration_seconds=duration_seconds,
            y=row_index / max(geometry.channel_count, 1),
            height=row_count / max(geometry.channel_count, 1),
        )
        if item is not None:
            items.append(item)
    return items


def _waveform_annotation_item(
    annotation: WaveformAnnotation,
    *,
    start_seconds: float,
    end_seconds: float,
    duration_seconds: float,
    y: float,
    height: float,
) -> dict[str, object] | None:
    channel_name = annotation.channel_name or ""
    if annotation.is_range and annotation.end_seconds is not None:
        item_start = max(float(annotation.start_seconds), start_seconds)
        item_end = min(float(annotation.end_seconds), end_seconds)
        if (
            item_end < start_seconds
            or item_start > end_seconds
            or item_end <= item_start
        ):
            return None
        return {
            "x": (item_start - start_seconds) / duration_seconds,
            "width": (item_end - item_start) / duration_seconds,
            "y": y,
            "height": height,
            "label": annotation.label,
            "channelName": channel_name,
        }
    timestamp = float(annotation.center_seconds)
    if timestamp < start_seconds or timestamp > end_seconds:
        return None
    return {
        "x": (timestamp - start_seconds) / duration_seconds,
        "width": 0.0,
        "y": y,
        "height": height,
        "label": annotation.label,
        "channelName": channel_name,
    }
