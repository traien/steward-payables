import { ArrowRight, ArrowUpRight, Check, FileText } from "lucide-react";
import type { Workspace } from "@/lib/domain";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

export function DashboardSummary({
  workspace,
  openReceivables,
  openInvoice,
  openJournal,
}: {
  workspace: Workspace;
  openReceivables: () => void;
  openInvoice: (id: string) => void;
  openJournal: () => void;
}) {
  const receivables = workspace.receivables ?? [];
  const usd = receivables.filter((invoice) => invoice.currency === "USD");
  const invoiced = usd.reduce((sum, invoice) => sum + invoice.amountCents, 0);
  const recorded = usd.reduce((sum, invoice) => sum + invoice.paidCents, 0);
  const outstanding = invoiced - recorded;
  const recentPayments = workspace.invoices
    .filter((invoice) => invoice.payment)
    .sort((a, b) =>
      (b.payment!.completedAt ?? b.payment!.submittedAt).localeCompare(
        a.payment!.completedAt ?? a.payment!.submittedAt,
      ),
    )
    .slice(0, 3);
  const events = [...workspace.audit].reverse().slice(0, 3);

  return (
    <aside className="dashboard-rail" aria-label="Business records at a glance">
      <section className="client-ledger-summary">
        <div className="rail-heading">
          <h2>Client invoices</h2>
          <button className="icon-button" onClick={openReceivables} aria-label="Open client invoices">
            <ArrowUpRight size={17} />
          </button>
        </div>
        {usd.length ? (
          <>
            <div className="client-ledger-total">
              <strong>{money(outstanding)}</strong>
              <span>outstanding · USD records</span>
            </div>
            <div className="client-ledger-bar" role="img" aria-label={`${money(recorded)} recorded paid of ${money(invoiced)} invoiced in USD`}>
              <span style={{ width: `${invoiced ? (recorded / invoiced) * 100 : 0}%` }} />
            </div>
            <dl className="client-ledger-totals">
              <div><dt>Recorded paid</dt><dd>{money(recorded)}</dd></div>
              <div><dt>Total invoiced</dt><dd>{money(invoiced)}</dd></div>
            </dl>
            <p className="rail-note">{usd.length} USD records{receivables.length > usd.length ? ` · ${receivables.length - usd.length} in other currencies` : ""}. {workspace.mode === "demo" ? "Sample history; no customer payments collected." : "Payment amounts supplied by the record owner."}</p>
          </>
        ) : (
          <div className="rail-empty">
            <FileText size={18} />
            <p>Keep client bills, paid amounts and follow-ups together.</p>
            <button className="text-button" onClick={openReceivables}>Open your records <ArrowRight size={14} /></button>
          </div>
        )}
      </section>
      <section className="dashboard-activity">
        <div className="rail-heading">
          <h2>{events.length ? "Recent activity" : "Recent receipts"}</h2>
          {workspace.mode === "demo" && <span className="sample-history-label">SAMPLE</span>}
        </div>
        <ol className="activity-feed">
          {events.length ? events.map((event) => (
            <li key={event.id}>
              <span className="activity-dot"><Check size={12} /></span>
              <div><strong>{event.title}</strong><small>{new Date(event.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</small></div>
            </li>
          )) : recentPayments.map((invoice) => (
            <li key={invoice.id}>
              <span className="activity-dot"><ArrowUpRight size={12} /></span>
              <button onClick={() => openInvoice(invoice.id)}>
                <strong>{workspace.vendors.find((vendor) => vendor.id === invoice.vendorId)?.name ?? invoice.vendorId}</strong>
                <small>{money(invoice.payment!.amountCents)} · {invoice.payment!.status === "simulated" ? "simulated" : invoice.payment!.status === "complete" ? "sandbox complete" : invoice.payment!.status}</small>
              </button>
            </li>
          ))}
        </ol>
        {!events.length && !recentPayments.length && <p className="rail-note">Invoice reviews and payment receipts will appear here as you work.</p>}
        <button className="text-button" onClick={openJournal}>Open decision journal <ArrowRight size={14} /></button>
      </section>
    </aside>
  );
}
