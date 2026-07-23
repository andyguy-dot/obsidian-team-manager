import { App, Component, MarkdownRenderer, TFile } from "obsidian";

/** Drop the YAML frontmatter block so it isn't rendered as content. */
export function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	const after = content.indexOf("\n", end + 1);
	return after === -1 ? "" : content.slice(after + 1);
}

/**
 * Render a note's body into `el` using Obsidian's own markdown pipeline, so
 * headings, lists, tasks and [[links]] look like they do in the editor.
 *
 * `component` owns the lifecycle of the rendered children: pass a component
 * that is discarded on each re-render, not the long-lived view itself.
 */
export async function renderNoteBody(
	app: App,
	component: Component,
	file: TFile,
	el: HTMLElement
): Promise<void> {
	const content = await app.vault.cachedRead(file);
	const body = stripFrontmatter(content).trim();
	el.empty();
	if (!body) {
		el.createDiv({ cls: "tm-muted" }).setText("(empty note)");
		return;
	}
	await MarkdownRenderer.render(app, body, el, file.path, component);
}
