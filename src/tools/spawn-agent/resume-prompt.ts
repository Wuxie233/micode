const RESUME_TEMPLATE_HEAD = "你之前的执行因";
const RESUME_TEMPLATE_TAIL =
  "中断。请检查你之前的进度,继续完成原任务。如果你认为已经完成,请输出最终结果;如果遇到阻塞,请明确说明阻塞点。";

export function buildSubagentResumePrompt(input: { errorType: string; hint?: string }): string {
  const base = `${RESUME_TEMPLATE_HEAD} ${input.errorType} ${RESUME_TEMPLATE_TAIL}`;
  if (!input.hint) return base;
  return `${base}\n\n额外提示: ${input.hint}`;
}
