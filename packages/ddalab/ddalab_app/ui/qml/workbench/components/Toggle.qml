import QtQuick
import QtQuick.Controls.Basic

CheckBox {
    id: control

    property var colors

    spacing: 8
    font.pixelSize: 13

    indicator: Rectangle {
        implicitWidth: 17
        implicitHeight: 17
        x: control.leftPadding
        y: (control.height - height) / 2
        radius: 4
        color: control.checked ? control.colors.accent : control.colors.input
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus
            ? control.colors.accent
            : control.checked
                ? control.colors.accent
                : control.colors.borderStrong

        Text {
            anchors.centerIn: parent
            text: "✓"
            visible: control.checked
            color: control.colors.accentText
            font.pixelSize: 12
            font.weight: Font.Bold
        }
    }

    contentItem: Text {
        leftPadding: control.indicator.width + control.spacing
        text: control.text
        color: control.colors.text
        font: control.font
        verticalAlignment: Text.AlignVCenter
    }
}
