import { TFile } from "obsidian";

/**
 * How this person relates to the user. Free-form so users can define their own
 * groups; "team", "peer", "manager", "other" are the built-in defaults.
 */
export type Relation = string;

/** 1:1 cadence health, derived from days-since vs the person's target. */
export type Health = "ok" | "warn" | "overdue" | "never";

/** A team member, backed by a markdown note with `type: person`. */
export interface Person {
	file: TFile;
	name: string;
	role?: string;
	team?: string;
	status?: string;
	relation: Relation;
	/** Personal 1:1 cadence target in days; undefined = settings fallback. */
	cadenceTarget?: number;
	meetings: Meeting[];
	/** Most recent meeting by date, if any. */
	lastMeeting?: Meeting;
	/** Whole days since the last meeting; undefined if never met. */
	daysSinceLast?: number;
	/** Average days between consecutive 1:1s; undefined if fewer than two. */
	cadenceDays?: number;
	/** Unchecked action items gathered across all of this person's meetings. */
	openActionItems: ActionItem[];
	/** Bullets buffered under the agenda heading in the person note. */
	agendaItems: string[];
	/** Bullets buffered under the observations heading (team relation only). */
	observationItems: string[];
	/** Performance notes, newest first. */
	performance: PerformanceNote[];
	/** Most recent performance note, if any. */
	latestPerformance?: PerformanceNote;
	/** Projects this person is linked to (any status). */
	projects: Project[];
	/** Projects with status "active". */
	activeProjects: Project[];
}

/** A 1:1 note with `type: meeting` linked to a person. */
export interface Meeting {
	file: TFile;
	/** ISO date (YYYY-MM-DD) parsed from frontmatter `date`. */
	date?: string;
	/** The resolved person note this meeting belongs to. */
	personFile?: TFile;
}

/** A `- [ ]` / `- [x]` task line found inside a meeting note. */
export interface ActionItem {
	file: TFile;
	/** 0-based line number in the source file. */
	line: number;
	text: string;
	checked: boolean;
	/** ISO date of the meeting the item came from, for display. */
	meetingDate?: string;
}

/** A performance note with `type: performance` linked to a person. */
export interface PerformanceNote {
	file: TFile;
	/** Free-form period label, e.g. "2026-H1" or "2026 full year". */
	period?: string;
	/** Free-form rating, e.g. "Exceeds" or a sentence. Not necessarily numeric. */
	rating?: string;
	/** Sort key: frontmatter `date`, falling back to the period string. */
	sortKey: string;
}

/** A project note with `type: project` linked to one or more people. */
export interface Project {
	file: TFile;
	name: string;
	/** active | paused | done (free-form tolerated; absent = active). */
	status: string;
	priority?: string;
	peopleFiles: TFile[];
	/** Date of the most recent `- YYYY-MM-DD:` bullet under the log heading. */
	lastLogDate?: string;
	/** Text of that most recent log bullet, without the date prefix. */
	lastLogText?: string;
	/** Whole days since the last log entry; undefined if no dated log yet. */
	daysSinceLastLog?: number;
	/** Unchecked `- [ ]` lines found anywhere in the project note. */
	openActionItems: ActionItem[];
}
