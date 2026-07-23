import { App, Modal, Setting } from "obsidian";

interface TextPromptOptions {
	title: string;
	placeholder?: string;
	cta?: string;
	multiline?: boolean;
	initialValue?: string;
}

/** A small modal that asks for a single line (or block) of text. */
export class TextPromptModal extends Modal {
	private value: string;
	private submitted = false;

	constructor(
		app: App,
		private opts: TextPromptOptions,
		private onSubmit: (value: string) => void | Promise<void>,
		private onCancel?: () => void
	) {
		super(app);
		this.value = opts.initialValue ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.opts.title });

		const submit = () => {
			const v = this.value.trim();
			if (!v) return;
			this.submitted = true;
			this.close();
			void this.onSubmit(v);
		};

		if (this.opts.multiline) {
			const ta = contentEl.createEl("textarea", {
				cls: "tm-prompt-textarea",
			});
			ta.placeholder = this.opts.placeholder ?? "";
			ta.value = this.value;
			ta.rows = 4;
			ta.addEventListener("input", () => (this.value = ta.value));
			ta.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => ta.focus(), 0);
		} else {
			new Setting(contentEl).addText((t) => {
				t.setPlaceholder(this.opts.placeholder ?? "");
				t.setValue(this.value);
				t.onChange((v) => (this.value = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						submit();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		}

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(this.opts.cta ?? "Save")
				.setCta()
				.onClick(submit)
		);
	}

	onClose(): void {
		this.contentEl.empty();
		window.setTimeout(() => {
			if (!this.submitted) this.onCancel?.();
		}, 0);
	}
}
