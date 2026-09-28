import QtQuick
import DDALAB.Plots

Rectangle {
    id: root

    property var plotBridge: null
    property bool chromeVisible: true
    property real labelWidth: 64
    property real colorbarWidth: 56
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
                x: root.labelWidth
                width: parent.width - root.labelWidth - root.colorbarWidth
                height: Math.max(72, parent.height * 0.72)
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
                    model: root.plotBridge ? root.plotBridge.rowLabels : []

                    Text {
                        required property var modelData
                        required property int index
                        readonly property real rowHeight: heatmapArea.height
                            / Math.max(root.plotBridge.rowLabels.length, 1)

                        x: -width - 6
                        y: (index + 0.5) * rowHeight - height / 2
                        width: root.labelWidth - 8
                        visible: index % Math.max(1, Math.ceil(14 / rowHeight)) === 0
                        text: modelData
                        color: root.theme.mutedText
                        font.pixelSize: 10
                        horizontalAlignment: Text.AlignRight
                        elide: Text.ElideLeft
                    }
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
                    x: Math.max(0, Math.min(parent.width - width,
                        parent.width * root.cursorFraction + 6))
                    y: 4
                    text: root.plotBridge ? root.plotBridge.cursorText : ""
                    color: root.theme.text
                    font.pixelSize: 11
                    visible: root.cursorFraction >= 0 && text.length > 0
                }

                // colorbar: scheme and numeric limits of the color scale
                Column {
                    x: parent.width + 8
                    width: root.colorbarWidth - 8
                    height: parent.height
                    visible: !!root.plotBridge && root.plotBridge.hasImage
                    Text {
                        text: root.plotBridge ? Number(root.plotBridge.colorMax).toPrecision(3) : ""
                        color: root.theme.mutedText
                        font.pixelSize: 10
                    }
                    Column {
                        width: 12
                        height: parent.height - 28
                        Repeater {
                            model: root.plotBridge ? root.plotBridge.colorStops.slice().reverse() : []
                            Rectangle {
                                required property var modelData
                                width: 12
                                height: parent.height / Math.max(1, root.plotBridge.colorStops.length)
                                color: modelData
                            }
                        }
                    }
                    Text {
                        text: root.plotBridge ? Number(root.plotBridge.colorMin).toPrecision(3) : ""
                        color: root.theme.mutedText
                        font.pixelSize: 10
                    }
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
                    property real pressX: 0
                    onExited: if (root.plotBridge) root.plotBridge.clearCursor()
                    onClicked: function(mouse) {
                        if (mouse.button === Qt.LeftButton && root.plotBridge && Math.abs(mouse.x - pressX) < 4)
                            root.plotBridge.toggleLineRowAt(mouse.y / Math.max(height, 1))
                    }

                    onPressed: function(mouse) {
                        previousX = mouse.x
                        pressX = mouse.x
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
                x: heatmapArea.x
                width: heatmapArea.width
                height: Math.max(48, parent.height * 0.28 - 2 * parent.spacing - 14)
                radius: 10
                color: root.theme.surfaceAlt
                border.color: root.theme.border
                border.width: 1

                Flow {
                    anchors.top: parent.top
                    anchors.right: parent.right
                    anchors.margins: 4
                    width: parent.width * 0.6
                    spacing: 8
                    layoutDirection: Qt.RightToLeft
                    z: 1
                    Repeater {
                        model: root.plotBridge ? root.plotBridge.lineLegend : []
                        Row {
                            required property var modelData
                            spacing: 3
                            Rectangle { width: 10; height: 2; y: 5; color: modelData.color }
                            Text { text: modelData.label; color: root.theme.mutedText; font.pixelSize: 9 }
                        }
                    }
                }

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

            Item {
                x: heatmapArea.x
                width: heatmapArea.width
                height: 14

                Repeater {
                    model: root.plotBridge ? root.plotBridge.timeTicks : []

                    Text {
                        required property var modelData

                        x: Math.max(0, Math.min(parent.width - width,
                            modelData.position * parent.width - width / 2))
                        text: modelData.label + " s"
                        color: root.theme.mutedText
                        font.pixelSize: 10
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
