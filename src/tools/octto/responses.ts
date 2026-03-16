// src/tools/octto/responses.ts
import { tool } from "@opencode-ai/plugin/tool";

import { type SessionStore, STATUSES } from "@/octto/session";

import type { OcttoTool, OcttoTools } from "./types";

function buildGetAnswerTool(sessions: SessionStore): OcttoTool {
  return tool({
    description: `Get the answer to a SPECIFIC question.
By default returns immediately with current status.
Set block=true to wait for user response (with optional timeout).
NOTE: Prefer get_next_answer for better flow - it returns whichever question user answers first.`,
    args: {
      question_id: tool.schema.string().describe("Question ID from a question tool"),
      block: tool.schema.boolean().optional().describe("Wait for response (default: false)"),
      timeout: tool.schema
        .number()
        .optional()
        .describe("Max milliseconds to wait if blocking (default: 300000 = 5 min)"),
    },
    execute: async (args) => {
      const result = await sessions.getAnswer({
        question_id: args.question_id,
        block: args.block,
        timeout: args.timeout,
      });

      if (result.completed) {
        return `## Answer Received\n\n**Status:** ${result.status}\n\n**Response:**\n\`\`\`json\n${JSON.stringify(result.response, null, 2)}\n\`\`\``;
      }

      const hint =
        result.status === STATUSES.PENDING ? "User has not answered yet. Call again with block=true to wait." : "";
      return `## Waiting for Answer\n\n**Status:** ${result.status}\n**Reason:** ${result.reason}\n\n${hint}`;
    },
  });
}

function buildGetNextAnswerTool(sessions: SessionStore): OcttoTool {
  return tool({
    description: `Wait for ANY question to be answered. Returns whichever question the user answers first.
This is the PREFERRED way to get answers - lets user answer in any order.
Push multiple questions, then call this repeatedly to get answers as they come.`,
    args: {
      session_id: tool.schema.string().describe("Session ID from start_session"),
      block: tool.schema.boolean().optional().describe("Wait for response (default: false)"),
      timeout: tool.schema
        .number()
        .optional()
        .describe("Max milliseconds to wait if blocking (default: 300000 = 5 min)"),
    },
    execute: async (args) => {
      const result = await sessions.getNextAnswer({
        session_id: args.session_id,
        block: args.block,
        timeout: args.timeout,
      });

      if (result.completed) {
        return `## Answer Received\n\n**Question ID:** ${result.question_id}\n**Question Type:** ${result.question_type}\n**Status:** ${result.status}\n\n**Response:**\n\`\`\`json\n${JSON.stringify(result.response, null, 2)}\n\`\`\``;
      }

      if (result.status === STATUSES.NONE_PENDING) {
        return "## No Pending Questions\n\nAll questions have been answered or there are no questions in the queue.\nPush more questions or end the session.";
      }

      const reason = result.reason === STATUSES.TIMEOUT ? "Timed out waiting for response." : "No answer yet.";
      return `## Waiting for Answer\n\n**Status:** ${result.status}\n${reason}`;
    },
  });
}

function buildListQuestionsTool(sessions: SessionStore): OcttoTool {
  return tool({
    description: `List all questions and their status for a session.`,
    args: {
      session_id: tool.schema.string().optional().describe("Session ID (omit for all sessions)"),
    },
    execute: async (args) => {
      const result = sessions.listQuestions(args.session_id);
      if (result.questions.length === 0) return "No questions found.";

      let output =
        "## Questions\n\n| ID | Type | Status | Created | Answered |\n|----|------|--------|---------|----------|\n";
      for (const q of result.questions) {
        output += `| ${q.id} | ${q.type} | ${q.status} | ${q.createdAt} | ${q.answeredAt || "-"} |\n`;
      }
      return output;
    },
  });
}

function buildCancelQuestionTool(sessions: SessionStore): OcttoTool {
  return tool({
    description: `Cancel a pending question.
The question will be removed from the user's queue.`,
    args: {
      question_id: tool.schema.string().describe("Question ID to cancel"),
    },
    execute: async (args) => {
      const result = sessions.cancelQuestion(args.question_id);
      if (result.ok) return `Question ${args.question_id} cancelled.`;
      return `Could not cancel question ${args.question_id}. It may already be answered or not exist.`;
    },
  });
}

export function createResponseTools(sessions: SessionStore): OcttoTools {
  return {
    get_answer: buildGetAnswerTool(sessions),
    get_next_answer: buildGetNextAnswerTool(sessions),
    list_questions: buildListQuestionsTool(sessions),
    cancel_question: buildCancelQuestionTool(sessions),
  };
}
