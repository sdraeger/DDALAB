import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Rectangle {
    id: root

    required property var controller
    required property var colors
    signal exportJsonRequested()
    signal exportCsvRequested()

    color: colors.panel

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            Layout.margins: 12
            spacing: 6

            SectionLabel {
                Layout.fillWidth: true
                colors: root.colors
                text: root.controller.currentPage === "analysis"
                    ? root.controller.analysisMode === "batch"
                        ? "Batch controls"
                        : root.controller.analysisMode === "ica"
                            ? "ICA controls"
                            : "DDA configuration"
                    : root.controller.currentPage === "results"
                        ? root.controller.resultsMode === "compare"
                            ? "Compare"
                            : root.controller.resultsMode === "connectivity"
                                ? "Connectivity"
                                : "Result controls"
                        : root.controller.currentPage === "settings"
                            ? "Services"
                            : "Recording"
            }
            WorkbenchButton {
                colors: root.colors
                text: "Hide"
                quiet: true
                onClicked: root.controller.toggleInspector()
            }
        }

        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: root.colors.border
        }

        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            contentWidth: availableWidth

            ColumnLayout {
                width: parent.width
                spacing: 0

                WorkspaceInspector {
                    Layout.fillWidth: true
                    visible: root.controller.currentPage === "workspace"
                    controller: root.controller
                    colors: root.colors
                }
                AnalysisInspector {
                    Layout.fillWidth: true
                    visible: root.controller.currentPage === "analysis"
                    controller: root.controller
                    colors: root.colors
                }
                ResultsInspector {
                    Layout.fillWidth: true
                    visible: root.controller.currentPage === "results"
                    controller: root.controller
                    colors: root.colors
                    onExportJsonRequested: root.exportJsonRequested()
                    onExportCsvRequested: root.exportCsvRequested()
                }
                SettingsInspector {
                    Layout.fillWidth: true
                    visible: root.controller.currentPage === "settings"
                    controller: root.controller
                    colors: root.colors
                }
            }
        }
    }
}
