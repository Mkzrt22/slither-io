/**
 * Protection against prompt injection: anything that comes from users
 * (imported lyrics, titles, subjects, notes) is DATA. It is inserted between
 * XML-like tags after neutralising the characters that could close or open a
 * tag, and the system prompt states that tagged content is never an
 * instruction.
 */

const MAX_FIELD = 4000;

/** Escapes a user-provided string for insertion inside a tag. */
export function asData(value: unknown, max = MAX_FIELD): string {
  const s = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Wraps data in a tag: <name attr="…">escaped</name>. Attributes are escaped too. */
export function tag(name: string, content: string, attrs: Record<string, string | number | undefined> = {}): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${asData(v, 200).replace(/"/g, "&quot;")}"`)
    .join("");
  return `<${name}${a}>${content}</${name}>`;
}

/**
 * Deterministic JSON (sorted keys) so that the cached prompt prefix is
 * byte-identical between calls.
 */
export function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Undo the escaping on model output that quotes escaped content back. */
export function unescapeData(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
