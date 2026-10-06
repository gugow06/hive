import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Pencil,
  Quote,
  SquareCode,
} from "lucide-react";
import type { MemoryDocument } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MarkdownBody } from "../MarkdownBody";
import { applyMarkdownFormat, type MarkdownFormat } from "./markdown-format";

const TOOLBAR: Array<
  { format: MarkdownFormat; label: string; icon: typeof Bold; shortcut?: string } | "separator"
> = [
  { format: "h1", label: "Heading 1", icon: Heading1 },
  { format: "h2", label: "Heading 2", icon: Heading2 },
  { format: "h3", label: "Heading 3", icon: Heading3 },
  "separator",
  { format: "bold", label: "Bold", icon: Bold, shortcut: "Ctrl+B" },
  { format: "italic", label: "Italic", icon: Italic, shortcut: "Ctrl+I" },
  { format: "inlineCode", label: "Inline code", icon: Code },
  { format: "codeBlock", label: "Code block", icon: SquareCode },
  "separator",
  { format: "bulletList", label: "Bullet list", icon: List },
  { format: "numberedList", label: "Numbered list", icon: ListOrdered },
  { format: "quote", label: "Quote", icon: Quote },
  { format: "link", label: "Link", icon: Link2, shortcut: "Ctrl+K" },
];

export interface MemoryDocumentViewProps {
  document: MemoryDocument;
  saving: boolean;
  onSave: (markdown: string) => Promise<void>;
  resolveWikiLinkHref: (target: string, label: string) => string | null | undefined;
  /** Set by the page when the rail wants to switch documents while a draft is dirty. */
  pendingNavigation: (() => void) | null;
  onResolvePendingNavigation: (discard: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function MemoryDocumentView({
  document,
  saving,
  onSave,
  resolveWikiLinkHref,
  pendingNavigation,
  onResolvePendingNavigation,
  onDirtyChange,
}: MemoryDocumentViewProps) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState(document.markdown);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function format(next: MarkdownFormat) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = applyMarkdownFormat(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      next,
    );
    setDraft(result.value);
    // Restoring the selection has to wait for React to commit the new value,
    // otherwise the browser resets the caret to the end of the textarea.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  // Opening a different document always starts read-only on its own content.
  useEffect(() => {
    setMode("view");
    setDraft(document.markdown);
  }, [document.id, document.markdown]);

  const dirty = mode === "edit" && draft !== document.markdown;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (pendingNavigation && !dirty) onResolvePendingNavigation(true);
  }, [pendingNavigation, dirty, onResolvePendingNavigation]);

  function cancelEdit() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    setMode("view");
  }

  function discardDraft() {
    setDraft(document.markdown);
    setMode("view");
    setConfirmDiscard(false);
  }

  async function save() {
    await onSave(draft);
    setMode("view");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-(--sz-60px) shrink-0 items-center gap-3 border-b border-border px-6">
        <h2 className="min-w-0 flex-1 truncate text-base font-medium">{document.title}</h2>
        {mode === "view" ? (
          <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
            <Pencil /> Edit
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving} aria-busy={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </>
        )}
      </header>

      <div
        className={cn(
          "min-h-0 flex-1 px-6 py-5",
          // Reading scrolls the page; editing keeps the toolbar fixed and lets
          // the textarea own the scroll instead.
          mode === "view" ? "overflow-y-auto scrollbar-auto-hide" : "overflow-hidden",
        )}
      >
        {mode === "view" ? (
          document.markdown.trim().length > 0 ? (
            <MarkdownBody
              enableWikiLinks
              resolveWikiLinkHref={resolveWikiLinkHref}
              className="prose-base"
            >
              {document.markdown}
            </MarkdownBody>
          ) : (
            <p className="text-sm text-muted-foreground">
              This document is empty. Press Edit to start writing.
            </p>
          )
        ) : (
          // A raw-source textarea, not the WYSIWYG MarkdownEditor: that one
          // escapes typed markdown syntax (`# Title` is stored as `\# Title`),
          // which then renders as literal text. Same choice SkillStudio makes
          // for editing skill markdown.
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div
              role="toolbar"
              aria-label="Formatting"
              className="flex flex-wrap items-center gap-0.5 rounded-md border border-border p-1"
            >
              {TOOLBAR.map((entry, index) =>
                entry === "separator" ? (
                  <span
                    key={`separator-${index}`}
                    aria-hidden="true"
                    className="mx-1 h-5 w-px shrink-0 bg-border"
                  />
                ) : (
                  <Tooltip key={entry.format}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={entry.label}
                        // The textarea must keep focus so the selection survives.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => format(entry.format)}
                      >
                        <entry.icon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {entry.label}
                      {entry.shortcut ? (
                        <span className="ml-2 text-muted-foreground">{entry.shortcut}</span>
                      ) : null}
                    </TooltipContent>
                  </Tooltip>
                ),
              )}
            </div>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey)) return;
                const key = event.key.toLowerCase();
                const shortcut =
                  key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
                if (!shortcut) return;
                event.preventDefault();
                format(shortcut);
              }}
              spellCheck={false}
              className={cn(
                "min-h-0 w-full flex-1 resize-none font-mono text-sm leading-relaxed",
                // field-sizing-content (the Textarea default) fights a flex-filled
                // editor: it would grow the box instead of scrolling inside it.
                "field-sizing-fixed",
              )}
              placeholder="Write in Markdown. Link other documents with [[their title]]."
            />
          </div>
        )}
      </div>

      <Dialog
        open={confirmDiscard || (pendingNavigation !== null && dirty)}
        onOpenChange={(open) => {
          if (open) return;
          setConfirmDiscard(false);
          if (pendingNavigation) onResolvePendingNavigation(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              This document has edits that have not been saved. Discarding them cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmDiscard(false);
                if (pendingNavigation) onResolvePendingNavigation(false);
              }}
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingNavigation) {
                  setDraft(document.markdown);
                  setMode("view");
                  onResolvePendingNavigation(true);
                  return;
                }
                discardDraft();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
