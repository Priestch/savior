// ==UserScript==
// @name         Gitlab Issues Track
// @namespace    http://tampermonkey.net/
// @homepage     https://github.com/Priestch/savior
// @version      0.4.2
// @description  Savior of bug track in Gitlab issue!
// @author       Priestch
// @match        https://gitpd.paodingai.com/*/issues/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @downloadURL  https://github.com/Priestch/savior/blob/master/src/index.js
// ==/UserScript==

(function () {
  'use strict';

  const ADMIN_KEY = 'SUPER_TEST_USERS';
  const EXPORT_FORMAT = 'GITLAB_ISSUE_EXPORT_FILENAME_FORMAT';
  const MENU_POSITION_KEY = 'GITLAB_ISSUE_MENU_POSITION';
  const TOC_OPEN_KEY = 'GITLAB_ISSUE_TOC_OPEN';
  const TOC_HOST_ID = 'savior-comment-toc';
  // 评论刻度条：相邻刻度的最小/最大间距，以及轨道首尾留白。
  // 间距必须封顶：大屏上如果按可用高度均分，刻度会被拉成上千像素的一条，顶到标题上。
  const RAIL_TICK_PITCH = 10;
  const RAIL_TICK_PITCH_MAX = 16;
  const RAIL_INSET = 6;
  const RAIL_FADE = 24;
  const RAIL_WIDTH = 24;
  const RAIL_MAX_HEIGHT = 520;
  // 正文栏左右两侧的已知遮挡物，用来判断左右哪边放得下刻度条。
  const RAIL_LEFT_SIDE_SELECTORS =
    '.super-sidebar, .js-super-sidebar, nav.sidebar, .layout-page .sidebar, aside.sidebar';
  const RAIL_RIGHT_SIDE_SELECTORS =
    '.work-item-attributes-wrapper, .work-item-attributes, .issuable-sidebar, .js-issuable-sidebar, ' +
    '.right-sidebar, #right-sidebar, .detail-page-sidebar';
  const issueHelper = {
    addTestUser(username) {
      const users = localStorage.getItem(ADMIN_KEY) || [];
      users.push(username);

      localStorage.setItem(ADMIN_KEY, users);
    },
    setTestUsers(usernames) {
      localStorage.setItem(ADMIN_KEY, usernames);
    },
    getTestUsers() {
      return localStorage.getItem(ADMIN_KEY) || ['王美丽', '焦隽峰'];
    },
    setExportFormat(format) {
      localStorage.setItem(EXPORT_FORMAT, format);
    },
    getExportFormat() {
      return localStorage.getItem(EXPORT_FORMAT) || '${projectName}_${issue.id}.csv';
    },
    setMenuPosition(position) {
      localStorage.setItem(MENU_POSITION_KEY, JSON.stringify(position));
    },
    getMenuPosition() {
      const saved = localStorage.getItem(MENU_POSITION_KEY);
      return saved ? JSON.parse(saved) : null;
    },
    setTocOpen(open) {
      localStorage.setItem(TOC_OPEN_KEY, open ? '1' : '0');
    },
    getTocOpen() {
      return localStorage.getItem(TOC_OPEN_KEY) !== '0';
    },
    getTocComments() {
      return tocState.comments.map((comment) => ({
        id: comment.id,
        number: comment.number,
        title: comment.title,
        author: comment.author,
        replies: comment.replies,
        resolved: comment.resolved,
      }));
    },
    debugToc() {
      const diagnostics = collectTocDiagnostics();
      if (typeof console.table === 'function') console.table(diagnostics);
      else console.log(diagnostics);
      return diagnostics;
    },
  };

  const TEST_USERS = issueHelper.getTestUsers();
  const tocState = {
    open: issueHelper.getTocOpen(),
    activeNoteId: '',
    comments: [],
    rail: null,
    scroller: null,
    marks: null,
    ticks: [],
    preview: null,
    previewTick: null,
    hoverId: '',
    menuButton: null,
    refreshTimer: null,
    observer: null,
    retryCount: 0,
    warnedEmpty: false,
    lastError: '',
  };

  function exportToCsv(filename, rows) {
    const processRow = function (row) {
      let finalVal = '';
      for (let j = 0; j < row.length; j++) {
        const isEmpty = row[j] === null || row[j] === undefined;
        let innerValue = isEmpty ? '' : row[j].toString();
        if (row[j] instanceof Date) {
          innerValue = row[j].toLocaleString();
        }
        let result = innerValue.replace(/"/g, '""');
        if (result.search(/("|,|\n)/g) >= 0)
          result = '"' + result + '"';
        if (j > 0)
          finalVal += ',';
        finalVal += result;
      }
      return finalVal + '\n';
    };

    let csvFile = '';
    for (let i = 0; i < rows.length; i++) {
      csvFile += processRow(rows[i]);
    }

    const blob = new Blob([csvFile], { type: 'text/csv;charset=utf-8;' });
    if (navigator.msSaveBlob) { // IE 10+
      navigator.msSaveBlob(blob, filename);
    } else {
      const link = document.createElement('a');
      if (link.download !== undefined) { // feature detection
        // Browsers that support HTML5 download attribute
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.click();
      }
    }
  }


  function formatTask(task) {
    return [
      'author=> ' + task.author,
      'checked=> ' + task.checked,
      'priority=> ' + task.priority,
      'link=> ' + task.link,
    ].join('; ');
  }

  function filterTasksByPriority(tasks, priority) {
    return tasks.filter(function (task) {
      return task.priority === priority;
    });
  }

  function generateBugReport() {
    const tasks = collectTasks();
    const done = tasks.filter(function (task) {
      return task.checked;
    });
    const left = tasks.filter(function (task) {
      return !task.checked;
    });
    const totalReport = [
      'total=> ' + tasks.length,
      'done=> ' + done.length,
      'left=> ' + left.length,
    ].join('; ');
    console.log('Summary:', totalReport);
    console.log();

    const ALevel = filterTasksByPriority(left, 'A');
    const BLevel = filterTasksByPriority(left, 'B');
    const CLevel = filterTasksByPriority(left, 'C');
    const DLevel = filterTasksByPriority(left, 'D');

    const leftReport = [
      'A=> ' + ALevel.length,
      'B=> ' + BLevel.length,
      'C=> ' + CLevel.length,
      'D=> ' + DLevel.length,
    ].join('; ');
    console.log('Left:', leftReport);

    for (let i = 0; i < left.length; i++) {
      console.log(formatTask(left[i]));
    }
  }

  function createTask(domWrapper) {
    return {
      author: '',
      link: '',
      checked: false,
      title: '',
      body: '',
      priority: 'C',
      domWrapper,
      discussionId: '',
      id: '',
      replies: [],
      confirmChecked: false,
    };
  }

  function parseTask(taskContainer) {
    // 适配 GitLab 18.x: 寻找任务列表项
    const taskCheckbox = taskContainer.querySelector('input[data-testid="task-list-item-checkbox"], input.task-list-item-checkbox');
    if (!taskCheckbox) {
      // 兼容旧版本
      if (!taskContainer.querySelector('.task-list')) return null;
    }

    const task = createTask(taskContainer);
    task.discussionId = taskContainer.getAttribute('discussion-id') || '';
    task.author = taskContainer.querySelector('.note-header-author-name')?.textContent.trim() || '';
    task.link = taskContainer.querySelector('[data-testid="copy-link-action"]')?.dataset.clipboardText || '';

    if (taskCheckbox) {
      task.checked = taskCheckbox.checked;
      // 寻找任务标题，通常是复选框旁边的内容
      task.title = taskCheckbox.closest('li')?.textContent.trim() || '';
    } else {
      // 兼容旧版本逻辑
      const taskItem = taskContainer.querySelector('.task-list-item');
      const oldInput = taskItem?.querySelector('input');
      if (oldInput) {
        task.checked = oldInput.checked;
        task.title = taskItem.textContent.trim();
      }
    }
    // 获取整个评论内容
    const noteText = taskContainer.querySelector('.note-text');
    task.body = noteText ? noteText.textContent.trim() : '';
    // 只取首行匹配 ID
    const firstLine = task.title.split('\n')[0];
    const idMatch = firstLine.match(/^(\d+)\.?\s*/) || firstLine.match(/(TC-\d+)/i);
    if (idMatch) {
      task.id = idMatch[1].toUpperCase();
    }
    const priorityPattern = /([ABCD]).*bug/;
    const noteCommentEl = taskContainer.querySelector('.note-comment');
    if (noteCommentEl) {
      const matchResult = noteCommentEl.textContent.match(priorityPattern)
      if (matchResult) {
        task.priority = matchResult[1];
      }
    }

    addReplies(task);
    if (confirmedByTestUser(task)) {
      task.confirmChecked = true;
    }
    return task;
  }

  function addReplies(task) {
    if (!task.discussionId) {
      task.replies = [];
      return;
    }

    const replyList = Array.from(document.querySelectorAll(`[discussion-id="${task.discussionId}"]`))
      .filter((replyDom) => replyDom !== task.domWrapper);
    task.replies = replyList.map(getReply);
  }

  function getDiscussionRelatedNodes(task) {
    const relatedNodes = [];
    let current = task.domWrapper.nextElementSibling;

    while (current) {
      if (current.matches('[discussion-id]')) {
        if (current.getAttribute('discussion-id') !== task.discussionId) {
          break;
        }
        relatedNodes.push(current);
        current = current.nextElementSibling;
        continue;
      }

      if (current.matches('.toggle-replies-widget, .discussion-reply-holder')) {
        relatedNodes.push(current);
        current = current.nextElementSibling;
        continue;
      }

      break;
    }

    return relatedNodes;
  }

  function parseLink(timelineContent) {
    const actions = timelineContent.querySelector('.note-header .note-actions div[title="More actions"]');
    const actionList = actions.querySelectorAll('li[data-testid="copy-link-action"]');
    return actionList[0].dataset.clipboardText
  }

  function collectTasks() {
    // 适配 GitLab 18.x: 寻找所有普通评论
    const noteList = document.querySelectorAll('[id^="note_"]:not(.system-note)');
    const tasks = [];

    for (let i = 0; i < noteList.length; i++) {
      const taskContainer = noteList[i];
      try {
        const task = parseTask(taskContainer);
        if (task && (task.checked || task.confirmChecked || taskContainer.querySelector('.task-list, [data-testid="task-list-item-checkbox"]'))) {
          tasks.push(task);
        }
      } catch (e) {
        console.error('Error occurred when parseTask: ', e, taskContainer);
      }
    }
    return tasks;
  }

  function getReply(replayDom) {
    let noteContentSelector = '.timeline-content .note-body .note-text';
    // 适配 GitLab 18.x 可能的新选择器
    if (!replayDom.querySelector(noteContentSelector)) {
      noteContentSelector = '.note-text';
    }
    let noteHeaderSelector = '.timeline-content .note-header';
    if (!replayDom.querySelector(noteHeaderSelector)) {
      noteHeaderSelector = '.note-header';
    }
    let noteHeaderDom = replayDom.querySelector(noteHeaderSelector);
    return {
      author: noteHeaderDom?.querySelector('.note-header-author-name')?.textContent.trim() || '',
      content: replayDom.querySelector(noteContentSelector)?.textContent.trim() || '',
    }
  }

  function confirmedByTestUser(task) {
    if (task.replies.length > 0) {
      let lastIndex = task.replies.length - 1;
      let reply = task.replies[lastIndex];
      // 增强判定：支持包含“验证已修复”即可
      return TEST_USERS.includes(reply.author) && reply.content.includes('验证已修复')
    } else {
      return false
    }
  }

  function collapseGitlabNotes() {
    document.querySelectorAll('.collapse-item').forEach((node) => node.classList.remove('collapse-item'));
    document.querySelectorAll('.collapse-reply-item').forEach((node) => node.classList.remove('collapse-reply-item'));
    document.querySelectorAll('.highest-level-bug').forEach((node) => node.classList.remove('highest-level-bug'));

    const tasks = collectTasks();
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.checked || task.confirmChecked) {
        task.domWrapper.classList.add('collapse-item');
        const relatedNodes = getDiscussionRelatedNodes(task);
        relatedNodes.forEach((node) => node.classList.add('collapse-reply-item'));
      }
      if (task.priority === 'A') {
        task.domWrapper.classList.add('highest-level-bug');
      }
    }
  }

  function scrollToNote(noteID) {
    if (noteID) {
      document.getElementById(noteID).scrollIntoView({ block: 'center' });
    }
  }

  function scrollToNoteInURL(result) {
    if (result) {
      scrollToNote(result[1]);
    }
  }

  function scrollToClipboardNote() {
    navigator.clipboard.readText().then(clipText => {
      if (clipText.startsWith('http')) {
        let url = new URL(clipText);
        if (url.hash) {
          const noteID = url.hash.replace('#', '');
          scrollToNote(noteID);
        }
      }
    });
  }

  function scrollToUrlNote() {
    const URLNote = window.location.hash.match(/#(note_\d+)/);
    if (URLNote) {
      scrollToNoteInURL(URLNote);
    }
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements));
  }

  function keepFirstNotePerDiscussion(notes) {
    const roots = [];
    const seenDiscussionIds = new Set();

    notes.forEach((note) => {
      const discussionId = getDiscussionId(note);
      if (!discussionId) {
        roots.push(note);
        return;
      }
      if (seenDiscussionIds.has(discussionId)) return;
      seenDiscussionIds.add(discussionId);
      roots.push(note);
    });

    return roots;
  }

  function getDiscussionContainer(note) {
    if (!note) return null;
    return note.querySelector(
      '.discussion[data-discussion-id], .discussion[discussion-id], .js-discussion-container'
    ) || note.closest(
      '.discussion[data-discussion-id], .discussion[discussion-id], .js-discussion-container'
    );
  }

  function getDiscussionId(note) {
    if (!note) return '';
    const ownId = note.getAttribute('discussion-id') || note.getAttribute('data-discussion-id');
    if (ownId) return ownId;

    const discussion = getDiscussionContainer(note);
    return discussion?.getAttribute('data-discussion-id') ||
      discussion?.getAttribute('discussion-id') ||
      '';
  }

  function getRootNoteElements() {
    // 1) Preferred: direct children of a notes list.
    const directNotes = uniqueElements(document.querySelectorAll(
      '.main-notes-list > .note:not(.system-note), ' +
      '#notes-list > .note:not(.system-note), ' +
      '.notes-list > .note:not(.system-note)'
    ));
    if (directNotes.length > 0) return keepFirstNotePerDiscussion(directNotes);

    // 2) Any element GitLab anchors as a note (same selector the export feature uses).
    const anchored = uniqueElements(document.querySelectorAll(
      '[id^="note_"]:not(.system-note), [data-note-id]:not(.system-note)'
    )).filter((note) => note.matches('.note') ||
      note.querySelector('.note-text, .note-body, .note-header'));
    if (anchored.length > 0) return keepFirstNotePerDiscussion(anchored);

    // 3) Last resort: discussion containers, for layouts without per-note anchors.
    const discussions = uniqueElements(document.querySelectorAll(
      '.discussion[data-discussion-id], .discussion[discussion-id]'
    ));
    if (discussions.length > 0) return keepFirstNotePerDiscussion(discussions);

    return [];
  }

  function describeElement(element) {
    if (!element) return 'none';
    const classes = String(element.className || '').trim().split(/\s+/).filter(Boolean).join('.');
    const anchor = element.getAttribute('discussion-id') || element.getAttribute('data-discussion-id') || '';
    return `${element.tagName.toLowerCase()}${classes ? '.' + classes : ''}` +
      `${element.id ? '#' + element.id : ''}${anchor ? `[discussion-id=${anchor}]` : ''}`;
  }

  // 解析不到评论时只在控制台留诊断，不在页面上弹调试框（$issueHelper.debugToc()）。
  function collectTocDiagnostics() {
    const probe = document.querySelector('[id^="note_"]:not(.system-note)') ||
      document.querySelector('.note:not(.system-note)') ||
      document.querySelector('.discussion');
    return {
      comments: tocState.comments.length,
      host: describeElement(getRailHost()),
      'main-notes-list': document.querySelectorAll('.main-notes-list').length,
      'notes-list': document.querySelectorAll('#notes-list, .notes-list').length,
      note: document.querySelectorAll('.note').length,
      noteAnchor: document.querySelectorAll('[id^="note_"]').length,
      discussion: document.querySelectorAll('.discussion').length,
      firstProbe: describeElement(probe),
      lastError: tocState.lastError || '',
    };
  }

  function getNoteText(note) {
    const body = note.querySelector('.note-body .note-text, .note-text');
    if (!body) return '';
    return (body.innerText || body.textContent || '').trim();
  }

  function getCommentFirstLine(noteText) {
    const lines = noteText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      return line
        .replace(/^#{1,6}\s*/, '')
        .replace(/^[-*+]\s*(?:\[[ xX]\]\s*)?/, '')
        .trim();
    }
    return '';
  }

  function parseCommentHeading(noteText, index) {
    const firstLine = getCommentFirstLine(noteText);
    const numberMatch = firstLine.match(/^(\d{1,4})(?:[.、)]|\s+)/) ||
      firstLine.match(/^(TC-\d+)\b/i);
    const explicitNumber = numberMatch ? numberMatch[1].toUpperCase() : '';
    const prefixMatch = firstLine.match(/^(?:\d{1,4}|TC-\d+)\s*[.、)]?\s*/i);
    let title = prefixMatch ? firstLine.slice(prefixMatch[0].length).trim() : firstLine;

    if (!title) title = noteText.replace(/\s+/g, ' ').trim() || '无文字内容';
    if (title.length > 110) title = title.slice(0, 107) + '...';

    return {
      number: explicitNumber || String(index + 1),
      hasExplicitNumber: Boolean(explicitNumber),
      title,
    };
  }

  function buildReplyCountMap() {
    const replyCounts = new Map();

    document.querySelectorAll(
      '.discussion[data-discussion-id], .discussion[discussion-id], .js-discussion-container'
    ).forEach((discussion) => {
      const discussionId = discussion.getAttribute('data-discussion-id') ||
        discussion.getAttribute('discussion-id') || '';
      if (!discussionId) return;

      const discussionNotes = discussion.querySelectorAll(
        '.discussion-notes .notes > .note:not(.system-note), .notes > .note:not(.system-note)'
      );
      replyCounts.set(discussionId, discussionNotes.length);
    });

    const legacyCounts = new Map();
    const discussionNotes = document.querySelectorAll(
      '[discussion-id].note:not(.system-note), [discussion-id][id^="note_"]:not(.system-note)'
    );

    discussionNotes.forEach((note) => {
      const discussionId = note.getAttribute('discussion-id');
      if (!discussionId) return;
      legacyCounts.set(discussionId, (legacyCounts.get(discussionId) || 0) + 1);
    });

    legacyCounts.forEach((count, discussionId) => {
      if (!replyCounts.has(discussionId)) replyCounts.set(discussionId, count);
    });

    return replyCounts;
  }

  function getDiscussionScopeElements(note) {
    const discussionId = getDiscussionId(note);
    const relatedElements = [note];
    const discussion = getDiscussionContainer(note);

    if (discussion) relatedElements.push(discussion);

    if (discussionId) {
      document.querySelectorAll('[discussion-id], [data-discussion-id]').forEach((candidate) => {
        if (
          candidate.getAttribute('discussion-id') === discussionId ||
          candidate.getAttribute('data-discussion-id') === discussionId
        ) {
          relatedElements.push(candidate);
        }
      });
    }

    let current = note.nextElementSibling;
    while (current) {
      if (current.matches('[discussion-id]')) {
        if (current.getAttribute('discussion-id') !== discussionId) break;
      } else if (current.matches(
        '.toggle-replies-widget, .discussion-reply-holder, .discussion-replies, .reply-holder'
      )) {
        // Reply containers do not always carry the discussion-id attribute.
      } else if (current.matches('.note:not(.system-note)')) {
        break;
      }
      relatedElements.push(current);
      current = current.nextElementSibling;
    }

    return uniqueElements(relatedElements);
  }

  function isCommentResolved(note) {
    const discussionElements = getDiscussionScopeElements(note);
    const discussion = getDiscussionContainer(note);

    if (discussion?.getAttribute('data-discussion-resolved') === 'true') return true;
    if (note.matches('.resolved, .is-resolved, [data-resolved="true"]')) return true;
    if (note.closest(
      '.discussion-resolved, [data-discussion-resolved="true"], [data-resolved="true"]'
    )) return true;
    if (discussionElements.some((element) => element.matches(
      '.discussion-resolved, .discussion-resolved-text, .js-discussion-headline, ' +
      '.resolved-thread, [data-discussion-resolved="true"], [data-resolved="true"], ' +
      '[data-testid="discussion-resolved"], [data-testid="resolved-thread"]'
    ) || element.querySelector(
      '.discussion-resolved, .discussion-resolved-text, .js-discussion-headline, ' +
      '.resolved-thread, [data-discussion-resolved="true"], [data-resolved="true"], ' +
      '[data-testid="discussion-resolved"], [data-testid="resolved-thread"]'
    ))) {
      return true;
    }

    const resolveControls = new Set();
    discussionElements.forEach((element) => {
      element.querySelectorAll('button, a, [role="button"]').forEach((control) => {
        resolveControls.add(control);
      });
    });

    for (const control of resolveControls) {
      const controlText = [
        control.textContent,
        control.getAttribute('title'),
        control.getAttribute('aria-label'),
      ].filter(Boolean).join(' ').trim();
      if (/unresolve|reopen|重新打开|取消解决|标记为未解决/i.test(controlText)) {
        return true;
      }
    }

    return false;
  }

  // 顺序完全跟随页面上看到的顺序：按元素在屏幕上的实际位置排，避免 DOM 顺序和视觉顺序
  // 不一致（反向渲染、按最近活动排序等）时刻度条看起来像被重新排过。
  function sortNotesByVisualOrder(notes) {
    const rects = notes.map((note) => note.getBoundingClientRect());
    // 有元素量不出位置（还没布局完 / 被隐藏）就退回 DOM 顺序，免得把顺序弄乱。
    if (rects.some((rect) => rect.width <= 0 && rect.height <= 0)) return notes;

    return notes
      .map((note, index) => ({ note, index, top: rects[index].top }))
      .sort((left, right) => (left.top - right.top) || (left.index - right.index))
      .map((item) => item.note);
  }

  function collectTocComments() {
    const notes = sortNotesByVisualOrder(getRootNoteElements());
    const replyCounts = buildReplyCountMap();

    return notes.map((note, index) => {
      const discussionId = getDiscussionId(note);
      const noteText = getNoteText(note);
      const heading = parseCommentHeading(noteText, index);
      const replyCount = discussionId ? Math.max(0, (replyCounts.get(discussionId) || 1) - 1) : 0;

      const anchorId = note.id ||
        note.querySelector('[id^="note_"]')?.id ||
        `note_toc_${index}`;

      return {
        element: note,
        id: anchorId,
        number: heading.number,
        hasExplicitNumber: heading.hasExplicitNumber,
        title: heading.title,
        body: noteText,
        author: note.querySelector('.note-header-author-name')?.textContent.trim() || '',
        replies: replyCount,
        resolved: isCommentResolved(note),
      };
    });
  }

  function getRailHost() {
    const notesList = document.querySelector('.main-notes-list, #notes-list, .notes-list');
    const column = notesList?.closest(
      '.issue-details, .detail-page-description, .issuable-details, .js-issue-notes, #notes, ' +
      '.work-item-notes, .issuable-discussion'
    ) || document.querySelector(
      '.issue-details, .detail-page-description, .issuable-details, .work-item-notes, .issuable-discussion'
    );
    return column || notesList || document.body;
  }

  function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // 刻度条可用的视口竖直区间，避开顶部栏与底部留白。
  function getRailBand() {
    const top = 80;
    return { top, height: Math.max(180, window.innerHeight - top - 80) };
  }

  // 间距夹在 10~16px，轨道高度再单独封顶；评论多时收紧间距，超出就交给轨道内部滚动。
  function computeRailMetrics(count) {
    const band = getRailBand();
    const safeCount = Math.max(1, count);
    const pitch = clampNumber(
      Math.floor((band.height - RAIL_INSET * 2) / safeCount),
      RAIL_TICK_PITCH,
      RAIL_TICK_PITCH_MAX
    );
    const naturalHeight = safeCount * pitch + RAIL_INSET * 2;
    const frameHeight = Math.min(naturalHeight, band.height, RAIL_MAX_HEIGHT);
    const top = Math.round(band.top + (band.height - frameHeight) / 2);
    return { band, pitch, frameHeight, top };
  }

  // 正文栏一侧的可用空白边界：左侧取遮挡物的最右缘，右侧取遮挡物的最左缘。
  function measureSideBoundary(selectors, hostRect, side) {
    let boundary = null;
    document.querySelectorAll(selectors).forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (side === 'left') {
        if (rect.right > hostRect.left) return;
        boundary = boundary === null ? rect.right : Math.max(boundary, rect.right);
      } else {
        if (rect.left < hostRect.right) return;
        boundary = boundary === null ? rect.left : Math.min(boundary, rect.left);
      }
    });
    return boundary;
  }

  // 优先用正文栏左侧的空白；新版 work item 布局左侧只剩十几像素，这时换到正文栏与属性栏
  // 之间的右侧空档；两边都挤时贴着正文栏左缘，绝不压到侧边栏上。
  function computeRailPlacement(hostRect, leftBoundary) {
    const rightBoundary = measureSideBoundary(RAIL_RIGHT_SIDE_SELECTORS, hostRect, 'right') ??
      window.innerWidth;
    const leftRoom = hostRect.left - leftBoundary;
    const rightRoom = rightBoundary - hostRect.right;

    if (leftRoom >= RAIL_WIDTH + 2) {
      return { side: 'left', left: Math.round(hostRect.left - RAIL_WIDTH - 4) };
    }
    if (rightRoom >= RAIL_WIDTH + 2) {
      // 贴着正文栏右缘放，最多再往右挪 12px，避免检测不到属性栏时飘到远处。
      const gap = clampNumber((rightRoom - RAIL_WIDTH) / 2, 4, 12);
      return { side: 'right', left: Math.round(hostRect.right + gap) };
    }
    return {
      side: 'left',
      left: Math.round(Math.max(leftBoundary + 2, hostRect.left - RAIL_WIDTH - 4)),
    };
  }

  function layoutTocRail() {
    const { rail } = tocState;
    if (!rail) return null;

    const metrics = computeRailMetrics(tocState.comments.length);
    const host = getRailHost();
    let placement = { side: 'left', left: 12 };
    if (host && host !== document.body) {
      const rect = host.getBoundingClientRect();
      if (rect.width > 0) {
        const leftBoundary = measureSideBoundary(RAIL_LEFT_SIDE_SELECTORS, rect, 'left') ?? 0;
        placement = computeRailPlacement(rect, leftBoundary);
      }
    }

    rail.classList.toggle('is-right', placement.side === 'right');
    rail.style.left = `${placement.left}px`;
    rail.style.top = `${metrics.top}px`;
    rail.style.height = `${metrics.frameHeight}px`;
    return metrics;
  }

  function createTocRail() {
    let rail = document.getElementById(TOC_HOST_ID);
    if (!rail || !rail.classList.contains('savior-rail')) {
      if (rail) rail.remove();

      rail = createElement('div', 'savior-rail');
      rail.id = TOC_HOST_ID;

      const scroller = createElement('div', 'savior-rail-scroller');
      const marks = createElement('div', 'savior-rail-marks');
      const preview = createElement('div', 'savior-rail-preview');
      preview.hidden = true;
      preview.setAttribute('role', 'tooltip');

      scroller.appendChild(marks);
      rail.appendChild(scroller);
      rail.appendChild(preview);
      document.body.appendChild(rail);

      scroller.addEventListener('scroll', () => {
        updateRailFade();
        positionTocPreview();
      }, { passive: true });
      rail.addEventListener('mouseleave', hideTocPreview);
    }

    tocState.rail = rail;
    tocState.scroller = rail.querySelector('.savior-rail-scroller');
    tocState.marks = rail.querySelector('.savior-rail-marks');
    tocState.preview = rail.querySelector('.savior-rail-preview');
    return rail;
  }

  function updateRailFade() {
    const { scroller } = tocState;
    if (!scroller) return;
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    scroller.classList.toggle('has-fade-top', scroller.scrollTop > 1);
    scroller.classList.toggle('has-fade-bottom', maxScroll > 1 && scroller.scrollTop < maxScroll - 1);
  }

  function railLabel(comment) {
    const number = comment.hasExplicitNumber ? comment.number : `#${comment.number}`;
    return `${number} ${comment.title || '无文字内容'}（${comment.resolved ? '已完成' : '未完成'}）`;
  }

  function renderTocRail() {
    const { rail, marks } = tocState;
    if (!rail || !marks) return;

    hideTocPreview();
    marks.replaceChildren();
    tocState.ticks = [];

    const comments = tocState.comments;
    rail.classList.toggle('is-empty', comments.length === 0);
    if (comments.length === 0) return;

    const metrics = layoutTocRail();

    comments.forEach((comment, index) => {
      const tick = createElement('button', 'savior-rail-tick');
      tick.type = 'button';
      tick.dataset.noteId = comment.id;
      tick.dataset.index = String(index);
      tick.style.height = `${metrics.pitch}px`;
      tick.setAttribute('aria-label', railLabel(comment));
      if (comment.resolved) tick.classList.add('is-resolved');

      tick.addEventListener('mouseenter', () => showTocPreview(comment, tick));
      tick.addEventListener('focus', () => showTocPreview(comment, tick));
      tick.addEventListener('blur', hideTocPreview);
      tick.addEventListener('click', () => selectTocComment(comment));

      marks.appendChild(tick);
      tocState.ticks.push(tick);
    });

    updateRailFade();
  }

  function buildTocPreviewContent(comment) {
    const fragment = document.createDocumentFragment();

    const head = createElement('div', 'savior-rail-preview-head');
    head.appendChild(createElement(
      'span',
      'savior-rail-preview-number',
      comment.hasExplicitNumber ? comment.number : `#${comment.number}`
    ));
    head.appendChild(createElement(
      'span',
      `savior-rail-preview-status ${comment.resolved ? 'is-resolved' : 'is-open'}`,
      comment.resolved ? '已完成' : '未完成'
    ));
    if (comment.author) {
      head.appendChild(createElement('span', 'savior-rail-preview-author', comment.author));
    }
    fragment.appendChild(head);

    fragment.appendChild(createElement('div', 'savior-rail-preview-title', comment.title || '无文字内容'));

    const meta = [];
    if (comment.replies > 0) meta.push(`${comment.replies} 条回复`);
    if (meta.length > 0) {
      fragment.appendChild(createElement('div', 'savior-rail-preview-meta', meta.join(' · ')));
    }

    return fragment;
  }

  function showTocPreview(comment, tick) {
    const { preview } = tocState;
    if (!preview) return;

    if (tocState.hoverId !== comment.id) {
      preview.replaceChildren(buildTocPreviewContent(comment));
      tocState.hoverId = comment.id;
    }
    tocState.previewTick = tick;
    tocState.ticks.forEach((item) => item.classList.toggle('is-preview', item === tick));

    preview.hidden = false;
    preview.classList.add('is-visible');
    positionTocPreview();
  }

  function positionTocPreview() {
    const { preview, previewTick, scroller } = tocState;
    if (!preview || !previewTick || preview.hidden || !scroller) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const tickRect = previewTick.getBoundingClientRect();
    const previewHeight = preview.getBoundingClientRect().height;
    const anchor = tickRect.top + tickRect.height / 2 - scrollerRect.top;
    const top = clampNumber(
      anchor - previewHeight / 2,
      0,
      Math.max(0, scrollerRect.height - previewHeight)
    );
    preview.style.top = `${Math.round(top)}px`;
  }

  function hideTocPreview() {
    const { preview } = tocState;
    if (!preview) return;
    preview.hidden = true;
    preview.classList.remove('is-visible');
    tocState.hoverId = '';
    tocState.previewTick = null;
    tocState.ticks.forEach((tick) => tick.classList.remove('is-preview'));
  }

  // 当前刻度 = 视口中线以上、最靠下的那条评论，也就是正在读的那条；
  // 还没滚到第一条评论时取第一条。长评论/长讨论里高亮会稳定停在那一条，不会来回跳。
  function updateCurrentTick() {
    if (!tocState.rail || tocState.comments.length === 0) return;

    const middle = window.innerHeight / 2;
    let currentIndex = -1;

    tocState.comments.forEach((comment, index) => {
      const element = comment.element;
      if (!element || !element.isConnected) return;
      if (element.getBoundingClientRect().top <= middle) currentIndex = index;
    });

    if (currentIndex < 0) currentIndex = 0;

    tocState.ticks.forEach((tick, index) => {
      tick.classList.toggle('is-active', index === currentIndex);
    });
    ensureTickVisible(currentIndex);
  }

  function ensureTickVisible(index) {
    const { scroller, ticks } = tocState;
    const tick = ticks[index];
    // 指针停在轨道上时不要把手底下的刻度滚走。
    if (!scroller || !tick || tocState.hoverId) return;

    const viewHeight = scroller.clientHeight;
    if (viewHeight <= 0) return;

    const markTop = tick.offsetTop + tick.offsetHeight / 2;
    const viewTop = scroller.scrollTop;
    if (markTop >= viewTop + RAIL_FADE && markTop <= viewTop + viewHeight - RAIL_FADE) return;

    scroller.scrollTo({
      top: Math.max(0, markTop - viewHeight / 2),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  function refreshToc() {
    try {
      tocState.comments = collectTocComments();
      tocState.lastError = '';
    } catch (error) {
      tocState.comments = [];
      tocState.lastError = String((error && error.message) || error);
    }

    createTocRail();
    setTocOpen(tocState.open);
    renderTocRail();
    updateCurrentTick();

    if (tocState.comments.length === 0) {
      scheduleEmptyRetry();
      if (!tocState.warnedEmpty) {
        tocState.warnedEmpty = true;
        console.warn(
          '[savior] 页面上没解析到评论，刻度条暂无内容。执行 $issueHelper.debugToc() 可查看诊断。',
          collectTocDiagnostics()
        );
      }
      return;
    }

    tocState.retryCount = 0;
    tocState.warnedEmpty = false;
  }

  // GitLab 异步渲染评论列表：首次没匹配到时多试几次，而不是在页面上留个空轨道。
  function scheduleEmptyRetry() {
    if (tocState.comments.length > 0) {
      tocState.retryCount = 0;
      return;
    }
    if (tocState.retryCount >= 4) return;
    const delays = [800, 1600, 3200, 5000];
    const delay = delays[tocState.retryCount];
    tocState.retryCount += 1;
    window.setTimeout(() => {
      if (tocState.comments.length === 0) refreshToc();
    }, delay);
  }

  function selectTocComment(comment) {
    const target = comment.element?.isConnected
      ? comment.element
      : document.getElementById(comment.id);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelectorAll('.savior-toc-highlight').forEach((note) => {
      note.classList.remove('savior-toc-highlight');
    });
    target.classList.add('savior-toc-highlight');
    window.setTimeout(() => target.classList.remove('savior-toc-highlight'), 2600);

    tocState.activeNoteId = comment.id;
    window.setTimeout(updateCurrentTick, 400);
  }

  function setTocOpen(open) {
    tocState.open = open;
    issueHelper.setTocOpen(open);
    if (!tocState.rail) createTocRail();
    tocState.rail.classList.toggle('is-hidden', !open);
    if (open) {
      layoutTocRail();
      updateCurrentTick();
    } else {
      hideTocPreview();
    }
  }

  function toggleToc() {
    setTocOpen(!tocState.open);
  }

  function scheduleTocRefresh() {
    if (tocState.refreshTimer) window.clearTimeout(tocState.refreshTimer);
    tocState.refreshTimer = window.setTimeout(() => {
      tocState.refreshTimer = null;
      refreshToc();
    }, 200);
  }

  function observeTocChanges() {
    if (tocState.observer || !document.body) return;
    tocState.observer = new MutationObserver((records) => {
      const hasExternalChange = records.some((record) => {
        const target = record.target;
        return !(target instanceof Element && target.closest(`#${TOC_HOST_ID}`));
      });
      if (hasExternalChange) scheduleTocRefresh();
    });
    tocState.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-discussion-resolved',
        'data-resolved',
        'aria-checked',
        'aria-label',
        'title',
      ],
    });

    // 解决/重新打开讨论时按钮状态会变，稍后刷新一次让刻度状态跟上。
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const resolveButton = target.closest(
        '[data-testid="resolve-line-button"], .js-resolve-button, [data-testid="reopen-line-button"]'
      );
      if (resolveButton) scheduleTocRefresh();
    }, true);
  }

  function initializeToc() {
    createTocRail();
    setTocOpen(tocState.open);
    observeTocChanges();
    refreshToc();

    // GitLab 新版 work item 把正文放在内部滚动容器（.panel-content-inner）里滚动，
    // window 上不会收到 scroll，必须用捕获阶段接住所有滚动事件，当前刻度才会跟着视图走。
    let scrollFrame = null;
    const onAnyScroll = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null;
        updateCurrentTick();
      });
    };
    document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
    window.addEventListener('scroll', onAnyScroll, { passive: true });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        renderTocRail();
        updateCurrentTick();
      }, 150);
    });

    document.addEventListener('keydown', (event) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLocaleLowerCase() === 't') {
        event.preventDefault();
        toggleToc();
      }
    });

    window.addEventListener('hashchange', () => {
      const match = window.location.hash.match(/#(note_\d+)/);
      if (!match) return;
      const comment = tocState.comments.find((item) => item.id === match[1]);
      if (comment) tocState.activeNoteId = comment.id;
    });
  }
  function createMenuItem(content, title, handler) {
    let button = document.createElement('button');
    button.textContent = content;
    button.setAttribute('title', title);
    button.addEventListener('click', handler);
    return button
  }

  function padStart(string, length, pad) {
    const s = String(string);
    if (!s || s.length >= length) return string;
    return `${Array((length + 1) - s.length).join(pad)}${string}`;
  }

  function parseIssueTitle() {
    const titleElement = document.querySelector('.detail-page-description .title');
    return titleElement ? titleElement.textContent : '';
  }

  function parseContext() {
    let prefix = window.location.protocol + '//' + window.location.hostname + '/';
    const parts = window.location.href.replace(prefix, '').split('/');
    const name = parts[1];
    const nameParts = name.split('_');
    const now = new Date();
    const year = now.getFullYear();
    const month = padStart(now.getMonth() + 1, 2, '0');
    const day = padStart(`${now.getDate()}`, 2, '0');
    return {
      group: parts[0],
      projectName: name.startsWith('docs_') ? nameParts[1] : name,
      issue: {
        id: parts[parts.length - 1].split('#')[0],
        title: parseIssueTitle(),
      },
      year,
      month,
      day,
    };
  }

  function getValue(path, context) {
    const parts = path.split('.');
    let value = context;
    parts.forEach((part) => {
      value = value[part]
    })

    return value;
  }

  function formatFilename(context, format) {
    const matches = format.match(/\$\{.+?\}/g);
    let filename = format;
    matches.forEach((matchStr) => {
      const result = matchStr.match(/\$\{(?<path>.+)\}/);
      const path = result.groups.path;
      filename = filename.replace(matchStr, getValue(path, context))
    })

    return filename;
  }

  function generateFilename(format) {
    const context = parseContext();
    return formatFilename(context, format);
  }

  function exportAsCSV() {
    const tasks = collectTasks();
    console.log(tasks);
    const rows = [];
    const keys = ['id', 'title', 'body', 'checked', 'priority', 'author', 'link'];  // from task key
    rows.push(keys);
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const row = [];
      for (let j = 0; j < keys.length; j++) {
        const key = keys[j];
        if (key !== 'checked') {
          row.push(task[key]);
        } else {
          row.push(task['checked'] || task['confirmChecked'])
        }
      }
      rows.push(row);
    }
    let filename = generateFilename(issueHelper.getExportFormat());
    exportToCsv(filename, rows)
  }

  function getRootFontSize() {
    const rootElement = document.documentElement; // This targets the <html> element
    const computedStyle = getComputedStyle(rootElement);
    return parseInt(computedStyle.fontSize)
  }

  function makeDraggable(element, handle) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let animationFrameId = null;
    let rootFontSize = 16

    // Load saved position
    const savedPosition = issueHelper.getMenuPosition();
    if (savedPosition) {
      element.style.left = savedPosition.x + 'px';
      element.style.top = savedPosition.y + 'px';
    }

    function updatePosition() {
      element.style.left = currentX + 'px';
      element.style.top = currentY + 'px';
      animationFrameId = null;
    }

    handle.addEventListener('mousedown', function (e) {
      rootFontSize = getRootFontSize();
      isDragging = true;
      initialX = e.clientX - (parseInt(element.style.left) || 0);
      initialY = e.clientY - (parseInt(element.style.top) || 0);

      element.classList.add('dragging');
    });

    document.addEventListener('mousemove', function (e) {
      const rem15 = rootFontSize * 15;
      const maxWidth = window.innerWidth - rem15 - 100;
      if (isDragging) {
        e.preventDefault();
        const realtimeX = e.clientX - initialX;
        if (realtimeX <= 0) {
          currentX = 0;
        } else if (realtimeX > maxWidth) {
          currentX = maxWidth;
        } else {
          currentX = realtimeX;
        }

        const realtimeY = e.clientY - initialY;
        if (realtimeY <= 0) {
          currentY = 0;
        } else {
          currentY = realtimeY;
        }

        // Use requestAnimationFrame to throttle DOM updates
        if (animationFrameId === null) {
          animationFrameId = requestAnimationFrame(updatePosition);
        }
      }
    });

    document.addEventListener('mouseup', function () {
      if (isDragging) {
        isDragging = false;
        element.classList.remove('dragging');

        // Cancel any pending animation frame
        if (animationFrameId !== null) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }

        // Save position
        issueHelper.setMenuPosition({
          x: parseInt(element.style.left) || 0,
          y: parseInt(element.style.top) || 0,
        });
      }
    });
  }

  function createMenu() {
    const descContainer = document.querySelector('.top-bar-fixed') || document.body;
    const fixMenu = document.createElement('div');
    fixMenu.classList.add("gl-fixed");

    const saviorBox = document.createElement('div');
    saviorBox.classList.add("savior");

    // Add drag handle
    const dragHandle = document.createElement('div');
    dragHandle.classList.add('savior-drag-handle');
    dragHandle.textContent = '☰';
    dragHandle.setAttribute('title', '拖动菜单');
    saviorBox.appendChild(dragHandle);

    const menuDom = document.createElement('div');
    menuDom.classList.add('savior-menu');
    tocState.menuButton = createMenuItem('刻度', '打开/关闭评论刻度条（Alt+T）', toggleToc);
    const menuItems = [
      tocState.menuButton,
      createMenuItem('导出', '导出CSV', exportAsCSV),
      createMenuItem('折叠', '折叠评论', collapseGitlabNotes),
      createMenuItem('跳转', '跳转至剪切版中的URL', scrollToClipboardNote),
      createMenuItem('Find', '跳转到URL锚点位置', scrollToUrlNote),
    ];
    for (let i = 0; i < menuItems.length; i++) {
      const menuItem = menuItems[i];
      menuDom.appendChild(menuItem);
    }
    saviorBox.appendChild(menuDom);
    fixMenu.appendChild(saviorBox);
    descContainer.appendChild(fixMenu);

    // Make the savior box draggable by the handle
    makeDraggable(saviorBox, dragHandle);
  }

  GM_addStyle(`
  .notes .note.collapse-item .timeline-content {
    height: 100px;
    background-color: #67c23a;
    overflow: hidden;
  }

  .notes .note.collapse-item .timeline-content * {
    background-color: #67c23a;
  }

  .notes .collapse-reply-item {
    display: none !important;
  }

  .notes-list .note.highest-level-bug:not(.collapse-item) .timeline-content {
    background: #f56c6c;
  }

  .savior {
    position: relative;
    user-select: none;
  }

  .savior.dragging {
    opacity: 0.8;
    cursor: grabbing;
  }

  .savior-drag-handle {
    width: 46px;
    height: 24px;
    background-color: #d0d1d2;
    color: #666;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    border-radius: 3px 3px 0 0;
    cursor: move;
  }

  .savior-drag-handle:hover {
    background-color: #c0c1c2;
  }

  .savior-menu {
    position: relative;
    width: 46px;
    display: inline-flex;
    flex-direction: column;
    padding: 0;
    font-size: 12px;
  }

  .savior-menu button {
    outline: none;
    background-color: #e0e1e2;
    color: #0009;
    padding: 5px 10px;
    border: none;
    box-shadow: 0 0 0 1px transparent inset, 0 0 0 0 rgba(34,36,38,.15) inset;
    cursor: pointer;
  }

  .savior-menu button:hover {
    background-color: #cacbcd;
    color: #000c;
  }

  .savior-rail {
    --savior-rail-bg: var(--gl-background-color-default, #fff);
    --savior-rail-text: var(--gl-text-color-default, #1f1e28);
    --savior-rail-muted: var(--gl-text-color-subtle, #626168);
    --savior-rail-line: var(--gl-border-color-default, #dcdcde);
    --savior-rail-mark: var(--gl-border-color-strong, #bfbfc6);
    --savior-rail-mark-hover: var(--gl-text-color-subtle, #737278);
    --savior-rail-accent: var(--gl-color-blue-500, #1f75cb);
    position: fixed;
    z-index: 900;
    width: 24px;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .savior-rail.is-hidden,
  .savior-rail.is-empty {
    display: none !important;
  }

  .savior-rail-scroller {
    position: relative;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .savior-rail-scroller::-webkit-scrollbar {
    display: none;
  }

  .savior-rail-scroller.has-fade-top {
    mask-image: linear-gradient(#0000 0, #000 24px 100%);
  }

  .savior-rail-scroller.has-fade-bottom {
    mask-image: linear-gradient(#000 0 calc(100% - 24px), #0000 100%);
  }

  .savior-rail-scroller.has-fade-top.has-fade-bottom {
    mask-image: linear-gradient(#0000 0, #000 24px calc(100% - 24px), #0000 100%);
  }

  .savior-rail-marks {
    position: relative;
    width: 100%;
    padding: 6px 0;
  }

  .savior-rail-tick {
    position: relative;
    display: block;
    width: 100%;
    height: 10px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }

  .savior-rail-tick::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    width: 12px;
    height: 2px;
    border-radius: 2px;
    background: var(--savior-rail-mark);
    transform: translateY(-50%);
    transition: width .14s ease, background-color .14s ease, opacity .14s ease;
  }

  .savior-rail-tick.is-resolved::before {
    opacity: .5;
  }

  .savior-rail-tick.is-preview::before {
    width: 18px;
    background: var(--savior-rail-mark-hover);
  }

  .savior-rail-tick.is-active::before {
    width: 22px;
    background: var(--savior-rail-accent);
    opacity: 1;
  }

  .savior-rail-tick:focus-visible {
    outline: none;
  }

  .savior-rail-tick:focus-visible::before {
    width: 20px;
    background: var(--savior-rail-accent);
  }

  /* 轨道落在正文栏右侧空档时，刻度贴右缘、预览朝左展开（和参考实现一致）。 */
  .savior-rail.is-right .savior-rail-tick::before {
    right: 0;
    left: auto;
  }

  .savior-rail-preview {
    position: absolute;
    top: 0;
    left: calc(100% + 8px);
    box-sizing: border-box;
    width: min(300px, 40vw);
    max-width: calc(100vw - 120px);
    padding: 10px 12px;
    color: var(--savior-rail-text);
    background: var(--savior-rail-bg);
    border-radius: 10px;
    box-shadow: 0 0 0 1px var(--savior-rail-line), 0 8px 24px rgba(16, 16, 20, .16);
    font-size: 12px;
    line-height: 1.5;
    pointer-events: none;
    opacity: 0;
    transform: translateX(-4px);
    transition: opacity .12s ease, transform .12s ease, top .14s ease;
  }

  .savior-rail-preview.is-visible {
    opacity: 1;
    transform: translateX(0);
  }

  .savior-rail.is-right .savior-rail-preview {
    right: calc(100% + 8px);
    left: auto;
    transform: translateX(4px);
  }

  .savior-rail.is-right .savior-rail-preview.is-visible {
    transform: translateX(0);
  }

  .savior-rail-preview[hidden] {
    display: none;
  }

  .savior-rail-preview-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .savior-rail-preview-number {
    padding: 1px 6px;
    color: var(--savior-rail-text);
    background: var(--gl-background-color-strong, #ececef);
    border-radius: 5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .savior-rail-preview-status {
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  .savior-rail-preview-status.is-open {
    color: #8a4b00;
    background: #fff1cc;
  }

  .savior-rail-preview-status.is-resolved {
    color: #1f6f43;
    background: #dff5e6;
  }

  .savior-rail-preview-author,
  .savior-rail-preview-meta {
    color: var(--savior-rail-muted);
    font-size: 11px;
  }

  .savior-rail-preview-author {
    overflow: hidden;
    margin-left: auto;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .savior-rail-preview-title {
    display: -webkit-box;
    overflow: hidden;
    font-weight: 600;
    word-break: break-word;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  .savior-rail-preview-meta {
    margin-top: 4px;
  }

  .note.savior-toc-highlight > .timeline-content,
  .note.savior-toc-highlight .timeline-content {
    animation: savior-toc-pulse 1.3s ease-in-out 2;
  }

  @keyframes savior-toc-pulse {
    0%, 100% {
      box-shadow: inset 4px 0 0 transparent;
    }
    50% {
      box-shadow: inset 4px 0 0 #1f75cb, 0 0 0 2px rgba(31, 117, 203, .35);
    }
  }

  @media (max-width: 900px) {
    .savior-rail {
      display: none;
    }
  }
  `);

  createMenu();
  initializeToc();

  // const intervalKey = 'MAX_MUTATION_INTERVAL';
  // const customInterval = localStorage.getItem(intervalKey);
  // const mutationInterval = customInterval ? parseInt(customInterval) : 10 * 1e3;
  const URLMatchResult = window.location.hash.match(/#(note_\d+)/);
  if (URLMatchResult) {
    /**
     * It seems Gitlab can jump to right note in URL, it took so long!
     */

    // let timeoutID = null;
    // let observer;
    // function handleMutations(records) {
    //   records.forEach((record) => {
    //     if (timeoutID) {
    //       clearTimeout(timeoutID);
    //     }
    //     timeoutID = setTimeout(function() {
    //       requestAnimationFrame(() => {
    //         scrollToNoteInURL(URLMatchResult);
    //         observer.disconnect();
    //       })
    //     }, mutationInterval);
    //   });
    // }
    //
    // observer = new MutationObserver(handleMutations);
    // const nodeList = document.querySelector('#notes-list')
    // observer.observe(nodeList, { subtree: true, childList: true, attributes: true });
  }

  unsafeWindow.$issueHelper = issueHelper;
})();
