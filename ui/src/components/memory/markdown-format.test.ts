import { describe, expect, it } from "vitest";
import { applyMarkdownFormat } from "./markdown-format";

/** Helper: `|` marks the caret, `[...]` marks a selection. */
function run(input: string, format: Parameters<typeof applyMarkdownFormat>[3]) {
  const start = input.indexOf("[");
  const end = input.indexOf("]");
  const caret = input.indexOf("|");
  const value =
    start >= 0
      ? input.replace("[", "").replace("]", "")
      : input.replace("|", "");
  const from = start >= 0 ? start : caret;
  const to = start >= 0 ? end - 1 : caret;
  return applyMarkdownFormat(value, from, to, format);
}

describe("wrapping formats", () => {
  it("wraps a selection in bold", () => {
    expect(run("say [hello]", "bold").value).toBe("say **hello**");
  });

  it("unwraps bold when the selection already carries it", () => {
    expect(run("say [**hello**]", "bold").value).toBe("say hello");
  });

  it("unwraps bold when the markers sit just outside the selection", () => {
    expect(run("say **[hello]**", "bold").value).toBe("say hello");
  });

  it("inserts a selected placeholder when there is no selection", () => {
    const result = run("say |", "bold");
    expect(result.value).toBe("say **bold**");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("bold");
  });

  it("wraps italic with a single asterisk and inline code with a backtick", () => {
    expect(run("[x]", "italic").value).toBe("*x*");
    expect(run("[x]", "inlineCode").value).toBe("`x`");
  });
});

describe("line prefix formats", () => {
  it("turns a line into a heading", () => {
    expect(run("Tit|ulo", "h1").value).toBe("# Titulo");
    expect(run("Tit|ulo", "h2").value).toBe("## Titulo");
  });

  it("replaces an existing heading level instead of stacking hashes", () => {
    expect(run("# Tit|ulo", "h2").value).toBe("## Titulo");
    expect(run("### Tit|ulo", "h1").value).toBe("# Titulo");
  });

  it("toggles a heading off when reapplied at the same level", () => {
    expect(run("## Tit|ulo", "h2").value).toBe("Titulo");
  });

  it("prefixes every line of a multi-line selection", () => {
    expect(run("[a\nb]", "bulletList").value).toBe("- a\n- b");
    expect(run("[a\nb]", "quote").value).toBe("> a\n> b");
  });

  it("removes the prefix when every selected line already has it", () => {
    expect(run("[- a\n- b]", "bulletList").value).toBe("a\nb");
  });

  it("numbers list items sequentially and toggles them off", () => {
    expect(run("[a\nb\nc]", "numberedList").value).toBe("1. a\n2. b\n3. c");
    expect(run("[1. a\n2. b]", "numberedList").value).toBe("a\nb");
  });
});

describe("code block", () => {
  it("fences the selected lines", () => {
    expect(run("[const a = 1]", "codeBlock").value).toBe("```\nconst a = 1\n```");
  });

  it("unfences an already fenced block", () => {
    expect(run("[```\nconst a = 1\n```]", "codeBlock").value).toBe("const a = 1");
  });
});

describe("link", () => {
  it("keeps the selection as the label and selects the url placeholder", () => {
    const result = run("[Paperclip]", "link");
    expect(result.value).toBe("[Paperclip](url)");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe("url");
  });

  it("falls back to a label placeholder with no selection", () => {
    expect(run("|", "link").value).toBe("[label](url)");
  });
});
