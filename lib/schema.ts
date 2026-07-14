import { z } from "zod";

/**
 * The contract for structured extraction.
 *
 * This is the boundary between "the model said something" and "the app has data".
 * Model output is treated exactly like user input: untrusted until it validates.
 * Nothing that fails `safeParse` is ever returned to the UI.
 */
export const ExtractionSchema = z.object({
  documentType: z.enum(["invoice", "report", "contract", "other"]),
  parties: z
    .array(z.string())
    .describe("Organizations or people named in the document."),
  keyDates: z
    .array(
      z.object({
        date: z.string().describe("As written in the document, e.g. 2026-05-10."),
        description: z.string().describe("What the date signifies."),
      }),
    )
    .describe("Dates the document identifies as significant."),
  amounts: z
    .array(
      z.object({
        value: z.number().describe("A plain number: 12500.5, never \"$12,500.50\"."),
        currency: z.string().describe("Currency code, e.g. USD, EUR."),
        description: z.string().describe("What the amount is for."),
      }),
    )
    .describe("Monetary amounts stated in the document."),
  summary: z.string().max(500),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

/**
 * The schema restated for the model — **derived from the Zod schema above**, so
 * the two cannot drift. Add a field to `ExtractionSchema` and the model is told
 * about it automatically; a hand-written copy would have to be remembered.
 *
 * We hand-roll the validate-and-retry loop rather than using the SDK's
 * structured-output feature on purpose: that feature automates exactly this
 * loop, and it's worth understanding what is being automated. Note that
 * schema-valid still does not mean factually correct — validation catches shape
 * errors, not hallucinations.
 */
export const SCHEMA_FOR_PROMPT = JSON.stringify(
  z.toJSONSchema(ExtractionSchema),
  null,
  2,
);
