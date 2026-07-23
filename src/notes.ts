import { App, TFile, normalizePath } from "obsidian";
import type { TeamManagerSettings } from "./settings";
import {
	HUB_BLOCK_SNIPPET,
	MEETING_AGENDA_HEADING,
	PERF_OBSERVATIONS_HEADING,
	PROJECT_BLOCK_SNIPPET,
} from "./constants";
import { Person } from "./types";

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Suggests a period label for a new performance note, e.g. "2026-H1". */
export function suggestPeriod(): string {
	const now = new Date();
	const half = now.getMonth() < 6 ? "H1" : "H2";
	return `${now.getFullYear()}-${half}`;
}

/**
 * Where a plugin folder lives: `<baseFolder>/<sub>`, or just `<sub>` when the
 * base is empty (flat at the vault root).
 */
export function folderFor(settings: TeamManagerSettings, sub: string): string {
	const base = settings.baseFolder.trim();
	const clean = sub.trim();
	if (!base || base === "/") return normalizePath(clean);
	if (!clean) return normalizePath(base);
	return normalizePath(`${base}/${clean}`);
}

/** Create a folder and every missing parent above it. */
export async function ensureFolder(app: App, folder: string): Promise<void> {
	const path = normalizePath(folder);
	if (!path || path === "/") return;
	// Walk the segments: nested paths need their parents to exist first.
	let acc = "";
	for (const part of path.split("/")) {
		if (!part) continue;
		acc = acc ? `${acc}/${part}` : part;
		if (app.vault.getAbstractFileByPath(acc)) continue;
		try {
			await app.vault.createFolder(acc);
		} catch {
			// Race or already-exists: ignore.
		}
	}
}

/** Return a path that doesn't collide, appending " 2", " 3", ... if needed. */
function uniquePath(app: App, folder: string, base: string): string {
	const dir = normalizePath(folder);
	let candidate = normalizePath(`${dir}/${base}.md`);
	let n = 2;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${dir}/${base} ${n}.md`);
		n++;
	}
	return candidate;
}

/** Strip characters that are illegal in note titles / paths. */
function sanitizeName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
}

export async function createPersonNote(
	app: App,
	settings: TeamManagerSettings,
	rawName: string
): Promise<TFile | null> {
	const name = sanitizeName(rawName);
	if (!name) return null;

	const dir = folderFor(settings, settings.peopleFolder);
	const existing = app.vault.getAbstractFileByPath(
		normalizePath(`${dir}/${name}.md`)
	);
	if (existing instanceof TFile) return existing;

	await ensureFolder(app, folderFor(settings, settings.peopleFolder));
	const path = uniquePath(app, folderFor(settings, settings.peopleFolder), name);
	const body = [
		"---",
		"type: person",
		"role: ",
		"team: ",
		"status: active",
		"relation: team",
		"cadence: ",
		"---",
		"",
		HUB_BLOCK_SNIPPET,
		"",
		`## ${settings.agendaHeading}`,
		"",
		`## ${settings.observationsHeading}`,
		"",
		"## About",
		"",
	].join("\n");
	return app.vault.create(path, body);
}

export async function createMeetingNote(
	app: App,
	settings: TeamManagerSettings,
	person: Person,
	agendaItems: string[]
): Promise<TFile> {
	await ensureFolder(app, folderFor(settings, settings.meetingsFolder));
	const date = todayISO();
	const base = `${date} ${person.name}`;
	const path = uniquePath(app, folderFor(settings, settings.meetingsFolder), base);

	const agenda =
		agendaItems.length > 0
			? agendaItems.map((i) => `- ${i}`).join("\n")
			: "- ";

	const body = [
		"---",
		"type: meeting",
		`person: "[[${person.name}]]"`,
		`date: ${date}`,
		"---",
		"",
		`## ${MEETING_AGENDA_HEADING}`,
		agenda,
		"",
		"## Notes",
		"",
		"",
		"## Action items",
		"- [ ] ",
		"",
	].join("\n");

	return app.vault.create(path, body);
}

export async function createPerformanceNote(
	app: App,
	settings: TeamManagerSettings,
	person: Person,
	period: string,
	observations: string[] = []
): Promise<TFile> {
	await ensureFolder(app, folderFor(settings, settings.performanceFolder));
	const safePeriod = sanitizeName(period) || suggestPeriod();
	const base = `${person.name} - ${safePeriod}`;
	const path = uniquePath(app, folderFor(settings, settings.performanceFolder), base);

	const obsSection =
		observations.length > 0
			? [
					`## ${PERF_OBSERVATIONS_HEADING}`,
					...observations.map((o) => `- ${o}`),
					"",
					"",
				]
			: [];

	const body = [
		"---",
		"type: performance",
		`person: "[[${person.name}]]"`,
		`period: ${safePeriod}`,
		`date: ${todayISO()}`,
		"rating: ",
		"---",
		"",
		...obsSection,
		"## Highlights",
		"",
		"",
		"## Development areas",
		"",
		"",
		"## Goals for next period",
		"",
	].join("\n");

	return app.vault.create(path, body);
}

export async function createProjectNote(
	app: App,
	settings: TeamManagerSettings,
	rawName: string,
	people: Person[]
): Promise<TFile | null> {
	const name = sanitizeName(rawName);
	if (!name) return null;

	await ensureFolder(app, folderFor(settings, settings.projectsFolder));
	const path = uniquePath(app, folderFor(settings, settings.projectsFolder), name);

	const peopleLines =
		people.length > 0
			? ["people:", ...people.map((p) => `  - "[[${p.name}]]"`)]
			: ["people: []"];

	const body = [
		"---",
		"type: project",
		`status: ${settings.projectStatuses[0] ?? "backlog"}`,
		...peopleLines,
		"priority: ",
		"---",
		"",
		PROJECT_BLOCK_SNIPPET,
		"",
		"## About",
		"",
		"",
		`## ${settings.logHeading}`,
		`- ${todayISO()}: project created`,
		"",
	].join("\n");

	return app.vault.create(path, body);
}
