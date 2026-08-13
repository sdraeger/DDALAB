import QtQuick
import DDALAB.Plots

Rectangle {
    id: root

    property var plotBridge: null
    property bool chromeVisible: true
    property real cursorFraction: plotBridge ? plotBridge.cursorFraction : -1
    property var theme: plotBridge ? plotBridge.theme : ({
        "surface": "#141b23",
        "surfaceAlt": "#121922",
        "canvas": "#101720",
        "text": "#dbe4ed",
        "mutedText": "#94a3b8",
        "border": "#3b4b5f",
        "cursor": "#dbe4ed",
        "annotationChannel": "#f6c453",
        "annotationGlobal": "#72d0ff"
    })

    color: root.theme.surface
    radius: root.chromeVisible ? 14 : 6

    border.color: root.theme.border
    border.width: root.chromeVisible ? 1 : 0

    Column {
        anchors.fill: parent
        anchors.margins: root.chromeVisible ? 18 : 0
        spacing: root.chromeVisible ? 10 : 0

        Text {
            text: root.plotBridge ? root.plotBridge.title : "DDALAB plot"
            color: root.theme.text
            font.pixelSize: 18
            font.bold: true
            elide: Text.ElideRight
            width: parent.width
            visible: root.chromeVisible
        }

        Column {
            width: parent.width
            height: root.chromeVisible ? Math.max(120, parent.height - 92) : parent.height
            spacing: 8

            Rectangle {
                id: heatmapArea
                width: {
                    if (!root.plotBridge
                            || root.plotBridge.rowCount < 1
                            || root.plotBridge.visibleColumnCount < 1) {
                        return parent.width
                    }
                    return Math.min(
                        parent.width,
                        height * root.plotBridge.visibleColumnCount
                            / root.plotBridge.rowCount
                    )
                }
                height: Math.max(72, parent.height * 0.72)
                anchors.horizontalCenter: parent.horizontalCenter
                radius: 10
                color: root.theme.canvas
                border.color: root.theme.border
                border.width: 1

                QuickHeatmapTextureItem {
                    anchors.fill: parent
                    anchors.margins: 1
                    bridge: root.plotBridge || null
                    visible: root.plotBridge !== null
                        && root.plotBridge !== undefined
                        && root.plotBridge.showHeatmapLayer
                        && root.plotBridge.hasImage
                }

                Repeater {
                    model: root.plotBridge
                        && root.plotBridge.showAnnotationsLayer
                        ? root.plotBridge.annotationItems
                        : []

                    Rectangle {
                        required property var modelData

                        x: parent.width * modelData.x
                        y: parent.height * modelData.y
                        width: Math.max(
                            modelData.width > 0
                                ? parent.width * modelData.width
                                : 1,
                            1
                        )
                        height: Math.max(parent.height * modelData.height, 1)
                        color: modelData.channelName
                            ? root.theme.annotationChannel
                            : root.theme.annotationGlobal
                        opacity: modelData.width > 0 ? 0.18 : 0.8
                        radius: modelData.width > 0 ? 3 : 0
                    }
                }

                Rectangle {
                    width: 1
                    height: parent.height
                    x: Math.max(0, Math.min(parent.width - width,
                        parent.width * root.cursorFraction - width / 2))
                    color: root.theme.cursor
                    opacity: 0.85
                    visible: root.plotBridge !== null
                        && root.plotBridge !== undefined
                        && root.plotBridge.showCursorLayer
                        && root.cursorFraction >= 0
                }

                Text {
                    anchors.centerIn: parent
                    text: root.plotBridge ? root.plotBridge.statusText : "No plot data loaded"
                    color: root.theme.mutedText
                    font.pixelSize: 14
                    visible: root.plotBridge === null
                        || root.plotBridge === undefined
                        || !root.plotBridge.hasImage
                }

                MouseArea {
                    anchors.fill: parent
                    acceptedButtons: Qt.LeftButton | Qt.RightButton
                    hoverEnabled: true
                    property real previousX: 0

                    onPressed: function(mouse) {
                        previousX = mouse.x
                        if (mouse.button === Qt.RightButton && root.plotBridge) {
                            root.plotBridge.requestAnnotationContext(
                                mouse.x / Math.max(width, 1),
                                mouse.y / Math.max(height, 1)
                            )
                        }
                    }
                    onPositionChanged: function(mouse) {
                        if (!root.plotBridge) {
                            return
                        }
                        root.plotBridge.requestCursor(
                            mouse.x / Math.max(width, 1)
                        )
                        if (mouse.buttons & Qt.LeftButton) {
                            root.plotBridge.requestPan(
                                (previousX - mouse.x) / Math.max(width, 1)
                            )
                            previousX = mouse.x
                        }
                    }
                    onWheel: function(wheel) {
                        if (!root.plotBridge) {
                            return
                        }
                        root.plotBridge.requestZoom(
                            wheel.angleDelta.y > 0 ? 0.8 : 1.25,
                            wheel.x / Math.max(width, 1)
                        )
                        wheel.accepted = true
                    }
                }
            }

            Rectangle {
                id: lineArea
                width: parent.width
                height: Math.max(48, parent.height * 0.28 - parent.spacing)
                radius: 10
                color: root.theme.surfaceAlt
                border.color: root.theme.border
                border.width: 1

                QuickLineTextureItem {
                    anchors.fill: parent
                    anchors.margins: 1
                    bridge: root.plotBridge || null
                    visible: root.plotBridge !== null
                        && root.plotBridge !== undefined
                        && root.plotBridge.showLineLayer
                        && root.plotBridge.hasLineImage
                }

                Rectangle {
                    width: 1
                    height: parent.height
                    x: Math.max(0, Math.min(parent.width - width,
                        parent.width * root.cursorFraction - width / 2))
                    color: root.theme.cursor
                    opacity: 0.85
                    visible: root.plotBridge !== null
                        && root.plotBridge !== undefined
                        && root.plotBridge.showCursorLayer
                        && root.cursorFraction >= 0
                }

                MouseArea {
                    anchors.fill: parent
                    acceptedButtons: Qt.LeftButton
                    hoverEnabled: true
                    property real previousX: 0

                    onPressed: function(mouse) {
                        previousX = mouse.x
                    }
                    onPositionChanged: function(mouse) {
                        if (!root.plotBridge) {
                            return
                        }
                        root.plotBridge.requestCursor(
                            mouse.x / Math.max(width, 1)
                        )
                        if (mouse.buttons & Qt.LeftButton) {
                            root.plotBridge.requestPan(
                                (previousX - mouse.x) / Math.max(width, 1)
                            )
                            previousX = mouse.x
                        }
                    }
                    onWheel: function(wheel) {
                        if (!root.plotBridge) {
                            return
                        }
                        root.plotBridge.requestZoom(
                            wheel.angleDelta.y > 0 ? 0.8 : 1.25,
                            wheel.x / Math.max(width, 1)
                        )
                        wheel.accepted = true
                    }
                }
            }
        }

        Text {
            text: root.plotBridge ? root.plotBridge.rendererName : "Qt Quick"
            color: root.theme.mutedText
            font.pixelSize: 12
            width: parent.width
            elide: Text.ElideRight
            visible: root.chromeVisible
        }
    }
}
