import QtQuick
import DDALAB.Plots

Rectangle {
    id: root

    property var waveformBridge: null
    property var theme: waveformBridge ? waveformBridge.theme : ({
        "surface": "#141b23",
        "surfaceAlt": "#121922",
        "canvas": "#101720",
        "text": "#dbe4ed",
        "mutedText": "#94a3b8",
        "border": "#3b4b5f",
        "annotationChannel": "#f6c453",
        "annotationGlobal": "#72d0ff"
    })

    color: root.theme.surface
    radius: 14
    border.color: root.theme.border
    border.width: 1

    Column {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 8

        Text {
            text: root.waveformBridge ? root.waveformBridge.title : "DDALAB waveform"
            color: root.theme.text
            font.pixelSize: 16
            font.bold: true
            elide: Text.ElideRight
            width: parent.width
        }

        Rectangle {
            width: parent.width
            height: Math.max(80, parent.height - 62)
            radius: 10
            color: root.theme.canvas
            border.color: root.theme.border
            border.width: 1

            QuickWaveformGeometryItem {
                anchors.fill: parent
                anchors.margins: 1
                bridge: root.waveformBridge || null
                visible: root.waveformBridge !== null
                    && root.waveformBridge !== undefined
                    && root.waveformBridge.channelCount > 0
                    && root.waveformBridge.showWaveformLayer
            }

            Repeater {
                model: root.waveformBridge
                    && root.waveformBridge.showAnnotationsLayer
                    ? root.waveformBridge.annotationItems
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
                    radius: modelData.width > 0 ? 4 : 0
                    visible: root.waveformBridge !== null
                        && root.waveformBridge !== undefined
                        && root.waveformBridge.showAnnotationsLayer
                }
            }

            Text {
                anchors.centerIn: parent
                text: root.waveformBridge ? root.waveformBridge.statusText : "No waveform loaded"
                color: root.theme.mutedText
                font.pixelSize: 13
                visible: root.waveformBridge === null
                    || root.waveformBridge === undefined
                    || root.waveformBridge.channelCount <= 0
            }
        }

        Text {
            text: root.waveformBridge ? root.waveformBridge.statusText : "No waveform loaded"
            color: root.theme.mutedText
            font.pixelSize: 12
            width: parent.width
            elide: Text.ElideRight
        }
    }
}
