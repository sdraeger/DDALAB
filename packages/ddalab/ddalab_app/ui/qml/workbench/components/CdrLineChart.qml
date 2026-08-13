import QtQuick
import QtQuick.Layouts

Rectangle {
    id: root

    required property var colors
    required property var curves
    required property string title
    property var xLabels: []
    property string mode: "index"
    property bool logX: false
    property bool logY: false
    property bool zeroBaseline: false
    property bool showMarkers: false
    property string xLabel: ""
    property string yLabel: ""

    radius: 7
    color: colors.surfaceAlt
    border.color: colors.border
    border.width: 1

    onCurvesChanged: canvas.requestPaint()
    onColorsChanged: canvas.requestPaint()

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 3

        Text {
            Layout.fillWidth: true
            text: root.title
            color: root.colors.title
            font.pixelSize: 12
            font.weight: Font.DemiBold
        }

        Canvas {
            id: canvas
            Layout.fillWidth: true
            Layout.fillHeight: true

            function transformed(value, logarithmic) {
                return logarithmic ? Math.log(value) / Math.LN10 : value
            }

            function curveColor(curve) {
                if (curve.color)
                    return curve.color
                if (curve.kind === "true")
                    return "#e76f51"
                if (curve.kind === "false")
                    return "#2a9d8f"
                return root.colors.muted
            }

            function bounds() {
                var xMin = Number.POSITIVE_INFINITY
                var xMax = Number.NEGATIVE_INFINITY
                var yMin = Number.POSITIVE_INFINITY
                var yMax = Number.NEGATIVE_INFINITY
                for (var c = 0; c < root.curves.length; ++c) {
                    var curve = root.curves[c]
                    var count = root.mode === "xy" ? curve.x.length : curve.values.length
                    for (var i = 0; i < count; ++i) {
                        var rawX = root.mode === "xy" ? curve.x[i] : i
                        var rawY = root.mode === "xy" ? curve.y[i] : curve.values[i]
                        if (!isFinite(rawX) || !isFinite(rawY)
                                || (root.logX && rawX <= 0) || (root.logY && rawY <= 0))
                            continue
                        var x = transformed(rawX, root.logX)
                        var y = transformed(rawY, root.logY)
                        xMin = Math.min(xMin, x)
                        xMax = Math.max(xMax, x)
                        yMin = Math.min(yMin, y)
                        yMax = Math.max(yMax, y)
                    }
                }
                if (!isFinite(xMin) || xMin === xMax) {
                    xMin = 0
                    xMax = 1
                }
                if (!isFinite(yMin) || yMin === yMax) {
                    yMin = 0
                    yMax = 1
                }
                var yPad = Math.max((yMax - yMin) * 0.05, 1e-12)
                return [
                    xMin,
                    xMax,
                    root.zeroBaseline ? 0 : yMin - yPad,
                    yMax + yPad
                ]
            }

            function drawCurves(ctx, box, highlighted) {
                var left = 50
                var top = 8
                var plotWidth = width - left - 12
                var plotHeight = height - top - 36
                for (var c = 0; c < root.curves.length; ++c) {
                    var curve = root.curves[c]
                    if (!!curve.highlight !== highlighted)
                        continue
                    var count = root.mode === "xy" ? curve.x.length : curve.values.length
                    ctx.beginPath()
                    var started = false
                    var points = []
                    for (var i = 0; i < count; ++i) {
                        var rawX = root.mode === "xy" ? curve.x[i] : i
                        var rawY = root.mode === "xy" ? curve.y[i] : curve.values[i]
                        if (!isFinite(rawX) || !isFinite(rawY)
                                || (root.logX && rawX <= 0) || (root.logY && rawY <= 0)) {
                            started = false
                            continue
                        }
                        var xValue = transformed(rawX, root.logX)
                        var yValue = transformed(rawY, root.logY)
                        var x = left + plotWidth * (xValue - box[0]) / (box[1] - box[0])
                        var y = top + plotHeight * (1 - (yValue - box[2]) / (box[3] - box[2]))
                        points.push([x, y])
                        if (!started) {
                            ctx.moveTo(x, y)
                            started = true
                        } else {
                            ctx.lineTo(x, y)
                        }
                    }
                    ctx.strokeStyle = curveColor(curve)
                    ctx.globalAlpha = highlighted ? 0.95 : 0.62
                    ctx.lineWidth = highlighted ? 1.8 : 0.8
                    ctx.stroke()

                    if (root.showMarkers) {
                        ctx.fillStyle = curveColor(curve)
                        for (var point = 0; point < points.length; ++point) {
                            ctx.beginPath()
                            ctx.arc(
                                points[point][0],
                                points[point][1],
                                highlighted ? 2.2 : 1.5,
                                0,
                                2 * Math.PI
                            )
                            ctx.fill()
                        }
                    }
                }
                ctx.globalAlpha = 1
            }

            onPaint: {
                var ctx = getContext("2d")
                ctx.clearRect(0, 0, width, height)
                var left = 50
                var top = 8
                var plotWidth = width - left - 12
                var plotHeight = height - top - 36
                var box = bounds()

                ctx.strokeStyle = root.colors.border
                ctx.lineWidth = 1
                ctx.strokeRect(left, top, plotWidth, plotHeight)
                drawCurves(ctx, box, false)
                drawCurves(ctx, box, true)

                ctx.fillStyle = root.colors.muted
                ctx.font = "10px sans-serif"
                ctx.textBaseline = "top"
                ctx.textAlign = "center"
                if (root.mode === "index" && root.xLabels.length > 0) {
                    var ticks = [0, 6, 11, 16, root.xLabels.length - 1]
                    for (var i = 0; i < ticks.length; ++i) {
                        var tick = ticks[i]
                        var x = left + plotWidth * tick / Math.max(root.xLabels.length - 1, 1)
                        ctx.fillText(root.xLabels[tick], x, top + plotHeight + 4)
                    }
                } else {
                    ctx.fillText(root.logX ? "10^" + box[0].toFixed(1) : box[0].toPrecision(2), left, top + plotHeight + 4)
                    ctx.fillText(root.logX ? "10^" + box[1].toFixed(1) : box[1].toPrecision(2), left + plotWidth, top + plotHeight + 4)
                }
                ctx.textAlign = "right"
                ctx.textBaseline = "middle"
                ctx.fillText(root.logY ? "10^" + box[3].toFixed(1) : box[3].toExponential(1), left - 5, top)
                ctx.fillText(root.logY ? "10^" + box[2].toFixed(1) : box[2].toExponential(1), left - 5, top + plotHeight)
                ctx.textAlign = "center"
                ctx.textBaseline = "bottom"
                ctx.fillText(root.xLabel, left + plotWidth / 2, height)
                ctx.save()
                ctx.translate(11, top + plotHeight / 2)
                ctx.rotate(-Math.PI / 2)
                ctx.fillText(root.yLabel, 0, 0)
                ctx.restore()
            }
        }
    }
}
