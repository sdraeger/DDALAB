pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Flickable {
    id: root
    objectName: "cdrResultsView"

    required property var controller
    required property var colors

    clip: true
    contentWidth: width
    contentHeight: content.implicitHeight
    boundsBehavior: Flickable.StopAtBounds

    ScrollBar.vertical: ScrollBar {}

    ColumnLayout {
        id: content
        width: root.width
        spacing: 10

        Text {
            Layout.fillWidth: true
            text: "C matrices"
            color: root.colors.title
            font.pixelSize: 13
            font.weight: Font.DemiBold
        }

        GridLayout {
            id: heatmapGrid
            Layout.fillWidth: true
            columns: width >= 900 ? 6 : 3
            columnSpacing: 8
            rowSpacing: 8

            Repeater {
                model: root.controller.cdrView.heatmaps || []

                CdrHeatmap {
                    required property var modelData
                    Layout.fillWidth: true
                    Layout.preferredHeight: 150
                    colors: root.colors
                    label: modelData.label
                    matrix: modelData.matrix
                }
            }
        }

        GridLayout {
            Layout.fillWidth: true
            columns: width >= 820 ? 2 : 1
            columnSpacing: 10
            rowSpacing: 10

            CdrLineChart {
                Layout.fillWidth: true
                Layout.preferredHeight: 310
                colors: root.colors
                title: "C vs SNR"
                curves: root.controller.cdrView.causalityCurves || []
                xLabels: root.controller.cdrView.conditions || []
                logY: true
                showMarkers: true
                xLabel: "SNR"
                yLabel: "C"
            }

            CdrLineChart {
                Layout.fillWidth: true
                Layout.preferredHeight: 310
                colors: root.colors
                title: "E vs C"
                curves: root.controller.cdrView.phaseCurves || []
                mode: "xy"
                logX: true
                logY: true
                showMarkers: true
                xLabel: "C"
                yLabel: "E"
            }
        }
    }
}
