import QtQuick
import "../theme"

// What a request asks, by its kind: the command (permission) or the file
// change as a diff, the questions with their options, or the plan.
Column {
  id: body
  required property var app
  property var ask: ({})
  property int lines: 2
  property bool showAgent: false
  property string keys: ""   // focus keys in the open view (RequestButtons)
  readonly property string kind: ask && ask.request ? ask.request.kind : "permission"
  readonly property bool diff: kind === "permission" && !!(ask && ask.request && ask.request.edits)
  spacing: Theme.s(5)

  // The subagent that asks, as its own line (#193: no "Explore · rm …" chain).
  Label {
    visible: body.showAgent && text !== ""
    text: body.ask && body.ask.request ? body.ask.request.agent : ""
    color: Theme.muted
    font.pixelSize: Theme.fCaption
  }
  AskDetail {
    keys: body.keys
    visible: body.kind === "permission" && !body.diff && shortText !== ""
    app: body.app
    width: parent.width
    ask: body.ask
    lines: body.lines
  }
  DiffDetail {
    keys: body.keys
    visible: body.diff
    app: body.app
    width: parent.width
    ask: body.diff ? body.ask : ({})
  }
  QuestionPicker {
    keys: body.keys
    visible: body.kind === "question"
    app: body.app
    width: parent.width
    ask: body.kind === "question" ? body.ask : ({})
  }
  PlanDetail {
    keys: body.keys
    visible: body.kind === "plan"
    app: body.app
    width: parent.width
    ask: body.kind === "plan" ? body.ask : ({})
  }
}
