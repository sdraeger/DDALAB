import QtQuick
import QtQuick.Layouts

Rectangle {
    id: root

    required property var colors
    required property string text
    property bool running: false
    property color backgroundColor: colors.surface

    visible: running
    color: backgroundColor
    z: 100

    ColumnLayout {
        anchors.centerIn: parent
        spacing: 8

        ActivitySpinner {
            Layout.alignment: Qt.AlignHCenter
            colors: root.colors
            running: root.running
        }
        Text {
            Layout.alignment: Qt.AlignHCenter
            text: root.text
            color: root.colors.muted
            font.pixelSize: 12
        }
    }
}
