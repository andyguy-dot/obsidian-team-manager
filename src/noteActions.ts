import { Menu, Notice, TFile } from "obsidian";
import type TeamManagerPlugin from "./main";

/**
 * Delete through Obsidian's own prompt: it honours the vault's "Deleted files"
 * setting (system trash / .trash / permanent) and the user's confirmation
 * preference, so this never invents a second, divergent delete experience.
 */
export async function deleteNote(
	plugin: TeamManagerPlugin,
	file: TFile
): Promise<void> {
	const name = file.basename;
	const confirmed = await plugin.app.fileManager.promptForDeletion(file);
	if (!confirmed) return;
	new Notice(`Deleted ${name}`);
	plugin.refreshViews();
}

/** "Open note" + "Delete": the tail every note row's menu shares. */
export function addNoteMenuItems(
	plugin: TeamManagerPlugin,
	menu: Menu,
	file: TFile
): void {
	menu.addItem((item) =>
		item
			.setTitle("Open note")
			.setIcon("file-text")
			.onClick(() => {
				plugin.app.workspace.getLeaf(false).openFile(file);
			})
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Delete")
			.setIcon("trash")
			.setWarning(true)
			.onClick(() => void deleteNote(plugin, file))
	);
}

/** Right-click menu for a plain note row (1:1, performance). */
export function wireNoteMenu(
	plugin: TeamManagerPlugin,
	el: HTMLElement,
	file: TFile
): void {
	el.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		addNoteMenuItems(plugin, menu, file);
		menu.showAtMouseEvent(e);
	});
}
