// SPDX-License-Identifier: Apache-2.0
import { Bell, Cable, RefreshCw, X } from "./icons";
import "./viewportNotifications.css";

export interface ViewportModelNotice { level: string; title: string; detail: string }
export interface BoardDisplayDiagnostic { name: string; detail: string; designId?: string; modelsAvailable?: boolean }

export function ViewportNoticeCorner({ notice, boardSummary, onDetails, onDismiss }: {
  notice: ViewportModelNotice | null;
  boardSummary?: string;
  onDetails: () => void;
  onDismiss: () => void;
}) {
  if (!notice && !boardSummary) return null;
  return <aside className="viewport-notice-corner" aria-label="Viewport notices">
    {notice && <div className={`viewport-notice-chip ${notice.level}`} role="status">
      <button type="button" onClick={onDetails} title={`${notice.title}. Open notifications for details.`}><Bell size={13} /><span>{notice.title}</span></button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss model notice"><X size={13} /></button>
    </div>}
    {boardSummary && <button type="button" className="viewport-notice-chip board-summary" onClick={onDetails} title={`${boardSummary}. Open board import details.`}><Cable size={13} /><span>{boardSummary}</span></button>}
  </aside>;
}

export default function ViewportNotifications({ notice, metrics, boards, harnessDiagnostics, importReview, canResolveModels = true, mode = "popover", open, onToggle, onClose, onRetry, onResolveModels, onReviewImport, onReviewLinks, onReviewIssues }: {
  notice: ViewportModelNotice | null;
  metrics?: string;
  boards: BoardDisplayDiagnostic[];
  harnessDiagnostics: string[];
  importReview?: { label: string; issueCount: number };
  canResolveModels?: boolean;
  mode?: "popover" | "button" | "dock";
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRetry: () => void;
  onResolveModels: (designId?: string) => void;
  onReviewImport: () => void;
  onReviewLinks: () => void;
  onReviewIssues: () => void;
}) {
  const count = Number(Boolean(notice)) + Number(boards.length > 0 || harnessDiagnostics.length > 0) + Number(Boolean(importReview));
  const navigate = (action: () => void) => () => { onClose(); action(); };
  const resolveModels = (designId?: string) => navigate(() => onResolveModels(designId));
  return <div className={mode === "dock" ? "notification-dock-panel" : "notification-center"}>
    {mode !== "dock" && <button className={`icon-btn ${count ? "has-notification" : ""}`} title="Notifications" aria-label="Notifications" aria-controls="workbench-notification-content" aria-expanded={open} onClick={onToggle}><Bell size={17} />{count > 0 && <span className={`notification-count ${notice?.level ?? "warning"}`}>{count}</span>}</button>}
    {open && mode !== "button" && <section className="notification-popover viewport-notification-panel" aria-label="Notification details">
      <div><b>NOTIFICATIONS</b><button type="button" onClick={onClose} aria-label="Close notifications"><X size={13} /></button></div>
      {notice && <article className={notice.level}><Bell size={14} /><span><button type="button" className="notification-title-action" onClick={resolveModels()} disabled={!canResolveModels}>{notice.title}</button><small>{notice.detail}</small><div className="notification-actions"><button type="button" onClick={resolveModels()} disabled={!canResolveModels}>Resolve models</button>{notice.level === "error" && <button type="button" onClick={navigate(onRetry)}><RefreshCw size={13} /> Retry 3D models</button>}</div>{metrics && <details className="notification-load-details"><summary>Load diagnostics</summary><small>{metrics}</small></details>}</span></article>}
      {importReview && <article className="warning"><Bell size={14} /><span><button type="button" className="notification-title-action" onClick={navigate(onReviewImport)}>{importReview.label}</button><small>{importReview.issueCount} import item{importReview.issueCount === 1 ? "" : "s"} need review.</small><div className="notification-actions"><button type="button" onClick={navigate(onReviewImport)}>Review import</button></div></span></article>}
      {boards.length > 0 && <div className="notification-board-details"><b>BOARD IMPORT DETAILS</b>{boards.map((board, index) => <article key={index}><span><b>{board.name}</b><small>{board.detail}</small><div className="notification-actions"><button type="button" onClick={resolveModels(board.designId)} disabled={board.modelsAvailable === false || !canResolveModels}>Resolve this board's models</button></div></span></article>)}</div>}
      {harnessDiagnostics.map((detail, index) => <article key={index} className="warning"><Cable size={14} /><span><button type="button" className="notification-title-action" onClick={navigate(onReviewLinks)}>Inter-board connection</button><small>{detail}</small><div className="notification-actions"><button type="button" onClick={navigate(onReviewLinks)}>Review connector links</button></div></span></article>)}
      {!count && <p>No active notifications.</p>}
      <footer className="notification-actions"><button type="button" onClick={navigate(onReviewIssues)}>Review all issues</button></footer>
    </section>}
  </div>;
}
