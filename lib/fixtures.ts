import type { ClientInvoice, Invoice, Workspace } from "./domain";
import { reviewReceivable } from "./receivables.ts";

function dateOffset(days: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return now.toISOString().slice(0, 10);
}

export function createPilotWorkspace(id: string, name: string): Workspace {
  return {
    id,
    businessName: name.trim() || "My business",
    mode: "pilot",
    balanceCents: 0,
    vendors: [],
    invoices: [],
    audit: [],
    runs: [],
    createdAt: new Date().toISOString(),
    revision: 0,
    policy: {
      reserveCents: 100,
      gasReserveCents: 100,
      perPaymentLimitCents: 500,
      runLimitCents: 1000,
      approvalRequiredAboveCents: 500,
    },
  };
}

/** Entirely synthetic scenario. Names, evidence, balances and history are fixtures. */
export function createDemoWorkspace(id: string): Workspace {
  const workspace = createPilotWorkspace(
    id,
    "Northstar Studio · synthetic demo",
  );
  workspace.mode = "demo";
  workspace.balanceCents = 125_000;
  workspace.policy = {
    reserveCents: 50_000,
    gasReserveCents: 100,
    perPaymentLimitCents: 80_000,
    runLimitCents: 120_000,
    approvalRequiredAboveCents: 80_000,
  };
  workspace.vendors = [
    {
      id: "vendor-design",
      name: "Mira Design · fictional",
      category: "Design",
      approvedAddress: "0x1111111111111111111111111111111111111111",
    },
    {
      id: "vendor-dev",
      name: "Orion Engineering · fictional",
      category: "Development",
      approvedAddress: "0x2222222222222222222222222222222222222222",
    },
    {
      id: "vendor-video",
      name: "Framehouse · fictional",
      category: "Video",
      approvedAddress: "0x3333333333333333333333333333333333333333",
    },
    {
      id: "vendor-copy",
      name: "Paperplane Copy · fictional",
      category: "Copywriting",
      approvedAddress: "0x4444444444444444444444444444444444444444",
    },
    {
      id: "vendor-cloud",
      name: "Cedar Cloud · fictional",
      category: "Infrastructure",
      approvedAddress: "0x5555555555555555555555555555555555555555",
    },
    {
      id: "vendor-analytics",
      name: "Lumen Analytics · fictional",
      category: "Software",
      approvedAddress: "0x6666666666666666666666666666666666666666",
    },
    {
      id: "vendor-localization",
      name: "Lingua Studio · fictional",
      category: "Localization",
      approvedAddress: "0x7777777777777777777777777777777777777777",
    },
    {
      id: "vendor-photo",
      name: "Finch Photography · fictional",
      category: "Photography",
      approvedAddress: "0x8888888888888888888888888888888888888888",
    },
  ];
  const invoice = (
    overrides: Partial<Invoice> &
      Pick<Invoice, "id" | "number" | "vendorId" | "amountCents">,
  ): Invoice => ({
    description: "Synthetic agency obligation",
    currency: "USD",
    dueDate: dateOffset(0),
    recipientAddress: workspace.vendors.find(
      (vendor) => vendor.id === overrides.vendorId,
    )!.approvedAddress,
    purchaseOrderRef: `DEMO-PO-${overrides.number}`,
    purchaseOrderAmountCents: overrides.amountCents,
    acceptanceVerified: true,
    sourceReference: `Synthetic fixture / ${overrides.number}; not a real invoice`,
    status: "inbox",
    ...overrides,
  });
  const historical = (
    overrides: Partial<Invoice> &
      Pick<Invoice, "id" | "number" | "vendorId" | "amountCents">,
    daysAgo: number,
    sequence: number,
  ): Invoice => {
    const record = invoice({
      ...overrides,
      dueDate: dateOffset(-daysAgo),
      status: "simulated",
      ...(overrides.discountBps
        ? { discountUntil: dateOffset(-daysAgo) }
        : {}),
    });
    const savings = Math.floor(
      (record.amountCents * (record.discountBps ?? 0)) / 10_000,
    );
    record.payment = {
      idempotencyKey: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      mode: "demo",
      status: "simulated",
      amountCents: record.amountCents - savings,
      recipientAddress: record.recipientAddress,
      submittedAt: `${dateOffset(-daysAgo)}T12:00:00.000Z`,
      completedAt: `${dateOffset(-daysAgo)}T12:00:00.000Z`,
    };
    return record;
  };
  const copyHistory = historical({
    id: "invoice-history",
    number: "COPY-008",
    vendorId: "vendor-copy",
    amountCents: 18_000,
    description: "Previous copywriting invoice · synthetic history",
  }, 7, 1);
  workspace.invoices = [
    invoice({
      id: "invoice-ready",
      number: "DES-104",
      vendorId: "vendor-design",
      amountCents: 35_000,
      description: "Brand launch assets · accepted delivery",
      discountBps: 200,
      discountUntil: dateOffset(0),
    }),
    invoice({
      id: "invoice-reserve",
      number: "DEV-206",
      vendorId: "vendor-dev",
      amountCents: 60_000,
      description: "Website implementation · accepted delivery",
    }),
    invoice({
      id: "invoice-wallet",
      number: "VID-019",
      vendorId: "vendor-video",
      amountCents: 24_000,
      description: "Campaign video · changed payment address",
      recipientAddress: "0x9999999999999999999999999999999999999999",
    }),
    invoice({
      id: "invoice-duplicate",
      number: "copy 008",
      vendorId: "vendor-copy",
      amountCents: 18_000,
      description: "Copywriting invoice resubmitted with a different filename",
    }),
    invoice({
      id: "invoice-acceptance",
      number: "DES-105",
      vendorId: "vendor-design",
      amountCents: 12_000,
      description: "Social asset pack · acceptance not confirmed",
      acceptanceVerified: false,
    }),
    invoice({
      id: "invoice-cloud-renewal",
      number: "CLD-042",
      vendorId: "vendor-cloud",
      amountCents: 8_900,
      description: "Managed hosting · next monthly renewal",
      dueDate: dateOffset(3),
    }),
    invoice({
      id: "invoice-analytics-renewal",
      number: "LUM-031",
      vendorId: "vendor-analytics",
      amountCents: 14_900,
      description: "Analytics workspace · monthly subscription",
      dueDate: dateOffset(5),
    }),
    invoice({
      id: "invoice-localization",
      number: "LOC-063",
      vendorId: "vendor-localization",
      amountCents: 28_000,
      description: "French and German launch copy · accepted delivery",
      dueDate: dateOffset(8),
    }),
    invoice({
      id: "invoice-order-mismatch",
      number: "DEV-207",
      vendorId: "vendor-dev",
      amountCents: 9_000,
      description: "Accessibility fixes · invoice exceeds the approved order",
      purchaseOrderAmountCents: 7_500,
      dueDate: dateOffset(-2),
    }),
    invoice({
      id: "invoice-missing-source",
      number: "PHT-018",
      vendorId: "vendor-photo",
      amountCents: 42_500,
      description: "Product photography · original invoice still needed",
      sourceReference: "",
      dueDate: dateOffset(-1),
    }),
    invoice({
      id: "invoice-payment-cap",
      number: "DES-106",
      vendorId: "vendor-design",
      amountCents: 92_000,
      description: "Campaign identity system · above the payment limit",
    }),
    copyHistory,
    historical({
      id: "invoice-history-design",
      number: "DES-103",
      vendorId: "vendor-design",
      amountCents: 50_000,
      description: "Pitch deck and presentation kit · synthetic history",
      discountBps: 200,
    }, 12, 2),
    historical({
      id: "invoice-history-dev",
      number: "DEV-205",
      vendorId: "vendor-dev",
      amountCents: 80_000,
      description: "Customer portal milestone · synthetic history",
      discountBps: 200,
    }, 18, 3),
    historical({
      id: "invoice-history-cloud",
      number: "CLD-041",
      vendorId: "vendor-cloud",
      amountCents: 8_900,
      description: "Managed hosting · previous month, synthetic history",
    }, 27, 4),
    historical({
      id: "invoice-history-video",
      number: "VID-018",
      vendorId: "vendor-video",
      amountCents: 32_000,
      description: "Product launch edit · synthetic history",
    }, 21, 5),
  ];
  // Sample client records are read-only; demo feedback is never evidence of use.
  const clientInvoice = (
    overrides: Pick<ClientInvoice, "id" | "number" | "clientAlias" | "description" | "amountCents" | "dueDate"> & Partial<ClientInvoice>,
  ): ClientInvoice => {
    const record: ClientInvoice = {
      currency: "USD",
      paidCents: 0,
      workStatus: "accepted",
      sourceReference: `Synthetic client invoice / ${overrides.number}; not a business record`,
      ...overrides,
    };
    record.review = reviewReceivable(record);
    return record;
  };
  workspace.receivables = [
    clientInvoice({
      id: "receivable-paid",
      number: "NS-2026-041",
      clientAlias: "Juniper & Co. · fictional",
      description: "Brand strategy and launch kit",
      amountCents: 240_000,
      paidCents: 240_000,
      dueDate: dateOffset(-12),
    }),
    clientInvoice({
      id: "receivable-partial",
      number: "NS-2026-042",
      clientAlias: "Atlas Supply · fictional",
      description: "E-commerce redesign · final milestone",
      amountCents: 360_000,
      paidCents: 180_000,
      dueDate: dateOffset(-6),
    }),
    clientInvoice({
      id: "receivable-upcoming",
      number: "NS-2026-043",
      clientAlias: "Willow Health · fictional",
      description: "Landing page and campaign assets",
      amountCents: 125_000,
      dueDate: dateOffset(9),
    }),
    clientInvoice({
      id: "receivable-pending",
      number: "NS-2026-044",
      clientAlias: "Fieldwork Studio · fictional",
      description: "Client portal · awaiting milestone approval",
      amountCents: 280_000,
      dueDate: dateOffset(2),
      workStatus: "pending",
    }),
    clientInvoice({
      id: "receivable-disputed",
      number: "NS-2026-045",
      clientAlias: "Harbor Collective · fictional",
      description: "Campaign scope change · resolve before collection",
      amountCents: 140_000,
      dueDate: dateOffset(-3),
      workStatus: "disputed",
    }),
  ];
  return workspace;
}
