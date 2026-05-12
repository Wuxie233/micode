export function buildContinuePrompt(input: { conversationId: string; questionIds: string[] }): string {
  if (input.questionIds.length <= 1) {
    const questionId = input.questionIds[0] ?? "";

    return `你之前的会话有用户回答到达 (question_id=${questionId})。请调用 \`get_next_answer({session_id: "${input.conversationId}"})\` 取出答案,然后继续原任务。`;
  }

  return `你之前的会话有 ${input.questionIds.length} 个用户回答到达 (question_ids=${input.questionIds.join(", ")})。请反复调用 \`get_next_answer({session_id: "${input.conversationId}"})\` 取出全部答案,然后继续原任务。`;
}
