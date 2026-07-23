import { Project } from "./types";

/** Project log staleness: ok ≤7d, warn ≤14d, red beyond (or never logged). */
export function stalenessOf(project: Project): "ok" | "warn" | "overdue" {
	const d = project.daysSinceLastLog;
	if (d == null) return "overdue";
	if (d <= 7) return "ok";
	if (d <= 14) return "warn";
	return "overdue";
}

/** Statuses are user-configured free text ("in progress") — CSS-safe slug. */
export function statusSlug(status: string): string {
	return status.replace(/[^a-z0-9]+/gi, "-");
}

export function statusLabel(status: string): string {
	return status.charAt(0).toUpperCase() + status.slice(1);
}
