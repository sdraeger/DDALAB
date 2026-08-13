import QtQuick
import QtQuick.Layouts

Rectangle {
    id: root

    required property var controller
    required property var colors
    property string query: ""

    color: colors.panel
    border.width: 0

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            SectionLabel {
                colors: root.colors
                text: "Library"
                Layout.fillWidth: true
            }

            WorkbenchButton {
                colors: root.colors
                text: "Hide"
                quiet: true
                onClicked: root.controller.toggleLibrary()
            }
        }

        Text {
            Layout.fillWidth: true
            text: root.controller.browserPath
            color: root.colors.muted
            font.pixelSize: 11
            elide: Text.ElideMiddle
        }

        WorkbenchField {
            Layout.fillWidth: true
            colors: root.colors
            placeholderText: "Filter files"
            onTextChanged: root.query = text.trim().toLowerCase()
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 6

            WorkbenchButton {
                Layout.fillWidth: true
                colors: root.colors
                text: "Up"
                onClicked: root.controller.goUp()
            }
            WorkbenchButton {
                Layout.fillWidth: true
                colors: root.colors
                text: "Refresh"
                onClicked: root.controller.refreshDirectory("")
            }
        }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            ListView {
                id: files
                anchors.fill: parent
                clip: true
                spacing: 2
                model: root.controller.browserModel

                delegate: Rectangle {
                    required property int index
                    required property string name
                    required property string path
                    required property bool directory
                    required property bool supported
                    required property string type
                    required property string size
                    required property string search

                    readonly property bool matches: !root.query.length
                        || search.indexOf(root.query) >= 0

                    width: files.width
                    height: matches ? 44 : 0
                    visible: matches
                    radius: 5
                    color: rowMouse.containsMouse ? root.colors.panelAlt : "transparent"
                    opacity: supported ? 1.0 : 0.55

                    Column {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: 8
                        anchors.rightMargin: 8
                        spacing: 2

                        Text {
                            width: parent.width
                            text: name
                            color: root.colors.text
                            font.pixelSize: 12
                            font.weight: directory ? Font.DemiBold : Font.Normal
                            elide: Text.ElideMiddle
                        }
                        Text {
                            width: parent.width
                            text: directory ? "Folder" : type + " · " + size
                            color: root.colors.muted
                            font.pixelSize: 10
                            elide: Text.ElideRight
                        }
                    }

                    MouseArea {
                        id: rowMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        enabled: parent.supported
                        onDoubleClicked: root.controller.openBrowserIndex(parent.index)
                    }
                }

                Text {
                    anchors.centerIn: parent
                    visible: files.count === 0
                        && !root.controller.loadingComponents.library
                    text: "No files in this folder"
                    color: root.colors.muted
                    font.pixelSize: 12
                }
            }
            LoadingOverlay {
                anchors.fill: parent
                colors: root.colors
                backgroundColor: root.colors.panel
                running: !!root.controller.loadingComponents.library
                text: "Loading library…"
            }
        }
    }
}
