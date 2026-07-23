import { App, FuzzySuggestModal } from "obsidian";
import { Project } from "../types";

/** Fuzzy picker over a list of projects. Same cancel contract as the person picker. */
export class ProjectSuggestModal extends FuzzySuggestModal<Project> {
	private chosen = false;

	constructor(
		app: App,
		private projects: Project[],
		private onChoose: (project: Project) => void,
		private onCancel?: () => void
	) {
		super(app);
		this.setPlaceholder("Search for a project...");
	}

	getItems(): Project[] {
		return this.projects;
	}

	getItemText(project: Project): string {
		const parts = [project.name, project.status];
		if (project.priority) parts.push(project.priority);
		parts.push(
			project.daysSinceLastLog == null
				? "no log"
				: `last log ${project.daysSinceLastLog}d ago`
		);
		return parts.join(" · ");
	}

	selectSuggestion(
		value: Parameters<FuzzySuggestModal<Project>["selectSuggestion"]>[0],
		evt: MouseEvent | KeyboardEvent
	): void {
		this.chosen = true;
		super.selectSuggestion(value, evt);
	}

	onChooseItem(project: Project): void {
		this.onChoose(project);
	}

	onClose(): void {
		super.onClose();
		window.setTimeout(() => {
			if (!this.chosen) this.onCancel?.();
		}, 0);
	}
}
