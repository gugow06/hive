/**
 * Pure text transforms behind the Memory editor toolbar.
 *
 * Every action is a toggle: applying it to text that already carries the mark
 * removes it. Kept free of React so the selection maths can be tested directly.
 */

export type MarkdownFormat =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "inlineCode"
  | "codeBlock"
  | "quote"
  | "bulletList"
  | "numberedList"
  | "link";

export interface FormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const WRAPS: Partial<Record<MarkdownFormat, string>> = {
  bold: "**",
  italic: "*",
  inlineCode: "`",
};

/** Line prefixes that toggle. `null` marks the heading family, handled separately. */
const LINE_PREFIXES: Partial<Record<MarkdownFormat, string>> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  quote: "> ",
  bulletList: "- ",
};

const HEADING_FORMATS = new Set<MarkdownFormat>(["h1", "h2", "h3"]);

/** Expand a selection to cover the whole lines it touches. */
function lineBounds(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  return { lineStart, lineEnd };
}

function replaceRange(value: string, start: number, end: number, next: string): FormatResult {
  return {
    value: value.slice(0, start) + next + value.slice(end),
    selectionStart: start,
    selectionEnd: start + next.length,
  };
}

function applyWrap(
  value: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string,
): FormatResult {
  const selected = value.slice(start, end);

  // Already wrapped inside the selection → unwrap.
  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return replaceRange(value, start, end, inner);
  }

  // Already wrapped just outside the selection → unwrap around it.
  const before = value.slice(Math.max(0, start - marker.length), start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    return replaceRange(value, start - marker.length, end + marker.length, selected);
  }

  if (selected.length === 0) {
    const next = `${marker}${placeholder}${marker}`;
    return {
      value: value.slice(0, start) + next + value.slice(end),
      // Leave the placeholder selected so typing replaces it.
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + placeholder.length,
    };
  }

  return replaceRange(value, start, end, `${marker}${selected}${marker}`);
}

function applyLinePrefix(
  value: string,
  start: number,
  end: number,
  prefix: string,
  isHeading: boolean,
): FormatResult {
  const { lineStart, lineEnd } = lineBounds(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");

  // A heading replaces any existing heading level; other prefixes plain-toggle.
  const stripHeading = (line: string) => line.replace(/^#{1,6}\s+/, "");
  const alreadyApplied = lines.every((line) => line.startsWith(prefix));

  const next = lines
    .map((line) => {
      if (alreadyApplied) return line.slice(prefix.length);
      const base = isHeading ? stripHeading(line) : line;
      return `${prefix}${base}`;
    })
    .join("\n");

  return replaceRange(value, lineStart, lineEnd, next);
}

function applyNumberedList(value: string, start: number, end: number): FormatResult {
  const { lineStart, lineEnd } = lineBounds(value, start, end);
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const numbered = /^\d+\.\s+/;
  const alreadyApplied = lines.every((line) => numbered.test(line));
  const next = lines
    .map((line, index) => (alreadyApplied ? line.replace(numbered, "") : `${index + 1}. ${line}`))
    .join("\n");
  return replaceRange(value, lineStart, lineEnd, next);
}

function applyCodeBlock(value: string, start: number, end: number): FormatResult {
  const { lineStart, lineEnd } = lineBounds(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");

  if (lines.length >= 2 && lines[0]!.startsWith("```") && lines.at(-1)!.startsWith("```")) {
    return replaceRange(value, lineStart, lineEnd, lines.slice(1, -1).join("\n"));
  }
  return replaceRange(value, lineStart, lineEnd, `\`\`\`\n${block}\n\`\`\``);
}

function applyLink(value: string, start: number, end: number): FormatResult {
  const selected = value.slice(start, end);
  const label = selected.length > 0 ? selected : "label";
  const next = `[${label}](url)`;
  const urlStart = start + next.length - 4;
  return {
    value: value.slice(0, start) + next + value.slice(end),
    // Land the caret on `url` so the address is the next thing typed.
    selectionStart: urlStart,
    selectionEnd: urlStart + 3,
  };
}

export function applyMarkdownFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  format: MarkdownFormat,
): FormatResult {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);

  const wrap = WRAPS[format];
  if (wrap) {
    const placeholder = format === "inlineCode" ? "code" : format === "bold" ? "bold" : "italic";
    return applyWrap(value, start, end, wrap, placeholder);
  }

  const prefix = LINE_PREFIXES[format];
  if (prefix) return applyLinePrefix(value, start, end, prefix, HEADING_FORMATS.has(format));

  if (format === "numberedList") return applyNumberedList(value, start, end);
  if (format === "codeBlock") return applyCodeBlock(value, start, end);
  return applyLink(value, start, end);
}
