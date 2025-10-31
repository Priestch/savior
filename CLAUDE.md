# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Tampermonkey/Greasemonkey userscript that enhances GitLab issue tracking. The script is designed to help track bugs in GitLab issues by:
- Parsing task lists from GitLab issue comments
- Tracking bug priority levels (A, B, C, D)
- Managing bug verification status
- Collapsing completed/verified tasks
- Exporting task data to CSV format

The entire application is a single-file userscript at `src/index.js`.

## Development Workflow

### Version Management
- Version is defined in the userscript header metadata (line 5 of `src/index.js`)
- Version format: `0.3.x`
- When bumping version, update the `@version` tag in the userscript header
- Commit messages follow pattern: `bump version to X.Y.Z` or `feat:`, `fix:`, `chore:`, `refactor:`

### Installation and Testing
- This is a userscript for Tampermonkey/Greasemonkey
- Install by loading `src/index.js` directly into Tampermonkey
- Test on a GitLab instance matching the `@match` pattern (currently `https://gitpd.paodingai.com/*/issues/*`)
- To test on different GitLab instances, modify the `@match` pattern

### No Build Process
- This is a standalone userscript with no build step, no package.json, no dependencies
- Changes to `src/index.js` can be tested directly by reloading the script in Tampermonkey

## Architecture

### Core Components

**Task Parsing (`parseTask`, `collectTasks`)**
- Parses GitLab's DOM structure to extract task information from comments
- Relies on specific GitLab DOM selectors (e.g., `.timeline-entry-inner`, `.note-body`, `.task-list`)
- Key data extracted: author, link, checked status, description, priority, replies

**Task Data Structure**
```javascript
{
  author: string,        // Comment author
  link: string,          // Direct link to the note
  checked: boolean,      // Task checkbox state
  description: string,   // Task text (with ID prefix removed)
  priority: 'A'|'B'|'C'|'D',  // Bug priority (parsed from comment text)
  domWrapper: Element,   // Reference to DOM node
  id: string,           // Task ID (extracted from description)
  replies: Array,       // Array of reply objects
  confirmChecked: boolean  // Whether verified by test user
}
```

**Priority System**
- Priority levels: A (highest), B, C (default), D
- Parsed from comment text using pattern `/([ABCD]).*bug/`
- A-level bugs are highlighted with red background (`.highest-level-bug`)

**Verification System**
- Test users configured via `issueHelper.setTestUsers()`
- Default test users: `['王美丽', '焦隽峰']`
- Tasks marked as verified if last reply is from test user with content "验证已修复"
- Both `checked` and `confirmChecked` tasks can be collapsed

**UI Features**
- Fixed menu created in `.top-bar-fixed` container
- Four menu buttons: 导出 (Export), 折叠 (Collapse), 跳转 (Jump to clipboard URL), Find (Jump to URL anchor)
- Collapsed items: 100px height with green background
- A-level bugs: red background (when not collapsed)

**Export System**
- Exports tasks to CSV format
- Filename format configurable via `issueHelper.setExportFormat()`
- Default format: `${projectName}_${issue.id}.csv`
- Available template variables: `projectName`, `group`, `issue.id`, `issue.title`, `year`, `month`, `day`
- CSV columns: id, description, checked, priority, author, link

### Key Functions

- `collectTasks()` - Main parser that scans all `.main-notes-list > .note` elements
- `parseTask(taskContainer)` - Extracts task data from a single comment
- `collapseGitlabNotes()` - Hides completed/verified tasks
- `exportAsCSV()` - Generates and downloads CSV report
- `scrollToNote(noteID)` - Navigation helper for jumping to specific comments
- `issueHelper` - Configuration API exposed as `window.$issueHelper`

### DOM Selectors (GitLab-specific)

The script is tightly coupled to GitLab's DOM structure. Key selectors:
- `.main-notes-list > .note:not(.system-note)` - Issue comments
- `.timeline-entry-inner .timeline-content` - Comment content wrapper
- `.note-body .task-list` - Task list items
- `.note-header-author-name` - Author name
- `.toggle-replies-widget .note-comment` - Replies
- `.detail-page-description .title` - Issue title

## Common Maintenance Tasks

### Adapting to GitLab UI Changes
When GitLab updates its UI, selectors may break. Recent commits show this pattern:
- Check `parseTask()`, `parseLink()`, `addReplies()`, `getReply()` for selector updates
- Test parsing by running in browser console: `$issueHelper` object is exposed globally
- Common failure points: timeline structure, note header, action buttons

### Modifying Priority Logic
Priority parsing is in `parseTask()` around line 168:
```javascript
const priorityPattern = /([ABCD]).*bug/;
```

### Changing Verification Logic
Verification check is in `confirmedByTestUser()` around line 226:
```javascript
return TEST_USERS.includes(reply.author) && reply.content === '验证已修复'
```

### Customizing Export Format
CSV export logic is in `exportAsCSV()` starting at line 348. Column order defined in `keys` array.

## Configuration API

The script exposes `window.$issueHelper` with these methods:
- `setTestUsers(usernames)` - Configure test user list
- `getTestUsers()` - Get current test users
- `setExportFormat(format)` - Set filename template
- `getExportFormat()` - Get current template

Settings are persisted to `localStorage`.

## Important Notes

- The `@match` pattern restricts the script to specific GitLab domain
- All styles are injected via `GM_addStyle`
- Uses `unsafeWindow` to expose configuration API
- Auto-scroll logic for URL anchors is currently commented out (lines 443-471)
