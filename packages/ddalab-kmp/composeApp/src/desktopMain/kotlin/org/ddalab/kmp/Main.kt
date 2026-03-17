package org.ddalab.kmp

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.window.rememberWindowState
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged

fun main() = application {
    val bridge = remember { DesktopBridge() }
    val initialWindowState = remember { DesktopWindowStateStore.load() }
    var latestSavedWindowState by remember { mutableStateOf(initialWindowState) }
    val windowState = rememberWindowState(
        placement = initialWindowState.toWindowPlacement(),
        position = initialWindowState.toWindowPosition(),
        size = initialWindowState.toWindowSize(),
    )

    LaunchedEffect(windowState) {
        var lastSaved = initialWindowState
        snapshotFlow { captureWindowState(windowState, lastSaved) }
            .debounce(250)
            .distinctUntilChanged()
            .collect { snapshot ->
                lastSaved = snapshot
                latestSavedWindowState = snapshot
                DesktopWindowStateStore.save(snapshot)
            }
    }

    Window(
        onCloseRequest = {
            DesktopWindowStateStore.save(captureWindowState(windowState, latestSavedWindowState))
            exitApplication()
        },
        title = "DDALAB KMP",
        state = windowState,
    ) {
        DDALabApp(bridge = bridge)
    }
}
