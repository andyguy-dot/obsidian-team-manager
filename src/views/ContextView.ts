import {
	Component,
	ItemView,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import type TeamManagerPlugin from "../main";
import { renderAvatar } from "../avatar";
import { renderMeetingRow } from "./meetingRow";
import { renderStatusPill, wireProjectMenu } from "../projectActions";
import { stalenessOf } from "../projectHelpers";
import { readSectionBullets, toggleTaskLine } from "../sections";
import { ActionItem, Person, Project } from "../types";

export const VIEW_TYPE_CONTEXT = "team-manager-context";

/** What the panel is currently mirroring. */
type ContextTarget =
	| { kind: "person"; file: TFile }
	| { kind: "project"; file: TFile };

export class ContextView extends ItemView {
	private target: ContextTarget | null = null;
	/** Owns the markdown previews of the current render pass. */
	private previews: Component | null = null;
	/** Meeting paths the user expanded, kept across auto re-renders. */
	private openMeetings = new Set<string>();
	/** Project paths the user expanded (to peek at logs), same idea. */
	private openProjects = new Set<string>();

	constructor(leaf: WorkspaceLeaf, private plugin: TeamManagerPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CONTEXT;
	}

	getDisplayText(): string {
		return "Team context";
	}

	getIcon(): string {
		return "users";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Point the panel at a person (1:1 notes, person notes, person hub). */
	async showPerson(file: TFile | null): Promise<void> {
		this.target = file ? { kind: "person", file } : null;
		await this.render();
	}

	/** Point the panel at a project (project notes). */
	async showProject(file: TFile | null): Promise<void> {
		this.target = file ? { kind: "project", file } : null;
		await this.render();
	}

	async render(): Promise<void> {
		const root = this.contentEl;
		// Auto re-renders (typing triggers metadataCache "changed") must not
		// reset what the user is looking at: keep scroll and expanded state.
		const scrollTop = root.scrollTop;
		root.empty();
		root.addClass("tm-context");
		this.resetPreviews();

		if (!this.target) {
			root.createDiv({ cls: "tm-empty" }).setText(
				"Open a person, project or 1:1 note to see its context here."
			);
			return;
		}

		await this.plugin.store.refresh();

		if (this.target.kind === "person") {
			const person = this.plugin.store.getPerson(this.target.file);
			if (!person) {
				root.createDiv({ cls: "tm-empty" }).setText(
					"This note isn't linked to a known person."
				);
				return;
			}
			this.renderPersonContext(root, person);
		} else {
			const project = this.plugin.store.getProjectByPath(
				this.target.file.path
			);
			if (!project) {
				root.createDiv({ cls: "tm-empty" }).setText(
					"This note isn't linked to a known project."
				);
				return;
			}
			await this.renderProjectContext(root, project);
		}
		root.scrollTop = scrollTop;
	}

	// --- Person mode ---------------------------------------------------------

	private renderPersonContext(root: HTMLElement, person: Person): void {
		this.renderPersonHeader(root, person);
		this.renderAgenda(root, person);
		this.renderOpenItems(root, person);
		this.renderProjects(root, person);
		this.renderObservations(root, person);
		this.renderRecentMeetings(root, person);
	}

	private renderPersonHeader(root: HTMLElement, person: Person): void {
		const head = root.createDiv({ cls: "tm-ctx-header" });
		const row = head.createDiv({ cls: "tm-ctx-headrow" });
		row.createEl("div", { text: person.name, cls: "tm-ctx-name" });

		// Discreet mode: hide performance content while screen-sharing.
		const eye = row.createEl("button", { cls: "tm-discreet-btn" });
		const paint = () => {
			setIcon(eye, this.plugin.settings.discreetMode ? "eye-off" : "eye");
			eye.setAttr(
				"aria-label",
				this.plugin.settings.discreetMode
					? "Discreet mode on (observations hidden)"
					: "Hide observations (discreet mode)"
			);
		};
		paint();
		eye.onclick = async () => {
			this.plugin.settings.discreetMode =
				!this.plugin.settings.discreetMode;
			await this.plugin.saveSettings();
			this.plugin.refreshViews();
			await this.render();
		};

		const sub = [person.role, person.team].filter(Boolean).join(" · ");
		if (sub) head.createEl("div", { text: sub, cls: "tm-muted" });
		const open = head.createEl("a", {
			text: "Open person hub →",
			cls: "tm-ctx-link",
		});
		open.onclick = (e) => {
			e.preventDefault();
			this.plugin.openPerson(person.file);
		};
	}

	private renderAgenda(root: HTMLElement, person: Person): void {
		const sec = this.section(
			root,
			`Buffered for next 1:1 (${person.agendaItems.length})`
		);
		if (person.agendaItems.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("Nothing buffered.");
			return;
		}
		const list = sec.createEl("ul", { cls: "tm-ctx-items" });
		for (const it of person.agendaItems) list.createEl("li", { text: it });
	}

	private renderOpenItems(root: HTMLElement, person: Person): void {
		const sec = this.section(
			root,
			`Open action items (${person.openActionItems.length})`
		);
		this.renderItemList(sec, person.openActionItems);
	}

	private renderProjects(root: HTMLElement, person: Person): void {
		const sec = this.section(
			root,
			`Active projects (${person.activeProjects.length})`
		);
		if (person.activeProjects.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("No active projects.");
			return;
		}
		for (const project of person.activeProjects) {
			this.renderProjectRow(sec, project);
		}
	}

	/** Expandable like the meeting rows: the body peeks at the recent logs. */
	private renderProjectRow(sec: HTMLElement, project: Project): void {
		const details = sec.createEl("details", {
			cls: "tm-ctx-meeting tm-proj-details",
		});
		const summary = details.createEl("summary");
		wireProjectMenu(this.plugin, summary, project);

		const dot = summary.createEl("span", { cls: "tm-proj-dot" });
		dot.addClass(`tm-stale-${stalenessOf(project)}`);
		summary.createEl("span", {
			text: project.name,
			cls: "tm-proj-summary-name",
		});
		const meta = summary.createEl("span", { cls: "tm-proj-meta tm-muted" });
		meta.setText(
			project.daysSinceLastLog == null
				? "no log"
				: `${project.daysSinceLastLog}d without a log`
		);
		const open = summary.createEl("a", {
			text: "open ↗",
			cls: "tm-meet-open",
		});
		open.setAttr("aria-label", "Open project note");
		open.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.app.workspace.getLeaf(false).openFile(project.file);
		};
		const logBtn = summary.createEl("button", {
			text: "＋",
			cls: "tm-proj-log-btn",
		});
		logBtn.setAttr("aria-label", "Add log");
		logBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.plugin.addProjectLogFor(project);
		};

		const path = project.file.path;
		let loaded = false;
		const loadBody = async () => {
			if (loaded) return;
			loaded = true;
			const body = details.createDiv({ cls: "tm-ctx-meeting-body" });
			const bullets = await readSectionBullets(
				this.app,
				project.file,
				this.plugin.settings.logHeading
			);
			// Log appends chronologically; the peek wants newest first.
			const recent = bullets.reverse().slice(0, 6);
			if (recent.length === 0) {
				body.createDiv({ cls: "tm-muted" }).setText("No updates yet.");
				return;
			}
			const list = body.createEl("ul", { cls: "tm-ctx-items" });
			for (const b of recent) list.createEl("li", { text: b });
			if (bullets.length > recent.length) {
				body.createDiv({ cls: "tm-muted tm-proj-more" }).setText(
					`+ ${bullets.length - recent.length} older in the note`
				);
			}
		};
		details.addEventListener("toggle", () => {
			if (details.open) {
				this.openProjects.add(path);
				void loadBody();
			} else {
				this.openProjects.delete(path);
			}
		});
		if (this.openProjects.has(path)) {
			details.open = true;
			void loadBody();
		}
	}

	private renderObservations(root: HTMLElement, person: Person): void {
		const sec = this.section(
			root,
			`Observations (${person.observationItems.length})`
		);
		if (this.plugin.settings.discreetMode) {
			sec.createDiv({ cls: "tm-muted" }).setText("🙈 observations hidden");
			return;
		}
		if (person.observationItems.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("Nothing logged.");
			return;
		}
		const list = sec.createEl("ul", { cls: "tm-ctx-items" });
		for (const o of person.observationItems) {
			list.createEl("li", { text: o });
		}
	}

	private renderRecentMeetings(root: HTMLElement, person: Person): void {
		const sec = this.section(root, "Recent 1:1s");
		const recent = person.meetings.slice(0, 8);
		if (recent.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("No meetings yet.");
			return;
		}
		for (const m of recent) {
			renderMeetingRow({
				plugin: this.plugin,
				parent: sec,
				file: m.file,
				openState: this.openMeetings,
				previewOwner: () => this.previewOwner(),
				buildSummary: (summary) => {
					summary.createEl("span", {
						text: m.date ?? m.file.basename,
						cls: "tm-meet-date",
					});
				},
			});
		}
	}

	// --- Project mode ----------------------------------------------------------

	private async renderProjectContext(
		root: HTMLElement,
		project: Project
	): Promise<void> {
		const head = root.createDiv({ cls: "tm-ctx-header" });
		head.createEl("div", { text: project.name, cls: "tm-ctx-name" });

		const pills = head.createDiv({ cls: "tm-ctx-pills" });
		renderStatusPill(this.plugin, pills, project);
		if (project.priority) {
			pills.createEl("span", { text: project.priority, cls: "tm-pill" });
		}
		if (this.plugin.store.isProjectActive(project)) {
			const stale = stalenessOf(project);
			const chip = pills.createEl("span", {
				cls: `tm-chip tm-chip-days tm-chip-${stale}`,
			});
			chip.setText(
				project.daysSinceLastLog == null
					? "no updates"
					: `last update ${project.daysSinceLastLog}d ago`
			);
		}

		const open = head.createEl("a", {
			text: "Open note →",
			cls: "tm-ctx-link",
		});
		open.onclick = (e) => {
			e.preventDefault();
			this.app.workspace.getLeaf(false).openFile(project.file);
		};

		this.renderProjectPeople(root, project);
		this.renderProjectItems(root, project);
		await this.renderProjectLog(root, project);
	}

	private renderProjectPeople(root: HTMLElement, project: Project): void {
		const people = project.peopleFiles
			.map((f) => this.plugin.store.getPerson(f))
			.filter((p): p is Person => !!p);
		const sec = this.section(root, `Owners (${people.length})`);
		if (people.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("Nobody yet.");
			return;
		}
		const row = sec.createDiv({ cls: "tm-projblk-people" });
		for (const p of people) {
			const chip = row.createDiv({ cls: "tm-projblk-person" });
			renderAvatar(chip, p.name, true);
			chip.createSpan({ text: p.name });
			chip.onclick = () => void this.plugin.openPerson(p.file);
		}
	}

	private renderProjectItems(root: HTMLElement, project: Project): void {
		const sec = this.section(
			root,
			`Open items (${project.openActionItems.length})`
		);
		this.renderItemList(sec, project.openActionItems);
	}

	private async renderProjectLog(
		root: HTMLElement,
		project: Project
	): Promise<void> {
		const bullets = await readSectionBullets(
			this.app,
			project.file,
			this.plugin.settings.logHeading
		);
		// Log appends chronologically; the panel wants newest first.
		const recent = bullets.reverse().slice(0, 10);
		const sec = this.section(root, `Recent updates (${bullets.length})`);
		if (recent.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("No updates yet.");
		} else {
			const list = sec.createEl("ul", { cls: "tm-ctx-items" });
			for (const b of recent) list.createEl("li", { text: b });
		}
		if (this.plugin.store.isProjectActive(project)) {
			const btn = sec.createEl("button", {
				text: "＋ Update",
				cls: "tm-inline-add",
			});
			btn.onclick = () => this.plugin.addProjectLogFor(project);
		}
	}

	// --- Shared ----------------------------------------------------------------

	private renderItemList(sec: HTMLElement, items: ActionItem[]): void {
		if (items.length === 0) {
			sec.createDiv({ cls: "tm-muted" }).setText("Nothing open. 🎉");
			return;
		}
		const list = sec.createEl("ul", { cls: "tm-ctx-items" });
		for (const item of items) {
			const li = list.createEl("li", { cls: "tm-ctx-item" });
			const cb = li.createEl("input", { type: "checkbox" });
			cb.onchange = async () => {
				await toggleTaskLine(this.app, item.file, item.line);
				await this.render();
			};
			const label = li.createEl("span", { text: item.text });
			label.onclick = (e) => {
				e.preventDefault();
				this.app.workspace.getLeaf(false).openFile(item.file);
			};
			if (item.meetingDate) {
				li.createEl("span", {
					text: item.meetingDate,
					cls: "tm-ctx-date",
				});
			}
		}
	}

	private section(root: HTMLElement, title: string): HTMLElement {
		const sec = root.createDiv({ cls: "tm-ctx-section" });
		sec.createEl("h4", { text: title });
		return sec;
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
