/**
 * Announcement → list of concrete actions (due-date change, cancelled class,
 * room change, new event). Each action becomes a proposal the user approves.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { convert } from "html-to-text";
import { anthropic, parseDefaults } from "@/lib/llm";
import type { AssignmentRow } from "@/lib/db";

const DueDateChange = z.object({
  kind: z.literal("due_date_change"),
  assignmentId: z.number().nullable().describe("Matching assignment id from the list, or null"),
  assignmentName: z.string(),
  newDueAt: z.string().describe("ISO 8601 datetime with timezone offset"),
  summary: z.string(),
});
const CancelledClass = z.object({
  kind: z.literal("cancelled_class"),
  date: z.string().describe("ISO date YYYY-MM-DD"),
  summary: z.string(),
});
const RoomChange = z.object({
  kind: z.literal("room_change"),
  date: z.string().nullable().describe("ISO date if for one session, null if permanent"),
  newLocation: z.string(),
  summary: z.string(),
});
const NewEvent = z.object({
  kind: z.literal("new_event"),
  title: z.string(),
  startAt: z.string().describe("ISO 8601 datetime with timezone offset"),
  endAt: z.string().describe("ISO 8601 datetime with timezone offset"),
  location: z.string().nullable(),
  summary: z.string(),
});

export const AnnouncementActionsSchema = z.object({
  actions: z.array(z.discriminatedUnion("kind", [DueDateChange, CancelledClass, RoomChange, NewEvent])),
  isActionable: z.boolean(),
  tldr: z.string().describe("One sentence summary of the announcement"),
});

export type AnnouncementAction = z.infer<typeof AnnouncementActionsSchema>["actions"][number];
export type AnnouncementActions = z.infer<typeof AnnouncementActionsSchema>;

export async function extractActions(input: {
  courseName: string;
  title: string;
  messageHtml: string;
  postedAt: string | null;
  assignments: Pick<AssignmentRow, "id" | "name" | "due_at">[];
  timezone: string;
}): Promise<AnnouncementActions | null> {
  const text = convert(input.messageHtml ?? "", { wordwrap: false }).trim();
  const assignmentList = input.assignments
    .map((a) => `- id=${a.id} "${a.name}" due=${a.due_at ?? "none"}`)
    .join("\n");

  const response = await anthropic().messages.parse({
    ...parseDefaults,
    system:
      "You read a course announcement and extract only concrete schedule changes a student should reflect in their calendar. " +
      "Be conservative: if the announcement is informational (reminders, encouragement, grades posted), return no actions and isActionable=false. " +
      `Resolve relative dates ("this Friday") using the posted date. Emit datetimes in the ${input.timezone} timezone with an explicit offset. ` +
      "If a due-date change matches one of the listed assignments, set assignmentId.",
    messages: [
      {
        role: "user",
        content:
          `Course: ${input.courseName}\nPosted: ${input.postedAt ?? "unknown"}\n` +
          `Assignments in this course:\n${assignmentList || "(none)"}\n\n` +
          `<announcement title="${input.title}">\n${text}\n</announcement>`,
      },
    ],
    output_config: {
      ...parseDefaults.output_config,
      format: zodOutputFormat(AnnouncementActionsSchema),
    },
  });

  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}
