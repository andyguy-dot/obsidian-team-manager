import { Modal, Notice } from "obsidian";
import type TeamManagerPlugin from "../main";
import { renderAvatar } from "../avatar";
import { createProjectNote } from "../notes";
import { InlineSuggest } from "./InlineSuggest";
import { Person } from "../types";

/** Name + owners for a new project. Owners are a list, so it takes several. */
export class NewProjectModal extends Modal {
	private name = "";
	private owners: Person[] = [];
	private chipsEl!: HTMLElement;

	constructor(
		private plugin: TeamManagerPlugin,
		seeded: Person | null
	) {
		super(plugin.app);
		if (seeded) this.owners = [seeded];
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tm-capture-modal");
		contentEl.createEl("h3", { text: "New project", cls: "tm-dest-title" });

		const nameRow = this.fieldRow("Name");
		const nameInput = nameRow.createEl("input", {
			type: "text",
			cls: "tm-cap-input",
		});
		nameInput.placeholder = "Project name";
		nameInput.addEventListener("input", () => (this.name = nameInput.value));
		nameInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void this.submit();
			}
		});
		window.setTimeout(() => nameInput.focus(), 0);

		const ownerRow = this.fieldRow("Owners");
		this.chipsEl = ownerRow.createDiv({
			cls: "tm-projblk-people tm-cap-chips",
		});
		const ownerInput = ownerRow.createEl("input", {
			type: "text",
			cls: "tm-cap-input",
		});
		ownerInput.placeholder = "Search person...";
		new InlineSuggest<Person>(
			this.app,
			ownerInput,
			() =>
				this.plugin.store
					.getPeople()
					.filter(
						(p) =>
							!this.owners.some((o) => o.file.path === p.file.path)
					),
			(p) => [p.name, p.role, p.team].filter(Boolean).join(" · "),
			() => "", // clear the box so the next owner can be typed right away
			(p) => {
				this.owners.push(p);
				this.renderChips();
			}
		);
		this.renderChips();

		const footer = contentEl.createDiv({ cls: "tm-cap-footer" });
		footer.createEl("span", {
			text: "Enter creates",
			cls: "tm-cap-hint tm-muted",
		});
		const create = footer.createEl("button", { text: "Create" });
		create.addClass("mod-cta");
		create.onclick = () => void this.submit();
	}

	private fieldRow(label: string): HTMLElement {
		const row = this.contentEl.createDiv({ cls: "tm-cap-row" });
		row.createEl("div", { text: label, cls: "tm-cap-label" });
		return row;
	}

	private renderChips(): void {
		this.chipsEl.empty();
		if (this.owners.length === 0) {
			this.chipsEl.createEl("span", {
				text: "nobody yet",
				cls: "tm-muted",
			});
			return;
		}
		for (const p of this.owners) {
			const chip = this.chipsEl.createDiv({ cls: "tm-projblk-person" });
			renderAvatar(chip, p.name, true);
			chip.createSpan({ text: p.name });
			const x = chip.createEl("span", { text: "×", cls: "tm-chip-x" });
			x.setAttr("aria-label", `Remove ${p.name}`);
			x.onclick = () => {
				this.owners = this.owners.filter(
					(o) => o.file.path !== p.file.path
				);
				this.renderChips();
			};
		}
	}

	private async submit(): Promise<void> {
		const name = this.name.trim();
		if (!name) {
			new Notice("Give the project a name.");
			return;
		}
		const file = await createProjectNote(
			this.app,
			this.plugin.settings,
			name,
			this.owners
		);
		this.close();
		if (file) {
			await this.app.workspace.getLeaf(false).openFile(file);
			this.plugin.refreshViews();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
