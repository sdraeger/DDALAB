import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: root

    required property var controller
    required property var colors
    property string channelQuery: ""

    Layout.margins: 12
    spacing: 12

    ColumnLayout {
        visible: root.controller.workspaceMode === "inspect"
        Layout.fillWidth: true
        spacing: 8

        Text {
            Layout.fillWidth: true
            text: root.controller.datasetSummary
            color: root.colors.muted
            font.pixelSize: 12
            wrapMode: Text.Wrap
        }
        WorkbenchField {
            Layout.fillWidth: true
            colors: root.colors
            placeholderText: "Filter channels"
            onTextChanged: root.channelQuery = text.trim().toLowerCase()
        }
        RowLayout {
            Layout.fillWidth: true
            WorkbenchButton {
                Layout.fillWidth: true
                colors: root.colors
                text: "All"
                onClicked: root.controller.channelModel.selectAll(true)
            }
            WorkbenchButton {
                Layout.fillWidth: true
                colors: root.colors
                text: "None"
                onClicked: root.controller.channelModel.selectAll(false)
            }
        }
        ListView {
            id: channelList
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(contentHeight, 360)
            clip: true
            model: root.controller.channelModel

            delegate: Toggle {
                required property int index
                required property string name
                required property bool selected
                readonly property bool matches: !root.channelQuery.length
                    || name.toLowerCase().indexOf(root.channelQuery) >= 0

                width: channelList.width
                height: matches ? 30 : 0
                visible: matches
                colors: root.colors
                text: name
                checked: selected
                onToggled: root.controller.channelModel.setSelected(index, checked)
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Text {
                Layout.fillWidth: true
                text: root.controller.datasetLoaded
                    ? root.controller.waveformStart.toFixed(2) + "–"
                        + (root.controller.waveformStart + root.controller.waveformDuration).toFixed(2)
                        + " s visible"
                    : ""
                color: root.colors.muted
                font.pixelSize: 11
            }
            WorkbenchButton {
                colors: root.colors
                text: "Set DDA interval"
                enabled: root.controller.datasetLoaded
                onClicked: root.controller.useVisibleWaveformRange()
            }
        }
    }

    ColumnLayout {
        visible: root.controller.workspaceMode === "annotations"
        Layout.fillWidth: true
        spacing: 8
        Text {
            Layout.fillWidth: true
            text: "Right-click the waveform to add an annotation."
            color: root.colors.muted
            font.pixelSize: 12
            wrapMode: Text.Wrap
        }
        WorkbenchButton {
            Layout.fillWidth: true
            colors: root.colors
            text: "Return to waveform"
            onClicked: root.controller.setWorkspaceMode("inspect")
        }
    }

    ColumnLayout {
        visible: root.controller.workspaceMode === "openneuro"
        Layout.fillWidth: true
        spacing: 8
        WorkbenchButton {
            Layout.fillWidth: true
            colors: root.colors
            text: "Refresh OpenNeuro"
            primary: true
            enabled: !root.controller.busy
            onClicked: root.controller.refreshOpenNeuro()
        }
    }
}
