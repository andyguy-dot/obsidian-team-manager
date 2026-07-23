import { Menu, Notice } from "obsidian";
import type TeamManagerPlugin from "./main";
import { relationLabel } from "./data";
import { DeletePersonModal } from "./modals/DeletePersonModal";
import { Person, Relation } from "./types";

/**
 * Delete a person. With nothing linked this is a plain note delete, so hand it
 * to Obsidian's own prompt; otherwise the fallout needs spelling out first.
 */
export async function deletePerson(
	plugin: TeamManagerPlugin,
	person: Person
): Promise<void> {
	const linked =
		person.meetings.length +
		person.performance.length +
		person.projects.length;
	if (linked === 0) {
		const confirmed = await plugin.app.fileManager.promptForDeletion(
			person.file
		);
		if (!confirmed) return;
		new Notice(`Deleted ${person.name}`);
		plugin.refreshViews();
		return;
	}
	new DeletePersonModal(plugin, person).open();
}

/** Right-click a person: open the hub or the note, change relation, delete. */
export function wirePersonMenu(
	plugin: TeamManagerPlugin,
	el: HTMLElement,
	person: Person
): void {
	el.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Open hub")
				.setIcon("user")
				.onClick(() => void plugin.openPerson(person.file))
		);
		menu.addItem((item) =>
			item
				.setTitle("Open note")
				.setIcon("file-text")
				.onClick(() => {
					void plugin.app.workspace.getLeaf(false).openFile(person.file);
				})
		);
		menu.addSeparator();
		for (const rel of plugin.store.getRelationOrder()) {
			menu.addItem((item) =>
				item
					.setTitle(relationLabel(rel))
					.setChecked(rel === person.relation)
					.onClick(() => void setPersonRelation(plugin, person, rel))
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.setWarning(true)
				.onClick(() => void deletePerson(plugin, person))
		);
		menu.showAtMouseEvent(e);
	});
}

/** Persist a relation change by rewriting only the note's frontmatter. */
export async function setPersonRelation(
	plugin: TeamManagerPlugin,
	person: Person,
	relation: Relation
): Promise<void> {
	if (person.relation === relation) return;
	try {
		await plugin.app.fileManager.processFrontMatter(
			person.file,
			(fm: { relation?: unknown }) => {
			fm.relation = relation;
		});
	} catch (err) {
		new Notice(`Couldn't update ${person.name}'s relation.`);
		console.error("[team-manager] relation write failed", err);
		return;
	}
	plugin.refreshViews();
}

/**
 * The relation as a control: click opens a menu with the relation options.
 * Same pattern as the project status pill, for the same reason — frontmatter
 * is free text, and a typo would silently drop the person into "team".
 */
export function renderRelationPill(
	plugin: TeamManagerPlugin,
	parent: HTMLElement,
	person: Person
): HTMLElement {
	const pill = parent.createEl("button", {
		text: `${relationLabel(person.relation)} ▾`,
		cls: "tm-pill tm-pill-btn tm-pill-relation",
	});
	pill.setAttr("aria-label", "Change relation");
	pill.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		for (const rel of plugin.store.getRelationOrder()) {
			menu.addItem((item) =>
				item
					.setTitle(relationLabel(rel))
					.setChecked(rel === person.relation)
					.onClick(() => void setPersonRelation(plugin, person, rel))
			);
		}
		menu.showAtMouseEvent(e);
	};
	return pill;
}
