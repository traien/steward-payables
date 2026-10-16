export type InvoiceStatus =
  | "inbox"
  | "ready"
  | "held"
  | "blocked"
  | "submitted"
  | "settled"
  | "simulated"
  | "failed";
export type Action = "pay" | "hold" | "escalate" | "block";
export type DecisionEngine = "rules" | "openai" | "compatible";
export interface Vendor {
  id: string;
  name: string;
  category: string;
  approvedAddress: string;
}
export interface Invoice {
  id: string;
  number: string;
  vendorId: string;
  description: string;
  amountCents: number;
  currency: "USD";
  dueDate: string;
  recipientAddress: string;
  purchaseOrderRef: string;
  purchaseOrderAmountCents: number;
  acceptanceVerified: boolean;
  sourceReference: string;
  status: InvoiceStatus;
  discountBps?: number;
  discountUntil?: string;
  decision?: Decision;
  payment?: Payment;
}
export interface Check {
  code: string;
  label: string;
  passed: boolean;
  detail: string;
}
export interface Decision {
  invoiceId: string;
  action: Action;
  reason: string;
  evidence: string[];
  checks: Check[];
  amountCents: number;
  decidedAt: string;
  engine: DecisionEngine;
  modelRationale?: string;
}
export interface Payment {
  idempotencyKey: string;
  mode: "demo" | "testnet";
  status: "simulated" | "pending" | "complete" | "failed";
  amountCents: number;
  recipientAddress: string;
  transactionId?: string;
  transactionHash?: string;
  submittedAt: string;
  completedAt?: string;
}
export interface Policy {
  reserveCents: number;
  perPaymentLimitCents: number;
  runLimitCents: number;
  gasReserveCents: number;
  approvalRequiredAboveCents: number;
}
export interface AuditEvent {
  id: string;
  at: string;
  type: string;
  title: string;
  detail: string;
  invoiceId?: string;
  previousHash: string;
  hash: string;
}
export interface AgentRun {
  id: string;
  at: string;
  engine: DecisionEngine;
  decisions: Decision[];
  paidCents: number;
  paymentCount: number;
  heldCount: number;
  blockedCount: number;
  inputSnapshot?: {
    balanceCents: number;
    policy: Policy;
    vendors: Vendor[];
    invoices: Omit<Invoice, "decision" | "payment">[];
  };
}
export interface Workspace {
  id: string;
  businessName: string;
  mode: "demo" | "pilot";
  balanceCents: number;
  vendors: Vendor[];
  invoices: Invoice[];
  policy: Policy;
  audit: AuditEvent[];
  runs: AgentRun[];
  createdAt: string;
  revision: number;
}
export interface Capabilities {
  ai: boolean;
  aiProvider?: "openai" | "compatible";
  aiConfigurationError?: string;
  circle: boolean;
  walletIdConfigured: boolean;
  network: "ARC-TESTNET";
  enforcement: "application";
  walletAddress?: string;
  currentUserId?: string;
  ownerAuthorized?: boolean;
}
export interface WorkspaceResponse {
  workspace: Workspace;
  capabilities: Capabilities;
}
