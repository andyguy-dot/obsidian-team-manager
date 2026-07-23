import { App, TFile, normalizePath } from "obsidian";
import type { TeamManagerSettings } from "./settings";
import { folderFor } from "./notes";
import {
	ActionItem,
	Health,
	Meeting,
	PerformanceNote,
	Person,
	Project,
	Relation,
} from "./types";
import { lastDatedBulletInSection, sectionBulletsOf } from "./sections";

const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

function normalizeDate(v: unknown): string | undefined {
	if (v == null) return undefined;
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	const s = String(v).trim();
	if (!s) return undefined;
	const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
	return m ? m[1] : s;
}

/** "[[Name|alias]]" / "[[Name]]" / "Name" → "Name". */
export function stripLink(v: unknown): string | undefined {
	if (v == null) return undefined;
	const s = String(v).trim();
	if (!s) return undefined;
	const m = s.match(/^\[\[(.+?)(\|.*)?\]\]$/);
	return (m ? m[1] : s).trim();
}

function daysBetween(iso: string): number | undefined {
	const then = new Date(iso + "T00:00:00");
	if (isNaN(then.getTime())) return undefined;
	const ms = new Date().getTime() - then.getTime();
	return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Average gap in days across a date-sorted (desc) list of meetings. */
function averageCadence(meetings: Meeting[]): number | undefined {
	const dated = meetings.map((m) => m.date).filter((d): d is string => !!d);
	if (dated.length < 2) return undefined;
	let total = 0;
	let count = 0;
	for (let i = 0; i < dated.length - 1; i++) {
		const newer = new Date(dated[i] + "T00:00:00").getTime();
		const older = new Date(dated[i + 1] + "T00:00:00").getTime();
		if (isNaN(newer) || isNaN(older)) continue;
		total += (newer - older) / 86_400_000;
		count++;
	}
	return count > 0 ? Math.round(total / count) : undefined;
}

const CADENCE_WORDS: Record<string, number> = {
	weekly: 7,
	semanal: 7,
	biweekly: 14,
	quinzenal: 14,
	monthly: 30,
	mensal: 30,
};

export function parseCadence(v: unknown): number | undefined {
	if (v == null) return undefined;
	if (typeof v === "number") {
		return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
	}
	const s = String(v).trim().toLowerCase();
	if (!s) return undefined;
	if (s in CADENCE_WORDS) return CADENCE_WORDS[s];
	const n = Number(s);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

const RELATION_ALIASES: Record<string, string> = {
	par: "peer",
	pares: "peer",
	lider: "manager",
	"líder": "manager",
	leader: "manager",
	outro: "other",
	outros: "other",
};

/** Relation is now free-form (users define their own groups); normalize only. */
export function parseRelation(v: unknown): Relation {
	const s = String(v ?? "").trim().toLowerCase();
	if (!s) return "team";
	return RELATION_ALIASES[s] ?? s;
}

/** The default groups; users can add their own in settings. */
export const DEFAULT_RELATIONS: Relation[] = [
	"team",
	"peer",
	"manager",
	"other",
];

const BUILTIN_RELATION_LABELS: Record<string, string> = {
	team: "My team",
	peer: "Peers",
	manager: "Leadership",
	other: "Others",
};

/** Display name for a relation: a nice label for the built-ins, else Title Case. */
export function relationLabel(rel: string): string {
	return (
		BUILTIN_RELATION_LABELS[rel] ??
		rel.replace(/\b\w/g, (c) => c.toUpperCase())
	);
}

/**
 * Is `path` inside `folder` (or one of its subfolders)?
 *
 * Compared case-insensitively: the setting is hand-typed, and on Windows/macOS
 * "team manager" and "Team Manager" are the same folder to everyone but us.
 */
function isUnder(path: string, folder: string): boolean {
	const dir = normalizePath(folder).toLowerCase();
	if (!dir || dir === "/") return true; // no folder set: whole vault
	return path.toLowerCase().startsWith(`${dir}/`);
}

export type SortKey = "name" | "team" | "lastMeeting" | "meetings";
export interface SortState {
	key: SortKey;
	dir: "asc" | "desc";
}

export interface MeetingEntry {
	meeting: Meeting;
	person: Person;
}

export interface OpenItemGroup {
	label: string;
	kind: "person" | "project";
	file: TFile;
	items: ActionItem[];
}

export interface TeamMetrics {
	total: number;
	overdue: number;
	neverMet: number;
	avgDaysSince: number | null;
	meetingsThisMonth: number;
	/** Team members whose latest review is older than reviewIntervalDays. */
	reviewsOverdue: number;
}

export class TeamStore {
	private people = new Map<string, Person>();
	private projects = new Map<string, Project>();
	private refreshPromise: Promise<void> | null = null;

	constructor(
		private app: App,
		private getSettings: () => TeamManagerSettings
	) {}

	private resolvePerson(file: TFile): TFile | null {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const link = stripLink(fm?.person);
		if (!link) return null;
		return this.app.metadataCache.getFirstLinkpathDest(link, file.path);
	}

	private frontmatterType(file: TFile): string | undefined {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const t = fm?.type;
		return t ? String(t).toLowerCase() : undefined;
	}

	/** Coalesce concurrent callers onto a single scan (views refresh in bursts). */
	refresh(): Promise<void> {
		if (!this.refreshPromise) {
			this.refreshPromise = this.doRefresh().finally(() => {
				this.refreshPromise = null;
			});
		}
		return this.refreshPromise;
	}

	/** Build into local maps and swap at the end, so a scan in progress never
	 *  mutates objects another (interleaved) scan is also attaching to. */
	private async doRefresh(): Promise<void> {
		const settings = this.getSettings();
		const people = new Map<string, Person>();
		const projects = new Map<string, Project>();
		const files = this.app.vault.getMarkdownFiles();

		// `type:` is a shared namespace — other plugins and templates use
		// `type: project` too. Each kind is only recognised inside its own
		// configured folder, so the vault at large stays none of our business.
		const scope: Record<string, string> = {
			person: folderFor(settings, settings.peopleFolder),
			meeting: folderFor(settings, settings.meetingsFolder),
			performance: folderFor(settings, settings.performanceFolder),
			project: folderFor(settings, settings.projectsFolder),
		};
		const inScope = (file: TFile, type: string): boolean => {
			const folder = scope[type];
			if (folder == null) return false; // a type we don't manage
			return isUnder(file.path, folder);
		};

		// Pass 1: people.
		for (const file of files) {
			if (this.frontmatterType(file) !== "person") continue;
			if (!inScope(file, "person")) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			people.set(file.path, {
				file,
				name: file.basename,
				role: fm.role ? String(fm.role) : undefined,
				team: fm.team ? String(fm.team) : undefined,
				status: fm.status ? String(fm.status) : undefined,
				relation: parseRelation(fm.relation),
				cadenceTarget: parseCadence(fm.cadence),
				meetings: [],
				openActionItems: [],
				agendaItems: [],
				observationItems: [],
				performance: [],
				projects: [],
				activeProjects: [],
			});
		}

		// Pass 2: meetings, performance notes and projects -> attach to people.
		const meetingFiles: { file: TFile; person: Person; date?: string }[] = [];
		const projectFiles: { file: TFile; project: Project }[] = [];
		for (const file of files) {
			const type = this.frontmatterType(file);
			if (!type || !inScope(file, type)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

			if (type === "project") {
				const rawPeople: unknown[] = Array.isArray(fm.people)
					? fm.people
					: fm.people != null
						? [fm.people]
						: [];
				const peopleFiles: TFile[] = [];
				for (const raw of rawPeople) {
					const link = stripLink(raw);
					if (!link) continue;
					const dest = this.app.metadataCache.getFirstLinkpathDest(
						link,
						file.path
					);
					if (dest) peopleFiles.push(dest);
				}
				const project: Project = {
					file,
					name: file.basename,
					status: fm.status
						? String(fm.status).toLowerCase()
						: settings.projectStatuses[0] ?? "backlog",
					priority: fm.priority ? String(fm.priority) : undefined,
					peopleFiles,
					openActionItems: [],
				};
				projects.set(file.path, project);
				projectFiles.push({ file, project });
				continue;
			}

			if (type !== "meeting" && type !== "performance") continue;
			const dest = this.resolvePerson(file);
			if (!dest) continue;
			const person = people.get(dest.path);
			if (!person) continue;

			if (type === "meeting") {
				const date = normalizeDate(fm.date);
				person.meetings.push({ file, date, personFile: dest });
				meetingFiles.push({ file, person, date });
			} else {
				const period = fm.period ? String(fm.period) : undefined;
				const rating = fm.rating ? String(fm.rating) : undefined;
				const sortKey = normalizeDate(fm.date) ?? period ?? "";
				person.performance.push({ file, period, rating, sortKey });
			}
		}

		// Pass 3: project logs + project action items (content) + attach to people.
		for (const { file, project } of projectFiles) {
			const content = await this.app.vault.cachedRead(file);
			const lastLog = lastDatedBulletInSection(content, settings.logHeading);
			project.lastLogDate = lastLog?.date;
			project.lastLogText = lastLog?.text;
			project.daysSinceLastLog = project.lastLogDate
				? daysBetween(project.lastLogDate)
				: undefined;

			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const m = lines[i].match(TASK_RE);
				if (!m || m[1].toLowerCase() === "x") continue;
				const text = m[2].trim();
				if (!text) continue;
				project.openActionItems.push({
					file,
					line: i,
					text,
					checked: false,
				});
			}

			for (const pf of project.peopleFiles) {
				const person = people.get(pf.path);
				if (!person) continue;
				person.projects.push(project);
				if (this.isProjectActive(project)) {
					person.activeProjects.push(project);
				}
			}
		}

		// Pass 4: per-person aggregates + buffers (content).
		for (const person of people.values()) {
			person.meetings.sort((a, b) =>
				(b.date ?? "").localeCompare(a.date ?? "")
			);
			person.lastMeeting = person.meetings[0];
			person.daysSinceLast = person.lastMeeting?.date
				? daysBetween(person.lastMeeting.date)
				: undefined;
			person.cadenceDays = averageCadence(person.meetings);

			person.performance.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
			person.latestPerformance = person.performance[0];

			person.projects.sort((a, b) => a.name.localeCompare(b.name));
			person.activeProjects.sort((a, b) => a.name.localeCompare(b.name));

			const content = await this.app.vault.cachedRead(person.file);
			person.agendaItems = sectionBulletsOf(content, settings.agendaHeading);
			// Performance (observations included) is available for everyone.
			person.observationItems = sectionBulletsOf(
				content,
				settings.observationsHeading
			);
		}

		// Pass 5: open action items (meeting content).
		for (const { file, person, date } of meetingFiles) {
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const m = lines[i].match(TASK_RE);
				if (!m || m[1].toLowerCase() === "x") continue;
				const text = m[2].trim();
				// Empty "- [ ]" template leftovers aren't real action items.
				if (!text) continue;
				person.openActionItems.push({
					file,
					line: i,
					text,
					checked: false,
					meetingDate: date,
				});
			}
		}

		this.people = people;
		this.projects = projects;
	}

	getPeople(sort?: SortState): Person[] {
		const arr = Array.from(this.people.values());
		if (!sort) return arr.sort((a, b) => a.name.localeCompare(b.name));
		const factor = sort.dir === "asc" ? 1 : -1;
		return arr.sort((a, b) => {
			switch (sort.key) {
				case "team":
					return factor * (a.team ?? "").localeCompare(b.team ?? "");
				case "meetings":
					return factor * (a.meetings.length - b.meetings.length);
				case "lastMeeting": {
					const av = a.lastMeeting?.date ?? "";
					const bv = b.lastMeeting?.date ?? "";
					return factor * av.localeCompare(bv);
				}
				case "name":
				default:
					return factor * a.name.localeCompare(b.name);
			}
		});
	}

	/** Configured relations, plus any ad-hoc ones found on people notes. */
	getRelationOrder(): string[] {
		const out = [...this.getSettings().relations];
		for (const p of this.people.values()) {
			if (!out.includes(p.relation)) out.push(p.relation);
		}
		return out;
	}

	getPeopleByRelation(sort?: SortState): Map<Relation, Person[]> {
		const groups = new Map<Relation, Person[]>();
		for (const rel of this.getRelationOrder()) groups.set(rel, []);
		for (const p of this.getPeople(sort)) {
			if (!groups.has(p.relation)) groups.set(p.relation, []);
			groups.get(p.relation)?.push(p);
		}
		return groups;
	}

	getPerson(file: TFile): Person | undefined {
		return this.people.get(file.path);
	}

	getPersonByPath(path: string): Person | undefined {
		return this.people.get(path);
	}

	/** Resolve the `person` frontmatter link of any note (meeting, performance). */
	resolvePersonOf(file: TFile): TFile | null {
		return this.resolvePerson(file);
	}

	getProjects(): Project[] {
		return Array.from(this.projects.values()).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
	}

	/** Every meeting in the vault with its person, newest first. */
	getAllMeetings(): MeetingEntry[] {
		const out: MeetingEntry[] = [];
		for (const p of this.people.values()) {
			for (const m of p.meetings) out.push({ meeting: m, person: p });
		}
		return out.sort((a, b) =>
			(b.meeting.date ?? "").localeCompare(a.meeting.date ?? "")
		);
	}

	/** Open action items grouped by origin: people (1:1s) first, then projects. */
	getOpenItemGroups(): OpenItemGroup[] {
		const groups: OpenItemGroup[] = [];
		for (const p of this.getPeople()) {
			if (p.openActionItems.length > 0) {
				groups.push({
					label: p.name,
					kind: "person",
					file: p.file,
					items: p.openActionItems,
				});
			}
		}
		for (const pr of this.getProjects()) {
			if (pr.openActionItems.length > 0) {
				groups.push({
					label: pr.name,
					kind: "project",
					file: pr.file,
					items: pr.openActionItems,
				});
			}
		}
		return groups;
	}

	getActiveProjects(): Project[] {
		return this.getProjects().filter((p) => this.isProjectActive(p));
	}

	getProjectByPath(path: string): Project | undefined {
		return this.projects.get(path);
	}

	/** A project is active while its status isn't in the closed list. */
	isProjectActive(project: Project): boolean {
		return !this.getSettings().closedProjectStatuses.includes(project.status);
	}

	/** Configured status order plus any ad-hoc statuses found in the vault. */
	getProjectStatuses(): string[] {
		const out = [...this.getSettings().projectStatuses];
		for (const pr of this.projects.values()) {
			if (!out.includes(pr.status)) out.push(pr.status);
		}
		return out;
	}

	/** Distinct team names present in the vault, sorted. */
	getTeams(): string[] {
		const teams = new Set<string>();
		for (const p of this.people.values()) if (p.team) teams.add(p.team);
		return Array.from(teams).sort((a, b) => a.localeCompare(b));
	}

	/** The person's cadence target, falling back to the global default. */
	cadenceTargetOf(person: Person): number {
		return person.cadenceTarget ?? this.getSettings().staleDays;
	}

	getHealth(person: Person): Health {
		if (person.daysSinceLast == null) return "never";
		const ratio = person.daysSinceLast / this.cadenceTargetOf(person);
		if (ratio > 1) return "overdue";
		if (ratio >= 0.75) return "warn";
		return "ok";
	}

	isOverdue(person: Person): boolean {
		const h = this.getHealth(person);
		return h === "overdue" || h === "never";
	}

	/**
	 * Should we nudge for a review? A stale existing review nudges for anyone;
	 * "never reviewed" only nudges your own team, so peers/leadership/custom
	 * groups you've never reviewed stay quiet until you opt in with a first one.
	 */
	isReviewOverdue(person: Person): boolean {
		const latest = person.latestPerformance?.sortKey;
		const hasReview = latest && /^\d{4}-\d{2}-\d{2}/.test(latest);
		if (!hasReview) return person.relation === "team";
		const days = daysBetween(latest.slice(0, 10));
		return days == null || days > this.getSettings().reviewIntervalDays;
	}

	computeMetrics(): TeamMetrics {
		const people = Array.from(this.people.values());
		const thisMonth = new Date().toISOString().slice(0, 7);
		let overdue = 0;
		let neverMet = 0;
		let sumDays = 0;
		let metCount = 0;
		let meetingsThisMonth = 0;
		let reviewsOverdue = 0;
		for (const p of people) {
			if (this.isOverdue(p)) overdue++;
			if (this.isReviewOverdue(p)) reviewsOverdue++;
			if (p.daysSinceLast == null) {
				neverMet++;
			} else {
				sumDays += p.daysSinceLast;
				metCount++;
			}
			for (const m of p.meetings) {
				if (m.date && m.date.slice(0, 7) === thisMonth) meetingsThisMonth++;
			}
		}
		return {
			total: people.length,
			overdue,
			neverMet,
			avgDaysSince: metCount > 0 ? Math.round(sumDays / metCount) : null,
			meetingsThisMonth,
			reviewsOverdue,
		};
	}
}
