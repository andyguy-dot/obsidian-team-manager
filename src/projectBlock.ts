import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	debounce,
} from "obsidian";
import type TeamManagerPlugin from "./main";
import { PROJECT_BLOCK_LANG } from "./constants";
import { renderAvatar } from "./avatar";
import { stalenessOf } from "./projectHelpers";
import { renderStatusPill } from "./projectActions";
import { Person, Project } from "./types";

/**
 * Renders a live project dashboard inside the project's own note.
 *
 * Like the person hub block, it only shows what the raw note can't: the
 * status as an interactive control, resolved owners, staleness math and
 * quick actions. Sobre/Pendências/Log stay plain markdown right below.
 */
class ProjectBlock extends MarkdownRenderChild {
	private queueRender = debounce(() => void this.render(), 400, true);

	constructor(
		private plugin: TeamManagerPlugin,
		containerEl: HTMLElement,
		private sourcePath: string
	) {
		super(containerEl);
	}

	async onload(): Promise<void> {
		this.registerEvent(
			this.plugin.app.metadataCache.on("changed", () => this.queueRender())
		);
		await this.render();
	}

	async render(): Promise<void> {
		const root = this.containerEl;
		root.empty();
		root.addClass("tm-hub-block");

		await this.plugin.store.refresh();
		const project = this.plugin.store.getProjectByPath(this.sourcePath);
		if (!project) {
			root.createDiv({ cls: "tm-hub-hint" }).setText(
				"team-project: this note isn't indexed as a project. It needs `type: project` in the frontmatter and must live inside the Projects folder (see Settings → Team Manager)."
			);
			return;
		}

		this.renderHeader(root, project);
		this.renderPeople(root, project);
	}

	private renderHeader(root: HTMLElement, project: Project): void {
		const head = root.createDiv({ cls: "tm-hub-head" });
		const left = head.createDiv({ cls: "tm-hub-headleft" });

		renderStatusPill(this.plugin, left, project);
		if (project.priority) {
			left.createEl("span", { text: project.priority, cls: "tm-pill" });
		}

		if (this.plugin.store.isProjectActive(project)) {
			const stale = stalenessOf(project);
			const chip = left.createEl("span", {
				cls: `tm-chip tm-chip-days tm-chip-${stale === "overdue" ? "overdue" : stale}`,
			});
			chip.setText(
				project.daysSinceLastLog == null
					? "no updates"
					: `last update ${project.daysSinceLastLog}d ago`
			);
		}

		const open = project.openActionItems.length;
		if (open > 0) {
			left.createEl("span", {
				text: `☑ ${open} open`,
				cls: "tm-chip tm-chip-warn",
			});
		}

		const actions = head.createDiv({ cls: "tm-person-actions" });
		if (this.plugin.store.isProjectActive(project)) {
			const updateBtn = actions.createEl("button", { text: "＋ Update" });
			updateBtn.onclick = () => this.plugin.addProjectLogFor(project);
		}
	}

	private renderPeople(root: HTMLElement, project: Project): void {
		const row = root.createDiv({ cls: "tm-projblk-people" });
		row.createEl("span", { text: "Owners:", cls: "tm-muted" });

		const people = project.peopleFiles
			.map((f) => this.plugin.store.getPerson(f))
			.filter((p): p is Person => !!p);

		if (people.length === 0) {
			row.createEl("span", { text: "nobody yet", cls: "tm-muted" });
			return;
		}
		for (const p of people) {
			const chip = row.createDiv({ cls: "tm-projblk-person" });
			renderAvatar(chip, p.name, true);
			chip.createSpan({ text: p.name });
			chip.onclick = () => void this.plugin.openPerson(p.file);
		}
	}
}

export function registerProjectBlock(plugin: TeamManagerPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		PROJECT_BLOCK_LANG,
		(_source, el, ctx: MarkdownPostProcessorContext) => {
			ctx.addChild(new ProjectBlock(plugin, el, ctx.sourcePath));
		}
	);
}
