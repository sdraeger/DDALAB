package org.ddalab.kmp

import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.WindowPlacement
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.WindowState
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.nio.file.Path
import java.nio.file.Paths
import kotlin.io.path.createDirectories
import kotlin.io.path.notExists
import kotlin.io.path.readText
import kotlin.io.path.writeText

private const val DefaultWindowWidthDp = 1480f
private const val DefaultWindowHeightDp = 940f
private const val MinWindowWidthDp = 960f
private const val MinWindowHeightDp = 640f

private val windowStateJson = Json {
    prettyPrint = true
    ignoreUnknownKeys = true
}

@Serializable
internal enum class SavedWindowPlacement {
    Floating,
    Maximized,
    Fullscreen,
}

@Serializable
internal data class SavedWindowBounds(
    val widthDp: Float = DefaultWindowWidthDp,
    val heightDp: Float = DefaultWindowHeightDp,
    val xDp: Float? = null,
    val yDp: Float? = null,
)

@Serializable
internal data class SavedDesktopWindowState(
    val placement: SavedWindowPlacement = SavedWindowPlacement.Floating,
    val floatingBounds: SavedWindowBounds = SavedWindowBounds(),
)

internal object DesktopWindowStateStore {
    private val persistenceDir: Path = Paths.get(System.getProperty("user.home"), ".ddalab-kmp")
    private val windowStateFile: Path = persistenceDir.resolve("window-state.json")

    fun load(): SavedDesktopWindowState {
        return runCatching {
            if (windowStateFile.notExists()) {
                defaultWindowState()
            } else {
                sanitize(
                    windowStateJson.decodeFromString(
                        SavedDesktopWindowState.serializer(),
                        windowStateFile.readText(),
                    ),
                )
            }
        }.getOrElse {
            defaultWindowState()
        }
    }

    fun save(state: SavedDesktopWindowState) {
        runCatching {
            persistenceDir.createDirectories()
            windowStateFile.writeText(
                windowStateJson.encodeToString(
                    SavedDesktopWindowState.serializer(),
                    sanitize(state),
                ),
            )
        }
    }

    private fun defaultWindowState(): SavedDesktopWindowState = SavedDesktopWindowState(
        placement = SavedWindowPlacement.Floating,
        floatingBounds = SavedWindowBounds(),
    )

    private fun sanitize(state: SavedDesktopWindowState): SavedDesktopWindowState {
        val bounds = state.floatingBounds
        return state.copy(
            floatingBounds = bounds.copy(
                widthDp = bounds.widthDp.coerceAtLeast(MinWindowWidthDp),
                heightDp = bounds.heightDp.coerceAtLeast(MinWindowHeightDp),
            ),
        )
    }
}

internal fun SavedDesktopWindowState.toWindowPlacement(): WindowPlacement = when (placement) {
    SavedWindowPlacement.Floating -> WindowPlacement.Floating
    SavedWindowPlacement.Maximized -> WindowPlacement.Maximized
    SavedWindowPlacement.Fullscreen -> WindowPlacement.Fullscreen
}

internal fun SavedDesktopWindowState.toWindowPosition(): WindowPosition {
    val bounds = floatingBounds
    return if (bounds.xDp != null && bounds.yDp != null) {
        WindowPosition(bounds.xDp.dp, bounds.yDp.dp)
    } else {
        WindowPosition(Alignment.Center)
    }
}

internal fun SavedDesktopWindowState.toWindowSize(): DpSize =
    DpSize(floatingBounds.widthDp.dp, floatingBounds.heightDp.dp)

internal fun captureWindowState(
    windowState: WindowState,
    fallback: SavedDesktopWindowState,
): SavedDesktopWindowState {
    val savedPlacement = when (windowState.placement) {
        WindowPlacement.Floating -> SavedWindowPlacement.Floating
        WindowPlacement.Maximized -> SavedWindowPlacement.Maximized
        WindowPlacement.Fullscreen -> SavedWindowPlacement.Fullscreen
    }
    val floatingBounds = when (windowState.placement) {
        WindowPlacement.Floating -> {
            val absolute = windowState.position as? WindowPosition.Absolute
            SavedWindowBounds(
                widthDp = windowState.size.width.value.coerceAtLeast(MinWindowWidthDp),
                heightDp = windowState.size.height.value.coerceAtLeast(MinWindowHeightDp),
                xDp = absolute?.x?.value,
                yDp = absolute?.y?.value,
            )
        }

        else -> fallback.floatingBounds
    }
    return SavedDesktopWindowState(
        placement = savedPlacement,
        floatingBounds = floatingBounds,
    )
}
