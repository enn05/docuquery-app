import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropic, MODEL, REQUEST_TIMEOUT_MS } from "@/lib/anthropic";
import { errorResponse, readTextBody } from "@/lib/api";
import { MAX_EXTRACTION_TOKENS } from "@/lib/limits";
import { ExtractionSchema, SCHEMA_FOR_PROMPT } from "@/lib/schema";

/** One retry after the first failure. Two attempts total, then we give up. */
const MAX_ATTEMPTS = 2;

const SYSTEM_PROMPT = `You extract structured data from documents for accountants.

Return ONLY a JSON object conforming to this JSON Schema — no prose, no explanation, no markdown code fences:

${SCHEMA_FOR_PROMPT}

Rules:
- Extract only what the document actually states. Never invent parties, dates, or amounts.
- If a field has no values in the document, return an empty array for it.
- Emit ONLY the fields defined in the schema. Do not add extra keys of your own — every
  unrequested key consumes output budget and risks the reply being cut off.
- Keep each "description" to a few words.`;

/**
 * Models sometimes wrap JSON in ```json fences despite being told not to.
 * Strip them rather than failing the parse over formatting.
 */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export async function POST(request: Request) {
  const body = await readTextBody(request);
  if (!body.ok) return body.response;

  // The running conversation. On a failed attempt we append the model's bad
  // output plus the validation error, so the retry can see what it got wrong.
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Extract structured data from this document:\n\n${body.text}`,
    },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let lastFailure = "";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const message = await anthropic.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_EXTRACTION_TOKENS,
          system: SYSTEM_PROMPT,
          messages,
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;

      // The response ran out of room and was cut off mid-JSON. Retrying is
      // pointless — the same document against the same cap truncates identically,
      // so a retry just burns another full request reproducing the failure.
      // Bail out now and say what actually went wrong.
      if (message.stop_reason === "max_tokens") {
        return Response.json(
          {
            error:
              "This document contains more extractable data than the response limit allows. Try a shorter document, or one section at a time.",
            detail: `The model's reply was cut off at the ${MAX_EXTRACTION_TOKENS}-token output cap.`,
            attempts: attempt,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          },
          { status: 422 },
        );
      }

      const raw = textOf(message);

      // Step 1: is it even JSON?
      let candidate: unknown;
      try {
        candidate = JSON.parse(stripFences(raw));
      } catch {
        lastFailure = "Your previous response was not valid JSON.";
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `${lastFailure} Return only a JSON object matching the schema — no prose, no code fences.`,
        });
        continue;
      }

      // Step 2: does it match the schema? Never trust it without this.
      const result = ExtractionSchema.safeParse(candidate);
      if (result.success) {
        return Response.json({
          data: result.data,
          attempts: attempt,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        });
      }

      // Step 3: feed the specific validation error back. Telling the model
      // exactly which field is wrong is what makes the retry worth doing —
      // a bare "try again" would just resample the same mistake.
      lastFailure = z.prettifyError(result.error);
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `Your previous response failed validation:\n\n${lastFailure}\n\nReturn corrected JSON only.`,
      });
    }

    // Both attempts failed. Return a clean error — never render unvalidated output.
    return Response.json(
      {
        error: "The model could not produce data matching the required schema.",
        detail: lastFailure,
        attempts: MAX_ATTEMPTS,
      },
      { status: 422 },
    );
  } catch (err) {
    return errorResponse(err, "/api/analyze");
  }
}
