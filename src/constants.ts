/** Dependency-free constants, so importers never form a cycle. */

/** Code block language that renders the person hub inside a person note. */
export const HUB_BLOCK_LANG = "team-hub";

/** The block markup written into person notes. */
export const HUB_BLOCK_SNIPPET = "```team-hub\n```";

/** Code block language that renders the project dashboard inside a project note. */
export const PROJECT_BLOCK_LANG = "team-project";

/** The block markup written into project notes. */
export const PROJECT_BLOCK_SNIPPET = "```team-project\n```";

/**
 * Section headings inside meeting / performance notes that quick capture
 * appends to. Kept in lockstep with the note templates in notes.ts.
 */
export const MEETING_AGENDA_HEADING = "Agenda";
export const PERF_OBSERVATIONS_HEADING = "Observations this period";
