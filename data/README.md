# Data Directory

This directory contains Excel files used by automation agents.

## Required Files

### units.xlsx

This file is required by the **Dari Title Deed Agent** and should contain plot information.

**Expected Structure:**

| Column 1 | Column 2 | Plot Id - ADM |
|----------|----------|---------------|
| ...      | ...      | 12345         |
| ...      | ...      | 67890         |
| ...      | ...      | 13579         |

**Requirements:**
- Must have a column header containing "Plot Id" (case-insensitive)
- The Plot Id column should contain the plot numbers to process
- Plot numbers will be extracted from the rightmost column matching "Plot Id"
- Empty rows or cells in the Plot Id column will be skipped

**Location:** `/data/units.xlsx`

## Usage

Place your Excel files in this directory before running the agents that require them.

Example:
```bash
npm run dev:dari-title-deed
```

The agent will automatically look for `units.xlsx` in this directory.
