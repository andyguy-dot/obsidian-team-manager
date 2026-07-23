import {
	Component,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	debounce,
} from "obsidian";
import type TeamManagerPlugin from "./main";
import { HUB_BLOCK_LANG } from "./constants";
import { renderRelationPill } from "./personActions";
import {
	HubContext,
	renderHubActions,
	renderHubMeetings,
	renderHubOpenItems,
	renderHubProjects,
	renderHubStats,
} from "./hubSections";
import { Person } from "./types";

/**
 * Renders the live person hub inside the person's own note.
 *
 * The note already shows its own content (the agenda / observations buffers
 * are plain markdown right below), so this block deliberately shows only what
 * the note *cannot* know by itself: data that lives in other files.
 */
class HubBlock extends MarkdownRenderChild {
	private openMeetings = new Set<string>();
	private previews: Component | null = null;
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
		this.resetPreviews();

		await this.plugin.store.refresh();
		const person = this.plugin.store.getPersonByPath(this.sourcePath);
		if (!person) {
			root.createDiv({ cls: "tm-hub-hint" }).setText(
				"team-hub: this note isn't indexed as a person. It needs `type: person` in the frontmatter and must live inside the People folder (see Settings → Team Manager)."
			);
			return;
		}

		const ctx: HubContext = {
			app: this.plugin.app,
			plugin: this.plugin,
			person,
			previewOwner: () => this.previewOwner(),
			openMeetings: this.openMeetings,
			rerender: () => void this.render(),
		};

		this.renderHeader(root, person, ctx);
		renderHubStats(ctx, root);
		renderHubProjects(ctx, root);
		renderHubOpenItems(ctx, root);
		renderHubMeetings(ctx, root, { limit: 5 });
	}

	private renderHeader(
		root: HTMLElement,
		person: Person,
		ctx: HubContext
	): void {
		const head = root.createDiv({ cls: "tm-hub-head" });
		const left = head.createDiv({ cls: "tm-hub-headleft" });
		renderRelationPill(this.plugin, left, person);
		const health = this.plugin.store.getHealth(person);
		const chip = left.createEl("span", {
			cls: `tm-chip tm-chip-days tm-chip-${health}`,
		});
		chip.setText(
			person.daysSinceLast == null
				? "no 1:1 yet"
				: `last 1:1 ${person.daysSinceLast}d ago`
		);

		const actions = renderHubActions(ctx, head);
		const open = actions.createEl("a", {
			text: "Open hub ↗",
			cls: "tm-ctx-link",
		});
		open.onclick = (e) => {
			e.preventDefault();
			this.plugin.openPerson(person.file);
		};
	}

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

export function registerHubBlock(plugin: TeamManagerPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		HUB_BLOCK_LANG,
		(_source, el, ctx: MarkdownPostProcessorContext) => {
			ctx.addChild(new HubBlock(plugin, el, ctx.sourcePath));
		}
	);
}
