import QtQuick
import qs.Commons
import "../theme"
import "../SessionLogic.js" as SessionLogic

// Claude asks (AskUserQuestion): each question with its options to pick,
// the last one "Eigene Antwort", which opens a field for the user's text. With one question and one choice a click
// answers; otherwise "Antworten" (RequestButtons) sends them all.
Column {
  id: picker
  required property var app
  property var ask: ({})
  property string keys: ""
  readonly property var request: ask && ask.request ? ask.request : null
  readonly property var questions: request ? request.questions : []
  readonly property var sel: app.sessions.answers[ask ? ask.key : ""] || ({})
  spacing: Theme.s(12)

  Repeater {
    model: picker.questions

    Column {
      id: block
      required property var modelData
      readonly property string typeKey: picker.ask.key + "|" + modelData.question
      readonly property string own: SessionLogic.ownAnswer(picker.sel, modelData)
      readonly property bool typing: picker.app.sessions.typingKey === typeKey
      width: picker.width
      spacing: Theme.s(5)

      // Claude's short title of the question as a chip.
      Rectangle {
        visible: block.modelData.header !== ""
        width: Math.min(headerLabel.implicitWidth + Theme.s(16), parent.width)
        height: headerLabel.implicitHeight + Theme.s(6)
        radius: Theme.radius
        color: Util.alpha(Theme.fg, 0.09)
        Label {
          id: headerLabel
          anchors.centerIn: parent
          width: Math.min(implicitWidth, parent.parent.width - Theme.s(16))
          text: block.modelData.header
          elide: Text.ElideRight
          font.pixelSize: Theme.fCaption
          font.weight: Font.Medium
        }
      }
      Label {
        width: parent.width
        text: block.modelData.question
        wrapMode: Text.WrapAtWordBoundaryOrAnywhere
        font.weight: Font.Medium
      }
      Label {
        visible: block.modelData.multiSelect
        text: Theme.t("question.multi")
        color: Theme.muted
        font.pixelSize: Theme.fCaption
      }

      Repeater {
        // label "": the own answer
        model: block.modelData.options.concat([{ label: "", description: "" }])

        Rectangle {
          id: option
          required property var modelData
          readonly property bool own: modelData.label === ""
          readonly property string label: own ? Theme.t("question.own") : modelData.label
          readonly property bool on: SessionLogic.marked(picker.sel, block.modelData, modelData.label, block.typing)
          width: block.width
          height: optionText.implicitHeight + Theme.s(14)
          radius: Theme.radius
          color: on ? Util.alpha(Theme.accent, 0.2) : optionMouse.containsMouse ? Util.alpha(Theme.fg, 0.1) : Util.alpha(Theme.fg, 0.05)
          border.width: 1
          border.color: on ? Util.alpha(Theme.accent, 0.6) : "transparent"
          scale: optionMouse.pressed && !Theme.reduceMotion ? 0.98 : 1
          Behavior on color { ColorAnimation { duration: 120 } }
          Behavior on scale { NumberAnimation { duration: 90 } }

          // A dot for one choice, a box for several.
          Rectangle {
            id: mark
            x: Theme.s(10)
            y: Theme.s(7) + (optionLabel.implicitHeight - height) / 2
            width: Theme.s(12); height: width
            radius: block.modelData.multiSelect ? Theme.radius : width / 2  // a radio stays round: the shape says "one of"
            color: option.on ? Theme.accent : "transparent"
            border.width: option.on ? 0 : 1
            border.color: Theme.muted
          }
          Column {
            id: optionText
            x: mark.x + mark.width + Theme.s(9)
            y: Theme.s(7)
            width: parent.width - x - Theme.s(10)
            spacing: Theme.s(2)
            Label {
              id: optionLabel
              width: parent.width
              text: option.label
              wrapMode: Text.WrapAtWordBoundaryOrAnywhere
              font.weight: Font.DemiBold
            }
            Label {
              visible: text !== ""
              width: parent.width
              text: option.own ? (block.own !== "" ? Theme.t("quote", block.own) : "") : option.modelData.description
              wrapMode: Text.WrapAtWordBoundaryOrAnywhere
              // on the accent-tinted choice muted text would fall under 4.5:1
              color: option.on ? Theme.fg : Theme.muted
              font.pixelSize: Theme.fCaption
            }
          }
          Click {
            id: optionMouse
            anchors.fill: parent
            ringRadius: option.radius
            name: option.label
            key: picker.keys ? picker.keys + "|" + block.typeKey + "|" + (option.own ? "own" : option.modelData.label) : ""
            Accessible.role: block.modelData.multiSelect ? Accessible.CheckBox : Accessible.RadioButton
            Accessible.checkable: true
            Accessible.checked: option.on
            onActivated: {
              if (!option.own) picker.app.sessions.choose(picker.ask, block.modelData, option.modelData.label)
              else { picker.app.sessions.typingKey = block.typeKey; picker.app.touch() }
            }
          }
        }
      }

      TypeField {
        visible: block.typing
        width: parent.width
        hint: Theme.t("question.hint")
        onAccepted: function(text) { picker.app.sessions.ownAnswer(picker.ask, block.modelData, text) }
        onCancelled: picker.app.sessions.typingKey = ""
      }
    }
  }
}
