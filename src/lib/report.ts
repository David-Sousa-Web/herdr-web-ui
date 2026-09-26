/**
 * A problem report for one pane: what the user saw, where it ran, and the pieces the chat
 * and prompt cards are built from, so a rendering or parsing bug can be replayed. Nothing
 * leaves the page on its own: the user reads and edits it, then copies, saves or files it.
 */

import type { ConversationResponse, ConversationTurn, InteractivePrompt } from "../../shared/protocol.ts";

export const ISSUES_URL = "https://github.com/devswha/herdr-web-ui/issues/new";
/** A prefilled issue travels in the URL: past this the body is cut and the file carries the rest. */
export const ISSUE_BODY_MAX = 6000;
/** A tool output in the report: enough to see its shape, not the whole log. */
const TOOL_OUTPUT_CHARS = 600;

export interface ReportEnvironment {
  app: string;
  herdr: string | null;
  machine: string;
  agent: string | null;
  status: string | null;
  source: ConversationResponse["source"] | null;
  model: string | null;
  browser: string;
  viewport: string;
}

export interface ReportParts {
  description: string;
  environment: ReportEnvironment;
  /** the newest turns, as the server parsed them; null when not included */
  turns: ConversationTurn[] | null;
  prompt: InteractivePrompt | null | undefined;
  /** the pane's recent screen text; null when not included */
  screen: string | null;
}

/** Turns as a report shows them: tool outputs cut, everything else as parsed. */
export function reportTurns(turns: ConversationTurn[]): ConversationTurn[] {
  return turns.map((turn) => ({
    ...turn,
    parts: turn.parts.map((part) => part.kind === "tool" && part.output.length > TOOL_OUTPUT_CHARS
      ? { ...part, output: `${part.output.slice(0, TOOL_OUTPUT_CHARS)}\n… (${part.output.length} characters)` }
      : part),
  }));
}

function fenced(language: string, text: string): string {
  // a fence longer than any run of backticks inside it
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

/** The report as Markdown, for an issue, a file or the clipboard. */
export function buildReport(parts: ReportParts): string {
  const env = parts.environment;
  const sections: string[] = [
    "## What went wrong",
    parts.description.trim() || "_(not described)_",
    "## Environment",
    [
      `- herdr web ui ${env.app} · herdr ${env.herdr ?? "unknown"} · PC ${env.machine}`,
      `- agent ${env.agent ?? "none"} (${env.status ?? "unknown"}) · chat source ${env.source ?? "unknown"} · model ${env.model ?? "unknown"}`,
      `- ${env.browser} · viewport ${env.viewport}`,
    ].join("\n"),
  ];
  if (parts.turns !== null) sections.push(`## Latest turns (${parts.turns.length}, as parsed)`, fenced("json", JSON.stringify(reportTurns(parts.turns), null, 2)));
  if (parts.prompt !== undefined) sections.push("## Prompt card (as parsed)", parts.prompt === null ? "_(no prompt on screen)_" : fenced("json", JSON.stringify(parts.prompt, null, 2)));
  if (parts.screen !== null) sections.push("## Terminal screen (recent lines)", fenced("text", parts.screen));
  return `${sections.join("\n\n")}\n`;
}

/** A first line of the description, for the issue's title. */
export function reportTitle(description: string, agent: string | null): string {
  const first = description.trim().split("\n")[0]?.trim() ?? "";
  const title = first.length > 0 ? first : "Problem report";
  return `${agent ? `[${agent}] ` : ""}${title.length > 90 ? `${title.slice(0, 89)}…` : title}`;
}

/** A new issue with the report in it; a body too long for a URL is cut, and says the file has the rest. */
export function issueUrl(title: string, body: string): { url: string; cut: boolean } {
  const cut = body.length > ISSUE_BODY_MAX;
  const text = cut ? `${body.slice(0, ISSUE_BODY_MAX)}\n\n… _(cut here: the full report is attached as a file)_\n` : body;
  return { url: `${ISSUES_URL}?${new URLSearchParams({ title, body: text }).toString()}`, cut };
}
