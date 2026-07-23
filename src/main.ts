import { Notice, Plugin, TFile, WorkspaceLeaf, debounce } from "obsidian";
import {
	DEFAULT_SETTINGS,
	TeamManagerSettings,
	TeamManagerSettingTab,
} from "./settings";
import { TeamStore } from "./data";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./views/DashboardView";
import { ContextView, VIEW_TYPE_CONTEXT } from "./views/ContextView";
import { PersonDetailView, VIEW_TYPE_PERSON } from "./views/PersonDetailView";
import { NewProjectModal } from "./modals/NewProjectModal";
import { PersonSuggestModal } from "./modals/PersonSuggestModal";
import { ProjectSuggestModal } from "./modals/ProjectSuggestModal";
import { TextPromptModal } from "./modals/TextPromptModal";
import {
	createMeetingNote,
	createPerformanceNote,
	createPersonNote,
	ensureFolder,
	folderFor,
	suggestPeriod,
} from "./notes";
import {
	appendDatedToSection,
	appendToSection,
	consumeSectionBullets,
} from "./sections";
import { runQuickCapture } from "./capture";
import {
	HUB_BLOCK_LANG,
	HUB_BLOCK_SNIPPET,
	PROJECT_BLOCK_LANG,
	PROJECT_BLOCK_SNIPPET,
} from "./constants";
import { registerHubBlock } from "./hubBlock";
import { registerProjectBlock } from "./projectBlock";
import { Person, Project } from "./types";

export default class TeamManagerPlugin extends Plugin {
	settings!: TeamManagerSettings;
	store!: TeamStore;

	refreshViews = debounce(
		() => {
			const types = [
				VIEW_TYPE_DASHBOARD,
				VIEW_TYPE_CONTEXT,
				VIEW_TYPE_PERSON,
			];
			for (const type of types) {
				for (const leaf of this.app.workspace.getLeavesOfType(type)) {
					const v = leaf.view as { render?: () => unknown };
					if (typeof v.render === "function") void v.render();
				}
			}
		},
		600,
		true
	);

	async onload(): Promise<void> {
		const firstRun = await this.loadSettings();
		this.store = new TeamStore(this.app, () => this.settings);

		this.registerView(
			VIEW_TYPE_DASHBOARD,
			(leaf) => new DashboardView(leaf, this)
		);
		this.registerView(
			VIEW_TYPE_CONTEXT,
			(leaf) => new ContextView(leaf, this)
		);
		this.registerView(
			VIEW_TYPE_PERSON,
			(leaf) => new PersonDetailView(leaf, this)
		);

		// Person notes render their own live hub via a ```team-hub``` block;
		// project notes get a ```team-project``` dashboard the same way.
		registerHubBlock(this);
		registerProjectBlock(this);

		this.addRibbonIcon("users", "Open team dashboard", () =>
			void this.activateDashboard()
		);

		this.addCommand({
			id: "open-dashboard",
			name: "Open team dashboard",
			callback: () => this.activateDashboard(),
		});
		this.addCommand({
			id: "new-person",
			name: "New person",
			callback: () => this.commandNewPerson(),
		});
		this.addCommand({
			id: "new-meeting",
			name: "New 1:1",
			callback: () => this.commandNewMeeting(),
		});
		this.addCommand({
			id: "add-to-next",
			name: "Add to next 1:1",
			callback: () => this.commandAddToNext(),
		});
		this.addCommand({
			id: "new-performance",
			name: "New performance note",
			callback: () => this.commandNewPerformance(),
		});
		this.addCommand({
			id: "quick-capture",
			name: "Quick capture (1:1 · observation · project)",
			callback: () => runQuickCapture(this),
		});
		this.addCommand({
			id: "new-project",
			name: "New project",
			callback: () => this.commandNewProject(),
		});
		this.addCommand({
			id: "add-project-log",
			name: "Add project log entry",
			callback: () => this.commandAddProjectLog(),
		});
		this.addCommand({
			id: "setup-folders",
			name: "Create folder structure",
			callback: () => void this.setupFolders(),
		});
		this.addCommand({
			id: "insert-hub-block",
			name: "Insert hub block in this note (person or project)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
				const type = String(fm?.type ?? "").toLowerCase();
				if (type !== "person" && type !== "project") return false;
				if (!checking) void this.insertHubBlock(file, type);
				return true;
			},
		});

		this.addSettingTab(new TeamManagerSettingTab(this.app, this));

		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.refreshViews())
		);
		// Cold start: restored leaves can render before the cache is ready.
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => this.refreshViews())
		);
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => this.onFileOpen(file))
		);
		// The person hub is a view, not a file: file-open never fires for it.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) =>
				this.onActiveLeafChange(leaf)
			)
		);

		// Wait for the vault to be ready before writing to it, and only on a
		// fresh install — nobody wants deleted folders resurrecting on restart.
		this.app.workspace.onLayoutReady(() => {
			if (firstRun) void this.setupFolders(true);
		});
	}

	/** Returns true when there was no data.json yet, i.e. a fresh install. */
	async loadSettings(): Promise<boolean> {
		const saved = (await this.loadData()) as Partial<TeamManagerSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		return saved == null;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Create the folder structure so a fresh install shows its shape straight
	 * away, instead of the vault staying empty until the first note is made.
	 * Runs once on install (saving data.json is what marks it done) and on
	 * demand via the command, e.g. after changing the base folder.
	 */
	async setupFolders(silent = false): Promise<void> {
		const subs = [
			this.settings.peopleFolder,
			this.settings.meetingsFolder,
			this.settings.performanceFolder,
			this.settings.projectsFolder,
		];
		for (const sub of subs) {
			await ensureFolder(this.app, folderFor(this.settings, sub));
		}
		await this.saveSettings();
		if (!silent) {
			const base = this.settings.baseFolder.trim();
			new Notice(`Folders ready${base ? ` in "${base}"` : " at the vault root"}.`);
		}
	}

	// --- View activation --------------------------------------------------

	async activateDashboard(): Promise<void> {
		const existing =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Open (or reuse) the person hub tab for the given person note. */
	async openPerson(personFile: TFile): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSON)[0];
		const leaf = existing ?? this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: VIEW_TYPE_PERSON,
			active: true,
			state: { personPath: personFile.path },
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	private async ensureContextLeaf(): Promise<ContextView | null> {
		let leaf: WorkspaceLeaf | null =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTEXT)[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_CONTEXT, active: false });
		}
		const view = leaf.view;
		return view instanceof ContextView ? view : null;
	}

	// --- Person-scoped actions (shared by commands + views) ---------------

	async newMeetingFor(personFile: TFile): Promise<void> {
		await this.store.refresh();
		const person = this.store.getPerson(personFile);
		if (!person) return;
		const agenda = await consumeSectionBullets(
			this.app,
			person.file,
			this.settings.agendaHeading
		);
		const file = await createMeetingNote(
			this.app,
			this.settings,
			person,
			agenda
		);
		await this.app.workspace.getLeaf(false).openFile(file);
		const ctx = await this.ensureContextLeaf();
		await ctx?.showPerson(person.file);
		this.refreshViews();
	}

	addToNextFor(personFile: TFile): void {
		const person = this.store.getPerson(personFile);
		const name = person?.name ?? personFile.basename;
		new TextPromptModal(
			this.app,
			{
				title: `Add to next 1:1 with ${name}`,
				placeholder: "What do you want to discuss?",
				cta: "Add",
				multiline: true,
			},
			async (text) => {
				await appendToSection(
					this.app,
					personFile,
					this.settings.agendaHeading,
					text
				);
				this.refreshViews();
			}
		).open();
	}

	newPerformanceFor(personFile: TFile): void {
		const person = this.store.getPerson(personFile);
		if (!person) return;
		new TextPromptModal(
			this.app,
			{
				title: `New performance note for ${person.name}`,
				placeholder: "Period, e.g. 2026-H1",
				cta: "Create",
				initialValue: suggestPeriod(),
			},
			async (period) => {
				const observations = await consumeSectionBullets(
					this.app,
					person.file,
					this.settings.observationsHeading
				);
				const file = await createPerformanceNote(
					this.app,
					this.settings,
					person,
					period,
					observations
				);
				await this.app.workspace.getLeaf(false).openFile(file);
				this.refreshViews();
			}
		).open();
	}

	addObservationFor(personFile: TFile): void {
		const person = this.store.getPerson(personFile);
		const name = person?.name ?? personFile.basename;
		new TextPromptModal(
			this.app,
			{
				title: `Log an observation about ${name}`,
				placeholder: "What did you notice?",
				cta: "Add",
				multiline: true,
			},
			async (text) => {
				await appendDatedToSection(
					this.app,
					personFile,
					this.settings.observationsHeading,
					text
				);
				this.refreshViews();
			}
		).open();
	}

	addProjectLogFor(project: Project): void {
		new TextPromptModal(
			this.app,
			{
				title: `Log in ${project.name}`,
				placeholder: "What happened?",
				cta: "Add",
				multiline: true,
			},
			async (text) => {
				await appendDatedToSection(
					this.app,
					project.file,
					this.settings.logHeading,
					text
				);
				this.refreshViews();
			}
		).open();
	}

	newProjectFor(person?: Person): void {
		new NewProjectModal(this, person ?? null).open();
	}

	/** Put the matching hub block right after the frontmatter of a note. */
	private async insertHubBlock(
		file: TFile,
		type: "person" | "project"
	): Promise<void> {
		const lang = type === "person" ? HUB_BLOCK_LANG : PROJECT_BLOCK_LANG;
		const snippet =
			type === "person" ? HUB_BLOCK_SNIPPET : PROJECT_BLOCK_SNIPPET;
		const content = await this.app.vault.read(file);
		if (content.includes("```" + lang)) {
			new Notice("This note already has the hub.");
			return;
		}
		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			let insertAt = 0;
			// Skip the frontmatter block if present.
			if (lines[0]?.trim() === "---") {
				const end = lines.indexOf("---", 1);
				if (end !== -1) insertAt = end + 1;
			}
			lines.splice(insertAt, 0, "", snippet);
			return lines.join("\n");
		});
		new Notice("Hub added.");
	}

	// --- Commands ---------------------------------------------------------

	/**
	 * Resolve once the metadata cache has indexed `file` (or after a short
	 * timeout). A just-created note isn't in the cache yet, and the hub
	 * renders from the cache — opening it too early would flash "not found".
	 */
	private waitForIndex(file: TFile, timeoutMs = 1500): Promise<void> {
		return new Promise((resolve) => {
			if (this.app.metadataCache.getFileCache(file)?.frontmatter) {
				resolve();
				return;
			}
			const ref = this.app.metadataCache.on("changed", (f) => {
				if (f.path !== file.path) return;
				this.app.metadataCache.offref(ref);
				window.clearTimeout(timer);
				resolve();
			});
			const timer = window.setTimeout(() => {
				this.app.metadataCache.offref(ref);
				resolve();
			}, timeoutMs);
		});
	}

	commandNewPerson(): void {
		new TextPromptModal(
			this.app,
			{ title: "New person", placeholder: "Full name", cta: "Create" },
			async (name) => {
				const file = await createPersonNote(this.app, this.settings, name);
				if (file) {
					// Land on the hub, not the raw note: it's the workspace.
					await this.waitForIndex(file);
					await this.openPerson(file);
					this.refreshViews();
				}
			}
		).open();
	}

	async commandNewMeeting(): Promise<void> {
		const person = await this.pickPerson();
		if (person) await this.newMeetingFor(person.file);
	}

	async commandAddToNext(): Promise<void> {
		const person = await this.pickPerson();
		if (person) this.addToNextFor(person.file);
	}

	async commandNewPerformance(): Promise<void> {
		const person = await this.pickPerson();
		if (person) this.newPerformanceFor(person.file);
	}

	async commandNewProject(): Promise<void> {
		const person = await this.pickPerson();
		this.newProjectFor(person ?? undefined);
	}

	async commandAddProjectLog(): Promise<void> {
		await this.store.refresh();
		const projects = this.store.getActiveProjects();
		if (projects.length === 0) {
			new Notice("No active projects yet.");
			return;
		}
		const project = await new Promise<Project | null>((resolve) => {
			new ProjectSuggestModal(
				this.app,
				projects,
				(p) => resolve(p),
				() => resolve(null)
			).open();
		});
		if (project) this.addProjectLogFor(project);
	}

	/** Refresh the store and let the user fuzzy-pick a person (null on ESC). */
	private async pickPerson(): Promise<Person | null> {
		await this.store.refresh();
		const people = this.store.getPeople();
		if (people.length === 0) {
			this.commandNewPerson();
			return null;
		}
		return new Promise((resolve) => {
			new PersonSuggestModal(
				this.app,
				people,
				(person) => resolve(person),
				() => resolve(null)
			).open();
		});
	}

	// --- Events -----------------------------------------------------------

	private async onFileOpen(file: TFile | null): Promise<void> {
		if (!file) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const type = String(fm?.type ?? "").toLowerCase();

		if (type === "meeting") {
			const personFile = this.store.resolvePersonOf(file);
			if (!personFile) return;
			const ctx = await this.ensureContextLeaf();
			await ctx?.showPerson(personFile);
		} else if (type === "person") {
			const ctx = await this.ensureContextLeaf();
			await ctx?.showPerson(file);
		} else if (type === "project") {
			const ctx = await this.ensureContextLeaf();
			await ctx?.showProject(file);
		} else if (type === "performance") {
			const personFile = this.store.resolvePersonOf(file);
			if (!personFile) return;
			const ctx = await this.ensureContextLeaf();
			await ctx?.showPerson(personFile);
		}
		// Other notes: leave the panel showing its last context.
	}

	private async onActiveLeafChange(
		leaf: WorkspaceLeaf | null
	): Promise<void> {
		const view = leaf?.view;
		if (!(view instanceof PersonDetailView)) return;
		const path = view.getPersonPath();
		if (path) await this.revealPersonContext(path);
	}

	/**
	 * Point the context panel at a person by note path. Called both when the
	 * hub becomes the active leaf and when the carousel switches person in
	 * place (which fires neither file-open nor active-leaf-change).
	 */
	async revealPersonContext(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const ctx = await this.ensureContextLeaf();
		await ctx?.showPerson(file);
	}
}
