---
name: "doc-generator"
description: "Generates structured documentation and optimization plans with folder classification. Invoke when user asks to create plans, specs, or documentation files."
---

# Documentation Generator

This skill generates structured documentation and saves them to `.trae/documents/` with proper folder classification.

## Folder Structure

```
.trae/documents/
├── optimization/          # Optimization plans and proposals
├── specification/         # Spec files and requirements
├── tasks/                # Task lists and progress tracking
└── other/               # Miscellaneous documents
```

## Usage

When user asks to create documentation, plans, or specification files:

1. **Determine folder classification**:
   - Optimization plans → `.trae/documents/optimization/`
   - Spec files → `.trae/documents/specification/`
   - Task lists → `.trae/documents/tasks/`
   - Other → `.trae/documents/other/`

2. **Create file with proper naming**:
   - Use kebab-case: `completion-optimization-plan.md`
   - Include date if relevant: `feature-spec-2026-05-05.md`

3. **Follow document templates**:

### For Optimization Plans
```markdown
# <Feature> Optimization Plan

## Overview
Current state and problems

## Optimization Goals
Specific, measurable objectives

## Implementation Phases
### Phase 1: <Name>
- Steps
- Verification checklist

## Expected Results
Metrics and improvements
```

### For Spec Files
```markdown
# <Feature> Specification

## Overview
Brief description

## Features
Detailed feature list

## Technical Details
Implementation notes

## Acceptance Criteria
Definition of done
```

### For Task Lists
```markdown
# <Project> Task List

## Phase 1: <Name>
- [ ] Task 1
- [ ] Task 2

## Progress
- [x] Completed task
```

## Trigger Conditions

**Invoke when user says:**
- "帮我制定一个计划"
- "创建文档"
- "写一个 spec"
- "生成优化方案"
- "制定任务清单"
- Any request to create documentation or planning files

## Example

User: "帮我制定一个 AI 补全的优化计划"

Response: Create `.trae/documents/optimization/ai-completion-optimization-plan.md` with the optimization plan structure.