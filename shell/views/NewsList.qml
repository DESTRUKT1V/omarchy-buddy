import QtQuick
import qs.Commons
import "../theme"
import "../components"
import "../IslandLogic.js" as IslandLogic

// The open view's news from omarchy-buddy-say and omarchy-buddy-feed.
Column {
  id: view
  required property var app
  // The "Für dich" block's part (unread problems, no title) or the list below
  // it (IslandLogic.forYou).
  property bool forYou: false
  property var items: []
  property bool gap: false  // something above the title
  visible: !forYou || items.length > 0
  spacing: Theme.s(8)
  // Today at noon: the day groups change once a day, not with every tick of app.now.
  readonly property real today: {
    var d = new Date(app.now * 1000)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 1000
  }

  function unfold(key) {
    var next = Object.assign({}, app.news.unfolded)
    if (next[key]) delete next[key]; else next[key] = true
    app.news.unfolded = next
    app.touch()
  }

  // A day's row ("Gestern  3") or today's "3 weitere heute": folds and unfolds.
  component FoldRow: Rectangle {
    id: row
    property string text: ""
    property string count: ""
    property bool open: false
    property alias name: rowMouse.name
    property alias key: rowMouse.key
    signal activated()
    width: parent ? parent.width : 0
    height: Math.max(Theme.s(36), rowLabel.implicitHeight + Theme.s(16))
    radius: Theme.radius
    color: rowMouse.containsMouse ? Util.alpha(Theme.fg, 0.06) : "transparent"

    Click {
      id: rowMouse
      anchors.fill: parent
      ringRadius: row.radius
      onActivated: row.activated()
    }
    Label {
      id: chevron
      x: Theme.s(16) - width / 2  // on the items' dots
      anchors.verticalCenter: parent.verticalCenter
      text: row.open ? "󰅀" : "󰅂"  // md-chevron-down, md-chevron-right
      color: Theme.muted
      font.pixelSize: Theme.fBody
      Accessible.ignored: true
    }
    Label {
      id: rowLabel
      x: Theme.s(32)  // with the items' titles
      width: rowCount.x - x - Theme.s(8)
      anchors.verticalCenter: parent.verticalCenter
      text: row.text
      elide: Text.ElideRight
      color: row.count ? Theme.fg : Theme.muted
      font.pixelSize: row.count ? Theme.fBody : Theme.fCaption
      Accessible.ignored: true
    }
    Label {
      id: rowCount
      anchors { right: parent.right; rightMargin: Theme.s(12); verticalCenter: parent.verticalCenter }
      text: row.count
      color: Theme.muted
      font.pixelSize: Theme.fCaption
      font.features: { "tnum": 1 }
      Accessible.ignored: true
    }
  }

  SectionTitle {
    visible: !view.forYou
    text: Theme.t("news.title")
    link: view.app.news.checkLabel
    topPadding: view.gap ? Theme.s(6) : 0
    onLinkClicked: view.app.news.checkNow()
  }
  Label {
    visible: view.app.news.items.length === 0 && !view.forYou
    text: Theme.t("news.empty")
    color: Theme.muted
  }
  Item {
    visible: view.items.length > 0
    width: view.width
    height: newsList.implicitHeight + Theme.s(8)
    clip: true  // while the height follows a fold
    Behavior on height { NumberAnimation { duration: Theme.reduceMotion ? 0 : 220; easing.type: Easing.OutCubic } }

    Column {
      id: newsList
      x: Theme.s(4); y: Theme.s(4)
      width: parent.width - Theme.s(8)

      // By day (#183); "Für dich" stays one list.
      Repeater {
        model: view.forYou ? [{ key: "", label: "", count: 0, open: true, name: "", today: true, items: view.items, more: "", moreName: "" }]
          : IslandLogic.newsDays(view.items, view.today, view.app.news.unfolded, Theme.lang)

        Column {
          id: day
          required property var modelData
          width: newsList.width

          FoldRow {
            visible: !day.modelData.today
            text: day.modelData.label
            count: String(day.modelData.count)
            open: day.modelData.open
            name: day.modelData.name
            key: "day|" + day.modelData.key
            onActivated: view.unfold(day.modelData.key)
          }
          Repeater {
            model: day.modelData.items

            Rectangle {
              id: item
              required property var modelData
              readonly property bool unread: IslandLogic.newsUnread(modelData, view.app.prefs.lastRead, view.app.prefs.readIds)
              readonly property bool clickable: IslandLogic.clickable(modelData)
              width: newsList.width
              height: itemContent.implicitHeight + Theme.s(16)
              radius: Theme.radius
              // Flat (#193, B7): unread shows in the title's weight, the pointer as a surface.
              color: itemMouse.containsMouse && clickable ? Util.alpha(Theme.fg, 0.06) : "transparent"

              Click {
                id: itemMouse
                anchors.fill: parent
                enabled: item.clickable
                ringRadius: item.radius
                name: IslandLogic.newsName(item.modelData, item.unread, Theme.lang)
                key: "news|" + IslandLogic.newsId(item.modelData)
                onActivated: { view.app.activate(item.modelData); view.app.opened = false }
              }
              Row {
                id: itemContent
                anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: Theme.s(12); rightMargin: Theme.s(12) }
                spacing: Theme.s(12)

                // A problem also by its shape (md-alert-circle, md-alert), not only the colour.
                Rectangle {
                  y: (senderLine.height - height) / 2
                  width: Theme.s(8); height: width; radius: width / 2
                  color: problemMark.visible ? "transparent" : Theme.levelColor(item.modelData.level)
                  Label {
                    id: problemMark
                    visible: text !== ""
                    anchors.centerIn: parent
                    text: item.modelData.level === "error" ? "󰀨" : item.modelData.level === "warn" ? "󰀦" : ""
                    color: Theme.levelColor(item.modelData.level)
                    font.pixelSize: Theme.fBody
                    Accessible.ignored: true  // the name says it
                  }
                }
                Column {
                  width: parent.width - Theme.s(20)
                  spacing: Theme.s(2)
                  // Where it comes from as a sender line, the time on the right (#193, B6: no "Coding · 17:14").
                  Item {
                    id: senderLine
                    width: parent.width
                    height: Math.max(sender.implicitHeight, doneNews.visible ? doneNews.implicitHeight : 0)
                    Label {
                      id: sender
                      anchors.verticalCenter: parent.verticalCenter
                      width: Math.min(implicitWidth, meta.x - Theme.s(12))
                      text: IslandLogic.sourceName(item.modelData.source, Theme.lang)
                      elide: Text.ElideRight
                      font.pixelSize: Theme.fCaption
                      color: Theme.muted
                    }
                    Label {
                      id: meta
                      anchors.right: doneNews.visible ? doneNews.left : parent.right
                      anchors.rightMargin: doneNews.visible ? Theme.s(12) : 0
                      anchors.verticalCenter: parent.verticalCenter
                      text: view.app.when(Number(item.modelData.time || 0))
                      font.pixelSize: Theme.fCaption
                      font.features: { "tnum": 1 }
                      color: Theme.muted
                    }
                    // Out of "Für dich" (#178): news cannot be deleted, it stays below.
                    Link {
                      id: doneNews
                      visible: view.forYou
                      anchors.right: parent.right
                      anchors.verticalCenter: parent.verticalCenter
                      text: "󰅖"
                      name: Theme.t("a11y.done", item.modelData.title || "")
                      key: "done|" + IslandLogic.newsId(item.modelData)
                      font.pixelSize: Theme.fBody
                      reach: Theme.s(10)
                      onActivated: view.app.markDone(item.modelData)
                    }
                  }
                  Label {
                    width: parent.width
                    text: item.modelData.title || ""
                    font.weight: item.unread ? Font.DemiBold : Font.Normal
                    elide: Text.ElideRight
                  }
                  Label {
                    visible: text !== ""
                    width: parent.width
                    text: item.modelData.body || ""
                    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    color: Theme.muted
                    font.pixelSize: Theme.fCaption
                  }
                  Column {
                    visible: newsButton.label !== ""
                    topPadding: Theme.s(6)
                    ActionButton {
                      id: newsButton
                      strong: false  // quiet in the list; pop-ups keep the bright one
                      label: IslandLogic.actionLabel(item.modelData.action, Theme.lang)
                      key: "newsButton|" + IslandLogic.newsId(item.modelData)
                      onClicked: { view.app.runAction(item.modelData); view.app.opened = false }
                    }
                  }
                }
              }
            }
          }
          FoldRow {
            visible: day.modelData.more !== ""
            text: day.modelData.more
            open: !!view.app.news.unfolded[day.modelData.key]
            name: day.modelData.moreName
            key: "day|" + day.modelData.key + "|more"
            onActivated: view.unfold(day.modelData.key)
          }
        }
      }
    }
  }
}
