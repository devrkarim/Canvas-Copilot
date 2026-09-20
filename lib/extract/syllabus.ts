/**
 * Syllabus → structured facts (office hours, late policy, grading weights,
 * exam dates, instructor contact) via structured outputs.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { convert } from "html-to-text";
import { anthropic, parseDefaults } from "@/lib/llm";

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

export async function extractSyllabus(
  courseName: string,
  syllabusHtml: string,
  termYear: number,
): Promise<SyllabusFacts | null> {
  // Guard against pathological syllabi (embedded schedules, pasted PDFs).
  const text = syllabusToText(syllabusHtml).slice(0, 60_000);
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
