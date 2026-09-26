import { basename, dirname } from "node:path";
import type { SkillActivity } from "../shared/protocol.ts";

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const label = (value: unknown): string | null => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\r\n<>]/.test(value) ? value : null;

/** No filesystem lookup: evidence belongs to the bound transcript, including remote PCs. */
export function skillDocument(path: unknown): SkillActivity | null {
  if (typeof path !== "string" || path.length > 4096 || /[\r\n]/.test(path)) return null;
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.endsWith("/SKILL.md")) return null;
  const name = label(basename(dirname(normalized)));
  return name && name !== "." ? { name, path, evidence: "instructions", status: "loaded" } : null;
}

/** Codex's explicitly selected skill is injected as one complete user-context envelope. */
export function selectedSkill(text: string): SkillActivity | null {
  const match = /^<skill>\s*<name>([^<>\r\n]+)<\/name>\s*<path>([^<>\r\n]+)<\/path>[\s\S]*<\/skill>$/.exec(text.trim());
  if (!match) return null;
  const name = label(match[1]);
  const document = skillDocument(match[2]);
  return name && document ? { ...document, name } : null;
}

export function invokedSkill(name: string, input: Record<string, unknown>): SkillActivity | null {
  if (name !== "Skill") return null;
  const skill = label(input.skill);
  return skill ? { name: skill, evidence: "invocation", status: "requested" } : null;
}

/** Codex records parsed read paths even for commands executed inside code-mode tools.
 * Unknown shell scripts stay unknown: a mention/search of SKILL.md is not a read. */
export function codexReadSkills(value: unknown): SkillActivity[] {
  const item = record(value);
  if (item.type !== "CommandExecution" || !Array.isArray(item.parsed_cmd)) return [];
  if (item.status !== "completed" && item.status !== "failed") return [];
  const status = item.exit_code === 0 ? "loaded" : typeof item.exit_code === "number" ? "failed" : null;
  if (!status) return [];
  return item.parsed_cmd.flatMap((value) => {
    const command = record(value);
    const skill = command.type === "read" ? skillDocument(command.path) : null;
    return skill ? [{ ...skill, status }] : [];
  });
}

/** Older Codex rollouts only record tool calls. Recognize a literal, single file
 * read; shell scripts, searches, writes, interpolated paths and mentions stay out. */
export function codexReadCall(name: string, args: Record<string, unknown>): SkillActivity | null {
  if (name === "read_file" || name === "Read") {
    const skill = skillDocument(args.file_path ?? args.path);
    return skill ? { ...skill, status: "requested" } : null;
  }
  if (name !== "exec_command" && name !== "shell_command" && name !== "shell") return null;
  const cmd = args.cmd ?? args.command;
  if (typeof cmd !== "string" || /[\n;&|<>`$]/.test(cmd)) return null;
  const match = /^(?:cat|head(?:\s+-n\s+\d+)?|sed\s+-n\s+['"]?\d+(?:,\d+)?p['"]?)\s+(?:"([^"\n]+)"|'([^'\n]+)'|(\S+))\s*$/.exec(cmd.trim());
  const skill = match ? skillDocument(match[1] ?? match[2] ?? match[3]) : null;
  return skill ? { ...skill, status: "requested" } : null;
}
