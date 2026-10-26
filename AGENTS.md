# Repository Instructions

## New requirements and change records

For each new requirement, create a dedicated directory under `prd/` named with the creation timestamp and a concise requirement name:

```text
prd/YYYYMMDDHHmmss_需求名称/
├── YYYYMMDDHHmmss_需求名称.md
└── YYYYMMDDHHmmss_需求名称_modify.md
```

Use a 24-hour timestamp in local time. Keep the timestamp and requirement name identical across the directory and both files. Put the requirement specification in the first Markdown file and record its implementation changes in the `_modify.md` file. Each requirement has exactly one corresponding modification record; update that record as the requirement changes rather than creating another one.
