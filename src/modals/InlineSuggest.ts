import { AbstractInputSuggest, App } from "obsidian";

/** Inline autocomplete attached to a text input inside a modal. */
export class InlineSuggest<T> extends AbstractInputSuggest<T> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private itemsFn: () => T[],
		/** Text shown in the dropdown and matched against the query. */
		private toText: (t: T) => string,
		/** Text written into the input after picking (empty string clears it). */
		private toValue: (t: T) => string,
		private pick: (t: T) => void
	) {
		super(app, inputEl);
		this.onSelect((value) => {
			this.setValue(this.toValue(value));
			this.close();
			this.pick(value);
		});
	}

	protected getSuggestions(query: string): T[] {
		const q = query.toLowerCase();
		return this.itemsFn().filter((t) =>
			this.toText(t).toLowerCase().includes(q)
		);
	}

	renderSuggestion(value: T, el: HTMLElement): void {
		el.setText(this.toText(value));
	}
}
