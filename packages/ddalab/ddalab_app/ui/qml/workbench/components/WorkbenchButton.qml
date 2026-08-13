import QtQuick
import QtQuick.Controls.Basic

Button {
    id: control

    property var colors
    property bool primary: false
    property bool quiet: false

    implicitHeight: 32
    leftPadding: 12
    rightPadding: 12
    font.pixelSize: 13
    font.weight: primary ? Font.DemiBold : Font.Medium

    contentItem: Text {
        text: control.text
        color: control.enabled
            ? (control.primary ? control.colors.accentText : control.colors.text)
            : control.colors.muted
        font: control.font
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }

    background: Rectangle {
        radius: 6
        color: {
            if (!control.enabled) {
                return control.colors.panelAlt
            }
            if (control.quiet && !control.hovered && !control.down) {
                return "transparent"
            }
            if (control.primary) {
                return control.down
                    ? control.colors.accentPressed
                    : control.hovered
                        ? control.colors.accentHover
                        : control.colors.accent
            }
            return control.hovered ? control.colors.panelAlt : control.colors.surfaceAlt
        }
        border.width: control.activeFocus ? 2 : (control.quiet ? 0 : 1)
        border.color: control.activeFocus
            ? control.colors.accent
            : control.colors.border
        opacity: control.enabled ? 1.0 : 0.7
    }
}
