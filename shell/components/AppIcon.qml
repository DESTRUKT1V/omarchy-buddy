import QtQuick

// An app icon (theme name or file); hidden when there is none.
Image {
  property int size: 16
  visible: status === Image.Ready
  width: size; height: size
  sourceSize.width: size * 2; sourceSize.height: size * 2
  fillMode: Image.PreserveAspectFit
  asynchronous: true
  smooth: true
}
