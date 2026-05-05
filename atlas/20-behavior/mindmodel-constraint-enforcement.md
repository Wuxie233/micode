---
tags: [atlas, behavior]
---
# Mindmodel Constraint Enforcement

Mindmodel 机制把项目专属编码约束、示例和反模式注入 agent 工作流，并可在写入后审查输出。

## Mechanics

- `.mindmodel/manifest.yaml` 声明约束类别和文件路径。
- `mindmodel_lookup` 可以按任务查询相关模式。
- `features.mindmodelInjection` 启用后，injector 会把相关约束加入 prompt。
- `constraint-reviewer` 可以在 `Write` 或 `Edit` 后调用 `mm-constraint-reviewer` 检查违规。

## Links

- [[Mindmodel Runtime]] 负责加载、分类和格式化约束。
- [[Hooks Pipeline]] 负责注入和审查。
