import { Component, TFile } from "obsidian";
import type TeamManagerPlugin from "../main";
import { wireNoteMenu } from "../noteActions";
import { renderNoteBody } from "../render";

interface MeetingRowOptions {
	plugin: TeamManagerPlugin;
	parent: HTMLElement;
	file: TFile;
	/** Expanded paths, owned by the view so state survives its re-renders. */
	openState: Set<string>;
	/** Component that owns the rendered preview for the current render pass. */
	previewOwner: () => Component;
	/** Fill the summary row; the "open" link is appended after it. */
	buildSummary: (summary: HTMLElement) => void;
	cls?: string;
}

/**
 * One collapsible 1:1 row: summary line + lazily rendered note body.
 * Shared by the dashboard, the person hub and the 1:1 context panel.
 */
export function renderMeetingRow(opts: MeetingRowOptions): void {
	const { plugin, parent, file, openState, previewOwner, buildSummary } = opts;
	const app = plugin.app;

	const details = parent.createEl("details", {
		cls: opts.cls ? `tm-ctx-meeting ${opts.cls}` : "tm-ctx-meeting",
	});
	const summary = details.createEl("summary");
	buildSummary(summary);

	// Direct link: reading the note shouldn't require expanding it first.
	const open = summary.createEl("a", { text: "open ↗", cls: "tm-meet-open" });
	open.setAttr("aria-label", "Open note");
	open.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation(); // don't toggle the <details>
		app.workspace.getLeaf(false).openFile(file);
	};

	// On the summary only: inside the expanded body, right-click belongs to
	// the rendered markdown.
	wireNoteMenu(plugin, summary, file);

	let loaded = false;
	const loadBody = async () => {
		if (loaded) return;
		loaded = true;
		const body = details.createDiv({ cls: "tm-ctx-meeting-body" });
		await renderNoteBody(app, previewOwner(), file, body);
	};

	details.addEventListener("toggle", () => {
		if (details.open) {
			openState.add(file.path);
			void loadBody();
		} else {
			openState.delete(file.path);
		}
	});
	if (openState.has(file.path)) {
		details.open = true;
		void loadBody();
	}
}
