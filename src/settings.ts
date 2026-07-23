import { App, PluginSettingTab, Setting } from "obsidian";
import type TeamManagerPlugin from "./main";

export interface TeamManagerSettings {
	/** Parent folder holding the plugin's folders. Empty = vault root. */
	baseFolder: string;
	/** Folder where new person notes are created, inside the base folder. */
	peopleFolder: string;
	/** Folder where new 1:1 notes are created. */
	meetingsFolder: string;
	/** Folder where new performance notes are created. */
	performanceFolder: string;
	/** Folder where new project notes are created. */
	projectsFolder: string;
	/** Default 1:1 cadence in days, used when a person has no `cadence`. */
	staleDays: number;
	/** Heading (without leading #) used for the per-person agenda buffer. */
	agendaHeading: string;
	/** Heading used for the per-person performance observations buffer. */
	observationsHeading: string;
	/** Heading used for the plugin-managed log inside project notes. */
	logHeading: string;
	/** Ordered list of relationship groups (dashboard sections / pill menu). */
	relations: string[];
	/** Ordered list of project statuses (board columns / grouping order). */
	projectStatuses: string[];
	/** Statuses that mean "no longer in flight" (excluded from active lists). */
	closedProjectStatuses: string[];
	/** Days between performance reviews before a nudge appears (team only). */
	reviewIntervalDays: number;
	/** When true, performance observations are hidden (screen-share safe). */
	discreetMode: boolean;
}

export const DEFAULT_SETTINGS: TeamManagerSettings = {
	baseFolder: "Team Manager",
	peopleFolder: "People",
	meetingsFolder: "Meetings",
	performanceFolder: "Performance",
	projectsFolder: "Projects",
	staleDays: 21,
	agendaHeading: "📥 Next 1:1",
	observationsHeading: "🌟 Observations",
	logHeading: "Log",
	relations: ["team", "peer", "manager", "other"],
	projectStatuses: ["backlog", "in progress", "done", "cancelled"],
	closedProjectStatuses: ["done", "cancelled"],
	reviewIntervalDays: 180,
	discreetMode: false,
};

export class TeamManagerSettingTab extends PluginSettingTab {
	plugin: TeamManagerPlugin;

	constructor(app: App, plugin: TeamManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private save = () => this.plugin.saveSettings();

	/** A section header with an optional one-line subtitle. */
	private heading(title: string, desc?: string): void {
		const s = new Setting(this.containerEl).setName(title).setHeading();
		if (desc) s.setDesc(desc);
	}

	/** Text field with a reset-to-default button. */
	private textField(opts: {
		name: string;
		desc: string;
		get: () => string;
		set: (v: string) => void;
		fallback: string;
		refreshOnReset?: boolean;
	}): void {
		new Setting(this.containerEl)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Reset to default")
					.onClick(async () => {
						opts.set(opts.fallback);
						await this.save();
						this.display();
					})
			)
			.addText((t) =>
				t
					.setPlaceholder(opts.fallback)
					.setValue(opts.get())
					.onChange(async (v) => {
						opts.set(v.trim() || opts.fallback);
						await this.save();
					})
			);
	}

	/** Comma-separated list field with a reset-to-default button. */
	private listField(opts: {
		name: string;
		desc: string;
		get: () => string[];
		set: (v: string[]) => void;
		fallback: string[];
	}): void {
		new Setting(this.containerEl)
			.setName(opts.name)
			.setDesc(opts.desc)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Reset to default")
					.onClick(async () => {
						opts.set([...opts.fallback]);
						await this.save();
						this.display();
					})
			)
			.addText((t) =>
				t
					.setPlaceholder(opts.fallback.join(", "))
					.setValue(opts.get().join(", "))
					.onChange(async (v) => {
						const list = v
							.split(",")
							.map((s) => s.trim().toLowerCase())
							.filter(Boolean);
						opts.set(list.length > 0 ? list : [...opts.fallback]);
						await this.save();
					})
			);
	}

	display(): void {
		this.containerEl.empty();
		const s = this.plugin.settings;

		// --- Folders ---------------------------------------------------------
		this.heading(
			"Folders",
			"A note only counts as a person, 1:1, review or project if it lives in the matching folder — the rest of your vault is left untouched."
		);

		new Setting(this.containerEl)
			.setName("Base folder")
			.setDesc(
				"Parent folder for everything below. Leave empty to place the folders at the vault root."
			)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Reset to default")
					.onClick(async () => {
						s.baseFolder = DEFAULT_SETTINGS.baseFolder;
						await this.save();
						this.display();
					})
			)
			.addText((t) =>
				t
					.setPlaceholder("Team Manager")
					.setValue(s.baseFolder)
					.onChange(async (v) => {
						s.baseFolder = v.trim();
						await this.save();
					})
			);

		this.textField({
			name: "People subfolder",
			desc: "Where new person notes are created.",
			get: () => s.peopleFolder,
			set: (v) => (s.peopleFolder = v),
			fallback: "People",
		});
		this.textField({
			name: "Meetings subfolder",
			desc: "Where new 1:1 notes are created.",
			get: () => s.meetingsFolder,
			set: (v) => (s.meetingsFolder = v),
			fallback: "Meetings",
		});
		this.textField({
			name: "Performance subfolder",
			desc: "Where new performance notes are created.",
			get: () => s.performanceFolder,
			set: (v) => (s.performanceFolder = v),
			fallback: "Performance",
		});
		this.textField({
			name: "Projects subfolder",
			desc: "Where new project notes are created.",
			get: () => s.projectsFolder,
			set: (v) => (s.projectsFolder = v),
			fallback: "Projects",
		});

		new Setting(this.containerEl)
			.setName("Create folder structure")
			.setDesc(
				"Create the configured folders now. Handy after changing the paths above. Existing notes are never moved."
			)
			.addButton((b) =>
				b
					.setButtonText("Create folders")
					.setCta()
					.onClick(() => void this.plugin.setupFolders())
			);

		// --- Cadence & reviews ----------------------------------------------
		this.heading("Cadence & reviews");

		new Setting(this.containerEl)
			.setName("Default 1:1 cadence")
			.setDesc(
				"How often you aim to meet (in days), when a person note has no `cadence` of its own. Someone is flagged overdue past their target."
			)
			.addSlider((sl) =>
				sl
					.setLimits(1, 90, 1)
					.setValue(s.staleDays)
					.onChange(async (v) => {
						s.staleDays = v;
						await this.save();
					})
			);

		new Setting(this.containerEl)
			.setName("Review interval")
			.setDesc(
				"Nudge for a new review once the latest one is older than this many days. Never-reviewed people are only nudged for your team."
			)
			.addSlider((sl) =>
				sl
					.setLimits(30, 365, 15)
					.setValue(s.reviewIntervalDays)
					.onChange(async (v) => {
						s.reviewIntervalDays = v;
						await this.save();
					})
			);

		// --- Groups & statuses ----------------------------------------------
		this.heading("Groups & statuses");

		this.listField({
			name: "Relationship groups",
			desc: "Dashboard sections, in order. 'team' unlocks the review nudges; the rest are just groups. Add your own, e.g. stakeholders or skip-level.",
			get: () => s.relations,
			set: (v) => (s.relations = v),
			fallback: DEFAULT_SETTINGS.relations,
		});
		this.listField({
			name: "Project statuses",
			desc: "Kanban columns, in order.",
			get: () => s.projectStatuses,
			set: (v) => (s.projectStatuses = v),
			fallback: DEFAULT_SETTINGS.projectStatuses,
		});
		this.listField({
			name: "Closed statuses",
			desc: "Statuses that no longer count as active — hidden from the 1:1 context, quick capture and card counters.",
			get: () => s.closedProjectStatuses,
			set: (v) => (s.closedProjectStatuses = v),
			fallback: DEFAULT_SETTINGS.closedProjectStatuses,
		});

		// --- Privacy ---------------------------------------------------------
		this.heading("Privacy");

		new Setting(this.containerEl)
			.setName("Discreet mode")
			.setDesc(
				"Hide performance observations everywhere — safe for screen-sharing a 1:1. Also toggleable from the eye icon in the context panel."
			)
			.addToggle((t) =>
				t.setValue(s.discreetMode).onChange(async (v) => {
					s.discreetMode = v;
					await this.save();
					this.plugin.refreshViews();
				})
			);

		// --- Note sections (advanced) ---------------------------------------
		this.heading(
			"Note sections (advanced)",
			"Headings the plugin reads and writes inside your notes. Changing one orphans the content already under the old heading."
		);

		this.textField({
			name: "Agenda heading",
			desc: "Buffers items for a person's next 1:1.",
			get: () => s.agendaHeading,
			set: (v) => (s.agendaHeading = v),
			fallback: DEFAULT_SETTINGS.agendaHeading,
		});
		this.textField({
			name: "Observations heading",
			desc: "Buffers performance observations on a person note.",
			get: () => s.observationsHeading,
			set: (v) => (s.observationsHeading = v),
			fallback: DEFAULT_SETTINGS.observationsHeading,
		});
		this.textField({
			name: "Project log heading",
			desc: "Where timestamped updates land inside a project note.",
			get: () => s.logHeading,
			set: (v) => (s.logHeading = v),
			fallback: DEFAULT_SETTINGS.logHeading,
		});
	}
}
