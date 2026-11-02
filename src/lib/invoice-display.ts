// What a customer sees on an invoice. The owner's default template applies to
// every invoice; a single invoice can override it. Amounts, tax and the
// balance due always show.
import { z } from "zod";

export const INVOICE_FIELDS = [
  {
    key: "shopAddress",
    label: "Your business address",
    group: "Your business",
  },
  { key: "shopPhone", label: "Your phone number", group: "Your business" },
  { key: "jobTitle", label: "Job name", group: "The work" },
  { key: "serviceLabel", label: "Property / vehicle", group: "The work" },
  {
    key: "lineDetail",
    label: "Quantity × unit price on each line",
    group: "The work",
  },
  {
    key: "taxableLabels",
    label: "“Taxable / not taxable” on each line",
    group: "The work",
  },
  { key: "dueDate", label: "Due date", group: "Payment" },
  { key: "paidSoFar", label: "Amount already paid", group: "Payment" },
  {
    key: "payOnline",
    label: "Pay online button (if online payments are on)",
    group: "Payment",
  },
  { key: "terms", label: "Terms", group: "Payment" },
  { key: "thankYou", label: "Thank-you note", group: "Payment" },
] as const;
export type InvoiceFieldKey = (typeof INVOICE_FIELDS)[number]["key"];

export const invoiceDisplaySchema = z
  .object({
    ...(Object.fromEntries(
      INVOICE_FIELDS.map((f) => [f.key, z.boolean().optional()]),
    ) as Record<InvoiceFieldKey, z.ZodOptional<z.ZodBoolean>>),
    thankYouText: z.string().trim().max(300).optional(),
  })
  .strict();
export type InvoiceDisplay = Record<InvoiceFieldKey, boolean> & {
  thankYouText: string;
};

export const DEFAULT_INVOICE_DISPLAY: InvoiceDisplay = {
  shopAddress: true,
  shopPhone: true,
  jobTitle: true,
  serviceLabel: true,
  lineDetail: true,
  taxableLabels: false,
  dueDate: true,
  paidSoFar: true,
  payOnline: true,
  terms: true,
  thankYou: true,
  thankYouText: "Thank you for your business!",
};

// Built-in starting points the owner can pick, then adjust.
export const INVOICE_PRESETS: {
  key: string;
  label: string;
  values: Partial<InvoiceDisplay>;
}[] = [
  { key: "standard", label: "Standard", values: DEFAULT_INVOICE_DISPLAY },
  {
    key: "simple",
    label: "Simple (totals only)",
    values: {
      lineDetail: false,
      taxableLabels: false,
      serviceLabel: false,
      terms: false,
    },
  },
  {
    key: "detailed",
    label: "Detailed",
    values: {
      lineDetail: true,
      taxableLabels: true,
      serviceLabel: true,
      terms: true,
      paidSoFar: true,
    },
  },
];

export function effectiveDisplay(
  template: unknown,
  override: unknown,
): InvoiceDisplay {
  const t = invoiceDisplaySchema.safeParse(template ?? {});
  const o = invoiceDisplaySchema.safeParse(override ?? {});
  return {
    ...DEFAULT_INVOICE_DISPLAY,
    ...(t.success ? t.data : {}),
    ...(o.success ? o.data : {}),
  } as InvoiceDisplay;
}
