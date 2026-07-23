import type TeamManagerPlugin from "./main";
import { Person } from "./types";
import { CaptureModal } from "./modals/CaptureModal";

/** The universal quick capture: one modal, choices made in place. */
export async function runQuickCapture(plugin: TeamManagerPlugin): Promise<void> {
	await plugin.store.refresh();
	if (plugin.store.getPeople().length === 0) {
		plugin.commandNewPerson();
		return;
	}
	new CaptureModal(plugin, null).open();
}

/** Quick capture with the person already known (person hub button). */
export async function runQuickCaptureFor(
	plugin: TeamManagerPlugin,
	person: Person
): Promise<void> {
	new CaptureModal(plugin, person).open();
}
