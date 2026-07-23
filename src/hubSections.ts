import { App, Component } from "obsidian";
import type TeamManagerPlugin from "./main";
import { ActionItem, Person, Project } from "./types";
import { renderMeetingRow } from "./views/meetingRow";
import { stalenessOf } from "./projectHelpers";
import { renderStatusPill, wireProjectMenu } from "./projectActions";
import { toggleTaskLine } from "./sections";
import { runQuickCaptureFor } from "./capture";

/**
 * Everything a hub section needs to render itself. Shared by the person hub
 * tab (PersonDetailView) and the `team-hub` block embedded in person notes,
 * so both surfaces stay identical by construction.
 */
export interface HubContext {
	app: App;
	plugin: TeamManagerPlugin;
	person: Person;
	/** Component owning markdown previews for the current render pass. */
	previewOwner: () => Component;
	/** Expanded meeting paths, owned by the caller so state survives renders. */
	openMeetings: Set<string>;
	/** Re-render the surface after an in-place edit. */
	rerender: () => void;
}

export function hubSection(root: HTMLElement, title: string): HTMLElement {
	const sec = root.createDiv({ cls: "tm-ctx-section" });
	sec.createEl("h4", { text: title });
	return sec;
}

// --- Actions ---------------------------------------------------------------

/** Returns the actions row so callers can append surface-specific buttons. */
export function renderHubActions(
	ctx: HubContext,
	root: HTMLElement
): HTMLElement {
	const { plugin, person } = ctx;
	const actions = root.createDiv({ cls: "tm-person-actions" });
	const btn = (label: string, onClick: () => void) => {
		const b = actions.createEl("button", { text: label });
		b.onclick = onClick;
		return b;
	};
	btn("⚡ Capture", () => runQuickCaptureFor(plugin, person)).addClass(
		"tm-btn-primary"
	);
	btn("＋ 1:1", () => plugin.newMeetingFor(person.file));
	btn("＋ Performance", () => plugin.newPerformanceFor(person.file));
	return actions;
}

// --- Stats -----------------------------------------------------------------

export function renderHubStats(ctx: HubContext, root: HTMLElement): void {
	const { plugin, person } = ctx;
	const grid = root.createDiv({ cls: "tm-stats" });
	const overdue = plugin.store.isOverdue(person);
	const target = plugin.store.cadenceTargetOf(person);

	const stat = (label: string, value: string, warn: boolean) => {
		const card = grid.createDiv({ cls: "tm-stat" });
		const v = card.createDiv({ cls: "tm-stat-value", text: value });
		if (warn) v.addClass("tm-days-overdue");
		card.createDiv({ cls: "tm-stat-label", text: label });
	};

	stat("Last 1:1", person.lastMeeting?.date ?? "never", overdue);
	stat(
		"Days since",
		person.daysSinceLast == null ? "—" : `${person.daysSinceLast}d`,
		overdue
	);
	stat(
		"Cadence",
		person.cadenceDays == null
			? `target ${target}d`
			: `target ${target}d · actual ~${person.cadenceDays}d`,
		false
	);
	stat("1:1s", String(person.meetings.length), false);
	stat(
		"Open items",
		String(person.openActionItems.length),
		person.openActionItems.length > 0
	);
	stat("Projects", String(person.activeProjects.length), false);
}

// --- Open action items -------------------------------------------------------

export function renderHubOpenItems(ctx: HubContext, root: HTMLElement): void {
	const { person } = ctx;
	const sec = hubSection(
		root,
		`Open action items (${person.openActionItems.length})`
	);
	if (person.openActionItems.length === 0) {
		sec.createDiv({ cls: "tm-muted" }).setText("Nothing open. 🎉");
		return;
	}
	const list = sec.createEl("ul", { cls: "tm-ctx-items" });
	for (const item of person.openActionItems) {
		renderActionItem(ctx, list, item);
	}
}

export function renderActionItem(
	ctx: HubContext,
	list: HTMLElement,
	item: ActionItem
): void {
	const li = list.createEl("li", { cls: "tm-ctx-item" });
	const cb = li.createEl("input", { type: "checkbox" });
	cb.onchange = async () => {
		await toggleTaskLine(ctx.app, item.file, item.line);
		ctx.rerender();
	};
	const label = li.createEl("span", { text: item.text });
	label.onclick = (e) => {
		e.preventDefault();
		ctx.app.workspace.getLeaf(false).openFile(item.file);
	};
	if (item.meetingDate) {
		li.createEl("span", { text: item.meetingDate, cls: "tm-ctx-date" });
	}
}

// --- Projects ----------------------------------------------------------------

export function renderHubProjects(
	ctx: HubContext,
	root: HTMLElement,
	opts: { showNew?: boolean } = {}
): void {
	const { plugin, person } = ctx;
	const sec = hubSection(root, `Projects (${person.projects.length})`);
	if (person.projects.length === 0) {
		sec.createDiv({ cls: "tm-muted" }).setText("No projects yet.");
	}
	for (const project of person.projects) {
		renderHubProjectRow(ctx, sec, project);
	}
	if (opts.showNew !== false) {
		const add = sec.createEl("button", {
			text: "＋ New project",
			cls: "tm-inline-add",
		});
		add.onclick = () => plugin.newProjectFor(person);
	}
}

function renderHubProjectRow(
	ctx: HubContext,
	sec: HTMLElement,
	project: Project
): void {
	const { app, plugin } = ctx;
	const row = sec.createDiv({ cls: "tm-proj-row" });
	const active = plugin.store.isProjectActive(project);
	wireProjectMenu(plugin, row, project);

	const dot = row.createEl("span", { cls: "tm-proj-dot" });
	if (active) dot.addClass(`tm-stale-${stalenessOf(project)}`);

	const nameLink = row.createEl("a", {
		text: project.name,
		cls: "tm-proj-name",
	});
	nameLink.onclick = (e) => {
		e.preventDefault();
		app.workspace.getLeaf(false).openFile(project.file);
	};

	renderStatusPill(plugin, row, project);
	if (project.priority) {
		row.createEl("span", { text: project.priority, cls: "tm-pill" });
	}

	const meta = row.createEl("span", { cls: "tm-proj-meta tm-muted" });
	meta.setText(
		project.daysSinceLastLog == null
			? "no log"
			: `last log ${project.daysSinceLastLog}d ago`
	);

	if (active) {
		const logBtn = row.createEl("button", {
			text: "＋ Log",
			cls: "tm-proj-log-btn",
		});
		logBtn.onclick = () => plugin.addProjectLogFor(project);
	}
}

// --- Meetings ----------------------------------------------------------------

export function renderHubMeetings(
	ctx: HubContext,
	root: HTMLElement,
	opts: { limit?: number; title?: string } = {}
): void {
	const { plugin, person } = ctx;
	const all = person.meetings;
	const shown = opts.limit == null ? all : all.slice(0, opts.limit);
	const title =
		opts.title ??
		(opts.limit != null && all.length > shown.length
			? `Recent 1:1s (${shown.length} of ${all.length})`
			: `1:1 timeline (${all.length})`);

	const sec = hubSection(root, title);
	if (all.length === 0) {
		sec.createDiv({ cls: "tm-muted" }).setText("No 1:1s yet.");
		return;
	}
	for (const m of shown) {
		renderMeetingRow({
			plugin,
			parent: sec,
			file: m.file,
			openState: ctx.openMeetings,
			previewOwner: ctx.previewOwner,
			buildSummary: (summary) => {
				summary.createEl("span", {
					text: m.date ?? m.file.basename,
					cls: "tm-meet-date",
				});
			},
		});
	}
}
