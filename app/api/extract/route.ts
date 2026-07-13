import { extractText, getDocumentProxy } from "unpdf";
import { truncateToLimit } from "@/lib/extract";
import { MAX_FILE_BYTES, MIN_EXTRACTED_CHARS } from "@/lib/limits";

function isPdf(file: File) {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function isPlainText(file: File) {
  return (
    file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")
  );
}

export async function POST(request: Request) {
  // 1. Parse the multipart body.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Request must be multipart form data." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Attach a file to upload." }, { status: 400 });
  }

  // 2. Reject oversized files before reading the bytes into memory.
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    const limitMb = MAX_FILE_BYTES / 1024 / 1024;
    return Response.json(
      { error: `File is too large (${mb} MB). The limit is ${limitMb} MB.` },
      { status: 413 },
    );
  }

  // 3. Extract a text layer.
  let raw: string;
  try {
    if (isPlainText(file)) {
      raw = await file.text();
    } else if (isPdf(file)) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(buffer);
      const { text } = await extractText(pdf, { mergePages: true });
      raw = text;
    } else {
      return Response.json(
        { error: "Unsupported file type. Upload a .txt or .pdf file." },
        { status: 415 },
      );
    }
  } catch (err) {
    console.error("Extraction failed:", err);
    return Response.json(
      { error: "Could not read that file. It may be corrupt or password protected." },
      { status: 422 },
    );
  }

  const trimmed = raw.trim();

  // 4. A PDF that yields (almost) no text is the classic scanned document: an
  //    image of a page with no character data. Say so plainly rather than
  //    handing the model an empty string.
  if (trimmed.length < MIN_EXTRACTED_CHARS) {
    return Response.json(
      {
        error: isPdf(file)
          ? "No readable text found. This looks like a scanned PDF (an image with no text layer). OCR would be needed to read it."
          : "That file appears to be empty.",
      },
      { status: 422 },
    );
  }

  // 5. Enforce the model's input budget (see truncateToLimit — RAG is the real fix).
  const { text, originalChars, truncated } = truncateToLimit(trimmed);

  return Response.json({
    text,
    filename: file.name,
    originalChars,
    truncated,
  });
}
