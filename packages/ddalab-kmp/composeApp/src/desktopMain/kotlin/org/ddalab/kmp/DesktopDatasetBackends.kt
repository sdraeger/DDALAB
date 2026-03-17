package org.ddalab.kmp

import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import kotlin.io.path.absolutePathString
import kotlin.io.path.bufferedReader
import kotlin.io.path.exists
import kotlin.io.path.name
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

private const val WindowCacheLimit = 12
private const val OverviewCacheLimit = 6
private const val MaxExactVisualSamples = 65_536
private const val TargetVisualBuckets = 16_384

internal sealed interface DesktopDatasetBackend {
    val dataset: LoadedDataset

    fun loadWaveformWindow(
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): WaveformWindow

    fun loadWaveformOverview(
        channelNames: List<String>,
        maxBuckets: Int,
    ): WaveformOverview

    fun loadAnalysisWindow(
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): List<ChannelWaveform>

    fun writeNormalizedAscii(target: Path)
}

internal fun loadDesktopDatasetBackend(
    file: Path,
    explicitDelimiter: Char? = null,
    forceHeader: Boolean? = null,
): DesktopDatasetBackend {
    return when (file.extensionLowercase()) {
        "edf" -> parseEdfBackend(file)
        "csv" -> parseDelimitedBackend(file, explicitDelimiter = ',', forceHeader = forceHeader)
        "ascii", "txt" -> {
            if (explicitDelimiter != null || forceHeader != null) {
                parseDelimitedBackend(file, explicitDelimiter = explicitDelimiter, forceHeader = forceHeader)
            } else {
                parseAsciiBackend(file)
            }
        }
        else -> error("Unsupported file type: ${file.fileName}")
    }
}

private class InMemoryDatasetBackend(
    override val dataset: LoadedDataset,
    private val channels: List<ChannelWaveform>,
) : DesktopDatasetBackend {
    private val channelsByName = channels.associateBy(ChannelWaveform::name)
    private val windowCache = LruCache<WaveformWindowKey, WaveformWindow>(WindowCacheLimit)
    private val overviewCache = LruCache<WaveformOverviewKey, WaveformOverview>(OverviewCacheLimit)

    override fun loadWaveformWindow(
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): WaveformWindow {
        val normalizedWindow = clampViewport(dataset, startTimeSeconds, durationSeconds)
        val selectedChannels = resolveChannels(channelNames)
        val key = WaveformWindowKey(
            filePath = dataset.filePath,
            startMillis = (normalizedWindow.startTimeSeconds * 1_000.0).toLong(),
            durationMillis = (normalizedWindow.durationSeconds * 1_000.0).toLong(),
            channels = selectedChannels.map(ChannelWaveform::name),
        )

        windowCache[key]?.let { cached ->
            DesktopDebugLog.debug(
                "Waveform window cache hit",
                mapOf(
                    "file" to dataset.fileName,
                    "startSeconds" to normalizedWindow.startTimeSeconds.toString(),
                    "durationSeconds" to normalizedWindow.durationSeconds.toString(),
                    "channels" to selectedChannels.size.toString(),
                ),
            )
            return cached.copy(fromCache = true)
        }

        val renderedChannels = selectedChannels.map { channel ->
            channel.visualSlice(
                startTimeSeconds = normalizedWindow.startTimeSeconds,
                durationSeconds = normalizedWindow.durationSeconds,
            )
        }

        return WaveformWindow(
            datasetFilePath = dataset.filePath,
            startTimeSeconds = normalizedWindow.startTimeSeconds,
            durationSeconds = normalizedWindow.durationSeconds,
            channels = renderedChannels,
            fromCache = false,
        ).also { windowCache[key] = it }
    }

    override fun loadWaveformOverview(
        channelNames: List<String>,
        maxBuckets: Int,
    ): WaveformOverview {
        val selectedChannels = resolveChannels(channelNames)
        val safeBucketCount = maxBuckets.coerceIn(64, 8_192)
        val key = WaveformOverviewKey(
            filePath = dataset.filePath,
            maxBuckets = safeBucketCount,
            channels = selectedChannels.map(ChannelWaveform::name),
        )

        overviewCache[key]?.let { cached ->
            DesktopDebugLog.debug(
                "Waveform overview cache hit",
                mapOf(
                    "file" to dataset.fileName,
                    "channels" to selectedChannels.size.toString(),
                    "buckets" to safeBucketCount.toString(),
                ),
            )
            return cached.copy(fromCache = true)
        }

        val durationSeconds = dataset.durationSeconds.coerceAtLeast(
            selectedChannels.maxOfOrNull(ChannelWaveform::durationSeconds) ?: 0.0,
        )
        val overview = WaveformOverview(
            datasetFilePath = dataset.filePath,
            durationSeconds = durationSeconds,
            channels = selectedChannels.map { channel ->
                buildOverviewChannel(
                    name = channel.name,
                    unit = channel.unit,
                    samples = channel.samples,
                    sampleRateHz = channel.sampleRateHz,
                    durationSeconds = durationSeconds,
                    maxBuckets = safeBucketCount,
                )
            },
            fromCache = false,
        )
        overviewCache[key] = overview
        return overview
    }

    override fun loadAnalysisWindow(
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): List<ChannelWaveform> {
        val normalizedWindow = clampViewport(dataset, startTimeSeconds, durationSeconds)
        return resolveChannels(channelNames).map { channel ->
            channel.exactSlice(
                startTimeSeconds = normalizedWindow.startTimeSeconds,
                durationSeconds = normalizedWindow.durationSeconds,
            )
        }
    }

    override fun writeNormalizedAscii(target: Path) {
        val sampleCount = channels.minOfOrNull { it.samples.size } ?: 0
        DesktopDebugLog.debug(
            "Writing normalized ASCII",
            mapOf(
                "source" to dataset.filePath,
                "target" to target.absolutePathString(),
                "channels" to channels.size.toString(),
                "samples" to sampleCount.toString(),
            ),
        )
        target.toFile().bufferedWriter().use { writer ->
            repeat(sampleCount) { sampleIndex ->
                val row = channels.joinToString(" ") { channel ->
                    channel.samples[sampleIndex].toString()
                }
                writer.appendLine(row)
            }
        }
    }

    private fun resolveChannels(channelNames: List<String>): List<ChannelWaveform> {
        require(channelNames.isNotEmpty()) { "At least one channel is required." }
        return channelNames.map { channelName ->
            channelsByName[channelName] ?: error("Unknown channel: $channelName")
        }
    }
}

private class LazyEdfDatasetBackend(
    private val file: Path,
    override val dataset: LoadedDataset,
    private val metadata: EdfFileMetadata,
) : DesktopDatasetBackend {
    private val signalsByName = metadata.signals.associateBy(EdfSignalMetadata::name)
    private val windowCache = LruCache<WaveformWindowKey, WaveformWindow>(WindowCacheLimit)
    private val overviewCache = LruCache<WaveformOverviewKey, WaveformOverview>(OverviewCacheLimit)
    private val fileChannel by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        FileChannel.open(file, StandardOpenOption.READ)
    }

    override fun loadWaveformWindow(
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): WaveformWindow {
        val normalizedWindow = clampViewport(dataset, startTimeSeconds, durationSeconds)
        val signals = resolveSignals(channelNames)
        val key = WaveformWindowKey(
            filePath = dataset.filePath,
            startMillis = (normalizedWindow.startTimeSeconds * 1_000.0).toLong(),
            durationMillis = (normalizedWindow.durationSeconds * 1_000.0).toLong(),
            channels = signals.map(EdfSignalMetadata::name),
        )

        windowCache[key]?.let { cached ->
            DesktopDebugLog.debug(
                "EDF window cache hit",
                mapOf(
                    "file" to dataset.fileName,
                    "startSeconds" to normalizedWindow.startTimeSeconds.toString(),
                    "durationSeconds" to normalizedWindow.durationSeconds.toString(),
                    "channels" to signals.size.toString(),
                ),
            )
            return cached.copy(fromCache = true)
        }

        DesktopDebugLog.info(
            "Reading EDF waveform window",
            mapOf(
                "file" to dataset.fileName,
                "startSeconds" to normalizedWindow.startTimeSeconds.toString(),
                "durationSeconds" to normalizedWindow.durationSeconds.toString(),
                "channels" to signals.joinToString { it.name },
            ),
        )

        val renderedChannels = signals.map { signal ->
            val sampleWindow = signal.sampleWindow(
                startTimeSeconds = normalizedWindow.startTimeSeconds,
                durationSeconds = normalizedWindow.durationSeconds,
            )
            if (sampleWindow.sampleCount <= MaxExactVisualSamples) {
                buildVisualWaveform(
                    name = signal.name,
                    sampleRateHz = signal.sampleRateHz,
                    samples = readExactSamples(signal, sampleWindow),
                    unit = signal.unit,
                )
            } else {
                val bucketCount = min(TargetVisualBuckets, sampleWindow.sampleCount)
                    .coerceAtLeast(512)
                val (mins, maxs) = readEnvelopeSamples(signal, sampleWindow, bucketCount)
                buildEnvelopeWaveform(
                    name = signal.name,
                    unit = signal.unit,
                    durationSeconds = normalizedWindow.durationSeconds,
                    mins = mins,
                    maxs = maxs,
                )
            }
        }

        return WaveformWindow(
            datasetFilePath = dataset.filePath,
            startTimeSeconds = normalizedWindow.startTimeSeconds,
            durationSeconds = normalizedWindow.durationSeconds,
            channels = renderedChannels,
            fromCache = false,
        ).also { windowCache[key] = it }
    }

    override fun loadWaveformOverview(
        channelNames: List<String>,
        maxBuckets: Int,
    ): WaveformOverview {
        val signals = resolveSignals(channelNames)
        val safeBucketCount = maxBuckets.coerceIn(64, 8_192)
        val key = WaveformOverviewKey(
            filePath = dataset.filePath,
            maxBuckets = safeBucketCount,
            channels = signals.map(EdfSignalMetadata::name),
        )

        overviewCache[key]?.let { cached ->
            DesktopDebugLog.debug(
                "EDF overview cache hit",
                mapOf(
                    "file" to dataset.fileName,
                    "channels" to signals.size.toString(),
                    "buckets" to safeBucketCount.toString(),
                ),
            )
            return cached.copy(fromCache = true)
        }

        DesktopDebugLog.info(
            "Building EDF overview",
            mapOf(
                "file" to dataset.fileName,
                "channels" to signals.joinToString { it.name },
                "maxBuckets" to safeBucketCount.toString(),
            ),
        )

        val overview = WaveformOverview(
            datasetFilePath = dataset.filePath,
            durationSeconds = metadata.durationSeconds,
            channels = signals.map { signal ->
                buildOverviewChannel(signal, safeBucketCount)
            },
            fromCache = false,
        )
        overviewCache[key] = overview
        return overview
    }

    override fun loadAnalysisWindow(
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): List<ChannelWaveform> {
        val normalizedWindow = clampViewport(dataset, startTimeSeconds, durationSeconds)
        return resolveSignals(channelNames).map { signal ->
            val sampleWindow = signal.sampleWindow(
                startTimeSeconds = normalizedWindow.startTimeSeconds,
                durationSeconds = normalizedWindow.durationSeconds,
            )
            buildAnalysisWaveform(
                name = signal.name,
                sampleRateHz = signal.sampleRateHz,
                samples = readExactSamples(signal, sampleWindow),
                unit = signal.unit,
            )
        }
    }

    override fun writeNormalizedAscii(target: Path) {
        error("EDF datasets are passed to the native DDA pipeline directly.")
    }

    private fun resolveSignals(channelNames: List<String>): List<EdfSignalMetadata> {
        require(channelNames.isNotEmpty()) { "At least one channel is required." }
        return channelNames.map { channelName ->
            signalsByName[channelName] ?: error("Unknown channel: $channelName")
        }
    }

    private fun readExactSamples(
        signal: EdfSignalMetadata,
        sampleWindow: EdfSampleWindow,
    ): DoubleArray {
        if (sampleWindow.sampleCount <= 0) return DoubleArray(0)
        val output = DoubleArray(sampleWindow.sampleCount)
        val bytesPerRecord = signal.samplesPerRecord * Short.SIZE_BYTES
        val buffer = ByteBuffer
            .allocateDirect(bytesPerRecord)
            .order(ByteOrder.LITTLE_ENDIAN)

        var outputIndex = 0
        val logEvery = ((sampleWindow.lastRecordIndexInclusive - sampleWindow.firstRecordIndex + 1) / 8)
            .coerceAtLeast(1)

        for (recordIndex in sampleWindow.firstRecordIndex..sampleWindow.lastRecordIndexInclusive) {
            val localStart = if (recordIndex == sampleWindow.firstRecordIndex) {
                (sampleWindow.startSampleIndex % signal.samplesPerRecord).toInt()
            } else {
                0
            }
            val localEndExclusive = if (recordIndex == sampleWindow.lastRecordIndexInclusive) {
                ((sampleWindow.endSampleIndexExclusive - 1) % signal.samplesPerRecord + 1).toInt()
            } else {
                signal.samplesPerRecord
            }
            val localCount = localEndExclusive - localStart
            if (localCount <= 0) continue

            if (
                recordIndex == sampleWindow.firstRecordIndex ||
                recordIndex == sampleWindow.lastRecordIndexInclusive ||
                (recordIndex - sampleWindow.firstRecordIndex) % logEvery == 0L
            ) {
                DesktopDebugLog.debug(
                    "EDF window read progress",
                    mapOf(
                        "file" to dataset.fileName,
                        "channel" to signal.name,
                        "recordIndex" to recordIndex.toString(),
                        "recordEnd" to sampleWindow.lastRecordIndexInclusive.toString(),
                    ),
                )
            }

            buffer.clear()
            buffer.limit(localCount * Short.SIZE_BYTES)
            readFully(
                channel = fileChannel,
                target = buffer,
                position = metadata.headerBytes +
                    recordIndex * metadata.recordSizeBytes +
                    signal.byteOffsetWithinRecord +
                    localStart.toLong() * Short.SIZE_BYTES,
            )
            buffer.flip()

            repeat(localCount) {
                output[outputIndex++] = signal.toPhysicalValue(buffer.short.toInt())
            }
        }

        return if (outputIndex == output.size) {
            output
        } else {
            output.copyOf(outputIndex)
        }
    }

    private fun readEnvelopeSamples(
        signal: EdfSignalMetadata,
        sampleWindow: EdfSampleWindow,
        bucketCount: Int,
    ): Pair<FloatArray, FloatArray> {
        val safeBucketCount = bucketCount.coerceAtLeast(1)
        val mins = FloatArray(safeBucketCount) { Float.POSITIVE_INFINITY }
        val maxs = FloatArray(safeBucketCount) { Float.NEGATIVE_INFINITY }
        val bytesPerRecord = signal.samplesPerRecord * Short.SIZE_BYTES
        val buffer = ByteBuffer
            .allocateDirect(bytesPerRecord)
            .order(ByteOrder.LITTLE_ENDIAN)

        var relativeSampleIndex = 0L
        for (recordIndex in sampleWindow.firstRecordIndex..sampleWindow.lastRecordIndexInclusive) {
            val localStart = if (recordIndex == sampleWindow.firstRecordIndex) {
                (sampleWindow.startSampleIndex % signal.samplesPerRecord).toInt()
            } else {
                0
            }
            val localEndExclusive = if (recordIndex == sampleWindow.lastRecordIndexInclusive) {
                ((sampleWindow.endSampleIndexExclusive - 1) % signal.samplesPerRecord + 1).toInt()
            } else {
                signal.samplesPerRecord
            }
            val localCount = localEndExclusive - localStart
            if (localCount <= 0) continue

            buffer.clear()
            buffer.limit(localCount * Short.SIZE_BYTES)
            readFully(
                channel = fileChannel,
                target = buffer,
                position = metadata.headerBytes +
                    recordIndex * metadata.recordSizeBytes +
                    signal.byteOffsetWithinRecord +
                    localStart.toLong() * Short.SIZE_BYTES,
            )
            buffer.flip()

            repeat(localCount) {
                val physicalValue = signal.toPhysicalValue(buffer.short.toInt()).toFloat()
                val bucketIndex = min(
                    safeBucketCount - 1,
                    ((relativeSampleIndex * safeBucketCount) / sampleWindow.sampleCount.coerceAtLeast(1).toLong()).toInt(),
                )
                if (physicalValue < mins[bucketIndex]) mins[bucketIndex] = physicalValue
                if (physicalValue > maxs[bucketIndex]) maxs[bucketIndex] = physicalValue
                relativeSampleIndex++
            }
        }

        sanitizeEnvelope(mins, maxs)
        return mins to maxs
    }

    private fun buildOverviewChannel(
        signal: EdfSignalMetadata,
        maxBuckets: Int,
    ): WaveformOverviewChannel {
        val totalSamples = signal.totalSamples.coerceAtLeast(1L)
        val bucketCount = min(
            maxBuckets.coerceAtLeast(1),
            totalSamples.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
        ).coerceAtLeast(1)
        val mins = FloatArray(bucketCount) { Float.POSITIVE_INFINITY }
        val maxs = FloatArray(bucketCount) { Float.NEGATIVE_INFINITY }
        val buffer = ByteBuffer
            .allocateDirect(signal.samplesPerRecord * Short.SIZE_BYTES)
            .order(ByteOrder.LITTLE_ENDIAN)

        var sampleIndex = 0L
        val logEvery = (metadata.recordCount / 10L).coerceAtLeast(1L)

        for (recordIndex in 0 until metadata.recordCount) {
            if (
                recordIndex == 0L ||
                recordIndex == metadata.recordCount - 1 ||
                recordIndex % logEvery == 0L
            ) {
                DesktopDebugLog.debug(
                    "EDF overview progress",
                    mapOf(
                        "file" to dataset.fileName,
                        "channel" to signal.name,
                        "recordIndex" to recordIndex.toString(),
                        "recordCount" to metadata.recordCount.toString(),
                    ),
                )
            }

            buffer.clear()
            buffer.limit(signal.samplesPerRecord * Short.SIZE_BYTES)
            readFully(
                channel = fileChannel,
                target = buffer,
                position = metadata.headerBytes +
                    recordIndex * metadata.recordSizeBytes +
                    signal.byteOffsetWithinRecord,
            )
            buffer.flip()

            repeat(signal.samplesPerRecord) {
                if (sampleIndex >= totalSamples) return@repeat
                val physicalValue = signal.toPhysicalValue(buffer.short.toInt()).toFloat()
                val bucketIndex = min(
                    bucketCount - 1,
                    ((sampleIndex * bucketCount) / totalSamples).toInt(),
                )
                if (physicalValue < mins[bucketIndex]) mins[bucketIndex] = physicalValue
                if (physicalValue > maxs[bucketIndex]) maxs[bucketIndex] = physicalValue
                sampleIndex++
            }
        }

        sanitizeEnvelope(mins, maxs)
        val minValue = mins.minOrNull()?.takeIf(Float::isFinite) ?: 0f
        val maxValue = maxs.maxOrNull()?.takeIf(Float::isFinite) ?: 0f
        return WaveformOverviewChannel(
            name = signal.name,
            bucketDurationSeconds = metadata.durationSeconds / bucketCount.coerceAtLeast(1),
            mins = mins,
            maxs = maxs,
            minValue = minValue,
            maxValue = maxValue,
        )
    }
}

private fun parseAsciiBackend(file: Path): DesktopDatasetBackend {
    DesktopDebugLog.debug(
        "Parsing ASCII dataset",
        mapOf("path" to file.absolutePathString()),
    )
    val firstNonBlank = file.bufferedReader().useLines { lines ->
        lines.firstOrNull { it.isNotBlank() }.orEmpty()
    }
    val hasHeader = firstNonBlank
        .split(Regex("\\s+"))
        .any { token -> token.toDoubleOrNull() == null }

    return parseDelimitedBackend(
        file = file,
        explicitDelimiter = null,
        forceHeader = hasHeader,
    )
}

private fun parseDelimitedBackend(
    file: Path,
    explicitDelimiter: Char? = null,
    forceHeader: Boolean? = null,
): DesktopDatasetBackend {
    DesktopDebugLog.debug(
        "Parsing delimited dataset",
        mapOf(
            "path" to file.absolutePathString(),
            "delimiter" to (explicitDelimiter?.toString() ?: "whitespace"),
        ),
    )
    val lines = file.bufferedReader().useLines { it.filter(String::isNotBlank).toList() }
    require(lines.isNotEmpty()) { "File is empty: ${file.fileName}" }

    val splitter: (String) -> List<String> = if (explicitDelimiter != null) {
        { line -> line.split(explicitDelimiter).map(String::trim) }
    } else {
        { line -> line.trim().split(Regex("\\s+")) }
    }

    val firstTokens = splitter(lines.first())
    val hasHeader = forceHeader ?: firstTokens.any { it.toDoubleOrNull() == null }
    val header = if (hasHeader) splitter(lines.first()) else emptyList()
    val dataLines = if (hasHeader) lines.drop(1) else lines

    val rows = dataLines.mapNotNull { line ->
        val tokens = splitter(line)
        val numbers = tokens.mapNotNull(String::toDoubleOrNull)
        if (numbers.size == tokens.size && numbers.isNotEmpty()) numbers else null
    }
    require(rows.isNotEmpty()) { "No numeric samples were found in ${file.fileName}" }

    val columnCount = rows.minOf { it.size }
    val effectiveHeader = if (header.isNotEmpty() && header.size >= columnCount) {
        header.take(columnCount)
    } else {
        List(columnCount) { index -> "Channel ${index + 1}" }
    }

    val hasExplicitTimeColumn = effectiveHeader.firstOrNull()
        ?.lowercase()
        ?.let { it in setOf("time", "timestamp", "seconds", "sample", "samples") }
        ?: false

    val startColumn = if (hasExplicitTimeColumn) 1 else 0
    val channelNames = effectiveHeader.drop(startColumn)
    require(channelNames.isNotEmpty()) { "At least one signal channel is required" }

    val times = if (hasExplicitTimeColumn) {
        rows.map { it.first() }
    } else {
        rows.indices.map(Int::toDouble)
    }

    val sampleRate = estimateSampleRate(times)
    val waveforms = channelNames.mapIndexed { index, name ->
        buildVisualWaveform(
            name = name.ifBlank { "Channel ${index + 1}" },
            sampleRateHz = sampleRate,
            samples = DoubleArray(rows.size) { rowIndex ->
                rows[rowIndex][index + startColumn]
            },
            unit = null,
        )
    }

    val duration = if (hasExplicitTimeColumn) {
        (times.lastOrNull() ?: 0.0) - (times.firstOrNull() ?: 0.0)
    } else {
        rows.size / sampleRate
    }.coerceAtLeast(0.0)

    val dataset = LoadedDataset(
        filePath = file.absolutePathString(),
        fileName = file.name,
        format = if (explicitDelimiter == ',') DatasetFormat.CSV else DatasetFormat.ASCII,
        fileSizeBytes = Files.size(file),
        durationSeconds = duration,
        totalSampleCount = rows.size.toLong(),
        timeAxisName = if (hasExplicitTimeColumn) effectiveHeader.first() else "Sample",
        sourceSummary = if (hasExplicitTimeColumn) {
            "Explicit time column detected"
        } else {
            "Uniform synthetic sample axis"
        },
        notes = buildList {
            if (hasHeader) add("Header row detected")
            if (hasExplicitTimeColumn) add("Time axis: ${effectiveHeader.first()}")
            add("Parsed ${rows.size} rows x ${channelNames.size} channels")
        },
        channels = waveforms.map {
            ChannelDescriptor(
                name = it.name,
                sampleRateHz = it.sampleRateHz,
                sampleCount = it.samples.size.toLong(),
                unit = it.unit,
            )
        },
        supportsWindowedAccess = false,
    )

    return InMemoryDatasetBackend(dataset = dataset, channels = waveforms)
}

private fun parseEdfBackend(file: Path): DesktopDatasetBackend {
    DesktopDebugLog.info(
        "Parsing EDF header",
        mapOf(
            "path" to file.absolutePathString(),
            "sizeBytes" to runCatching { Files.size(file) }.getOrDefault(-1L).toString(),
        ),
    )
    RandomAccessFile(file.toFile(), "r").use { raf ->
        val version = raf.readAsciiField(8)
        val patient = raf.readAsciiField(80)
        val recording = raf.readAsciiField(80)
        val startDate = raf.readAsciiField(8)
        val startTime = raf.readAsciiField(8)
        val headerBytes = raf.readAsciiField(8).trim().toLongOrNull() ?: 256L
        raf.readAsciiField(44)
        val declaredRecords = raf.readAsciiField(8).trim().toLongOrNull() ?: -1L
        val recordDuration = raf.readAsciiField(8).trim().toDoubleOrNull()?.coerceAtLeast(1e-6) ?: 1.0
        val signalCount = raf.readAsciiField(4).trim().toIntOrNull()?.coerceAtLeast(1) ?: 1

        fun readFieldBlock(width: Int): List<String> =
            List(signalCount) { raf.readAsciiField(width) }

        val labels = readFieldBlock(16)
        readFieldBlock(80)
        val units = readFieldBlock(8)
        val physicalMins = readFieldBlock(8).map { it.trim().toDoubleOrNull() ?: -1.0 }
        val physicalMaxs = readFieldBlock(8).map { it.trim().toDoubleOrNull() ?: 1.0 }
        val digitalMins = readFieldBlock(8).map { it.trim().toIntOrNull() ?: -32768 }
        val digitalMaxs = readFieldBlock(8).map { it.trim().toIntOrNull() ?: 32767 }
        readFieldBlock(80)
        val samplesPerRecord = readFieldBlock(8).map { it.trim().toIntOrNull()?.coerceAtLeast(1) ?: 1 }
        readFieldBlock(32)

        val recordSizeBytes = samplesPerRecord.sumOf { it.toLong() * Short.SIZE_BYTES }
        val fileSize = Files.size(file)
        require(headerBytes in 256L..fileSize) { "Invalid EDF header size in ${file.fileName}" }
        require(recordSizeBytes > 0L) { "EDF record size is zero in ${file.fileName}" }

        val inferredRecords = ((fileSize - headerBytes) / recordSizeBytes).coerceAtLeast(0L)
        val recordCount = when {
            declaredRecords > 0L && inferredRecords > 0L -> min(declaredRecords, inferredRecords)
            declaredRecords > 0L -> declaredRecords
            else -> inferredRecords
        }

        var currentRecordOffset = 0L
        val visibleSignalIndices = labels.indices.filterNot { index ->
            labels[index].contains("annotation", ignoreCase = true)
        }.ifEmpty { labels.indices.toList() }

        val signals = labels.indices.map { index ->
            val physicalMin = physicalMins[index]
            val physicalMax = physicalMaxs[index]
            val digitalMin = digitalMins[index]
            val digitalMax = digitalMaxs[index]
            val scale = if (digitalMax == digitalMin) {
                1.0
            } else {
                (physicalMax - physicalMin) / (digitalMax - digitalMin).toDouble()
            }
            val offset = if (digitalMax == digitalMin) {
                0.0
            } else {
                physicalMin - digitalMin * scale
            }

            val metadata = EdfSignalMetadata(
                index = index,
                name = labels[index].ifBlank { "Channel ${index + 1}" },
                sampleRateHz = samplesPerRecord[index] / recordDuration,
                samplesPerRecord = samplesPerRecord[index],
                totalSamples = samplesPerRecord[index].toLong() * recordCount,
                unit = units[index].ifBlank { null },
                byteOffsetWithinRecord = currentRecordOffset,
                scale = scale,
                offset = offset,
            )
            currentRecordOffset += samplesPerRecord[index].toLong() * Short.SIZE_BYTES
            metadata
        }.filter { signal -> visibleSignalIndices.contains(signal.index) }

        DesktopDebugLog.info(
            "EDF header read",
            mapOf(
                "file" to file.name,
                "version" to version,
                "declaredRecords" to declaredRecords.toString(),
                "recordCount" to recordCount.toString(),
                "recordDuration" to recordDuration.toString(),
                "signals" to signals.size.toString(),
            ),
        )

        val edfMetadata = EdfFileMetadata(
            headerBytes = headerBytes,
            recordCount = recordCount,
            recordDurationSeconds = recordDuration,
            recordSizeBytes = recordSizeBytes,
            durationSeconds = recordCount * recordDuration,
            signals = signals,
        )

        val dataset = LoadedDataset(
            filePath = file.absolutePathString(),
            fileName = file.name,
            format = DatasetFormat.EDF,
            fileSizeBytes = fileSize,
            durationSeconds = edfMetadata.durationSeconds,
            totalSampleCount = signals.maxOfOrNull(EdfSignalMetadata::totalSamples) ?: 0L,
            timeAxisName = "Seconds",
            sourceSummary = "EDF patient=${patient.ifBlank { "unknown" }} recording=${recording.ifBlank { "unknown" }}",
            notes = buildList {
                add("Lazy EDF reader enabled")
                add("Signal data stays on disk until a viewport or analysis window requests it")
                if (labels.size != signals.size) {
                    add("Skipped ${labels.size - signals.size} EDF annotation channels")
                }
                if (startDate.isNotBlank() || startTime.isNotBlank()) {
                    add("Start ${startDate.trim()} ${startTime.trim()}".trim())
                }
            },
            channels = signals.map { signal ->
                ChannelDescriptor(
                    name = signal.name,
                    sampleRateHz = signal.sampleRateHz,
                    sampleCount = signal.totalSamples,
                    unit = signal.unit,
                )
            },
            supportsWindowedAccess = true,
        )

        return LazyEdfDatasetBackend(
            file = file,
            dataset = dataset,
            metadata = edfMetadata,
        )
    }
}

private data class EdfFileMetadata(
    val headerBytes: Long,
    val recordCount: Long,
    val recordDurationSeconds: Double,
    val recordSizeBytes: Long,
    val durationSeconds: Double,
    val signals: List<EdfSignalMetadata>,
)

private data class EdfSignalMetadata(
    val index: Int,
    val name: String,
    val sampleRateHz: Double,
    val samplesPerRecord: Int,
    val totalSamples: Long,
    val unit: String?,
    val byteOffsetWithinRecord: Long,
    val scale: Double,
    val offset: Double,
) {
    fun sampleWindow(
        startTimeSeconds: Double,
        durationSeconds: Double,
    ): EdfSampleWindow {
        if (totalSamples <= 0L) {
            return EdfSampleWindow(
                startSampleIndex = 0L,
                endSampleIndexExclusive = 0L,
                sampleCount = 0,
                firstRecordIndex = 0L,
                lastRecordIndexInclusive = -1L,
            )
        }
        val safeStart = startTimeSeconds.coerceAtLeast(0.0)
        val safeEnd = (safeStart + durationSeconds).coerceAtLeast(safeStart + 1e-6)
        val startSample = floor(safeStart * sampleRateHz).toLong()
            .coerceIn(0L, totalSamples - 1L)
        val endSampleExclusive = ceil(safeEnd * sampleRateHz).toLong()
            .coerceIn(startSample + 1L, totalSamples)
        val firstRecord = startSample / samplesPerRecord
        val lastRecord = (endSampleExclusive - 1L) / samplesPerRecord
        return EdfSampleWindow(
            startSampleIndex = startSample,
            endSampleIndexExclusive = endSampleExclusive,
            sampleCount = (endSampleExclusive - startSample).toInt(),
            firstRecordIndex = firstRecord,
            lastRecordIndexInclusive = lastRecord,
        )
    }

    fun toPhysicalValue(rawValue: Int): Double {
        return if (scale == 1.0 && offset == 0.0) {
            rawValue.toDouble()
        } else {
            rawValue * scale + offset
        }
    }
}

private data class EdfSampleWindow(
    val startSampleIndex: Long,
    val endSampleIndexExclusive: Long,
    val sampleCount: Int,
    val firstRecordIndex: Long,
    val lastRecordIndexInclusive: Long,
)

private data class WaveformWindowKey(
    val filePath: String,
    val startMillis: Long,
    val durationMillis: Long,
    val channels: List<String>,
)

private data class WaveformOverviewKey(
    val filePath: String,
    val maxBuckets: Int,
    val channels: List<String>,
)

private data class ViewportWindow(
    val startTimeSeconds: Double,
    val durationSeconds: Double,
)

private class LruCache<K, V>(
    private val maxEntries: Int,
) {
    private val backing = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>?): Boolean {
            return size > maxEntries
        }
    }

    @Synchronized
    operator fun get(key: K): V? = backing[key]

    @Synchronized
    operator fun set(key: K, value: V) {
        backing[key] = value
    }
}

private fun clampViewport(
    dataset: LoadedDataset,
    startTimeSeconds: Double,
    durationSeconds: Double,
): ViewportWindow {
    val safeDuration = durationSeconds
        .coerceAtLeast(0.5)
        .coerceAtMost(dataset.durationSeconds.coerceAtLeast(0.5))
    val maxStart = max(0.0, dataset.durationSeconds - safeDuration)
    return ViewportWindow(
        startTimeSeconds = startTimeSeconds.coerceIn(0.0, maxStart),
        durationSeconds = safeDuration,
    )
}

private fun ChannelWaveform.visualSlice(
    startTimeSeconds: Double,
    durationSeconds: Double,
): ChannelWaveform {
    if (samples.isEmpty() || sampleRateHz <= 0.0) {
        return buildVisualWaveform(name, sampleRateHz, DoubleArray(0), unit)
    }

    val startIndex = floor(startTimeSeconds * sampleRateHz).toInt().coerceAtLeast(0)
    val endIndex = ceil((startTimeSeconds + durationSeconds) * sampleRateHz).toInt()
        .coerceIn(startIndex + 1, samples.size)
    val sampleCount = endIndex - startIndex

    if (sampleCount <= MaxExactVisualSamples) {
        return buildVisualWaveform(
            name = name,
            sampleRateHz = sampleRateHz,
            samples = samples.copyOfRange(startIndex, endIndex),
            unit = unit,
        )
    }

    val bucketCount = min(TargetVisualBuckets, sampleCount).coerceAtLeast(512)
    val mins = FloatArray(bucketCount) { Float.POSITIVE_INFINITY }
    val maxs = FloatArray(bucketCount) { Float.NEGATIVE_INFINITY }
    for (offset in 0 until sampleCount) {
        val value = samples[startIndex + offset].toFloat()
        val bucketIndex = min(bucketCount - 1, (offset.toLong() * bucketCount / sampleCount).toInt())
        if (value < mins[bucketIndex]) mins[bucketIndex] = value
        if (value > maxs[bucketIndex]) maxs[bucketIndex] = value
    }
    sanitizeEnvelope(mins, maxs)
    return buildEnvelopeWaveform(name = name, unit = unit, durationSeconds = durationSeconds, mins = mins, maxs = maxs)
}

private fun ChannelWaveform.exactSlice(
    startTimeSeconds: Double,
    durationSeconds: Double,
): ChannelWaveform {
    if (samples.isEmpty() || sampleRateHz <= 0.0) {
        return buildAnalysisWaveform(name, sampleRateHz, DoubleArray(0), unit)
    }
    val startIndex = floor(startTimeSeconds * sampleRateHz).toInt().coerceAtLeast(0)
    val endIndex = ceil((startTimeSeconds + durationSeconds) * sampleRateHz).toInt()
        .coerceIn(startIndex + 1, samples.size)
    return buildAnalysisWaveform(
        name = name,
        sampleRateHz = sampleRateHz,
        samples = samples.copyOfRange(startIndex, endIndex),
        unit = unit,
    )
}

private fun buildOverviewChannel(
    name: String,
    unit: String?,
    samples: DoubleArray,
    sampleRateHz: Double,
    durationSeconds: Double,
    maxBuckets: Int,
): WaveformOverviewChannel {
    val safeDuration = durationSeconds
        .takeIf { it.isFinite() && it > 0.0 }
        ?: if (sampleRateHz > 0.0) samples.size / sampleRateHz else 0.0
    if (samples.isEmpty()) {
        return WaveformOverviewChannel(
            name = name,
            bucketDurationSeconds = safeDuration.coerceAtLeast(0.001),
            mins = floatArrayOf(0f),
            maxs = floatArrayOf(0f),
            minValue = 0f,
            maxValue = 0f,
        )
    }

    val bucketCount = min(maxBuckets.coerceAtLeast(1), samples.size).coerceAtLeast(1)
    val mins = FloatArray(bucketCount) { Float.POSITIVE_INFINITY }
    val maxs = FloatArray(bucketCount) { Float.NEGATIVE_INFINITY }
    for (index in samples.indices) {
        val bucketIndex = min(bucketCount - 1, (index.toLong() * bucketCount / samples.size).toInt())
        val value = samples[index].toFloat()
        if (value < mins[bucketIndex]) mins[bucketIndex] = value
        if (value > maxs[bucketIndex]) maxs[bucketIndex] = value
    }
    sanitizeEnvelope(mins, maxs)
    val minValue = mins.minOrNull()?.takeIf(Float::isFinite) ?: 0f
    val maxValue = maxs.maxOrNull()?.takeIf(Float::isFinite) ?: 0f
    return WaveformOverviewChannel(
        name = name,
        bucketDurationSeconds = safeDuration / bucketCount.coerceAtLeast(1),
        mins = mins,
        maxs = maxs,
        minValue = minValue,
        maxValue = maxValue,
    )
}

private fun buildVisualWaveform(
    name: String,
    sampleRateHz: Double,
    samples: DoubleArray,
    unit: String?,
): ChannelWaveform {
    val (minValue, maxValue) = findMinMax(samples)
    return ChannelWaveform(
        name = name,
        sampleRateHz = sampleRateHz.coerceAtLeast(1.0),
        samples = samples,
        unit = unit,
        minValue = minValue,
        maxValue = maxValue,
        levels = buildEnvelopeLevels(samples),
    )
}

private fun buildAnalysisWaveform(
    name: String,
    sampleRateHz: Double,
    samples: DoubleArray,
    unit: String?,
): ChannelWaveform {
    val (minValue, maxValue) = findMinMax(samples)
    return ChannelWaveform(
        name = name,
        sampleRateHz = sampleRateHz.coerceAtLeast(1.0),
        samples = samples,
        unit = unit,
        minValue = minValue,
        maxValue = maxValue,
        levels = emptyList(),
    )
}

private fun buildEnvelopeWaveform(
    name: String,
    unit: String?,
    durationSeconds: Double,
    mins: FloatArray,
    maxs: FloatArray,
): ChannelWaveform {
    sanitizeEnvelope(mins, maxs)
    val bucketCount = min(mins.size, maxs.size).coerceAtLeast(1)
    val representativeSamples = DoubleArray(bucketCount) { index ->
        ((mins[index] + maxs[index]) / 2.0f).toDouble()
    }
    val minValue = mins.minOrNull()?.takeIf(Float::isFinite) ?: 0f
    val maxValue = maxs.maxOrNull()?.takeIf(Float::isFinite) ?: 0f
    return ChannelWaveform(
        name = name,
        sampleRateHz = if (durationSeconds > 0.0) {
            bucketCount / durationSeconds
        } else {
            1.0
        },
        samples = representativeSamples,
        unit = unit,
        minValue = minValue,
        maxValue = maxValue,
        levels = listOf(
            WaveformEnvelopeLevel(
                bucketSize = 1,
                mins = mins.copyOf(bucketCount),
                maxs = maxs.copyOf(bucketCount),
            ),
        ),
    )
}

private fun buildEnvelopeLevels(samples: DoubleArray): List<WaveformEnvelopeLevel> {
    if (samples.isEmpty()) {
        return listOf(WaveformEnvelopeLevel(bucketSize = 1, mins = floatArrayOf(0f), maxs = floatArrayOf(0f)))
    }

    val levels = mutableListOf<WaveformEnvelopeLevel>()
    var bucketSize = 4
    while (bucketSize < samples.size) {
        val bucketCount = ceil(samples.size / bucketSize.toDouble()).toInt()
        val mins = FloatArray(bucketCount)
        val maxs = FloatArray(bucketCount)
        repeat(bucketCount) { bucket ->
            var localMin = Float.POSITIVE_INFINITY
            var localMax = Float.NEGATIVE_INFINITY
            val start = bucket * bucketSize
            val end = min(samples.size, start + bucketSize)
            for (index in start until end) {
                val value = samples[index].toFloat()
                if (value < localMin) localMin = value
                if (value > localMax) localMax = value
            }
            mins[bucket] = if (localMin.isFinite()) localMin else 0f
            maxs[bucket] = if (localMax.isFinite()) localMax else 0f
        }
        levels += WaveformEnvelopeLevel(bucketSize = bucketSize, mins = mins, maxs = maxs)
        bucketSize *= 4
    }

    if (levels.isEmpty()) {
        levels += WaveformEnvelopeLevel(
            bucketSize = 1,
            mins = FloatArray(samples.size) { samples[it].toFloat() },
            maxs = FloatArray(samples.size) { samples[it].toFloat() },
        )
    }
    return levels
}

private fun sanitizeEnvelope(mins: FloatArray, maxs: FloatArray) {
    for (index in mins.indices) {
        if (!mins[index].isFinite()) mins[index] = 0f
        if (!maxs[index].isFinite()) maxs[index] = mins[index]
        if (maxs[index] < mins[index]) {
            val swap = mins[index]
            mins[index] = maxs[index]
            maxs[index] = swap
        }
    }
}

private fun findMinMax(samples: DoubleArray): Pair<Float, Float> {
    var minValue = Float.POSITIVE_INFINITY
    var maxValue = Float.NEGATIVE_INFINITY
    for (sample in samples) {
        val value = sample.toFloat()
        if (value < minValue) minValue = value
        if (value > maxValue) maxValue = value
    }
    if (!minValue.isFinite()) minValue = 0f
    if (!maxValue.isFinite()) maxValue = 0f
    return minValue to maxValue
}

private fun estimateSampleRate(times: List<Double>): Double {
    if (times.size < 2) return 1.0
    val deltas = times.zipWithNext { left, right -> right - left }
        .filter { it > 0.0 && it.isFinite() }
    if (deltas.isEmpty()) return 1.0
    val averageDelta = deltas.average().coerceAtLeast(1e-6)
    return 1.0 / averageDelta
}

private fun Path.extensionLowercase(): String =
    fileName.toString().substringAfterLast('.', "").lowercase()

private fun RandomAccessFile.readAsciiField(length: Int): String {
    val buffer = ByteArray(length)
    readFully(buffer)
    return buffer.toString(StandardCharsets.US_ASCII).trim()
}

private fun readFully(
    channel: FileChannel,
    target: ByteBuffer,
    position: Long,
) {
    var currentPosition = position
    while (target.hasRemaining()) {
        val bytesRead = channel.read(target, currentPosition)
        require(bytesRead >= 0) { "Unexpected EOF while reading ${channel.size()} bytes at position $position" }
        currentPosition += bytesRead.toLong()
    }
}
