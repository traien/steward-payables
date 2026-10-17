"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, Check, FileText, Loader2, Plus } from "lucide-react";
import type { Capabilities, ClientInvoice, Workspace } from "@/lib/domain";

type WorkspaceAction = (
  action: string,
  payload?: Record<string, unknown>,
  success?: string,
) => Promise<boolean>;

const actionLabels = {
  paid: "Paid in full · historical record",
  "resolve-dispute": "Resolve the dispute",
  "confirm-acceptance": "Confirm work acceptance",
  wait: "Wait until the due date",
  "follow-up": "Follow up with the client",
};
const workLabels = {
  accepted: "Accepted by client",
  pending: "Acceptance pending",
  disputed: "Disputed",
};
const amountLabel = (cents: number, currency: ClientInvoice["currency"]) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(cents / 100);
const dateLabel = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function parseCents(value: string, label: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error(`${label}: enter an amount such as 1250.00, without commas.`);
  }
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`${label} is too large. Check the amount and try again.`);
  }
  return cents;
}

export function ReceivablesPanel({
  workspace,
  capabilities,
  busy,
  act,
  openSetup,
}: {
  workspace: Workspace;
  capabilities: Capabilities;
  busy: string;
  act: WorkspaceAction;
  openSetup: () => void;
}) {
  const records = workspace.receivables ?? [];
  const isPrivate = workspace.mode === "pilot";
  const authorized = !!capabilities.currentUserId && !!capabilities.ownerAuthorized;
  const canUse = isPrivate && authorized;

  return (
    <section className="view-enter receivables-view">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">THE WORK YOU’VE BILLED</p>
          <h1>Your client invoices.</h1>
          <p className="heading-description">
            See what is outstanding and decide what to follow up on.
          </p>
        </div>
        {canUse && records.length > 0 && (
          <button
            className="primary-button"
            disabled={!!busy}
            onClick={() => void act("review-receivables", {}, "Client invoices reviewed. Read the suggestions and record your own assessment.")}
          >
            {busy === "review-receivables" ? <Loader2 size={17} className="spin" /> : <FileText size={17} />}
            Review client invoices
          </button>
        )}
      </div>

      {!canUse ? (
        <div className="receivables-gate">
          <h2>Bring one invoice from your freelance work.</h2>
          <p>
            Use your private workspace to record an invoice a client owes you,
            review its status, and keep your assessment with the result.
          </p>
          {!capabilities.currentUserId ? (
            <a href="/signin-with-chatgpt?return_to=/" className="secondary-button">
              Sign in with ChatGPT <ArrowUpRight size={15} />
            </a>
          ) : !authorized ? (
            <>
              <p>Your signed-in account needs owner authorization before you can add business records.</p>
              <button className="secondary-button" onClick={openSetup}>
                Open owner setup <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <button
              className="secondary-button"
              disabled={!!busy}
              onClick={() => void act("pilot", {}, "Private workspace opened. Add your client invoice below.")}
            >
              Open private workspace <ArrowRight size={15} />
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="receivables-scope">
            Rules-based review · You decide whether to contact the client. These
            records stay separate from outgoing payments.
          </p>
          {records.length > 0 && (
            <div className="receivables-list" aria-label="Client invoice records">
              {records.map((record) => (
                <ReceivableRecord key={record.id} record={record} busy={busy} act={act} />
              ))}
            </div>
          )}
          {records.length >= 30 ? (
            <p className="quiet-note">This workspace has reached its limit of 30 client invoices.</p>
          ) : records.length === 0 ? (
            <div className="receivable-first-record">
              <h2>Add your first client invoice.</h2>
              <p className="fine-print">Use a genuine record you are authorized to access. A client alias is enough; keep the original document in your own files.</p>
              <ReceivableForm busy={busy} act={act} />
            </div>
          ) : (
            <details className="receivable-add">
              <summary><Plus size={17} /> Add another client invoice</summary>
              <ReceivableForm businessName={workspace.businessName} busy={busy} act={act} />
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ReceivableForm({ businessName = "", busy, act }: {
  businessName?: string;
  busy: string;
  act: WorkspaceAction;
}) {
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const value = (name: string) => String(values.get(name) ?? "").trim();
    setError("");
    try {
      const amountCents = parseCents(value("amount"), "Invoice total");
      const paidCents = parseCents(value("paid"), "Already received");
      if (amountCents <= 0) throw new Error("Invoice total must be greater than zero.");
      if (paidCents > amountCents) throw new Error("Already received cannot exceed the invoice total.");
      if (!values.get("authorized")) throw new Error("Confirm that you are authorized to use this genuine record.");
      const saved = await act("import-receivable", {
        businessName: value("businessName"),
        record: {
          id: crypto.randomUUID(),
          number: value("number"),
          clientAlias: value("clientAlias"),
          description: value("description"),
          amountCents,
          paidCents,
          currency: value("currency"),
          dueDate: value("dueDate"),
          workStatus: value("workStatus"),
          sourceReference: value("sourceReference"),
        },
      }, "Client invoice saved. Review it to get a suggested next step.");
      if (saved) form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the invoice details and try again.");
    }
  }

  return (
    <form className="receivable-form" onSubmit={submit}>
      <fieldset disabled={!!busy}>
        <legend className="sr-only">Client invoice details</legend>
        <div className="receivable-fields">
          <label>
            Your freelance or business name
            <input name="businessName" autoComplete="organization" maxLength={120} defaultValue={businessName} required />
          </label>
          <label>
            Client alias
            <input name="clientAlias" maxLength={120} required />
            <small>A private label you recognize, such as your own client code.</small>
          </label>
          <label>
            Invoice reference
            <input name="number" maxLength={100} required />
          </label>
          <label>
            Due date
            <input name="dueDate" type="date" required />
          </label>
          <label className="receivable-wide">
            What the invoice covers
            <input name="description" maxLength={500} required />
          </label>
          <label>
            Invoice total
            <input name="amount" inputMode="decimal" placeholder="1250.00" pattern="[0-9]+([.][0-9]{1,2})?" required />
          </label>
          <label>
            Already received
            <input name="paid" inputMode="decimal" defaultValue="0.00" pattern="[0-9]+([.][0-9]{1,2})?" required />
            <small>Paid-in-full invoices are kept as historical records.</small>
          </label>
          <label>
            Invoice currency
            <select name="currency" defaultValue="USD" required>
              <option value="USD">USD · US dollar</option>
              <option value="EUR">EUR · Euro</option>
              <option value="GBP">GBP · Pound sterling</option>
              <option value="TRY">TRY · Turkish lira</option>
            </select>
          </label>
          <label>
            Work acceptance
            <select name="workStatus" defaultValue="" required>
              <option value="" disabled>Select the actual status</option>
              <option value="accepted">Client accepted the work</option>
              <option value="pending">Acceptance is pending</option>
              <option value="disputed">Client disputes the work or invoice</option>
            </select>
          </label>
          <label className="receivable-wide">
            Reference to your original record
            <input name="sourceReference" maxLength={500} required />
            <small>A filename or reference in your own records. This does not upload or verify the document.</small>
          </label>
        </div>
        <label className="checkbox-label">
          <input name="authorized" type="checkbox" required />
          <span>This is a genuine record from my work, I am authorized to use it, and the amounts and status reflect my records.</span>
        </label>
        <p className="fine-print">Check these details before saving. Saved invoice records cannot yet be edited.</p>
        {error && <p role="alert" className="receivable-error">{error}</p>}
        <button type="submit" className="primary-button">
          {busy === "import-receivable" ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
          Save client invoice
        </button>
      </fieldset>
    </form>
  );
}

function ReceivableRecord({ record, busy, act }: {
  record: ClientInvoice;
  busy: string;
  act: WorkspaceAction;
}) {
  const [assessment, setAssessment] = useState("");
  const [note, setNote] = useState("");
  const outstanding = record.amountCents - record.paidCents;
  const review = record.review;

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assessment || !note.trim() || !review) return;
    await act("receivable-feedback", {
      id: record.id,
      reviewAsOf: review.asOf,
      assessment,
      note: note.trim(),
    }, "Your assessment was recorded with this client invoice.");
  }

  return (
    <article className="receivable-record" aria-label={`Client invoice ${record.number}`}>
      <header className="receivable-record-heading">
        <div>
          <p className="eyebrow">{record.number}</p>
          <h2>{record.clientAlias}</h2>
          <p>{record.description}</p>
        </div>
        <div className="receivable-outstanding">
          <span>{outstanding === 0 ? "Paid in full" : "Outstanding"}</span>
          <strong>{amountLabel(outstanding, record.currency)}</strong>
        </div>
      </header>
      <dl className="receivable-facts">
        <div><dt>Invoice total</dt><dd>{amountLabel(record.amountCents, record.currency)}</dd></div>
        <div><dt>Already received</dt><dd>{amountLabel(record.paidCents, record.currency)}</dd></div>
        <div><dt>Due date</dt><dd>{dateLabel(record.dueDate)}</dd></div>
        <div><dt>Work status</dt><dd>{workLabels[record.workStatus]}</dd></div>
      </dl>
      <p className="receivable-source"><span>Source reference</span> {record.sourceReference}</p>
      {review ? (
        <div className="receivable-review">
          <div className="receivable-review-result">
            <span className="eyebrow">SUGGESTED NEXT STEP</span>
            <h3>{actionLabels[review.action]}</h3>
            <p>{review.reason}</p>
            <p className="fine-print">
              As of {dateLabel(review.asOf)} · {amountLabel(review.outstandingCents, record.currency)} outstanding
              {review.outstandingCents > 0 && ` · ${review.daysOverdue === 0 ? "Not overdue" : `${review.daysOverdue} ${review.daysOverdue === 1 ? "day" : "days"} overdue`}`}
            </p>
          </div>
          {record.feedback ? (
            <div className="receivable-feedback-saved">
              <h3><Check size={16} /> Your assessment: {record.feedback.assessment === "useful" ? "Useful" : "Needs correction"}</h3>
              <p>{record.feedback.note}</p>
              <small>Recorded {dateLabel(record.feedback.recordedAt)}</small>
            </div>
          ) : (
            <form className="receivable-feedback" onSubmit={submitFeedback}>
              <fieldset disabled={!!busy}>
                <legend>Was this review useful for your actual work?</legend>
                <div className="receivable-feedback-choices">
                  <label><input type="radio" name={`assessment-${record.id}`} value="useful" checked={assessment === "useful"} onChange={(event) => setAssessment(event.target.value)} required /> Useful</label>
                  <label><input type="radio" name={`assessment-${record.id}`} value="needs-correction" checked={assessment === "needs-correction"} onChange={(event) => setAssessment(event.target.value)} required /> Needs correction</label>
                </div>
                <label className="receivable-feedback-note">
                  What helped, or what needs correcting?
                  <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} required />
                </label>
                <button className="secondary-button" type="submit" disabled={!assessment || !note.trim()}>
                  Save my assessment <ArrowRight size={15} />
                </button>
              </fieldset>
            </form>
          )}
        </div>
      ) : (
        <p className="receivable-unreviewed">Ready for review. Use “Review client invoices” to see a suggested next step.</p>
      )}
    </article>
  );
}
