import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import "./ReportDialog.css";

import { fetchHealth } from "../lib/api.ts";
import { copyText } from "../lib/clipboard.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { buildReport, issueUrl, reportTitle } from "../lib/report.ts";
import type { AgentStatus, ConversationResponse, InteractivePrompt } from "../../shared/protocol.ts";

declare const __APP_VERSION__: string;

/** The newest turns a report carries: the one that looked wrong is almost always among them. */
const REPORT_TURNS = 3;
const SCREEN_LINES = 60;

export interface ReportDialogProps {
  paneId: string;
  agent: string | null;
  agentStatus?: AgentStatus;
  model: string | null;
  onClose: () => void;
}

interface Gathered {
  conversation: ConversationResponse | null;
  prompt: InteractivePrompt | null;
  screen: string | null;
  herdr: string | null;
}

/**
 * Report a problem with this pane's chat: what was seen, where, and the pieces it is built
 * from, gathered here and shown whole. Nothing leaves the page on its own: the text can be
 * edited, then copied, saved as a file, or opened as a prefilled GitHub issue.
 */
export function ReportDialog({ paneId, agent, agentStatus, model, onClose }: ReportDialogProps) {
  const t = useT();
  const machineId = useMachineId();
  const { fetchPaneConversation, fetchPanePrompt, fetchPaneTranscript } = useMachineApi();
  const [gathered, setGathered] = useState<Gathered | null>(null);
  const [description, setDescription] = useState("");
  const [include, setInclude] = useState({ turns: true, prompt: true, screen: false });
  const [report, setReport] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const preview = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    const quietly = <T,>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);
    void Promise.all([
      quietly(fetchPaneConversation(paneId)),
      quietly(fetchPanePrompt(paneId)),
      quietly(fetchPaneTranscript(paneId, SCREEN_LINES)),
      quietly(fetchHealth()),
    ]).then(([conversation, prompt, screen, health]) => {
      if (!cancelled) setGathered({ conversation, prompt, screen: screen?.text ?? null, herdr: health?.herdr.version ?? null });
    });
    return () => { cancelled = true; };
  }, [fetchPaneConversation, fetchPanePrompt, fetchPaneTranscript, paneId]);

  // the text follows what is chosen; edits made in it last until the choice changes
  useEffect(() => {
    if (gathered === null) return;
    const turns = gathered.conversation?.turns ?? [];
    setReport(buildReport({
      description,
      environment: {
        app: __APP_VERSION__, herdr: gathered.herdr, machine: machineId, agent, status: agentStatus ?? null,
        source: gathered.conversation?.source ?? null, model,
        browser: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}${window.matchMedia?.("(pointer: coarse)").matches ? " touch" : ""}`,
      },
      turns: include.turns ? turns.slice(-REPORT_TURNS) : null,
      prompt: include.prompt ? gathered.prompt : undefined,
      screen: include.screen ? gathered.screen ?? "" : null,
    }));
  }, [agent, agentStatus, description, gathered, include, machineId, model]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fileName = `herdr-report-${paneId.replace(/[^A-Za-z0-9_-]/g, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.md`;
  const save = (): void => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([report], { type: "text/markdown" }));
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const copy = async (): Promise<void> => setNote(t(await copyText(report, preview.current) ? "Copied" : "Copy failed: select the text and copy it"));
  const file = (): void => {
    const { url, cut } = issueUrl(reportTitle(description, agent), report);
    // a report too long for a URL goes as a file beside the issue
    if (cut) { save(); setNote(t("The report was too long for the issue: attach the saved file to it.")); }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const choice = (key: keyof typeof include, label: string) => (
    <label className="report-choice">
      <input type="checkbox" checked={include[key]} onChange={(event) => setInclude((current) => ({ ...current, [key]: event.target.checked }))} />
      {label}
    </label>
  );

  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <header className="modal-header">
          <h2 className="modal-title" id="report-title">{t("Report a problem")}</h2>
          <button type="button" className="icon-button" aria-label={t("Close")} onClick={onClose}><X /></button>
        </header>
        <div className="modal-body report-body">
          <label className="report-label" htmlFor="report-description">{t("What went wrong?")}</label>
          <textarea id="report-description" className="input report-description" rows={2} value={description}
            placeholder={t("e.g. the list numbers read 1. 1. 1.")} onChange={(event) => setDescription(event.target.value)} />
          <div className="report-choices">
            {choice("turns", t("Latest {n} turns, as parsed", { n: REPORT_TURNS }))}
            {choice("prompt", t("Prompt card, as parsed"))}
            {choice("screen", t("Terminal screen"))}
          </div>
          <p className="settings-description">{t("Nothing is sent on its own. Read it first: a conversation can hold code or secrets. Edit anything out below.")}</p>
          <textarea ref={preview} className="input report-preview" aria-label={t("Report")} value={gathered === null ? t("Gathering…") : report}
            readOnly={gathered === null} spellCheck={false} onChange={(event) => setReport(event.target.value)} />
          {note !== null && <p className="settings-hint" role="status">{note}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" disabled={gathered === null} onClick={() => void copy()}>{t("Copy")}</button>
          <button type="button" className="btn" disabled={gathered === null} onClick={save}>{t("Save as file")}</button>
          <button type="button" className="btn btn-primary" disabled={gathered === null} onClick={file}>{t("Open a GitHub issue")}</button>
        </footer>
      </section>
    </div>
  );
}
