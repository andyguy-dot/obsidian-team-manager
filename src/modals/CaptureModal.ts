import { Modal, Notice } from "obsidian";
import type TeamManagerPlugin from "../main";
import {
	MEETING_AGENDA_HEADING,
	PERF_OBSERVATIONS_HEADING,
} from "../constants";
import { appendDatedToSection, appendToSection } from "../sections";
import { InlineSuggest } from "./InlineSuggest";
import { Meeting, PerformanceNote, Person, Project } from "../types";

type CaptureType = "meeting" | "performance" | "project";

/**
 * The whole quick-capture flow in ONE modal: pick the type, the person or
 * project, the destination and the text, all in place — no modal chain.
 */
export class CaptureModal extends Modal {
	private type: CaptureType = "meeting";
	private person: Person | null;
	private project: Project | null = null;
	/** null = "next 1:1" buffer. */
	private meetingTarget: Meeting | null = null;
	/** null = observations buffer (next review). */
	private perfTarget: PerformanceNote | null = null;
	private text = "";

	private bodyEl!: HTMLElement;
	private typeButtons = new Map<CaptureType, HTMLButtonElement>();
	private textArea: HTMLTextAreaElement | null = null;

	constructor(
		private plugin: TeamManagerPlugin,
		private seeded: Person | null
	) {
		super(plugin.app);
		this.person = seeded;
	}

	// --- Availability -------------------------------------------------------

	private disabledReason(type: CaptureType): string | undefined {
		if (type === "project") {
			const pool = this.projectPool();
			return pool.length > 0 ? undefined : "no active projects";
		}
		return undefined;
	}

	private projectPool(): Project[] {
		return this.seeded
			? this.seeded.activeProjects
			: this.plugin.store.getActiveProjects();
	}

	private peoplePool(): Person[] {
		return this.plugin.store.getPeople();
	}

	// --- Layout ---------------------------------------------------------------

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tm-capture-modal");
		contentEl.createEl("h3", {
			text: this.seeded
				? `Capture for ${this.seeded.name}`
				: "Quick capture",
			cls: "tm-dest-title",
		});

		this.renderTypeRow(contentEl);
		this.bodyEl = contentEl.createDiv();
		this.renderBody(true);

		const footer = contentEl.createDiv({ cls: "tm-cap-footer" });
		footer.createEl("span", {
			text: "Ctrl+Enter to add · 1/2/3 to switch type",
			cls: "tm-cap-hint tm-muted",
		});
		const submit = footer.createEl("button", { text: "Add" });
		submit.addClass("mod-cta");
		submit.onclick = () => void this.submit();

		// Bare number keys only act outside text fields.
		const typeKeys: [string, CaptureType][] = [
			["1", "meeting"],
			["2", "performance"],
			["3", "project"],
		];
		for (const [key, type] of typeKeys) {
			this.scope.register([], key, (evt) => {
				const t = evt.target;
				if (
					t instanceof HTMLInputElement ||
					t instanceof HTMLTextAreaElement
				) {
					return true;
				}
				this.setType(type);
				return false;
			});
		}
		this.scope.register(["Mod"], "Enter", () => {
			void this.submit();
			return false;
		});
	}

	private renderTypeRow(root: HTMLElement): void {
		const row = root.createDiv({ cls: "tm-cap-types" });
		const defs: [CaptureType, string, string][] = [
			["meeting", "💬", "1:1"],
			["performance", "🌟", "Performance"],
			["project", "📁", "Project"],
		];
		for (const [type, icon, label] of defs) {
			const reason = this.disabledReason(type);
			const btn = row.createEl("button", { cls: "tm-cap-type" });
			btn.createEl("kbd", {
				text: defs.findIndex((d) => d[0] === type) + 1 + "",
				cls: "tm-dest-key",
			});
			btn.createSpan({ text: `${icon} ${label}` });
			if (reason) {
				btn.addClass("is-disabled");
				btn.setAttr("aria-disabled", "true");
				btn.setAttr("title", reason);
			} else {
				btn.onclick = () => this.setType(type);
			}
			this.typeButtons.set(type, btn);
		}
		this.paintTypeRow();
	}

	private paintTypeRow(): void {
		for (const [type, btn] of this.typeButtons) {
			btn.toggleClass("is-active", type === this.type);
		}
	}

	private setType(type: CaptureType): void {
		if (this.disabledReason(type) || type === this.type) return;
		this.type = type;
		this.paintTypeRow();
		this.renderBody(true);
	}

	private renderBody(focusFirst: boolean): void {
		this.bodyEl.empty();

		if (this.type === "project") {
			const input = this.renderProjectField();
			this.renderTextField("What happened?");
			if (focusFirst) {
				window.setTimeout(() => {
					(this.project ? this.textArea : input)?.focus();
				}, 0);
			}
			return;
		}

		const input = this.renderPersonField();
		if (this.type === "meeting") this.renderMeetingTargetField();
		else this.renderPerfTargetField();
		this.renderTextField(
			this.type === "meeting"
				? "What do you want to discuss?"
				: "What did you notice?"
		);
		if (focusFirst) {
			window.setTimeout(() => {
				(this.person ? this.textArea : input)?.focus();
			}, 0);
		}
	}

	// --- Fields ----------------------------------------------------------------

	private fieldRow(label: string): HTMLElement {
		const row = this.bodyEl.createDiv({ cls: "tm-cap-row" });
		row.createEl("div", { text: label, cls: "tm-cap-label" });
		return row;
	}

	private renderPersonField(): HTMLInputElement {
		const row = this.fieldRow("Person");
		const input = row.createEl("input", {
			type: "text",
			cls: "tm-cap-input",
		});
		input.placeholder = "Search person...";
		input.value = this.person?.name ?? "";
		new InlineSuggest<Person>(
			this.app,
			input,
			() => this.peoplePool(),
			(p) => [p.name, p.role, p.team].filter(Boolean).join(" · "),
			(p) => p.name,
			(p) => {
				this.person = p;
				// Targets belong to the person; reset on change.
				this.meetingTarget = null;
				this.perfTarget = null;
				this.renderBody(false);
				window.setTimeout(() => this.textArea?.focus(), 0);
			}
		);
		// Typing after a pick invalidates it until something is picked again.
		input.addEventListener("input", () => {
			if (this.person && input.value !== this.person.name) {
				this.person = null;
			}
		});
		return input;
	}

	private renderProjectField(): HTMLInputElement {
		const pool = this.projectPool();
		if (!this.project && pool.length === 1) this.project = pool[0];

		const row = this.fieldRow("Project");
		const input = row.createEl("input", {
			type: "text",
			cls: "tm-cap-input",
		});
		input.placeholder = "Search project...";
		input.value = this.project?.name ?? "";
		new InlineSuggest<Project>(
			this.app,
			input,
			() => this.projectPool(),
			(p) =>
				[
					p.name,
					p.status,
					p.daysSinceLastLog == null
						? "no log"
						: `last log ${p.daysSinceLastLog}d ago`,
				].join(" · "),
			(p) => p.name,
			(p) => {
				this.project = p;
				window.setTimeout(() => this.textArea?.focus(), 0);
			}
		);
		input.addEventListener("input", () => {
			if (this.project && input.value !== this.project.name) {
				this.project = null;
			}
		});
		return input;
	}

	private renderMeetingTargetField(): void {
		const row = this.fieldRow("Destination");
		const select = row.createEl("select", { cls: "dropdown tm-cap-select" });
		select.createEl("option", {
			text: "📥 Next 1:1 (buffer)",
			value: "-1",
		});
		const meetings = this.person?.meetings ?? [];
		meetings.forEach((m, i) => {
			const opt = select.createEl("option", {
				text: `💬 ${m.date ?? "no date"} · ${m.file.basename}`,
				value: String(i),
			});
			if (this.meetingTarget === m) opt.selected = true;
		});
		select.disabled = !this.person;
		select.onchange = () => {
			const i = Number(select.value);
			this.meetingTarget = i >= 0 ? meetings[i] : null;
		};
	}

	private renderPerfTargetField(): void {
		const row = this.fieldRow("Destination");
		const select = row.createEl("select", { cls: "dropdown tm-cap-select" });
		select.createEl("option", {
			text: "🌟 Observations (next review)",
			value: "-1",
		});
		const notes = this.person?.performance ?? [];
		notes.forEach((n, i) => {
			const opt = select.createEl("option", {
				text: `📄 ${n.period ?? n.file.basename}${n.rating ? ` · ${n.rating}` : ""}`,
				value: String(i),
			});
			if (this.perfTarget === n) opt.selected = true;
		});
		select.disabled = !this.person;
		select.onchange = () => {
			const i = Number(select.value);
			this.perfTarget = i >= 0 ? notes[i] : null;
		};
	}

	private renderTextField(placeholder: string): void {
		const row = this.fieldRow("Text");
		const ta = row.createEl("textarea", { cls: "tm-cap-textarea" });
		ta.placeholder = placeholder;
		ta.rows = 3;
		ta.value = this.text;
		ta.addEventListener("input", () => (this.text = ta.value));
		this.textArea = ta;
	}

	// --- Submit -----------------------------------------------------------------

	private async submit(): Promise<void> {
		const text = this.text.trim();
		if (!text) {
			new Notice("Write something to capture.");
			this.textArea?.focus();
			return;
		}
		const settings = this.plugin.settings;

		if (this.type === "project") {
			if (!this.project) {
				new Notice("Pick a project.");
				return;
			}
			await appendDatedToSection(
				this.app,
				this.project.file,
				settings.logHeading,
				text
			);
			new Notice(`📁 Log added to ${this.project.name}`);
		} else if (this.type === "meeting") {
			if (!this.person) {
				new Notice("Pick a person.");
				return;
			}
			if (this.meetingTarget) {
				await appendToSection(
					this.app,
					this.meetingTarget.file,
					MEETING_AGENDA_HEADING,
					text
				);
				new Notice(
					`💬 Added to the agenda of ${this.meetingTarget.date ?? this.meetingTarget.file.basename}`
				);
			} else {
				await appendToSection(
					this.app,
					this.person.file,
					settings.agendaHeading,
					text
				);
				new Notice(`💬 Added to next 1:1 with ${this.person.name}`);
			}
		} else {
			if (!this.person) {
				new Notice("Pick a person.");
				return;
			}
			if (this.perfTarget) {
				await appendDatedToSection(
					this.app,
					this.perfTarget.file,
					PERF_OBSERVATIONS_HEADING,
					text
				);
				new Notice(
					`🌟 Added to review ${this.perfTarget.period ?? this.perfTarget.file.basename}`
				);
			} else {
				await appendDatedToSection(
					this.app,
					this.person.file,
					settings.observationsHeading,
					text
				);
				new Notice(`🌟 Observation logged for ${this.person.name}`);
			}
		}

		this.close();
		this.plugin.refreshViews();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
