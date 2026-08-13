import QtQuick
import DDALAB.Plots

Rectangle {
    id: root

    property var waveformBridge: null
    property bool chromeVisible: true
    property var theme: waveformBridge ? waveformBridge.theme : ({
        "surface": "#141b23",
        "surfaceAlt": "#121922",
        "canvas": "#101720",
        "text": "#dbe4ed",
        "mutedText": "#94a3b8",
        "border": "#3b4b5f",
        "annotationChannel": "#f6c453",
        "annotationGlobal": "#72d0ff"
    })

    color: root.theme.surface
    radius: root.chromeVisible ? 14 : 6
    border.color: root.theme.border
    border.width: root.chromeVisible ? 1 : 0

    Column {
        anchors.fill: parent
        anchors.margins: root.chromeVisible ? 14 : 0
        spacing: root.chromeVisible ? 8 : 0

        Text {
            text: root.waveformBridge ? root.waveformBridge.title : "DDALAB waveform"
            color: root.theme.text
            font.pixelSize: 16
            font.bold: true
            elide: Text.ElideRight
            width: parent.width
            visible: root.chromeVisible
        }

        Rectangle {
            id: plotArea
            function longestChannelLabel(labels) {
                var longest = ""
                for (var index = 0; index < labels.length; ++index) {
                    var label = String(labels[index])
                    if (label.length > longest.length) {
                        longest = label
                    }
                }
                return longest
            }

            property bool hasWaveform: root.waveformBridge !== null
                && root.waveformBridge !== undefined
                && root.waveformBridge.channelCount > 0
            property real channelAxisWidth: hasWaveform
                ? Math.min(160, Math.max(20, Math.ceil(channelLabelMeasure.implicitWidth) + 6))
                : 0
            property real timeAxisHeight: hasWaveform ? 36 : 0

            width: parent.width
            height: root.chromeVisible ? Math.max(80, parent.height - 62) : parent.height
            radius: root.chromeVisible ? 10 : 6
            color: root.theme.canvas
            border.color: root.theme.border
            border.width: 1

            Text {
                id: channelLabelMeasure
                visible: false
                text: plotArea.longestChannelLabel(
                    root.waveformBridge ? root.waveformBridge.channelLabels : []
                )
                font.pixelSize: 11
            }

            Item {
                id: channelAxis
                x: 1
                y: 1
                width: plotArea.channelAxisWidth
                height: plotArea.height - plotArea.timeAxisHeight - 2
                visible: plotArea.hasWaveform

                Repeater {
                    model: root.waveformBridge ? root.waveformBridge.channelLabels : []

                    Text {
                        required property int index
                        required property string modelData

                        x: 1
                        y: index * channelAxis.height
                            / Math.max(root.waveformBridge.channelCount, 1)
                        width: channelAxis.width - 4
                        height: channelAxis.height
                            / Math.max(root.waveformBridge.channelCount, 1)
                        text: modelData
                        color: root.theme.mutedText
                        font.pixelSize: 11
                        horizontalAlignment: Text.AlignRight
                        verticalAlignment: Text.AlignVCenter
                        elide: Text.ElideLeft
                        clip: true
                    }
                }

                Rectangle {
                    anchors.right: parent.right
                    width: 1
                    height: parent.height
                    color: root.theme.border
                }
            }

            Item {
                id: dataViewport
                x: plotArea.channelAxisWidth + 1
                y: 1
                width: plotArea.width - plotArea.channelAxisWidth - 2
                height: plotArea.height - plotArea.timeAxisHeight - 2

                Repeater {
                    model: plotArea.hasWaveform
                        ? root.waveformBridge.channelCount + 1
                        : 0

                    Rectangle {
                        required property int index

                        x: 0
                        y: Math.min(
                            dataViewport.height - 1,
                            index * dataViewport.height
                                / Math.max(root.waveformBridge.channelCount, 1)
                        )
                        width: dataViewport.width
                        height: 1
                        color: root.theme.border
                        opacity: 0.28
                    }
                }

                Repeater {
                    model: root.waveformBridge ? root.waveformBridge.timeTicks : []

                    Rectangle {
                        required property var modelData

                        x: Math.min(
                            dataViewport.width - 1,
                            Math.round(modelData.position * dataViewport.width)
                        )
                        y: 0
                        width: 1
                        height: dataViewport.height
                        color: root.theme.border
                        opacity: 0.22
                    }
                }

                QuickWaveformTextureItem {
                    anchors.fill: parent
                    bridge: root.waveformBridge || null
                    visible: plotArea.hasWaveform
                        && root.waveformBridge.hasImage
                        && root.waveformBridge.showWaveformLayer
                }

                Repeater {
                    model: root.waveformBridge
                        && root.waveformBridge.showAnnotationsLayer
                        ? root.waveformBridge.annotationItems
                        : []

                    Rectangle {
                        required property var modelData

                        x: dataViewport.width * modelData.x
                        y: dataViewport.height * modelData.y
                        width: Math.max(
                            modelData.width > 0
                                ? dataViewport.width * modelData.width
                                : 1,
                            1
                        )
                        height: Math.max(dataViewport.height * modelData.height, 1)
                        color: modelData.channelName
                            ? root.theme.annotationChannel
                            : root.theme.annotationGlobal
                        opacity: modelData.width > 0 ? 0.18 : 0.8
                        radius: modelData.width > 0 ? 4 : 0
                        visible: root.waveformBridge !== null
                            && root.waveformBridge !== undefined
                            && root.waveformBridge.showAnnotationsLayer
                    }
                }

                MouseArea {
                    id: interactionArea
                    anchors.fill: parent
                    acceptedButtons: Qt.LeftButton | Qt.RightButton
                    hoverEnabled: true
                    property real previousX: 0

                    onPressed: function(mouse) {
                        previousX = mouse.x
                        if (mouse.button === Qt.RightButton && root.waveformBridge) {
                            root.waveformBridge.requestAnnotationContext(
                                mouse.x / Math.max(width, 1),
                                mouse.y / Math.max(height, 1)
                            )
                        }
                    }
                    onPositionChanged: function(mouse) {
                        if ((mouse.buttons & Qt.LeftButton) && root.waveformBridge) {
                            root.waveformBridge.requestPan(
                                (previousX - mouse.x) / Math.max(width, 1)
                            )
                            previousX = mouse.x
                        }
                    }
                    onWheel: function(wheel) {
                        if (!root.waveformBridge) {
                            return
                        }
                        root.waveformBridge.requestZoom(
                            wheel.angleDelta.y > 0 ? 0.8 : 1.25,
                            wheel.x / Math.max(width, 1)
                        )
                        wheel.accepted = true
                    }
                }
            }

            Item {
                id: timeAxis
                x: dataViewport.x
                y: dataViewport.y + dataViewport.height
                width: dataViewport.width
                height: plotArea.timeAxisHeight
                visible: plotArea.hasWaveform

                Rectangle {
                    width: parent.width
                    height: 1
                    color: root.theme.border
                }

                Repeater {
                    model: root.waveformBridge ? root.waveformBridge.timeTicks : []

                    Item {
                        id: tick
                        required property var modelData

                        x: Math.min(
                            timeAxis.width - 1,
                            Math.round(modelData.position * timeAxis.width)
                        )
                        width: 1
                        height: timeAxis.height

                        Rectangle {
                            width: 1
                            height: 4
                            color: root.theme.border
                        }

                        Text {
                            x: Math.max(
                                -tick.x,
                                Math.min(
                                    timeAxis.width - tick.x - width,
                                    -width / 2
                                )
                            )
                            y: 5
                            width: 64
                            text: modelData.label
                            color: root.theme.mutedText
                            font.pixelSize: 10
                            horizontalAlignment: Text.AlignHCenter
                        }
                    }
                }

                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.bottom: parent.bottom
                    anchors.bottomMargin: 1
                    text: "Time (s)"
                    color: root.theme.mutedText
                    font.pixelSize: 10
                }
            }

            Text {
                anchors.centerIn: dataViewport
                text: root.waveformBridge ? root.waveformBridge.statusText : "No waveform loaded"
                color: root.theme.mutedText
                font.pixelSize: 13
                visible: !plotArea.hasWaveform
            }
        }

        Text {
            text: root.waveformBridge ? root.waveformBridge.statusText : "No waveform loaded"
            color: root.theme.mutedText
            font.pixelSize: 12
            width: parent.width
            elide: Text.ElideRight
            visible: root.chromeVisible
        }
    }
}
