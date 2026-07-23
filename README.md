# Team Manager

Run your team from Obsidian. Team Manager turns plain markdown notes into a
management workspace: a people dashboard with cadence health, 1:1s with an
agenda buffer that never loses a thought, projects on a Kanban board,
performance observations you jot down as they happen, and one universal quick
capture to file any of it in two keystrokes.

Everything is stored as ordinary markdown with YAML frontmatter — no database,
no lock-in. Turn the plugin off and your notes are still notes.

## Features

- **People dashboard** — cards grouped by relationship (team / peers /
  leadership / others), each with a colored cadence-health ring, days since the
  last 1:1, and counters for open items and active projects. Four views:
  People, 1:1s, Projects, Action items.
- **1:1s with an agenda buffer** — throughout the week, capture things to raise;
  they wait under a heading in the person's note. Starting a new 1:1 pulls them
  into the meeting and clears the buffer. Open action items (unchecked
  checkboxes) roll forward automatically.
- **Live context panel** — open a 1:1, person or project note and a side panel
  mirrors it: buffered agenda, open items, active projects with staleness, and
  the recent history — all expandable inline. A discreet toggle hides
  performance observations while screen-sharing.
- **Projects & Kanban** — a board with statuses as columns and owners as rows.
  Drag to change status; drag across rows to reassign. Configurable statuses.
- **Performance** — jot observations the moment you notice them; they accumulate
  and pre-fill the next review. Overdue-review nudges for your team.
- **Quick capture** — one command, one modal: pick the type (1:1 / observation /
  project log), the person or project, the destination, type the note. Fully
  keyboard-driven.
- **Live hubs in your notes** — a person note renders its own dashboard at the
  top via a `team-hub` code block; project notes get a `team-project` block.

## Install

### Community plugins (recommended, once approved)

Settings → Community plugins → Browse → search **Team Manager** → Install →
Enable.

### BRAT (beta, available now)

1. Install the **BRAT** plugin from Community plugins.
2. BRAT → *Add beta plugin* → paste `andyguy-dot/obsidian-team-manager`.
3. Enable **Team Manager** in Community plugins.

### Manual

Download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/andyguy-dot/obsidian-team-manager/releases/latest)
into `<vault>/.obsidian/plugins/team-manager/`, then enable it.

## Getting started

On first run the plugin creates a `Team Manager/` folder with `People/`,
`Meetings/`, `Performance/` and `Projects/` subfolders (all configurable in
settings). Open the dashboard from the ribbon (the people icon) or the command
**Open team dashboard**, then hit **＋ Person**.

A note is recognized only when it has the right `type` **and** lives in the
matching folder, so the rest of your vault is left untouched.

## Data model

Everything is frontmatter on normal notes.

**Person** — `People/Jane Doe.md`

```yaml
---
type: person
role: Staff Engineer
team: Platform
status: active
relation: team        # team | peer | manager | other
cadence: 14           # days, or weekly / biweekly / monthly
---
```

**1:1** — `Meetings/2026-07-16 Jane Doe.md`

```yaml
---
type: meeting
person: "[[Jane Doe]]"
date: 2026-07-16
---
```

**Project** — `Projects/Auth migration.md`

```yaml
---
type: project
status: in progress
people:
  - "[[Jane Doe]]"
priority: high
---
```

**Performance** — `Performance/Jane Doe - 2026-H1.md`

```yaml
---
type: performance
person: "[[Jane Doe]]"
period: 2026-H1
rating: Exceeds       # free text, not a fixed scale
---
```

## Commands

| Command | What it does |
| --- | --- |
| Open team dashboard | The main view |
| Quick capture | Type-first capture into any destination |
| New person / New 1:1 / New project / New performance note | Create notes |
| Add to next 1:1 | Buffer an agenda item for someone |
| Add project log entry | Timestamped update on a project |
| Insert hub block in this note | Add the live dashboard to a person/project note |
| Create folder structure | (Re)create the configured folders |

Bind **Quick capture** to a hotkey (Settings → Hotkeys) for two-keystroke
capture from anywhere in Obsidian.

## Mobile

Team Manager loads on mobile and quick capture, browsing and the hubs all work.
Drag-and-drop on the Kanban and right-click menus (delete, status change) are
desktop-only, since touch has neither — organize on desktop, capture anywhere.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production build
```

`main.js` is a build artifact and is git-ignored; releases are produced by the
GitHub Actions workflow when a version tag is pushed.

## License

[MIT](LICENSE) © André
