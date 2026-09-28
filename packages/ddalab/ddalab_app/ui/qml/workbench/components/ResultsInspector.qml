import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: root

    required property var controller
    required property var colors
    signal exportRequested()

    readonly property bool variantControlsVisible:
        controller.resultsMode === "history"
        || controller.resultsMode === "connectivity"

    Layout.margins: 12
    spacing: 10

    ColumnLayout {
        visible: root.controller.resultsMode === "compare"
        Layout.fillWidth: true
        spacing: 8

        SectionLabel { colors: root.colors; text: "Saved results" }
        Text {
            Layout.fillWidth: true
            text: root.controller.comparisonPrompt
            color: root.colors.muted
            font.pixelSize: 11
            wrapMode: Text.WordWrap
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
        activeFocusOnTab: true
        Keys.onReturnPressed: root.controller.selectVariant(currentIndex)
        Keys.onEnterPressed: root.controller.selectVariant(currentIndex)

        delegate: Rectangle {
            required property int index
            required property string id
            required property string label
            width: variants.width
            height: 38
            radius: 5
            color: index === root.controller.activeVariantIndex
                ? root.colors.selection
                : variantMouse.containsMouse || (variants.activeFocus && ListView.isCurrentItem)
                    ? root.colors.panelAlt : "transparent"
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

    SectionLabel {
        colors: root.colors
        text: "Quantity"
        visible: quantityChoices.visible
    }
    Flow {
        id: quantityChoices
        Layout.fillWidth: true
        spacing: 4
        visible: root.variantControlsVisible
            && !root.controller.cdrResultAvailable
            && root.controller.quantityOptions.length > 1
        Repeater {
            model: root.controller.quantityOptions
            WorkbenchButton {
                required property int index
                required property var modelData
                colors: root.colors
                text: modelData
                primary: index === root.controller.activeQuantityIndex
                onClicked: root.controller.selectQuantity(index)
            }
        }
    }

    SectionLabel {
        colors: root.colors
        text: "Colors"
        visible: colorChoices.visible
    }
    Flow {
        id: colorChoices
        Layout.fillWidth: true
        spacing: 4
        visible: root.controller.resultsMode === "history"
            && !root.controller.cdrResultAvailable
        Repeater {
            model: root.controller.colorSchemeOptions
            WorkbenchButton {
                required property var modelData
                colors: root.colors
                text: modelData.label
                primary: modelData.id === root.controller.colorScheme
                onClicked: root.controller.setColorScheme(modelData.id)
            }
        }
    }

    RowLayout {
        visible: root.controller.resultsMode === "history"
        Layout.fillWidth: true
        WorkbenchButton {
            Layout.fillWidth: true
            colors: root.colors
            text: "Export…"
            enabled: root.controller.resultAvailable
            onClicked: root.exportRequested()
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
            root.controller.pickComparison(index)
        }
    }
}
