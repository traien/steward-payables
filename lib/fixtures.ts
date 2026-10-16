import type { Invoice, Workspace } from "./domain";

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
  const historical = invoice({
    id: "invoice-history",
    number: "COPY-008",
    vendorId: "vendor-copy",
    amountCents: 18_000,
    description: "Previous copywriting invoice · synthetic history",
    dueDate: dateOffset(-7),
    status: "simulated",
  });
  historical.payment = {
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    mode: "demo",
    status: "simulated",
    amountCents: 18_000,
    recipientAddress: historical.recipientAddress,
    submittedAt: `${dateOffset(-7)}T12:00:00.000Z`,
    completedAt: `${dateOffset(-7)}T12:00:00.000Z`,
  };
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
    historical,
  ];
  return workspace;
}
