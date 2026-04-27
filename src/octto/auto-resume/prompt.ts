const CONTINUE_TEMPLATE =
  '你之前的会话有用户回答到达 (question_id={questionId})。请调用 `get_next_answer({session_id: "{conversationId}"})` 取出答案,然后继续原任务。';

export function buildContinuePrompt(input: { conversationId: string; questionId: string }): string {
  return CONTINUE_TEMPLATE.replace("{questionId}", input.questionId).replace("{conversationId}", input.conversationId);
}
