package org.ddalab.kmp

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.onPointerEvent
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun WaveformWorkspace(
    modifier: Modifier,
    dataset: LoadedDataset,
    selectedChannels: List<String>,
    window: WaveformWindow?,
    overview: WaveformOverview?,
    viewportStartSeconds: Double,
    viewportDurationSeconds: Double,
    isWaveformLoading: Boolean,
    isOverviewLoading: Boolean,
    waveformErrorMessage: String?,
    onViewportChange: (Double, Double) -> Unit,
) {
    var startSeconds by remember(dataset.filePath) { mutableFloatStateOf(viewportStartSeconds.toFloat()) }
    var windowSeconds by remember(dataset.filePath) { mutableFloatStateOf(viewportDurationSeconds.toFloat()) }

    LaunchedEffect(dataset.filePath, viewportStartSeconds, viewportDurationSeconds) {
        if (abs(startSeconds - viewportStartSeconds.toFloat()) > 0.001f) {
            startSeconds = viewportStartSeconds.toFloat()
        }
        if (abs(windowSeconds - viewportDurationSeconds.toFloat()) > 0.001f) {
            windowSeconds = viewportDurationSeconds.toFloat()
        }
    }

    LaunchedEffect(dataset.filePath, selectedChannels, startSeconds, windowSeconds) {
        delay(120)
        if (
            abs(startSeconds - viewportStartSeconds.toFloat()) > 0.001f ||
            abs(windowSeconds - viewportDurationSeconds.toFloat()) > 0.001f
        ) {
            onViewportChange(startSeconds.toDouble(), windowSeconds.toDouble())
        }
    }

    val metadataChannels = remember(dataset, selectedChannels) {
        dataset.channels.filter { selectedChannels.contains(it.name) }
    }
    val renderedChannels = window?.channels ?: emptyList()
    val overviewChannel = overview?.channels?.firstOrNull()

    val maxStart = max(0f, dataset.durationSeconds.toFloat() - windowSeconds)
    if (startSeconds > maxStart) {
        startSeconds = maxStart
    }

    fun applyCenteredZoom(targetWindowSeconds: Float) {
        val datasetDuration = dataset.durationSeconds.toFloat().coerceAtLeast(0.5f)
        val nextWindowSeconds = targetWindowSeconds.coerceIn(0.5f, datasetDuration)
        val currentCenter = startSeconds + (windowSeconds / 2f)
        val maxNextStart = max(0f, datasetDuration - nextWindowSeconds)
        startSeconds = (currentCenter - (nextWindowSeconds / 2f)).coerceIn(0f, maxNextStart)
        windowSeconds = nextWindowSeconds
    }

    Surface(
        modifier = modifier,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline.copy(alpha = 0.75f),
        ),
    ) {
        if (selectedChannels.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Select at least one channel to draw the waveform viewport.")
            }
        } else {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                val outlineColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)
                val primaryLineColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.92f)
                val secondaryLineColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.88f)
                val viewportFill = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                val viewportStroke = MaterialTheme.colorScheme.primary

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Waveform viewport", style = MaterialTheme.typography.titleLarge)
                        Text(
                            if (dataset.supportsWindowedAccess) {
                                "Windowed mode: only the visible EDF range is read, cached, and rendered."
                            } else {
                                "In-memory mode: the signal buffer is already local, but rendering still uses envelope levels."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                applyCenteredZoom(windowSeconds * 1.5f)
                            },
                        ) {
                            Text("Zoom Out")
                        }
                        OutlinedButton(
                            onClick = {
                                applyCenteredZoom(windowSeconds * 0.7f)
                            },
                        ) {
                            Text("Zoom In")
                        }
                        Button(
                            onClick = {
                                startSeconds = 0f
                                windowSeconds = min(
                                    max(dataset.durationSeconds.toFloat() * 0.15f, 5f),
                                    dataset.durationSeconds.toFloat().coerceAtLeast(5f),
                                )
                            },
                        ) {
                            Text("Reset")
                        }
                    }
                }

                Text(
                    "Showing ${formatCompact(startSeconds.toDouble())}s - ${formatCompact((startSeconds + windowSeconds).toDouble())}s of ${humanizeDuration(dataset.durationSeconds)}",
                    color = MaterialTheme.colorScheme.secondary,
                    style = MaterialTheme.typography.bodyMedium,
                )

                waveformErrorMessage?.let { message ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.error.copy(alpha = 0.10f),
                        border = BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.error.copy(alpha = 0.2f),
                        ),
                    ) {
                        Text(
                            text = message,
                            modifier = Modifier.padding(14.dp),
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }

                Row(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Column(
                        modifier = Modifier.width(140.dp).fillMaxHeight(),
                        verticalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        metadataChannels.forEach { channel ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.32f),
                                border = BorderStroke(
                                    1.dp,
                                    MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                                ),
                            ) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    Text(channel.name, style = MaterialTheme.typography.bodyMedium)
                                    Text(
                                        "${formatCompact(channel.sampleRateHz)} Hz • ${channel.sampleCount} samples",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.64f),
                                    )
                                }
                            }
                        }
                    }
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f)),
                    ) {
                        if (renderedChannels.isEmpty()) {
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text(
                                    if (isWaveformLoading) "Loading visible chunk..." else "No waveform chunk loaded yet.",
                                )
                            }
                        } else {
                            val loadedWindow = window ?: return@Box
                            Canvas(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .pointerInput(renderedChannels, startSeconds, windowSeconds) {
                                        detectDragGestures { change, dragAmount ->
                                            change.consume()
                                            val secondsPerPixel = windowSeconds / size.width.toFloat().coerceAtLeast(1f)
                                            startSeconds = (startSeconds - dragAmount.x * secondsPerPixel)
                                                .coerceIn(0f, max(0f, dataset.durationSeconds.toFloat() - windowSeconds))
                                        }
                                    }
                                    .onPointerEvent(PointerEventType.Scroll) { event ->
                                        val delta = event.changes.firstOrNull()?.scrollDelta?.y ?: 0f
                                        if (delta == 0f) return@onPointerEvent
                                        val factor = if (delta > 0f) 1.15f else 0.85f
                                        applyCenteredZoom(windowSeconds * factor)
                                    },
                            ) {
                                val channelHeight = size.height / renderedChannels.size
                                renderedChannels.forEachIndexed { index, channel ->
                                    val top = index * channelHeight
                                    val bottom = top + channelHeight
                                    val centerY = top + channelHeight / 2f
                                    val innerTop = top + 8f
                                    val innerBottom = bottom - 8f
                                    drawLine(
                                        color = outlineColor,
                                        start = Offset(0f, centerY),
                                        end = Offset(size.width, centerY),
                                        strokeWidth = 1f,
                                    )
                                    drawChannelWaveform(
                                        channel = channel,
                                        viewportStartSec = loadedWindow.startTimeSeconds,
                                        viewportDurationSec = loadedWindow.durationSeconds,
                                        widthPx = size.width,
                                        topPx = innerTop,
                                        bottomPx = innerBottom,
                                        lineColor = primaryLineColor,
                                    )
                                }
                            }
                        }

                        if (isWaveformLoading) {
                            Surface(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(12.dp),
                                shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
                            ) {
                                Text(
                                    text = "Loading chunk…",
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                    }
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.18f)),
                ) {
                    if (overviewChannel == null) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(if (isOverviewLoading) "Building overview..." else "Overview unavailable")
                        }
                    } else {
                        Canvas(
                            modifier = Modifier
                                .fillMaxSize()
                                .pointerInput(dataset.filePath, startSeconds, windowSeconds) {
                                    detectTapGestures { pointer ->
                                        val fraction = (pointer.x / size.width.toFloat().coerceAtLeast(1f)).coerceIn(0f, 1f)
                                        val centered = dataset.durationSeconds.toFloat() * fraction - (windowSeconds / 2f)
                                        startSeconds = centered.coerceIn(0f, max(0f, dataset.durationSeconds.toFloat() - windowSeconds))
                                    }
                                },
                        ) {
                            drawOverviewChannel(
                                channel = overviewChannel,
                                overviewDurationSec = overview.durationSeconds,
                                widthPx = size.width,
                                topPx = 8f,
                                bottomPx = size.height - 8f,
                                lineColor = secondaryLineColor,
                            )
                            val left = if (dataset.durationSeconds <= 0.0) 0f
                            else (startSeconds / dataset.durationSeconds.toFloat()) * size.width
                            val viewportWidth = if (dataset.durationSeconds <= 0.0) size.width
                            else (windowSeconds / dataset.durationSeconds.toFloat()) * size.width
                            drawRect(
                                color = viewportFill,
                                topLeft = Offset(left, 0f),
                                size = Size(viewportWidth.coerceAtMost(size.width), size.height),
                            )
                            drawRect(
                                color = viewportStroke,
                                topLeft = Offset(left, 0f),
                                size = Size(viewportWidth.coerceAtMost(size.width), size.height),
                                style = Stroke(width = 2f),
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawChannelWaveform(
    channel: ChannelWaveform,
    viewportStartSec: Double,
    viewportDurationSec: Double,
    widthPx: Float,
    topPx: Float,
    bottomPx: Float,
    lineColor: Color,
) {
    if (channel.samples.isEmpty() || channel.sampleRateHz <= 0.0 || viewportDurationSec <= 0.0) return

    val visibleSamples = channel.samples.size.coerceAtLeast(1)
    val range = (channel.maxValue - channel.minValue).takeIf { it > 1e-6f } ?: 1f

    fun mapY(value: Double): Float {
        val normalized = ((value.toFloat() - channel.minValue) / range).coerceIn(0f, 1f)
        return bottomPx - normalized * (bottomPx - topPx)
    }

    if (visibleSamples <= widthPx * 2f) {
        val path = Path()
        val stride = max(1, visibleSamples / widthPx.toInt().coerceAtLeast(1))
        var first = true
        for (index in 0 until visibleSamples step stride) {
            val relative = index / visibleSamples.toFloat()
            val x = relative * widthPx
            val y = mapY(channel.samples[index])
            if (first) {
                path.moveTo(x, y)
                first = false
            } else {
                path.lineTo(x, y)
            }
        }
        drawPath(path = path, color = lineColor, style = Stroke(width = 1.5f))
        return
    }

    val idealBucket = max(1, visibleSamples / widthPx.toInt().coerceAtLeast(1))
    val level = channel.levels.lastOrNull { it.bucketSize <= idealBucket } ?: channel.levels.first()
    val bucketCount = level.mins.size.coerceAtLeast(1)
    for (bucket in 0 until bucketCount) {
        val x = (bucket / bucketCount.toFloat()) * widthPx
        drawLine(
            color = lineColor,
            start = Offset(x, mapY(level.maxs[bucket].toDouble())),
            end = Offset(x, mapY(level.mins[bucket].toDouble())),
            strokeWidth = 1f,
        )
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawOverviewChannel(
    channel: WaveformOverviewChannel,
    overviewDurationSec: Double,
    widthPx: Float,
    topPx: Float,
    bottomPx: Float,
    lineColor: Color,
) {
    if (channel.mins.isEmpty() || channel.maxs.isEmpty() || overviewDurationSec <= 0.0) return
    val range = (channel.maxValue - channel.minValue).takeIf { it > 1e-6f } ?: 1f

    fun mapY(value: Float): Float {
        val normalized = ((value - channel.minValue) / range).coerceIn(0f, 1f)
        return bottomPx - normalized * (bottomPx - topPx)
    }

    val bucketCount = min(channel.mins.size, channel.maxs.size)
    for (bucket in 0 until bucketCount) {
        val time = bucket * channel.bucketDurationSeconds
        val x = ((time / overviewDurationSec) * widthPx).toFloat().coerceIn(0f, widthPx)
        drawLine(
            color = lineColor,
            start = Offset(x, mapY(channel.maxs[bucket])),
            end = Offset(x, mapY(channel.mins[bucket])),
            strokeWidth = 1f,
        )
    }
}

@Composable
fun VariantHeatmap(
    modifier: Modifier,
    variant: DdaVariantSnapshot,
    windowCenters: List<Float>,
    palette: ColorScheme,
) {
    if (variant.matrix.isEmpty() || variant.matrix.firstOrNull().isNullOrEmpty()) {
        Box(modifier = modifier, contentAlignment = Alignment.Center) {
            Text("No data for ${variant.id.code}")
        }
        return
    }

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(
            modifier = Modifier.width(120.dp).fillMaxHeight(),
            verticalArrangement = Arrangement.SpaceEvenly,
        ) {
            variant.rowLabels.forEach { label ->
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                )
            }
        }
        Column(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .background(palette.surface.copy(alpha = 0.75f)),
            ) {
                val rows = variant.matrix.size
                val cols = variant.matrix.maxOfOrNull { it.size } ?: 1
                val cellWidth = size.width / cols
                val cellHeight = size.height / rows
                variant.matrix.forEachIndexed { rowIndex, row ->
                    row.forEachIndexed { colIndex, value ->
                        drawRect(
                            color = heatColor(
                                value = value,
                                min = variant.minValue,
                                max = variant.maxValue,
                                palette = palette,
                            ),
                            topLeft = Offset(colIndex * cellWidth, rowIndex * cellHeight),
                            size = Size(cellWidth, cellHeight),
                        )
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("${formatCompact(variant.minValue.toDouble())}", style = MaterialTheme.typography.labelSmall)
                Text(
                    variant.summary,
                    style = MaterialTheme.typography.labelSmall,
                    color = palette.onSurface.copy(alpha = 0.68f),
                )
                val lastWindow = windowCenters.lastOrNull()?.toDouble() ?: 0.0
                Text("${formatCompact(lastWindow)}s", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

private fun heatColor(
    value: Float,
    min: Float,
    max: Float,
    palette: ColorScheme,
): Color {
    if (max <= min) return palette.primary.copy(alpha = 0.5f)

    val negativeBase = palette.secondary
    val neutral = palette.surface
    val positiveBase = palette.primary

    return if (min < 0f && max > 0f) {
        val normalized = if (value >= 0f) {
            value / max.coerceAtLeast(1e-6f)
        } else {
            value / min.coerceAtMost(-1e-6f)
        }.coerceIn(-1f, 1f)

        when {
            normalized > 0f -> lerpColor(neutral, positiveBase, normalized)
            normalized < 0f -> lerpColor(neutral, negativeBase, -normalized)
            else -> neutral
        }
    } else {
        val fraction = ((value - min) / (max - min)).coerceIn(0f, 1f)
        lerpColor(negativeBase, positiveBase, fraction)
    }
}

private fun lerpColor(start: Color, end: Color, fraction: Float): Color {
    return Color(
        red = start.red + (end.red - start.red) * fraction,
        green = start.green + (end.green - start.green) * fraction,
        blue = start.blue + (end.blue - start.blue) * fraction,
        alpha = start.alpha + (end.alpha - start.alpha) * fraction,
    )
}
