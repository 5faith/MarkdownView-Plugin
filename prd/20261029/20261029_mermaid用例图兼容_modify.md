# 修改记录：Mermaid 用例图兼容

## 2026-10-29 — 支持 usecase-beta 示例

- 新增 `usecase-beta` 到 Mermaid flowchart 的兼容转换，映射参与者、用例椭圆和有向关联。
- 转换仅用于渲染，原始 Mermaid 源代码仍保持可查看和编辑。
- 增加转换规则校验，避免重复 ID、无效声明和指向不存在节点的关联生成错误图。
