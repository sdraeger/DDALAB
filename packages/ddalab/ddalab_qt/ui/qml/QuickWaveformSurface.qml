import QtQuick
import DDALAB.Plots

Rectangle {
    id: root

    property var waveformBridge: null

    color: "#101820"
    radius: 14
    border.color: "#2f4050"
    border.width: 1

    Column {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 8

        Text {
            text: root.waveformBridge ? root.waveformBridge.title : "DDALAB waveform"
            color: "#f8fafc"
            font.pixelSize: 16
            font.bold: true
            elide: Text.ElideRight
            width: parent.width
        }

        Rectangle {
            width: parent.width
            height: Math.max(80, parent.height - 62)
            radius: 10
            color: "#111c29"
            border.color: "#3b5268"
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

            Text {
                anchors.centerIn: parent
                text: root.waveformBridge ? root.waveformBridge.statusText : "No waveform loaded"
                color: "#cbd5e1"
                font.pixelSize: 13
                visible: root.waveformBridge === null
                    || root.waveformBridge === undefined
                    || root.waveformBridge.channelCount <= 0
            }
        }

        Text {
            text: root.waveformBridge ? root.waveformBridge.statusText : "No waveform loaded"
            color: "#94a3b8"
            font.pixelSize: 12
            width: parent.width
            elide: Text.ElideRight
        }
    }
}
