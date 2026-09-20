/**
 * Syllabus → structured facts (office hours, late policy, grading weights,
 * exam dates, instructor contact) via structured outputs.
 *
 * Most Canvas Syllabus tabs contain only a link to a PDF, so this module also
 * resolves that link and transcribes the document — see `syllabusFileRef` and
 * `pdfToText`, wired together by `resolveSyllabus` in lib/sync.ts.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { convert } from "html-to-text";
import { MODEL, anthropic, parseDefaults, textOf } from "@/lib/llm";

export const OfficeHoursSchema = z.object({
  instructor: z.string().describe("Instructor or TA name as written"),
  dayOfWeek: z.number().int().min(0).max(6).describe("0=Sunday … 6=Saturday"),
  start: z.string().describe("24h HH:mm"),
  end: z.string().describe("24h HH:mm"),
  location: z.string().nullable().describe("Room, building, or Zoom link"),
  modality: z.enum(["in_person", "online", "hybrid", "unknown"]),
});

export const SyllabusSchema = z.object({
  instructorName: z.string().nullable(),
  instructorEmail: z.string().nullable(),
  officeHours: z.array(OfficeHoursSchema),
  latePolicy: z.string().nullable().describe("Verbatim or closely paraphrased late-work policy"),
  gradingWeights: z.array(z.object({ name: z.string(), percent: z.number() })),
  examDates: z.array(
    z.object({
      name: z.string(),
      date: z.string().nullable().describe("ISO date YYYY-MM-DD if determinable"),
      notes: z.string().nullable(),
    }),
  ),
  notableDeadlines: z.array(z.object({ name: z.string(), date: z.string().nullable() })),
});

export type SyllabusFacts = z.infer<typeof SyllabusSchema>;

export function syllabusToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: false } },
      { selector: "img", format: "skip" },
    ],
  }).trim();
}

/**
 * A Syllabus tab is a *pointer* when it holds no prose of its own — just a link
 * to the real document. Only then should the attachment be followed.
 *
 * Measured on real tabs: pointer tabs run 131–344 characters (a filename and
 * maybe one sentence), while a syllabus written directly into the tab runs
 * ~20,000. Plenty of prose-rich tabs also link to files — course readings,
 * handouts — and chasing those would waste a transcription and, worse, let a
 * broken or non-PDF attachment mark a perfectly readable syllabus unreadable.
 */
const POINTER_TAB_MAX_CHARS = 1500;

export function tabIsPointer(tabText: string): boolean {
  return tabText.length <= POINTER_TAB_MAX_CHARS;
}

/**
 * Course-file reference embedded in syllabus HTML. Pointer tabs keep the real
 * syllabus behind one of these.
 *
 * Only the numeric ids are returned: the caller rebuilds the API path from them,
 * so a hostile absolute URL pasted into a syllabus can never be fetched with our
 * Canvas token. Links pointing at another host are ignored for the same reason.
 */
export function syllabusFileRef(html: string, canvasOrigin: string | null): { courseId: number; fileId: number } | null {
  for (const m of html.matchAll(/(?:href|data-api-endpoint)="([^"]+)"/g)) {
    const raw = m[1].replaceAll("&amp;", "&");
    if (/^https?:\/\//i.test(raw)) {
      if (!canvasOrigin) continue;
      let origin: string;
      try {
        origin = new URL(raw).origin;
      } catch {
        continue;
      }
      if (origin !== canvasOrigin) continue;
    }
    const ids = raw.match(/\/courses\/(\d+)\/files\/(\d+)/);
    if (ids) return { courseId: Number(ids[1]), fileId: Number(ids[2]) };
  }
  return null;
}

/**
 * Transcribe a syllabus PDF to plain text. The model reads the PDF natively as a
 * document block — no PDF parser here, and scanned/image syllabi still work.
 */
export async function pdfToText(filename: string, pdf: Uint8Array): Promise<string | null> {
  const stream = anthropic().messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system:
      "You transcribe course syllabus documents to plain text. Reproduce the content faithfully in reading order, " +
      "keeping headings, dates, tables (as simple markdown) and policy wording intact. Do not summarize, comment, " +
      "or add anything that is not in the document. Output only the transcription.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") },
          },
          { type: "text", text: `Transcribe "${filename}".` },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") return null;
  const text = textOf(message).trim();
  return text.length >= 40 ? text : null;
}

export async function extractSyllabus(
  courseName: string,
  syllabusText: string,
  termYear: number,
): Promise<SyllabusFacts | null> {
  // Guard against pathological syllabi (embedded schedules, pasted PDFs).
  const text = syllabusText.slice(0, 60_000);
  if (text.length < 40) return null;

  const response = await anthropic().messages.parse({
    ...parseDefaults,
    system:
      "You extract structured facts from a university course syllabus. " +
      "Only report what the syllabus states; use null for anything absent. " +
      "Office hours: one entry per (person, weekday, time range). If hours are 'by appointment' only, return an empty officeHours array. " +
      `When a date lacks a year, assume ${termYear}.`,
    messages: [
      {
        role: "user",
        content: `Course: ${courseName}\n\n<syllabus>\n${text}\n</syllabus>`,
      },
    ],
    output_config: {
      ...parseDefaults.output_config,
      format: zodOutputFormat(SyllabusSchema),
    },
  });

  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}
