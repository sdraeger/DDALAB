package org.ddalab.kmp

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.min
import kotlin.random.Random

class AppStore(
    private val bridge: AppBridge,
    private val scope: CoroutineScope,
) {
    private var waveformWindowJob: Job? = null
    private var waveformOverviewJob: Job? = null

    var state by mutableStateOf(AppUiState())
        private set

    init {
        bootstrap()
    }

    fun bootstrap() {
        scope.launch {
            val detectedRoot = bridge.detectDefaultDataRoot() ?: "."
            val persisted = bridge.loadPersistedState(detectedRoot)
            val settings = persisted.settings.copy(
                dataRoot = persisted.settings.dataRoot.ifBlank { detectedRoot },
            )
            val browserPath = persisted.lastDirectory ?: settings.dataRoot

            state = state.copy(
                settings = settings,
                debugLogPath = bridge.debugLogPath(),
                browserPath = browserPath,
                browserPaneWidthDp = persisted.browserPaneWidthDp
                    .coerceIn(MinBrowserPaneWidthDp, MaxBrowserPaneWidthDp),
                browserPaneCollapsed = persisted.browserPaneCollapsed,
                history = persisted.history,
                icaHistory = persisted.icaHistory,
                annotations = persisted.annotations,
                notifications = persisted.notifications.take(40),
                recentFiles = persisted.recentFiles.take(12),
                statusMessage = "Ready to browse $browserPath",
                errorMessage = null,
            )

            refreshDirectory(browserPath)
            refreshNsgStatus(loadJobs = false)

            val lastFile = persisted.lastFile
            if (!lastFile.isNullOrBlank()) {
                openDataset(lastFile, saveAfter = false)
            }
        }
    }

    fun setPrimarySection(section: PrimarySection) {
        state = state.copy(primarySection = section, errorMessage = null)
    }

    fun setVisualizeSection(section: VisualizeSection) {
        state = state.copy(visualizeSection = section)
    }

    fun setAnalyzeSection(section: AnalyzeSection) {
        state = state.copy(analyzeSection = section)
    }

    fun setDataSection(section: DataSection) {
        state = state.copy(dataSection = section)
    }

    fun setLearnSection(section: LearnSection) {
        state = state.copy(learnSection = section)
    }

    fun setCollaborateSection(section: CollaborateSection) {
        state = state.copy(collaborateSection = section)
    }

    fun updateBrowserSearch(query: String) {
        state = state.copy(browserSearch = query)
    }

    fun setBrowserPaneWidth(widthDp: Float) {
        state = state.copy(
            browserPaneWidthDp = widthDp.coerceIn(MinBrowserPaneWidthDp, MaxBrowserPaneWidthDp),
        )
    }

    fun toggleBrowserPaneCollapsed() {
        state = state.copy(browserPaneCollapsed = !state.browserPaneCollapsed)
        savePersistedState()
    }

    fun persistBrowserPaneLayout() {
        savePersistedState()
    }

    fun updateTheme(preference: ThemePreference) {
        state = state.copy(
            settings = state.settings.copy(themePreference = preference),
        )
        savePersistedState()
    }

    fun cycleThemePreference() {
        val next = when (state.settings.themePreference) {
            ThemePreference.System -> ThemePreference.Light
            ThemePreference.Light -> ThemePreference.Dark
            ThemePreference.Dark -> ThemePreference.System
        }
        updateTheme(next)
    }

    fun toggleExpertMode() {
        state = state.copy(
            settings = state.settings.copy(expertMode = !state.settings.expertMode),
        )
        savePersistedState()
    }

    fun updateBinaryPath(path: String) {
        state = state.copy(
            settings = state.settings.copy(ddaBinaryPath = path.trim()),
        )
        savePersistedState()
    }

    fun updateDdaConfig(transform: (DdaConfig) -> DdaConfig) {
        state = state.copy(ddaConfig = transform(state.ddaConfig))
    }

    fun openDebugLog() {
        scope.launch {
            val opened = runCatching { bridge.openDebugLog() }.getOrDefault(false)
            if (!opened) {
                pushNotification(
                    title = "Log open failed",
                    message = state.debugLogPath ?: "Debug log file is not available yet.",
                    level = NotificationLevel.Warning,
                )
            }
        }
    }

    fun openExternalUrl(url: String, title: String = "Open link") {
        scope.launch {
            val opened = runCatching { bridge.openExternalUrl(url) }.getOrDefault(false)
            if (!opened) {
                pushNotification(
                    title = "$title failed",
                    message = url,
                    level = NotificationLevel.Warning,
                )
            }
        }
    }

    fun refreshDirectory(path: String = state.browserPath) {
        scope.launch {
            state = state.copy(
                isDirectoryLoading = true,
                browserPath = path,
                statusMessage = "Scanning $path",
                errorMessage = null,
            )
            runCatching {
                bridge.listDirectory(path)
            }.onSuccess { snapshot ->
                state = state.copy(
                    browserPath = snapshot.path,
                    directoryEntries = snapshot.entries,
                    isDirectoryLoading = false,
                    statusMessage = "Loaded ${snapshot.entries.size} entries",
                )
                savePersistedState()
            }.onFailure { error ->
                pushNotification(
                    title = "Directory load failed",
                    message = error.message ?: "Unable to list $path",
                    level = NotificationLevel.Error,
                )
                state = state.copy(
                    isDirectoryLoading = false,
                    errorMessage = error.message ?: "Unable to load directory",
                    statusMessage = "Directory load failed",
                )
            }
        }
    }

    fun openParentDirectory() {
        val parent = state.browserPath.substringBeforeLast('/', state.browserPath)
        if (parent.isNotBlank() && parent != state.browserPath) {
            refreshDirectory(parent)
        }
    }

    fun openEntry(entry: BrowserEntry) {
        if (entry.isDirectory) {
            refreshDirectory(entry.path)
        } else if (entry.supported) {
            openDataset(entry.path)
        }
    }

    fun chooseRootDirectory() {
        scope.launch {
            val chosen = bridge.chooseRootDirectory(state.browserPath).orEmpty()
            if (chosen.isBlank()) return@launch
            state = state.copy(
                settings = state.settings.copy(dataRoot = chosen),
                browserPath = chosen,
            )
            refreshDirectory(chosen)
            savePersistedState()
        }
    }

    fun chooseFile() {
        scope.launch {
            val file = bridge.chooseFile(state.browserPath).orEmpty()
            if (file.isBlank()) return@launch
            openDataset(file)
        }
    }

    fun openDataset(path: String, saveAfter: Boolean = true) {
        scope.launch {
            state = state.copy(
                primarySection = PrimarySection.Visualize,
                visualizeSection = VisualizeSection.TimeSeries,
                isDatasetLoading = true,
                errorMessage = null,
                statusMessage = "Opening ${path.substringAfterLast('/')}",
            )
            runCatching {
                bridge.loadDataset(path)
            }.onSuccess { dataset ->
                val previousSelection = state.selectedChannelNames.toSet()
                val defaultSelection = dataset.channelNames
                    .filter(previousSelection::contains)
                    .ifEmpty { dataset.channelNames.take(min(8, dataset.channelNames.size)) }
                val nextRecentFiles = listOf(path) + state.recentFiles.filterNot { it == path }
                val initialViewportDuration = minOf(
                    dataset.durationSeconds.coerceAtLeast(0.5),
                    when {
                        dataset.supportsWindowedAccess -> 30.0
                        else -> maxOf(minOf(dataset.durationSeconds, 60.0), 5.0)
                    },
                )
                state = state.copy(
                    selectedDataset = dataset,
                    selectedChannelNames = defaultSelection,
                    waveformWindow = null,
                    waveformOverview = null,
                    waveformViewportStartSeconds = 0.0,
                    waveformViewportDurationSeconds = initialViewportDuration,
                    isWaveformLoading = false,
                    isOverviewLoading = false,
                    waveformErrorMessage = null,
                    ddaConfig = defaultDdaConfigFor(dataset),
                    currentResult = state.history.firstOrNull { it.filePath == path }?.result,
                    activeVariant = state.history.firstOrNull { it.filePath == path }
                        ?.result
                        ?.variants
                        ?.firstOrNull()
                        ?.id,
                    currentIcaResult = state.icaHistory.firstOrNull { it.filePath == path },
                    recentFiles = nextRecentFiles.take(12),
                    isDatasetLoading = false,
                    browserPath = path.substringBeforeLast('/', state.browserPath),
                    statusMessage = "Loaded ${dataset.fileName}",
                )
                if (saveAfter) {
                    pushNotification(
                        title = "Dataset loaded",
                        message = "${dataset.fileName} is ready for visualization and DDA.",
                        level = NotificationLevel.Success,
                    )
                    savePersistedState()
                }
                refreshWaveform(forceOverview = true)
            }.onFailure { error ->
                pushNotification(
                    title = "Dataset load failed",
                    message = error.message ?: "Unable to read $path",
                    level = NotificationLevel.Error,
                )
                state = state.copy(
                    isDatasetLoading = false,
                    errorMessage = error.message ?: "Unable to read dataset",
                    statusMessage = "Dataset load failed",
                )
            }
        }
    }

    fun selectRecentFile(path: String) {
        openDataset(path)
    }

    fun toggleChannel(name: String) {
        val existing = state.selectedChannelNames.toMutableList()
        val previousPrimary = existing.firstOrNull()
        if (existing.contains(name)) {
            if (existing.size > 1) {
                existing.remove(name)
            }
        } else {
            existing.add(name)
        }
        state = state.copy(selectedChannelNames = existing)
        refreshWaveform(forceOverview = previousPrimary != existing.firstOrNull())
    }

    fun selectAllChannels() {
        val dataset = state.selectedDataset ?: return
        state = state.copy(selectedChannelNames = dataset.channelNames)
        refreshWaveform(forceOverview = true)
    }

    fun selectTopChannels(limit: Int) {
        val dataset = state.selectedDataset ?: return
        state = state.copy(selectedChannelNames = dataset.channelNames.take(limit))
        refreshWaveform(forceOverview = true)
    }

    fun updateWaveformViewport(startTimeSeconds: Double, durationSeconds: Double) {
        val dataset = state.selectedDataset ?: return
        val clampedDuration = durationSeconds
            .coerceAtLeast(0.5)
            .coerceAtMost(maxOf(dataset.durationSeconds, 0.5))
        val maxStart = maxOf(0.0, dataset.durationSeconds - clampedDuration)
        val clampedStart = startTimeSeconds.coerceIn(0.0, maxStart)
        state = state.copy(
            waveformViewportStartSeconds = clampedStart,
            waveformViewportDurationSeconds = clampedDuration,
        )
        refreshWaveform(forceOverview = false)
    }

    fun clearNotifications() {
        state = state.copy(notifications = emptyList())
        savePersistedState()
    }

    fun addAnnotation(
        label: String,
        note: String,
        startTimeSeconds: Double,
        endTimeSeconds: Double?,
        channelName: String?,
    ) {
        val dataset = state.selectedDataset ?: return
        val sanitizedLabel = label.trim()
        if (sanitizedLabel.isBlank()) {
            pushNotification(
                title = "Annotation skipped",
                message = "Add a short label before saving an annotation.",
                level = NotificationLevel.Warning,
            )
            return
        }

        val normalizedStart = startTimeSeconds.coerceAtLeast(0.0)
        val normalizedEnd = endTimeSeconds
            ?.takeIf { it.isFinite() }
            ?.coerceAtLeast(normalizedStart)

        val entry = DatasetAnnotationEntry(
            id = "annotation-${Random.nextInt(1_000_000)}",
            filePath = dataset.filePath,
            fileName = dataset.fileName,
            channelName = channelName?.takeIf(String::isNotBlank),
            label = sanitizedLabel,
            note = note.trim(),
            startTimeSeconds = normalizedStart,
            endTimeSeconds = normalizedEnd,
            createdAtIso = nowIsoGuess(),
        )
        state = state.copy(
            annotations = listOf(entry) + state.annotations.filterNot { it.id == entry.id },
            primarySection = PrimarySection.Visualize,
            visualizeSection = VisualizeSection.Annotations,
        )
        pushNotification(
            title = "Annotation saved",
            message = "${entry.label} was added to ${dataset.fileName}.",
            level = NotificationLevel.Success,
        )
        savePersistedState()
    }

    fun removeAnnotation(id: String) {
        val removed = state.annotations.firstOrNull { it.id == id } ?: return
        state = state.copy(
            annotations = state.annotations.filterNot { it.id == id },
        )
        pushNotification(
            title = "Annotation removed",
            message = removed.label,
            level = NotificationLevel.Info,
        )
        savePersistedState()
    }

    fun exportAnnotations(format: String) {
        val dataset = state.selectedDataset ?: run {
            pushNotification(
                title = "No dataset selected",
                message = "Open a dataset before exporting annotations.",
                level = NotificationLevel.Warning,
            )
            return
        }
        val datasetAnnotations = state.annotations.filter { it.filePath == dataset.filePath }
        if (datasetAnnotations.isEmpty()) {
            pushNotification(
                title = "No annotations to export",
                message = "Create at least one annotation for ${dataset.fileName}.",
                level = NotificationLevel.Warning,
            )
            return
        }

        scope.launch {
            state = state.copy(
                errorMessage = null,
                statusMessage = "Exporting annotations for ${dataset.fileName}",
            )
            runCatching {
                bridge.exportAnnotations(dataset, datasetAnnotations, format)
            }.onSuccess { path ->
                if (path.isNullOrBlank()) {
                    state = state.copy(statusMessage = "Annotation export cancelled")
                } else {
                    state = state.copy(statusMessage = "Exported annotations to $path")
                    pushNotification(
                        title = "Annotations exported",
                        message = path,
                        level = NotificationLevel.Success,
                    )
                }
            }.onFailure { error ->
                state = state.copy(
                    errorMessage = error.message ?: "Annotation export failed",
                    statusMessage = "Annotation export failed",
                )
                pushNotification(
                    title = "Annotation export failed",
                    message = error.message ?: dataset.fileName,
                    level = NotificationLevel.Error,
                )
            }
        }
    }

    fun importAnnotations() {
        val dataset = state.selectedDataset ?: run {
            pushNotification(
                title = "No dataset selected",
                message = "Open a dataset before importing annotations.",
                level = NotificationLevel.Warning,
            )
            return
        }

        scope.launch {
            state = state.copy(
                errorMessage = null,
                statusMessage = "Importing annotations for ${dataset.fileName}",
            )
            runCatching {
                bridge.importAnnotations(
                    dataset = dataset,
                    existingAnnotations = state.annotations,
                )
            }.onSuccess { outcome ->
                if (outcome == null) {
                    state = state.copy(statusMessage = "Annotation import cancelled")
                    return@onSuccess
                }
                state = state.copy(
                    annotations = state.annotations + outcome.imported,
                    statusMessage = "Imported ${outcome.importedCount} annotations",
                )
                pushNotification(
                    title = "Annotations imported",
                    message = buildString {
                        append("${outcome.importedCount} imported")
                        if (outcome.skippedDuplicates > 0) append(", ${outcome.skippedDuplicates} duplicates skipped")
                        if (outcome.skippedNearDuplicates > 0) append(", ${outcome.skippedNearDuplicates} near-duplicates skipped")
                    },
                    level = if (outcome.warnings.isEmpty()) NotificationLevel.Success else NotificationLevel.Warning,
                )
                savePersistedState()
            }.onFailure { error ->
                state = state.copy(
                    errorMessage = error.message ?: "Annotation import failed",
                    statusMessage = "Annotation import failed",
                )
                pushNotification(
                    title = "Annotation import failed",
                    message = error.message ?: dataset.fileName,
                    level = NotificationLevel.Error,
                )
            }
        }
    }

    fun loadHistoryEntry(entry: AnalysisHistoryEntry) {
        state = state.copy(
            primarySection = PrimarySection.Analyze,
            analyzeSection = AnalyzeSection.Dda,
            currentResult = entry.result,
            activeVariant = entry.result.variants.firstOrNull()?.id,
            statusMessage = "Loaded historical result ${entry.fileName}",
        )
    }

    fun setActiveVariant(id: DdaVariantId) {
        state = state.copy(activeVariant = id)
    }

    fun loadIcaResult(result: IcaResultSnapshot) {
        state = state.copy(
            primarySection = PrimarySection.Analyze,
            analyzeSection = AnalyzeSection.Ica,
            currentIcaResult = result,
            statusMessage = "Loaded ICA result ${result.fileName}",
        )
    }

    fun runAnalysis() {
        val dataset = state.selectedDataset ?: return
        val selectedIndices = dataset.channelNames.mapIndexedNotNull { index, name ->
            if (state.selectedChannelNames.contains(name)) index else null
        }
        if (selectedIndices.isEmpty()) {
            pushNotification(
                title = "No channels selected",
                message = "Pick at least one channel before running DDA.",
                level = NotificationLevel.Warning,
            )
            return
        }

        val requestedVariants = state.ddaConfig.selectedVariants
            .sortedWith(compareBy(::ddaVariantExecutionPriority, DdaVariantId::ordinal))
        if (requestedVariants.isEmpty()) {
            pushNotification(
                title = "No variants selected",
                message = "Choose at least one DDA variant before running analysis.",
                level = NotificationLevel.Warning,
            )
            return
        }
        val requestedVariantCodes = requestedVariants.map(DdaVariantId::code)
        val analysisId = "kmp-${Random.nextInt(100_000, 999_999)}-${Random.nextInt(1_000, 9_999)}"

        scope.launch {
            state = state.copy(
                primarySection = PrimarySection.Analyze,
                analyzeSection = AnalyzeSection.Dda,
                isRunningAnalysis = true,
                currentResult = null,
                activeVariant = null,
                statusMessage = "Running ${requestedVariants.first().code} (1/${requestedVariants.size}) on ${dataset.fileName}",
                errorMessage = null,
            )

            var mergedResult: DdaResultSnapshot? = null
            val failedVariants = mutableListOf<String>()
            val binaryOverridePath = state.settings.ddaBinaryPath.ifBlank { null }

            requestedVariants.forEachIndexed { index, variant ->
                runCatching {
                    bridge.runDdaAnalysis(
                        dataset = dataset,
                        config = state.ddaConfig.copy(selectedVariants = setOf(variant)),
                        selectedChannelIndices = selectedIndices,
                        binaryOverridePath = binaryOverridePath,
                    )
                }.onSuccess { result ->
                    mergedResult = mergeDdaResults(
                        analysisId = analysisId,
                        requestedOrder = requestedVariants,
                        current = mergedResult,
                        next = result,
                    )
                    val visibleResult = mergedResult ?: return@onSuccess
                    val nextStatus = requestedVariants.getOrNull(index + 1)?.let { nextVariant ->
                        "Completed ${variant.code} (${index + 1}/${requestedVariants.size}); running ${nextVariant.code}"
                    } ?: "Finalizing ${dataset.fileName}"
                    val activeVariant = state.activeVariant
                        ?.takeIf { current -> visibleResult.variants.any { it.id == current } }
                        ?: visibleResult.variants.firstOrNull()?.id
                    state = state.copy(
                        currentResult = visibleResult,
                        activeVariant = activeVariant,
                        statusMessage = nextStatus,
                        errorMessage = null,
                    )
                }.onFailure { error ->
                    failedVariants += "${variant.code}: ${error.message ?: "Analysis failed"}"
                    val nextStatus = requestedVariants.getOrNull(index + 1)?.let { nextVariant ->
                        "Skipped ${variant.code}; running ${nextVariant.code}"
                    } ?: "Finishing ${dataset.fileName} with partial results"
                    state = state.copy(
                        statusMessage = nextStatus,
                        errorMessage = if (mergedResult == null) {
                            error.message ?: "DDA failed"
                        } else {
                            null
                        },
                    )
                }
            }

            runCatching {
                val result = mergedResult ?: error("DDA did not produce any usable variant views.")
                val finalized = if (failedVariants.isEmpty()) {
                    result
                } else {
                    result.copy(
                        diagnostics = result.diagnostics + listOf(
                            "Missing variants: ${failedVariants.joinToString()}",
                            "Completed variants: ${result.variants.joinToString { it.id.code }}",
                        ),
                        isFallback = true,
                        engineLabel = when {
                            result.engineLabel.contains("preview", ignoreCase = true) -> result.engineLabel
                            else -> "Mixed native + preview"
                        },
                    )
                }

                val historyEntry = AnalysisHistoryEntry(
                    id = finalized.id,
                    filePath = finalized.filePath,
                    fileName = finalized.fileName,
                    createdAtIso = finalized.createdAtIso,
                    engineLabel = finalized.engineLabel,
                    variants = finalized.variants.map { it.id.code },
                    result = finalized,
                )
                state = state.copy(
                    currentResult = finalized,
                    activeVariant = finalized.variants.firstOrNull()?.id,
                    history = listOf(historyEntry) + state.history.filterNot { it.id == historyEntry.id }
                        .take(19),
                    isRunningAnalysis = false,
                    statusMessage = buildString {
                        append("Analysis complete via ${finalized.engineLabel}")
                        if (finalized.isFallback) append(" (preview fallback used)")
                    },
                )
                pushNotification(
                    title = "DDA complete",
                    message = buildString {
                        append("${finalized.fileName} finished with ${finalized.variants.size}/${requestedVariantCodes.size} variant views.")
                        if (failedVariants.isNotEmpty()) {
                            append(" ")
                            append(failedVariants.size)
                            append(" variant")
                            if (failedVariants.size != 1) append('s')
                            append(" fell back or failed.")
                        }
                    },
                    level = when {
                        finalized.variants.isEmpty() -> NotificationLevel.Error
                        finalized.isFallback || failedVariants.isNotEmpty() -> NotificationLevel.Warning
                        else -> NotificationLevel.Success
                    },
                )
                savePersistedState()
            }.onFailure { error ->
                pushNotification(
                    title = "DDA failed",
                    message = error.message ?: "Analysis did not complete",
                    level = NotificationLevel.Error,
                )
                state = state.copy(
                    isRunningAnalysis = false,
                    errorMessage = error.message ?: "DDA failed",
                    statusMessage = "Analysis failed",
                )
            }
        }
    }

    fun runIcaAnalysis(
        startTimeSeconds: Double?,
        endTimeSeconds: Double?,
        nComponents: Int?,
        maxIterations: Int,
        tolerance: Double,
        centering: Boolean,
        whitening: Boolean,
    ) {
        val dataset = state.selectedDataset ?: return
        val selectedIndices = dataset.channelNames.mapIndexedNotNull { index, name ->
            if (state.selectedChannelNames.contains(name)) index else null
        }
        if (selectedIndices.size < 2) {
            pushNotification(
                title = "ICA needs more channels",
                message = "Select at least two channels before running ICA.",
                level = NotificationLevel.Warning,
            )
            return
        }

        scope.launch {
            state = state.copy(
                primarySection = PrimarySection.Analyze,
                analyzeSection = AnalyzeSection.Ica,
                isRunningIca = true,
                errorMessage = null,
                statusMessage = "Running ICA on ${dataset.fileName}",
            )

            runCatching {
                bridge.runIcaAnalysis(
                    dataset = dataset,
                    selectedChannelIndices = selectedIndices,
                    startTimeSeconds = startTimeSeconds,
                    endTimeSeconds = endTimeSeconds,
                    nComponents = nComponents,
                    maxIterations = maxIterations,
                    tolerance = tolerance,
                    centering = centering,
                    whitening = whitening,
                )
            }.onSuccess { result ->
                state = state.copy(
                    currentIcaResult = result,
                    icaHistory = listOf(result) + state.icaHistory.filterNot { it.id == result.id }.take(11),
                    isRunningIca = false,
                    statusMessage = "ICA complete for ${result.fileName}",
                )
                pushNotification(
                    title = "ICA complete",
                    message = "Extracted ${result.components.size} components from ${result.fileName}.",
                    level = NotificationLevel.Success,
                )
                savePersistedState()
            }.onFailure { error ->
                pushNotification(
                    title = "ICA failed",
                    message = error.message ?: "ICA analysis did not complete",
                    level = NotificationLevel.Error,
                )
                state = state.copy(
                    isRunningIca = false,
                    errorMessage = error.message ?: "ICA failed",
                    statusMessage = "ICA failed",
                )
            }
        }
    }

    fun refreshPlugins() {
        scope.launch {
            state = state.copy(
                isPluginLoading = true,
                isPluginRegistryLoading = true,
                errorMessage = null,
                statusMessage = "Refreshing plugin catalog",
            )
            val installed = runCatching { bridge.listInstalledPlugins() }
            val registry = runCatching { bridge.fetchPluginRegistry() }

            val installedPlugins = installed.getOrElse { emptyList() }
            val registryPlugins = registry.getOrElse { emptyList() }
            val failure = installed.exceptionOrNull() ?: registry.exceptionOrNull()

            state = state.copy(
                installedPlugins = installedPlugins,
                pluginRegistry = registryPlugins,
                isPluginLoading = false,
                isPluginRegistryLoading = false,
                errorMessage = failure?.message,
                statusMessage = if (failure == null) {
                    "Loaded ${installedPlugins.size} installed plugins"
                } else {
                    "Plugin refresh failed"
                },
            )
        }
    }

    fun installPlugin(pluginId: String) {
        scope.launch {
            state = state.copy(
                isPluginLoading = true,
                errorMessage = null,
                statusMessage = "Installing plugin $pluginId",
            )
            runCatching { bridge.installPlugin(pluginId) }
                .onSuccess { installed ->
                    state = state.copy(
                        installedPlugins = listOf(installed) + state.installedPlugins.filterNot { it.id == installed.id },
                        isPluginLoading = false,
                        statusMessage = "Installed ${installed.name}",
                    )
                    pushNotification(
                        title = "Plugin installed",
                        message = installed.name,
                        level = NotificationLevel.Success,
                    )
                    refreshPlugins()
                }
                .onFailure { error ->
                    state = state.copy(
                        isPluginLoading = false,
                        errorMessage = error.message ?: "Plugin install failed",
                        statusMessage = "Plugin install failed",
                    )
                    pushNotification(
                        title = "Plugin install failed",
                        message = error.message ?: pluginId,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun uninstallPlugin(pluginId: String) {
        scope.launch {
            state = state.copy(
                isPluginLoading = true,
                errorMessage = null,
                statusMessage = "Removing plugin $pluginId",
            )
            runCatching { bridge.uninstallPlugin(pluginId) }
                .onSuccess {
                    state = state.copy(
                        installedPlugins = state.installedPlugins.filterNot { it.id == pluginId },
                        currentPluginOutput = state.currentPluginOutput?.takeIf { it.pluginId != pluginId },
                        isPluginLoading = false,
                        statusMessage = "Removed plugin $pluginId",
                    )
                    pushNotification(
                        title = "Plugin removed",
                        message = pluginId,
                        level = NotificationLevel.Info,
                    )
                    refreshPlugins()
                }
                .onFailure { error ->
                    state = state.copy(
                        isPluginLoading = false,
                        errorMessage = error.message ?: "Plugin removal failed",
                        statusMessage = "Plugin removal failed",
                    )
                    pushNotification(
                        title = "Plugin removal failed",
                        message = error.message ?: pluginId,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun setPluginEnabled(pluginId: String, enabled: Boolean) {
        scope.launch {
            state = state.copy(
                isPluginLoading = true,
                errorMessage = null,
                statusMessage = if (enabled) "Enabling $pluginId" else "Disabling $pluginId",
            )
            runCatching { bridge.setPluginEnabled(pluginId, enabled) }
                .onSuccess { confirmed ->
                    state = state.copy(
                        installedPlugins = state.installedPlugins.map { plugin ->
                            if (plugin.id == pluginId) plugin.copy(enabled = confirmed) else plugin
                        },
                        isPluginLoading = false,
                        statusMessage = "Updated plugin $pluginId",
                    )
                }
                .onFailure { error ->
                    state = state.copy(
                        isPluginLoading = false,
                        errorMessage = error.message ?: "Plugin toggle failed",
                        statusMessage = "Plugin toggle failed",
                    )
                    pushNotification(
                        title = "Plugin toggle failed",
                        message = error.message ?: pluginId,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun runPlugin(pluginId: String) {
        val dataset = state.selectedDataset ?: return
        val selectedIndices = dataset.channelNames.mapIndexedNotNull { index, name ->
            if (state.selectedChannelNames.contains(name)) index else null
        }
        scope.launch {
            state = state.copy(
                isPluginLoading = true,
                errorMessage = null,
                statusMessage = "Running plugin $pluginId",
            )
            runCatching {
                bridge.runPlugin(
                    pluginId = pluginId,
                    dataset = dataset,
                    selectedChannelIndices = selectedIndices,
                )
            }.onSuccess { output ->
                state = state.copy(
                    currentPluginOutput = output,
                    isPluginLoading = false,
                    statusMessage = "Plugin ${output.pluginId} finished",
                )
                pushNotification(
                    title = "Plugin finished",
                    message = output.pluginId,
                    level = NotificationLevel.Success,
                )
            }.onFailure { error ->
                state = state.copy(
                    isPluginLoading = false,
                    errorMessage = error.message ?: "Plugin execution failed",
                    statusMessage = "Plugin execution failed",
                )
                pushNotification(
                    title = "Plugin failed",
                    message = error.message ?: pluginId,
                    level = NotificationLevel.Error,
                )
            }
        }
    }

    fun exportCurrentResult(format: String) {
        state.currentResult?.let { exportResult(it, format) } ?: pushNotification(
            title = "Nothing to export",
            message = "Run or open a DDA result first.",
            level = NotificationLevel.Warning,
        )
    }

    fun exportResult(result: DdaResultSnapshot, format: String) {
        scope.launch {
            state = state.copy(
                isRunningAnalysis = false,
                errorMessage = null,
                statusMessage = "Exporting ${result.fileName} as ${format.uppercase()}",
            )
            runCatching { bridge.exportDdaResult(result, format) }
                .onSuccess { path ->
                    if (path.isNullOrBlank()) {
                        state = state.copy(statusMessage = "Export cancelled")
                    } else {
                        state = state.copy(statusMessage = "Exported result to $path")
                        pushNotification(
                            title = "Result exported",
                            message = path,
                            level = NotificationLevel.Success,
                        )
                    }
                }
                .onFailure { error ->
                    state = state.copy(
                        errorMessage = error.message ?: "Result export failed",
                        statusMessage = "Result export failed",
                    )
                    pushNotification(
                        title = "Export failed",
                        message = error.message ?: result.fileName,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun refreshNsgStatus(loadJobs: Boolean = true) {
        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = if (loadJobs) "Refreshing NSG jobs" else "Loading NSG configuration",
            )

            val credentials = runCatching { bridge.getNsgCredentialsStatus() }
            val jobs = if (loadJobs) {
                runCatching { bridge.listNsgJobs() }
            } else {
                null
            }
            val failure = credentials.exceptionOrNull() ?: jobs?.exceptionOrNull()

            state = state.copy(
                nsgCredentials = credentials.getOrNull(),
                nsgJobs = jobs?.getOrElse { state.nsgJobs } ?: state.nsgJobs,
                isNsgLoading = false,
                errorMessage = failure?.message,
                statusMessage = when {
                    failure != null -> "NSG refresh failed"
                    loadJobs -> "Loaded ${jobs?.getOrNull()?.size ?: 0} NSG jobs"
                    else -> "NSG configuration ready"
                },
            )
        }
    }

    fun saveNsgCredentials(username: String, password: String, appKey: String) {
        val cleanUsername = username.trim()
        val cleanPassword = password.trim()
        val cleanAppKey = appKey.trim()
        if (cleanUsername.isBlank() || cleanPassword.isBlank() || cleanAppKey.isBlank()) {
            pushNotification(
                title = "NSG credentials incomplete",
                message = "Username, password, and application key are all required.",
                level = NotificationLevel.Warning,
            )
            return
        }

        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Saving NSG credentials",
            )
            runCatching {
                bridge.saveNsgCredentials(cleanUsername, cleanPassword, cleanAppKey)
                bridge.getNsgCredentialsStatus()
            }.onSuccess { status ->
                state = state.copy(
                    nsgCredentials = status,
                    isNsgLoading = false,
                    statusMessage = "NSG credentials saved",
                )
                pushNotification(
                    title = "NSG ready",
                    message = "Credentials were stored securely for $cleanUsername.",
                    level = NotificationLevel.Success,
                )
                refreshNsgStatus(loadJobs = true)
            }.onFailure { error ->
                state = state.copy(
                    isNsgLoading = false,
                    errorMessage = error.message ?: "Failed to save NSG credentials",
                    statusMessage = "NSG credentials failed",
                )
                pushNotification(
                    title = "NSG credentials failed",
                    message = error.message ?: cleanUsername,
                    level = NotificationLevel.Error,
                )
            }
        }
    }

    fun deleteNsgCredentials() {
        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Removing NSG credentials",
            )
            runCatching { bridge.deleteNsgCredentials() }
                .onSuccess {
                    state = state.copy(
                        nsgCredentials = null,
                        nsgJobs = emptyList(),
                        isNsgLoading = false,
                        statusMessage = "NSG credentials removed",
                    )
                    pushNotification(
                        title = "NSG credentials removed",
                        message = "The local bridge no longer has cluster access.",
                        level = NotificationLevel.Info,
                    )
                }
                .onFailure { error ->
                    state = state.copy(
                        isNsgLoading = false,
                        errorMessage = error.message ?: "Failed to remove NSG credentials",
                        statusMessage = "NSG credential removal failed",
                    )
                    pushNotification(
                        title = "NSG credential removal failed",
                        message = error.message ?: "Unable to delete credentials",
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun testNsgConnection() {
        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Testing NSG connection",
            )
            runCatching { bridge.testNsgConnection() }
                .onSuccess { connected ->
                    state = state.copy(
                        isNsgLoading = false,
                        statusMessage = if (connected) "NSG connection successful" else "NSG connection failed",
                    )
                    pushNotification(
                        title = if (connected) "NSG connected" else "NSG connection failed",
                        message = if (connected) {
                            "The cluster credentials were accepted."
                        } else {
                            "The bridge reached NSG but the credentials were rejected."
                        },
                        level = if (connected) NotificationLevel.Success else NotificationLevel.Warning,
                    )
                }
                .onFailure { error ->
                    state = state.copy(
                        isNsgLoading = false,
                        errorMessage = error.message ?: "Failed to test NSG connection",
                        statusMessage = "NSG connection test failed",
                    )
                    pushNotification(
                        title = "NSG test failed",
                        message = error.message ?: "Unable to contact NSG",
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun createAndSubmitNsgJob(
        runtimeHours: Double?,
        cores: Int?,
        nodes: Int?,
    ) {
        val dataset = state.selectedDataset ?: run {
            pushNotification(
                title = "No dataset selected",
                message = "Open a dataset before creating an NSG job.",
                level = NotificationLevel.Warning,
            )
            return
        }
        val selectedIndices = dataset.channelNames.mapIndexedNotNull { index, name ->
            if (state.selectedChannelNames.contains(name)) index else null
        }
        if (selectedIndices.isEmpty()) {
            pushNotification(
                title = "No channels selected",
                message = "Pick at least one channel before creating an NSG job.",
                level = NotificationLevel.Warning,
            )
            return
        }

        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Creating NSG job for ${dataset.fileName}",
            )
            runCatching {
                val queued = bridge.createNsgJob(
                    dataset = dataset,
                    config = state.ddaConfig,
                    selectedChannelIndices = selectedIndices,
                    runtimeHours = runtimeHours,
                    cores = cores,
                    nodes = nodes,
                )
                bridge.submitNsgJob(queued.id)
            }.onSuccess { submitted ->
                val nextJobs = (listOf(submitted) + state.nsgJobs.filterNot { it.id == submitted.id })
                    .sortedByDescending(NsgJobSnapshot::createdAt)
                state = state.copy(
                    nsgJobs = nextJobs,
                    isNsgLoading = false,
                    statusMessage = "Submitted NSG job ${submitted.id.take(8)}",
                )
                pushNotification(
                    title = "NSG job submitted",
                    message = "${dataset.fileName} is queued on NSG.",
                    level = NotificationLevel.Success,
                )
            }.onFailure { error ->
                state = state.copy(
                    isNsgLoading = false,
                    errorMessage = error.message ?: "Failed to submit NSG job",
                    statusMessage = "NSG submission failed",
                )
                pushNotification(
                    title = "NSG submission failed",
                    message = error.message ?: dataset.fileName,
                    level = NotificationLevel.Error,
                )
            }
        }
    }

    fun submitNsgJob(jobId: String) {
        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Submitting NSG job $jobId",
            )
            runCatching { bridge.submitNsgJob(jobId) }
                .onSuccess { job ->
                    val nextJobs = (listOf(job) + state.nsgJobs.filterNot { it.id == job.id })
                        .sortedByDescending(NsgJobSnapshot::createdAt)
                    state = state.copy(
                        nsgJobs = nextJobs,
                        isNsgLoading = false,
                        statusMessage = "Submitted NSG job ${job.id.take(8)}",
                    )
                }
                .onFailure { error ->
                    state = state.copy(
                        isNsgLoading = false,
                        errorMessage = error.message ?: "Failed to submit NSG job",
                        statusMessage = "NSG submission failed",
                    )
                    pushNotification(
                        title = "NSG submission failed",
                        message = error.message ?: jobId,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun refreshNsgJob(jobId: String) {
        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Refreshing NSG job $jobId",
            )
            runCatching { bridge.refreshNsgJob(jobId) }
                .onSuccess { refreshed ->
                    val nextJobs = state.nsgJobs
                        .map { if (it.id == refreshed.id) refreshed else it }
                        .ifEmpty { listOf(refreshed) }
                        .sortedByDescending(NsgJobSnapshot::createdAt)
                    state = state.copy(
                        nsgJobs = nextJobs,
                        isNsgLoading = false,
                        statusMessage = "Updated NSG job ${refreshed.id.take(8)}",
                    )
                }
                .onFailure { error ->
                    state = state.copy(
                        isNsgLoading = false,
                        errorMessage = error.message ?: "Failed to refresh NSG job",
                        statusMessage = "NSG refresh failed",
                    )
                    pushNotification(
                        title = "NSG refresh failed",
                        message = error.message ?: jobId,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun cancelNsgJob(jobId: String) {
        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Cancelling NSG job $jobId",
            )
            runCatching { bridge.cancelNsgJob(jobId) }
                .onSuccess {
                    state = state.copy(
                        isNsgLoading = false,
                        statusMessage = "Cancelled NSG job ${jobId.take(8)}",
                    )
                    pushNotification(
                        title = "NSG job cancelled",
                        message = jobId,
                        level = NotificationLevel.Info,
                    )
                    refreshNsgStatus(loadJobs = true)
                }
                .onFailure { error ->
                    state = state.copy(
                        isNsgLoading = false,
                        errorMessage = error.message ?: "Failed to cancel NSG job",
                        statusMessage = "NSG cancellation failed",
                    )
                    pushNotification(
                        title = "NSG cancellation failed",
                        message = error.message ?: jobId,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun downloadNsgResults(jobId: String) {
        scope.launch {
            state = state.copy(
                isNsgLoading = true,
                errorMessage = null,
                statusMessage = "Downloading NSG results for $jobId",
            )
            runCatching { bridge.downloadNsgResults(jobId) }
                .onSuccess { paths ->
                    state = state.copy(
                        nsgLastDownloadedPaths = paths,
                        isNsgLoading = false,
                        statusMessage = "Downloaded ${paths.size} NSG files",
                    )
                    pushNotification(
                        title = "NSG results downloaded",
                        message = if (paths.isEmpty()) jobId else paths.first(),
                        level = NotificationLevel.Success,
                    )
                    refreshNsgStatus(loadJobs = true)
                }
                .onFailure { error ->
                    state = state.copy(
                        isNsgLoading = false,
                        errorMessage = error.message ?: "Failed to download NSG results",
                        statusMessage = "NSG download failed",
                    )
                    pushNotification(
                        title = "NSG download failed",
                        message = error.message ?: jobId,
                        level = NotificationLevel.Error,
                    )
                }
        }
    }

    fun runBatchAnalysis(paths: List<String>) {
        val uniquePaths = paths
            .map(String::trim)
            .filter(String::isNotBlank)
            .distinct()
        if (uniquePaths.isEmpty()) {
            pushNotification(
                title = "Batch queue is empty",
                message = "Choose at least one file before starting batch analysis.",
                level = NotificationLevel.Warning,
            )
            return
        }

        val requestedChannels = state.selectedChannelNames.toSet()
        val baseConfig = state.ddaConfig
        val binaryOverride = state.settings.ddaBinaryPath.ifBlank { null }

        scope.launch {
            var nextHistory = state.history
            var latestResult: DdaResultSnapshot? = null
            val failures = mutableListOf<String>()
            var successCount = 0

            state = state.copy(
                primarySection = PrimarySection.Analyze,
                analyzeSection = AnalyzeSection.Batch,
                isRunningAnalysis = true,
                errorMessage = null,
                statusMessage = "Running batch analysis across ${uniquePaths.size} files",
            )

            uniquePaths.forEachIndexed { index, path ->
                val displayName = path.substringAfterLast('/')
                state = state.copy(
                    statusMessage = "Batch ${index + 1}/${uniquePaths.size}: loading $displayName",
                )

                val dataset = runCatching {
                    bridge.loadDataset(path)
                }.getOrElse { error ->
                    failures += "$displayName: ${error.message ?: "dataset load failed"}"
                    return@forEachIndexed
                }

                val selectedIndices = dataset.channelNames.mapIndexedNotNull { channelIndex, name ->
                    if (requestedChannels.isEmpty() || requestedChannels.contains(name)) channelIndex else null
                }.ifEmpty {
                    dataset.channelNames.indices.take(min(8, dataset.channelNames.size))
                }

                if (selectedIndices.isEmpty()) {
                    failures += "$displayName: no analyzable channels"
                    return@forEachIndexed
                }

                val maxDuration = dataset.durationSeconds.coerceAtLeast(0.0)
                val normalizedConfig = baseConfig.copy(
                    startTimeSeconds = baseConfig.startTimeSeconds.coerceIn(0.0, maxDuration),
                    endTimeSeconds = baseConfig.endTimeSeconds
                        ?.coerceIn(0.0, maxDuration)
                        ?.takeIf { it > baseConfig.startTimeSeconds },
                )

                state = state.copy(
                    statusMessage = "Batch ${index + 1}/${uniquePaths.size}: running $displayName",
                )

                runCatching {
                    bridge.runDdaAnalysis(
                        dataset = dataset,
                        config = normalizedConfig,
                        selectedChannelIndices = selectedIndices,
                        binaryOverridePath = binaryOverride,
                    )
                }.onSuccess { result ->
                    val historyEntry = AnalysisHistoryEntry(
                        id = result.id,
                        filePath = result.filePath,
                        fileName = result.fileName,
                        createdAtIso = result.createdAtIso,
                        engineLabel = result.engineLabel,
                        variants = result.variants.map { it.id.code },
                        result = result,
                    )
                    nextHistory = listOf(historyEntry) + nextHistory
                        .filterNot { it.id == historyEntry.id }
                        .take(19)
                    latestResult = result
                    successCount++
                    state = state.copy(
                        currentResult = result,
                        activeVariant = result.variants.firstOrNull()?.id,
                        history = nextHistory,
                        statusMessage = "Batch ${index + 1}/${uniquePaths.size}: completed $displayName",
                    )
                }.onFailure { error ->
                    failures += "$displayName: ${error.message ?: "analysis failed"}"
                }
            }

            state = state.copy(
                history = nextHistory,
                currentResult = latestResult ?: state.currentResult,
                activeVariant = latestResult?.variants?.firstOrNull()?.id ?: state.activeVariant,
                isRunningAnalysis = false,
                errorMessage = if (successCount == 0 && failures.isNotEmpty()) {
                    failures.joinToString(separator = " | ")
                } else {
                    null
                },
                statusMessage = buildString {
                    append("Batch finished: $successCount/${uniquePaths.size} succeeded")
                    if (failures.isNotEmpty()) {
                        append(" • ${failures.size} failed")
                    }
                },
            )

            pushNotification(
                title = "Batch analysis finished",
                message = buildString {
                    append("$successCount of ${uniquePaths.size} files completed.")
                    if (failures.isNotEmpty()) {
                        append(" Failures: ")
                        append(failures.take(2).joinToString())
                        if (failures.size > 2) append("...")
                    }
                },
                level = when {
                    successCount == 0 -> NotificationLevel.Error
                    failures.isNotEmpty() -> NotificationLevel.Warning
                    else -> NotificationLevel.Success
                },
            )

            if (successCount > 0) {
                savePersistedState()
            }
        }
    }

    private fun pushNotification(
        title: String,
        message: String,
        level: NotificationLevel,
    ) {
        val next = NotificationEntry(
            id = "${title.lowercase()}-${Random.nextInt(1_000_000)}",
            createdAtIso = nowIsoGuess(),
            title = title,
            message = message,
            level = level,
        )
        state = state.copy(
            notifications = listOf(next) + state.notifications.take(39),
        )
    }

    private fun nowIsoGuess(): String {
        val latestHistory = state.history.firstOrNull()?.createdAtIso
        return latestHistory ?: "just now"
    }

    private fun mergeDdaResults(
        analysisId: String,
        requestedOrder: List<DdaVariantId>,
        current: DdaResultSnapshot?,
        next: DdaResultSnapshot,
    ): DdaResultSnapshot {
        if (current == null) {
            return next.copy(
                id = analysisId,
            )
        }

        val variantsById = linkedMapOf<DdaVariantId, DdaVariantSnapshot>()
        current.variants.forEach { variantsById[it.id] = it }
        next.variants.forEach { variantsById[it.id] = it }
        val hasNative = resultHasNativeContent(current) || resultHasNativeContent(next)
        val hasPreview = resultHasPreviewContent(current) || resultHasPreviewContent(next)

        return current.copy(
            id = analysisId,
            engineLabel = when {
                hasNative && hasPreview -> "Mixed native + preview"
                hasPreview -> "Preview fallback"
                else -> "Rust CLI"
            },
            diagnostics = (current.diagnostics + next.diagnostics).distinct(),
            windowCentersSeconds = if (next.windowCentersSeconds.size > current.windowCentersSeconds.size) {
                next.windowCentersSeconds
            } else {
                current.windowCentersSeconds
            },
            variants = requestedOrder.mapNotNull(variantsById::get),
            isFallback = hasPreview,
        )
    }

    private fun resultHasNativeContent(result: DdaResultSnapshot): Boolean {
        if (result.engineLabel.contains("mixed", ignoreCase = true)) return true
        if (result.engineLabel.contains("rust cli", ignoreCase = true)) return true
        return !result.isFallback
    }

    private fun resultHasPreviewContent(result: DdaResultSnapshot): Boolean {
        if (result.engineLabel.contains("mixed", ignoreCase = true)) return true
        if (result.engineLabel.contains("preview", ignoreCase = true)) return true
        return result.isFallback
    }

    private fun ddaVariantExecutionPriority(variant: DdaVariantId): Int = when (variant) {
        DdaVariantId.ST -> 0
        DdaVariantId.SY -> 1
        DdaVariantId.DE -> 2
        DdaVariantId.CT -> 3
        DdaVariantId.CD -> 4
    }

    private fun savePersistedState() {
        val snapshot = PersistedState(
            settings = state.settings,
            recentFiles = state.recentFiles,
            history = state.history,
            icaHistory = state.icaHistory,
            annotations = state.annotations,
            notifications = state.notifications,
            browserPaneWidthDp = state.browserPaneWidthDp,
            browserPaneCollapsed = state.browserPaneCollapsed,
            lastDirectory = state.browserPath,
            lastFile = state.selectedDataset?.filePath,
        )
        scope.launch {
            bridge.savePersistedState(snapshot)
        }
    }

    private fun refreshWaveform(forceOverview: Boolean) {
        val dataset = state.selectedDataset ?: return
        if (state.selectedChannelNames.isEmpty()) {
            state = state.copy(
                waveformWindow = null,
                waveformOverview = null,
                waveformErrorMessage = "Select at least one channel to visualize.",
                isWaveformLoading = false,
                isOverviewLoading = false,
            )
            return
        }

        val startTime = state.waveformViewportStartSeconds
        val duration = state.waveformViewportDurationSeconds
        val selectedChannels = state.selectedChannelNames
        val overviewChannels = listOf(selectedChannels.first())

        waveformWindowJob?.cancel()
        waveformWindowJob = scope.launch {
            state = state.copy(
                isWaveformLoading = true,
                waveformErrorMessage = null,
            )
            runCatching {
                bridge.loadWaveformWindow(
                    dataset = dataset,
                    startTimeSeconds = startTime,
                    durationSeconds = duration,
                    channelNames = selectedChannels,
                )
            }.onSuccess { window ->
                if (state.selectedDataset?.filePath != dataset.filePath) return@onSuccess
                state = state.copy(
                    waveformWindow = window,
                    isWaveformLoading = false,
                    waveformErrorMessage = null,
                )
            }.onFailure { error ->
                if (state.selectedDataset?.filePath != dataset.filePath) return@onFailure
                pushNotification(
                    title = "Waveform load failed",
                    message = error.message ?: "Unable to read waveform window.",
                    level = NotificationLevel.Error,
                )
                state = state.copy(
                    isWaveformLoading = false,
                    waveformErrorMessage = error.message ?: "Unable to read waveform window.",
                )
            }
        }

        if (forceOverview || state.waveformOverview == null) {
            waveformOverviewJob?.cancel()
            waveformOverviewJob = scope.launch {
                state = state.copy(isOverviewLoading = true)
                runCatching {
                    bridge.loadWaveformOverview(
                        dataset = dataset,
                        channelNames = overviewChannels,
                    )
                }.onSuccess { overview ->
                    if (state.selectedDataset?.filePath != dataset.filePath) return@onSuccess
                    state = state.copy(
                        waveformOverview = overview,
                        isOverviewLoading = false,
                    )
                }.onFailure { error ->
                    if (state.selectedDataset?.filePath != dataset.filePath) return@onFailure
                    pushNotification(
                        title = "Overview load failed",
                        message = error.message ?: "Unable to build overview.",
                        level = NotificationLevel.Warning,
                    )
                    state = state.copy(
                        isOverviewLoading = false,
                        waveformErrorMessage = error.message ?: "Unable to build overview.",
                    )
                }
            }
        }
    }
}
