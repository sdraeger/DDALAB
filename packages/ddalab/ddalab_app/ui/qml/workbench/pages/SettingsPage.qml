import QtQuick
import QtQuick.Layouts
import "../components"

Rectangle {
    id: root

    required property var controller
    required property var colors

    color: colors.surface

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 20

        Text {
            text: "Settings"
            color: root.colors.title
            font.pixelSize: 20
            font.weight: Font.DemiBold
        }

        ColumnLayout {
            Layout.maximumWidth: 620
            spacing: 8

            SectionLabel {
                colors: root.colors
                text: "Appearance"
            }
            RowLayout {
                WorkbenchButton {
                    colors: root.colors
                    text: "Light"
                    primary: root.colors.mode === "light"
                    onClicked: root.controller.setThemeMode("light")
                }
                WorkbenchButton {
                    colors: root.colors
                    text: "Dark"
                    primary: root.colors.mode === "dark"
                    onClicked: root.controller.setThemeMode("dark")
                }
            }
        }

        Item { Layout.fillHeight: true }
    }
}
