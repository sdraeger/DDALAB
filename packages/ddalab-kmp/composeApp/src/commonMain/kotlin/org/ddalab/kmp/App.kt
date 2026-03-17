package org.ddalab.kmp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.RowScope
import org.ddalab.composeapp.generated.resources.Res
import org.ddalab.composeapp.generated.resources.ibm_plex_sans_medium
import org.ddalab.composeapp.generated.resources.ibm_plex_sans_regular
import org.ddalab.composeapp.generated.resources.ibm_plex_sans_semibold
import org.jetbrains.compose.resources.Font
import kotlin.math.abs
import kotlin.math.sqrt

private val LightPalette = lightColorScheme(
    primary = Color(0xFF2563EB),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFEAF2FF),
    onPrimaryContainer = Color(0xFF17367A),
    secondary = Color(0xFF5B6B7B),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEFF3F7),
    onSecondaryContainer = Color(0xFF243240),
    tertiary = Color(0xFF0F766E),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD8F3EF),
    onTertiaryContainer = Color(0xFF10433F),
    background = Color(0xFFF8FAFC),
    onBackground = Color(0xFF0F172A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = Color(0xFF5B6B7B),
    outline = Color(0xFFD8E0E8),
    error = Color(0xFFDC2626),
    onError = Color(0xFFFFFFFF),
)

private val DarkPalette = darkColorScheme(
    primary = Color(0xFF60A5FA),
    onPrimary = Color(0xFF0B1220),
    primaryContainer = Color(0xFF172554),
    onPrimaryContainer = Color(0xFFDBEAFE),
    secondary = Color(0xFF94A3B8),
    onSecondary = Color(0xFF0F172A),
    secondaryContainer = Color(0xFF1E293B),
    onSecondaryContainer = Color(0xFFE2E8F0),
    tertiary = Color(0xFF2DD4BF),
    onTertiary = Color(0xFF042F2E),
    tertiaryContainer = Color(0xFF134E4A),
    onTertiaryContainer = Color(0xFFCCFBF1),
    background = Color(0xFF0B1220),
    onBackground = Color(0xFFF8FAFC),
    surface = Color(0xFF111827),
    onSurface = Color(0xFFF8FAFC),
    surfaceVariant = Color(0xFF1E293B),
    onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF334155),
    error = Color(0xFFF87171),
    onError = Color(0xFF1F0A0A),
)

private val BaseTypography = Typography()

private val ClinicalShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(12.dp),
    extraLarge = RoundedCornerShape(14.dp),
)

@Composable
private fun rememberClinicalTypography(): Typography {
    val regular = Font(Res.font.ibm_plex_sans_regular, FontWeight.Normal)
    val medium = Font(Res.font.ibm_plex_sans_medium, FontWeight.Medium)
    val semibold = Font(Res.font.ibm_plex_sans_semibold, FontWeight.SemiBold)
    val plexSans = remember(regular, medium, semibold) {
        FontFamily(regular, medium, semibold)
    }
    return remember(plexSans) {
        BaseTypography.copy(
            headlineMedium = BaseTypography.headlineMedium.copy(
                fontFamily = plexSans,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.7).sp,
            ),
            headlineSmall = BaseTypography.headlineSmall.copy(
                fontFamily = plexSans,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.4).sp,
            ),
            titleLarge = BaseTypography.titleLarge.copy(
                fontFamily = plexSans,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.15).sp,
            ),
            titleMedium = BaseTypography.titleMedium.copy(
                fontFamily = plexSans,
                fontWeight = FontWeight.Medium,
            ),
            bodyLarge = BaseTypography.bodyLarge.copy(
                fontFamily = plexSans,
                lineHeight = 23.sp,
            ),
            bodyMedium = BaseTypography.bodyMedium.copy(
                fontFamily = plexSans,
                lineHeight = 21.sp,
            ),
            bodySmall = BaseTypography.bodySmall.copy(
                fontFamily = plexSans,
                lineHeight = 18.sp,
            ),
            labelLarge = BaseTypography.labelLarge.copy(
                fontFamily = plexSans,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.1.sp,
            ),
            labelMedium = BaseTypography.labelMedium.copy(
                fontFamily = plexSans,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.15.sp,
            ),
            labelSmall = BaseTypography.labelSmall.copy(
                fontFamily = plexSans,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.2.sp,
            ),
        )
    }
}

@Composable
fun DDALabApp(bridge: AppBridge) {
    val scope = rememberCoroutineScope()
    val store = remember(bridge) { AppStore(bridge, scope) }
    val state = store.state
    val density = LocalDensity.current
    val systemDarkTheme = isSystemInDarkTheme()
    val useDarkPalette = when (state.settings.themePreference) {
        ThemePreference.System -> systemDarkTheme
        ThemePreference.Light -> false
        ThemePreference.Dark -> true
    }
    val palette = if (useDarkPalette) DarkPalette else LightPalette
    val typography = rememberClinicalTypography()

    MaterialTheme(
        colorScheme = palette,
        typography = typography,
        shapes = ClinicalShapes,
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                TopBar(state = state, store = store)
                if (
                    state.isRunningAnalysis ||
                    state.isDirectoryLoading ||
                    state.isDatasetLoading ||
                    state.isWaveformLoading ||
                    state.isOverviewLoading ||
                    state.isRunningIca ||
                    state.isPluginLoading ||
                    state.isPluginRegistryLoading ||
                    state.isNsgLoading
                ) {
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        trackColor = MaterialTheme.colorScheme.surfaceVariant,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                state.errorMessage?.let { message ->
                    ErrorStrip(message = message)
                }
                Row(
                    modifier = Modifier.fillMaxSize(),
                ) {
                    AppNavigationRail(
                        current = state.primarySection,
                        onSelect = store::setPrimarySection,
                        notificationCount = state.notifications.size,
                    )
                    if (state.browserPaneCollapsed) {
                        CollapsedBrowserPane(
                            selectedFileName = state.selectedDataset?.fileName,
                            onExpand = store::toggleBrowserPaneCollapsed,
                            onChooseFile = store::chooseFile,
                        )
                    } else {
                        DataBrowserPane(
                            state = state,
                            widthDp = state.browserPaneWidthDp,
                            onRefresh = { store.refreshDirectory() },
                            onOpenParent = store::openParentDirectory,
                            onBrowsePath = store::refreshDirectory,
                            onSearch = store::updateBrowserSearch,
                            onEntryClick = store::openEntry,
                            onChooseRoot = store::chooseRootDirectory,
                            onChooseFile = store::chooseFile,
                            onCollapse = store::toggleBrowserPaneCollapsed,
                        )
                        BrowserPaneResizeHandle(
                            onResizeDeltaPx = { deltaPx ->
                                val deltaDp = with(density) { deltaPx.toDp().value }
                                store.setBrowserPaneWidth(state.browserPaneWidthDp + deltaDp)
                            },
                            onResizeFinished = store::persistBrowserPaneLayout,
                        )
                    }
                    ContentPane(state = state, store = store)
                }
            }
        }
    }
}

@Composable
private fun TopBar(
    state: AppUiState,
    store: AppStore,
) {
    val dataset = state.selectedDataset
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 16.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.8f),
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "DDALAB Desktop",
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = dataset?.fileName ?: state.statusMessage,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                MetricPill(
                    title = "Channels",
                    value = dataset?.channels?.size?.toString() ?: "0",
                )
                MetricPill(
                    title = "History",
                    value = state.history.size.toString(),
                )
                OutlinedButton(onClick = store::cycleThemePreference) {
                    Text(themeToggleLabel(state.settings.themePreference))
                }
                OutlinedButton(
                    onClick = store::chooseFile,
                    border = BorderStroke(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.9f),
                    ),
                ) {
                    Text("Open File")
                }
                Button(
                    onClick = store::runAnalysis,
                    enabled = dataset != null && !state.isRunningAnalysis,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                ) {
                    Text(if (state.isRunningAnalysis) "Running..." else "Run DDA")
                }
            }
        }
    }
}

private fun themeToggleLabel(preference: ThemePreference): String = when (preference) {
    ThemePreference.System -> "Theme Auto"
    ThemePreference.Light -> "Theme Light"
    ThemePreference.Dark -> "Theme Dark"
}

@Composable
private fun MetricPill(
    title: String,
    value: String,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.7f),
        ),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ErrorStrip(message: String) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.error.copy(alpha = 0.08f),
        border = BorderStroke(
            width = 1.dp,
            color = MaterialTheme.colorScheme.error.copy(alpha = 0.2f),
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .height(22.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(MaterialTheme.colorScheme.error),
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun AppNavigationRail(
    current: PrimarySection,
    onSelect: (PrimarySection) -> Unit,
    notificationCount: Int,
) {
    Surface(
        modifier = Modifier
            .fillMaxHeight()
            .padding(start = 16.dp, top = 16.dp, bottom = 16.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.8f),
        ),
    ) {
        NavigationRail(
            modifier = Modifier
                .fillMaxHeight()
                .padding(vertical = 8.dp),
            containerColor = Color.Transparent,
            windowInsets = WindowInsets(0.dp),
        ) {
            Text(
                text = "DDALAB",
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(6.dp))
            PrimarySection.entries.forEach { section ->
                NavigationRailItem(
                    selected = current == section,
                    onClick = { onSelect(section) },
                    colors = NavigationRailItemDefaults.colors(
                        indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedIconColor = MaterialTheme.colorScheme.primary,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    icon = {
                        Box {
                            Icon(
                                imageVector = when (section) {
                                    PrimarySection.Overview -> Icons.Outlined.Dashboard
                                    PrimarySection.Visualize -> Icons.Outlined.ShowChart
                                    PrimarySection.Analyze -> Icons.Outlined.Psychology
                                    PrimarySection.Data -> Icons.Outlined.Storage
                                    PrimarySection.Learn -> Icons.Outlined.AutoStories
                                    PrimarySection.Plugins -> Icons.Outlined.Extension
                                    PrimarySection.Collaborate -> Icons.Outlined.Groups
                                    PrimarySection.Settings -> Icons.Outlined.Settings
                                    PrimarySection.Notifications -> Icons.Outlined.Notifications
                                },
                                contentDescription = section.label,
                            )
                            if (section == PrimarySection.Notifications && notificationCount > 0) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .size(8.dp)
                                        .background(
                                            color = MaterialTheme.colorScheme.error,
                                            shape = CircleShape,
                                        ),
                                )
                            }
                        }
                    },
                    label = { Text(section.label) },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DataBrowserPane(
    state: AppUiState,
    widthDp: Float,
    onRefresh: () -> Unit,
    onOpenParent: () -> Unit,
    onBrowsePath: (String) -> Unit,
    onSearch: (String) -> Unit,
    onEntryClick: (BrowserEntry) -> Unit,
    onChooseRoot: () -> Unit,
    onChooseFile: () -> Unit,
    onCollapse: () -> Unit,
) {
    val filteredEntries = remember(state.directoryEntries, state.browserSearch) {
        state.directoryEntries
            .filter {
                state.browserSearch.isBlank() ||
                    it.name.contains(state.browserSearch, ignoreCase = true)
            }
            .sortedWith(
                compareBy<BrowserEntry> { !it.isDirectory }
                    .thenBy { it.name.lowercase() },
            )
    }

    Card(
        modifier = Modifier
            .width(widthDp.dp)
            .fillMaxHeight()
            .padding(16.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        border = BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline.copy(alpha = 0.75f),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = "Data Browser",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        text = "Browse the repo data directory or any local dataset.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedButton(onClick = onCollapse) {
                        Text("Hide")
                    }
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "Refresh")
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    onClick = onOpenParent,
                ) {
                    Text("Parent", maxLines = 1)
                }
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    onClick = onChooseRoot,
                ) {
                    Text("Data Root", maxLines = 1)
                }
                Button(
                    modifier = Modifier.weight(1f),
                    onClick = onChooseFile,
                ) {
                    Text("Open File", maxLines = 1)
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.36f),
                    border = BorderStroke(
                        1.dp,
                        MaterialTheme.colorScheme.outline.copy(alpha = 0.55f),
                    ),
                ) {
                    Column(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = "Location",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                            )
                            Text(
                                text = "${filteredEntries.size} items",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        PathBreadcrumbBar(
                            path = state.browserPath,
                            onNavigate = onBrowsePath,
                        )
                        Text(
                            text = state.browserPath,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            OutlinedTextField(
                value = state.browserSearch,
                onValueChange = onSearch,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Search this directory") },
                singleLine = true,
                leadingIcon = {
                    Icon(Icons.Outlined.Search, contentDescription = null)
                },
            )

            HorizontalDivider()

            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(
                    items = filteredEntries,
                    key = { entry -> entry.path },
                ) { entry ->
                    BrowserEntryRow(
                        entry = entry,
                        selectedPath = state.selectedDataset?.filePath,
                        onClick = { onEntryClick(entry) },
                    )
                }
            }
        }
    }
}

@Composable
private fun CollapsedBrowserPane(
    selectedFileName: String?,
    onExpand: () -> Unit,
    onChooseFile: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxHeight()
            .width(88.dp)
            .padding(top = 16.dp, bottom = 16.dp),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline.copy(alpha = 0.75f),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxHeight()
                .padding(vertical = 12.dp, horizontal = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            OutlinedButton(
                modifier = Modifier.fillMaxWidth(),
                onClick = onExpand,
            ) {
                Text("Files", maxLines = 1)
            }
            IconButton(onClick = onChooseFile) {
                Icon(Icons.Outlined.FolderOpen, contentDescription = "Open file")
            }
            Text(
                text = selectedFileName ?: "No file",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun BrowserPaneResizeHandle(
    onResizeDeltaPx: (Float) -> Unit,
    onResizeFinished: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxHeight()
            .width(12.dp)
            .padding(vertical = 18.dp)
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragEnd = { onResizeFinished() },
                ) { change, dragAmount ->
                    change.consume()
                    onResizeDeltaPx(dragAmount.x)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
        )
    }
}

@Composable
private fun BrowserEntryRow(
    entry: BrowserEntry,
    selectedPath: String?,
    onClick: () -> Unit,
) {
    val isSelected = selectedPath == entry.path
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick),
        color = when {
            isSelected -> MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
            entry.isDirectory -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.32f)
            else -> MaterialTheme.colorScheme.surface
        },
        border = BorderStroke(
            1.dp,
            when {
                isSelected -> MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)
                else -> MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)
            },
        ),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                modifier = Modifier.size(36.dp),
                shape = RoundedCornerShape(10.dp),
                color = if (entry.isDirectory) {
                    MaterialTheme.colorScheme.secondaryContainer
                } else {
                    MaterialTheme.colorScheme.primaryContainer
                },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = if (entry.isDirectory) Icons.Outlined.FolderOpen else Icons.Outlined.Storage,
                        contentDescription = null,
                        tint = if (entry.isDirectory) {
                            MaterialTheme.colorScheme.onSecondaryContainer
                        } else {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        },
                    )
                }
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = if (entry.isDirectory) {
                        "Directory"
                    } else {
                        listOf(fileTypeLabel(entry.name), humanizeBytes(entry.sizeBytes))
                            .filter(String::isNotBlank)
                            .joinToString(" • ")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.66f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (isSelected) {
                    Text(
                        text = "Selected",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

@Composable
private fun PathBreadcrumbBar(
    path: String,
    onNavigate: (String) -> Unit,
) {
    val breadcrumbs = remember(path) { buildBreadcrumbs(path) }
    val visibleBreadcrumbs = remember(breadcrumbs) {
        when {
            breadcrumbs.size <= 4 -> breadcrumbs.map { it to false }
            else -> listOf(
                breadcrumbs.first() to false,
                Breadcrumb("…", "") to true,
                breadcrumbs[breadcrumbs.lastIndex - 1] to false,
                breadcrumbs.last() to false,
            )
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        visibleBreadcrumbs.forEachIndexed { index, (crumb, isEllipsis) ->
            if (index > 0) {
                Text(
                    text = "›",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (isEllipsis) {
                Text(
                    text = crumb.label,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                val isCurrent = crumb.path == breadcrumbs.lastOrNull()?.path
                Surface(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = !isCurrent) { onNavigate(crumb.path) },
                    shape = RoundedCornerShape(8.dp),
                    color = if (isCurrent) {
                        MaterialTheme.colorScheme.surface
                    } else {
                        Color.Transparent
                    },
                ) {
                    Text(
                        text = crumb.label,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isCurrent) {
                            MaterialTheme.colorScheme.onSurface
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

private fun fileTypeLabel(name: String): String {
    val extension = name.substringAfterLast('.', "").uppercase()
    return if (extension.isBlank()) "File" else extension
}

@Composable
private fun RowScope.ContentPane(
    state: AppUiState,
    store: AppStore,
) {
    Column(
        modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
            .padding(top = 16.dp, end = 16.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SecondaryTabs(state = state, store = store)
        when (state.primarySection) {
            PrimarySection.Overview -> OverviewScreen(state = state, store = store)
            PrimarySection.Visualize -> VisualizeScreen(state = state, store = store)
            PrimarySection.Analyze -> AnalyzeScreen(state = state, store = store)
            PrimarySection.Data -> DataScreen(state = state, store = store)
            PrimarySection.Learn -> LearnScreen(state = state, store = store)
            PrimarySection.Plugins -> PluginsScreen(state = state, store = store)
            PrimarySection.Collaborate -> CollaborateScreen(state = state, store = store)
            PrimarySection.Settings -> SettingsScreen(state = state, store = store)
            PrimarySection.Notifications -> NotificationsScreen(state = state, store = store)
        }
    }
}

@Composable
private fun SecondaryTabs(
    state: AppUiState,
    store: AppStore,
) {
    val scrollState = rememberScrollState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(scrollState),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        when (state.primarySection) {
            PrimarySection.Visualize -> {
                VisualizeSection.entries.forEach { section ->
                    SecondaryTabButton(
                        selected = state.visualizeSection == section,
                        onClick = { store.setVisualizeSection(section) },
                        label = section.label,
                    )
                }
            }
            PrimarySection.Analyze -> {
                AnalyzeSection.entries.forEach { section ->
                    SecondaryTabButton(
                        selected = state.analyzeSection == section,
                        onClick = { store.setAnalyzeSection(section) },
                        label = section.label,
                    )
                }
            }
            PrimarySection.Data -> {
                DataSection.entries.forEach { section ->
                    SecondaryTabButton(
                        selected = state.dataSection == section,
                        onClick = { store.setDataSection(section) },
                        label = section.label,
                    )
                }
            }
            PrimarySection.Learn -> {
                LearnSection.entries.forEach { section ->
                    SecondaryTabButton(
                        selected = state.learnSection == section,
                        onClick = { store.setLearnSection(section) },
                        label = section.label,
                    )
                }
            }
            PrimarySection.Collaborate -> {
                CollaborateSection.entries.forEach { section ->
                    SecondaryTabButton(
                        selected = state.collaborateSection == section,
                        onClick = { store.setCollaborateSection(section) },
                        label = section.label,
                    )
                }
            }
            else -> {
                AssistChip(
                    onClick = {},
                    label = { Text(state.primarySection.description) },
                    colors = androidx.compose.material3.AssistChipDefaults.assistChipColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.58f),
                        labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            }
        }
    }
}

@Composable
private fun SecondaryTabButton(
    selected: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        color = if (selected) {
            MaterialTheme.colorScheme.surface
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        },
        border = BorderStroke(
            width = 1.dp,
            color = if (selected) {
                MaterialTheme.colorScheme.outline.copy(alpha = 0.8f)
            } else {
                MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
            },
        ),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}

@Composable
private fun OverviewScreen(
    state: AppUiState,
    store: AppStore,
) {
    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            modifier = Modifier.weight(1.15f).fillMaxHeight(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            HeroCard(
                title = "Desktop-first scientific workflow",
                subtitle = "Compose Multiplatform replaces the old Next.js shell with a shared UI surface and a renderer-first visualization path.",
            )
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Recent Files",
                    value = state.recentFiles.size.toString(),
                    supporting = "Pinned from persisted state",
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "History Entries",
                    value = state.history.size.toString(),
                    supporting = "Local-first analysis memory",
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Selected File",
                    value = state.selectedDataset?.fileName ?: "None",
                    supporting = state.selectedDataset?.format?.label ?: "Open a dataset to begin",
                )
            }
            Card(
                modifier = Modifier.fillMaxWidth().weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Recent files", style = MaterialTheme.typography.titleLarge)
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(state.recentFiles, key = { it }) { recent ->
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .clickable { store.selectRecentFile(recent) },
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                            ) {
                                Text(
                                    text = recent,
                                    modifier = Modifier.padding(14.dp),
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
        Card(
            modifier = Modifier.width(320.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Latest analysis", style = MaterialTheme.typography.titleLarge)
                val latest = state.history.firstOrNull()
                if (latest == null) {
                    EmptyMiniState("Run DDA to build local history.")
                } else {
                    Text(latest.fileName, style = MaterialTheme.typography.titleMedium)
                    Text(latest.engineLabel, color = MaterialTheme.colorScheme.secondary)
                    Text(latest.variants.joinToString(" • "))
                    latest.result.diagnostics.take(4).forEach {
                        Text(
                            text = "• $it",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HeroCard(
    title: String,
    subtitle: String,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        border = BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline.copy(alpha = 0.75f),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Overview",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(title, style = MaterialTheme.typography.headlineMedium)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StatCard(
    modifier: Modifier,
    label: String,
    value: String,
    supporting: String,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline.copy(alpha = 0.72f),
        ),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                supporting,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun VisualizeScreen(
    state: AppUiState,
    store: AppStore,
) {
    val dataset = state.selectedDataset
    if (dataset == null) {
        PlaceholderScreen(
            title = "Open a dataset",
            message = "Choose a CSV, ASCII/TXT, or EDF file from the browser to activate the waveform renderer and analysis workspace.",
        )
        return
    }

    when (state.visualizeSection) {
        VisualizeSection.TimeSeries -> {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Card(
                    modifier = Modifier.width(310.dp).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(20.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(dataset.fileName, style = MaterialTheme.typography.titleLarge)
                        Text(
                            "${dataset.format.label} • ${humanizeDuration(dataset.durationSeconds)} • ${humanizeBytes(dataset.fileSizeBytes)}",
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                        )
                        MetadataLine("Channels", dataset.channels.size.toString())
                        MetadataLine("Dominant sample rate", "${formatCompact(dataset.dominantSampleRateHz)} Hz")
                        MetadataLine("Samples", dataset.totalSampleCount.toString())
                        MetadataLine("Source", dataset.sourceSummary)
                        MetadataLine(
                            "Waveform access",
                            if (dataset.supportsWindowedAccess) "Windowed / cached" else "In-memory",
                        )

                        HorizontalDivider()

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = store::selectAllChannels) {
                                Text("All")
                            }
                            OutlinedButton(onClick = { store.selectTopChannels(8) }) {
                                Text("Top 8")
                            }
                            OutlinedButton(onClick = { store.selectTopChannels(4) }) {
                                Text("Top 4")
                            }
                        }

                        Text("Visible channels", style = MaterialTheme.typography.titleMedium)
                        dataset.channelNames.forEach { channel ->
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { store.toggleChannel(channel) },
                                color = if (state.selectedChannelNames.contains(channel)) {
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                                } else {
                                    MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f)
                                },
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    Checkbox(
                                        checked = state.selectedChannelNames.contains(channel),
                                        onCheckedChange = { store.toggleChannel(channel) },
                                    )
                                    Text(channel)
                                }
                            }
                        }
                    }
                }
                WaveformWorkspace(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    dataset = dataset,
                    selectedChannels = state.selectedChannelNames,
                    window = state.waveformWindow,
                    overview = state.waveformOverview,
                    viewportStartSeconds = state.waveformViewportStartSeconds,
                    viewportDurationSeconds = state.waveformViewportDurationSeconds,
                    isWaveformLoading = state.isWaveformLoading,
                    isOverviewLoading = state.isOverviewLoading,
                    waveformErrorMessage = state.waveformErrorMessage,
                    onViewportChange = store::updateWaveformViewport,
                )
            }
        }
        VisualizeSection.Annotations -> AnnotationScreen(state = state, store = store)
        VisualizeSection.Streaming -> StreamingScreen(state = state, store = store)
    }
}

@Composable
private fun MetadataLine(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.66f),
        )
        Text(
            text = value,
            modifier = Modifier.width(160.dp),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun AnalyzeScreen(
    state: AppUiState,
    store: AppStore,
) {
    val dataset = state.selectedDataset
    if (dataset == null) {
        PlaceholderScreen(
            title = "Load a file first",
            message = "The DDA workspace activates after you open a dataset and choose the channels you want to analyze.",
        )
        return
    }

    when (state.analyzeSection) {
        AnalyzeSection.Dda -> {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                DdaConfigPane(
                    modifier = Modifier.width(320.dp).fillMaxHeight(),
                    state = state,
                    store = store,
                )
                DdaResultsPane(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    state = state,
                    store = store,
                )
                HistoryPane(
                    modifier = Modifier.width(290.dp).fillMaxHeight(),
                    state = state,
                    store = store,
                )
            }
        }
        AnalyzeSection.Ica -> IcaScreen(state = state, store = store)
        AnalyzeSection.Batch -> BatchScreen(state = state, store = store)
        AnalyzeSection.Connectivity -> ConnectivityScreen(state = state, store = store)
        AnalyzeSection.Compare -> CompareScreen(state = state, store = store)
    }
}

@Composable
private fun AnnotationScreen(
    state: AppUiState,
    store: AppStore,
) {
    val dataset = state.selectedDataset
    if (dataset == null) {
        PlaceholderScreen(
            title = "Load a dataset to annotate",
            message = "Annotations stay tied to individual datasets, channels, and time ranges, so the viewer needs an open file before this workspace becomes useful.",
        )
        return
    }

    val datasetAnnotations = remember(state.annotations, dataset.filePath) {
        state.annotations
            .filter { it.filePath == dataset.filePath }
            .sortedByDescending(DatasetAnnotationEntry::startTimeSeconds)
    }
    val targetedCount = datasetAnnotations.count { !it.channelName.isNullOrBlank() }

    var label by remember(dataset.filePath) { mutableStateOf("") }
    var note by remember(dataset.filePath) { mutableStateOf("") }
    var startText by remember(dataset.filePath) {
        mutableStateOf(formatCompact(state.waveformViewportStartSeconds))
    }
    var endText by remember(dataset.filePath) {
        mutableStateOf(
            formatCompact(
                state.waveformViewportStartSeconds + state.waveformViewportDurationSeconds,
            ),
        )
    }
    var selectedChannel by remember(dataset.filePath, state.selectedChannelNames) {
        mutableStateOf(state.selectedChannelNames.firstOrNull())
    }

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.width(360.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Annotations", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Pin review notes to the current time range or to a specific channel and keep them attached to the dataset.",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                )

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Entries",
                        value = datasetAnnotations.size.toString(),
                        supporting = dataset.fileName,
                    )
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Channel-scoped",
                        value = targetedCount.toString(),
                        supporting = "${datasetAnnotations.size - targetedCount} global",
                    )
                }

                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Label") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Note") },
                    minLines = 3,
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedTextField(
                        value = startText,
                        onValueChange = { startText = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("Start (s)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = endText,
                        onValueChange = { endText = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("End (s)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                    )
                }

                Text("Target", style = MaterialTheme.typography.titleMedium)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = selectedChannel == null,
                        onClick = { selectedChannel = null },
                        label = { Text("Global") },
                    )
                    state.selectedChannelNames.take(8).forEach { channel ->
                        FilterChip(
                            selected = selectedChannel == channel,
                            onClick = { selectedChannel = channel },
                            label = { Text(channel) },
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            startText = formatCompact(state.waveformViewportStartSeconds)
                            endText = formatCompact(
                                state.waveformViewportStartSeconds +
                                    state.waveformViewportDurationSeconds,
                            )
                            selectedChannel = state.selectedChannelNames.firstOrNull()
                        },
                    ) {
                        Text("Use Current View")
                    }
                    Button(
                        onClick = {
                            val start = startText.toDoubleOrNull() ?: 0.0
                            val end = endText.toDoubleOrNull()
                            store.addAnnotation(
                                label = label,
                                note = note,
                                startTimeSeconds = start,
                                endTimeSeconds = end,
                                channelName = selectedChannel,
                            )
                            label = ""
                            note = ""
                        },
                    ) {
                        Text("Save Annotation")
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = store::importAnnotations) {
                        Text("Import JSON")
                    }
                    OutlinedButton(onClick = { store.exportAnnotations("json") }) {
                        Text("Export JSON")
                    }
                    OutlinedButton(onClick = { store.exportAnnotations("csv") }) {
                        Text("Export CSV")
                    }
                }

                Text(
                    text = "Tip: annotations are persisted locally and stay attached to the original file path, so they continue to show up in future sessions.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        }

        Card(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Saved markers", style = MaterialTheme.typography.titleLarge)
                if (datasetAnnotations.isEmpty()) {
                    EmptyMiniState("Capture a viewport or channel note to start building a review trail.")
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(datasetAnnotations, key = { it.id }) { entry ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                            ) {
                                Column(
                                    modifier = Modifier.padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(
                                            modifier = Modifier.weight(1f),
                                            verticalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            Text(entry.label, fontWeight = FontWeight.Medium)
                                            Text(
                                                annotationRangeLabel(entry),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                            )
                                            entry.channelName?.let { channel ->
                                                Text(
                                                    channel,
                                                    style = MaterialTheme.typography.labelMedium,
                                                    color = MaterialTheme.colorScheme.secondary,
                                                )
                                            }
                                        }
                                        OutlinedButton(
                                            onClick = {
                                                store.setPrimarySection(PrimarySection.Visualize)
                                                store.setVisualizeSection(VisualizeSection.TimeSeries)
                                                store.updateWaveformViewport(
                                                    startTimeSeconds = entry.startTimeSeconds,
                                                    durationSeconds = annotationFocusDuration(entry),
                                                )
                                            },
                                        ) {
                                            Text("Focus")
                                        }
                                    }
                                    if (entry.note.isNotBlank()) {
                                        Text(
                                            entry.note,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.82f),
                                        )
                                    }
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            entry.createdAtIso,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.56f),
                                        )
                                        OutlinedButton(onClick = { store.removeAnnotation(entry.id) }) {
                                            Text("Delete")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StreamingScreen(
    state: AppUiState,
    store: AppStore,
) {
    val dataset = state.selectedDataset
    if (dataset == null) {
        PlaceholderScreen(
            title = "Load a dataset for replay",
            message = "The streaming workspace uses the same lazy chunk loader as the waveform viewer, so it can already act as a replay bench for multi-gigabyte recordings.",
        )
        return
    }

    val replayStepSeconds = maxOf(state.waveformViewportDurationSeconds / 2.0, 1.0)
    val liveEdgeStart = maxOf(dataset.durationSeconds - state.waveformViewportDurationSeconds, 0.0)
    val activityRows = remember(state.waveformWindow) {
        state.waveformWindow?.channels
            ?.map { channel ->
                StreamActivityMetric(
                    name = channel.name,
                    amplitudeSpan = channel.maxValue - channel.minValue,
                    meanAbsolute = channel.samples
                        .takeIf { it.isNotEmpty() }
                        ?.sumOf { abs(it) }
                        ?.div(channel.samples.size)
                        ?: 0.0,
                )
            }
            ?.sortedByDescending(StreamActivityMetric::amplitudeSpan)
            ?: emptyList()
    }

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            modifier = Modifier.weight(1.1f).fillMaxHeight(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text("Streaming Replay", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Use dataset-backed replay to review long recordings with the same renderer and viewport controls used for time-series inspection.",
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Viewport",
                            value = humanizeDuration(state.waveformViewportDurationSeconds),
                            supporting = "Loaded lazily from disk",
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Step",
                            value = humanizeDuration(replayStepSeconds),
                            supporting = "Replay jump size",
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Channels",
                            value = state.selectedChannelNames.size.toString(),
                            supporting = dataset.fileName,
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                store.updateWaveformViewport(
                                    state.waveformViewportStartSeconds - replayStepSeconds,
                                    state.waveformViewportDurationSeconds,
                                )
                            },
                        ) {
                            Text("Back")
                        }
                        OutlinedButton(
                            onClick = {
                                store.updateWaveformViewport(
                                    state.waveformViewportStartSeconds + replayStepSeconds,
                                    state.waveformViewportDurationSeconds,
                                )
                            },
                        ) {
                            Text("Forward")
                        }
                        Button(
                            onClick = {
                                store.updateWaveformViewport(
                                    liveEdgeStart,
                                    state.waveformViewportDurationSeconds,
                                )
                            },
                        ) {
                            Text("Jump To Live Edge")
                        }
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth().weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Acquisition parity notes", style = MaterialTheme.typography.titleLarge)
                    listOf(
                        "EDF playback uses the same chunked reader as the time-series view, so replay does not hydrate the entire file into memory.",
                        "Viewport jumps reuse the existing on-demand cache, which makes it practical to inspect very large recordings in a streaming-like loop.",
                        "The next parity slice is wiring actual LSL or device-backed frames into this same rendering pipeline.",
                    ).forEach { note ->
                        Text(
                            text = "• $note",
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.74f),
                        )
                    }
                }
            }
        }

        Card(
            modifier = Modifier.width(340.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Current chunk activity", style = MaterialTheme.typography.titleLarge)
                if (activityRows.isEmpty()) {
                    EmptyMiniState("Load or move the viewport to inspect the active chunk.")
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(activityRows, key = { it.name }) { row ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                            ) {
                                Column(
                                    modifier = Modifier.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(row.name, fontWeight = FontWeight.Medium)
                                    Text(
                                        "Span ${formatCompact(row.amplitudeSpan.toDouble())} • Mean |x| ${formatCompact(row.meanAbsolute)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun IcaScreen(
    state: AppUiState,
    store: AppStore,
) {
    val dataset = state.selectedDataset
    if (dataset == null) {
        PlaceholderScreen(
            title = "Open a dataset first",
            message = "The ICA workbench needs the currently loaded channels and viewport before it can size a decomposition run.",
        )
        return
    }

    val preview = remember(state.waveformWindow) {
        state.waveformWindow?.let(::buildIcaPreview)
    }
    var nComponentsText by remember(dataset.filePath) {
        mutableStateOf(minOf(state.selectedChannelNames.size.coerceAtLeast(2), 8).toString())
    }
    var maxIterationsText by remember(dataset.filePath) { mutableStateOf("400") }
    var toleranceText by remember(dataset.filePath) { mutableStateOf("0.0001") }
    var startText by remember(dataset.filePath, state.waveformViewportStartSeconds) {
        mutableStateOf(formatCompact(state.waveformViewportStartSeconds))
    }
    var endText by remember(dataset.filePath, state.waveformViewportDurationSeconds) {
        mutableStateOf(
            formatCompact(state.waveformViewportStartSeconds + state.waveformViewportDurationSeconds),
        )
    }
    var centeringEnabled by remember(dataset.filePath) { mutableStateOf(true) }
    var whiteningEnabled by remember(dataset.filePath) { mutableStateOf(true) }
    val currentResult = state.currentIcaResult?.takeIf { it.filePath == dataset.filePath } ?: state.currentIcaResult

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.width(360.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("ICA Workbench", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Configure ICA against the current channel selection and time window, then inspect extracted components and stability metrics beside the waveform view.",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                )

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Visible channels",
                        value = state.selectedChannelNames.size.toString(),
                        supporting = dataset.fileName,
                    )
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Window",
                        value = humanizeDuration(state.waveformViewportDurationSeconds),
                        supporting = "Current waveform span",
                    )
                }

                preview?.let { model ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Suggested comps",
                            value = model.suggestedComponents.toString(),
                            supporting = "Based on visible channels",
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Strongest pair",
                            value = model.topPairs.firstOrNull()?.label ?: "n/a",
                            supporting = model.topPairs.firstOrNull()
                                ?.let { "r=${formatCompact(it.correlation)}" }
                                ?: "Need more signal",
                        )
                    }
                }

                Button(
                    onClick = {
                        store.runIcaAnalysis(
                            startTimeSeconds = startText.toDoubleOrNull(),
                            endTimeSeconds = endText.toDoubleOrNull(),
                            nComponents = nComponentsText.toIntOrNull(),
                            maxIterations = maxIterationsText.toIntOrNull() ?: 400,
                            tolerance = toleranceText.toDoubleOrNull() ?: 0.0001,
                            centering = centeringEnabled,
                            whitening = whiteningEnabled,
                        )
                    },
                    enabled = preview != null && !state.isRunningIca,
                ) {
                    Text(if (state.isRunningIca) "Running..." else "Run ICA")
                }

                OutlinedTextField(
                    value = nComponentsText,
                    onValueChange = { nComponentsText = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Components") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = maxIterationsText,
                    onValueChange = { maxIterationsText = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Max iterations") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = toleranceText,
                    onValueChange = { toleranceText = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Tolerance") },
                    singleLine = true,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedTextField(
                        value = startText,
                        onValueChange = { startText = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("Start (s)") },
                        singleLine = true,
                    )
                    OutlinedTextField(
                        value = endText,
                        onValueChange = { endText = it },
                        modifier = Modifier.weight(1f),
                        label = { Text("End (s)") },
                        singleLine = true,
                    )
                }

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Center data")
                            Switch(
                                checked = centeringEnabled,
                                onCheckedChange = { centeringEnabled = it },
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Whiten data")
                            Switch(
                                checked = whiteningEnabled,
                                onCheckedChange = { whiteningEnabled = it },
                            )
                        }
                    }
                }
            }
        }

        Column(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Card(
                modifier = Modifier.fillMaxWidth().weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Channel stability", style = MaterialTheme.typography.titleLarge)
                    val components = currentResult?.components.orEmpty()
                    if (components.isEmpty()) {
                        EmptyMiniState("Run ICA to inspect extracted components and spatial weights.")
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(components, key = { it.componentId }) { component ->
                                Surface(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(14.dp),
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                                ) {
                                    Column(
                                        modifier = Modifier.padding(14.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Text("Component ${component.componentId + 1}", fontWeight = FontWeight.Medium)
                                        Text(
                                            "Kurtosis ${formatCompact(component.kurtosis)} • Variance ${formatCompact(component.varianceExplained)}%",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                        )
                                        Text(
                                            "Weights: ${component.spatialMap.take(4).joinToString { formatCompact(it.toDouble()) }}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.secondary,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth().weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("ICA history", style = MaterialTheme.typography.titleLarge)
                    val history = state.icaHistory.filter { it.filePath == dataset.filePath }
                    if (history.isEmpty()) {
                        EmptyMiniState("Completed ICA runs for this file will appear here.")
                    } else {
                        history.forEach { result ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
                            ) {
                                Row(
                                    modifier = Modifier.padding(14.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(result.createdAtIso, fontWeight = FontWeight.Medium)
                                        Text(
                                            "${result.components.size} components • ${result.channelNames.size} channels",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                        )
                                    }
                                    OutlinedButton(onClick = { store.loadIcaResult(result) }) {
                                        Text("Open")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BatchScreen(
    state: AppUiState,
    store: AppStore,
) {
    val candidatePaths = remember(
        state.selectedDataset?.filePath,
        state.recentFiles,
        state.directoryEntries,
    ) {
        (
            listOfNotNull(state.selectedDataset?.filePath) +
                state.recentFiles +
                state.directoryEntries
                    .filter { !it.isDirectory && it.supported }
                    .map(BrowserEntry::path)
        ).distinct()
    }
    var selectedPaths by remember(candidatePaths) {
        mutableStateOf(candidatePaths.take(minOf(3, candidatePaths.size)).toSet())
    }

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Batch Processing", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Queue multiple local datasets and reuse the same DDA configuration across them for repeatable batch runs.",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                )

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Queue",
                        value = selectedPaths.size.toString(),
                        supporting = "${candidatePaths.size} available files",
                    )
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Variants",
                        value = state.ddaConfig.selectedVariants.size.toString(),
                        supporting = state.ddaConfig.selectedVariants.joinToString { it.code },
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { selectedPaths = candidatePaths.toSet() },
                        enabled = candidatePaths.isNotEmpty(),
                    ) {
                        Text("Select All")
                    }
                    OutlinedButton(
                        onClick = {
                            selectedPaths = candidatePaths
                                .filter { state.recentFiles.contains(it) }
                                .toSet()
                        },
                    ) {
                        Text("Recent Only")
                    }
                    Button(
                        onClick = { store.runBatchAnalysis(selectedPaths.toList()) },
                        enabled = selectedPaths.isNotEmpty() && !state.isRunningAnalysis,
                    ) {
                        Text(if (state.isRunningAnalysis) "Running..." else "Run Batch")
                    }
                }

                if (candidatePaths.isEmpty()) {
                    EmptyMiniState("Open a few supported files or browse a data directory to seed the batch queue.")
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(candidatePaths, key = { it }) { path ->
                            val isSelected = selectedPaths.contains(path)
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .clickable {
                                        selectedPaths = if (isSelected) {
                                            selectedPaths - path
                                        } else {
                                            selectedPaths + path
                                        }
                                    },
                                color = if (isSelected) {
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                                } else {
                                    MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f)
                                },
                            ) {
                                Row(
                                    modifier = Modifier.padding(14.dp),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Checkbox(
                                        checked = isSelected,
                                        onCheckedChange = {
                                            selectedPaths = if (isSelected) {
                                                selectedPaths - path
                                            } else {
                                                selectedPaths + path
                                            }
                                        },
                                    )
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(path.substringAfterLast('/'))
                                        Text(
                                            path,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Card(
            modifier = Modifier.width(340.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Batch results", style = MaterialTheme.typography.titleLarge)
                val batchHistory = state.history.filter { selectedPaths.contains(it.filePath) }
                if (batchHistory.isEmpty()) {
                    EmptyMiniState("Completed batch runs will accumulate here.")
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(batchHistory, key = { it.id }) { entry ->
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .clickable { store.loadHistoryEntry(entry) },
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                            ) {
                                Column(
                                    modifier = Modifier.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(entry.fileName, fontWeight = FontWeight.Medium)
                                    Text(
                                        "${entry.engineLabel} • ${entry.variants.joinToString()}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                    )
                                    Text(
                                        entry.createdAtIso,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.56f),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConnectivityScreen(
    state: AppUiState,
    store: AppStore,
) {
    val candidates = remember(state.history, state.currentResult?.id) {
        val fromHistory = state.history
            .map(AnalysisHistoryEntry::result)
            .filter { result -> result.variants.any { it.id == DdaVariantId.CD || it.id == DdaVariantId.CT || it.id == DdaVariantId.SY } }
        val current = state.currentResult
            ?.takeIf { result -> result.variants.any { it.id == DdaVariantId.CD || it.id == DdaVariantId.CT || it.id == DdaVariantId.SY } }
        listOfNotNull(current).plus(fromHistory).distinctBy(DdaResultSnapshot::id)
    }
    var selectedResultId by remember(candidates) {
        mutableStateOf(candidates.firstOrNull()?.id)
    }
    val selected = candidates.firstOrNull { it.id == selectedResultId } ?: candidates.firstOrNull()
    val connectivityVariant = selected?.variants
        ?.firstOrNull { it.id == DdaVariantId.CD }
        ?: selected?.variants?.firstOrNull { it.id == DdaVariantId.CT || it.id == DdaVariantId.SY }
    val metrics = remember(connectivityVariant?.id, connectivityVariant?.rowLabels, connectivityVariant?.matrix) {
        connectivityVariant?.let(::buildConnectivityMetrics).orEmpty()
    }

    if (selected == null || connectivityVariant == null) {
        PlaceholderScreen(
            title = "No connectivity-ready analyses yet",
            message = "Run DDA with CT, CD, or SY enabled and the connectivity view will populate from saved analysis history.",
        )
        return
    }

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.width(320.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Saved analyses", style = MaterialTheme.typography.titleLarge)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(candidates, key = { it.id }) { result ->
                        val isSelected = result.id == selected.id
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .clickable { selectedResultId = result.id },
                            color = if (isSelected) {
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f)
                            },
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(result.fileName, fontWeight = FontWeight.Medium)
                                Text(
                                    result.variants.joinToString { it.id.code },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                )
                                Text(
                                    result.createdAtIso,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.56f),
                                )
                            }
                        }
                    }
                }
            }
        }

        Column(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text("Connectivity summary", style = MaterialTheme.typography.titleLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Variant",
                            value = connectivityVariant.id.code,
                            supporting = connectivityVariant.summary,
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Rows",
                            value = connectivityVariant.rowLabels.size.toString(),
                            supporting = "${selected.windowCentersSeconds.size} windows",
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Strongest edge",
                            value = metrics.firstOrNull()?.label ?: "n/a",
                            supporting = metrics.firstOrNull()
                                ?.let { "mean |x| ${formatCompact(it.meanAbsolute)}" }
                                ?: "Need more data",
                        )
                    }
                    OutlinedButton(onClick = {
                        state.history.firstOrNull { it.id == selected.id }?.let(store::loadHistoryEntry)
                    }) {
                        Text("Open In DDA")
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth().weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Ranked edges / motifs", style = MaterialTheme.typography.titleLarge)
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(metrics.take(18), key = { it.label }) { metric ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                            ) {
                                Row(
                                    modifier = Modifier.padding(14.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(metric.label, fontWeight = FontWeight.Medium)
                                        Text(
                                            "Peak |x| ${formatCompact(metric.peakAbsolute)}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                        )
                                    }
                                    Text(
                                        formatCompact(metric.meanAbsolute),
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CompareScreen(
    state: AppUiState,
    store: AppStore,
) {
    val baseline = state.currentResult ?: state.history.firstOrNull()?.result
    if (baseline == null || state.history.size < 2) {
        PlaceholderScreen(
            title = "Need at least two analyses",
            message = "The compare workspace activates after you have a baseline result plus another saved run to contrast against it.",
        )
        return
    }

    val compareCandidates = remember(state.history, baseline.id) {
        state.history
            .map(AnalysisHistoryEntry::result)
            .filterNot { it.id == baseline.id }
            .distinctBy(DdaResultSnapshot::id)
    }
    var comparisonId by remember(compareCandidates, baseline.id) {
        mutableStateOf(compareCandidates.firstOrNull()?.id)
    }
    val comparison = compareCandidates.firstOrNull { it.id == comparisonId } ?: compareCandidates.firstOrNull()
    if (comparison == null) {
        PlaceholderScreen(
            title = "No comparison target",
            message = "Run one more analysis or load a history entry to compare against the current baseline.",
        )
        return
    }

    val variantComparisons = remember(baseline.id, comparison.id) {
        buildVariantComparisons(baseline, comparison)
    }

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.width(330.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Comparison setup", style = MaterialTheme.typography.titleLarge)
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text("Baseline", fontWeight = FontWeight.Medium)
                        Text(baseline.fileName)
                        Text(
                            baseline.engineLabel,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                        )
                    }
                }

                Text("Compare against", style = MaterialTheme.typography.titleMedium)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(compareCandidates, key = { it.id }) { result ->
                        val isSelected = result.id == comparison.id
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .clickable { comparisonId = result.id },
                            color = if (isSelected) {
                                MaterialTheme.colorScheme.secondary.copy(alpha = 0.16f)
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f)
                            },
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(result.fileName, fontWeight = FontWeight.Medium)
                                Text(
                                    result.variants.joinToString { it.id.code },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                )
                            }
                        }
                    }
                }
            }
        }

        Column(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text("Comparison summary", style = MaterialTheme.typography.titleLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Baseline",
                            value = baseline.fileName,
                            supporting = baseline.createdAtIso,
                        )
                        StatCard(
                            modifier = Modifier.weight(1f),
                            label = "Target",
                            value = comparison.fileName,
                            supporting = comparison.createdAtIso,
                        )
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth().weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Variant deltas", style = MaterialTheme.typography.titleLarge)
                    if (variantComparisons.isEmpty()) {
                        EmptyMiniState("These analyses do not share any common DDA variants.")
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(variantComparisons, key = { it.id.code }) { metric ->
                                Surface(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(14.dp),
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                                ) {
                                    Column(
                                        modifier = Modifier.padding(14.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Text(metric.id.label, fontWeight = FontWeight.Medium)
                                        Text(
                                            "Baseline ${formatCompact(metric.baselineMeanAbs)} • Target ${formatCompact(metric.targetMeanAbs)}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                        )
                                        Text(
                                            "Delta ${formatCompact(metric.delta)} • Biggest row ${metric.topChangedRow ?: "n/a"}",
                                            color = if (metric.delta >= 0.0) {
                                                MaterialTheme.colorScheme.secondary
                                            } else {
                                                MaterialTheme.colorScheme.primary
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DataScreen(
    state: AppUiState,
    store: AppStore,
) {
    when (state.dataSection) {
        DataSection.OpenNeuro -> {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Card(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text("OpenNeuro", style = MaterialTheme.typography.titleLarge)
                        Text(
                            "Browse local candidates beside OpenNeuro so downloaded or staged datasets can move straight into inspection and analysis.",
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                        )

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { store.openExternalUrl("https://openneuro.org", "OpenNeuro") },
                            ) {
                                Text("Open OpenNeuro")
                            }
                            OutlinedButton(
                                onClick = { store.refreshDirectory(state.settings.dataRoot) },
                            ) {
                                Text("Browse Data Root")
                            }
                        }

                        Text("Quick local candidates", style = MaterialTheme.typography.titleMedium)
                        val localCandidates = remember(state.directoryEntries, state.recentFiles) {
                            (
                                state.directoryEntries.filter { !it.isDirectory && it.supported }
                                    .map(BrowserEntry::path) + state.recentFiles
                                ).distinct()
                        }
                        if (localCandidates.isEmpty()) {
                            EmptyMiniState("Browse a directory with supported files to build a local import shortlist.")
                        } else {
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                items(localCandidates, key = { it }) { path ->
                                    Surface(
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(14.dp),
                                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(14.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(path.substringAfterLast('/'))
                                                Text(
                                                    path,
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                )
                                            }
                                            OutlinedButton(onClick = { store.openDataset(path) }) {
                                                Text("Open")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Card(
                    modifier = Modifier.width(320.dp).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text("Ingest notes", style = MaterialTheme.typography.titleLarge)
                        listOf(
                            "The persistent browser stays visible beside every section, so repository downloads can flow directly into the local inspection path.",
                            "EDF files keep lazy, chunk-wise access after import, which matters more than the front-end shell for multi-gigabyte recordings.",
                            "Recent files and analysis history are already shared across the Visualize, Analyze, and Learn surfaces.",
                        ).forEach { note ->
                            Text(
                                text = "• $note",
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.74f),
                            )
                        }
                    }
                }
            }
        }
        DataSection.NsgJobs -> {
            NsgJobsScreen(state = state, store = store)
        }
    }
}

@Composable
private fun NsgJobsScreen(
    state: AppUiState,
    store: AppStore,
) {
    LaunchedEffect(Unit) {
        if (state.nsgCredentials == null || state.nsgJobs.isEmpty()) {
            store.refreshNsgStatus(loadJobs = true)
        }
    }

    val dataset = state.selectedDataset
    val activeJobs = remember(state.nsgJobs) {
        state.nsgJobs.count {
            it.status == NsgJobStatus.Submitted ||
                it.status == NsgJobStatus.Queue ||
                it.status == NsgJobStatus.InputStaging ||
                it.status == NsgJobStatus.Running
        }
    }
    var username by remember(state.nsgCredentials?.username) {
        mutableStateOf(state.nsgCredentials?.username.orEmpty())
    }
    var password by remember { mutableStateOf("") }
    var appKey by remember { mutableStateOf("") }
    var runtimeHoursText by remember { mutableStateOf("1") }
    var coresText by remember { mutableStateOf("1") }
    var nodesText by remember { mutableStateOf("1") }

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("NSG Jobs", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Queue the current DDA configuration on NSG, poll remote status, and pull completed artifacts back into the local workspace.",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                )

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Credentials",
                        value = if (state.nsgCredentials == null) "Missing" else "Ready",
                        supporting = state.nsgCredentials?.username ?: "Save cluster access below",
                    )
                    StatCard(
                        modifier = Modifier.weight(1f),
                        label = "Jobs",
                        value = state.nsgJobs.size.toString(),
                        supporting = "$activeJobs active",
                    )
                }

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Credential vault", style = MaterialTheme.typography.titleMedium)
                        OutlinedTextField(
                            value = username,
                            onValueChange = { username = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Username") },
                            singleLine = true,
                        )
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Password") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                        )
                        OutlinedTextField(
                            value = appKey,
                            onValueChange = { appKey = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Application key") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { store.saveNsgCredentials(username, password, appKey) },
                                enabled = !state.isNsgLoading,
                            ) {
                                Text("Save Credentials")
                            }
                            OutlinedButton(
                                onClick = store::testNsgConnection,
                                enabled = state.nsgCredentials != null && !state.isNsgLoading,
                            ) {
                                Text("Test")
                            }
                            OutlinedButton(
                                onClick = store::deleteNsgCredentials,
                                enabled = state.nsgCredentials != null && !state.isNsgLoading,
                            ) {
                                Text("Delete")
                            }
                        }
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.07f),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Submit current analysis", style = MaterialTheme.typography.titleMedium)
                        if (dataset == null) {
                            Text(
                                "Open a dataset and choose channels before creating an NSG job.",
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                            )
                        } else {
                            Text(
                                "${dataset.fileName} • ${state.selectedChannelNames.size} channels • ${state.ddaConfig.selectedVariants.joinToString { it.code }}",
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                OutlinedTextField(
                                    value = runtimeHoursText,
                                    onValueChange = { runtimeHoursText = it },
                                    modifier = Modifier.weight(1f),
                                    label = { Text("Runtime (h)") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    singleLine = true,
                                )
                                OutlinedTextField(
                                    value = coresText,
                                    onValueChange = { coresText = it },
                                    modifier = Modifier.weight(1f),
                                    label = { Text("Cores") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    singleLine = true,
                                )
                                OutlinedTextField(
                                    value = nodesText,
                                    onValueChange = { nodesText = it },
                                    modifier = Modifier.weight(1f),
                                    label = { Text("Nodes") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    singleLine = true,
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = {
                                        store.createAndSubmitNsgJob(
                                            runtimeHours = runtimeHoursText.toDoubleOrNull(),
                                            cores = coresText.toIntOrNull(),
                                            nodes = nodesText.toIntOrNull(),
                                        )
                                    },
                                    enabled = state.nsgCredentials != null && !state.isNsgLoading,
                                ) {
                                    Text("Submit to NSG")
                                }
                                OutlinedButton(
                                    onClick = {
                                        store.setPrimarySection(PrimarySection.Analyze)
                                        store.setAnalyzeSection(AnalyzeSection.Batch)
                                    },
                                ) {
                                    Text("Open Batch Queue")
                                }
                                OutlinedButton(
                                    onClick = { store.openExternalUrl("https://www.nsgportal.org", "NSG Portal") },
                                ) {
                                    Text("Open Portal")
                                }
                            }
                        }
                    }
                }
            }
        }

        Card(
            modifier = Modifier.width(420.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Remote queue", style = MaterialTheme.typography.titleLarge)
                    OutlinedButton(onClick = { store.refreshNsgStatus(loadJobs = true) }) {
                        Text("Refresh")
                    }
                }

                if (state.nsgJobs.isEmpty()) {
                    EmptyMiniState(
                        if (state.nsgCredentials == null) {
                            "Save NSG credentials to load your remote queue."
                        } else {
                            "No NSG jobs yet. Submit the current dataset to seed the queue."
                        },
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(state.nsgJobs, key = { it.id }) { job ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                            ) {
                                Column(
                                    modifier = Modifier.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                job.inputFilePath.substringAfterLast('/').ifBlank { job.id },
                                                fontWeight = FontWeight.Medium,
                                            )
                                            Text(
                                                "${job.tool} • ${job.id.take(8)}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                            )
                                        }
                                        Surface(
                                            shape = RoundedCornerShape(999.dp),
                                            color = when (job.status) {
                                                NsgJobStatus.Completed -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f)
                                                NsgJobStatus.Failed -> MaterialTheme.colorScheme.error.copy(alpha = 0.16f)
                                                NsgJobStatus.Cancelled -> MaterialTheme.colorScheme.surfaceVariant
                                                else -> MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
                                            },
                                        ) {
                                            Text(
                                                text = job.status.name,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                                style = MaterialTheme.typography.labelMedium,
                                                color = when (job.status) {
                                                    NsgJobStatus.Completed -> MaterialTheme.colorScheme.secondary
                                                    NsgJobStatus.Failed -> MaterialTheme.colorScheme.error
                                                    else -> MaterialTheme.colorScheme.onSurface
                                                },
                                            )
                                        }
                                    }
                                    Text(
                                        "Created ${job.createdAt}",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.58f),
                                    )
                                    if (!job.errorMessage.isNullOrBlank()) {
                                        Text(
                                            job.errorMessage,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.error,
                                        )
                                    }
                                    if (job.outputFiles.isNotEmpty()) {
                                        Text(
                                            "${job.outputFiles.size} output files available",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.secondary,
                                        )
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        if (job.status == NsgJobStatus.Pending) {
                                            OutlinedButton(
                                                onClick = { store.submitNsgJob(job.id) },
                                                enabled = !state.isNsgLoading,
                                            ) {
                                                Text("Submit")
                                            }
                                        } else {
                                            OutlinedButton(
                                                onClick = { store.refreshNsgJob(job.id) },
                                                enabled = !state.isNsgLoading,
                                            ) {
                                                Text("Poll")
                                            }
                                        }
                                        OutlinedButton(
                                            onClick = { store.cancelNsgJob(job.id) },
                                            enabled = !state.isNsgLoading &&
                                                job.status != NsgJobStatus.Completed &&
                                                job.status != NsgJobStatus.Cancelled &&
                                                job.status != NsgJobStatus.Failed,
                                        ) {
                                            Text("Cancel")
                                        }
                                        Button(
                                            onClick = { store.downloadNsgResults(job.id) },
                                            enabled = !state.isNsgLoading && job.status == NsgJobStatus.Completed,
                                        ) {
                                            Text("Download")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (state.nsgLastDownloadedPaths.isNotEmpty()) {
                    HorizontalDivider()
                    Text("Latest download", style = MaterialTheme.typography.titleMedium)
                    state.nsgLastDownloadedPaths.take(4).forEach { path ->
                        Text(
                            path,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.74f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LearnScreen(
    state: AppUiState,
    store: AppStore,
) {
    when (state.learnSection) {
        LearnSection.Tutorials -> {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Card(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text("Tutorials", style = MaterialTheme.typography.titleLarge)
                        listOf(
                            TutorialStep(
                                title = "1. Load a dataset",
                                description = "Start with a local EDF, CSV, or ASCII file and let the lazy loader size the initial viewport.",
                                actionLabel = "Choose File",
                                action = store::chooseFile,
                            ),
                            TutorialStep(
                                title = "2. Inspect waveforms",
                                description = "Use the Time Series tab to pick channels and zoom around the current chunk.",
                                actionLabel = "Open Time Series",
                                action = {
                                    store.setPrimarySection(PrimarySection.Visualize)
                                    store.setVisualizeSection(VisualizeSection.TimeSeries)
                                },
                            ),
                            TutorialStep(
                                title = "3. Run DDA",
                                description = "Reuse the selected channels in the DDA workspace and persist the result into history.",
                                actionLabel = "Open DDA",
                                action = {
                                    store.setPrimarySection(PrimarySection.Analyze)
                                    store.setAnalyzeSection(AnalyzeSection.Dda)
                                },
                            ),
                            TutorialStep(
                                title = "4. Capture review notes",
                                description = "Save annotations from the current viewport so the review trail stays with the dataset.",
                                actionLabel = "Open Annotations",
                                action = {
                                    store.setPrimarySection(PrimarySection.Visualize)
                                    store.setVisualizeSection(VisualizeSection.Annotations)
                                },
                            ),
                        ).forEach { step ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                            ) {
                                Row(
                                    modifier = Modifier.padding(16.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(
                                        modifier = Modifier.weight(1f),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        Text(step.title, fontWeight = FontWeight.Medium)
                                        Text(
                                            step.description,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                        )
                                    }
                                    OutlinedButton(onClick = step.action) {
                                        Text(step.actionLabel)
                                    }
                                }
                            }
                        }
                    }
                }

                Card(
                    modifier = Modifier.width(320.dp).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text("Progress", style = MaterialTheme.typography.titleLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            StatCard(
                                modifier = Modifier.weight(1f),
                                label = "Recent files",
                                value = state.recentFiles.size.toString(),
                                supporting = "Quick restart points",
                            )
                            StatCard(
                                modifier = Modifier.weight(1f),
                                label = "Saved results",
                                value = state.history.size.toString(),
                                supporting = "Ready for compare",
                            )
                        }
                    }
                }
            }
        }
        LearnSection.SampleData -> {
            val sampleCandidates = remember(state.recentFiles, state.directoryEntries) {
                (
                    state.directoryEntries.filter { !it.isDirectory && it.supported }.map(BrowserEntry::path) +
                        state.recentFiles
                    ).distinct()
            }
            Card(
                modifier = Modifier.fillMaxSize(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Sample Data", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Use these local candidates as a reusable sample-data shelf for demos, benchmarks, and reproducible tests.",
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                    )
                    if (sampleCandidates.isEmpty()) {
                        EmptyMiniState("Browse a folder with supported recordings or open a dataset once to seed this list.")
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(sampleCandidates, key = { it }) { path ->
                                Surface(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(14.dp),
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                                ) {
                                    Row(
                                        modifier = Modifier.padding(14.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(path.substringAfterLast('/'))
                                            Text(
                                                path,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                        }
                                        Button(onClick = { store.openDataset(path) }) {
                                            Text("Open")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        LearnSection.Papers -> {
            Card(
                modifier = Modifier.fillMaxSize(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("Paper Reproduction", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Use these shortcuts to move quickly between controlled inputs, repeatable configurations, and saved comparisons when reproducing a paper workflow.",
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                    )
                    listOf(
                        TutorialStep(
                            title = "Connectivity motif review",
                            description = "Enable CD or CT in DDA, then inspect ranked edges in the Connectivity tab.",
                            actionLabel = "Open Connectivity",
                            action = {
                                store.setPrimarySection(PrimarySection.Analyze)
                                store.setAnalyzeSection(AnalyzeSection.Connectivity)
                            },
                        ),
                        TutorialStep(
                            title = "Between-run comparison",
                            description = "Use saved history entries to contrast conditions or preprocessing choices.",
                            actionLabel = "Open Compare",
                            action = {
                                store.setPrimarySection(PrimarySection.Analyze)
                                store.setAnalyzeSection(AnalyzeSection.Compare)
                            },
                        ),
                    ).forEach { step ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(
                                    modifier = Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(step.title, fontWeight = FontWeight.Medium)
                                    Text(
                                        step.description,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                    )
                                }
                                OutlinedButton(onClick = step.action) {
                                    Text(step.actionLabel)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PluginsScreen(
    state: AppUiState,
    store: AppStore,
) {
    LaunchedEffect(Unit) {
        if (state.installedPlugins.isEmpty() && state.pluginRegistry.isEmpty()) {
            store.refreshPlugins()
        }
    }

    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Installed Plugins", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Install, enable, disable, and execute plugins directly against the current dataset through the native desktop runtime.",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = store::refreshPlugins) {
                        Text("Refresh")
                    }
                    OutlinedButton(
                        onClick = store::openDebugLog,
                        enabled = !state.debugLogPath.isNullOrBlank(),
                    ) {
                        Text("Open Log")
                    }
                }
                if (state.installedPlugins.isEmpty()) {
                    EmptyMiniState("No plugins are installed yet.")
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(state.installedPlugins, key = { it.id }) { plugin ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                            ) {
                                Column(
                                    modifier = Modifier.padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(plugin.name, fontWeight = FontWeight.Medium)
                                            Text(
                                                "${plugin.id} • ${plugin.version} • ${plugin.category}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                            )
                                        }
                                        Switch(
                                            checked = plugin.enabled,
                                            onCheckedChange = { enabled ->
                                                store.setPluginEnabled(plugin.id, enabled)
                                            },
                                        )
                                    }
                                    Text(
                                        plugin.description.orEmpty(),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                    )
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(
                                            onClick = { store.runPlugin(plugin.id) },
                                            enabled = state.selectedDataset != null && plugin.enabled && !state.isPluginLoading,
                                        ) {
                                            Text("Run")
                                        }
                                        OutlinedButton(onClick = { store.uninstallPlugin(plugin.id) }) {
                                            Text("Uninstall")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Card(
            modifier = Modifier.width(360.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Registry", style = MaterialTheme.typography.titleLarge)
                if (state.pluginRegistry.isEmpty()) {
                    EmptyMiniState("Registry entries will appear here after refresh.")
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(state.pluginRegistry, key = { it.id }) { plugin ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.08f),
                            ) {
                                Column(
                                    modifier = Modifier.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text(plugin.name, fontWeight = FontWeight.Medium)
                                    Text(
                                        "${plugin.id} • ${plugin.version}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                    )
                                    Text(
                                        plugin.description,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                    )
                                    OutlinedButton(
                                        onClick = { store.installPlugin(plugin.id) },
                                        enabled = state.installedPlugins.none { it.id == plugin.id },
                                    ) {
                                        Text(
                                            if (state.installedPlugins.any { it.id == plugin.id }) {
                                                "Installed"
                                            } else {
                                                "Install"
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                state.currentPluginOutput?.let { output ->
                    HorizontalDivider()
                    Text("Latest Output", style = MaterialTheme.typography.titleMedium)
                    Surface(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.24f),
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(14.dp)
                                .verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(output.pluginId, fontWeight = FontWeight.Medium)
                            Text(
                                output.outputJson,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.78f),
                            )
                            if (output.logs.isNotEmpty()) {
                                Text(
                                    output.logs.joinToString("\n"),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.secondary,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CollaborateScreen(
    state: AppUiState,
    store: AppStore,
) {
    when (state.collaborateSection) {
        CollaborateSection.Gallery -> {
            Row(
                modifier = Modifier.fillMaxSize(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Card(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text("Gallery", style = MaterialTheme.typography.titleLarge)
                        Text(
                            "Turn saved analyses into a compact gallery for review, comparison, and share-ready reporting.",
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                        )
                        if (state.history.isEmpty()) {
                            EmptyMiniState("Run and save a few analyses to populate the gallery.")
                        } else {
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                items(state.history, key = { it.id }) { entry ->
                                    Surface(
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(12.dp),
                                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.30f),
                                    ) {
                                        Column(
                                            modifier = Modifier.padding(16.dp),
                                            verticalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            Text(entry.fileName, fontWeight = FontWeight.Medium)
                                            Text(
                                                "${entry.engineLabel} • ${entry.variants.joinToString()}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                            )
                                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                OutlinedButton(onClick = { store.loadHistoryEntry(entry) }) {
                                                    Text("Open")
                                                }
                                                OutlinedButton(
                                                    onClick = {
                                                        store.loadHistoryEntry(entry)
                                                        store.setAnalyzeSection(AnalyzeSection.Compare)
                                                        store.setPrimarySection(PrimarySection.Analyze)
                                                    },
                                                ) {
                                                    Text("Compare")
                                                }
                                                OutlinedButton(onClick = { store.exportResult(entry.result, "json") }) {
                                                    Text("Export")
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Card(
                    modifier = Modifier.width(320.dp).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text("Share checklist", style = MaterialTheme.typography.titleLarge)
                        listOf(
                            "Persist the DDA result so it can be reopened from history.",
                            "Capture annotations for notable events before sharing screenshots or summaries.",
                            "Use Compare to show what changed between preprocessing runs or subject groups.",
                        ).forEach { step ->
                            Text(
                                text = "• $step",
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.74f),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DdaConfigPane(
    modifier: Modifier,
    state: AppUiState,
    store: AppStore,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("DDA Configuration", style = MaterialTheme.typography.titleLarge)
            Text(
                "Configure the DDA engine against the current dataset, channel selection, and analysis window.",
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
            )

            Text("Variants", style = MaterialTheme.typography.titleMedium)
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                DdaVariantId.entries.forEach { variant ->
                    FilterChip(
                        selected = state.ddaConfig.selectedVariants.contains(variant),
                        onClick = {
                            store.updateDdaConfig { current ->
                                val next = current.selectedVariants.toMutableSet()
                                if (next.contains(variant)) {
                                    if (next.size > 1) next.remove(variant)
                                } else {
                                    next.add(variant)
                                }
                                current.copy(selectedVariants = next)
                            }
                        },
                        label = { Text(variant.code) },
                        leadingIcon = {
                            Text(variant.label.take(2), fontSize = 11.sp)
                        },
                    )
                }
            }

            NumericField(
                label = "Window length (samples)",
                value = state.ddaConfig.windowLengthSamples.toString(),
                onValueChange = { value ->
                    value.toIntOrNull()?.let { parsed ->
                        if (parsed > 0) {
                            store.updateDdaConfig { it.copy(windowLengthSamples = parsed) }
                        }
                    }
                },
            )
            NumericField(
                label = "Window step (samples)",
                value = state.ddaConfig.windowStepSamples.toString(),
                onValueChange = { value ->
                    value.toIntOrNull()?.let { parsed ->
                        if (parsed > 0) {
                            store.updateDdaConfig { it.copy(windowStepSamples = parsed) }
                        }
                    }
                },
            )
            NumericField(
                label = "Start time (seconds)",
                value = formatCompact(state.ddaConfig.startTimeSeconds),
                onValueChange = { value ->
                    value.toDoubleOrNull()?.let { parsed ->
                        store.updateDdaConfig { it.copy(startTimeSeconds = parsed) }
                    }
                },
            )
            NumericField(
                label = "End time (seconds)",
                value = state.ddaConfig.endTimeSeconds?.let(::formatCompact) ?: "",
                onValueChange = { value ->
                    val parsed = value.toDoubleOrNull()
                    store.updateDdaConfig { it.copy(endTimeSeconds = parsed) }
                },
            )
            OutlinedTextField(
                value = state.ddaConfig.delayList.joinToString(", "),
                onValueChange = { value ->
                    val parsed = value
                        .split(',', ' ', ';')
                        .mapNotNull { token -> token.trim().toIntOrNull() }
                    if (parsed.isNotEmpty()) {
                        store.updateDdaConfig { it.copy(delayList = parsed) }
                    }
                },
                label = { Text("Delays") },
                modifier = Modifier.fillMaxWidth(),
                supportingText = { Text("Comma-separated tau values") },
            )

            Text(
                text = "Selected channels: ${state.selectedChannelNames.joinToString()}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
            )

            Button(
                onClick = store::runAnalysis,
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isRunningAnalysis && state.selectedChannelNames.isNotEmpty(),
            ) {
                Text(if (state.isRunningAnalysis) "Running..." else "Run Delay Differential Analysis")
            }

            if (state.settings.expertMode) {
                Text(
                    text = "Expert mode is enabled. Use it to expose advanced DDA controls and diagnostics while you tune a run.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        }
    }
}

@Composable
private fun NumericField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        singleLine = true,
    )
}

@Composable
private fun DdaResultsPane(
    modifier: Modifier,
    state: AppUiState,
    store: AppStore,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Results", style = MaterialTheme.typography.titleLarge)
            val result = state.currentResult
            if (result == null) {
                EmptyMiniState("Run a DDA job to populate the heatmap view.")
                return@Column
            }

            if (state.isRunningAnalysis) {
                Surface(
                    color = MaterialTheme.colorScheme.secondary.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text(
                        text = "Showing completed variants while the remaining analysis continues.",
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.82f),
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                result.variants.forEach { variant ->
                    FilterChip(
                        selected = state.activeVariant == variant.id,
                        onClick = { store.setActiveVariant(variant.id) },
                        label = { Text(variant.id.code) },
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { store.exportCurrentResult("json") }) {
                    Text("Export JSON")
                }
                OutlinedButton(onClick = { store.exportCurrentResult("csv") }) {
                    Text("Export CSV")
                }
            }

            val activeVariant = result.variants.firstOrNull { it.id == state.activeVariant }
                ?: result.variants.first()

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Engine",
                    value = result.engineLabel,
                    supporting = if (result.isFallback) "Preview fallback path" else "Rust CLI + native DDA binary",
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Windows",
                    value = result.windowCentersSeconds.size.toString(),
                    supporting = activeVariant.id.label,
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Rows",
                    value = activeVariant.rowLabels.size.toString(),
                    supporting = activeVariant.summary,
                )
            }

            VariantHeatmap(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f))
                    .padding(14.dp),
                variant = activeVariant,
                windowCenters = result.windowCentersSeconds,
                palette = MaterialTheme.colorScheme,
            )

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                result.diagnostics.take(4).forEach { diagnostic ->
                    Text(
                        text = "• $diagnostic",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryPane(
    modifier: Modifier,
    state: AppUiState,
    store: AppStore,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("History", style = MaterialTheme.typography.titleLarge)
            if (state.history.isEmpty()) {
                EmptyMiniState("Completed analyses will appear here.")
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(state.history, key = { it.id }) { entry ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .clickable { store.loadHistoryEntry(entry) },
                            color = if (entry.id == state.currentResult?.id) {
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
                            },
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(entry.fileName, fontWeight = FontWeight.Medium)
                                Text(
                                    "${entry.engineLabel} • ${entry.variants.joinToString()}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                                )
                                Text(
                                    entry.createdAtIso,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.52f),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    state: AppUiState,
    store: AppStore,
) {
    Row(
        modifier = Modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            modifier = Modifier.weight(1f).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Text("Settings", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Manage application behavior, file paths, diagnostics, and external service connections from one place.",
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f),
                )

                Text("Theme", style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ThemePreference.entries.forEach { preference ->
                        FilterChip(
                            selected = state.settings.themePreference == preference,
                            onClick = { store.updateTheme(preference) },
                            label = { Text(preference.name) },
                        )
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Expert mode", fontWeight = FontWeight.Medium)
                            Text(
                                "Expose advanced DDA controls and diagnostics across the analysis workspace.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                            )
                        }
                        Switch(
                            checked = state.settings.expertMode,
                            onCheckedChange = { store.toggleExpertMode() },
                        )
                    }
                }

                OutlinedTextField(
                    value = state.settings.dataRoot,
                    onValueChange = {},
                    enabled = false,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Data root") },
                )
                OutlinedTextField(
                    value = state.settings.ddaBinaryPath,
                    onValueChange = store::updateBinaryPath,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("DDA binary override") },
                    supportingText = {
                        Text("Leave empty to auto-detect the repo binary path.")
                    },
                )
                OutlinedTextField(
                    value = state.debugLogPath.orEmpty(),
                    onValueChange = {},
                    enabled = false,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Debug log") },
                    supportingText = {
                        Text("Dataset load and EDF parse failures are written here.")
                    },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = store::openDebugLog,
                        enabled = !state.debugLogPath.isNullOrBlank(),
                    ) {
                        Text("Open Log")
                    }
                }

                HorizontalDivider()

                Text("NSG", style = MaterialTheme.typography.titleMedium)
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            if (state.nsgCredentials == null) {
                                "No NSG credentials stored."
                            } else {
                                "Connected account: ${state.nsgCredentials.username}"
                            },
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            "Cluster credentials and job management live in Data > NSG Jobs so the submission flow stays beside the current dataset and DDA config.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.68f),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = {
                                    store.setPrimarySection(PrimarySection.Data)
                                    store.setDataSection(DataSection.NsgJobs)
                                },
                            ) {
                                Text("Open NSG Jobs")
                            }
                            OutlinedButton(
                                onClick = store::testNsgConnection,
                                enabled = state.nsgCredentials != null && !state.isNsgLoading,
                            ) {
                                Text("Test Connection")
                            }
                        }
                    }
                }
            }
        }

        Card(
            modifier = Modifier.width(320.dp).fillMaxHeight(),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Migration notes", style = MaterialTheme.typography.titleLarge)
                listOf(
                    "Shared Compose UI replaces the old Next.js shell.",
                    "Waveforms render via min/max envelope levels instead of generic chart widgets.",
                    "Real DDA still routes through the existing Rust/native engine when available.",
                    "CSV and ASCII files are normalized before handing them to the native analyzer.",
                ).forEach {
                    Text(
                        text = "• $it",
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.74f),
                    )
                }
            }
        }
    }
}

@Composable
private fun NotificationsScreen(
    state: AppUiState,
    store: AppStore,
) {
    Card(
        modifier = Modifier.fillMaxSize(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Notifications", style = MaterialTheme.typography.titleLarge)
                OutlinedButton(onClick = store::clearNotifications) {
                    Text("Clear")
                }
            }
            if (state.notifications.isEmpty()) {
                EmptyMiniState("Nothing to report yet.")
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(state.notifications, key = { it.id }) { item ->
                        val tint = when (item.level) {
                            NotificationLevel.Info -> MaterialTheme.colorScheme.primary
                            NotificationLevel.Success -> Color(0xFF2E7D32)
                            NotificationLevel.Warning -> MaterialTheme.colorScheme.secondary
                            NotificationLevel.Error -> MaterialTheme.colorScheme.error
                        }
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                            color = tint.copy(alpha = 0.10f),
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(item.title, fontWeight = FontWeight.Medium, color = tint)
                                Text(item.message)
                                Text(
                                    item.createdAtIso,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.56f),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaceholderScreen(
    title: String,
    message: String,
) {
    Card(
        modifier = Modifier.fillMaxSize(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(28.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .background(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Psychology,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                Text(title, style = MaterialTheme.typography.headlineSmall)
                Text(
                    message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.74f),
                )
            }
        }
    }
}

@Composable
private fun EmptyMiniState(message: String) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = message,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.66f),
        )
    }
}

private data class StreamActivityMetric(
    val name: String,
    val amplitudeSpan: Float,
    val meanAbsolute: Double,
)

private data class IcaChannelMetric(
    val name: String,
    val stdDev: Double,
    val meanAbsolute: Double,
)

private data class PairCorrelationMetric(
    val label: String,
    val correlation: Double,
)

private data class IcaPreview(
    val suggestedComponents: Int,
    val channelMetrics: List<IcaChannelMetric>,
    val topPairs: List<PairCorrelationMetric>,
)

private data class ConnectivityMetric(
    val label: String,
    val meanAbsolute: Double,
    val peakAbsolute: Double,
)

private data class VariantComparisonMetric(
    val id: DdaVariantId,
    val baselineMeanAbs: Double,
    val targetMeanAbs: Double,
    val delta: Double,
    val topChangedRow: String?,
)

private data class TutorialStep(
    val title: String,
    val description: String,
    val actionLabel: String,
    val action: () -> Unit,
)

private data class PluginStatusRow(
    val name: String,
    val status: String,
    val description: String,
)

private fun annotationRangeLabel(entry: DatasetAnnotationEntry): String {
    val end = entry.endTimeSeconds
    return if (end != null && end.isFinite()) {
        "${formatCompact(entry.startTimeSeconds)}s - ${formatCompact(end)}s"
    } else {
        "${formatCompact(entry.startTimeSeconds)}s"
    }
}

private fun annotationFocusDuration(entry: DatasetAnnotationEntry): Double {
    val end = entry.endTimeSeconds
    return when {
        end != null && end.isFinite() && end > entry.startTimeSeconds -> end - entry.startTimeSeconds
        else -> 5.0
    }.coerceAtLeast(1.0)
}

private fun buildIcaPreview(window: WaveformWindow): IcaPreview? {
    val channels = window.channels
        .filter { it.samples.size >= 8 }
        .take(8)
    if (channels.isEmpty()) return null

    val channelMetrics = channels.map { channel ->
        IcaChannelMetric(
            name = channel.name,
            stdDev = standardDeviation(channel.samples),
            meanAbsolute = meanAbsolute(channel.samples),
        )
    }.sortedByDescending(IcaChannelMetric::stdDev)

    val topPairs = buildList {
        for (leftIndex in 0 until channels.lastIndex) {
            for (rightIndex in leftIndex + 1 until channels.size) {
                val left = channels[leftIndex]
                val right = channels[rightIndex]
                val correlation = pearsonCorrelation(left.samples, right.samples)
                if (correlation.isFinite()) {
                    add(
                        PairCorrelationMetric(
                            label = "${left.name} <-> ${right.name}",
                            correlation = correlation,
                        ),
                    )
                }
            }
        }
    }.sortedByDescending { abs(it.correlation) }
        .take(8)

    return IcaPreview(
        suggestedComponents = minOf(channels.size, 6),
        channelMetrics = channelMetrics,
        topPairs = topPairs,
    )
}

private fun buildConnectivityMetrics(variant: DdaVariantSnapshot): List<ConnectivityMetric> {
    return variant.rowLabels.mapIndexedNotNull { index, label ->
        val row = variant.matrix.getOrNull(index).orEmpty()
        if (row.isEmpty()) {
            null
        } else {
            ConnectivityMetric(
                label = label,
                meanAbsolute = meanAbsolute(row),
                peakAbsolute = row.maxOf { abs(it.toDouble()) },
            )
        }
    }.sortedByDescending(ConnectivityMetric::meanAbsolute)
}

private fun buildVariantComparisons(
    baseline: DdaResultSnapshot,
    comparison: DdaResultSnapshot,
): List<VariantComparisonMetric> {
    val baselineById = baseline.variants.associateBy(DdaVariantSnapshot::id)
    val comparisonById = comparison.variants.associateBy(DdaVariantSnapshot::id)
    return DdaVariantId.entries.mapNotNull { variantId ->
        val baselineVariant = baselineById[variantId] ?: return@mapNotNull null
        val comparisonVariant = comparisonById[variantId] ?: return@mapNotNull null
        val baselineRows = baselineVariant.rowLabels.associateWithIndexedMeanAbs(baselineVariant.matrix)
        val comparisonRows = comparisonVariant.rowLabels.associateWithIndexedMeanAbs(comparisonVariant.matrix)
        val topChangedRow = baselineRows.keys
            .intersect(comparisonRows.keys)
            .maxByOrNull { rowLabel ->
                abs((comparisonRows[rowLabel] ?: 0.0) - (baselineRows[rowLabel] ?: 0.0))
            }

        val baselineMean = meanAbsoluteMatrix(baselineVariant.matrix)
        val comparisonMean = meanAbsoluteMatrix(comparisonVariant.matrix)
        VariantComparisonMetric(
            id = variantId,
            baselineMeanAbs = baselineMean,
            targetMeanAbs = comparisonMean,
            delta = comparisonMean - baselineMean,
            topChangedRow = topChangedRow,
        )
    }
}

private fun List<String>.associateWithIndexedMeanAbs(
    matrix: List<List<Float>>,
): Map<String, Double> {
    return mapIndexed { index, label ->
        label to meanAbsolute(matrix.getOrNull(index).orEmpty())
    }.toMap()
}

private fun meanAbsolute(values: DoubleArray): Double {
    if (values.isEmpty()) return 0.0
    var total = 0.0
    values.forEach { value ->
        total += abs(value)
    }
    return total / values.size
}

private fun meanAbsolute(values: List<Float>): Double {
    if (values.isEmpty()) return 0.0
    return values.sumOf { abs(it.toDouble()) } / values.size
}

private fun meanAbsoluteMatrix(matrix: List<List<Float>>): Double {
    val rows = matrix.flatten()
    return meanAbsolute(rows)
}

private fun standardDeviation(values: DoubleArray): Double {
    if (values.isEmpty()) return 0.0
    val mean = values.average()
    var sumSquares = 0.0
    values.forEach { value ->
        val delta = value - mean
        sumSquares += delta * delta
    }
    return sqrt(sumSquares / values.size)
}

private fun pearsonCorrelation(left: DoubleArray, right: DoubleArray): Double {
    val size = minOf(left.size, right.size)
    if (size < 2) return Double.NaN

    var leftMean = 0.0
    var rightMean = 0.0
    for (index in 0 until size) {
        leftMean += left[index]
        rightMean += right[index]
    }
    leftMean /= size
    rightMean /= size

    var numerator = 0.0
    var leftEnergy = 0.0
    var rightEnergy = 0.0
    for (index in 0 until size) {
        val leftCentered = left[index] - leftMean
        val rightCentered = right[index] - rightMean
        numerator += leftCentered * rightCentered
        leftEnergy += leftCentered * leftCentered
        rightEnergy += rightCentered * rightCentered
    }

    val denominator = sqrt(leftEnergy * rightEnergy)
    return if (denominator <= 0.0) Double.NaN else numerator / denominator
}

private data class Breadcrumb(val label: String, val path: String)

private fun buildBreadcrumbs(path: String): List<Breadcrumb> {
    val normalized = path.replace('\\', '/')
    if (normalized.isBlank()) return emptyList()

    val segments = normalized.trim('/').split('/').filter { it.isNotBlank() }
    val breadcrumbs = mutableListOf<Breadcrumb>()
    var current = if (normalized.startsWith("/")) "/" else ""
    if (normalized.startsWith("/")) {
        breadcrumbs += Breadcrumb("/", "/")
    }
    segments.forEach { segment ->
        current = when {
            current.isBlank() -> segment
            current == "/" -> "/$segment"
            else -> "$current/$segment"
        }
        breadcrumbs += Breadcrumb(segment, current)
    }
    return breadcrumbs
}
