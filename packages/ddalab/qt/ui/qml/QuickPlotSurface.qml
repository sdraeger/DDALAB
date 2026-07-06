import QtQuick
import DDALAB.Plots

Rectangle {
    id: root

    property var plotBridge: null
    property real cursorFraction: plotBridge ? plotBridge.cursorFraction : -1
    property var theme: plotBridge ? plotBridge.theme : ({
        "surface": "#141b23",
        "surfaceAlt": "#121922",
        "canvas": "#101720",
        "text": "#dbe4ed",
        "mutedText": "#94a3b8",
        "border": "#3b4b5f",
        "cursor": "#dbe4ed"
    })

    color: root.theme.surface
    radius: 14

    border.color: root.theme.border
    border.width: 1

    Column {
        anchors.fill: parent
        anchors.margins: 18
        spacing: 10

        Text {
            text: root.plotBridge ? root.plotBridge.title : "DDALAB plot"
            color: root.theme.text
            font.pixelSize: 18
            font.bold: true
            elide: Text.ElideRight
            width: parent.width
        }

        Column {
            width: parent.width
            height: Math.max(120, parent.height - 92)
            spacing: 8

            Rectangle {
                width: parent.width
                height: Math.max(72, parent.height * 0.62)
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
            }

            Rectangle {
                width: parent.width
                height: Math.max(48, parent.height * 0.38 - parent.spacing)
                radius: 10
                color: root.theme.surfaceAlt
                border.color: root.theme.border
                border.width: 1

                QuickLineGeometryItem {
                    anchors.fill: parent
                    anchors.margins: 1
                    bridge: root.plotBridge || null
                    visible: root.plotBridge !== null
                        && root.plotBridge !== undefined
                        && root.plotBridge.showLineLayer
                        && root.plotBridge.rowCount > 0
                        && root.plotBridge.visibleColumnCount > 0
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
            }
        }

        Text {
            text: root.plotBridge ? root.plotBridge.rendererName : "Qt Quick"
            color: root.theme.mutedText
            font.pixelSize: 12
            width: parent.width
            elide: Text.ElideRight
        }
    }
}
