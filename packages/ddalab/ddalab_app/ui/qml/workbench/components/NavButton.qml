import QtQuick
import QtQuick.Controls.Basic

Button {
    id: control

    property var colors
    property bool selected: false

    implicitHeight: 34
    leftPadding: 11
    rightPadding: 11
    font.pixelSize: 13
    font.weight: selected ? Font.DemiBold : Font.Medium

    contentItem: Text {
        text: control.text
        color: control.selected ? control.colors.text : control.colors.muted
        font: control.font
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
    }

    background: Rectangle {
        radius: 6
        color: control.selected
            ? control.colors.selection
            : control.hovered
                ? control.colors.panelAlt
                : "transparent"
        border.width: control.activeFocus ? 2 : 0
        border.color: control.colors.accent
    }
}
