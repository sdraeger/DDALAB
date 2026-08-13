import QtQuick

Text {
    required property var colors

    color: colors.title
    font.pixelSize: 13
    font.weight: Font.DemiBold
    elide: Text.ElideRight
}
