pragma ComponentBehavior: Bound

import QtQuick

ListView {
    id: root

    required property var controller
    required property var colors
    signal resultRequested(int index)

    clip: true
    model: controller.historyModel
    spacing: 3

    delegate: Rectangle {
        id: entry

        required property int index
        required property string fileName
        required property string created
        required property string engine
        required property string variants

        width: root.width
        height: 62
        radius: 5
        color: historyMouse.containsMouse ? root.colors.panelAlt : "transparent"

        Column {
            anchors.fill: parent
            anchors.margins: 7
            spacing: 2

            Text {
                width: parent.width
                text: entry.fileName || "DDA result"
                color: root.colors.text
                font.pixelSize: 12
                font.weight: Font.Medium
                elide: Text.ElideMiddle
            }
            Text {
                width: parent.width
                text: entry.variants || entry.engine
                color: root.colors.muted
                font.pixelSize: 10
                elide: Text.ElideRight
            }
            Text {
                width: parent.width
                text: entry.created
                color: root.colors.muted
                font.pixelSize: 10
                elide: Text.ElideRight
            }
        }

        MouseArea {
            id: historyMouse
            anchors.fill: parent
            hoverEnabled: true
            onClicked: root.resultRequested(entry.index)
        }
    }

    Text {
        anchors.centerIn: parent
        visible: root.count === 0
        text: "No saved results"
        color: root.colors.muted
        font.pixelSize: 11
    }
}
