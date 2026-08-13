import QtQuick
import QtQuick.Layouts
import "../components"

Rectangle {
    id: root

    required property var controller
    required property var colors
    signal cdrFolderRequested()
    signal customBatchRequested()

    color: colors.surface

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 10

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Text {
                text: root.controller.analysisMode === "ica"
                    ? "ICA"
                    : root.controller.analysisMode === "batch"
                        ? "Batch DDA"
                        : "DDA setup"
                color: root.colors.title
                font.pixelSize: 19
                font.weight: Font.DemiBold
            }
            Text {
                visible: root.controller.analysisMode !== "batch"
                text: root.controller.datasetLoaded
                    ? root.controller.datasetName
                    : "Open a recording first"
                color: root.colors.muted
                font.pixelSize: 12
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 4
            Repeater {
                model: [
                    { id: "dda", label: "DDA" },
                    { id: "ica", label: "ICA" },
                    { id: "batch", label: "Batch" }
                ]
                delegate: NavButton {
                    required property var modelData
                    colors: root.colors
                    text: modelData.label
                    selected: root.controller.analysisMode === modelData.id
                    onClicked: root.controller.setAnalysisMode(modelData.id)
                }
            }
            Item { Layout.fillWidth: true }
        }

        StackLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: root.controller.analysisMode === "ica" ? 1
                : root.controller.analysisMode === "batch" ? 2
                : 0

            Item {
                AnalysisInputSummary {
                    anchors.centerIn: parent
                    width: Math.min(parent.width, 520)
                    controller: root.controller
                    colors: root.colors
                }
                LoadingOverlay {
                    anchors.fill: parent
                    colors: root.colors
                    running: !!root.controller.loadingComponents.dda
                    text: "Loading DDA result…"
                }
            }

            ColumnLayout {
                spacing: 8
                AnalysisInputSummary {
                    Layout.fillWidth: true
                    controller: root.controller
                    colors: root.colors
                    showFlavors: false
                    actionText: root.controller.busy ? "Running…" : "Run ICA"
                    onActionRequested: root.controller.runIca()
                }
                Rectangle { Layout.fillWidth: true; height: 1; color: root.colors.border }
                Text {
                    Layout.fillWidth: true
                    text: root.controller.icaSummary
                    color: root.colors.muted
                    font.pixelSize: 12
                }
                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    ListView {
                        id: icaList
                        anchors.fill: parent
                        clip: true
                        model: root.controller.icaModel
                        delegate: Rectangle {
                            required property int index
                            required property int component
                            required property real variance
                            required property real kurtosis
                            required property real nonGaussianity
                            width: icaList.width
                            height: 42
                            color: index % 2 ? root.colors.surfaceAlt : "transparent"
                            RowLayout {
                                anchors.fill: parent
                                anchors.leftMargin: 8
                                anchors.rightMargin: 8
                                Text { Layout.preferredWidth: 100; text: "Component " + component; color: root.colors.text; font.pixelSize: 12 }
                                Text { Layout.fillWidth: true; text: "Variance " + (100 * variance).toFixed(2) + "%"; color: root.colors.muted; font.pixelSize: 11 }
                                Text { Layout.fillWidth: true; text: "Kurtosis " + kurtosis.toFixed(3); color: root.colors.muted; font.pixelSize: 11 }
                                Text { Layout.fillWidth: true; text: "Non-Gaussianity " + nonGaussianity.toFixed(3); color: root.colors.muted; font.pixelSize: 11 }
                            }
                        }
                    }
                    LoadingOverlay {
                        anchors.fill: parent
                        colors: root.colors
                        running: !!root.controller.loadingComponents.ica
                        text: "Loading ICA result…"
                    }
                }
            }

            ColumnLayout {
                spacing: 10

                RowLayout {
                    Layout.fillWidth: true
                    WorkbenchButton {
                        colors: root.colors
                        text: "Reproduce CDR"
                        primary: true
                        enabled: !root.controller.busy
                        onClicked: root.controller.runIncludedCdrReproduction()
                    }
                    WorkbenchButton {
                        colors: root.colors
                        text: "Open CDR data"
                        enabled: !root.controller.busy
                        onClicked: root.cdrFolderRequested()
                    }
                    Item { Layout.fillWidth: true }
                    WorkbenchButton {
                        colors: root.colors
                        text: "New batch"
                        quiet: true
                        enabled: !root.controller.busy
                        onClicked: root.customBatchRequested()
                    }
                }

                Rectangle { Layout.fillWidth: true; height: 1; color: root.colors.border }
                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    ListView {
                        id: batchList
                        anchors.fill: parent
                        clip: true
                        model: root.controller.batchModel
                        spacing: 3
                        delegate: Rectangle {
                            required property string file
                            required property string status
                            required property string details
                            width: batchList.width
                            height: 52
                            radius: 5
                            color: root.colors.surfaceAlt
                            border.width: 1
                            border.color: root.colors.border
                            RowLayout {
                                anchors.fill: parent
                                anchors.margins: 8
                                spacing: 8
                                ActivitySpinner {
                                    Layout.preferredWidth: 20
                                    Layout.preferredHeight: 20
                                    colors: root.colors
                                    running: status === "Running"
                                }
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 2
                                    Text { Layout.fillWidth: true; text: file + " · " + status; color: root.colors.text; font.pixelSize: 12; font.weight: Font.Medium; elide: Text.ElideMiddle }
                                    Text { Layout.fillWidth: true; text: details; color: root.colors.muted; font.pixelSize: 11; elide: Text.ElideRight }
                                }
                            }
                        }
                    }
                    LoadingOverlay {
                        anchors.fill: parent
                        colors: root.colors
                        running: !!root.controller.loadingComponents.batch
                            && batchList.count === 0
                        text: "Loading batch recordings…"
                    }
                }
            }
        }
    }
}
