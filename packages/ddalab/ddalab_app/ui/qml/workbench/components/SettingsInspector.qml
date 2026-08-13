import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: root

    required property var controller
    required property var colors

    Layout.margins: 12
    spacing: 8

    SectionLabel { colors: root.colors; text: "NSG credentials" }
    WorkbenchField {
        id: nsgUsername
        Layout.fillWidth: true
        colors: root.colors
        placeholderText: "Username"
    }
    WorkbenchField {
        id: nsgPassword
        Layout.fillWidth: true
        colors: root.colors
        placeholderText: "Password"
        echoMode: TextInput.Password
    }
    WorkbenchField {
        id: nsgKey
        Layout.fillWidth: true
        colors: root.colors
        placeholderText: "Application key"
        echoMode: TextInput.Password
    }
    WorkbenchButton {
        Layout.fillWidth: true
        colors: root.colors
        text: "Save and verify"
        primary: true
        enabled: !root.controller.loadingComponents.nsgCredentials
        onClicked: root.controller.saveNsgCredentials(
            nsgUsername.text,
            nsgPassword.text,
            nsgKey.text
        )
    }
    RowLayout {
        Layout.fillWidth: true
        visible: !!root.controller.loadingComponents.nsgCredentials
        spacing: 6
        ActivitySpinner {
            Layout.preferredWidth: 18
            Layout.preferredHeight: 18
            colors: root.colors
            running: parent.visible
        }
        Text {
            text: "Loading credential status…"
            color: root.colors.muted
            font.pixelSize: 11
        }
    }

    Rectangle { Layout.fillWidth: true; height: 1; color: root.colors.border }
    RowLayout {
        Layout.fillWidth: true
        SectionLabel {
            Layout.fillWidth: true
            colors: root.colors
            text: "NSG jobs"
        }
        WorkbenchButton {
            colors: root.colors
            text: "Refresh"
            enabled: !root.controller.loadingComponents.nsgJobs
            onClicked: root.controller.refreshNsgJobs()
        }
    }
    Item {
        Layout.fillWidth: true
        Layout.preferredHeight: Math.max(
            Math.min(nsgJobs.contentHeight, 280),
            root.controller.loadingComponents.nsgJobs ? 56 : 0
        )
        ListView {
            id: nsgJobs
            anchors.fill: parent
            model: root.controller.nsgJobsModel
            delegate: Column {
                required property string name
                required property string status
                width: nsgJobs.width
                height: 42
                Text {
                    width: parent.width
                    text: name
                    color: root.colors.text
                    font.pixelSize: 12
                    elide: Text.ElideRight
                }
                Text {
                    text: status
                    color: root.colors.muted
                    font.pixelSize: 10
                }
            }
        }
        LoadingOverlay {
            anchors.fill: parent
            colors: root.colors
            backgroundColor: root.colors.panel
            running: !!root.controller.loadingComponents.nsgJobs
            text: "Loading NSG jobs…"
        }
    }

    Rectangle { Layout.fillWidth: true; height: 1; color: root.colors.border }
    SectionLabel { colors: root.colors; text: "Application updates" }
    Text {
        Layout.fillWidth: true
        text: root.controller.loadingComponents.updates
            ? "Loading update status…"
            : root.controller.updateStatus
        color: root.colors.muted
        font.pixelSize: 12
        wrapMode: Text.Wrap
    }
    WorkbenchButton {
        Layout.fillWidth: true
        colors: root.colors
        text: "Check for updates"
        enabled: !root.controller.loadingComponents.updates
        onClicked: root.controller.checkForUpdates()
    }
}
