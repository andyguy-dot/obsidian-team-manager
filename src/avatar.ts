/** Person avatar helpers, shared by the dashboard cards and project surfaces. */

/** djb2 over the name → stable hue for the avatar. */
export function nameHue(name: string): number {
	let h = 5381;
	for (let i = 0; i < name.length; i++) {
		h = ((h << 5) + h + name.charCodeAt(i)) | 0;
	}
	return Math.abs(h) % 360;
}

export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Create an initials avatar with the deterministic per-name hue. */
export function renderAvatar(
	parent: HTMLElement,
	name: string,
	small = false
): HTMLElement {
	const el = parent.createDiv({
		cls: small ? "tm-avatar tm-avatar-sm" : "tm-avatar",
	});
	el.setText(initialsOf(name));
	el.style.setProperty("--tm-hue", String(nameHue(name)));
	return el;
}
