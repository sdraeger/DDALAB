import QtQuick

Item {
    id: root

    required property var colors
    property bool running: false

    visible: running
    implicitWidth: 18
    implicitHeight: 18

    Rectangle {
        anchors.fill: parent
        anchors.margins: 2
        radius: width / 2
        color: "transparent"
        border.width: 2
        border.color: root.colors.borderStrong
    }

    Rectangle {
        width: 5
        height: 5
        radius: 3
        color: root.colors.accent
        anchors.top: parent.top
        anchors.horizontalCenter: parent.horizontalCenter
    }

    RotationAnimator {
        target: root
        from: 0
        to: 360
        duration: 700
        loops: Animation.Infinite
        running: root.running
    }
}
