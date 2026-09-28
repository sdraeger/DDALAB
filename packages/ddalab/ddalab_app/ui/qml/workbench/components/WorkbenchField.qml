import QtQuick
import QtQuick.Controls.Basic

TextField {
    id: control

    property var colors
    // Model value, shown whenever the field isn't being edited, so a model
    // update can't overwrite text the user hasn't committed yet.
    property string value

    Binding on text {
        value: control.value
        when: !control.activeFocus
        restoreMode: Binding.RestoreNone
    }

    implicitHeight: 32
    leftPadding: 10
    rightPadding: 10
    color: colors.text
    placeholderTextColor: colors.muted
    selectionColor: colors.selection
    selectedTextColor: colors.selectionText
    font.pixelSize: 13

    background: Rectangle {
        color: colors.input
        radius: 6
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? colors.accent : colors.border
    }
}
