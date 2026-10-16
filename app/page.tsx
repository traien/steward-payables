"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  FileText,
  Gauge,
  History,
  Landmark,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import type { Invoice, Policy, WorkspaceResponse } from "@/lib/domain";

type View = "overview" | "invoices" | "journal" | "policy" | "setup";
const navigation = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "journal", label: "Decision journal", icon: History },
  { id: "policy", label: "Payment policy", icon: SlidersHorizontal },
  { id: "setup", label: "Setup & connections", icon: Settings2 },
] as const;
const statusLabels: Record<string, string> = {
  inbox: "To review",
  ready: "Ready",
  held: "On hold",
  blocked: "Blocked",
  submitted: "Submitted",
  settled: "Settled · testnet",
  simulated: "Simulated",
  review: "Needs review",
  failed: "Failed",
};
const money = (cents: number, decimals = true) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);
const dateLabel = (value: string) =>
  new Date(
    value.length === 10 ? `${value}T12:00:00Z` : value,
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const shortAddress = (value: string) =>
  value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
function downloadJson(name: string, content: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <span />
      {statusLabels[status] || status}
    </span>
  );
}
function displayStatus(invoice: Invoice) {
  return invoice.status === "blocked" && invoice.decision?.action === "escalate"
    ? "review"
    : invoice.status;
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function Home() {
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [view, setView] = useState<View>("overview");
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [importText, setImportText] = useState("");
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [funds, setFunds] = useState("600");
  const [showFunds, setShowFunds] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const workspace = data?.workspace;
  const caps = data?.capabilities;

  async function load() {
    setBusy("load");
    setError("");
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const result = (await response.json()) as WorkspaceResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Could not load workspace.");
      setData(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connection interrupted. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/workspace", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as WorkspaceResponse & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "Could not load workspace.");
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Connection interrupted. Please try again.",
          );
      })
      .finally(() => {
        if (active) setBusy("");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inspectorRef.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = inspectorRef.current?.querySelectorAll<HTMLElement>(
        'button, a[href], summary, input, textarea, [tabindex="0"]',
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === inspectorRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [selectedId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function act(
    action: string,
    payload: Record<string, unknown> = {},
    success = "",
  ) {
    if (busy) return false;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, action }),
      });
      const result = (await response.json()) as WorkspaceResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Action could not be completed.");
      setData(result);
      setNotice(
        success ||
          (action === "run"
            ? "Review complete. Every decision is recorded below."
            : "Workspace updated."),
      );
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connection interrupted. Your existing records are safe. Refresh before retrying.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }
  const navigate = (next: View) => {
    setView(next);
    setSelectedId(null);
    setNotice("");
    setError("");
  };
  const run = () => {
    void act("run");
  };
  const sample = () => {
    const example =
      workspace?.mode === "demo"
        ? {
            businessName: "SAMPLE — replace with your business",
            vendors: workspace.vendors,
            invoices: workspace.invoices.map((invoice) => ({
              id: invoice.id,
              number: invoice.number,
              vendorId: invoice.vendorId,
              description: invoice.description,
              amountCents: invoice.amountCents,
              currency: invoice.currency,
              dueDate: invoice.dueDate,
              recipientAddress: invoice.recipientAddress,
              purchaseOrderRef: invoice.purchaseOrderRef,
              purchaseOrderAmountCents: invoice.purchaseOrderAmountCents,
              acceptanceVerified: invoice.acceptanceVerified,
              sourceReference: `SAMPLE: ${invoice.sourceReference}`,
              status: "inbox",
              discountBps: invoice.discountBps,
              discountUntil: invoice.discountUntil,
            })),
          }
        : {
            businessName: "SAMPLE — replace with your business",
            vendors: [
              {
                id: "vendor-1",
                name: "Sample supplier",
                category: "Services",
                approvedAddress: "0x1111111111111111111111111111111111111111",
              },
            ],
            invoices: [
              {
                id: "invoice-1",
                number: "SAMPLE-001",
                vendorId: "vendor-1",
                description: "Replace with a genuine obligation",
                amountCents: 10000,
                currency: "USD",
                dueDate: new Date().toISOString().slice(0, 10),
                recipientAddress: "0x1111111111111111111111111111111111111111",
                purchaseOrderRef: "SAMPLE-PO",
                purchaseOrderAmountCents: 10000,
                acceptanceVerified: false,
                sourceReference: "SAMPLE — replace with evidence reference",
                status: "inbox",
              },
            ],
          };
    downloadJson("steward-sample-import.json", example);
    setNotice(
      "Sample downloaded. Replace all sample records and addresses before importing your business.",
    );
  };
  async function importRecords(event: FormEvent) {
    event.preventDefault();
    try {
      const content = JSON.parse(importText);
      if (!content || typeof content !== "object" || Array.isArray(content))
        throw new Error(
          "Paste a JSON object with businessName, vendors, and invoices.",
        );
      if (
        await act(
          "import",
          content,
          "Business records imported into your private pilot. Review your policy before running.",
        )
      ) {
        setImportText("");
        setImportConfirmed(false);
        setView("invoices");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Invalid JSON. Check your file and try again.",
      );
    }
  }
  const selected = workspace?.invoices.find(
    (invoice) => invoice.id === selectedId,
  );
  const vendorName = (invoice: Invoice) =>
    workspace?.vendors.find((vendor) => vendor.id === invoice.vendorId)?.name ||
    invoice.vendorId;
  const paid =
    workspace?.invoices.filter((invoice) =>
      ["simulated", "settled"].includes(invoice.status),
    ) || [];
  const held =
    workspace?.invoices.filter((invoice) => invoice.status === "held") || [];
  const blocked =
    workspace?.invoices.filter((invoice) => invoice.status === "blocked") || [];
  const inbox =
    workspace?.invoices.filter((invoice) =>
      ["inbox", "ready"].includes(invoice.status),
    ) || [];
  const paidCents = paid.reduce(
    (sum, invoice) =>
      sum + (invoice.payment?.amountCents ?? invoice.amountCents),
    0,
  );
  const savedCents = paid.reduce(
    (sum, invoice) =>
      sum +
      Math.max(
        0,
        invoice.amountCents -
          (invoice.payment?.amountCents ?? invoice.amountCents),
      ),
    0,
  );
  const available = workspace
    ? Math.max(
        0,
        workspace.balanceCents -
          workspace.policy.reserveCents -
          workspace.policy.gasReserveCents,
      )
    : 0;
  const filtered =
    workspace?.invoices.filter(
      (invoice) =>
        (filter === "all" ||
          invoice.status === filter ||
          (filter === "paid" &&
            ["simulated", "settled"].includes(invoice.status))) &&
        `${vendorName(invoice)} ${invoice.number} ${invoice.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  const demo = workspace?.mode !== "pilot";

  function invoiceTable(invoices: Invoice[]) {
    return (
      <div className="invoice-table-wrap">
        <table className="invoice-table">
          <thead>
            <tr>
              <th>Payee / invoice</th>
              <th>Due date</th>
              <th>Amount</th>
              <th>Decision</th>
              <th>
                <span className="sr-only">Inspect</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr
                key={invoice.id}
                className={selectedId === invoice.id ? "selected-row" : ""}
              >
                <td>
                  <button
                    className="invoice-name"
                    onClick={() => setSelectedId(invoice.id)}
                  >
                    <span
                      className={`vendor-avatar tone-${invoice.vendorId.length % 3}`}
                    >
                      {vendorName(invoice)
                        .split(" ")
                        .map((word) => word[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      <strong>{vendorName(invoice)}</strong>
                      <small>
                        {invoice.number} <span>·</span> {invoice.description}
                      </small>
                    </span>
                  </button>
                </td>
                <td>{dateLabel(invoice.dueDate)}</td>
                <td className="amount-cell">{money(invoice.amountCents)}</td>
                <td>
                  <Status status={displayStatus(invoice)} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Inspect ${invoice.number}`}
                    onClick={() => setSelectedId(invoice.id)}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.length === 0 && (
          <div className="empty-state">
            <FileText size={24} />
            <h3>No invoices here yet.</h3>
            <p>
              {query || filter !== "all"
                ? "Try another search or filter."
                : "Import your first invoices in Setup, or explore the sample workspace."}
            </p>
            {!query && filter === "all" && (
              <button className="text-button" onClick={() => navigate("setup")}>
                Go to Setup <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to workspace
      </a>
      <aside className="sidebar" inert={!!selectedId}>
        <button
          className="brand"
          onClick={() => navigate("overview")}
          aria-label="Steward overview"
        >
          <Mark />
          <span>
            steward<span className="brand-period">.</span>
          </span>
        </button>
        <p className="brand-caption">PAY WITH PROOF.</p>
        <div className="business-context">
          <span className="business-avatar">
            <Landmark size={17} />
          </span>
          <div>
            <strong>{workspace?.businessName || "Your workspace"}</strong>
            <small>{demo ? "Sample business" : "Private business pilot"}</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span className="nav-long">{label}</span>
              <span className="nav-short">
                {id === "journal"
                  ? "Journal"
                  : id === "policy"
                    ? "Policy"
                    : id === "setup"
                      ? "Setup"
                      : label}
              </span>
              {id === "invoices" && inbox.length > 0 && <b>{inbox.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="pilot-note">
            <span className="eyebrow">YOUR NEXT CHAPTER</span>
            <h3>
              From a demo
              <br />
              to your business.
            </h3>
            <p>
              Bring real obligations.
              <br />
              Keep every decision visible.
            </p>
            <button onClick={() => navigate("setup")}>
              Start your pilot <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="network-label">
            <span className="network-dot" />
            <span>Built for Arc testnet</span>
            <ArrowUpRight size={13} />
          </div>
          <p className="sidebar-fine">An accountable payments agent.</p>
        </div>
      </aside>
      <div className="main-shell" inert={!!selectedId}>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>{navigation.find((item) => item.id === view)?.label}</span>
          </div>
          <div className="topbar-right">
            <span className={`workspace-badge ${demo ? "" : "pilot"}`}>
              <span />
              {demo ? "Demo workspace" : "Private pilot · testnet"}
            </span>
            <button
              className="icon-button"
              aria-label="Open setup and help"
              onClick={() => navigate("setup")}
            >
              <CircleHelp size={18} />
            </button>
            <span
              className="user-avatar"
              aria-label={caps?.currentUserId ? "Signed in" : "Demo visitor"}
            >
              {caps?.currentUserId ? "ME" : "D"}
            </span>
          </div>
        </header>
        <main id="main" className="workspace-main">
          {error && (
            <div className="alert alert-error" role="alert">
              <XCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert alert-success" role="status">
              <CheckCheck size={18} />
              <span>{notice}</span>
              <button
                className="icon-button"
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!workspace ? (
            <section className="loading-state">
              <Mark />
              <h1>Your money. Clear decisions.</h1>
              <p>
                {busy
                  ? "Opening your workspace…"
                  : "Your workspace couldn’t be loaded."}
              </p>
              {busy ? (
                <Loader2 className="spin" />
              ) : (
                <button className="primary-button" onClick={() => void load()}>
                  Try again <RefreshCw size={16} />
                </button>
              )}
            </section>
          ) : (
            <>
              {view === "overview" && (
                <section className="view-enter">
                  <div className="page-heading">
                    <div>
                      <p className="eyebrow">THE MONEY DESK</p>
                      <h1>
                        Pay what’s due.
                        <br />
                        <em>Keep cash in reserve.</em>
                      </h1>
                      <p className="heading-description">
                        Review invoices, check the evidence,
                        <br className="mobile-break" /> and decide what can be
                        paid today.
                      </p>
                    </div>
                    <div className="heading-action">
                      <button
                        className="primary-button"
                        onClick={run}
                        disabled={!!busy}
                      >
                        {busy === "run" ? (
                          <Loader2 className="spin" size={17} />
                        ) : (
                          <Sparkles size={17} />
                        )}{" "}
                        {busy === "run" ? "Reviewing invoices…" : "Run agent"}
                        <ArrowRight size={17} />
                      </button>
                      <span>
                        {demo
                          ? "Simulated payments. No real funds."
                          : "Owner-authorized testnet transfers only."}
                      </span>
                    </div>
                  </div>
                  <div className="desk-grid">
                    <section className="balance-panel">
                      <div className="panel-top">
                        <span className="eyebrow">
                          {demo ? "DEMO TREASURY" : "TESTNET TREASURY"}
                        </span>
                        <Wallet size={20} />
                      </div>
                      <div className="balance-value">
                        {money(workspace.balanceCents)} <span>USDC</span>
                      </div>
                      <p className="balance-subtitle">
                        {demo
                          ? "Simulated available balance"
                          : "Balance from the latest wallet check"}
                      </p>
                      <div className="balance-rule" />
                      <div className="balance-breakdown">
                        <div>
                          <span>
                            <i className="legend reserve" />
                            Protected reserve
                          </span>
                          <strong>
                            {money(workspace.policy.reserveCents)}
                          </strong>
                        </div>
                        <div>
                          <span>
                            <i className="legend available" />
                            Available for payments
                          </span>
                          <strong>{money(available)}</strong>
                        </div>
                        <div>
                          <span>Gas buffer</span>
                          <strong>
                            {money(workspace.policy.gasReserveCents)}
                          </strong>
                        </div>
                      </div>
                      <div className="reserve-bar" aria-label="Balance split">
                        <span
                          style={{
                            width: `${Math.min(100, workspace.balanceCents ? (workspace.policy.reserveCents / workspace.balanceCents) * 100 : 100)}%`,
                          }}
                        />
                      </div>
                      <div className="balance-footer">
                        <span>
                          <LockKeyhole size={12} />
                          Reserve enforced by payment policy
                        </span>
                        {demo ? (
                          <button
                            onClick={() => setShowFunds(!showFunds)}
                            aria-expanded={showFunds}
                          >
                            <Plus size={13} /> Add demo funds
                          </button>
                        ) : (
                          <button
                            onClick={() => void act("reconcile")}
                            disabled={!!busy}
                          >
                            <RefreshCw size={13} /> Reconcile
                          </button>
                        )}
                      </div>
                      {showFunds && demo && (
                        <form
                          className="add-funds-form"
                          onSubmit={async (event) => {
                            event.preventDefault();
                            if (
                              await act(
                                "add-funds",
                                {
                                  amountCents: Math.round(Number(funds) * 100),
                                },
                                "Demo funds added. Run the agent to reconsider held invoices.",
                              )
                            )
                              setShowFunds(false);
                          }}
                        >
                          <label htmlFor="demo-funds">Simulated USDC</label>
                          <input
                            id="demo-funds"
                            type="number"
                            min="0.01"
                            max="1000000"
                            step="0.01"
                            required
                            value={funds}
                            onChange={(event) => setFunds(event.target.value)}
                          />
                          <button type="submit" disabled={!!busy}>
                            Add funds <ArrowRight size={14} />
                          </button>
                        </form>
                      )}
                    </section>
                    <section className="agent-brief">
                      <div className="brief-top">
                        <span className="eyebrow">YOUR AGENT’S BRIEF</span>
                        <span className="small-live">
                          <span />
                          {busy === "run" ? "WORKING" : "READY WHEN YOU ARE"}
                        </span>
                      </div>
                      <h2>
                        {workspace.runs.length
                          ? "Review the decisions."
                          : "Check the invoices\nbefore paying."}
                      </h2>
                      <p>
                        {workspace.runs.length
                          ? `${paid.length} ${demo ? "simulated payment" : "settled testnet payment"}${paid.length === 1 ? "" : "s"}. ${held.length} on hold. ${blocked.length} exceptions. Open any invoice to see exactly why.`
                          : `I’ll review ${workspace.invoices.filter((invoice) => !["simulated", "settled", "submitted"].includes(invoice.status)).length} outstanding invoices, match the evidence, and protect your ${money(workspace.policy.reserveCents, false)} reserve before anything moves.`}
                      </p>
                      <div className="brief-steps">
                        <span>
                          <Check size={13} /> Verify the obligation
                        </span>
                        <span>
                          <Check size={13} /> Respect your limits
                        </span>
                        <span>
                          <Check size={13} /> Record the reasoning
                        </span>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("policy")}
                      >
                        You set the boundaries <ArrowUpRight size={14} />
                      </button>
                    </section>
                  </div>
                  <div className="outcome-strip">
                    <div>
                      <span className="metric-label">
                        {demo ? "SIMULATED PAYMENTS" : "SETTLED ON TESTNET"}
                      </span>
                      <strong>
                        {money(paidCents)}
                        <small>{paid.length} invoices</small>
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">
                        WAITING FOR THE RIGHT TIME
                      </span>
                      <strong>
                        {held.length.toString().padStart(2, "0")}
                        <small>invoices on hold</small>
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">
                        CAUGHT BEFORE PAYMENT
                      </span>
                      <strong>
                        {blocked.length.toString().padStart(2, "0")}
                        <small>payment exceptions</small>
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">
                        {demo
                          ? "DEMO DISCOUNTS CAPTURED"
                          : "TESTNET DISCOUNTS CAPTURED"}
                      </span>
                      <strong>
                        {money(savedCents)}
                        <small>from invoice terms</small>
                      </strong>
                    </div>
                  </div>
                  <section className="invoices-section">
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">THE WORK IN FRONT OF YOU</p>
                        <h2>
                          Invoice desk <span>{workspace.invoices.length}</span>
                        </h2>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("invoices")}
                      >
                        View all invoices <ArrowRight size={15} />
                      </button>
                    </div>
                    {invoiceTable(workspace.invoices.slice(0, 6))}
                  </section>
                  <div className="desk-footnote">
                    <ShieldCheck size={16} />
                    <span>
                      {caps?.aiConfigurationError
                        ? "AI setup is incomplete · owner runs are blocked."
                        : caps?.ai
                          ? "AI enabled by owner · billed API review for owner runs."
                          : "Rules engine · AI assistance is off."}{" "}
                      Every payment passes deterministic checks.
                    </span>
                    <button onClick={() => navigate("setup")}>
                      View connections <ArrowUpRight size={13} />
                    </button>
                  </div>
                </section>
              )}
              {view === "invoices" && (
                <section className="view-enter">
                  <div className="page-heading compact">
                    <div>
                      <p className="eyebrow">EVERY OBLIGATION, ACCOUNTED FOR</p>
                      <h1>The invoice desk.</h1>
                      <p className="heading-description">
                        Read the evidence. Follow the decision. See what moved.
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      disabled={!!busy}
                      onClick={run}
                    >
                      {busy === "run" ? (
                        <Loader2 className="spin" size={17} />
                      ) : (
                        <Sparkles size={17} />
                      )}
                      Run agent <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="table-toolbar">
                    <div className="filter-tabs" aria-label="Filter invoices">
                      {[
                        { id: "all", label: "All invoices" },
                        { id: "inbox", label: "To review" },
                        { id: "held", label: "On hold" },
                        { id: "blocked", label: "Exceptions" },
                        { id: "paid", label: demo ? "Simulated" : "Settled" },
                      ].map((item) => (
                        <button
                          key={item.id}
                          aria-pressed={filter === item.id}
                          className={filter === item.id ? "chosen" : ""}
                          onClick={() => setFilter(item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Search invoices"
                        placeholder="Find an invoice"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                  </div>
                  {invoiceTable(filtered)}
                  <div className="invoice-bottom">
                    <span>
                      {filtered.length} of {workspace.invoices.length} invoices
                      · Amounts in USD
                    </span>
                    <button
                      className="text-button"
                      onClick={() => navigate("setup")}
                    >
                      <Upload size={14} />
                      Import invoices
                    </button>
                  </div>
                  {!demo && (
                    <div className="inline-note">
                      <p>
                        Pending transfers stay pending until Circle confirms
                        their status. Testnet transfers do not settle real-world
                        obligations.
                      </p>
                      <button
                        className="secondary-button"
                        disabled={!!busy}
                        onClick={() => void act("reconcile")}
                      >
                        Reconcile payments <RefreshCw size={15} />
                      </button>
                    </div>
                  )}
                </section>
              )}
              {view === "journal" && (
                <section className="view-enter">
                  <div className="page-heading compact">
                    <div>
                      <p className="eyebrow">NOTHING HIDDEN IN A BLACK BOX</p>
                      <h1>The decision journal.</h1>
                      <p className="heading-description">
                        A recorded reason for every action. A trail you can take
                        with you.
                      </p>
                    </div>
                    <a className="secondary-button" href="/api/export" download>
                      Export evidence <ArrowDownToLine size={16} />
                    </a>
                  </div>
                  <div className="journal-summary">
                    <div>
                      <strong>{workspace.audit.length}</strong>
                      <span>recorded events</span>
                    </div>
                    <div>
                      <strong>{workspace.runs.length}</strong>
                      <span>agent runs</span>
                    </div>
                    <p>
                      <ShieldCheck size={20} />
                      Events link to their predecessors with hashes. Export the
                      record for independent inspection; the log is not
                      blockchain anchored.
                    </p>
                  </div>
                  <ol className="journal-list">
                    {[...workspace.audit].reverse().map((event) => (
                      <li key={event.id}>
                        <div
                          className={`journal-icon ${event.type.includes("block") ? "danger" : ""}`}
                        >
                          {event.type.includes("payment") ? (
                            <ArrowUpRight size={17} />
                          ) : event.type.includes("policy") ? (
                            <SlidersHorizontal size={17} />
                          ) : (
                            <Check size={17} />
                          )}
                        </div>
                        <div className="journal-content">
                          <div className="journal-title">
                            <h3>{event.title}</h3>
                            <time dateTime={event.at}>
                              {dateLabel(event.at)} ·{" "}
                              {new Date(event.at).toLocaleTimeString("en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </time>
                          </div>
                          <p>{event.detail}</p>
                          {event.invoiceId && (
                            <button
                              className="text-button"
                              onClick={() => setSelectedId(event.invoiceId!)}
                            >
                              Inspect invoice <ArrowUpRight size={13} />
                            </button>
                          )}
                          <details className="technical-details">
                            <summary>Event integrity</summary>
                            <div>
                              <span>Hash</span>
                              <code>{event.hash}</code>
                              <span>Previous hash</span>
                              <code>
                                {event.previousHash || "Genesis event"}
                              </code>
                            </div>
                          </details>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {view === "policy" && (
                <section className="view-enter">
                  <div className="page-heading compact">
                    <div>
                      <p className="eyebrow">AUTONOMY WITH BOUNDARIES</p>
                      <h1>Your money. Your rules.</h1>
                      <p className="heading-description">
                        The agent works inside these limits, on every payment.
                      </p>
                    </div>
                    <span className="outline-badge">
                      <ShieldCheck size={15} />
                      Application-enforced policy
                    </span>
                  </div>
                  <div className="policy-layout">
                    <PolicyForm
                      key={`${workspace.id}-${workspace.revision}`}
                      policy={workspace.policy}
                      busy={!!busy}
                      canEdit={demo || !!caps?.ownerAuthorized}
                      save={(policy) =>
                        act(
                          "policy",
                          { policy },
                          "Payment policy saved. New decisions will use these limits.",
                        )
                      }
                    />
                    <aside className="policy-explainer">
                      <span className="eyebrow">THE PAYMENT PROMISE</span>
                      <h2>
                        Evidence first.
                        <br />
                        Money second.
                      </h2>
                      <ul>
                        <li>
                          <Check size={15} />
                          <span>
                            The recipient must match an approved vendor.
                          </span>
                        </li>
                        <li>
                          <Check size={15} />
                          <span>
                            An obligation needs a matching order and
                            owner-attested acceptance.
                          </span>
                        </li>
                        <li>
                          <Check size={15} />
                          <span>
                            Duplicate obligations and unexpected payee changes
                            are blocked.
                          </span>
                        </li>
                        <li>
                          <Check size={15} />
                          <span>
                            Reserve, payment, and run limits are checked before
                            execution.
                          </span>
                        </li>
                        <li>
                          <Check size={15} />
                          <span>Every action leaves a readable record.</span>
                        </li>
                      </ul>
                      <p>
                        These are application controls, not smart-contract
                        restrictions. Owner attestations are not independently
                        verified by Steward.
                      </p>
                    </aside>
                  </div>
                </section>
              )}
              {view === "setup" && (
                <section className="view-enter">
                  <div className="page-heading compact">
                    <div>
                      <p className="eyebrow">PILOT SETUP</p>
                      <h1>Connect your workspace.</h1>
                      <p className="heading-description">
                        Connect a testnet wallet, bring your records, and run a
                        private pilot.
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={!!busy}
                      onClick={() => void load()}
                    >
                      <RefreshCw size={15} />
                      Refresh status
                    </button>
                  </div>
                  <div className="setup-status">
                    <div>
                      <span
                        className={`connection-dot ${caps?.circle ? "configured" : ""}`}
                      />
                      <div>
                        <strong>Circle wallet</strong>
                        <small>
                          {caps?.circle
                            ? "Server configuration present · connection not verified"
                            : "Not connected"}
                        </small>
                      </div>
                    </div>
                    <div>
                      <span
                        className={`connection-dot ${caps?.ai ? "configured" : ""}`}
                      />
                      <div>
                        <strong>AI assistance</strong>
                        <small>
                          {caps?.aiConfigurationError
                            ? "Setup incomplete · owner runs blocked"
                            : caps?.ai
                              ? `${caps.aiProvider === "compatible" ? "Compatible provider" : "OpenAI"} configured · connection not verified`
                              : "Off · deterministic rules engine active"}
                        </small>
                      </div>
                    </div>
                    <div>
                      <span
                        className={`connection-dot ${caps?.ownerAuthorized ? "configured" : ""}`}
                      />
                      <div>
                        <strong>Owner authorization</strong>
                        <small>
                          {caps?.ownerAuthorized
                            ? "Authorized owner"
                            : "Setup required for testnet execution"}
                        </small>
                      </div>
                    </div>
                  </div>
                  <div className="setup-step">
                    <div className="step-number">01</div>
                    <div className="step-content">
                      <h2>Claim your private workspace.</h2>
                      <p>
                        Sign in to keep your business records separate from this
                        demonstration. Then authorize your account in the
                        server’s environment.
                      </p>
                      {caps?.currentUserId ? (
                        <>
                          <label className="code-label">
                            Your signed-in user ID
                          </label>
                          <code className="copy-code">
                            {caps.currentUserId}
                          </code>
                          <p className="fine-print">
                            Set <code>STEWARD_OWNER_ID</code> to this value in
                            your server environment. Only this owner can run
                            pilot payments or change payment policy.
                          </p>
                          <div className="button-row">
                            <button
                              className="secondary-button"
                              disabled={!!busy || !demo}
                              onClick={() =>
                                void act("pilot", {}, "Private pilot opened.")
                              }
                            >
                              Open private pilot <ArrowRight size={15} />
                            </button>
                            {!demo && (
                              <button
                                className="text-button"
                                disabled={!!busy}
                                onClick={() =>
                                  void act(
                                    "demo",
                                    {},
                                    "Sample workspace opened.",
                                  )
                                }
                              >
                                Return to demo <ArrowRight size={15} />
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <a
                          href="/signin-with-chatgpt?return_to=/"
                          className="secondary-button"
                        >
                          Sign in with ChatGPT <ArrowUpRight size={15} />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="setup-step">
                    <div className="step-number">02</div>
                    <div className="step-content">
                      <h2>Give your agent a testnet wallet.</h2>
                      <p>
                        Create a Circle developer-controlled wallet on Arc
                        testnet. Add the following settings to your server
                        environment, then refresh this page. Keep credentials on
                        the server.
                      </p>
                      <div className="env-list">
                        <code>CIRCLE_API_KEY</code>
                        <span>Your Circle test API key</span>
                        <code>CIRCLE_ENTITY_SECRET</code>
                        <span>Your registered 32-byte entity secret</span>
                        <code>CIRCLE_WALLET_ID</code>
                        <span>Your Arc testnet wallet ID</span>
                        <code>CIRCLE_BLOCKCHAIN</code>
                        <span>ARC-TESTNET</span>
                      </div>
                      <div className="button-row">
                        <a
                          className="text-button"
                          href="https://developers.circle.com/wallets/dev-controlled"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Circle wallet guide <ArrowUpRight size={14} />
                        </a>
                        <a
                          className="text-button"
                          href="https://faucet.circle.com/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Get testnet funds <ArrowUpRight size={14} />
                        </a>
                      </div>
                      {caps?.walletAddress && (
                        <p className="fine-print">
                          Wallet address: <code>{caps.walletAddress}</code>
                        </p>
                      )}
                      <div className="quiet-note">
                        {caps?.aiConfigurationError
                          ? caps.aiConfigurationError
                          : caps?.ai
                            ? "AI review is enabled in server configuration. Only owner runs may use it. Set STEWARD_ENABLE_AI=false on the server to return to rules-only execution."
                            : "AI assistance is optional and currently off. Model use requires separate permission and server configuration. No AI calls are needed to explore the demo."}
                      </div>
                    </div>
                  </div>
                  <div className="setup-step">
                    <div className="step-number">03</div>
                    <div className="step-content">
                      <h2>Import your invoices and evidence.</h2>
                      <p>
                        Import up to 30 invoices with vendor approvals, order
                        references, and delivery acceptance. Start with the
                        sample format and replace every example with your own
                        records.
                      </p>
                      <button className="text-button" onClick={sample}>
                        <ArrowDownToLine size={15} />
                        Download sample JSON
                      </button>
                      <form className="import-form" onSubmit={importRecords}>
                        <div className="import-label-row">
                          <label htmlFor="import-json">
                            Business records · JSON
                          </label>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => fileInput.current?.click()}
                          >
                            <Upload size={14} />
                            Choose file
                          </button>
                        </div>
                        <input
                          ref={fileInput}
                          className="sr-only"
                          type="file"
                          accept=".json,application/json"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (file.size > 100000) {
                              setError("Use a JSON file smaller than 100 KB.");
                              return;
                            }
                            try {
                              setImportText(await file.text());
                              setError("");
                            } catch {
                              setError(
                                "Could not read this file. Paste the JSON below instead.",
                              );
                            }
                          }}
                        />
                        <textarea
                          id="import-json"
                          rows={7}
                          required
                          value={importText}
                          onChange={(event) =>
                            setImportText(event.target.value)
                          }
                          placeholder={
                            '{\n  "businessName": "Your business",\n  "vendors": [...],\n  "invoices": [...]\n}'
                          }
                        />
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            required
                            checked={importConfirmed}
                            onChange={(event) =>
                              setImportConfirmed(event.target.checked)
                            }
                          />
                          <span>
                            I am authorized to import these records. Approved
                            addresses and delivery acceptance reflect my own
                            review.
                          </span>
                        </label>
                        <button
                          className="primary-button"
                          type="submit"
                          disabled={
                            !!busy || !caps?.currentUserId || !importConfirmed
                          }
                        >
                          {busy === "import" ? (
                            <Loader2 size={16} className="spin" />
                          ) : (
                            <Upload size={16} />
                          )}
                          Import into private pilot
                        </button>
                        {!caps?.currentUserId && (
                          <p className="fine-print">
                            Sign in at step 1 to import private business
                            records.
                          </p>
                        )}
                      </form>
                    </div>
                  </div>
                  <div className="setup-step">
                    <div className="step-number">04</div>
                    <div className="step-content">
                      <h2>Review, run, and keep the proof.</h2>
                      <p>
                        Set your payment policy. Run the agent. Reconcile
                        submitted transactions until the provider confirms
                        completion, then export the journal for your records.
                        Testnet tokens have no monetary value; a testnet
                        transfer does not pay an actual invoice.
                      </p>
                      <div className="button-row">
                        <button
                          className="secondary-button"
                          onClick={() => navigate("policy")}
                        >
                          Review payment policy <ArrowRight size={15} />
                        </button>
                        <a className="text-button" href="/api/export" download>
                          Export current evidence <ArrowDownToLine size={15} />
                        </a>
                      </div>
                    </div>
                  </div>
                  {demo && (
                    <div className="demo-reset">
                      <div>
                        <h3>A fresh demonstration.</h3>
                        <p>
                          Reset synthetic invoices, simulated funds, and the
                          demo decision journal.
                        </p>
                      </div>
                      {resetConfirm ? (
                        <div className="button-row">
                          <button
                            className="text-button"
                            onClick={() => setResetConfirm(false)}
                          >
                            Cancel
                          </button>
                          <button
                            className="secondary-button danger-text"
                            disabled={!!busy}
                            onClick={async () => {
                              if (
                                await act(
                                  "reset",
                                  {},
                                  "Demo reset. You can run the scenario again.",
                                )
                              ) {
                                setResetConfirm(false);
                                setSelectedId(null);
                              }
                            }}
                          >
                            Confirm reset <RotateCcw size={15} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="secondary-button"
                          onClick={() => setResetConfirm(true)}
                        >
                          Reset demo <RotateCcw size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
              )}
              <footer className="workspace-footer">
                <span>
                  <Mark small />
                  Steward <span className="footer-divider">/</span> Pay with
                  proof.
                </span>
                <span>
                  {demo
                    ? "Synthetic data · No real funds moved"
                    : "Arc testnet · No real-world settlement"}
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {selected && workspace && (
        <>
          <button
            className="inspector-scrim"
            aria-label="Close invoice inspector"
            onClick={() => setSelectedId(null)}
          />
          <aside
            ref={inspectorRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="invoice-inspector"
            aria-label={`Invoice ${selected.number} details`}
          >
            <div className="inspector-header">
              <span className="eyebrow">THE PAYMENT FILE</span>
              <button
                className="icon-button"
                aria-label="Close invoice inspector"
                onClick={() => setSelectedId(null)}
              >
                <X size={20} />
              </button>
            </div>
            <Status status={displayStatus(selected)} />
            <h2>{vendorName(selected)}</h2>
            <p className="inspector-description">{selected.description}</p>
            <div className="inspector-amount">
              {money(selected.amountCents)} <span>USD</span>
            </div>
            <div className="invoice-meta">
              <div>
                <span>Invoice</span>
                <strong>{selected.number}</strong>
              </div>
              <div>
                <span>Due date</span>
                <strong>{dateLabel(selected.dueDate)}</strong>
              </div>
              <div>
                <span>Payee address</span>
                <code title={selected.recipientAddress}>
                  {shortAddress(selected.recipientAddress)}
                </code>
              </div>
              <div>
                <span>Purchase order</span>
                <strong>{selected.purchaseOrderRef || "Not supplied"}</strong>
              </div>
            </div>
            <section className="inspector-section">
              <h3>
                <Sparkles size={16} />
                The decision
              </h3>
              {selected.decision ? (
                <>
                  <p>{selected.decision.reason}</p>
                  <span className="decision-engine">
                    {selected.decision.engine !== "rules"
                      ? "AI-assisted · deterministic controls"
                      : "Deterministic rules engine"}
                  </span>
                  {selected.decision.modelRationale && (
                    <p className="model-rationale">
                      {selected.decision.modelRationale}
                    </p>
                  )}
                </>
              ) : (
                <p>
                  This invoice has not been reviewed. Run the agent to check the
                  evidence and payment policy.
                </p>
              )}
            </section>
            <section className="inspector-section">
              <h3>
                <ShieldCheck size={16} />
                Evidence & checks
              </h3>
              {selected.decision ? (
                <ul className="checks-list">
                  {selected.decision.checks.map((check, index) => (
                    <li key={`${check.code}-${index}`}>
                      <span
                        className={check.passed ? "check-pass" : "check-fail"}
                      >
                        {check.passed ? <Check size={13} /> : <X size={13} />}
                      </span>
                      <div>
                        <strong>{check.label}</strong>
                        <p>{check.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="evidence-preview">
                  <p>
                    <strong>Source reference</strong>
                    {selected.sourceReference || "No source supplied"}
                  </p>
                  <p>
                    <strong>Purchase order</strong>
                    {selected.purchaseOrderRef || "Missing"} ·{" "}
                    {money(selected.purchaseOrderAmountCents)}
                  </p>
                  <p>
                    <strong>Delivery acceptance</strong>
                    {selected.acceptanceVerified
                      ? "Attested by the record owner"
                      : "Not yet attested"}
                  </p>
                </div>
              )}
              {selected.decision?.evidence.length ? (
                <details className="evidence-details">
                  <summary>View source evidence</summary>
                  <ul>
                    {selected.decision.evidence.map((evidence, index) => (
                      <li key={index}>{evidence}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
            <section className="inspector-section">
              <h3>
                <Wallet size={16} />
                Payment record
              </h3>
              {selected.payment ? (
                <>
                  <div className="payment-record">
                    <span>Amount</span>
                    <strong>{money(selected.payment.amountCents)} USDC</strong>
                    <span>Environment</span>
                    <strong>
                      {selected.payment.mode === "demo"
                        ? "Simulation · no funds moved"
                        : "Arc testnet"}
                    </strong>
                    <span>Status</span>
                    <strong>{selected.payment.status}</strong>
                    {selected.payment.transactionId && (
                      <>
                        <span>Provider transaction</span>
                        <code>{selected.payment.transactionId}</code>
                      </>
                    )}
                    {selected.payment.transactionHash && (
                      <>
                        <span>Transaction hash</span>
                        <code>{selected.payment.transactionHash}</code>
                      </>
                    )}
                  </div>
                  <details className="technical-details">
                    <summary>Execution reference</summary>
                    <code>{selected.payment.idempotencyKey}</code>
                  </details>
                </>
              ) : (
                <p>No payment has been sent for this invoice.</p>
              )}
            </section>
            <div className="inspector-footnote">
              <LockKeyhole size={14} />
              <span>
                Owner-supplied evidence.{" "}
                {demo
                  ? "Synthetic demonstration only."
                  : "Testnet transfers do not settle real invoices."}
              </span>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function PolicyForm({
  policy,
  busy,
  canEdit,
  save,
}: {
  policy: Policy;
  busy: boolean;
  canEdit: boolean;
  save: (policy: Policy) => Promise<boolean>;
}) {
  const [values, setValues] = useState<Record<keyof Policy, string>>({
    reserveCents: (policy.reserveCents / 100).toString(),
    perPaymentLimitCents: (policy.perPaymentLimitCents / 100).toString(),
    runLimitCents: (policy.runLimitCents / 100).toString(),
    gasReserveCents: (policy.gasReserveCents / 100).toString(),
    approvalRequiredAboveCents: (
      policy.approvalRequiredAboveCents / 100
    ).toString(),
  });
  const fields: [keyof Policy, string, string][] = [
    [
      "reserveCents",
      "Protect a cash reserve",
      "The minimum balance your agent must leave untouched.",
    ],
    [
      "perPaymentLimitCents",
      "Maximum per payment",
      "The largest payment allowed in a single transfer.",
    ],
    [
      "runLimitCents",
      "Maximum per agent run",
      "The total the agent can spend in one review.",
    ],
    [
      "approvalRequiredAboveCents",
      "Owner review above",
      "Invoices above this value are held for owner review.",
    ],
    [
      "gasReserveCents",
      "Keep a gas buffer",
      "USDC set aside for network fees on Arc testnet.",
    ],
  ];
  return (
    <form
      className="policy-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(
          Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
              key,
              Math.round(Number(value) * 100),
            ]),
          ) as unknown as Policy,
        );
      }}
    >
      {fields.map(([key, label, help]) => (
        <div className="policy-field" key={key}>
          <label htmlFor={key}>
            {label}
            <span>{help}</span>
          </label>
          <div className="money-input">
            <span>$</span>
            <input
              id={key}
              type="number"
              step="0.01"
              min={key === "gasReserveCents" ? "0.01" : "0"}
              max="1000000"
              required
              disabled={!canEdit}
              value={values[key]}
              onChange={(event) =>
                setValues({ ...values, [key]: event.target.value })
              }
            />
            <span>USD</span>
          </div>
        </div>
      ))}
      <div className="policy-save">
        <button
          className="primary-button"
          type="submit"
          disabled={busy || !canEdit}
        >
          Save payment policy <Check size={16} />
        </button>
        <p>
          {canEdit
            ? "Changes apply to the next agent run."
            : "Only the configured owner can edit pilot policy. Finish Setup first."}
        </p>
      </div>
    </form>
  );
}
