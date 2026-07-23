import {
	Component,
	ItemView,
	ViewStateResult,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import type TeamManagerPlugin from "../main";
import { renderRelationPill } from "../personActions";
import { wireNoteMenu } from "../noteActions";
import {
	HubContext,
	hubSection,
	renderActionItem,
	renderHubMeetings,
	renderHubProjects,
	renderHubStats,
} from "../hubSections";
import { renderMeetingRow } from "./meetingRow";
import { runQuickCaptureFor } from "../capture";
import { renderAvatar } from "../avatar";
import { stalenessOf } from "../projectHelpers";
import { renderStatusPill, wireProjectMenu } from "../projectActions";
import { Person } from "../types";

export const VIEW_TYPE_PERSON = "team-manager-person";

type HubTab = "overview" | "meetings" | "projects" | "performance";

const TAB_LABELS: Record<HubTab, string> = {
	overview: "Overview",
	meetings: "1:1s",
	projects: "Projects",
	performance: "Performance",
};

export class PersonDetailView extends ItemView {
	private personPath: string | null = null;
	private tab: HubTab = "overview";
	/** Owns the markdown previews of the current render pass. */
	private previews: Component | null = null;
	/** Meeting paths the user expanded, kept across auto re-renders. */
	private openMeetings = new Set<string>();
	/** Horizontal scroll of the people carousel, kept across re-renders. */
	private carouselScroll = 0;
	/** The person shown last render, to detect an actual switch. */
	private lastPersonPath: string | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: TeamManagerPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PERSON;
	}

	getDisplayText(): string {
		const p = this.personPath
			? this.plugin.store.getPersonByPath(this.personPath)
			: null;
		return p ? p.name : "Person";
	}

	getIcon(): string {
		return "user";
	}

	/** Lets the context panel follow this tab when it becomes active. */
	getPersonPath(): string | null {
		return this.personPath;
	}

	getState(): Record<string, unknown> {
		return {
			personPath: this.personPath ?? undefined,
			tab: this.tab,
		};
	}

	async setState(
		state: Record<string, unknown>,
		result: ViewStateResult
	): Promise<void> {
		if (state && typeof state.personPath === "string") {
			this.personPath = state.personPath;
		}
		if (state && typeof state.tab === "string" && state.tab in TAB_LABELS) {
			this.tab = state.tab as HubTab;
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
		root.addClass("tm-person");
		this.resetPreviews();

		if (!this.personPath) {
			root.createDiv({ cls: "tm-empty" }).setText("No person selected.");
			return;
		}

		await this.plugin.store.refresh();
		const person = this.plugin.store.getPersonByPath(this.personPath);
		if (!person) {
			root.createDiv({ cls: "tm-empty" }).setText(
				"This person note no longer exists."
			);
			return;
		}

		const switched = this.lastPersonPath !== this.personPath;

		this.renderTopBar(root, person);
		this.renderCarousel(root, person, switched);

		const ctx = this.hubContext(person);
		this.renderHeader(root, person);
		this.renderTabs(root);

		switch (this.tab) {
			case "meetings":
				this.renderTabAction(root, "＋ New 1:1", () =>
					void this.plugin.newMeetingFor(person.file)
				);
				renderHubMeetings(ctx, root);
				break;
			case "projects":
				this.renderTabAction(root, "＋ New project", () =>
					this.plugin.newProjectFor(person)
				);
				renderHubProjects(ctx, root, { showNew: false });
				break;
			case "performance":
				this.renderTabAction(root, "＋ New review", () =>
					this.plugin.newPerformanceFor(person.file)
				);
				this.renderPerformance(root, person);
				break;
			case "overview":
			default:
				this.renderOverview(root, person, ctx);
		}
		// A person switch starts fresh at the top; an auto-refresh keeps place.
		root.scrollTop = switched ? 0 : scrollTop;
		this.lastPersonPath = this.personPath;
	}

	/** Top bar: back-to-dashboard on the left, quick Capture on the right. */
	private renderTopBar(root: HTMLElement, person: Person): void {
		const bar = root.createDiv({ cls: "tm-hub-topbar" });

		const home = bar.createEl("button", { cls: "tm-home-btn" });
		setIcon(home.createSpan({ cls: "tm-home-icon" }), "chevron-left");
		home.createSpan({ text: "Team" });
		home.setAttr("aria-label", "Back to team dashboard");
		home.onclick = () => void this.plugin.activateDashboard();

		const capture = bar.createEl("button", {
			text: "⚡ Capture",
			cls: "tm-btn-primary tm-topbar-capture",
		});
		capture.onclick = () => void runQuickCaptureFor(this.plugin, person);
	}

	/** Horizontal strip of every person, to jump the hub between them. */
	private renderCarousel(
		root: HTMLElement,
		current: Person,
		switched: boolean
	): void {
		const people = this.plugin.store.getPeople();
		if (people.length <= 1) return;

		const strip = root.createDiv({ cls: "tm-carousel" });
		strip.addEventListener("scroll", () => {
			this.carouselScroll = strip.scrollLeft;
		});

		let activeEl: HTMLElement | null = null;
		for (const p of people) {
			const isActive = p.file.path === current.file.path;
			const card = strip.createDiv({
				cls: isActive ? "tm-cara-card is-active" : "tm-cara-card",
			});
			const avatar = renderAvatar(card, p.name, false);
			avatar.addClass(`tm-health-${this.plugin.store.getHealth(p)}`);
			card.createDiv({ cls: "tm-cara-name", text: p.name });
			if (isActive) {
				activeEl = card;
			} else {
				card.onclick = () => this.switchPerson(p.file.path);
			}
		}

		// On a switch, center the newly active card; otherwise keep the scroll.
		if (switched && activeEl) {
			this.carouselScroll =
				activeEl.offsetLeft -
				strip.clientWidth / 2 +
				activeEl.offsetWidth / 2;
		}
		strip.scrollLeft = this.carouselScroll;
	}

	private switchPerson(path: string): void {
		this.personPath = path;
		void this.leaf.setViewState({
			type: VIEW_TYPE_PERSON,
			active: true,
			state: this.getState(),
		});
		// setViewState fires neither file-open nor active-leaf-change, so the
		// context panel wouldn't follow — tell it directly.
		void this.plugin.revealPersonContext(path);
	}

	private hubContext(person: Person): HubContext {
		return {
			app: this.app,
			plugin: this.plugin,
			person,
			previewOwner: () => this.previewOwner(),
			openMeetings: this.openMeetings,
			rerender: () => void this.render(),
		};
	}

	// --- Chrome ------------------------------------------------------------

	private renderHeader(root: HTMLElement, person: Person): void {
		const head = root.createDiv({ cls: "tm-person-header" });
		const titleRow = head.createDiv({ cls: "tm-person-titlerow" });
		titleRow.createEl("h1", { text: person.name, cls: "tm-person-name" });
		renderRelationPill(this.plugin, titleRow, person);
		if (person.status && person.status.toLowerCase() !== "active") {
			titleRow.createEl("span", { text: person.status, cls: "tm-status" });
		}
		const sub = [person.role, person.team].filter(Boolean).join(" · ");
		if (sub) head.createEl("div", { text: sub, cls: "tm-muted" });

		// The create actions live inside the overview sections now; the header
		// keeps only the link to the raw note.
		const actions = head.createDiv({ cls: "tm-person-actions" });
		const openNote = actions.createEl("a", {
			text: "📄 Open note",
			cls: "tm-ctx-link",
		});
		openNote.onclick = (e) => {
			e.preventDefault();
			void this.app.workspace.getLeaf(false).openFile(person.file);
		};
	}

	/** A right-aligned primary action at the top of a tab's content. */
	private renderTabAction(
		root: HTMLElement,
		label: string,
		onClick: () => void
	): void {
		const bar = root.createDiv({ cls: "tm-tab-action" });
		const b = bar.createEl("button", {
			text: label,
			cls: "tm-tile-btn mod-primary",
		});
		b.onclick = onClick;
	}

	private setTab(tab: HubTab): void {
		this.tab = tab;
		// Persist tab into the leaf state so workspace restore keeps it.
		void this.leaf.setViewState({
			type: VIEW_TYPE_PERSON,
			active: true,
			state: this.getState(),
		});
	}

	private renderTabs(root: HTMLElement): void {
		const tabs = root.createDiv({ cls: "tm-tabs" });
		const visible: HubTab[] = [
			"overview",
			"meetings",
			"projects",
			"performance",
		];
		for (const t of visible) {
			const btn = tabs.createEl("button", {
				text: TAB_LABELS[t],
				cls: this.tab === t ? "tm-tab is-active" : "tm-tab",
			});
			btn.onclick = () => this.setTab(t);
		}
	}

	// --- Tabs ----------------------------------------------------------------

	/**
	 * The overview is the pre-meeting briefing: everything the plugin knows
	 * about this person, arranged by "what do I need right now" — prep for
	 * the next 1:1 first, then recency, rhythm, projects and performance.
	 */
	private renderOverview(
		root: HTMLElement,
		person: Person,
		ctx: HubContext
	): void {
		renderHubStats(ctx, root);

		// One section per domain, so the page reads as chapters: the 1:1
		// briefing first, then projects, then performance.
		const meet = this.ovSection(root, "1:1s");
		const grid = meet.createDiv({ cls: "tm-ov-grid" });
		this.renderPrepTile(grid, person, ctx);
		this.renderRhythmTile(grid, person);
		this.renderRecentTile(grid, person, ctx).addClass("tm-ov-span");

		const proj = this.ovSection(root, "Projects", {
			label: "All projects →",
			onClick: () => this.setTab("projects"),
		});
		this.renderProjectsTile(proj, person);

		const perf = this.ovSection(root, "Performance", {
			label: "Details →",
			onClick: () => this.setTab("performance"),
		});
		this.renderPerformanceTile(perf, person);
	}

	private ovSection(
		root: HTMLElement,
		title: string,
		link?: { label: string; onClick: () => void }
	): HTMLElement {
		const sec = root.createDiv({ cls: "tm-ov-section" });
		const head = sec.createDiv({ cls: "tm-ov-section-head" });
		head.createEl("div", { text: title, cls: "tm-ov-section-title" });
		if (link) {
			const a = head.createEl("a", {
				text: link.label,
				cls: "tm-ctx-link",
			});
			a.onclick = (e) => {
				e.preventDefault();
				link.onClick();
			};
		}
		return sec;
	}

	private tile(
		parent: HTMLElement,
		title: string,
		opts?: {
			link?: { label: string; onClick: () => void };
			button?: { label: string; onClick: () => void; primary?: boolean };
		}
	): HTMLElement {
		const t = parent.createDiv({ cls: "tm-ov-tile" });
		if (title || opts?.link || opts?.button) {
			const head = t.createDiv({ cls: "tm-ov-tile-head" });
			if (title) head.createEl("h4", { text: title });
			const actions = head.createDiv({ cls: "tm-ov-tile-actions" });
			if (opts?.link) {
				const a = actions.createEl("a", {
					text: opts.link.label,
					cls: "tm-ctx-link",
				});
				a.onclick = (e) => {
					e.preventDefault();
					opts.link!.onClick();
				};
			}
			if (opts?.button) {
				const b = actions.createEl("button", {
					text: opts.button.label,
					cls: opts.button.primary
						? "tm-tile-btn mod-primary"
						: "tm-tile-btn",
				});
				b.onclick = opts.button.onClick;
			}
		}
		return t;
	}

	/** Prep for the next 1:1: due chip, buffered agenda, open action items. */
	private renderPrepTile(
		parent: HTMLElement,
		person: Person,
		ctx: HubContext
	): void {
		const tile = this.tile(parent, "Next 1:1", {
			button: {
				label: "Start 1:1",
				onClick: () => void this.plugin.newMeetingFor(person.file),
				primary: true,
			},
		});

		// Due line: days until (or past) the personal cadence target.
		const target = this.plugin.store.cadenceTargetOf(person);
		const due = tile.createDiv({ cls: "tm-ov-due" });
		if (person.daysSinceLast == null) {
			due.createEl("span", {
				text: "no 1:1 yet",
				cls: "tm-chip tm-chip-days tm-chip-never",
			});
		} else {
			const left = target - person.daysSinceLast;
			const cls =
				left < 0
					? "tm-chip-overdue"
					: left <= 2
						? "tm-chip-warn"
						: "tm-chip-ok";
			due.createEl("span", {
				text:
					left < 0 ? `overdue by ${-left}d` : `due in ${left}d`,
				cls: `tm-chip tm-chip-days ${cls}`,
			});
			due.createEl("span", {
				text: `target every ${target}d`,
				cls: "tm-muted tm-ov-due-target",
			});
		}

		const agendaSub = tile.createDiv({ cls: "tm-ov-sub" });
		agendaSub.setText(`Agenda (${person.agendaItems.length})`);
		if (person.agendaItems.length === 0) {
			tile.createDiv({ cls: "tm-ov-empty" }).setText(
				"Nothing buffered — capture topics as they come up."
			);
		} else {
			const list = tile.createEl("ul", { cls: "tm-ctx-items" });
			for (const it of person.agendaItems) list.createEl("li", { text: it });
		}

		const itemsSub = tile.createDiv({ cls: "tm-ov-sub" });
		itemsSub.setText(`Open action items (${person.openActionItems.length})`);
		if (person.openActionItems.length === 0) {
			tile.createDiv({ cls: "tm-ov-empty" }).setText("Nothing open. 🎉");
		} else {
			const list = tile.createEl("ul", { cls: "tm-ctx-items" });
			for (const item of person.openActionItems) {
				renderActionItem(ctx, list, item);
			}
		}
	}

	/** The last couple of 1:1s, expandable in place. */
	private renderRecentTile(
		parent: HTMLElement,
		person: Person,
		ctx: HubContext
	): HTMLElement {
		const tile = this.tile(parent, "Recent 1:1s", {
			link: {
				label: "All 1:1s →",
				onClick: () => this.setTab("meetings"),
			},
		});
		const recent = person.meetings.slice(0, 2);
		if (recent.length === 0) {
			tile.createDiv({ cls: "tm-ov-empty" }).setText("No 1:1s yet.");
			return tile;
		}
		for (const m of recent) {
			renderMeetingRow({
				plugin: this.plugin,
				parent: tile,
				file: m.file,
				openState: this.openMeetings,
				previewOwner: ctx.previewOwner,
				buildSummary: (summary) => {
					summary.createEl("span", {
						text: m.date ?? m.file.basename,
						cls: "tm-meet-date",
					});
				},
			});
		}
		return tile;
	}

	/** Cadence rhythm: one bar per gap between 1:1s, colored against target. */
	private renderRhythmTile(parent: HTMLElement, person: Person): void {
		const tile = this.tile(parent, "Rhythm");
		const target = this.plugin.store.cadenceTargetOf(person);

		const dated = person.meetings
			.map((m) => m.date)
			.filter((d): d is string => !!d)
			.sort();
		const gaps: { days: number; from: string; to: string }[] = [];
		for (let i = 1; i < dated.length; i++) {
			const a = new Date(dated[i - 1] + "T00:00:00").getTime();
			const b = new Date(dated[i] + "T00:00:00").getTime();
			if (isNaN(a) || isNaN(b)) continue;
			gaps.push({
				days: Math.round((b - a) / 86_400_000),
				from: dated[i - 1],
				to: dated[i],
			});
		}
		const recent = gaps.slice(-10);

		if (recent.length === 0 && person.daysSinceLast == null) {
			tile.createDiv({ cls: "tm-ov-empty" }).setText(
				"The rhythm chart appears after a couple of 1:1s."
			);
			return;
		}

		const strip = tile.createDiv({ cls: "tm-rhythm" });
		const barFor = (days: number): string => {
			const ratio = days / target;
			return ratio <= 1
				? "tm-rhythm-ok"
				: ratio <= 1.5
					? "tm-rhythm-warn"
					: "tm-rhythm-over";
		};
		const heightFor = (days: number): number =>
			Math.max(10, Math.min(46, Math.round((days / target) * 24)));

		for (const g of recent) {
			const bar = strip.createDiv({
				cls: `tm-rhythm-bar ${barFor(g.days)}`,
			});
			bar.style.height = `${heightFor(g.days)}px`;
			bar.setAttr("aria-label", `${g.days}d · ${g.from} → ${g.to}`);
		}
		// The gap currently running (last 1:1 → today), still open-ended.
		if (person.daysSinceLast != null) {
			const now = strip.createDiv({ cls: "tm-rhythm-bar tm-rhythm-now" });
			now.style.height = `${heightFor(person.daysSinceLast)}px`;
			now.setAttr(
				"aria-label",
				`${person.daysSinceLast}d since the last 1:1 (ongoing)`
			);
		}

		const caption = tile.createDiv({ cls: "tm-rhythm-caption tm-muted" });
		caption.setText(
			person.cadenceDays == null
				? `target every ${target}d`
				: `actual ~${person.cadenceDays}d · target ${target}d`
		);
	}

	/** Active projects, full-width: staleness, status, last update text. */
	private renderProjectsTile(parent: HTMLElement, person: Person): void {
		const tile = this.tile(parent, "");
		if (person.activeProjects.length === 0) {
			tile.createDiv({ cls: "tm-ov-empty" }).setText("No active projects.");
		}
		for (const project of person.activeProjects) {
			const row = tile.createDiv({ cls: "tm-proj-row" });
			wireProjectMenu(this.plugin, row, project);
			const dot = row.createEl("span", { cls: "tm-proj-dot" });
			dot.addClass(`tm-stale-${stalenessOf(project)}`);
			const link = row.createEl("a", {
				text: project.name,
				cls: "tm-proj-name",
			});
			link.onclick = (e) => {
				e.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(project.file);
			};
			renderStatusPill(this.plugin, row, project);
			// Full width buys room for the actual last update, not just "5d".
			const update = row.createEl("span", {
				cls: "tm-ov-proj-update tm-muted",
			});
			update.setText(
				project.lastLogDate
					? `${project.lastLogDate} — ${project.lastLogText || "(no text)"}`
					: "no updates yet"
			);
			const meta = row.createEl("span", { cls: "tm-proj-meta tm-muted" });
			meta.setText(
				project.daysSinceLastLog == null
					? "—"
					: `${project.daysSinceLastLog}d`
			);
			const logBtn = row.createEl("button", {
				text: "＋",
				cls: "tm-proj-log-btn",
			});
			logBtn.setAttr("aria-label", "Add update");
			logBtn.onclick = () => this.plugin.addProjectLogFor(project);
		}

		const foot = tile.createDiv({ cls: "tm-ov-tile-foot" });
		const add = foot.createEl("button", {
			text: "＋ New project",
			cls: "tm-tile-btn mod-primary",
		});
		add.onclick = () => this.plugin.newProjectFor(person);
	}

	/** Latest review + accumulated observations (discreet-aware). */
	private renderPerformanceTile(parent: HTMLElement, person: Person): void {
		const tile = this.tile(parent, "");

		if (this.plugin.store.isReviewOverdue(person)) {
			const line = tile.createDiv({ cls: "tm-ov-nudgeline" });
			line.createSpan({
				text: person.latestPerformance ? "Review due" : "No review yet",
			});
		}

		const latest = person.latestPerformance;
		if (latest) {
			const row = tile.createDiv({ cls: "tm-perf-row tm-ov-perf-row" });
			wireNoteMenu(this.plugin, row, latest.file);
			row.createEl("span", {
				text: latest.period ?? latest.file.basename,
				cls: "tm-perf-period",
			});
			if (latest.rating) {
				row.createEl("span", {
					text: latest.rating,
					cls: "tm-perf-rating",
				});
			}
			const open = row.createEl("a", {
				text: "open ↗",
				cls: "tm-meet-open",
			});
			open.onclick = (e) => {
				e.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(latest.file);
			};
		}

		const obsSub = tile.createDiv({ cls: "tm-ov-sub" });
		obsSub.setText(`Observations (${person.observationItems.length})`);
		if (this.plugin.settings.discreetMode) {
			tile.createDiv({ cls: "tm-ov-empty" }).setText(
				"🙈 hidden (discreet mode)"
			);
		} else if (person.observationItems.length === 0) {
			tile.createDiv({ cls: "tm-ov-empty" }).setText(
				"Nothing logged — capture wins as you notice them."
			);
		} else {
			const list = tile.createEl("ul", { cls: "tm-ctx-items tm-ov-obs" });
			// Newest first; the tile shows a taste, the tab shows everything.
			for (const o of person.observationItems.slice(-2).reverse()) {
				list.createEl("li", { text: o });
			}
		}

		// Always available, for every relation — create a review from here.
		const foot = tile.createDiv({ cls: "tm-ov-tile-foot" });
		const btn = foot.createEl("button", {
			text: "＋ New review",
			cls: "tm-tile-btn mod-primary",
		});
		btn.onclick = () => this.plugin.newPerformanceFor(person.file);
	}

	private renderPerformance(root: HTMLElement, person: Person): void {
		if (this.plugin.store.isReviewOverdue(person)) {
			const nudge = root.createDiv({ cls: "tm-nudge" });
			const latest = person.latestPerformance;
			nudge.createSpan({
				text: latest
					? `Last review: ${latest.period ?? latest.sortKey}. Time to write the next one?`
					: "No performance review logged yet.",
			});
		}

		const obsSec = hubSection(
			root,
			`Accumulated observations (${person.observationItems.length})`
		);
		if (this.plugin.settings.discreetMode) {
			obsSec.createDiv({ cls: "tm-muted" }).setText(
				"🙈 observations hidden (discreet mode)"
			);
		} else if (person.observationItems.length === 0) {
			obsSec.createDiv({ cls: "tm-muted" }).setText(
				"Nothing logged. Use quick capture when you notice something."
			);
		} else {
			const list = obsSec.createEl("ul", { cls: "tm-ctx-items" });
			for (const o of person.observationItems) {
				list.createEl("li", { text: o });
			}
		}

		const sec = hubSection(root, `Reviews (${person.performance.length})`);
		if (person.performance.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("No performance notes yet.");
			return;
		}
		for (const perf of person.performance) {
			const row = sec.createDiv({ cls: "tm-perf-row" });
			wireNoteMenu(this.plugin, row, perf.file);
			row.createEl("span", {
				text: perf.period ?? perf.file.basename,
				cls: "tm-perf-period",
			});
			if (perf.rating) {
				row.createEl("span", { text: perf.rating, cls: "tm-perf-rating" });
			}
			const link = row.createEl("a", { text: "Open →", cls: "tm-ctx-link" });
			link.onclick = (e) => {
				e.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(perf.file);
			};
		}
	}

	// --- Helpers -------------------------------------------------------------

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
