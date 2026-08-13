import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var colors
    required property var matrix
    required property string label

    implicitHeight: implicitWidth + 24

    onMatrixChanged: canvas.requestPaint()
    onColorsChanged: canvas.requestPaint()

    ColumnLayout {
        anchors.fill: parent
        spacing: 4

        Text {
            Layout.fillWidth: true
            text: root.label
            color: root.colors.text
            font.pixelSize: 11
            font.weight: Font.Medium
            horizontalAlignment: Text.AlignHCenter
        }

        Canvas {
            id: canvas
            Layout.fillWidth: true
            Layout.fillHeight: true

            function heatColor(value) {
                var stops = [
                    [18, 31, 43],
                    [24, 76, 91],
                    [32, 137, 135],
                    [233, 196, 106],
                    [231, 111, 81]
                ]
                var scaled = Math.max(0, Math.min(0.999, value)) * (stops.length - 1)
                var left = Math.floor(scaled)
                var fraction = scaled - left
                var a = stops[left]
                var b = stops[Math.min(left + 1, stops.length - 1)]
                return "rgb(" + Math.round(a[0] + fraction * (b[0] - a[0]))
                    + "," + Math.round(a[1] + fraction * (b[1] - a[1]))
                    + "," + Math.round(a[2] + fraction * (b[2] - a[2])) + ")"
            }

            onPaint: {
                var ctx = getContext("2d")
                ctx.clearRect(0, 0, width, height)
                var margin = 16
                var size = Math.max(0, Math.min(width, height) - 2 * margin)
                var cell = size / 7
                var left = (width - size) / 2
                var top = (height - size) / 2
                for (var target = 0; target < 7; ++target) {
                    for (var source = 0; source < 7; ++source) {
                        var value = root.matrix[target][source]
                        ctx.fillStyle = value === null || !isFinite(value)
                            ? root.colors.surfaceAlt : heatColor(value)
                        ctx.fillRect(left + source * cell, top + target * cell, cell, cell)
                    }
                }
                ctx.strokeStyle = root.colors.border
                ctx.lineWidth = 1
                ctx.strokeRect(left, top, size, size)
                ctx.fillStyle = root.colors.muted
                ctx.font = "9px sans-serif"
                ctx.textAlign = "center"
                ctx.textBaseline = "middle"
                for (var index = 0; index < 7; ++index) {
                    ctx.fillText(String(index + 1), left + (index + 0.5) * cell, top - 7)
                    ctx.fillText(String(index + 1), left - 7, top + (index + 0.5) * cell)
                }
            }
        }
    }
}
