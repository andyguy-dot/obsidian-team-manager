import {
	Component,
	ItemView,
	Notice,
	ViewStateResult,
	WorkspaceLeaf,
} from "obsidian";
import type TeamManagerPlugin from "../main";
import {
	MeetingEntry,
	OpenItemGroup,
	relationLabel,
} from "../data";
import { runQuickCapture } from "../capture";
import { renderMeetingRow } from "./meetingRow";
import { ActionItem, Person, Project } from "../types";
import { initialsOf, nameHue } from "../avatar";
import { stalenessOf, statusLabel } from "../projectHelpers";
import { wirePersonMenu } from "../personActions";
import { wireProjectMenu as wireProjectMenuBase } from "../projectActions";
import { toggleTaskLine } from "../sections";

export const VIEW_TYPE_DASHBOARD = "team-manager-dashboard";

type DashMode = "people" | "meetings" | "projects" | "items";

const MODE_LABELS: Record<DashMode, string> = {
	people: "People",
	meetings: "1:1s",
	projects: "Projects",
	items: "Action items",
};

const SEARCH_PLACEHOLDERS: Record<DashMode, string> = {
	people: "Search name, role, team...",
	meetings: "Search person, date...",
	projects: "Search project, owner, priority...",
	items: "Search action items...",
};

type DashSort = "neglect" | "name" | "lastMeeting";
type ProjView = "board" | "list";

export class DashboardView extends ItemView {
	private mode: DashMode = "people";
	private projView: ProjView = "board";
	private sort: DashSort = "neglect";
	private search = "";
	private teamFilter = "";
	/** Person note path, or "" for all. Used by the 1:1s mode. */
	private personFilter = "";
	private hideInactive = false;
	/** Meeting paths the user expanded, kept across auto re-renders. */
	private openMeetings = new Set<string>();
	/** Owns the markdown previews of the current render pass. */
	private previews: Component | null = null;
	/**
	 * Optimistic board moves: project path → status just dropped on. The
	 * metadataCache lags the write by a beat, so without this the card would
	 * snap back to its old column before landing. Cleared once the store agrees.
	 */
	private pendingStatus = new Map<string, string>();
	/** Same optimistic trick for owner changes: project path → person paths. */
	private pendingPeople = new Map<string, string[]>();
	/** Board lanes the user expanded past the per-cell cap (key = person path). */
	private expandedLanes = new Set<string>();

	constructor(leaf: WorkspaceLeaf, private plugin: TeamManagerPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_DASHBOARD;
	}

	getDisplayText(): string {
		return "Team";
	}

	getIcon(): string {
		return "users";
	}

	getState(): Record<string, unknown> {
		return { mode: this.mode, projView: this.projView };
	}

	async setState(
		state: Record<string, unknown>,
		result: ViewStateResult
	): Promise<void> {
		if (state && typeof state.mode === "string" && state.mode in MODE_LABELS) {
			this.mode = state.mode as DashMode;
		}
		if (
			state &&
			(state.projView === "board" || state.projView === "list")
		) {
			this.projView = state.projView;
		}
		await super.setState(state, result);
		await this.render();
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async render(): Promise<void> {
		const root = this.contentEl;
		// Keep scroll position across the auto re-renders that typing triggers.
		const scrollTop = root.scrollTop;
		root.empty();
		root.addClass("tm-dashboard");
		this.resetPreviews();

		await this.plugin.store.refresh();
		this.reconcilePending();

		this.renderToolbar(root);
		this.renderMetrics(root);
		this.renderModeTabs(root);
		this.renderFilters(root);

		const wrap = root.createDiv({ cls: "tm-dash-content" });
		this.renderContent(wrap);
		root.scrollTop = scrollTop;
	}

	private renderContent(wrap: HTMLElement): void {
		wrap.empty();
		switch (this.mode) {
			case "meetings":
				this.renderMeetingsMode(wrap);
				break;
			case "projects":
				this.renderProjectsMode(wrap);
				break;
			case "items":
				this.renderItemsMode(wrap);
				break;
			case "people":
			default:
				this.renderPeopleMode(wrap);
		}
	}

	// --- Chrome -------------------------------------------------------------

	private renderToolbar(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "tm-toolbar" });
		bar.createEl("h2", { text: "Team", cls: "tm-title" });
		const actions = bar.createDiv({ cls: "tm-toolbar-actions" });
		const capture = actions.createEl("button", { text: "⚡ Capture" });
		capture.addClass("tm-btn-primary");
		capture.onclick = () => void runQuickCapture(this.plugin);
		actions.createEl("button", { text: "＋ Person" }).onclick = () =>
			this.plugin.commandNewPerson();
		actions.createEl("button", { text: "＋ 1:1" }).onclick = () =>
			this.plugin.commandNewMeeting();
		const refresh = actions.createEl("button", { text: "↻" });
		refresh.setAttr("aria-label", "Refresh");
		refresh.onclick = () => void this.render();
	}

	private renderMetrics(root: HTMLElement): void {
		const m = this.plugin.store.computeMetrics();
		const strip = root.createDiv({ cls: "tm-metrics" });
		this.metric(strip, String(m.total), "People", false);
		this.metric(strip, String(m.overdue), "1:1 overdue", m.overdue > 0);
		this.metric(
			strip,
			m.avgDaysSince == null ? "—" : `${m.avgDaysSince}d`,
			"Avg since 1:1",
			false
		);
		this.metric(strip, String(m.meetingsThisMonth), "1:1s this month", false);
		this.metric(
			strip,
			String(m.reviewsOverdue),
			"Reviews due",
			m.reviewsOverdue > 0
		);
	}

	private metric(
		strip: HTMLElement,
		value: string,
		label: string,
		warn: boolean
	): void {
		const card = strip.createDiv({ cls: "tm-metric" });
		const v = card.createDiv({ cls: "tm-metric-value", text: value });
		if (warn) v.addClass("tm-days-overdue");
		card.createDiv({ cls: "tm-metric-label", text: label });
	}

	private renderModeTabs(root: HTMLElement): void {
		const tabs = root.createDiv({ cls: "tm-tabs tm-dash-tabs" });
		for (const mode of Object.keys(MODE_LABELS) as DashMode[]) {
			const btn = tabs.createEl("button", {
				text: MODE_LABELS[mode],
				cls: this.mode === mode ? "tm-tab is-active" : "tm-tab",
			});
			btn.onclick = () => {
				this.mode = mode;
				// Persist the mode into the leaf state for workspace restore.
				void this.leaf.setViewState({
					type: VIEW_TYPE_DASHBOARD,
					active: true,
					state: this.getState(),
				});
			};
		}
	}

	private renderFilters(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "tm-filters" });

		const search = bar.createEl("input", { type: "text", cls: "tm-search" });
		search.placeholder = SEARCH_PLACEHOLDERS[this.mode];
		search.value = this.search;
		search.oninput = () => {
			this.search = search.value;
			const wrap = root.querySelector<HTMLElement>(".tm-dash-content");
			if (wrap) this.renderContent(wrap);
		};

		if (this.mode === "meetings") {
			this.renderPersonFilter(root, bar);
			return;
		}

		if (this.mode !== "people") return;

		const teamSel = bar.createEl("select", { cls: "tm-select" });
		teamSel.createEl("option", { text: "All teams", value: "" });
		for (const t of this.plugin.store.getTeams()) {
			const opt = teamSel.createEl("option", { text: t, value: t });
			if (t === this.teamFilter) opt.selected = true;
		}
		teamSel.onchange = () => {
			this.teamFilter = teamSel.value;
			this.rerenderContent(root);
		};

		const sortSel = bar.createEl("select", { cls: "tm-select" });
		const sortOptions: [DashSort, string][] = [
			["neglect", "Most neglected"],
			["name", "Name"],
			["lastMeeting", "Last 1:1"],
		];
		for (const [value, label] of sortOptions) {
			const opt = sortSel.createEl("option", { text: label, value });
			if (value === this.sort) opt.selected = true;
		}
		sortSel.onchange = () => {
			this.sort = sortSel.value as DashSort;
			this.rerenderContent(root);
		};

		const label = bar.createEl("label", { cls: "tm-check" });
		const cb = label.createEl("input", { type: "checkbox" });
		cb.checked = this.hideInactive;
		cb.onchange = () => {
			this.hideInactive = cb.checked;
			this.rerenderContent(root);
		};
		label.createSpan({ text: "Hide inactive" });
	}

	/** People who actually have 1:1s — an empty option would filter to nothing. */
	private renderPersonFilter(root: HTMLElement, bar: HTMLElement): void {
		const withMeetings = this.plugin.store
			.getPeople()
			.filter((p) => p.meetings.length > 0);

		// A filter pointing at a deleted/renamed person would hide everything.
		if (
			this.personFilter &&
			!withMeetings.some((p) => p.file.path === this.personFilter)
		) {
			this.personFilter = "";
		}

		const sel = bar.createEl("select", { cls: "tm-select" });
		sel.createEl("option", { text: "All people", value: "" });
		for (const p of withMeetings) {
			const opt = sel.createEl("option", {
				text: `${p.name} (${p.meetings.length})`,
				value: p.file.path,
			});
			if (p.file.path === this.personFilter) opt.selected = true;
		}
		sel.onchange = () => {
			this.personFilter = sel.value;
			this.rerenderContent(root);
		};
	}

	private rerenderContent(root: HTMLElement): void {
		const wrap = root.querySelector<HTMLElement>(".tm-dash-content");
		if (wrap) this.renderContent(wrap);
	}

	private searchMatch(...haystack: (string | undefined)[]): boolean {
		if (!this.search) return true;
		const q = this.search.toLowerCase();
		return haystack
			.filter(Boolean)
			.join(" ")
			.toLowerCase()
			.includes(q);
	}

	// --- Mode: People --------------------------------------------------------

	private matches(p: Person): boolean {
		if (this.hideInactive && p.status && p.status.toLowerCase() !== "active") {
			return false;
		}
		if (this.teamFilter && p.team !== this.teamFilter) return false;
		return this.searchMatch(p.name, p.role, p.team);
	}

	private sortedPeople(people: Person[]): Person[] {
		const arr = [...people];
		switch (this.sort) {
			case "name":
				return arr.sort((a, b) => a.name.localeCompare(b.name));
			case "lastMeeting":
				return arr.sort((a, b) =>
					(b.lastMeeting?.date ?? "").localeCompare(
						a.lastMeeting?.date ?? ""
					)
				);
			case "neglect":
			default:
				// Most neglected first: never met, then largest days/target ratio.
				return arr.sort((a, b) => {
					const ra =
						a.daysSinceLast == null
							? Infinity
							: a.daysSinceLast / this.plugin.store.cadenceTargetOf(a);
					const rb =
						b.daysSinceLast == null
							? Infinity
							: b.daysSinceLast / this.plugin.store.cadenceTargetOf(b);
					if (ra !== rb) return rb - ra;
					return a.name.localeCompare(b.name);
				});
		}
	}

	private renderPeopleMode(wrap: HTMLElement): void {
		const all = this.plugin.store.getPeople();
		if (all.length === 0) {
			const empty = wrap.createDiv({ cls: "tm-empty" });
			empty.createEl("p", {
				text: "No people yet. Create one to get started.",
			});
			empty.createEl("button", { text: "New person" }).onclick = () =>
				this.plugin.commandNewPerson();
			return;
		}

		const groups = this.plugin.store.getPeopleByRelation();
		let any = false;

		for (const [rel, all] of groups) {
			const members = this.sortedPeople(all.filter((p) => this.matches(p)));
			if (members.length === 0) continue;
			any = true;

			const section = wrap.createDiv({ cls: "tm-group" });
			section.createEl("div", {
				text: `${relationLabel(rel)} (${members.length})`,
				cls: "tm-group-title",
			});
			const grid = section.createDiv({ cls: "tm-cards" });
			for (const p of members) this.renderCard(grid, p);
		}

		if (!any) {
			wrap.createDiv({ cls: "tm-empty" }).setText(
				"No people match the filter."
			);
		}
	}

	private renderCard(grid: HTMLElement, p: Person): void {
		const health = this.plugin.store.getHealth(p);
		const card = grid.createDiv({
			cls: `tm-card tm-health-${health}`,
		});
		card.onclick = () => void this.plugin.openPerson(p.file);
		wirePersonMenu(this.plugin, card, p);

		const noteIcon = card.createEl("span", {
			text: "📄",
			cls: "tm-card-note",
		});
		noteIcon.setAttr("aria-label", "Open note");
		noteIcon.onclick = (e) => {
			e.stopPropagation();
			void this.app.workspace.getLeaf(false).openFile(p.file);
		};

		const top = card.createDiv({ cls: "tm-card-top" });
		const avatar = top.createDiv({ cls: "tm-avatar" });
		avatar.setText(initialsOf(p.name));
		avatar.style.setProperty("--tm-hue", String(nameHue(p.name)));

		const id = top.createDiv({ cls: "tm-card-id" });
		const nameRow = id.createDiv({ cls: "tm-card-name" });
		nameRow.createSpan({ text: p.name });
		if (p.status && p.status.toLowerCase() !== "active") {
			nameRow.createEl("span", { text: p.status, cls: "tm-status" });
		}
		const sub = [p.role, p.team].filter(Boolean).join(" · ");
		if (sub) id.createDiv({ text: sub, cls: "tm-card-sub tm-muted" });

		const chips = card.createDiv({ cls: "tm-chips" });
		const days = chips.createEl("span", {
			cls: `tm-chip tm-chip-days tm-chip-${health}`,
		});
		days.setText(p.daysSinceLast == null ? "never" : `${p.daysSinceLast}d`);
		days.setAttr(
			"aria-label",
			`Last 1:1 ${p.daysSinceLast ?? "—"} days ago (target ${this.plugin.store.cadenceTargetOf(p)}d)`
		);
		if (p.agendaItems.length > 0) {
			const c = chips.createEl("span", {
				text: `📥 ${p.agendaItems.length}`,
				cls: "tm-chip",
			});
			c.setAttr("aria-label", "Items buffered for the next 1:1");
		}
		if (p.openActionItems.length > 0) {
			const c = chips.createEl("span", {
				text: `☑ ${p.openActionItems.length}`,
				cls: "tm-chip tm-chip-warn",
			});
			c.setAttr("aria-label", "Open action items");
		}
		if (p.activeProjects.length > 0) {
			const c = chips.createEl("span", {
				text: `📁 ${p.activeProjects.length}`,
				cls: "tm-chip",
			});
			c.setAttr("aria-label", "Active projects");
		}
	}

	// --- Mode: 1:1s -----------------------------------------------------------

	private renderMeetingsMode(wrap: HTMLElement): void {
		const entries = this.plugin.store
			.getAllMeetings()
			.filter(
				(e) =>
					!this.personFilter ||
					e.person.file.path === this.personFilter
			)
			.filter((e) =>
				this.searchMatch(e.person.name, e.meeting.date, e.person.team)
			);

		if (entries.length === 0) {
			wrap.createDiv({ cls: "tm-empty" }).setText(
				this.search || this.personFilter
					? "No 1:1s match the filter."
					: "No 1:1s yet."
			);
			return;
		}

		for (const entry of entries) {
			this.renderMeetingRow(wrap, entry);
		}
	}

	private renderMeetingRow(wrap: HTMLElement, entry: MeetingEntry): void {
		const { meeting: m, person } = entry;
		renderMeetingRow({
			plugin: this.plugin,
			parent: wrap,
			file: m.file,
			cls: "tm-meet-row",
			openState: this.openMeetings,
			previewOwner: () => this.previewOwner(),
			buildSummary: (summary) => {
				summary.createEl("span", {
					text: m.date ?? "no date",
					cls: "tm-meet-date",
				});
				const who = summary.createEl("a", {
					text: person.name,
					cls: "tm-meet-person",
				});
				who.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					void this.plugin.openPerson(person.file);
				};
				const sub = [person.role, person.team]
					.filter(Boolean)
					.join(" · ");
				if (sub) {
					summary.createEl("span", {
						text: sub,
						cls: "tm-meet-sub tm-muted",
					});
				}
			},
		});
	}

	// --- Mode: Projects ---------------------------------------------------------

	private renderProjectsMode(wrap: HTMLElement): void {
		const projects = this.plugin.store.getProjects().filter((pr) => {
			const peopleNames = pr.peopleFiles
				.map((f) => this.plugin.store.getPerson(f)?.name)
				.filter((n): n is string => !!n);
			return this.searchMatch(
				pr.name,
				pr.status,
				pr.priority,
				...peopleNames
			);
		});

		const bar = wrap.createDiv({ cls: "tm-proj-bar" });
		const toggle = bar.createDiv({ cls: "tm-seg" });
		const views: [ProjView, string][] = [
			["board", "Board"],
			["list", "List"],
		];
		for (const [value, label] of views) {
			const btn = toggle.createEl("button", {
				text: label,
				cls: this.projView === value ? "tm-seg-btn is-active" : "tm-seg-btn",
			});
			btn.onclick = () => {
				this.projView = value;
				void this.leaf.setViewState({
					type: VIEW_TYPE_DASHBOARD,
					active: true,
					state: this.getState(),
				});
			};
		}
		const newBtn = bar.createEl("button", {
			text: "＋ New project",
			cls: "tm-inline-add tm-proj-new",
		});
		newBtn.onclick = () => this.plugin.newProjectFor(undefined);

		if (projects.length === 0) {
			wrap.createDiv({ cls: "tm-empty" }).setText(
				this.search ? "No projects match the search." : "No projects yet."
			);
			return;
		}

		if (this.projView === "board") {
			this.renderProjectsBoard(wrap, projects);
		} else {
			this.renderProjectsList(wrap, projects);
		}
	}

	/** Drop the optimistic overrides once the vault (via the store) agrees. */
	private reconcilePending(): void {
		for (const [path, status] of this.pendingStatus) {
			const pr = this.plugin.store.getProjectByPath(path);
			if (!pr || pr.status === status) this.pendingStatus.delete(path);
		}
		for (const [path, people] of this.pendingPeople) {
			const pr = this.plugin.store.getProjectByPath(path);
			if (!pr) {
				this.pendingPeople.delete(path);
				continue;
			}
			const current = pr.peopleFiles.map((f) => f.path);
			const same =
				current.length === people.length &&
				people.every((p) => current.includes(p));
			if (same) this.pendingPeople.delete(path);
		}
	}

	private effectiveStatus(project: Project): string {
		return this.pendingStatus.get(project.file.path) ?? project.status;
	}

	private effectivePeoplePaths(project: Project): string[] {
		return (
			this.pendingPeople.get(project.file.path) ??
			project.peopleFiles.map((f) => f.path)
		);
	}

	private isActiveEff(project: Project): boolean {
		return !this.plugin.settings.closedProjectStatuses.includes(
			this.effectiveStatus(project)
		);
	}

	/** The shared project menu, reading through this view's optimistic state. */
	private wireProjectMenu(el: HTMLElement, project: Project): void {
		wireProjectMenuBase(this.plugin, el, project, {
			currentStatus: (p) => this.effectiveStatus(p),
			onStatus: (p, status) => void this.moveProject(p, status),
			isActive: (p) => this.isActiveEff(p),
		});
	}

	/** Context menu / list view: change status without touching owners. */
	private moveProject(project: Project, status: string): Promise<void> {
		return this.dropProject(project, status, null, null, false);
	}

	/**
	 * Apply a board drop: the column sets the status, the lane sets the owner.
	 * Crossing lanes *moves* ownership (leaves the source lane, joins the target
	 * one) so a shared project keeps its other owners — dropping on Carla can't
	 * mean "and also drop Ana". Hold Ctrl/Cmd to add an owner instead of moving.
	 */
	private async dropProject(
		project: Project,
		status: string,
		fromPersonPath: string | null,
		toPersonPath: string | null,
		copy: boolean
	): Promise<void> {
		const current = this.effectivePeoplePaths(project);
		let next = [...current];
		if (toPersonPath !== fromPersonPath) {
			if (!copy && fromPersonPath) {
				next = next.filter((p) => p !== fromPersonPath);
			}
			if (toPersonPath && !next.includes(toPersonPath)) {
				next.push(toPersonPath);
			}
		}

		const statusChanged = this.effectiveStatus(project) !== status;
		const peopleChanged =
			next.length !== current.length ||
			next.some((p) => !current.includes(p));
		if (!statusChanged && !peopleChanged) return;

		if (statusChanged) this.pendingStatus.set(project.file.path, status);
		if (peopleChanged) this.pendingPeople.set(project.file.path, next);
		const wrap = this.contentEl.querySelector<HTMLElement>(".tm-dash-content");
		if (wrap) this.renderContent(wrap);

		try {
			await this.app.fileManager.processFrontMatter(
			project.file,
			(fm: { status?: unknown; people?: unknown }) => {
				if (statusChanged) fm.status = status;
				if (peopleChanged) {
					fm.people = next.map((p) => {
						const person = this.plugin.store.getPersonByPath(p);
						return `[[${person?.name ?? p}]]`;
					});
				}
			});
		} catch (err) {
			this.pendingStatus.delete(project.file.path);
			this.pendingPeople.delete(project.file.path);
			new Notice(`Couldn't move ${project.name}.`);
			console.error("[team-manager] project move failed", err);
			if (wrap) this.renderContent(wrap);
		}
	}

	private renderProjectsList(wrap: HTMLElement, projects: Project[]): void {
		const statuses = this.plugin.store.getProjectStatuses();
		const byStatus = new Map<string, Project[]>();
		for (const pr of projects) {
			const s = this.effectiveStatus(pr);
			if (!byStatus.has(s)) byStatus.set(s, []);
			byStatus.get(s)?.push(pr);
		}

		for (const status of statuses) {
			const group = byStatus.get(status);
			if (!group || group.length === 0) continue;
			const section = wrap.createDiv({ cls: "tm-group" });
			section.createEl("div", {
				text: `${statusLabel(status)} (${group.length})`,
				cls: "tm-group-title",
			});
			for (const pr of group) this.renderProjectRow(section, pr);
		}
	}

	private renderProjectsBoard(wrap: HTMLElement, projects: Project[]): void {
		const statuses = this.plugin.store.getProjectStatuses();

		interface Lane {
			label: string;
			/** Person note path; null for the unassigned lane. */
			personPath: string | null;
			person?: Person;
			projects: Project[];
		}
		// Everyone gets a lane, even with no projects: an empty lane is still a
		// drop target, and without it you couldn't assign anything to them.
		const lanes: Lane[] = [];
		const placed = new Set<string>();
		for (const p of this.plugin.store.getPeople()) {
			const own = projects.filter((pr) =>
				this.effectivePeoplePaths(pr).includes(p.file.path)
			);
			own.forEach((pr) => placed.add(pr.file.path));
			lanes.push({
				label: p.name,
				personPath: p.file.path,
				person: p,
				projects: own,
			});
		}
		// Anything no lane claimed (no owner, or an owner that isn't a person).
		const orphans = projects.filter((pr) => !placed.has(pr.file.path));
		if (orphans.length > 0) {
			lanes.push({ label: "No owner", personPath: null, projects: orphans });
		}

		const scroll = wrap.createDiv({ cls: "tm-board-scroll" });
		const board = scroll.createDiv({ cls: "tm-board" });
		board.style.setProperty("--tm-board-cols", String(statuses.length));

		board.createDiv({ cls: "tm-board-corner" });
		for (const status of statuses) {
			board.createDiv({
				text: statusLabel(status),
				cls: "tm-board-colhead",
			});
		}

		const LANE_CAP = 3;
		for (const lane of lanes) {
			const laneKey = lane.personPath ?? "__orphans__";
			const expanded = this.expandedLanes.has(laneKey);

			const head = board.createDiv({ cls: "tm-board-lanehead" });
			if (lane.person) {
				const avatar = head.createDiv({ cls: "tm-avatar tm-avatar-sm" });
				avatar.setText(initialsOf(lane.label));
				avatar.style.setProperty("--tm-hue", String(nameHue(lane.label)));
				const nameLink = head.createEl("a", {
					text: lane.label,
					cls: "tm-board-lanename",
				});
				const pf = lane.person.file;
				nameLink.onclick = (e) => {
					e.preventDefault();
					void this.plugin.openPerson(pf);
				};
			} else {
				head.createEl("span", {
					text: lane.label,
					cls: "tm-board-lanename tm-muted",
				});
			}

			for (const status of statuses) {
				const cell = board.createDiv({ cls: "tm-board-cell" });
				cell.dataset.status = status;
				this.wireDropTarget(board, cell, status, lane.personPath);

				const cards = lane.projects.filter(
					(x) => this.effectiveStatus(x) === status
				);
				const shown = expanded ? cards : cards.slice(0, LANE_CAP);
				for (const pr of shown) {
					this.renderBoardCard(cell, pr, lane.personPath);
				}
				// Expand / collapse control lives in the cell that overflows,
				// but toggles the whole lane (rows share a height).
				if (cards.length > LANE_CAP) {
					const btn = cell.createEl("button", {
						text: expanded
							? "Show less"
							: `+${cards.length - LANE_CAP} more`,
						cls: "tm-board-more",
					});
					btn.onclick = (e) => {
						e.stopPropagation();
						if (expanded) this.expandedLanes.delete(laneKey);
						else this.expandedLanes.add(laneKey);
						this.rerenderBoard();
					};
				}
			}
		}
	}

	/** Re-render the projects board, keeping the horizontal scroll position. */
	private rerenderBoard(): void {
		const wrap = this.contentEl.querySelector<HTMLElement>(
			".tm-dash-content"
		);
		if (!wrap) return;
		const prev =
			wrap.querySelector<HTMLElement>(".tm-board-scroll")?.scrollLeft ?? 0;
		this.renderContent(wrap);
		const sc = wrap.querySelector<HTMLElement>(".tm-board-scroll");
		if (sc) sc.scrollLeft = prev;
	}

	/**
	 * Both axes now count: the column is the status, the lane is the owner —
	 * so only the exact cell under the cursor lights up.
	 */
	private wireDropTarget(
		board: HTMLElement,
		cell: HTMLElement,
		status: string,
		lanePersonPath: string | null
	): void {
		const clearTargets = () => {
			board
				.querySelectorAll<HTMLElement>(".tm-board-cell.is-drop-target")
				.forEach((c) => c.removeClass("is-drop-target"));
		};

		cell.addEventListener("dragover", (e) => {
			if (!e.dataTransfer) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? "copy" : "move";
			// Clearing every pass beats tracking dragleave across child cards.
			clearTargets();
			cell.addClass("is-drop-target");
		});
		cell.addEventListener("drop", (e) => {
			e.preventDefault();
			clearTargets();
			const raw = e.dataTransfer?.getData("text/plain");
			if (!raw) return;
			let payload: { path: string; from: string | null };
			try {
				payload = JSON.parse(raw) as {
					path: string;
					from: string | null;
				};
			} catch {
				return;
			}
			if (typeof payload.path !== "string") return;
			const project = this.plugin.store.getProjectByPath(payload.path);
			if (!project) return;
			void this.dropProject(
				project,
				status,
				payload.from,
				lanePersonPath,
				e.ctrlKey || e.metaKey
			);
		});
	}

	private renderBoardCard(
		cell: HTMLElement,
		project: Project,
		lanePersonPath: string | null
	): void {
		const active = this.isActiveEff(project);
		const card = cell.createDiv({ cls: "tm-board-card" });
		card.onclick = () => {
			void this.app.workspace.getLeaf(false).openFile(project.file);
		};
		this.wireProjectMenu(card, project);

		card.draggable = true;
		card.addEventListener("dragstart", (e) => {
			// The source lane travels with the card: a cross-lane drop has to
			// know which owner to replace on a project with several.
			e.dataTransfer?.setData(
				"text/plain",
				JSON.stringify({ path: project.file.path, from: lanePersonPath })
			);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
			card.addClass("is-dragging");
		});
		card.addEventListener("dragend", () => {
			card.removeClass("is-dragging");
			// ownerDocument, not document: the view may live in a popout window.
			cell.ownerDocument
				.querySelectorAll<HTMLElement>(".tm-board-cell.is-drop-target")
				.forEach((c) => c.removeClass("is-drop-target"));
		});

		const titleRow = card.createDiv({ cls: "tm-board-card-title" });
		if (active) {
			const dot = titleRow.createEl("span", { cls: "tm-proj-dot" });
			dot.addClass(`tm-stale-${stalenessOf(project)}`);
		}
		titleRow.createSpan({ text: project.name });

		const meta = card.createDiv({ cls: "tm-board-card-meta" });
		if (project.priority) {
			meta.createEl("span", { text: project.priority, cls: "tm-pill" });
		}
		meta.createEl("span", {
			text:
				project.daysSinceLastLog == null
					? "no log"
					: `${project.daysSinceLastLog}d`,
			cls: "tm-muted",
		});
		if (active) {
			const logBtn = meta.createEl("button", {
				text: "＋",
				cls: "tm-proj-log-btn",
			});
			logBtn.setAttr("aria-label", "Add update");
			logBtn.onclick = (e) => {
				e.stopPropagation();
				this.plugin.addProjectLogFor(project);
			};
		}
	}

	private renderProjectRow(section: HTMLElement, project: Project): void {
		const row = section.createDiv({ cls: "tm-proj-row tm-proj-row-dash" });
		const active = this.isActiveEff(project);
		this.wireProjectMenu(row, project);

		const dot = row.createEl("span", { cls: "tm-proj-dot" });
		if (active) {
			dot.addClass(`tm-stale-${stalenessOf(project)}`);
		}

		const main = row.createDiv({ cls: "tm-proj-main" });
		const titleRow = main.createDiv({ cls: "tm-proj-titlerow" });
		const nameLink = titleRow.createEl("a", {
			text: project.name,
			cls: "tm-proj-name",
		});
		nameLink.onclick = (e) => {
			e.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(project.file);
		};
		if (project.priority) {
			titleRow.createEl("span", { text: project.priority, cls: "tm-pill" });
		}

		const people = project.peopleFiles
			.map((f) => this.plugin.store.getPerson(f))
			.filter((p): p is Person => !!p);
		if (people.length > 0) {
			const who = main.createDiv({ cls: "tm-proj-people" });
			people.forEach((p, i) => {
				if (i > 0) who.createSpan({ text: ", ", cls: "tm-muted" });
				const link = who.createEl("a", {
					text: p.name,
					cls: "tm-proj-person",
				});
				link.onclick = (e) => {
					e.preventDefault();
					void this.plugin.openPerson(p.file);
				};
			});
		}

		const update = main.createDiv({ cls: "tm-proj-update tm-muted" });
		if (project.lastLogDate) {
			update.setText(
				`${project.lastLogDate} — ${project.lastLogText || "(sem texto)"}`
			);
		} else {
			update.setText("no updates yet");
		}

		const side = row.createDiv({ cls: "tm-proj-side" });
		side.createEl("span", {
			text:
				project.daysSinceLastLog == null
					? "—"
					: `${project.daysSinceLastLog}d`,
			cls: "tm-proj-meta tm-muted",
		});
		if (active) {
			const logBtn = side.createEl("button", {
				text: "＋ Update",
				cls: "tm-proj-log-btn",
			});
			logBtn.onclick = () => this.plugin.addProjectLogFor(project);
		}
	}

	// --- Mode: Action items -----------------------------------------------------

	private renderItemsMode(wrap: HTMLElement): void {
		const groups = this.plugin.store
			.getOpenItemGroups()
			.map((g) => ({
				...g,
				items: g.items.filter((it) =>
					this.searchMatch(it.text, g.label)
				),
			}))
			.filter((g) => g.items.length > 0);

		if (groups.length === 0) {
			wrap.createDiv({ cls: "tm-empty" }).setText(
				this.search
					? "No action items match the search."
					: "Nothing open. 🎉"
			);
			return;
		}

		for (const group of groups) {
			this.renderItemGroup(wrap, group);
		}
	}

	private renderItemGroup(wrap: HTMLElement, group: OpenItemGroup): void {
		const section = wrap.createDiv({ cls: "tm-group" });
		const head = section.createDiv({ cls: "tm-group-title tm-item-head" });
		const label = head.createEl("a", {
			text: `${group.kind === "project" ? "📁 " : ""}${group.label} (${group.items.length})`,
		});
		label.onclick = (e) => {
			e.preventDefault();
			if (group.kind === "person") {
				void this.plugin.openPerson(group.file);
			} else {
				void this.app.workspace.getLeaf(false).openFile(group.file);
			}
		};

		const list = section.createEl("ul", { cls: "tm-ctx-items" });
		for (const item of group.items) {
			const li = list.createEl("li", { cls: "tm-ctx-item" });
			const cb = li.createEl("input", { type: "checkbox" });
			cb.onchange = () => void this.toggleItem(item);
			const text = li.createEl("span", { text: item.text });
			text.onclick = (e) => {
				e.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(item.file);
			};
			if (item.meetingDate) {
				li.createEl("span", {
					text: item.meetingDate,
					cls: "tm-ctx-date",
				});
			}
		}
	}

	// --- Helpers ------------------------------------------------------------

	private async toggleItem(item: ActionItem): Promise<void> {
		await toggleTaskLine(this.app, item.file, item.line);
		await this.render();
	}

	/** Discard the previous render's markdown children before rebuilding. */
	private resetPreviews(): void {
		if (this.previews) this.removeChild(this.previews);
		this.previews = null;
	}

	private previewOwner(): Component {
		if (!this.previews) {
			this.previews = new Component();
			this.addChild(this.previews);
		}
		return this.previews;
	}
}
