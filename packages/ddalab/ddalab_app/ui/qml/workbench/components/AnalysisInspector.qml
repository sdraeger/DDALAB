import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: root

    required property var controller
    required property var colors

    Layout.margins: 12
    spacing: 12

    // Interval bounds arrive as binary floats (a 419.6 s recording yields
    // 419.60179899999997). Trim the representation for display; six decimals
    // keep sub-microsecond precision, so editing the field back is lossless
    // at any sampling rate the reader supports.
    function formatSeconds(value) {
        if (typeof value !== "number" || !isFinite(value))
            return "0"
        var text = value.toFixed(6)
        if (text.indexOf(".") >= 0)
            text = text.replace(/0+$/, "").replace(/\.$/, "")
        return text
    }

    ColumnLayout {
        visible: root.controller.analysisMode !== "ica"
        Layout.fillWidth: true
        spacing: 4
        Text {
            text: "Accelerator"
            color: root.colors.muted
            font.pixelSize: 11
        }
        Flow {
            Layout.fillWidth: true
            Layout.preferredHeight: childrenRect.height
            spacing: 4

            Repeater {
                model: root.controller.computeDeviceModel
                delegate: WorkbenchButton {
                    required property string id
                    required property string label

                    colors: root.colors
                    text: id === "cpu" ? label : "CUDA " + id.split(":")[1]
                    primary: root.controller.computeDevice === id
                    onClicked: root.controller.computeDevice = id
                }
            }
        }
    }

    ColumnLayout {
        visible: root.controller.analysisMode === "dda"
        Layout.fillWidth: true
        spacing: 10

        SectionLabel { colors: root.colors; text: "Flavors" }
        Repeater {
            model: root.controller.flavorModel
            delegate: Toggle {
                required property int index
                required property string id
                required property string label
                required property bool selected

                Layout.fillWidth: true
                colors: root.colors
                text: id + "  " + label
                checked: selected
                onToggled: root.controller.flavorModel.setSelected(index, checked)
            }
        }

        Rectangle { Layout.fillWidth: true; height: 1; color: root.colors.border }
        SectionLabel { colors: root.colors; text: "Interval" }

        RowLayout {
            Layout.fillWidth: true
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 3
                Text { text: "Start (s)"; color: root.colors.muted; font.pixelSize: 11 }
                WorkbenchField {
                    Layout.fillWidth: true
                    colors: root.colors
                    value: root.formatSeconds(root.controller.analysisStart)
                    inputMethodHints: Qt.ImhFormattedNumbersOnly
                    validator: DoubleValidator { bottom: 0 }
                    onEditingFinished: root.controller.analysisStart = Number(text)
                }
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 3
                Text { text: "End (s)"; color: root.colors.muted; font.pixelSize: 11 }
                WorkbenchField {
                    Layout.fillWidth: true
                    colors: root.colors
                    value: root.formatSeconds(root.controller.analysisEnd)
                    inputMethodHints: Qt.ImhFormattedNumbersOnly
                    validator: DoubleValidator { bottom: 0 }
                    onEditingFinished: root.controller.analysisEnd = Number(text)
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 3
                Text { text: "Window (samples)"; color: root.colors.muted; font.pixelSize: 11 }
                WorkbenchField {
                    Layout.fillWidth: true
                    colors: root.colors
                    value: root.controller.windowLength.toString()
                    inputMethodHints: Qt.ImhDigitsOnly
                    validator: IntValidator { bottom: 1 }
                    onEditingFinished: root.controller.windowLength = Number(text)
                }
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 3
                Text { text: "Step (samples)"; color: root.colors.muted; font.pixelSize: 11 }
                WorkbenchField {
                    Layout.fillWidth: true
                    colors: root.colors
                    value: root.controller.windowStep.toString()
                    inputMethodHints: Qt.ImhDigitsOnly
                    validator: IntValidator { bottom: 1 }
                    onEditingFinished: root.controller.windowStep = Number(text)
                }
            }
        }

        Text { text: "Delays (samples)"; color: root.colors.muted; font.pixelSize: 11 }
        WorkbenchField {
            Layout.fillWidth: true
            colors: root.colors
            value: root.controller.delaysText
            validator: RegularExpressionValidator { regularExpression: /[0-9 ,]*/ }
            onEditingFinished: root.controller.delaysText = text
        }
        Toggle {
            Layout.fillWidth: true
            colors: root.colors
            text: "Advanced DDA controls"
            checked: root.controller.expertMode
            onToggled: root.controller.expertMode = checked
        }
        Text {
            visible: root.controller.expertMode
            text: "MODEL terms"
            color: root.colors.muted
            font.pixelSize: 11
        }
        WorkbenchField {
            visible: root.controller.expertMode
            Layout.fillWidth: true
            colors: root.colors
            value: root.controller.modelTermsText
            validator: RegularExpressionValidator { regularExpression: /[0-9 ,]*/ }
            onEditingFinished: root.controller.modelTermsText = text
        }
        Text {
            Layout.fillWidth: true
            text: root.controller.modelEquation
            color: root.colors.muted
            font.pixelSize: 11
            wrapMode: Text.Wrap
        }
        RowLayout {
            visible: root.controller.expertMode
            Layout.fillWidth: true
            WorkbenchField {
                Layout.fillWidth: true
                colors: root.colors
                placeholderText: "dm"
                value: root.controller.derivativePoints.toString()
                inputMethodHints: Qt.ImhDigitsOnly
                validator: IntValidator { bottom: 1 }
                onEditingFinished: root.controller.derivativePoints = Number(text)
            }
            WorkbenchField {
                Layout.fillWidth: true
                colors: root.colors
                placeholderText: "order"
                value: root.controller.polynomialOrder.toString()
                inputMethodHints: Qt.ImhDigitsOnly
                validator: IntValidator { bottom: 1 }
                onEditingFinished: root.controller.polynomialOrder = Number(text)
            }
            WorkbenchField {
                Layout.fillWidth: true
                colors: root.colors
                placeholderText: "nr tau"
                value: root.controller.nrTau.toString()
                inputMethodHints: Qt.ImhDigitsOnly
                validator: IntValidator { bottom: 1 }
                onEditingFinished: root.controller.nrTau = Number(text)
            }
        }
        Text {
            visible: root.controller.expertMode
            Layout.fillWidth: true
            text: "CT, DE, and CD evaluate every selected channel pair."
            color: root.colors.muted
            font.pixelSize: 11
            wrapMode: Text.Wrap
        }
        Text {
            visible: root.controller.datasetLoaded
                && !root.controller.analysisIntervalValid
            Layout.fillWidth: true
            text: "Choose an interval within the recording."
            color: root.colors.danger
            font.pixelSize: 11
            wrapMode: Text.Wrap
        }
        WorkbenchButton {
            Layout.fillWidth: true
            colors: root.colors
            text: root.controller.busy ? "Running…" : "Run DDA"
            primary: true
            enabled: root.controller.datasetLoaded
                && root.controller.analysisIntervalValid
                && !root.controller.busy
            onClicked: root.controller.runDda()
        }
    }

}
