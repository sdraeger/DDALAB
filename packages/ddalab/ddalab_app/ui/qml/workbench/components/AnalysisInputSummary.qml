import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: root

    required property var controller
    required property var colors
    property bool showFlavors: true
    property string actionText: ""
    signal actionRequested()

    spacing: 10

    RowLayout {
        Layout.fillWidth: true
        spacing: 24

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 3
            Text { text: "Interval"; color: root.colors.muted; font.pixelSize: 11 }
            Text {
                text: root.controller.analysisStart.toFixed(2) + "–"
                    + root.controller.analysisEnd.toFixed(2) + " s"
                color: root.controller.analysisIntervalValid
                    ? root.colors.text
                    : root.colors.danger
                font.pixelSize: 13
            }
        }
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 3
            Text { text: "Channels"; color: root.colors.muted; font.pixelSize: 11 }
            Text {
                text: root.controller.selectedChannelCount.toString()
                color: root.colors.text
                font.pixelSize: 13
            }
        }
        ColumnLayout {
            visible: root.showFlavors
            Layout.fillWidth: true
            spacing: 3
            Text { text: "Flavors"; color: root.colors.muted; font.pixelSize: 11 }
            Text {
                Layout.fillWidth: true
                text: root.controller.selectedFlavorSummary || "None"
                color: root.colors.text
                font.pixelSize: 13
                elide: Text.ElideRight
            }
        }
        WorkbenchButton {
            colors: root.colors
            text: "Open waveform"
            enabled: root.controller.datasetLoaded
            onClicked: root.controller.showWorkspace()
        }
        WorkbenchButton {
            visible: root.actionText.length > 0
            colors: root.colors
            text: root.actionText
            primary: true
            enabled: root.controller.datasetLoaded
                && root.controller.analysisIntervalValid
                && !root.controller.busy
            onClicked: root.actionRequested()
        }
    }

    Text {
        Layout.fillWidth: true
        text: root.controller.selectedChannelSummary || "No channels selected"
        color: root.colors.muted
        font.pixelSize: 11
        elide: Text.ElideRight
    }
}
