package org.ddalab.kmp

import kotlinx.serialization.Serializable
import kotlin.math.max

const val DefaultBrowserPaneWidthDp = 420f
const val MinBrowserPaneWidthDp = 320f
const val MaxBrowserPaneWidthDp = 640f

enum class PrimarySection(
    val label: String,
    val description: String,
) {
    Overview("Overview", "Dashboard and quick access"),
    Visualize("Visualize", "Inspect loaded data"),
    Analyze("Analyze", "Configure and run DDA"),
    Data("Data", "Repository and ingest utilities"),
    Learn("Learn", "Guides, datasets, and notes"),
    Plugins("Plugins", "Tooling and extension surfaces"),
    Collaborate("Collaborate", "Sharing and report workflows"),
    Settings("Settings", "Application preferences"),
    Notifications("Notifications", "Recent system messages"),
}

enum class VisualizeSection(val label: String) {
    TimeSeries("Time Series"),
    Annotations("Annotations"),
    Streaming("Streaming"),
}

enum class AnalyzeSection(val label: String) {
    Dda("DDA"),
    Ica("ICA"),
    Batch("Batch"),
    Connectivity("Connectivity"),
    Compare("Compare"),
}

enum class DataSection(val label: String) {
    OpenNeuro("OpenNeuro"),
    NsgJobs("NSG Jobs"),
}

enum class LearnSection(val label: String) {
    Tutorials("Tutorials"),
    SampleData("Sample Data"),
    Papers("Papers"),
}

enum class CollaborateSection(val label: String) {
    Gallery("Gallery"),
}

@Serializable
enum class ThemePreference {
    System,
    Light,
    Dark,
}

@Serializable
enum class NotificationLevel {
    Info,
    Success,
    Warning,
    Error,
}

@Serializable
enum class DdaVariantId(
    val code: String,
    val label: String,
) {
    ST("ST", "Single Timeseries"),
    CT("CT", "Cross Timeseries"),
    CD("CD", "Cross Dynamical"),
    DE("DE", "Dynamical Ergodicity"),
    SY("SY", "Synchronization");
}

enum class DatasetFormat(
    val label: String,
    val extensions: Set<String>,
) {
    EDF("EDF", setOf("edf")),
    CSV("CSV", setOf("csv")),
    ASCII("ASCII/TXT", setOf("ascii", "txt")),
    Unknown("Unknown", emptySet());
}

data class BrowserEntry(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val sizeBytes: Long,
    val modifiedAtEpochMs: Long,
    val supported: Boolean,
)

data class DirectorySnapshot(
    val path: String,
    val entries: List<BrowserEntry>,
)

data class WaveformEnvelopeLevel(
    val bucketSize: Int,
    val mins: FloatArray,
    val maxs: FloatArray,
)

data class ChannelWaveform(
    val name: String,
    val sampleRateHz: Double,
    val samples: DoubleArray,
    val unit: String?,
    val minValue: Float,
    val maxValue: Float,
    val levels: List<WaveformEnvelopeLevel>,
) {
    val durationSeconds: Double
        get() = if (sampleRateHz <= 0.0) 0.0 else samples.size / sampleRateHz
}

data class ChannelDescriptor(
    val name: String,
    val sampleRateHz: Double,
    val sampleCount: Long,
    val unit: String?,
)

data class WaveformWindow(
    val datasetFilePath: String,
    val startTimeSeconds: Double,
    val durationSeconds: Double,
    val channels: List<ChannelWaveform>,
    val fromCache: Boolean,
)

data class WaveformOverviewChannel(
    val name: String,
    val bucketDurationSeconds: Double,
    val mins: FloatArray,
    val maxs: FloatArray,
    val minValue: Float,
    val maxValue: Float,
)

data class WaveformOverview(
    val datasetFilePath: String,
    val durationSeconds: Double,
    val channels: List<WaveformOverviewChannel>,
    val fromCache: Boolean,
)

data class LoadedDataset(
    val filePath: String,
    val fileName: String,
    val format: DatasetFormat,
    val fileSizeBytes: Long,
    val durationSeconds: Double,
    val totalSampleCount: Long,
    val timeAxisName: String,
    val sourceSummary: String,
    val notes: List<String>,
    val channels: List<ChannelDescriptor>,
    val supportsWindowedAccess: Boolean,
) {
    val channelNames: List<String>
        get() = channels.map(ChannelDescriptor::name)

    val dominantSampleRateHz: Double
        get() = channels.maxOfOrNull(ChannelDescriptor::sampleRateHz) ?: 1.0
}

@Serializable
data class AppSettings(
    val dataRoot: String = "",
    val ddaBinaryPath: String = "",
    val themePreference: ThemePreference = ThemePreference.System,
    val expertMode: Boolean = false,
)

@Serializable
data class NotificationEntry(
    val id: String,
    val createdAtIso: String,
    val title: String,
    val message: String,
    val level: NotificationLevel,
)

@Serializable
data class DatasetAnnotationEntry(
    val id: String,
    val filePath: String,
    val fileName: String,
    val channelName: String? = null,
    val label: String,
    val note: String,
    val startTimeSeconds: Double,
    val endTimeSeconds: Double? = null,
    val createdAtIso: String,
)

@Serializable
data class AnnotationImportOutcome(
    val imported: List<DatasetAnnotationEntry>,
    val totalInFile: Int,
    val importedCount: Int,
    val skippedDuplicates: Int,
    val skippedNearDuplicates: Int,
    val warnings: List<String>,
)

@Serializable
data class DdaConfig(
    val selectedVariants: Set<DdaVariantId> = setOf(DdaVariantId.ST, DdaVariantId.DE),
    val windowLengthSamples: Int = 200,
    val windowStepSamples: Int = 100,
    val delayList: List<Int> = listOf(7, 10),
    val startTimeSeconds: Double = 0.0,
    val endTimeSeconds: Double? = null,
)

@Serializable
data class DdaVariantSnapshot(
    val id: DdaVariantId,
    val label: String,
    val rowLabels: List<String>,
    val matrix: List<List<Float>>,
    val summary: String,
    val minValue: Float,
    val maxValue: Float,
)

@Serializable
data class DdaResultSnapshot(
    val id: String,
    val filePath: String,
    val fileName: String,
    val createdAtIso: String,
    val engineLabel: String,
    val diagnostics: List<String>,
    val windowCentersSeconds: List<Float>,
    val variants: List<DdaVariantSnapshot>,
    val isFallback: Boolean,
)

@Serializable
data class IcaComponentSnapshot(
    val componentId: Int,
    val spatialMap: List<Float>,
    val timeSeriesPreview: List<Float>,
    val kurtosis: Double,
    val nonGaussianity: Double,
    val varianceExplained: Double,
    val powerFrequencies: List<Float>,
    val powerValues: List<Float>,
)

@Serializable
data class IcaResultSnapshot(
    val id: String,
    val filePath: String,
    val fileName: String,
    val createdAtIso: String,
    val channelNames: List<String>,
    val sampleRateHz: Double,
    val sampleCount: Int,
    val components: List<IcaComponentSnapshot>,
)

@Serializable
data class PluginInstalledEntry(
    val id: String,
    val name: String,
    val version: String,
    val description: String? = null,
    val author: String? = null,
    val category: String,
    val permissions: List<String>,
    val source: String,
    val sourceUrl: String? = null,
    val installedAt: String,
    val enabled: Boolean,
)

@Serializable
data class PluginRegistryEntry(
    val id: String,
    val name: String,
    val version: String,
    val description: String,
    val author: String,
    val category: String,
    val permissions: List<String>,
    val artifactUrl: String,
    val publishedAt: String,
)

@Serializable
data class PluginExecutionResult(
    val pluginId: String,
    val outputJson: String,
    val logs: List<String>,
)

@Serializable
data class NsgCredentialsStatus(
    val username: String,
    val hasPassword: Boolean,
    val hasAppKey: Boolean,
)

@Serializable
enum class NsgJobStatus {
    @kotlinx.serialization.SerialName("pending")
    Pending,

    @kotlinx.serialization.SerialName("submitted")
    Submitted,

    @kotlinx.serialization.SerialName("queue")
    Queue,

    @kotlinx.serialization.SerialName("inputstaging")
    InputStaging,

    @kotlinx.serialization.SerialName("running")
    Running,

    @kotlinx.serialization.SerialName("completed")
    Completed,

    @kotlinx.serialization.SerialName("failed")
    Failed,

    @kotlinx.serialization.SerialName("cancelled")
    Cancelled,
}

@Serializable
data class NsgJobSnapshot(
    val id: String,
    val nsgJobId: String? = null,
    val tool: String,
    val status: NsgJobStatus,
    val createdAt: String,
    val submittedAt: String? = null,
    val completedAt: String? = null,
    val inputFilePath: String,
    val outputFiles: List<String> = emptyList(),
    val errorMessage: String? = null,
    val lastPolled: String? = null,
    val progress: Int? = null,
)

@Serializable
data class AnalysisHistoryEntry(
    val id: String,
    val filePath: String,
    val fileName: String,
    val createdAtIso: String,
    val engineLabel: String,
    val variants: List<String>,
    val result: DdaResultSnapshot,
)

@Serializable
data class PersistedState(
    val settings: AppSettings = AppSettings(),
    val recentFiles: List<String> = emptyList(),
    val history: List<AnalysisHistoryEntry> = emptyList(),
    val icaHistory: List<IcaResultSnapshot> = emptyList(),
    val annotations: List<DatasetAnnotationEntry> = emptyList(),
    val notifications: List<NotificationEntry> = emptyList(),
    val browserPaneWidthDp: Float = DefaultBrowserPaneWidthDp,
    val browserPaneCollapsed: Boolean = false,
    val lastDirectory: String? = null,
    val lastFile: String? = null,
)

data class AppUiState(
    val settings: AppSettings = AppSettings(),
    val debugLogPath: String? = null,
    val primarySection: PrimarySection = PrimarySection.Overview,
    val visualizeSection: VisualizeSection = VisualizeSection.TimeSeries,
    val analyzeSection: AnalyzeSection = AnalyzeSection.Dda,
    val dataSection: DataSection = DataSection.OpenNeuro,
    val learnSection: LearnSection = LearnSection.Tutorials,
    val collaborateSection: CollaborateSection = CollaborateSection.Gallery,
    val browserPath: String = "",
    val browserSearch: String = "",
    val browserPaneWidthDp: Float = DefaultBrowserPaneWidthDp,
    val browserPaneCollapsed: Boolean = false,
    val directoryEntries: List<BrowserEntry> = emptyList(),
    val selectedDataset: LoadedDataset? = null,
    val selectedChannelNames: List<String> = emptyList(),
    val waveformWindow: WaveformWindow? = null,
    val waveformOverview: WaveformOverview? = null,
    val waveformViewportStartSeconds: Double = 0.0,
    val waveformViewportDurationSeconds: Double = 10.0,
    val isWaveformLoading: Boolean = false,
    val isOverviewLoading: Boolean = false,
    val waveformErrorMessage: String? = null,
    val ddaConfig: DdaConfig = DdaConfig(),
    val currentResult: DdaResultSnapshot? = null,
    val activeVariant: DdaVariantId? = null,
    val history: List<AnalysisHistoryEntry> = emptyList(),
    val currentIcaResult: IcaResultSnapshot? = null,
    val icaHistory: List<IcaResultSnapshot> = emptyList(),
    val installedPlugins: List<PluginInstalledEntry> = emptyList(),
    val pluginRegistry: List<PluginRegistryEntry> = emptyList(),
    val currentPluginOutput: PluginExecutionResult? = null,
    val nsgCredentials: NsgCredentialsStatus? = null,
    val nsgJobs: List<NsgJobSnapshot> = emptyList(),
    val nsgLastDownloadedPaths: List<String> = emptyList(),
    val annotations: List<DatasetAnnotationEntry> = emptyList(),
    val notifications: List<NotificationEntry> = emptyList(),
    val recentFiles: List<String> = emptyList(),
    val isDirectoryLoading: Boolean = false,
    val isDatasetLoading: Boolean = false,
    val isRunningAnalysis: Boolean = false,
    val isRunningIca: Boolean = false,
    val isPluginLoading: Boolean = false,
    val isPluginRegistryLoading: Boolean = false,
    val isNsgLoading: Boolean = false,
    val statusMessage: String = "Booting DDALAB KMP...",
    val errorMessage: String? = null,
)

interface AppBridge {
    fun debugLogPath(): String?
    suspend fun detectDefaultDataRoot(): String?
    suspend fun loadPersistedState(fallbackRoot: String): PersistedState
    suspend fun savePersistedState(state: PersistedState)
    suspend fun openDebugLog(): Boolean
    suspend fun openExternalUrl(url: String): Boolean
    suspend fun chooseRootDirectory(currentPath: String?): String?
    suspend fun chooseFile(currentPath: String?): String?
    suspend fun listDirectory(path: String): DirectorySnapshot
    suspend fun loadDataset(path: String): LoadedDataset
    suspend fun loadWaveformWindow(
        dataset: LoadedDataset,
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): WaveformWindow
    suspend fun loadWaveformOverview(
        dataset: LoadedDataset,
        channelNames: List<String>,
        maxBuckets: Int = 1600,
    ): WaveformOverview
    suspend fun runDdaAnalysis(
        dataset: LoadedDataset,
        config: DdaConfig,
        selectedChannelIndices: List<Int>,
        binaryOverridePath: String?,
    ): DdaResultSnapshot
    suspend fun runIcaAnalysis(
        dataset: LoadedDataset,
        selectedChannelIndices: List<Int>,
        startTimeSeconds: Double?,
        endTimeSeconds: Double?,
        nComponents: Int?,
        maxIterations: Int,
        tolerance: Double,
        centering: Boolean,
        whitening: Boolean,
    ): IcaResultSnapshot
    suspend fun listInstalledPlugins(): List<PluginInstalledEntry>
    suspend fun fetchPluginRegistry(): List<PluginRegistryEntry>
    suspend fun installPlugin(pluginId: String): PluginInstalledEntry
    suspend fun uninstallPlugin(pluginId: String)
    suspend fun setPluginEnabled(pluginId: String, enabled: Boolean): Boolean
    suspend fun runPlugin(
        pluginId: String,
        dataset: LoadedDataset,
        selectedChannelIndices: List<Int>,
    ): PluginExecutionResult
    suspend fun getNsgCredentialsStatus(): NsgCredentialsStatus?
    suspend fun saveNsgCredentials(username: String, password: String, appKey: String)
    suspend fun deleteNsgCredentials()
    suspend fun testNsgConnection(): Boolean
    suspend fun listNsgJobs(): List<NsgJobSnapshot>
    suspend fun createNsgJob(
        dataset: LoadedDataset,
        config: DdaConfig,
        selectedChannelIndices: List<Int>,
        runtimeHours: Double?,
        cores: Int?,
        nodes: Int?,
    ): NsgJobSnapshot
    suspend fun submitNsgJob(jobId: String): NsgJobSnapshot
    suspend fun refreshNsgJob(jobId: String): NsgJobSnapshot
    suspend fun cancelNsgJob(jobId: String)
    suspend fun downloadNsgResults(jobId: String): List<String>
    suspend fun exportDdaResult(result: DdaResultSnapshot, format: String): String?
    suspend fun exportAnnotations(
        dataset: LoadedDataset,
        annotations: List<DatasetAnnotationEntry>,
        format: String,
    ): String?
    suspend fun importAnnotations(
        dataset: LoadedDataset,
        existingAnnotations: List<DatasetAnnotationEntry>,
    ): AnnotationImportOutcome?
}

fun DdaVariantId.usesPairRows(): Boolean = this == DdaVariantId.CT || this == DdaVariantId.CD

fun DdaVariantId.isDirected(): Boolean = this == DdaVariantId.CD

fun defaultDdaConfigFor(dataset: LoadedDataset): DdaConfig {
    val baseRate = max(dataset.dominantSampleRateHz.toInt(), 1)
    val suggestedWindow = max(baseRate * 4, 64)
    return DdaConfig(
        selectedVariants = setOf(DdaVariantId.ST, DdaVariantId.DE, DdaVariantId.SY),
        windowLengthSamples = suggestedWindow,
        windowStepSamples = max(suggestedWindow / 2, 16),
        delayList = listOf(7, 10),
        startTimeSeconds = 0.0,
        endTimeSeconds = dataset.durationSeconds,
    )
}

fun humanizeBytes(bytes: Long): String {
    if (bytes <= 0L) return "0 B"
    val units = listOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var index = 0
    while (value >= 1024 && index < units.lastIndex) {
        value /= 1024.0
        index++
    }
    return "%,.1f %s".format(value, units[index])
}

fun humanizeDuration(seconds: Double): String {
    if (!seconds.isFinite() || seconds <= 0.0) return "0 s"
    val total = seconds.toInt()
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val secs = total % 60
    return buildString {
        if (hours > 0) append("${hours}h ")
        if (minutes > 0 || hours > 0) append("${minutes}m ")
        append("${secs}s")
    }.trim()
}

fun formatCompact(value: Double): String {
    return when {
        !value.isFinite() -> "n/a"
        value >= 100 -> "%,.0f".format(value)
        value >= 10 -> "%,.1f".format(value)
        else -> "%,.2f".format(value)
    }
}

fun String.normalizedSearchToken(): String = lowercase().trim()
