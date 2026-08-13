import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: root

    required property var controller
    required property var colors
    signal exportJsonRequested()
    signal exportCsvRequested()

    readonly property bool variantControlsVisible:
        controller.resultsMode === "history"
        || controller.resultsMode === "connectivity"

    function chooseComparison(index) {
        const position = (index + 1).toString()
        if (!compareLeft.text.length || compareRight.text.length) {
            compareLeft.text = position
            compareRight.text = ""
        } else {
            compareRight.text = position
        }
    }

    Layout.margins: 12
    spacing: 10

    ColumnLayout {
        visible: root.controller.resultsMode === "compare"
        Layout.fillWidth: true
        spacing: 8

        SectionLabel { colors: root.colors; text: "Saved results" }
        RowLayout {
            Layout.fillWidth: true
            WorkbenchField {
                id: compareLeft
                Layout.fillWidth: true
                colors: root.colors
                placeholderText: "Baseline #"
                inputMethodHints: Qt.ImhDigitsOnly
            }
            WorkbenchField {
                id: compareRight
                Layout.fillWidth: true
                colors: root.colors
                placeholderText: "Target #"
                inputMethodHints: Qt.ImhDigitsOnly
            }
        }
        WorkbenchButton {
            Layout.fillWidth: true
            colors: root.colors
            text: "Compare"
            primary: true
            enabled: compareLeft.text.length > 0
                && compareRight.text.length > 0
                && compareLeft.text !== compareRight.text
            onClicked: root.controller.compareHistoryResults(
                Math.max(0, Number(compareLeft.text) - 1),
                Math.max(0, Number(compareRight.text) - 1)
            )
        }
        Rectangle { Layout.fillWidth: true; height: 1; color: root.colors.border }
    }

    SectionLabel {
        colors: root.colors
        text: "Flavor"
        visible: root.variantControlsVisible
            && !root.controller.cdrResultAvailable
    }
    ListView {
        id: variants
        Layout.fillWidth: true
        Layout.preferredHeight: Math.min(contentHeight, 180)
        model: root.controller.variantModel
        visible: root.variantControlsVisible
            && !root.controller.cdrResultAvailable
        spacing: 3

        delegate: Rectangle {
            required property int index
            required property string id
            required property string label
            width: variants.width
            height: 38
            radius: 5
            color: index === root.controller.activeVariantIndex
                ? root.colors.selection
                : variantMouse.containsMouse ? root.colors.panelAlt : "transparent"
            Text {
                anchors.fill: parent
                anchors.margins: 8
                text: id + "  " + label
                color: root.colors.text
                font.pixelSize: 12
                verticalAlignment: Text.AlignVCenter
                elide: Text.ElideRight
            }
            MouseArea {
                id: variantMouse
                anchors.fill: parent
                hoverEnabled: true
                onClicked: root.controller.selectVariant(parent.index)
            }
        }
    }

    RowLayout {
        visible: root.controller.resultsMode === "history"
        Layout.fillWidth: true
        WorkbenchButton {
            Layout.fillWidth: true
            colors: root.colors
            text: "Export JSON"
            enabled: root.controller.resultAvailable
            onClicked: root.exportJsonRequested()
        }
        WorkbenchButton {
            Layout.fillWidth: true
            colors: root.colors
            text: "Export CSV"
            enabled: root.controller.resultAvailable
            onClicked: root.exportCsvRequested()
        }
    }

    Rectangle {
        visible: root.controller.resultsMode === "history"
        Layout.fillWidth: true
        height: 1
        color: root.colors.border
    }
    SectionLabel {
        visible: root.controller.resultsMode === "compare"
        colors: root.colors
        text: "Saved results"
    }
    ResultHistoryList {
        visible: root.controller.resultsMode === "compare"
        Layout.fillWidth: true
        Layout.preferredHeight: Math.min(contentHeight, 320)
        controller: root.controller
        colors: root.colors
        onResultRequested: function(index) {
            root.chooseComparison(index)
        }
    }
}
