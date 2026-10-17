import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const id = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const cents = z.number().int().nonnegative().max(100_000_000);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(value);
    return (
      Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date (YYYY-MM-DD).");
export const policySchema = z
  .object({
    reserveCents: cents,
    perPaymentLimitCents: cents,
    runLimitCents: cents,
    gasReserveCents: cents.min(1),
    approvalRequiredAboveCents: cents,
  })
  .strict();
const vendorSchema = z
  .object({ id, name: text, category: text, approvedAddress: address })
  .strict();
const invoiceSchema = z
  .object({
    id,
    number: text,
    vendorId: id,
    description: text,
    amountCents: cents.min(1),
    currency: z.literal("USD"),
    dueDate: date,
    recipientAddress: address,
    purchaseOrderRef: z.string().trim().max(500),
    purchaseOrderAmountCents: cents,
    acceptanceVerified: z.boolean(),
    sourceReference: z.string().trim().max(500),
    discountBps: z.number().int().min(1).max(1000).optional(),
    discountUntil: date.optional(),
    status: z
      .enum([
        "inbox",
        "ready",
        "held",
        "blocked",
        "submitted",
        "settled",
        "simulated",
        "failed",
      ])
      .optional(),
  })
  .strip();
export const importSchema = z
  .object({
    businessName: text,
    vendors: z.array(vendorSchema).min(1).max(30),
    invoices: z.array(invoiceSchema).min(1).max(30),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.vendors.map((v) => v.id)).size !== data.vendors.length)
      ctx.addIssue({ code: "custom", message: "Vendor IDs must be unique." });
    if (new Set(data.invoices.map((v) => v.id)).size !== data.invoices.length)
      ctx.addIssue({ code: "custom", message: "Invoice IDs must be unique." });
    if (
      data.invoices.some((i) => !data.vendors.some((v) => v.id === i.vendorId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Each invoice must reference an imported vendor.",
      });
  });
export const clientInvoiceSchema = z
  .object({
    id,
    number: text,
    clientAlias: text,
    description: text,
    amountCents: cents.min(1),
    paidCents: cents,
    currency: z.enum(["USD", "EUR", "GBP", "TRY"]),
    dueDate: date,
    workStatus: z.enum(["accepted", "pending", "disputed"]),
    sourceReference: text,
  })
  .strict()
  .refine((record) => record.paidCents <= record.amountCents, {
    message: "Paid amount cannot exceed the invoice amount.",
    path: ["paidCents"],
  });
export const importReceivableSchema = z
  .object({ businessName: text, record: clientInvoiceSchema })
  .strict();
export const receivableFeedbackSchema = z
  .object({
    id,
    reviewAsOf: date,
    assessment: z.enum(["useful", "needs-correction"]),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("reconcile") }),
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("demo") }),
  z.object({ action: z.literal("pilot") }),
  z.object({ action: z.literal("add-funds"), amountCents: cents.min(1) }),
  z.object({ action: z.literal("policy"), policy: policySchema }),
  z
    .object({
      action: z.literal("import-receivable"),
      ...importReceivableSchema.shape,
    })
    .strict(),
  z.object({ action: z.literal("review-receivables") }).strict(),
  z
    .object({
      action: z.literal("receivable-feedback"),
      ...receivableFeedbackSchema.shape,
    })
    .strict(),
  z.object({
    action: z.literal("import"),
    businessName: text,
    vendors: z.array(vendorSchema),
    invoices: z.array(invoiceSchema),
  }),
]);
