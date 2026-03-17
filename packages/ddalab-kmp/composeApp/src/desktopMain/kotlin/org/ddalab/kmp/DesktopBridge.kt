package org.ddalab.kmp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.File
import java.io.RandomAccessFile
import java.io.PrintWriter
import java.io.StringWriter
import java.awt.Desktop
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardOpenOption
import java.time.Instant
import java.util.Locale
import javax.swing.JFileChooser
import javax.swing.filechooser.FileNameExtensionFilter
import kotlin.concurrent.thread
import kotlin.io.path.absolutePathString
import kotlin.io.path.bufferedReader
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.inputStream
import kotlin.io.path.isDirectory
import kotlin.io.path.name
import kotlin.io.path.notExists
import kotlin.io.path.outputStream
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class DesktopBridge : AppBridge {
    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
    }

    private val supportedExtensions = setOf("edf", "csv", "ascii", "txt")
    private val datasetBackends = mutableMapOf<String, DesktopDatasetBackend>()
    private val repoRoot: Path = detectRepoRoot()
    private val appResourcesDir: Path? = detectAppResourcesDir()
    private val persistenceDir: Path = Paths.get(System.getProperty("user.home"), ".ddalab-kmp")
    private val persistenceFile: Path = persistenceDir.resolve("state.json")
    private val logFile: Path = persistenceDir.resolve("ddalab-kmp-debug.log")

    init {
        DesktopDebugLog.initialize(logFile)
        DesktopDebugLog.info("DesktopBridge initialized", mapOf(
            "repoRoot" to repoRoot.absolutePathString(),
            "appResourcesDir" to (appResourcesDir?.absolutePathString() ?: "unavailable"),
            "logFile" to logFile.absolutePathString(),
        ))
    }

    override fun debugLogPath(): String? = logFile.absolutePathString()

    override suspend fun detectDefaultDataRoot(): String? = withContext(Dispatchers.IO) {
        val candidate = repoRoot.resolve("data")
        DesktopDebugLog.debug("Detecting default data root", mapOf(
            "candidate" to candidate.absolutePathString(),
        ))
        when {
            candidate.exists() -> candidate.absolutePathString()
            repoRoot.exists() -> repoRoot.absolutePathString()
            else -> null
        }
    }

    override suspend fun loadPersistedState(fallbackRoot: String): PersistedState =
        withContext(Dispatchers.IO) {
            if (persistenceFile.notExists()) {
                PersistedState(settings = AppSettings(dataRoot = fallbackRoot))
            } else {
                runCatching {
                    json.decodeFromString<PersistedState>(persistenceFile.readText())
                }.getOrElse {
                    PersistedState(settings = AppSettings(dataRoot = fallbackRoot))
                }.let { persisted ->
                    persisted.copy(
                        settings = persisted.settings.copy(
                            dataRoot = persisted.settings.dataRoot.ifBlank { fallbackRoot },
                        ),
                    )
                }
            }
        }

    override suspend fun savePersistedState(state: PersistedState) {
        withContext(Dispatchers.IO) {
            persistenceDir.createDirectories()
            persistenceFile.writeText(json.encodeToString(PersistedState.serializer(), state))
        }
    }

    override suspend fun openDebugLog(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            persistenceDir.createDirectories()
            if (logFile.notExists()) {
                logFile.writeText("DDALAB KMP debug log initialized at ${Instant.now()}\n")
            }
            when {
                Desktop.isDesktopSupported() -> {
                    val desktop = Desktop.getDesktop()
                    when {
                        desktop.isSupported(Desktop.Action.OPEN) -> {
                            desktop.open(logFile.toFile())
                            true
                        }
                        desktop.isSupported(Desktop.Action.BROWSE_FILE_DIR) -> {
                            desktop.browseFileDirectory(logFile.toFile())
                            true
                        }
                        else -> false
                    }
                }
                else -> false
            }
        }.getOrElse { error ->
            DesktopDebugLog.error("Failed to open debug log", error)
            false
        }
    }

    override suspend fun openExternalUrl(url: String): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            when {
                Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE) -> {
                    Desktop.getDesktop().browse(java.net.URI(url))
                    true
                }
                else -> false
            }
        }.getOrElse { error ->
            DesktopDebugLog.error("Failed to open external URL", error, fields = mapOf("url" to url))
            false
        }
    }

    override suspend fun chooseRootDirectory(currentPath: String?): String? =
        withContext(Dispatchers.IO) {
            val chooser = JFileChooser(currentPath ?: detectDefaultDataRoot())
            chooser.fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
            chooser.dialogTitle = "Choose DDALAB data root"
            val result = chooser.showOpenDialog(null)
            if (result == JFileChooser.APPROVE_OPTION) {
                chooser.selectedFile?.absolutePath
            } else {
                null
            }
        }

    override suspend fun chooseFile(currentPath: String?): String? = withContext(Dispatchers.IO) {
        val chooser = JFileChooser(currentPath ?: detectDefaultDataRoot())
        chooser.fileSelectionMode = JFileChooser.FILES_ONLY
        chooser.dialogTitle = "Open dataset"
        chooser.fileFilter = FileNameExtensionFilter(
            "Supported neurophysiology files",
            "edf",
            "csv",
            "ascii",
            "txt",
        )
        val result = chooser.showOpenDialog(null)
        if (result == JFileChooser.APPROVE_OPTION) {
            chooser.selectedFile?.absolutePath
        } else {
            null
        }
    }

    override suspend fun listDirectory(path: String): DirectorySnapshot = withContext(Dispatchers.IO) {
        DesktopDebugLog.debug("Listing directory", mapOf("path" to path))
        val directory = Paths.get(path)
        require(directory.exists() && directory.isDirectory()) {
            "Directory does not exist: $path"
        }
        val entries = Files.list(directory).use { stream ->
            stream
                .map { child ->
                    val name = child.fileName?.toString().orEmpty()
                    val extension = name.substringAfterLast('.', "").lowercase(Locale.US)
                    val isDirectory = Files.isDirectory(child)
                    BrowserEntry(
                        name = name,
                        path = child.absolutePathString(),
                        isDirectory = isDirectory,
                        sizeBytes = if (isDirectory) 0L else runCatching { Files.size(child) }.getOrDefault(0L),
                        modifiedAtEpochMs = runCatching {
                            Files.getLastModifiedTime(child).toMillis()
                        }.getOrDefault(0L),
                        supported = isDirectory || supportedExtensions.contains(extension),
                    )
                }
                .toList()
        }
        DesktopDebugLog.debug("Directory listed", mapOf(
            "path" to directory.absolutePathString(),
            "entries" to entries.size.toString(),
        ))
        DirectorySnapshot(path = directory.absolutePathString(), entries = entries)
    }

    override suspend fun loadDataset(path: String): LoadedDataset = withContext(Dispatchers.IO) {
        val file = Paths.get(path)
        require(file.exists()) { "File not found: $path" }
        val extension = file.extensionLowercase()
        val fileSize = runCatching { Files.size(file) }.getOrDefault(-1L)
        DesktopDebugLog.info("Loading dataset", mapOf(
            "path" to path,
            "extension" to extension,
            "sizeBytes" to fileSize.toString(),
        ))

        runCatching {
            val backend = datasetBackends[path] ?: loadDesktopDatasetBackend(file).also {
                datasetBackends[path] = it
            }
            backend.dataset
        }.onSuccess { dataset ->
            DesktopDebugLog.info("Dataset loaded", mapOf(
                "file" to dataset.fileName,
                "format" to dataset.format.label,
                "channels" to dataset.channels.size.toString(),
                "samples" to dataset.totalSampleCount.toString(),
                "durationSeconds" to dataset.durationSeconds.toString(),
                "windowed" to dataset.supportsWindowedAccess.toString(),
            ))
        }.onFailure { error ->
            DesktopDebugLog.error("Dataset load failed for $path", error)
        }.getOrThrow()
    }

    override suspend fun loadWaveformWindow(
        dataset: LoadedDataset,
        startTimeSeconds: Double,
        durationSeconds: Double,
        channelNames: List<String>,
    ): WaveformWindow = withContext(Dispatchers.IO) {
        requireBackend(dataset).loadWaveformWindow(
            startTimeSeconds = startTimeSeconds,
            durationSeconds = durationSeconds,
            channelNames = channelNames,
        )
    }

    override suspend fun loadWaveformOverview(
        dataset: LoadedDataset,
        channelNames: List<String>,
        maxBuckets: Int,
    ): WaveformOverview = withContext(Dispatchers.IO) {
        requireBackend(dataset).loadWaveformOverview(
            channelNames = channelNames,
            maxBuckets = maxBuckets,
        )
    }

    override suspend fun runDdaAnalysis(
        dataset: LoadedDataset,
        config: DdaConfig,
        selectedChannelIndices: List<Int>,
        binaryOverridePath: String?,
    ): DdaResultSnapshot = withContext(Dispatchers.IO) {
        DesktopDebugLog.info("Starting DDA analysis", mapOf(
            "file" to dataset.filePath,
            "selectedChannels" to selectedChannelIndices.joinToString(),
            "variants" to config.selectedVariants.joinToString { it.code },
        ))
        val binaryPath = findDdaBinary(binaryOverridePath)
        val cliCommand = findCliCommand()
        val selectedChannels = selectedChannelIndices.map { dataset.channelNames[it] }
        val variants = config.selectedVariants.sortedBy { it.ordinal }
        val sampleRateForBounds = dataset.dominantSampleRateHz.coerceAtLeast(1.0)
        val requestedStartSeconds = config.startTimeSeconds.coerceAtLeast(0.0)
        val requestedEndSeconds = (config.endTimeSeconds ?: dataset.durationSeconds)
            .coerceAtLeast(requestedStartSeconds)
        val requestedStartSample = (requestedStartSeconds * sampleRateForBounds).toLong().coerceAtLeast(0L)
        val requestedEndSample = ceil(requestedEndSeconds * sampleRateForBounds).toLong().coerceAtLeast(requestedStartSample)
        val totalSamples = dataset.totalSampleCount.coerceAtLeast(0L)
        val safetyMargin = minOf(256L, totalSamples / 10L)
        val boundedEndSample = if (totalSamples > 0L) {
            minOf(requestedEndSample, totalSamples)
        } else {
            requestedEndSample
        }
        val safeEndSample = when {
            totalSamples <= 0L -> boundedEndSample
            totalSamples > safetyMargin -> minOf(boundedEndSample, totalSamples - safetyMargin)
            else -> boundedEndSample
        }.coerceAtLeast(requestedStartSample + 1L)

        val inputFile = if (dataset.format == DatasetFormat.EDF) {
            Path.of(dataset.filePath)
        } else {
            writeNormalizedAscii(dataset)
        }

        val orderedPairs = buildDirectedPairs(selectedChannelIndices)
        val unorderedPairs = buildUndirectedPairs(selectedChannelIndices)

        val command = buildList {
            addAll(cliCommand)
            add("run")
            add("--file")
            add(inputFile.absolutePathString())
            add("--channels")
            addAll(selectedChannelIndices.map(Int::toString))
            add("--variants")
            addAll(variants.map(DdaVariantId::code))
            add("--wl")
            add(config.windowLengthSamples.toString())
            add("--ws")
            add(config.windowStepSamples.toString())
            add("--delays")
            addAll(config.delayList.map(Int::toString))
            add("--start-sample")
            add(requestedStartSample.toString())
            add("--end-sample")
            add(safeEndSample.toString())
            add("--binary")
            add(binaryPath.absolutePathString())
            if (variants.contains(DdaVariantId.CT) && unorderedPairs.isNotEmpty()) {
                add("--ct-pairs")
                addAll(unorderedPairs.map { "${it.first},${it.second}" })
            }
            if (variants.contains(DdaVariantId.CD) && orderedPairs.isNotEmpty()) {
                add("--cd-pairs")
                addAll(orderedPairs.map { "${it.first},${it.second}" })
            }
            add("--compact")
            add("--quiet")
        }

        val diagnostics = mutableListOf(
            "Requested variants: ${variants.joinToString { it.code }}",
            "Selected channels: ${selectedChannels.joinToString()}",
            "Window: ${config.windowLengthSamples}/${config.windowStepSamples} samples",
            "Bounds: ${requestedStartSample}-${safeEndSample} samples @ ${formatCompact(sampleRateForBounds)} Hz",
        )

        runCatching {
            DesktopDebugLog.debug("Launching DDA process", mapOf(
                "command" to command.joinToString(" "),
                "requestedStartSeconds" to requestedStartSeconds.toString(),
                "requestedEndSeconds" to requestedEndSeconds.toString(),
                "startSample" to requestedStartSample.toString(),
                "endSample" to safeEndSample.toString(),
            ))
            val process = ProcessBuilder(command)
                .directory(repoRoot.toFile())
                .start()
            val output = process.readOutput()
            DesktopDebugLog.debug("DDA process completed", mapOf(
                "exitCode" to output.exitCode.toString(),
                "stdoutBytes" to output.stdout.length.toString(),
                "stderrBytes" to output.stderr.length.toString(),
            ))
            if (output.stderr.isNotBlank()) {
                diagnostics += output.stderr.lineSequence().take(3).joinToString(" | ")
            }
            if (output.exitCode != 0 || output.stdout.isBlank()) {
                error("Native DDA process failed${if (output.stderr.isNotBlank()) ": ${output.stderr}" else ""}")
            }
            val parsed = json.decodeFromString(CliDdaResult.serializer(), output.stdout)
            mapCliResult(
                dataset = dataset,
                config = config,
                selectedIndices = selectedChannelIndices,
                parsed = parsed,
                diagnostics = diagnostics + "Engine: Rust CLI + run_DDA_AsciiEdf",
            )
        }.getOrElse { error ->
            DesktopDebugLog.error("Native DDA failed; using fallback analysis", error)
            buildFallbackAnalysis(
                dataset = dataset,
                config = config,
                selectedIndices = selectedChannelIndices,
                reason = error.message ?: "Native DDA execution failed",
            )
        }.also {
            if (inputFile != Path.of(dataset.filePath) && inputFile.exists()) {
                runCatching { Files.deleteIfExists(inputFile) }
            }
        }
    }

    override suspend fun runIcaAnalysis(
        dataset: LoadedDataset,
        selectedChannelIndices: List<Int>,
        startTimeSeconds: Double?,
        endTimeSeconds: Double?,
        nComponents: Int?,
        maxIterations: Int,
        tolerance: Double,
        centering: Boolean,
        whitening: Boolean,
    ): IcaResultSnapshot = withContext(Dispatchers.IO) {
        val command = buildList {
            addAll(findKmpBridgeCommand())
            add("ica-run")
            add("--file")
            add(dataset.filePath)
            if (selectedChannelIndices.isNotEmpty()) {
                add("--channels")
                add(selectedChannelIndices.joinToString(","))
            }
            startTimeSeconds?.let {
                add("--start")
                add(it.toString())
            }
            endTimeSeconds?.let {
                add("--end")
                add(it.toString())
            }
            nComponents?.let {
                add("--n-components")
                add(it.toString())
            }
            add("--max-iterations")
            add(maxIterations.toString())
            add("--tolerance")
            add(tolerance.toString())
            add("--centering")
            add(centering.toString())
            add("--whitening")
            add(whitening.toString())
        }

        DesktopDebugLog.info("Starting ICA analysis", mapOf(
            "file" to dataset.filePath,
            "channels" to selectedChannelIndices.joinToString(),
            "nComponents" to (nComponents?.toString() ?: "auto"),
        ))

        val bridgeResult = runNativeBridge(command)
        val parsed = json.decodeFromString(BridgeIcaResponse.serializer(), bridgeResult.stdout)
        val ica = parsed.result
        IcaResultSnapshot(
            id = parsed.id,
            filePath = parsed.filePath,
            fileName = Path.of(parsed.filePath).fileName.toString(),
            createdAtIso = parsed.createdAt,
            channelNames = ica.channelNames,
            sampleRateHz = ica.sampleRate,
            sampleCount = ica.nSamples,
            components = ica.components.map { component ->
                IcaComponentSnapshot(
                    componentId = component.componentId,
                    spatialMap = component.spatialMap.map(Double::toFloat),
                    timeSeriesPreview = downsample(component.timeSeries, 768).map(Double::toFloat),
                    kurtosis = component.kurtosis,
                    nonGaussianity = component.nonGaussianity,
                    varianceExplained = component.varianceExplained,
                    powerFrequencies = downsample(component.powerSpectrum?.frequencies.orEmpty(), 256)
                        .map(Double::toFloat),
                    powerValues = downsample(component.powerSpectrum?.power.orEmpty(), 256)
                        .map(Double::toFloat),
                )
            },
        )
    }

    override suspend fun listInstalledPlugins(): List<PluginInstalledEntry> = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("plugin-list")
            },
        )
        json.decodeFromString(ListSerializer(PluginInstalledEntry.serializer()), result.stdout)
    }

    override suspend fun fetchPluginRegistry(): List<PluginRegistryEntry> = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("plugin-fetch-registry")
                add("--registry")
                add(defaultPluginRegistryPath())
            },
        )
        json.decodeFromString(BridgePluginRegistryIndex.serializer(), result.stdout).plugins.map {
            PluginRegistryEntry(
                id = it.id,
                name = it.name,
                version = it.version,
                description = it.description,
                author = it.author,
                category = it.category,
                permissions = it.permissions,
                artifactUrl = it.artifactUrl,
                publishedAt = it.publishedAt,
            )
        }
    }

    override suspend fun installPlugin(pluginId: String): PluginInstalledEntry = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("plugin-install")
                add("--registry")
                add(defaultPluginRegistryPath())
                add("--plugin-id")
                add(pluginId)
            },
        )
        json.decodeFromString(PluginInstalledEntry.serializer(), result.stdout)
    }

    override suspend fun uninstallPlugin(pluginId: String) {
        withContext(Dispatchers.IO) {
            runNativeBridge(
                buildList {
                    addAll(findKmpBridgeCommand())
                    add("plugin-uninstall")
                    add("--plugin-id")
                    add(pluginId)
                },
            )
        }
    }

    override suspend fun setPluginEnabled(pluginId: String, enabled: Boolean): Boolean = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("plugin-toggle")
                add("--plugin-id")
                add(pluginId)
                add("--enabled")
                add(enabled.toString())
            },
        )
        json.decodeFromString(BridgeToggleResponse.serializer(), result.stdout).enabled
    }

    override suspend fun runPlugin(
        pluginId: String,
        dataset: LoadedDataset,
        selectedChannelIndices: List<Int>,
    ): PluginExecutionResult = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("plugin-run")
                add("--plugin-id")
                add(pluginId)
                add("--file")
                add(dataset.filePath)
                if (selectedChannelIndices.isNotEmpty()) {
                    add("--channels")
                    add(selectedChannelIndices.joinToString(","))
                }
            },
        )
        val parsed = json.decodeFromString(BridgePluginOutput.serializer(), result.stdout)
        PluginExecutionResult(
            pluginId = parsed.pluginId,
            outputJson = json.encodeToString(JsonElement.serializer(), parsed.results),
            logs = parsed.logs,
        )
    }

    override suspend fun getNsgCredentialsStatus(): NsgCredentialsStatus? = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("nsg-get-credentials")
            },
        )
        if (result.stdout == "null") {
            null
        } else {
            json.decodeFromString(BridgeNsgCredentialsStatus.serializer(), result.stdout).let {
                NsgCredentialsStatus(
                    username = it.username,
                    hasPassword = it.hasPassword,
                    hasAppKey = it.hasAppKey,
                )
            }
        }
    }

    override suspend fun saveNsgCredentials(username: String, password: String, appKey: String) {
        withContext(Dispatchers.IO) {
            runNativeBridge(
                buildList {
                    addAll(findKmpBridgeCommand())
                    add("nsg-save-credentials")
                    add("--username")
                    add(username)
                    add("--password")
                    add(password)
                    add("--app-key")
                    add(appKey)
                },
            )
        }
    }

    override suspend fun deleteNsgCredentials() {
        withContext(Dispatchers.IO) {
            runNativeBridge(
                buildList {
                    addAll(findKmpBridgeCommand())
                    add("nsg-delete-credentials")
                },
            )
        }
    }

    override suspend fun testNsgConnection(): Boolean = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("nsg-test-connection")
            },
        )
        json.decodeFromString(BridgeConnectivityResponse.serializer(), result.stdout).connected
    }

    override suspend fun listNsgJobs(): List<NsgJobSnapshot> = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("nsg-list-jobs")
            },
        )
        json.decodeFromString(
            ListSerializer(BridgeNsgJob.serializer()),
            result.stdout,
        ).map(::mapNsgJob)
    }

    override suspend fun createNsgJob(
        dataset: LoadedDataset,
        config: DdaConfig,
        selectedChannelIndices: List<Int>,
        runtimeHours: Double?,
        cores: Int?,
        nodes: Int?,
    ): NsgJobSnapshot = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("nsg-create-job")
                add("--file")
                add(dataset.filePath)
                if (selectedChannelIndices.isNotEmpty()) {
                    add("--channels")
                    add(selectedChannelIndices.joinToString(","))
                }
                add("--variants")
                add(config.selectedVariants.joinToString(",") { it.code })
                add("--delays")
                add(config.delayList.joinToString(","))
                add("--start")
                add(config.startTimeSeconds.toString())
                add("--end")
                add((config.endTimeSeconds ?: dataset.durationSeconds).toString())
                add("--window-length")
                add(config.windowLengthSamples.toString())
                add("--window-step")
                add(config.windowStepSamples.toString())
                runtimeHours?.let {
                    add("--runtime-hours")
                    add(it.toString())
                }
                cores?.let {
                    add("--cores")
                    add(it.toString())
                }
                nodes?.let {
                    add("--nodes")
                    add(it.toString())
                }
            },
        )
        mapNsgJob(json.decodeFromString(BridgeNsgJob.serializer(), result.stdout))
    }

    override suspend fun submitNsgJob(jobId: String): NsgJobSnapshot = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("nsg-submit-job")
                add("--job-id")
                add(jobId)
            },
        )
        mapNsgJob(json.decodeFromString(BridgeNsgJob.serializer(), result.stdout))
    }

    override suspend fun refreshNsgJob(jobId: String): NsgJobSnapshot = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("nsg-refresh-job")
                add("--job-id")
                add(jobId)
            },
        )
        mapNsgJob(json.decodeFromString(BridgeNsgJob.serializer(), result.stdout))
    }

    override suspend fun cancelNsgJob(jobId: String) {
        withContext(Dispatchers.IO) {
            runNativeBridge(
                buildList {
                    addAll(findKmpBridgeCommand())
                    add("nsg-cancel-job")
                    add("--job-id")
                    add(jobId)
                },
            )
        }
    }

    override suspend fun downloadNsgResults(jobId: String): List<String> = withContext(Dispatchers.IO) {
        val result = runNativeBridge(
            buildList {
                addAll(findKmpBridgeCommand())
                add("nsg-download-results")
                add("--job-id")
                add(jobId)
            },
        )
        json.decodeFromString(ListSerializer(String.serializer()), result.stdout)
    }

    override suspend fun exportDdaResult(result: DdaResultSnapshot, format: String): String? = withContext(Dispatchers.IO) {
        val extension = if (format.equals("csv", ignoreCase = true)) "csv" else "json"
        val chooser = JFileChooser(persistenceDir.toFile())
        chooser.dialogTitle = "Export DDA result"
        chooser.fileSelectionMode = JFileChooser.FILES_ONLY
        chooser.fileFilter = FileNameExtensionFilter("${extension.uppercase(Locale.US)} files", extension)
        chooser.selectedFile = File(
            persistenceDir.toFile(),
            buildString {
                append(result.fileName.substringBeforeLast('.', result.fileName))
                append("-")
                append(result.id.take(8))
                append(".")
                append(extension)
            },
        )

        val selectedPath = if (chooser.showSaveDialog(null) == JFileChooser.APPROVE_OPTION) {
            chooser.selectedFile?.toPath()
        } else {
            null
        } ?: return@withContext null

        val payload = if (extension == "csv") {
            renderDdaCsv(result)
        } else {
            json.encodeToString(DdaResultSnapshot.serializer(), result)
        }
        selectedPath.parent?.createDirectories()
        Files.writeString(selectedPath, payload, StandardCharsets.UTF_8)
        selectedPath.absolutePathString()
    }

    override suspend fun exportAnnotations(
        dataset: LoadedDataset,
        annotations: List<DatasetAnnotationEntry>,
        format: String,
    ): String? = withContext(Dispatchers.IO) {
        val extension = if (format.equals("csv", ignoreCase = true)) "csv" else "json"
        val chooser = JFileChooser(persistenceDir.toFile())
        chooser.dialogTitle = "Export annotations"
        chooser.fileSelectionMode = JFileChooser.FILES_ONLY
        chooser.fileFilter = FileNameExtensionFilter("${extension.uppercase(Locale.US)} files", extension)
        chooser.selectedFile = File(
            persistenceDir.toFile(),
            "${dataset.fileName.substringBeforeLast('.', dataset.fileName)}-annotations.$extension",
        )

        val selectedPath = if (chooser.showSaveDialog(null) == JFileChooser.APPROVE_OPTION) {
            chooser.selectedFile?.toPath()
        } else {
            null
        } ?: return@withContext null

        val payload = buildAnnotationExchange(dataset, annotations)
        val content = if (extension == "csv") {
            renderAnnotationCsv(payload)
        } else {
            json.encodeToString(AnnotationExchangeFile.serializer(), payload)
        }
        selectedPath.parent?.createDirectories()
        Files.writeString(selectedPath, content, StandardCharsets.UTF_8)
        selectedPath.absolutePathString()
    }

    override suspend fun importAnnotations(
        dataset: LoadedDataset,
        existingAnnotations: List<DatasetAnnotationEntry>,
    ): AnnotationImportOutcome? = withContext(Dispatchers.IO) {
        val chooser = JFileChooser(persistenceDir.toFile())
        chooser.dialogTitle = "Import annotations"
        chooser.fileSelectionMode = JFileChooser.FILES_ONLY
        chooser.fileFilter = FileNameExtensionFilter("Annotation files", "json")
        val selectedPath = if (chooser.showOpenDialog(null) == JFileChooser.APPROVE_OPTION) {
            chooser.selectedFile?.toPath()
        } else {
            null
        } ?: return@withContext null

        val raw = selectedPath.readText()
        val importedFile = runCatching {
            json.decodeFromString(AnnotationExchangeFile.serializer(), raw)
        }.getOrElse {
            val multi = json.decodeFromString(AnnotationExchangeBundle.serializer(), raw)
            multi.files[dataset.filePath]
                ?: multi.files.entries.firstOrNull { (path, _) ->
                    Path.of(path).fileName?.toString() == dataset.fileName
                }?.value
                ?: multi.files.values.firstOrNull()
                ?: error("No annotations were found in the selected file.")
        }

        val importedEntries = mutableListOf<DatasetAnnotationEntry>()
        var skippedDuplicates = 0
        var skippedNearDuplicates = 0
        val warnings = mutableListOf<String>()

        fun isDuplicate(existing: DatasetAnnotationEntry, incoming: AnnotationExchangeEntry, channel: String?): Boolean {
            return existing.channelName == channel &&
                existing.label == incoming.label &&
                abs(existing.startTimeSeconds - incoming.position) < 0.01
        }

        fun isNearDuplicate(existing: DatasetAnnotationEntry, incoming: AnnotationExchangeEntry, channel: String?): Boolean {
            return existing.channelName == channel &&
                existing.label == incoming.label &&
                abs(existing.startTimeSeconds - incoming.position) < 0.5
        }

        val existingForDataset = existingAnnotations.filter { it.filePath == dataset.filePath }

        fun importEntries(entries: List<AnnotationExchangeEntry>, channel: String?) {
            entries.forEach { entry ->
                when {
                    existingForDataset.any { isDuplicate(it, entry, channel) } ||
                        importedEntries.any {
                            it.channelName == channel &&
                                it.label == entry.label &&
                                abs(it.startTimeSeconds - entry.position) < 0.01
                        } -> {
                            skippedDuplicates += 1
                        }

                    existingForDataset.any { isNearDuplicate(it, entry, channel) } -> {
                        skippedNearDuplicates += 1
                        warnings += "Skipped near-duplicate '${entry.label}' at ${formatCompact(entry.position)}s"
                    }

                    else -> {
                        importedEntries += DatasetAnnotationEntry(
                            id = entry.id.ifBlank { "annotation-${System.currentTimeMillis()}-${importedEntries.size}" },
                            filePath = dataset.filePath,
                            fileName = dataset.fileName,
                            channelName = channel,
                            label = entry.label,
                            note = entry.description.orEmpty(),
                            startTimeSeconds = entry.position,
                            endTimeSeconds = null,
                            createdAtIso = entry.createdAt.ifBlank { Instant.now().toString() },
                        )
                    }
                }
            }
        }

        importEntries(importedFile.globalAnnotations, null)
        importedFile.channelAnnotations.forEach { (channel, entries) ->
            importEntries(entries, channel)
        }

        AnnotationImportOutcome(
            imported = importedEntries,
            totalInFile = importedFile.globalAnnotations.size +
                importedFile.channelAnnotations.values.sumOf(List<AnnotationExchangeEntry>::size),
            importedCount = importedEntries.size,
            skippedDuplicates = skippedDuplicates,
            skippedNearDuplicates = skippedNearDuplicates,
            warnings = warnings,
        )
    }

    private fun detectRepoRoot(): Path {
        var current = Paths.get(System.getProperty("user.dir")).toAbsolutePath()
        repeat(8) {
            if (current.resolve("package.json").exists() && current.resolve("packages").exists()) {
                return current
            }
            current = current.parent ?: return current
        }
        return Paths.get(System.getProperty("user.dir")).toAbsolutePath()
    }

    private fun detectAppResourcesDir(): Path? {
        val configured = System.getProperty("compose.application.resources.dir")
            ?.takeIf(String::isNotBlank)
            ?.let(Paths::get)
            ?.toAbsolutePath()
            ?: return null
        return configured.takeIf(Path::exists)
    }

    private fun Path.extensionLowercase(): String =
        fileName.toString().substringAfterLast('.', "").lowercase(Locale.US)

    private fun defaultPluginRegistryPath(): String =
        repoRoot.resolve("packages/ddalab-registry").absolutePathString()

    private fun currentDdaBinaryName(): String =
        if (System.getProperty("os.name").lowercase(Locale.US).contains("win")) {
            "run_DDA_AsciiEdf.exe"
        } else {
            "run_DDA_AsciiEdf"
        }

    private fun currentCliBinaryName(): String =
        if (System.getProperty("os.name").lowercase(Locale.US).contains("win")) {
            "ddalab.exe"
        } else {
            "ddalab"
        }

    private fun findBundledBinary(binaryName: String): Path? {
        val resourcesDir = appResourcesDir ?: return null
        val candidate = resourcesDir.resolve("bin").resolve(binaryName)
        return candidate.takeIf(Path::exists)
    }

    private fun findKmpBridgeCommand(): List<String> {
        val builtBridge = repoRoot.resolve("packages/ddalab-tauri/src-tauri/target/debug/ddalab-kmp-bridge")
        if (builtBridge.exists()) {
            return listOf(builtBridge.absolutePathString())
        }
        return listOf(
            "cargo",
            "run",
            "--manifest-path",
            repoRoot.resolve("packages/ddalab-tauri/src-tauri/Cargo.toml").absolutePathString(),
            "--bin",
            "ddalab-kmp-bridge",
            "--",
        )
    }

    private fun runNativeBridge(command: List<String>): ProcessOutput {
        DesktopDebugLog.debug("Launching native bridge", mapOf("command" to command.joinToString(" ")))
        val process = ProcessBuilder(command)
            .directory(repoRoot.toFile())
            .apply {
                environment()["DDALAB_KMP_HOME"] = persistenceDir.resolve("native-bridge").absolutePathString()
            }
            .start()
        val output = process.readOutput()
        if (output.exitCode != 0) {
            DesktopDebugLog.error(
                "Native bridge command failed",
                fields = mapOf(
                    "command" to command.joinToString(" "),
                    "exitCode" to output.exitCode.toString(),
                    "stderr" to output.stderr,
                ),
            )
            error(output.stderr.ifBlank { "Native bridge command failed with exit code ${output.exitCode}" })
        }
        return output
    }

    private fun downsample(values: List<Double>, maxPoints: Int): List<Double> {
        if (values.size <= maxPoints || maxPoints <= 0) return values
        val step = values.size.toDouble() / maxPoints.toDouble()
        return List(maxPoints) { index ->
            values[(index * step).toInt().coerceIn(0, values.lastIndex)]
        }
    }

    private fun renderDdaCsv(result: DdaResultSnapshot): String {
        val rows = mutableListOf("analysis_id,file_name,variant,row_label,window_center_seconds,value")
        result.variants.forEach { variant ->
            variant.matrix.forEachIndexed { rowIndex, row ->
                val rowLabel = variant.rowLabels.getOrElse(rowIndex) { "Row ${rowIndex + 1}" }
                row.forEachIndexed { columnIndex, value ->
                    val window = result.windowCentersSeconds.getOrElse(columnIndex) { 0f }
                    rows += listOf(
                        csvCell(result.id),
                        csvCell(result.fileName),
                        csvCell(variant.id.code),
                        csvCell(rowLabel),
                        window.toString(),
                        value.toString(),
                    ).joinToString(",")
                }
            }
        }
        return rows.joinToString("\n")
    }

    private fun csvCell(value: String): String =
        "\"${value.replace("\"", "\"\"")}\""

    private fun buildAnnotationExchange(
        dataset: LoadedDataset,
        annotations: List<DatasetAnnotationEntry>,
    ): AnnotationExchangeFile {
        val global = mutableListOf<AnnotationExchangeEntry>()
        val channelEntries = linkedMapOf<String, MutableList<AnnotationExchangeEntry>>()

        annotations
            .filter { it.filePath == dataset.filePath }
            .forEach { annotation ->
                val exchange = AnnotationExchangeEntry(
                    id = annotation.id,
                    position = annotation.startTimeSeconds,
                    positionSamples = (annotation.startTimeSeconds * dataset.dominantSampleRateHz).toLong(),
                    label = annotation.label,
                    description = annotation.note.ifBlank {
                        annotation.endTimeSeconds?.let { "Range end: ${formatCompact(it)}s" }.orEmpty()
                    }.ifBlank { null },
                    color = null,
                    createdAt = annotation.createdAtIso,
                    updatedAt = null,
                )
                val channel = annotation.channelName
                if (channel.isNullOrBlank()) {
                    global += exchange
                } else {
                    channelEntries.getOrPut(channel) { mutableListOf() } += exchange
                }
            }

        return AnnotationExchangeFile(
            version = "1.0",
            filePath = dataset.filePath,
            fileHash = null,
            sampleRate = dataset.dominantSampleRateHz,
            duration = dataset.durationSeconds,
            globalAnnotations = global,
            channelAnnotations = channelEntries,
            metadata = AnnotationExchangeMetadata(
                author = null,
                exportedAt = Instant.now().toString(),
                appVersion = "ddalab-kmp",
                notes = null,
            ),
        )
    }

    private fun renderAnnotationCsv(file: AnnotationExchangeFile): String {
        val rows = mutableListOf(
            "file_path,channel,position_seconds,position_samples,label,description,id,created_at",
        )
        file.globalAnnotations.forEach { entry ->
            rows += listOf(
                csvCell(file.filePath),
                csvCell("global"),
                entry.position.toString(),
                entry.positionSamples?.toString() ?: "",
                csvCell(entry.label),
                csvCell(entry.description.orEmpty()),
                csvCell(entry.id),
                csvCell(entry.createdAt),
            ).joinToString(",")
        }
        file.channelAnnotations.forEach { (channel, entries) ->
            entries.forEach { entry ->
                rows += listOf(
                    csvCell(file.filePath),
                    csvCell(channel),
                    entry.position.toString(),
                    entry.positionSamples?.toString() ?: "",
                    csvCell(entry.label),
                    csvCell(entry.description.orEmpty()),
                    csvCell(entry.id),
                    csvCell(entry.createdAt),
                ).joinToString(",")
            }
        }
        return rows.joinToString("\n")
    }

    private fun mapNsgJob(job: BridgeNsgJob): NsgJobSnapshot = NsgJobSnapshot(
        id = job.id,
        nsgJobId = job.nsgJobId,
        tool = job.tool,
        status = job.status,
        createdAt = job.createdAt,
        submittedAt = job.submittedAt,
        completedAt = job.completedAt,
        inputFilePath = job.inputFilePath,
        outputFiles = job.outputFiles,
        errorMessage = job.errorMessage,
        lastPolled = job.lastPolled,
        progress = job.progress,
    )

    private fun findDdaBinary(overridePath: String?): Path {
        if (!overridePath.isNullOrBlank()) {
            val explicit = Path.of(overridePath)
            if (explicit.exists()) return explicit
        }
        val binaryName = currentDdaBinaryName()
        val bundledBinary = findBundledBinary(binaryName)
        if (bundledBinary != null) return bundledBinary

        val repoBinary = repoRoot.resolve("bin").resolve(binaryName)
        if (repoBinary.exists()) return repoBinary

        val env = System.getenv("DDA_BINARY_PATH")
        if (!env.isNullOrBlank()) {
            val path = Path.of(env)
            if (path.exists()) return path
        }
        error("Could not locate run_DDA_AsciiEdf")
    }

    private fun findCliCommand(): List<String> {
        val cliName = currentCliBinaryName()
        val bundledCli = findBundledBinary(cliName)
        if (bundledCli != null) {
            return listOf(bundledCli.absolutePathString())
        }
        val releaseCli = repoRoot.resolve("packages/dda-cli/target/release").resolve(cliName)
        if (releaseCli.exists()) {
            return listOf(releaseCli.absolutePathString())
        }
        val builtCli = repoRoot.resolve("packages/dda-cli/target/debug").resolve(cliName)
        if (builtCli.exists()) {
            return listOf(builtCli.absolutePathString())
        }
        return listOf(
            "cargo",
            "run",
            "--manifest-path",
            repoRoot.resolve("packages/dda-cli/Cargo.toml").absolutePathString(),
            "--",
        )
    }

    private fun writeNormalizedAscii(dataset: LoadedDataset): Path {
        val tempFile = Files.createTempFile("ddalab-kmp-", ".ascii")
        DesktopDebugLog.debug("Writing normalized ASCII for native DDA", mapOf(
            "sourceFile" to dataset.filePath,
            "tempFile" to tempFile.absolutePathString(),
            "channelCount" to dataset.channels.size.toString(),
        ))
        requireBackend(dataset).writeNormalizedAscii(tempFile)
        return tempFile
    }

    private fun requireBackend(dataset: LoadedDataset): DesktopDatasetBackend {
        return datasetBackends[dataset.filePath]
            ?: loadDesktopDatasetBackend(Path.of(dataset.filePath)).also { datasetBackends[dataset.filePath] = it }
    }

    private fun mapCliResult(
        dataset: LoadedDataset,
        config: DdaConfig,
        selectedIndices: List<Int>,
        parsed: CliDdaResult,
        diagnostics: List<String>,
    ): DdaResultSnapshot {
        val selectedNames = selectedIndices.map { dataset.channelNames[it] }
        val variants = parsed.variantResults.orEmpty().mapNotNull { variant ->
            val id = DdaVariantId.entries.firstOrNull { it.code == variant.variantId } ?: return@mapNotNull null
            val labels = when (id) {
                DdaVariantId.ST, DdaVariantId.DE, DdaVariantId.SY -> {
                    if (variant.qMatrix.size == selectedNames.size) selectedNames
                    else List(variant.qMatrix.size) { row -> if (row < selectedNames.size) selectedNames[row] else "Metric ${row + 1}" }
                }
                DdaVariantId.CT -> buildUndirectedPairs(selectedIndices)
                    .take(variant.qMatrix.size)
                    .map { (from, to) -> "${dataset.channelNames[from]} <> ${dataset.channelNames[to]}" }
                DdaVariantId.CD -> buildDirectedPairs(selectedIndices)
                    .take(variant.qMatrix.size)
                    .map { (from, to) -> "${dataset.channelNames[from]} -> ${dataset.channelNames[to]}" }
            }
            val matrix = variant.qMatrix.map { row -> row.map(Double::toFloat) }
            val flatValues = matrix.flatten()
            DdaVariantSnapshot(
                id = id,
                label = variant.variantName,
                rowLabels = labels,
                matrix = matrix,
                summary = "Native ${id.code} view",
                minValue = flatValues.minOrNull() ?: 0f,
                maxValue = flatValues.maxOrNull() ?: 0f,
            )
        }

        require(variants.isNotEmpty()) { "Native engine returned no variant matrices" }

        val windowCount = variants.maxOf { variant -> variant.matrix.maxOfOrNull { it.size } ?: 0 }
        val stepSeconds = config.windowStepSamples / dataset.dominantSampleRateHz
        val centerOffset = config.windowLengthSamples / dataset.dominantSampleRateHz / 2.0
        val windows = List(windowCount) { index ->
            (config.startTimeSeconds + centerOffset + index * stepSeconds).toFloat()
        }

        return DdaResultSnapshot(
            id = parsed.id,
            filePath = dataset.filePath,
            fileName = dataset.fileName,
            createdAtIso = parsed.createdAt,
            engineLabel = "Rust CLI",
            diagnostics = diagnostics,
            windowCentersSeconds = windows,
            variants = variants,
            isFallback = false,
        )
    }

    private fun buildFallbackAnalysis(
        dataset: LoadedDataset,
        config: DdaConfig,
        selectedIndices: List<Int>,
        reason: String,
    ): DdaResultSnapshot {
        val backend = requireBackend(dataset)
        val selectedChannelNames = selectedIndices.map { dataset.channelNames[it] }
        val baseRate = dataset.dominantSampleRateHz.coerceAtLeast(1.0)
        val endSeconds = (config.endTimeSeconds ?: dataset.durationSeconds).coerceAtLeast(config.startTimeSeconds + 0.001)
        val windowSeconds = config.windowLengthSamples / baseRate
        val stepSeconds = config.windowStepSamples / baseRate
        val windows = mutableListOf<Pair<Double, Double>>()
        val previewWindowCap = if (dataset.supportsWindowedAccess) 768 else 2_048
        var cursor = config.startTimeSeconds
        while (cursor + windowSeconds <= endSeconds + 1e-6) {
            windows += cursor to (cursor + windowSeconds)
            cursor += stepSeconds
            if (windows.size >= previewWindowCap) break
        }
        if (windows.isEmpty()) {
            windows += config.startTimeSeconds to min(endSeconds, config.startTimeSeconds + windowSeconds)
        }

        val requestedVariants = config.selectedVariants.sortedBy { it.ordinal }
        val variantMatrices = linkedMapOf<DdaVariantId, MutableList<MutableList<Float>>>()
        requestedVariants.forEach { variant ->
            val rowCount = when (variant) {
                DdaVariantId.ST, DdaVariantId.DE, DdaVariantId.SY -> selectedChannelNames.size
                DdaVariantId.CT -> buildUndirectedPairs(selectedIndices).size
                DdaVariantId.CD -> buildDirectedPairs(selectedIndices).size
            }
            variantMatrices[variant] = MutableList(rowCount) { mutableListOf() }
        }
        val undirectedPairs = buildUndirectedPairs(selectedIndices)
        val directedPairs = buildDirectedPairs(selectedIndices)

        windows.forEachIndexed { windowIndex, (start, end) ->
            val loadedChannels = backend.loadAnalysisWindow(
                startTimeSeconds = start,
                durationSeconds = end - start,
                channelNames = selectedChannelNames,
            )
            val channelByName = loadedChannels.associateBy(ChannelWaveform::name)

            if (DdaVariantId.ST in variantMatrices) {
                loadedChannels.forEachIndexed { index, channel ->
                    variantMatrices.getValue(DdaVariantId.ST)[index] += meanAbsoluteValue(channel.samples).toFloat()
                }
            }
            if (DdaVariantId.DE in variantMatrices) {
                loadedChannels.forEachIndexed { index, channel ->
                    variantMatrices.getValue(DdaVariantId.DE)[index] += standardDeviation(channel.samples).toFloat()
                }
            }
            if (DdaVariantId.SY in variantMatrices && loadedChannels.isNotEmpty()) {
                val reference = loadedChannels.first()
                loadedChannels.forEachIndexed { index, channel ->
                    variantMatrices.getValue(DdaVariantId.SY)[index] += pearson(reference.samples, channel.samples).toFloat()
                }
            }
            if (DdaVariantId.CT in variantMatrices) {
                undirectedPairs.forEachIndexed { index, (leftIndex, rightIndex) ->
                    val left = channelByName.getValue(dataset.channelNames[leftIndex])
                    val right = channelByName.getValue(dataset.channelNames[rightIndex])
                    variantMatrices.getValue(DdaVariantId.CT)[index] += abs(pearson(left.samples, right.samples)).toFloat()
                }
            }
            if (DdaVariantId.CD in variantMatrices) {
                directedPairs.forEachIndexed { index, (leftIndex, rightIndex) ->
                    val left = channelByName.getValue(dataset.channelNames[leftIndex])
                    val right = channelByName.getValue(dataset.channelNames[rightIndex])
                    variantMatrices.getValue(DdaVariantId.CD)[index] += directionalScore(
                        left.samples,
                        right.samples,
                        config.delayList.firstOrNull() ?: 1,
                    ).toFloat()
                }
            }

            if (windowIndex == 0 || windowIndex == windows.lastIndex || windowIndex % 64 == 0) {
                DesktopDebugLog.debug(
                    "Fallback preview progress",
                    mapOf(
                        "file" to dataset.fileName,
                        "windowIndex" to windowIndex.toString(),
                        "windowCount" to windows.size.toString(),
                    ),
                )
            }
        }

        val variantSnapshots = requestedVariants.map { variant ->
            val rowLabels = when (variant) {
                DdaVariantId.ST, DdaVariantId.DE, DdaVariantId.SY -> selectedChannelNames
                DdaVariantId.CT -> undirectedPairs.map { (from, to) ->
                    "${dataset.channelNames[from]} <> ${dataset.channelNames[to]}"
                }
                DdaVariantId.CD -> directedPairs.map { (from, to) ->
                    "${dataset.channelNames[from]} -> ${dataset.channelNames[to]}"
                }
            }
            val matrix = variantMatrices.getValue(variant).map { row -> row.toList() }
            val flat = matrix.flatten()
            DdaVariantSnapshot(
                id = variant,
                label = variant.label,
                rowLabels = rowLabels,
                matrix = matrix,
                summary = when (variant) {
                    DdaVariantId.ST -> "Preview: mean absolute amplitude"
                    DdaVariantId.DE -> "Preview: per-window variability"
                    DdaVariantId.SY -> "Preview: correlation to ${selectedChannelNames.firstOrNull().orEmpty()}"
                    DdaVariantId.CT -> "Preview CT metric"
                    DdaVariantId.CD -> "Preview CD metric"
                },
                minValue = flat.minOrNull() ?: 0f,
                maxValue = flat.maxOrNull() ?: 0f,
            )
        }

        val diagnostics = buildList {
            add("Native DDA execution fell back to preview metrics.")
            add(reason)
            add("Preview metrics preserve the workspace flow while we still surface real waveforms and channel selections.")
            if (windows.size >= previewWindowCap) {
                add("Preview windows were capped at $previewWindowCap slices to keep fallback analysis responsive.")
            }
        }
        return DdaResultSnapshot(
            id = "preview-${System.currentTimeMillis()}",
            filePath = dataset.filePath,
            fileName = dataset.fileName,
            createdAtIso = Instant.now().toString(),
            engineLabel = "Preview fallback",
            diagnostics = diagnostics,
            windowCentersSeconds = windows.map { (start, end) -> ((start + end) / 2.0).toFloat() },
            variants = variantSnapshots,
            isFallback = true,
        )
    }

    private fun buildSingleChannelMetric(
        id: DdaVariantId,
        label: String,
        channels: List<ChannelWaveform>,
        windows: List<Pair<Double, Double>>,
        metric: (DoubleArray) -> Double,
        summary: String,
    ): DdaVariantSnapshot {
        val matrix = channels.map { channel ->
            windows.map { (start, end) ->
                metric(windowSlice(channel, start, end)).toFloat()
            }
        }
        val flat = matrix.flatten()
        return DdaVariantSnapshot(
            id = id,
            label = label,
            rowLabels = channels.map(ChannelWaveform::name),
            matrix = matrix,
            summary = summary,
            minValue = flat.minOrNull() ?: 0f,
            maxValue = flat.maxOrNull() ?: 0f,
        )
    }

    private fun buildSynchronizationMetric(
        id: DdaVariantId,
        channels: List<ChannelWaveform>,
        windows: List<Pair<Double, Double>>,
    ): DdaVariantSnapshot {
        val reference = channels.first()
        val matrix = channels.map { channel ->
            windows.map { (start, end) ->
                val left = windowSlice(reference, start, end)
                val right = windowSlice(channel, start, end)
                pearson(left, right).toFloat()
            }
        }
        val flat = matrix.flatten()
        return DdaVariantSnapshot(
            id = id,
            label = id.label,
            rowLabels = channels.map(ChannelWaveform::name),
            matrix = matrix,
            summary = "Preview: correlation to ${reference.name}",
            minValue = flat.minOrNull() ?: -1f,
            maxValue = flat.maxOrNull() ?: 1f,
        )
    }

    private fun buildPairMetric(
        id: DdaVariantId,
        pairs: List<Pair<ChannelWaveform, ChannelWaveform>>,
        windows: List<Pair<Double, Double>>,
        labelBuilder: (ChannelWaveform, ChannelWaveform) -> String,
        metric: (DoubleArray, DoubleArray) -> Float,
    ): DdaVariantSnapshot {
        val matrix = pairs.map { (leftChannel, rightChannel) ->
            windows.map { (start, end) ->
                metric(windowSlice(leftChannel, start, end), windowSlice(rightChannel, start, end))
            }
        }
        val flat = matrix.flatten()
        return DdaVariantSnapshot(
            id = id,
            label = id.label,
            rowLabels = pairs.map { (left, right) -> labelBuilder(left, right) },
            matrix = matrix,
            summary = "Preview ${id.code} metric",
            minValue = flat.minOrNull() ?: 0f,
            maxValue = flat.maxOrNull() ?: 0f,
        )
    }

    private fun windowSlice(channel: ChannelWaveform, startSec: Double, endSec: Double): DoubleArray {
        val startIndex = floor(startSec * channel.sampleRateHz).toInt().coerceAtLeast(0)
        val endIndex = ceil(endSec * channel.sampleRateHz).toInt().coerceIn(startIndex + 1, channel.samples.size)
        return channel.samples.copyOfRange(startIndex, endIndex)
    }

    private fun meanAbsoluteValue(values: DoubleArray): Double {
        if (values.isEmpty()) return 0.0
        return values.sumOf(::abs) / values.size
    }

    private fun standardDeviation(values: DoubleArray): Double {
        if (values.size < 2) return 0.0
        val mean = values.average()
        val variance = values.sumOf { (it - mean) * (it - mean) } / (values.size - 1)
        return sqrt(variance)
    }

    private fun pearson(left: DoubleArray, right: DoubleArray): Double {
        val length = min(left.size, right.size)
        if (length < 2) return 0.0
        val a = left.copyOf(length)
        val b = right.copyOf(length)
        val meanA = a.average()
        val meanB = b.average()
        var numerator = 0.0
        var denomA = 0.0
        var denomB = 0.0
        for (index in 0 until length) {
            val da = a[index] - meanA
            val db = b[index] - meanB
            numerator += da * db
            denomA += da * da
            denomB += db * db
        }
        if (denomA <= 1e-12 || denomB <= 1e-12) return 0.0
        return numerator / sqrt(denomA * denomB)
    }

    private fun directionalScore(left: DoubleArray, right: DoubleArray, lag: Int): Double {
        if (lag <= 0) return pearson(left, right)
        val usable = min(left.size, right.size) - lag
        if (usable < 3) return 0.0
        val forwardLeft = DoubleArray(usable) { left[it] }
        val forwardRight = DoubleArray(usable) { right[it + lag] }
        val reverseLeft = DoubleArray(usable) { right[it] }
        val reverseRight = DoubleArray(usable) { left[it + lag] }
        return pearson(forwardLeft, forwardRight) - pearson(reverseLeft, reverseRight)
    }

    private fun buildUndirectedPairs(indices: List<Int>): List<Pair<Int, Int>> {
        val pairs = mutableListOf<Pair<Int, Int>>()
        for (leftIndex in indices.indices) {
            for (rightIndex in (leftIndex + 1) until indices.size) {
                pairs += indices[leftIndex] to indices[rightIndex]
            }
        }
        return pairs
    }

    private fun buildDirectedPairs(indices: List<Int>): List<Pair<Int, Int>> {
        val pairs = mutableListOf<Pair<Int, Int>>()
        indices.forEach { left ->
            indices.forEach { right ->
                if (left != right) pairs += left to right
            }
        }
        return pairs
    }
}

internal object DesktopDebugLog {
    private var logPath: Path? = null

    @Synchronized
    fun initialize(path: Path) {
        logPath = path
        ensureReady()
        append("INFO", "Logger initialized", fields = mapOf("path" to path.absolutePathString()))
    }

    fun debug(message: String, fields: Map<String, String> = emptyMap()) {
        append("DEBUG", message, fields = fields)
    }

    fun info(message: String, fields: Map<String, String> = emptyMap()) {
        append("INFO", message, fields = fields)
    }

    fun error(message: String, throwable: Throwable? = null, fields: Map<String, String> = emptyMap()) {
        append("ERROR", message, throwable = throwable, fields = fields)
    }

    @Synchronized
    private fun append(
        level: String,
        message: String,
        throwable: Throwable? = null,
        fields: Map<String, String> = emptyMap(),
    ) {
        val target = logPath ?: return
        ensureReady()
        val line = buildString {
            append(Instant.now())
            append(" [")
            append(level)
            append("] ")
            append(message)
            if (fields.isNotEmpty()) {
                append(" | ")
                append(fields.entries.joinToString(", ") { "${it.key}=${it.value}" })
            }
        }
        runCatching {
            Files.writeString(
                target,
                line + "\n" + (throwable?.stackTraceString()?.let { "$it\n" } ?: ""),
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND,
            )
            System.err.println(line)
            throwable?.printStackTrace()
        }
    }

    @Synchronized
    private fun ensureReady() {
        val target = logPath ?: return
        runCatching {
            target.parent?.createDirectories()
            if (target.notExists()) {
                target.writeText("")
            }
        }
    }
}

private fun Throwable.stackTraceString(): String {
    val writer = StringWriter()
    printStackTrace(PrintWriter(writer))
    return writer.toString()
}

@Serializable
private data class CliWindowParameters(
    @SerialName("window_length") val windowLength: Int,
    @SerialName("window_step") val windowStep: Int,
)

private fun Process.readOutput(): ProcessOutput {
    val stdoutBuffer = StringBuilder()
    val stderrBuffer = StringBuilder()
    val stdoutReader = thread(start = true, name = "ddalab-kmp-stdout") {
        inputStream.bufferedReader().use { reader ->
            reader.forEachLine { line ->
                stdoutBuffer.appendLine(line)
            }
        }
    }
    val stderrReader = thread(start = true, name = "ddalab-kmp-stderr") {
        errorStream.bufferedReader().use { reader ->
            reader.forEachLine { line ->
                stderrBuffer.appendLine(line)
            }
        }
    }
    val exitCode = waitFor()
    stdoutReader.join()
    stderrReader.join()
    return ProcessOutput(
        stdout = stdoutBuffer.toString().trim(),
        stderr = stderrBuffer.toString().trim(),
        exitCode = exitCode,
    )
}

@Serializable
private data class CliDelayParameters(
    val delays: List<Int>,
)

@Serializable
private data class CliVariantResult(
    @SerialName("variant_id") val variantId: String,
    @SerialName("variant_name") val variantName: String,
    @SerialName("q_matrix") val qMatrix: List<List<Double>>,
)

@Serializable
private data class CliDdaResult(
    val id: String,
    @SerialName("file_path") val filePath: String,
    val channels: List<String>,
    @SerialName("variant_results") val variantResults: List<CliVariantResult>? = null,
    @SerialName("window_parameters") val windowParameters: CliWindowParameters,
    @SerialName("delay_parameters") val delayParameters: CliDelayParameters,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
private data class BridgeIcaResponse(
    val id: String,
    @SerialName("file_path") val filePath: String,
    @SerialName("created_at") val createdAt: String,
    val result: BridgeIcaResultPayload,
)

@Serializable
private data class BridgeIcaResultPayload(
    @SerialName("channel_names") val channelNames: List<String>,
    @SerialName("sample_rate") val sampleRate: Double,
    @SerialName("n_samples") val nSamples: Int,
    val components: List<BridgeIcaComponent>,
)

@Serializable
private data class BridgeIcaComponent(
    @SerialName("component_id") val componentId: Int,
    @SerialName("spatial_map") val spatialMap: List<Double>,
    @SerialName("time_series") val timeSeries: List<Double>,
    val kurtosis: Double,
    @SerialName("non_gaussianity") val nonGaussianity: Double,
    @SerialName("variance_explained") val varianceExplained: Double,
    @SerialName("power_spectrum") val powerSpectrum: BridgePowerSpectrum? = null,
)

@Serializable
private data class BridgePowerSpectrum(
    val frequencies: List<Double>,
    val power: List<Double>,
)

@Serializable
private data class BridgePluginRegistryIndex(
    val version: Int,
    @SerialName("updatedAt") val updatedAt: String? = null,
    val plugins: List<BridgePluginRegistryEntry>,
)

@Serializable
private data class BridgePluginRegistryEntry(
    val id: String,
    val name: String,
    val version: String,
    val description: String,
    val author: String,
    val category: String,
    val permissions: List<String>,
    @SerialName("artifactUrl") val artifactUrl: String,
    @SerialName("publishedAt") val publishedAt: String,
)

@Serializable
private data class BridgePluginOutput(
    @SerialName("pluginId") val pluginId: String,
    val results: JsonElement,
    val logs: List<String>,
)

@Serializable
private data class BridgeToggleResponse(
    val enabled: Boolean,
)

@Serializable
private data class BridgeNsgCredentialsStatus(
    val username: String,
    @SerialName("hasPassword") val hasPassword: Boolean,
    @SerialName("hasAppKey") val hasAppKey: Boolean,
)

@Serializable
private data class BridgeConnectivityResponse(
    val connected: Boolean,
)

@Serializable
private data class BridgeNsgJob(
    val id: String,
    @SerialName("nsg_job_id") val nsgJobId: String? = null,
    val tool: String,
    val status: NsgJobStatus,
    @SerialName("created_at") val createdAt: String,
    @SerialName("submitted_at") val submittedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("input_file_path") val inputFilePath: String,
    @SerialName("output_files") val outputFiles: List<String> = emptyList(),
    @SerialName("error_message") val errorMessage: String? = null,
    @SerialName("last_polled") val lastPolled: String? = null,
    val progress: Int? = null,
)

@Serializable
private data class AnnotationExchangeBundle(
    val files: Map<String, AnnotationExchangeFile>,
)

@Serializable
private data class AnnotationExchangeFile(
    val version: String,
    @SerialName("file_path") val filePath: String,
    @SerialName("file_hash") val fileHash: String? = null,
    @SerialName("sample_rate") val sampleRate: Double? = null,
    val duration: Double? = null,
    @SerialName("global_annotations") val globalAnnotations: List<AnnotationExchangeEntry> = emptyList(),
    @SerialName("channel_annotations") val channelAnnotations: Map<String, List<AnnotationExchangeEntry>> = emptyMap(),
    val metadata: AnnotationExchangeMetadata = AnnotationExchangeMetadata(),
)

@Serializable
private data class AnnotationExchangeEntry(
    val id: String,
    val position: Double,
    @SerialName("position_samples") val positionSamples: Long? = null,
    val label: String,
    val description: String? = null,
    val color: String? = null,
    @SerialName("created_at") val createdAt: String = Instant.now().toString(),
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
private data class AnnotationExchangeMetadata(
    val author: String? = null,
    @SerialName("exported_at") val exportedAt: String = Instant.now().toString(),
    @SerialName("app_version") val appVersion: String? = null,
    val notes: String? = null,
)

private data class ProcessOutput(
    val stdout: String,
    val stderr: String,
    val exitCode: Int,
)
