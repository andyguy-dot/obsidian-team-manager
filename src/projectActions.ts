import { Menu, Notice } from "obsidian";
import type TeamManagerPlugin from "./main";
import { Project } from "./types";
import { statusLabel, statusSlug } from "./projectHelpers";
import { addNoteMenuItems } from "./noteActions";

/** Persist a status change by rewriting only the note's frontmatter. */
export async function setProjectStatus(
	plugin: TeamManagerPlugin,
	project: Project,
	status: string
): Promise<void> {
	if (project.status === status) return;
	try {
		await plugin.app.fileManager.processFrontMatter(
			project.file,
			(fm: { status?: unknown; people?: unknown }) => {
			fm.status = status;
		});
	} catch (err) {
		new Notice(`Couldn't update the status of ${project.name}.`);
		console.error("[team-manager] status write failed", err);
		return;
	}
	plugin.refreshViews();
}

/** Status picker menu; the current status comes checked. */
export function openStatusMenu(
	plugin: TeamManagerPlugin,
	project: Project,
	e: MouseEvent,
	onPick?: (status: string) => void
): void {
	const menu = new Menu();
	for (const status of plugin.store.getProjectStatuses()) {
		menu.addItem((item) =>
			item
				.setTitle(statusLabel(status))
				.setChecked(status === project.status)
				.onClick(() => {
					if (onPick) onPick(status);
					else void setProjectStatus(plugin, project, status);
				})
		);
	}
	menu.showAtMouseEvent(e);
}

/**
 * Right-click a project anywhere: set status, log an update, open or delete.
 *
 * The board passes its optimistic accessors so a just-dropped card reads back
 * the status it was dropped on; everywhere else the defaults (the stored
 * values) are what you want.
 */
export function wireProjectMenu(
	plugin: TeamManagerPlugin,
	el: HTMLElement,
	project: Project,
	opts: {
		currentStatus?: (p: Project) => string;
		onStatus?: (p: Project, status: string) => void;
		isActive?: (p: Project) => boolean;
	} = {}
): void {
	el.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		const current = opts.currentStatus?.(project) ?? project.status;
		for (const status of plugin.store.getProjectStatuses()) {
			menu.addItem((item) =>
				item
					.setTitle(statusLabel(status))
					.setChecked(status === current)
					.onClick(() => {
						if (opts.onStatus) opts.onStatus(project, status);
						else void setProjectStatus(plugin, project, status);
					})
			);
		}
		menu.addSeparator();
		const active =
			opts.isActive?.(project) ?? plugin.store.isProjectActive(project);
		if (active) {
			menu.addItem((item) =>
				item
					.setTitle("Add update")
					.setIcon("plus")
					.onClick(() => plugin.addProjectLogFor(project))
			);
		}
		addNoteMenuItems(plugin, menu, project.file);
		menu.showAtMouseEvent(e);
	});
}

/**
 * The status pill as a control: click opens the status menu. Used wherever a
 * project row shows its status, so every surface can change it in place.
 */
export function renderStatusPill(
	plugin: TeamManagerPlugin,
	parent: HTMLElement,
	project: Project
): HTMLElement {
	const pill = parent.createEl("button", {
		text: `${project.status} ▾`,
		cls: `tm-pill tm-pill-btn tm-pill-status-${statusSlug(project.status)}`,
	});
	pill.setAttr("aria-label", "Change status");
	pill.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		openStatusMenu(plugin, project, e);
	};
	return pill;
}
