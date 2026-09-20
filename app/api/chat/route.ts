/**
 * POST /api/chat — streams an SSE feed of the tool-runner turn.
 * Body: { messages: BetaMessageParam[] }  (full history; client replays what we send back)
 * Events: text | tool | history | error | done
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { anthropic, betaDefaults, llmConfigured } from "@/lib/llm";
import { allTools, studentContext } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are Canvas Copilot, a student's academic assistant with live access to their Canvas LMS data through tools.

How to behave:
- Always use tools to answer questions about courses, assignments, announcements, calendar, syllabus, office hours or workload. Never guess or invent data. If data is missing, say so and suggest running a sync.
- Be concise and concrete: names, dates (in the student's timezone), points. Use short Markdown lists; no filler.
- You cannot change Canvas directly. propose_calendar_event and propose_message create *proposals* that the student approves in the Proposals inbox — after creating one, tell them it's waiting there.
- When drafting messages to instructors, be polite, brief, specific about the assignment, and reference the syllabus late policy if you know it. Sign with the student's name.
- For "what should I do first", weigh due date, points and estimated effort (get_workload_forecast).
- If a course has no syllabus tab, say policy questions can't be answered from Canvas.`;

export async function POST(req: Request) {
  if (!llmConfigured()) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
  }
  let messages: BetaMessageParam[];
  try {
    ({ messages } = (await req.json()) as { messages: BetaMessageParam[] });
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.at(-1)?.role !== "user") {
    return Response.json({ error: "messages must be a non-empty array ending with a user message" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const inputLen = messages.length;
      const runner = anthropic().beta.messages.toolRunner({
        ...betaDefaults,
        max_tokens: 64000,
        system: [
          { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: studentContext() },
        ],
        tools: allTools,
        messages,
        max_iterations: 15,
        stream: true,
      });

      let aborted = false;
      try {
        for await (const messageStream of runner) {
          for await (const event of messageStream) {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              send("tool", { name: event.content_block.name });
            } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send("text", { text: event.delta.text });
            }
          }
          const message = await messageStream.finalMessage();
          const hasToolUse = message.content.some((b) => b.type === "tool_use");
          if (message.stop_reason === "max_tokens" && hasToolUse) {
            send("error", { message: "Response was cut off (max_tokens) while calling a tool." });
            aborted = true;
            break;
          }
          if (message.stop_reason === "refusal") {
            send("error", { message: "The model declined to answer this request." });
            aborted = true;
            break;
          }
        }
        // Everything the runner appended (assistant turns + tool results) so the client can replay it.
        // Skipped on abort: the last assistant turn may hold a tool_use with no tool_result.
        if (!aborted) send("history", { messages: runner.params.messages.slice(inputLen) });
        send("done", {});
      } catch (err) {
        const message =
          err instanceof Anthropic.APIError ? `Anthropic API error ${err.status}: ${err.message}` : (err as Error).message;
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
