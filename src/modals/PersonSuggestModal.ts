import { App, FuzzySuggestModal } from "obsidian";
import { Person } from "../types";

/**
 * Fuzzy picker over the current list of people.
 *
 * `onCancel` fires when the modal closes without a choice (ESC / click-away),
 * which chained flows (quick capture) need to resolve their promises.
 */
export class PersonSuggestModal extends FuzzySuggestModal<Person> {
	private chosen = false;

	constructor(
		app: App,
		private people: Person[],
		private onChoose: (person: Person) => void,
		private onCancel?: () => void
	) {
		super(app);
		this.setPlaceholder("Search for a person...");
	}

	getItems(): Person[] {
		return this.people;
	}

	getItemText(person: Person): string {
		const parts = [person.name];
		if (person.role) parts.push(person.role);
		if (person.team) parts.push(person.team);
		return parts.join(" · ");
	}

	selectSuggestion(
		value: Parameters<FuzzySuggestModal<Person>["selectSuggestion"]>[0],
		evt: MouseEvent | KeyboardEvent
	): void {
		// Flag before close: close/choose ordering is not guaranteed.
		this.chosen = true;
		super.selectSuggestion(value, evt);
	}

	onChooseItem(person: Person): void {
		this.onChoose(person);
	}

	onClose(): void {
		super.onClose();
		// Deferred so a legitimate choice (which also closes) wins the race.
		window.setTimeout(() => {
			if (!this.chosen) this.onCancel?.();
		}, 0);
	}
}
