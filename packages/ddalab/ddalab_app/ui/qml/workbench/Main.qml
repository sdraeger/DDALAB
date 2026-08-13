import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import "components"
import "pages"

ApplicationWindow {
    id: root

    width: 1480
    height: 900
    minimumWidth: 980
    minimumHeight: 640
    visible: true
    title: "DDALAB"
    color: workbench.theme.window
    font.family: plex.name

    readonly property var colors: workbench.theme
    readonly property bool inspectorAvailable: !(workbench.currentPage === "analysis" && workbench.analysisMode !== "dda") && !(workbench.currentPage === "results" && !workbench.resultAvailable && workbench.historyModel.count === 0)
    readonly property bool showInspector: root.inspectorAvailable && !workbench.inspectorCollapsed
    readonly property bool showLibrary: workbench.currentPage !== "results" && !workbench.libraryCollapsed

    FontLoader {
        id: plex
        source: "../../../assets/fonts/ibm_plex_sans_regular.ttf"
    }

    FileDialog {
        id: openFileDialog
        title: "Open physiological recording"
        fileMode: FileDialog.OpenFile
        onAccepted: workbench.openDataset(selectedFile.toString())
    }

    FolderDialog {
        id: openFolderDialog
        title: "Open data folder"
        onAccepted: workbench.refreshDirectory(selectedFolder.toString())
    }

    FileDialog {
        id: exportJsonDialog
        title: "Export DDA result"
        fileMode: FileDialog.SaveFile
        nameFilters: ["JSON files (*.json)"]
        onAccepted: workbench.exportResultJson(selectedFile.toString())
    }

    FileDialog {
        id: batchFilesDialog
        title: "Choose recordings for a custom DDA batch"
        fileMode: FileDialog.OpenFiles
        onAccepted: workbench.runBatch(selectedFiles)
    }

    FolderDialog {
        id: cdrFolderDialog
        title: "Choose the CDR data folder"
        onAccepted: workbench.runCdrReproduction(selectedFolder.toString())
    }

    FileDialog {
        id: exportCsvDialog
        title: "Export selected DDA flavor"
        fileMode: FileDialog.SaveFile
        nameFilters: ["CSV files (*.csv)"]
        onAccepted: workbench.exportVariantCsv(selectedFile.toString())
    }

    Dialog {
        id: errorDialog
        modal: true
        anchors.centerIn: parent
        width: Math.min(460, root.width - 48)
        title: "DDALAB"
        standardButtons: Dialog.Ok
        property string message: ""
        background: Rectangle {
            color: root.colors.surface
            radius: 8
            border.color: root.colors.border
        }
        contentItem: Text {
            text: errorDialog.message
            color: root.colors.text
            font.pixelSize: 13
            wrapMode: Text.Wrap
        }
    }

    Dialog {
        id: annotationDialog
        modal: true
        anchors.centerIn: parent
        width: Math.min(460, root.width - 48)
        title: annotationId ? "Edit annotation" : "Add annotation"
        standardButtons: Dialog.Save | Dialog.Cancel
        property real annotationStart: 0
        property real annotationEnd: -1
        property string channelName: ""
        property string annotationId: ""
        property bool allChannels: false
        background: Rectangle {
            color: root.colors.surface
            radius: 8
            border.color: root.colors.border
        }
        contentItem: ColumnLayout {
            spacing: 8
            Text {
                text: (annotationDialog.allChannels ? "All channels" : annotationDialog.channelName) + " · " + annotationDialog.annotationStart.toFixed(3) + " s"
                color: root.colors.muted
                font.pixelSize: 12
            }
            RowLayout {
                Layout.fillWidth: true
                Toggle {
                    colors: root.colors
                    text: "All channels"
                    checked: annotationDialog.allChannels
                    onToggled: annotationDialog.allChannels = checked
                }
                Item {
                    Layout.fillWidth: true
                }
                WorkbenchButton {
                    colors: root.colors
                    text: "Delete"
                    quiet: true
                    visible: annotationDialog.annotationId.length > 0
                    onClicked: {
                        workbench.deleteAnnotationById(annotationDialog.annotationId);
                        annotationDialog.close();
                    }
                }
            }
            WorkbenchField {
                id: annotationLabel
                Layout.fillWidth: true
                colors: root.colors
                placeholderText: "Label"
            }
            WorkbenchField {
                id: annotationNotes
                Layout.fillWidth: true
                colors: root.colors
                placeholderText: "Notes"
            }
        }
        onAccepted: workbench.saveAnnotation(annotationLabel.text, annotationNotes.text, allChannels ? "" : channelName, annotationStart, annotationEnd, annotationId)
    }

    Connections {
        target: workbench
        function onErrorRaised(message) {
            errorDialog.message = message;
            errorDialog.open();
        }
        function onAnnotationEditRequested(seconds, channel, label, notes, endSeconds, annotationId, allChannels) {
            annotationDialog.annotationStart = seconds;
            annotationDialog.annotationEnd = endSeconds;
            annotationDialog.channelName = channel;
            annotationDialog.annotationId = annotationId;
            annotationDialog.allChannels = allChannels;
            annotationLabel.text = label;
            annotationNotes.text = notes;
            annotationDialog.open();
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 50
            color: root.colors.surface

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 8

                WorkbenchButton {
                    visible: workbench.currentPage !== "results"
                    colors: root.colors
                    text: workbench.libraryCollapsed ? "Library" : "Hide library"
                    quiet: true
                    onClicked: workbench.toggleLibrary()
                }

                Text {
                    text: "DDALAB"
                    color: root.colors.title
                    font.pixelSize: 15
                    font.weight: Font.DemiBold
                }

                RowLayout {
                    Layout.leftMargin: 18
                    spacing: 2
                    Repeater {
                        model: [
                            {
                                id: "workspace",
                                label: "Workspace"
                            },
                            {
                                id: "analysis",
                                label: "Analyze"
                            },
                            {
                                id: "results",
                                label: "Results"
                            },
                            {
                                id: "settings",
                                label: "Settings"
                            }
                        ]
                        delegate: NavButton {
                            required property var modelData
                            colors: root.colors
                            text: modelData.label
                            selected: workbench.currentPage === modelData.id
                            onClicked: workbench.setCurrentPage(modelData.id)
                        }
                    }
                }

                Item {
                    Layout.fillWidth: true
                }

                Text {
                    visible: workbench.busy
                    text: workbench.progressText || workbench.statusText
                    color: root.colors.muted
                    font.pixelSize: 11
                    elide: Text.ElideRight
                    Layout.maximumWidth: 260
                }

                WorkbenchButton {
                    colors: root.colors
                    text: "Open folder"
                    onClicked: openFolderDialog.open()
                }
                WorkbenchButton {
                    colors: root.colors
                    text: "Open file"
                    onClicked: openFileDialog.open()
                }
                WorkbenchButton {
                    visible: workbench.currentPage === "workspace"
                    colors: root.colors
                    text: "DDA setup"
                    primary: true
                    enabled: workbench.datasetLoaded && !workbench.busy
                    onClicked: workbench.showDdaSetup()
                }
            }

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 1
                color: root.colors.border
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            LibraryRail {
                Layout.preferredWidth: root.showLibrary ? 232 : 0
                Layout.fillHeight: true
                visible: Layout.preferredWidth > 0
                controller: workbench
                colors: root.colors
                clip: true
                Behavior on Layout.preferredWidth {
                    NumberAnimation {
                        duration: 170
                        easing.type: Easing.OutQuart
                    }
                }
            }

            Rectangle {
                visible: root.showLibrary
                Layout.preferredWidth: 1
                Layout.fillHeight: true
                color: root.colors.border
            }

            StackLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                currentIndex: workbench.currentPage === "analysis" ? 1 : workbench.currentPage === "results" ? 2 : workbench.currentPage === "settings" ? 3 : 0

                WorkspacePage {
                    controller: workbench
                    colors: root.colors
                }
                AnalysisPage {
                    controller: workbench
                    colors: root.colors
                    onCdrFolderRequested: cdrFolderDialog.open()
                    onCustomBatchRequested: batchFilesDialog.open()
                }
                ResultsPage {
                    controller: workbench
                    colors: root.colors
                }
                SettingsPage {
                    controller: workbench
                    colors: root.colors
                }
            }

            Rectangle {
                visible: root.showInspector
                Layout.preferredWidth: 1
                Layout.fillHeight: true
                color: root.colors.border
            }

            InspectorPanel {
                Layout.preferredWidth: root.showInspector ? 300 : 0
                Layout.fillHeight: true
                visible: Layout.preferredWidth > 0
                controller: workbench
                colors: root.colors
                clip: true
                onExportJsonRequested: exportJsonDialog.open()
                onExportCsvRequested: exportCsvDialog.open()
                Behavior on Layout.preferredWidth {
                    NumberAnimation {
                        duration: 170
                        easing.type: Easing.OutQuart
                    }
                }
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 26
            color: root.colors.surfaceAlt
            border.width: 0

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                Text {
                    Layout.fillWidth: true
                    text: workbench.statusText
                    color: root.colors.muted
                    font.pixelSize: 11
                    elide: Text.ElideRight
                }
                WorkbenchButton {
                    visible: root.inspectorAvailable
                    colors: root.colors
                    text: workbench.inspectorCollapsed ? "Show inspector" : "Hide inspector"
                    quiet: true
                    implicitHeight: 24
                    onClicked: workbench.toggleInspector()
                }
            }
        }
    }
}
