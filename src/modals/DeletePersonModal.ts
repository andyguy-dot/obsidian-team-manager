import { Modal, Notice } from "obsidian";
import type TeamManagerPlugin from "../main";
import { stripLink } from "../data";
import { Person } from "../types";

/**
 * Deleting a person is the one delete with fallout: their 1:1s and reviews
 * point at a note that no longer exists, and the plugin stops indexing them.
 * So instead of a bare confirm, show exactly what hangs off this person and
 * let the user decide what happens to it.
 *
 * Projects are never deleted — a project can be shared, so the person is just
 * removed from its owners.
 */
export class DeletePersonModal extends Modal {
	constructor(
		private plugin: TeamManagerPlugin,
		private person: Person
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		const p = this.person;
		contentEl.addClass("tm-capture-modal");
		contentEl.createEl("h3", { text: `Delete ${p.name}?` });

		const meetings = p.meetings.length;
		const reviews = p.performance.length;
		const projects = p.projects.length;

		contentEl.createEl("p", {
			text: "This person is linked to:",
			cls: "tm-muted",
		});
		const list = contentEl.createEl("ul", { cls: "tm-del-list" });
		if (meetings > 0) {
			list.createEl("li", {
				text: `💬 ${meetings} one-on-one${meetings > 1 ? "s" : ""}`,
			});
		}
		if (reviews > 0) {
			list.createEl("li", {
				text: `🌟 ${reviews} performance review${reviews > 1 ? "s" : ""}`,
			});
		}
		if (projects > 0) {
			list.createEl("li", {
				text: `📁 ${projects} project${projects > 1 ? "s" : ""} — kept, but ${p.name} is removed from the owners`,
			});
		}

		const cascadeCount = meetings + reviews;
		contentEl.createEl("p", {
			text:
				cascadeCount > 0
					? "Deleted notes follow your vault's \"Deleted files\" setting, so they're as recoverable as any other delete."
					: "The note follows your vault's \"Deleted files\" setting.",
			cls: "tm-muted tm-del-hint",
		});

		const row = contentEl.createDiv({ cls: "tm-cap-footer tm-del-actions" });
		const cancel = row.createEl("button", { text: "Cancel" });
		cancel.onclick = () => this.close();

		const only = row.createEl("button", { text: "Delete person only" });
		only.addClass("mod-warning");
		only.onclick = () => {
			this.close();
			void this.run(false);
		};

		if (cascadeCount > 0) {
			const all = row.createEl("button", {
				text: `Delete person + ${cascadeCount} note${cascadeCount > 1 ? "s" : ""}`,
			});
			all.addClass("mod-warning");
			all.onclick = () => {
				this.close();
				void this.run(true);
			};
		}

		// Destructive: the safe option takes the focus.
		window.setTimeout(() => cancel.focus(), 0);
	}

	private async run(cascade: boolean): Promise<void> {
		const { plugin, person } = this;
		const fm = plugin.app.fileManager;
		const name = person.name;
		let trashed = 0;

		try {
			// Unlink from projects first: a shared project must outlive them.
			for (const project of person.projects) {
				await fm.processFrontMatter(
					project.file,
					(front: { people?: unknown }) => {
					const raw = Array.isArray(front.people)
						? front.people
						: front.people != null
							? [front.people]
							: [];
					front.people = raw.filter((entry: unknown) => {
						const link = stripLink(entry);
						if (!link) return true;
						const dest = plugin.app.metadataCache.getFirstLinkpathDest(
							link,
							project.file.path
						);
						return dest?.path !== person.file.path;
					});
				});
			}

			if (cascade) {
				for (const m of person.meetings) {
					await fm.trashFile(m.file);
					trashed++;
				}
				for (const perf of person.performance) {
					await fm.trashFile(perf.file);
					trashed++;
				}
			}

			await fm.trashFile(person.file);
		} catch (err) {
			new Notice(`Couldn't fully delete ${name}. Check the console.`);
			console.error("[team-manager] person delete failed", err);
			plugin.refreshViews();
			return;
		}

		new Notice(
			trashed > 0
				? `Deleted ${name} and ${trashed} note${trashed > 1 ? "s" : ""}`
				: `Deleted ${name}`
		);
		plugin.refreshViews();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
