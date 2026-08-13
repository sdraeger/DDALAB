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

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 2

            Text {
                text: "Results"
                color: root.colors.title
                font.pixelSize: 19
                font.weight: Font.DemiBold
            }
            Text {
                Layout.fillWidth: true
                text: root.controller.resultSummary
                color: root.colors.muted
                font.pixelSize: 12
                elide: Text.ElideRight
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 4
            Repeater {
                model: [
                    {
                        id: "history",
                        label: "DDA"
                    },
                    {
                        id: "connectivity",
                        label: "Connectivity"
                    },
                    {
                        id: "compare",
                        label: "Compare"
                    }
                ]
                delegate: NavButton {
                    required property var modelData
                    colors: root.colors
                    text: modelData.label
                    selected: root.controller.resultsMode === modelData.id
                    onClicked: root.controller.setResultsMode(modelData.id)
                }
            }
            Item {
                Layout.fillWidth: true
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 10

            Rectangle {
                objectName: "resultsHistorySidebar"
                Layout.preferredWidth: 220
                Layout.fillHeight: true
                color: root.colors.surfaceAlt
                radius: 7
                border.color: root.colors.border

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 8
                    spacing: 7

                    SectionLabel {
                        colors: root.colors
                        text: "History"
                    }
                    ResultHistoryList {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        controller: root.controller
                        colors: root.colors
                        onResultRequested: function (index) {
                            if (root.controller.resultsMode !== "compare")
                                root.controller.openHistoryResult(index);
                        }
                    }
                }
            }

            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true

                StackLayout {
                    anchors.fill: parent
                    currentIndex: root.controller.resultsMode === "connectivity" ? 1 : root.controller.resultsMode === "compare" ? 2 : 0

                    StackLayout {
                        currentIndex: !root.controller.resultAvailable ? 0 : root.controller.cdrResultAvailable ? 2 : 1

                        Item {
                            ColumnLayout {
                                anchors.centerIn: parent
                                spacing: 10
                                Text {
                                    Layout.alignment: Qt.AlignHCenter
                                    text: "No DDA result"
                                    color: root.colors.muted
                                    font.pixelSize: 12
                                }
                                WorkbenchButton {
                                    Layout.alignment: Qt.AlignHCenter
                                    colors: root.colors
                                    text: "DDA setup"
                                    enabled: root.controller.datasetLoaded
                                    onClicked: root.controller.showDdaSetup()
                                }
                            }
                        }

                        DDALABViews.QuickPlotSurface {
                            plotBridge: root.controller.resultBridge
                            chromeVisible: false
                        }

                        CdrResultsView {
                            controller: root.controller
                            colors: root.colors
                        }
                    }

                    ListView {
                        id: connectivityList
                        clip: true
                        model: root.controller.connectivityModel
                        delegate: Rectangle {
                            required property int index
                            required property string label
                            required property real mean
                            required property real peak
                            width: connectivityList.width
                            height: 40
                            color: index % 2 ? root.colors.surfaceAlt : "transparent"
                            RowLayout {
                                anchors.fill: parent
                                anchors.leftMargin: 8
                                anchors.rightMargin: 8
                                Text {
                                    Layout.fillWidth: true
                                    text: label
                                    color: root.colors.text
                                    font.pixelSize: 12
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.preferredWidth: 130
                                    text: "Mean |a| " + mean.toFixed(4)
                                    color: root.colors.muted
                                    font.pixelSize: 11
                                }
                                Text {
                                    Layout.preferredWidth: 130
                                    text: "Peak |a| " + peak.toFixed(4)
                                    color: root.colors.muted
                                    font.pixelSize: 11
                                }
                            }
                        }
                        Text {
                            anchors.centerIn: parent
                            visible: connectivityList.count === 0
                            text: "No connectivity result"
                            color: root.colors.muted
                            font.pixelSize: 12
                        }
                    }

                    ListView {
                        id: compareList
                        clip: true
                        model: root.controller.compareModel
                        delegate: Rectangle {
                            required property int index
                            required property string flavor
                            required property real baselineValue
                            required property real targetValue
                            required property real delta
                            width: compareList.width
                            height: 42
                            color: index % 2 ? root.colors.surfaceAlt : "transparent"
                            RowLayout {
                                anchors.fill: parent
                                anchors.leftMargin: 8
                                anchors.rightMargin: 8
                                Text {
                                    Layout.preferredWidth: 80
                                    text: flavor
                                    color: root.colors.text
                                    font.pixelSize: 12
                                    font.weight: Font.Medium
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "Baseline " + baselineValue.toFixed(5)
                                    color: root.colors.muted
                                    font.pixelSize: 11
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "Target " + targetValue.toFixed(5)
                                    color: root.colors.muted
                                    font.pixelSize: 11
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "Δ " + delta.toFixed(5)
                                    color: delta >= 0 ? root.colors.accent : root.colors.danger
                                    font.pixelSize: 11
                                }
                            }
                        }
                        Text {
                            anchors.centerIn: parent
                            visible: compareList.count === 0
                            text: "Choose two saved results"
                            color: root.colors.muted
                            font.pixelSize: 12
                        }
                    }
                }
                LoadingOverlay {
                    anchors.fill: parent
                    colors: root.colors
                    running: !!root.controller.loadingComponents.result || !!root.controller.loadingComponents.comparison
                    text: root.controller.loadingComponents.comparison ? "Loading comparison…" : "Loading DDA result…"
                }
            }
        }
    }
}
