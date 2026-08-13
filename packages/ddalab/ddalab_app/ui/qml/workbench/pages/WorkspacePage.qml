import QtQuick
import QtQuick.Layouts
import "../components"
import "../.." as DDALABViews

Rectangle {
    id: root

    required property var controller
    required property var colors

    color: colors.surface

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 10

        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2

                Text {
                    Layout.fillWidth: true
                    text: root.controller.datasetName
                    color: root.colors.title
                    font.pixelSize: 19
                    font.weight: Font.DemiBold
                    elide: Text.ElideMiddle
                }
                Text {
                    Layout.fillWidth: true
                    text: root.controller.datasetSummary
                    color: root.colors.muted
                    font.pixelSize: 12
                    elide: Text.ElideRight
                }
            }

            WorkbenchButton {
                colors: root.colors
                text: "10 s view"
                enabled: root.controller.datasetLoaded
                onClicked: root.controller.resetWaveformView()
            }
            WorkbenchButton {
                colors: root.colors
                text: "Entire recording"
                enabled: root.controller.datasetLoaded
                onClicked: root.controller.showEntireRecording()
            }
            WorkbenchButton {
                colors: root.colors
                text: root.controller.replayActive ? "Pause" : "Replay"
                primary: root.controller.replayActive
                enabled: root.controller.datasetLoaded && !root.controller.busy
                onClicked: root.controller.toggleReplay()
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 4
            NavButton {
                colors: root.colors
                text: "Waveform"
                selected: root.controller.workspaceMode === "inspect"
                onClicked: root.controller.setWorkspaceMode("inspect")
            }
            NavButton {
                colors: root.colors
                text: "Annotations"
                selected: root.controller.workspaceMode === "annotations"
                onClicked: root.controller.setWorkspaceMode("annotations")
            }
            NavButton {
                colors: root.colors
                text: "OpenNeuro"
                selected: root.controller.workspaceMode === "openneuro"
                onClicked: root.controller.setWorkspaceMode("openneuro")
            }
            Item { Layout.fillWidth: true }
        }

        StackLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: root.controller.workspaceMode === "annotations" ? 1
                : root.controller.workspaceMode === "openneuro" ? 2
                : 0

            Item {
                DDALABViews.QuickWaveformSurface {
                    anchors.fill: parent
                    waveformBridge: root.controller.waveformBridge
                    chromeVisible: false
                }
                LoadingOverlay {
                    anchors.fill: parent
                    colors: root.colors
                    running: !!root.controller.loadingComponents.recording
                        || !!root.controller.loadingComponents.waveform
                    text: root.controller.loadingComponents.recording
                        ? "Loading recording…"
                        : "Loading waveform…"
                }
            }

            ListView {
                id: annotationsList
                clip: true
                model: root.controller.annotationModel
                spacing: 3
                delegate: Rectangle {
                    required property int index
                    required property string label
                    required property string channel
                    required property real start
                    required property real end
                    required property string notes
                    width: annotationsList.width
                    height: 58
                    radius: 5
                    color: root.colors.surfaceAlt
                    border.width: 1
                    border.color: root.colors.border
                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: 8
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
                            Text { Layout.fillWidth: true; text: label; color: root.colors.text; font.pixelSize: 12; font.weight: Font.Medium; elide: Text.ElideRight }
                            Text { Layout.fillWidth: true; text: channel + " · " + start.toFixed(3) + (end > start ? "–" + end.toFixed(3) : "") + " s"; color: root.colors.muted; font.pixelSize: 10; elide: Text.ElideRight }
                            Text { Layout.fillWidth: true; visible: notes.length > 0; text: notes; color: root.colors.muted; font.pixelSize: 10; elide: Text.ElideRight }
                        }
                        WorkbenchButton {
                            colors: root.colors
                            text: "Delete"
                            onClicked: root.controller.deleteAnnotation(index)
                        }
                    }
                }
                Text { anchors.centerIn: parent; visible: annotationsList.count === 0; text: "Right-click the waveform to add an annotation"; color: root.colors.muted; font.pixelSize: 12 }
            }

            ColumnLayout {
                spacing: 8
                RowLayout {
                    Layout.fillWidth: true
                    Text {
                        Layout.fillWidth: true
                        text: "Public physiological datasets"
                        color: root.colors.title
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }
                    WorkbenchButton {
                        colors: root.colors
                        text: "Refresh"
                        onClicked: root.controller.refreshOpenNeuro()
                    }
                }
                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    ListView {
                        id: openneuroList
                        anchors.fill: parent
                        clip: true
                        spacing: 3
                        model: root.controller.openneuroModel
                        delegate: Rectangle {
                            required property string id
                            required property string name
                            required property string modalities
                            required property int subjects
                            required property string size
                            width: openneuroList.width
                            height: 56
                            radius: 5
                            color: root.colors.surfaceAlt
                            border.width: 1
                            border.color: root.colors.border
                            Column {
                                anchors.fill: parent
                                anchors.margins: 8
                                spacing: 3
                                Text {
                                    width: parent.width
                                    text: id + "  " + name
                                    color: root.colors.text
                                    font.pixelSize: 12
                                    font.weight: Font.Medium
                                    elide: Text.ElideRight
                                }
                                Text {
                                    width: parent.width
                                    text: modalities + " · " + subjects + " subjects · " + size
                                    color: root.colors.muted
                                    font.pixelSize: 11
                                    elide: Text.ElideRight
                                }
                            }
                        }
                        Text {
                            anchors.centerIn: parent
                            visible: openneuroList.count === 0
                                && !root.controller.loadingComponents.openneuro
                            text: "Refresh to browse OpenNeuro"
                            color: root.colors.muted
                            font.pixelSize: 12
                        }
                    }
                    LoadingOverlay {
                        anchors.fill: parent
                        colors: root.colors
                        running: !!root.controller.loadingComponents.openneuro
                        text: "Loading OpenNeuro datasets…"
                    }
                }
            }
        }
    }
}
