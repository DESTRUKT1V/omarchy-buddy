import QtQuick
import Quickshell
import "../theme"
import "../components"
import "../SettingsLogic.js" as SettingsLogic
import "../PlayerLogic.js" as PlayerLogic

// The settings page behind the gear in the open view (Settings.qml writes
// config.json; what lives only in the file is named at the bottom).
Column {
  id: view
  required property var app
  readonly property var settings: app.settings
  readonly property var values: settings.values
  readonly property var spotify: app.spotify
  readonly property var apps: SettingsLogic.pageApps(app.notifications.notes, values)
  readonly property var agents: SettingsLogic.agentRows(settings.agentsInstalled, values)
  readonly property var gitRepos: SettingsLogic.gitRows(settings.gitList, values)
  property bool removing: false   // the question before uninstalling is open
  property bool sourcesOpen: false
  spacing: Theme.s(10)
  onVisibleChanged: if (visible) { page.contentY = 0; removing = false; sourcesOpen = false; kumaField.text = values.feed.kuma; settings.checkSources(); settings.checkAgents(); settings.checkBar(); settings.checkGit() }

  Item {
    width: parent.width
    height: pageTitle.implicitHeight
    Link {
      anchors.left: parent.left
      anchors.leftMargin: Theme.s(4)
      anchors.verticalCenter: parent.verticalCenter
      text: Theme.t("settings.back")
      font.pixelSize: Theme.fBody
      // The chevron as its own icon with room, not glued to the word (#193).
      leftPadding: backIcon.implicitWidth + Theme.s(6)
      onActivated: view.app.settingsShown = false
      Label {
        id: backIcon
        anchors.verticalCenter: parent.verticalCenter
        text: "󰅁"
        color: parent.color
        font.pixelSize: parent.font.pixelSize
        Accessible.ignored: true
      }
    }
    Label {
      id: pageTitle
      anchors.horizontalCenter: parent.horizontalCenter
      text: Theme.t("settings.title")
      font.pixelSize: Theme.fTitle
      font.weight: Font.Bold
    }
  }

  Hint {
    visible: view.settings.broken
    text: Theme.t("settings.broken")
    problem: true
  }
  Hint {
    visible: view.settings.invalid.length > 0 && !view.settings.broken
    text: Theme.t("settings.invalid", view.settings.invalid.join(", "))
    problem: true
  }

  Flickable {
    id: page
    width: parent.width
    height: Math.min(pageColumn.implicitHeight, Theme.listMaxHeight)
    contentHeight: pageColumn.implicitHeight
    interactive: contentHeight > height
    boundsBehavior: Flickable.StopAtBounds
    clip: true

    Column {
      id: pageColumn
      width: parent.width
      spacing: Theme.s(2)

      SectionTitle { text: Theme.t("settings.display") }
      SettingRow {
        label: Theme.t("settings.size")
        Segments {
          options: SettingsLogic.zoomOptionsWith(Theme.autoZoom, view.values.zoom, Theme.lang)
          value: view.values.zoom
          onPicked: function(v) { view.settings.set("zoom", v) }
        }
      }
      SettingRow {
        label: Theme.t("settings.popupTime")
        Segments {
          options: SettingsLogic.popupTimeOptions(Theme.lang)
          value: view.values.popupTime
          onPicked: function(v) { view.settings.set("popupTime", v) }
        }
      }
      SettingRow {
        label: Theme.t("settings.reduceMotion")
        Toggle {
          name: Theme.t("settings.reduceMotion")
          checked: view.values.reduceMotion
          onToggled: function(on) { view.settings.set("reduceMotion", on) }
        }
      }
      SettingRow {
        label: Theme.t("settings.language")
        Segments {
          options: SettingsLogic.languageOptions(Theme.lang)
          value: view.values.language
          onPicked: function(v) { view.settings.set("language", v) }
        }
      }
      // Many fonts: the choice under its label, in as many lines as it needs.
      Column {
        width: parent.width
        topPadding: Theme.s(5)
        bottomPadding: Theme.s(5)
        spacing: Theme.s(6)
        Label { x: Theme.s(4); text: Theme.t("settings.font") }
        Segments {
          maxWidth: parent.width
          options: SettingsLogic.fontOptions(view.settings.fontList, Qt.fontFamilies(), view.values.font, Theme.lang)
          value: view.values.font
          onPicked: function(v) { view.settings.set("font", v) }
        }
      }

      SectionTitle { text: Theme.t("settings.privacy"); topPadding: Theme.s(12) }
      SettingRow {
        label: Theme.t("settings.whenSharing")
        Segments {
          options: SettingsLogic.sharingOptions(Theme.lang)
          value: view.values.whenSharing
          onPicked: function(v) { view.settings.set("whenSharing", v) }
        }
      }
      SettingRow {
        label: Theme.t("settings.history")
        Segments {
          options: SettingsLogic.historyOptions(Theme.lang)
          value: view.values.history
          onPicked: function(v) { view.settings.set("history", v) }
        }
      }

      SectionTitle { text: Theme.t("settings.apps"); topPadding: Theme.s(12) }
      Label {
        visible: view.apps.length === 0
        x: Theme.s(4)
        text: Theme.t("settings.noApps")
        color: Theme.muted
      }
      Repeater {
        model: view.apps
        SettingRow {
          id: appRow
          required property string modelData
          label: modelData
          Segments {
            options: SettingsLogic.appOptions(Theme.lang)
            value: SettingsLogic.appRule(view.values, appRow.modelData)
            onPicked: function(v) { view.settings.setAppRule(appRow.modelData, v) }
          }
        }
      }
      // "Mit KI ansehen" (#235): only with a default agent (Sessions.defaultAgent).
      SettingRow {
        label: Theme.t("settings.aiButton")
        Toggle {
          name: Theme.t("settings.aiButton")
          checked: view.values.aiButton
          onToggled: function(on) { view.settings.set("aiButton", on) }
        }
      }
      Hint {
        text: view.app.sessions.defaultAgent ? Theme.t("settings.aiButtonHint", view.app.sessions.defaultAgent) : Theme.t("settings.aiButtonNoAgent")
      }
      Link {
        visible: !view.app.sessions.defaultAgent && view.app.sessions.menuPresent
        x: Theme.s(4)
        topPadding: Theme.s(4)
        text: Theme.t("settings.aiButtonPick")
        onActivated: { view.app.sessions.pickDefaultAgent(); view.app.opened = false }
      }

      // One switch per installed agent (#158); Claude is always on.
      SectionTitle { visible: view.agents.length > 0; text: Theme.t("settings.agents"); topPadding: Theme.s(12) }
      Repeater {
        model: view.agents
        SettingRow {
          id: agentRow
          required property var modelData
          label: modelData.name
          hint: modelData.untested ? Theme.t("settings.agentUntested") : ""
          Toggle {
            name: agentRow.hint ? agentRow.modelData.name + ", " + agentRow.hint : agentRow.modelData.name
            checked: agentRow.modelData.on
            onToggled: function(on) { view.settings.setAgent(agentRow.modelData.id, on) }
          }
        }
      }
      Hint {
        visible: view.agents.length > 0
        text: view.settings.agentsNote || Theme.t("settings.agentsHint")
        problem: view.settings.agentsNote !== ""
      }

      // The bar (#184): Omarchy's weather replaced, the bar arranged on request.
      SectionTitle { text: Theme.t("settings.bar"); topPadding: Theme.s(12) }
      SettingRow {
        label: Theme.t("settings.weather")
        Toggle {
          name: Theme.t("settings.weather")
          checked: view.values.weather
          onToggled: function(on) { view.settings.setWeather(on) }
        }
      }
      Hint {
        text: view.settings.weatherNote || Theme.t("settings.weatherHint")
        problem: view.settings.weatherNote !== ""
      }
      SettingRow {
        visible: view.settings.barOrder !== ""
        label: Theme.t("settings.barOrder")
        ActionButton {
          label: Theme.t(view.settings.barOrder === "undo" ? "settings.barOrderUndo" : "settings.barOrderDo")
          onClicked: view.settings.checkBar(view.settings.barOrder === "offer")
        }
      }
      Hint {
        visible: view.settings.barOrder !== "" || view.settings.barNote !== ""
        text: view.settings.barNote || Theme.t(view.settings.barOrder === "undo" ? "settings.barOrderDone" : "settings.barOrderHint")
        problem: view.settings.barNote !== ""
      }

      // What only some need (#193, B12): folded under "Quellen".
      Item {
        readonly property string name: Theme.t("settings.sources")  // for the test IPC (Probe.nameOf)
        readonly property string probeOwner: "view"  // only folds (Probe.ownerOf)
        width: parent.width
        height: sourcesTitle.implicitHeight + Theme.s(12) + Theme.s(8)
        Click {
          id: sourcesClick
          x: 0; y: Theme.s(12)
          width: parent.width
          height: parent.height - Theme.s(12)
          name: parent.name
          Accessible.description: Theme.t(view.sourcesOpen ? "a11y.unfolded" : "a11y.folded")
          onActivated: view.sourcesOpen = !view.sourcesOpen
        }
        Label {
          id: sourcesTitle
          x: Theme.s(4)
          y: Theme.s(12) + Theme.s(4)
          text: Theme.t("settings.sources")
          font.pixelSize: Theme.fCaption
          font.weight: Font.DemiBold
          color: sourcesClick.containsMouse ? Theme.fg : Theme.muted
          Accessible.ignored: true
        }
        Label {
          anchors { right: parent.right; rightMargin: Theme.s(4); verticalCenter: sourcesTitle.verticalCenter }
          text: view.sourcesOpen ? "󰅀" : "󰅂"  // md-chevron-down, md-chevron-right
          color: sourcesTitle.color
          font.pixelSize: Theme.fBody
          Accessible.ignored: true
        }
      }
      Hint {
        visible: !view.sourcesOpen
        text: Theme.t("settings.sourcesHint") + (view.spotify.seen ? ", Spotify" : "")
      }
      Column {
        visible: view.sourcesOpen
        width: parent.width
        spacing: Theme.s(2)

        SettingRow {
          label: Theme.t("settings.updateNews")
          Toggle {
            name: Theme.t("settings.updateNews")
            checked: view.values.updateNews
            onToggled: function(on) { view.settings.set("updateNews", on) }
          }
        }
        SettingRow {
          label: Theme.t("settings.longCommands")
          Toggle {
            name: Theme.t("settings.longCommands")
            checked: view.values.longCommands
            onToggled: function(on) { view.settings.setLongCommands(on) }
          }
        }
        Hint { text: view.settings.commands.note || Theme.t("settings.longCommandsHint") }
        Link {
          visible: view.settings.commands.line !== ""
          x: Theme.s(4)
          topPadding: Theme.s(4)
          text: Theme.t("settings.longCommandsCopy")
          onActivated: Quickshell.execDetached(["wl-copy", view.settings.commands.line])
        }

        // The feed's own sources (#164): saved into config.json "feed", the
        // feed reads it on its next run.
        Label {
          x: Theme.s(4)
          topPadding: Theme.s(10)
          width: parent.width - Theme.s(8)
          text: Theme.t("settings.kuma")
          wrapMode: Text.WordWrap
        }
        Row {
          x: Theme.s(4)
          topPadding: Theme.s(6)
          spacing: Theme.s(6)
          InputField {
            id: kumaField
            width: pageColumn.width - kumaSave.width - Theme.s(14)
            fieldHeight: kumaSave.height
            text: view.values.feed.kuma
            placeholder: "https://status.example.com/status/NAME"
            name: Theme.t("settings.kuma")
            onAccepted: view.settings.setKuma(text)
            onEdited: if (view.settings.kumaCheck === "invalid") view.settings.checkKuma()
          }
          ActionButton {
            id: kumaSave
            label: Theme.t("settings.kumaSave")
            enabled: kumaField.text.trim() !== view.values.feed.kuma
            onClicked: view.settings.setKuma(kumaField.text)
          }
        }
        Hint {
          readonly property var note: SettingsLogic.kumaNote(view.settings.kumaCheck, Theme.lang)
          topPadding: Theme.s(4)
          text: note.text
          problem: !!note.error
        }
        SettingRow {
          label: Theme.t("settings.github")
          Toggle {
            name: Theme.t("settings.github")
            checked: view.values.feed.github
            onToggled: function(on) { view.settings.setFeed("github", on) }
          }
        }
        Hint { text: Theme.t("settings.githubHint") }
        Hint {
          visible: view.values.feed.github && !view.settings.ghSignedIn
          text: Theme.t("settings.githubSignIn")
        }
        // The git clones the update watcher found (#224), one switch each, under
        // their own heading; a line where there is something to say (#225).
        // Clones with their own git settings are never watched: no switch (#232).
        SectionTitle {
          visible: view.values.updateNews && view.gitRepos.length > 0
          text: Theme.t("settings.gitSoftware")
          topPadding: Theme.s(12)
        }
        Repeater {
          model: view.values.updateNews ? view.gitRepos : []
          Column {
            id: gitRow
            required property var modelData
            width: parent.width
            SettingRow {
              label: gitRow.modelData.name
              hint: gitRow.modelData.path
              Toggle {
                visible: gitRow.modelData.watched
                width: visible ? Theme.s(38) : 0  // the label keeps the room (childrenRect counts hidden items)
                name: gitRow.modelData.name + ", " + gitRow.modelData.path
                checked: gitRow.modelData.on
                onToggled: function(on) { view.settings.setGitRepo(gitRow.modelData.path, on) }
              }
            }
            Hint {
              visible: gitRow.modelData.state !== ""
              text: gitRow.modelData.state ? Theme.t("settings.git." + gitRow.modelData.state) : ""
            }
          }
        }
        Hint {
          visible: view.values.updateNews && view.gitRepos.length > 0
          topPadding: Theme.s(4)
          text: Theme.t("settings.gitReposHint")
        }
        // Spotify's "+" in the player (#121, Spotify.qml): the user's own
        // Spotify app, signed in once in the browser. Only once a Spotify
        // player ran, or while connected (#163).
        SectionTitle { visible: view.spotify.seen; text: Theme.t("settings.spotify"); topPadding: Theme.s(12) }
        SettingRow {
          visible: view.spotify.connected
          label: Theme.t("settings.spotifyConnected")
          ActionButton { label: Theme.t("settings.spotifyDisconnect"); enabled: !view.spotify.disconnecting; onClicked: view.spotify.disconnect() }
        }
        Hint {
          visible: view.spotify.seen && !view.spotify.connected
          text: Theme.t("settings.spotifyHint", view.spotify.redirect)
        }
        Link {
          visible: view.spotify.seen && !view.spotify.connected && view.spotify.redirect !== ""
          x: Theme.s(4)
          topPadding: Theme.s(4)
          text: Theme.t("settings.spotifyCopy")
          onActivated: Quickshell.execDetached(["wl-copy", view.spotify.redirect])
        }
        Row {
          visible: view.spotify.seen && !view.spotify.connected && !view.spotify.connecting
          x: Theme.s(4)
          topPadding: Theme.s(8)
          spacing: Theme.s(6)
          InputField {
            id: clientField
            width: pageColumn.width - connectButton.width - Theme.s(14)
            fieldHeight: connectButton.height
            text: view.spotify.clientId
            placeholder: Theme.t("settings.spotifyClientId")
            onAccepted: if (text.trim() !== "") view.spotify.connect(text)
          }
          ActionButton {
            id: connectButton
            label: Theme.t("settings.spotifyConnect")
            strong: true
            enabled: clientField.text.trim() !== ""
            onClicked: view.spotify.connect(clientField.text)
          }
        }
        Row {
          visible: view.spotify.connecting
          x: Theme.s(4)
          topPadding: Theme.s(8)
          spacing: Theme.s(12)
          Label { text: Theme.t("settings.spotifyConnecting"); font.pixelSize: Theme.fCaption }
          Link { text: Theme.t("cancel"); onActivated: view.spotify.cancelConnect() }
        }
        Hint {
          visible: view.spotify.seen && !view.spotify.connected && !view.spotify.connecting && view.spotify.connectError !== ""
          topPadding: Theme.s(4)
          text: Theme.t(PlayerLogic.connectError(view.spotify.connectError))
          problem: true
        }
      }

      // Uninstalling: the setup takes everything back first, then Omarchy
      // removes the plugin (the other way round leaves dead hooks behind).
      SectionTitle { text: Theme.t("settings.remove"); topPadding: Theme.s(12) }
      SettingRow {
        visible: !view.removing
        label: Theme.t("settings.removeLabel")
        ActionButton { label: Theme.t("settings.removeAsk"); onClicked: view.removing = true }
      }
      Hint {
        visible: view.removing
        text: Theme.t("settings.removeQuestion")
        color: Theme.fg
      }
      Row {
        visible: view.removing
        x: Theme.s(4)
        topPadding: Theme.s(6)
        spacing: Theme.s(6)
        ActionButton { label: Theme.t("settings.removeNow"); strong: true; onClicked: view.uninstall() }
        ActionButton { label: Theme.t("cancel"); onClicked: view.removing = false }
      }
    }
  }
  ScrollFade { flick: page }

  // A note under a setting, muted or (a problem) in the urgent colour.
  component Hint: Label {
    property bool problem: false
    x: Theme.s(4)
    width: parent ? parent.width - Theme.s(8) : 0
    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
    color: problem ? Theme.urgent : Theme.muted
    font.pixelSize: Theme.fCaption
  }

  // Detached: removing the plugin restarts the shell, and this with it.
  function uninstall() {
    removing = false
    Quickshell.execDetached(["sh", "-c",
      "\"$1/bin/omarchy-buddy-setup\" --uninstall || notify-send -u critical \"$2\" \"$3\"",
      "sh", app.repo, Theme.t("settings.removeFailed"), Theme.t("settings.removeFailedBody")])
    app.opened = false
  }

  Item {
    width: parent.width
    height: fileNote.implicitHeight
    Label {
      id: fileNote
      x: Theme.s(4)
      width: parent.width - openLink.width - Theme.s(20)
      text: Theme.t("settings.more", "~/.config/omarchy-buddy/config.json")
      elide: Text.ElideMiddle
      color: Theme.muted
      font.pixelSize: Theme.fCaption
    }
    Link {
      id: openLink
      anchors.right: parent.right
      anchors.rightMargin: Theme.s(4)
      text: Theme.t("settings.open")
      onActivated: { view.settings.edit(); view.app.opened = false }
    }
  }
}
