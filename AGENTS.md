# Repository Instructions

## New requirements and change records

For each new requirement, place its documents in a date directory under `prd/`:

```text
prd/YYYYMMDD/
├── YYYYMMDD_需求名称.md
└── YYYYMMDD_需求名称_modify.md
```

Use the local calendar date in `YYYYMMDD` format for the directory and both filenames. Use the same date and requirement name in the specification and its `_modify.md` record. Put the requirement specification in the first Markdown file and record its implementation changes in the `_modify.md` file. Each requirement has exactly one corresponding modification record; update that record as the requirement changes rather than creating another one.
