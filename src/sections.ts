import { App, TFile } from "obsidian";

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Section {
	headingLine: number;
	/** First content line (after the heading). */
	start: number;
	/** Exclusive end: the next heading of same-or-higher level, or EOF. */
	end: number;
}

/** Locate a heading whose text matches `heading` and the bounds of its section. */
function findSection(lines: string[], heading: string): Section | null {
	const re = new RegExp(`^(#{1,6})\\s+${escapeRegex(heading)}\\s*$`);
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(re);
		if (!m) continue;
		const level = m[1].length;
		let end = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			const hm = lines[j].match(/^(#{1,6})\s+/);
			if (hm && hm[1].length <= level) {
				end = j;
				break;
			}
		}
		return { headingLine: i, start: i + 1, end };
	}
	return null;
}

const BULLET_RE = /^\s*[-*+]\s+(.*)$/;

function bulletsIn(lines: string[], sec: Section): string[] {
	const items: string[] = [];
	for (let i = sec.start; i < sec.end; i++) {
		const m = lines[i].match(BULLET_RE);
		if (m && m[1].trim()) items.push(m[1].trim());
	}
	return items;
}

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Pure: extract bullets under `heading` from already-read content. */
export function sectionBulletsOf(content: string, heading: string): string[] {
	const lines = content.split("\n");
	const sec = findSection(lines, heading);
	return sec ? bulletsIn(lines, sec) : [];
}

/** Pure: the most recent YYYY-MM-DD bullet prefix under `heading`, if any. */
export function lastDateInSection(
	content: string,
	heading: string
): string | undefined {
	return lastDatedBulletInSection(content, heading)?.date;
}

const DATED_BULLET_FULL_RE = /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})\s*:?\s*(.*)$/;

/** Pure: the most recent dated bullet (date + text) under `heading`.
 *  Ties on date resolve to the later line (logs append chronologically). */
export function lastDatedBulletInSection(
	content: string,
	heading: string
): { date: string; text: string } | undefined {
	const lines = content.split("\n");
	const sec = findSection(lines, heading);
	if (!sec) return undefined;
	let best: { date: string; text: string } | undefined;
	for (let i = sec.start; i < sec.end; i++) {
		const m = lines[i].match(DATED_BULLET_FULL_RE);
		if (m && (!best || m[1] >= best.date)) {
			best = { date: m[1], text: m[2].trim() };
		}
	}
	return best;
}

/** Return the bullets (text only) under `heading` in a note. */
export async function readSectionBullets(
	app: App,
	file: TFile,
	heading: string
): Promise<string[]> {
	const content = await app.vault.cachedRead(file);
	return sectionBulletsOf(content, heading);
}

/** Append one bullet under `heading`, creating the section if absent. */
export async function appendToSection(
	app: App,
	file: TFile,
	heading: string,
	item: string
): Promise<void> {
	const bullet = `- ${item.trim()}`;
	await app.vault.process(file, (content) => {
		const lines = content.split("\n");
		const sec = findSection(lines, heading);
		if (sec) {
			let insertAt = sec.end;
			// Skip trailing blank lines so the bullet sits under the existing ones.
			while (insertAt > sec.start && lines[insertAt - 1].trim() === "") {
				insertAt--;
			}
			lines.splice(insertAt, 0, bullet);
		} else {
			if (lines.length && lines[lines.length - 1].trim() !== "") {
				lines.push("");
			}
			lines.push(`## ${heading}`, bullet);
		}
		return lines.join("\n");
	});
}

/** Append a `- YYYY-MM-DD: text` bullet (observations, project logs). */
export async function appendDatedToSection(
	app: App,
	file: TFile,
	heading: string,
	text: string
): Promise<void> {
	await appendToSection(app, file, heading, `${todayISO()}: ${text.trim()}`);
}

/** Tick a `- [ ]` task at `line`, leaving the rest of the note untouched. */
export async function toggleTaskLine(
	app: App,
	file: TFile,
	line: number
): Promise<void> {
	await app.vault.process(file, (content) => {
		const lines = content.split("\n");
		const target = lines[line];
		// Guard: the line may have moved since the index was built.
		if (target && /\[ \]/.test(target)) {
			lines[line] = target.replace(/\[ \]/, "[x]");
		}
		return lines.join("\n");
	});
}

/** Read the bullets under `heading` and clear the section, keeping the heading. */
export async function consumeSectionBullets(
	app: App,
	file: TFile,
	heading: string
): Promise<string[]> {
	let items: string[] = [];
	await app.vault.process(file, (content) => {
		const lines = content.split("\n");
		const sec = findSection(lines, heading);
		if (!sec) return content;
		items = bulletsIn(lines, sec);
		lines.splice(sec.start, sec.end - sec.start);
		return lines.join("\n");
	});
	return items;
}
