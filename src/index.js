// ==UserScript==
// @name         Gitlab Issues Track
// @namespace    http://tampermonkey.net/
// @homepage     https://github.com/Priestch/savior
// @version      0.3.19
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
  };

  const TEST_USERS = issueHelper.getTestUsers();

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
      description: '',
      priority: 'C',
      domWrapper,
      id: '',
      replies: [],
      confirmChecked: false,
    };
  }

  function parseTask(taskContainer) {
    const timelineContent = taskContainer.querySelector('.timeline .timeline-entry-inner .timeline-content');
    const commentWrapper = timelineContent.querySelector('.timeline-discussion-body');
    const taskDomList = commentWrapper.querySelectorAll('.note-body .task-list');
    if (taskDomList.length === 0) {
      return null
    }
    const task = createTask(timelineContent);
    task.author = timelineContent.querySelector('.note-header .note-header-author-name').textContent;
    task.link = parseLink(timelineContent);
    if (taskDomList.length > 1) {
      console.error(formatTask(task));
    }
    const taskItem = taskDomList[0].querySelector('.task-list-item');
    const taskInput = taskItem.querySelector('input');
    task.checked = taskInput.checked;
    task.description = taskInput.nextSibling.textContent.trim();
    const idMatchResult = task.description.match(/^(\d+)\.?/);
    if (idMatchResult) {
      task.id = idMatchResult[1];
      task.description = task.description.replace(/^(\d+)\./, '').trim();
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
    let replyList = task.domWrapper.querySelectorAll('.toggle-replies-widget .note-comment');
    task.replies = Array.from(replyList).map(getReply);
  }

  function parseLink(timelineContent) {
    const actions = timelineContent.querySelector('.note-header .note-actions div[title="More actions"]');
    const actionList = actions.querySelectorAll('li[data-testid="copy-link-action"]');
    return actionList[0].dataset.clipboardText
  }

  function collectTasks() {
    const noteList = document.querySelectorAll('.main-notes-list > .note:not(.system-note)');
    const filtered = Array.from(noteList).filter((item) => item.querySelector('.timeline-entry-inner .timeline-content'));
    const tasks = [];

    for (let i = 0; i < filtered.length; i++) {
      const taskContainer = filtered[i];
      let task;
      try {
        task = parseTask(taskContainer);
        if (task) {
          tasks.push(task);
        }
      } catch (e) {
        console.error(e);
        console.log('Error occurred when parseTask: ', taskContainer);
        continue
      }
    }
    return tasks;
  }

  function getReply(replayDom) {
    let noteContentSelector = '.timeline-content .note-body .note-text';
    let noteHeaderSelector = '.timeline-content .note-header';
    let noteHeaderDom = replayDom.querySelector(noteHeaderSelector);
    return {
      author: noteHeaderDom.querySelector('.note-header-author-name').textContent.trim(),
      content: replayDom.querySelector(noteContentSelector).textContent,
    }
  }

  function confirmedByTestUser(task) {
    if (task.replies.length > 0) {
      let lastIndex = task.replies.length - 1;
      let reply = task.replies[lastIndex];
      return TEST_USERS.includes(reply.author) && reply.content === '验证已修复'
    } else {
      return false
    }
  }

  function collapseGitlabNotes() {
    const tasks = collectTasks();
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.checked || task.confirmChecked) {
        task.domWrapper.classList.add('collapse-item')
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
    const keys = ['id', 'description', 'checked', 'priority', 'author', 'link'];  // from task key
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

  function makeDraggable(element, handle) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let animationFrameId = null;

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
      isDragging = true;
      initialX = e.clientX - (parseInt(element.style.left) || 0);
      initialY = e.clientY - (parseInt(element.style.top) || 0);

      element.classList.add('dragging');
    });

    document.addEventListener('mousemove', function (e) {
      if (isDragging) {
        e.preventDefault();
        currentX = (e.clientX - initialX) <= 0 ? 0 : (e.clientX - initialX);
        currentY = e.clientY - initialY;

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
    const descContainer = document.querySelector('.top-bar-fixed');
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
    const menuItems = [
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
  .notes .note .timeline-content.collapse-item {
    height: 100px;
    background-color: #67c23a;
    overflow: hidden;
  }

  .notes .note .timeline-content.collapse-item * {
    background-color: #67c23a;
  }

  .notes-list .note .timeline-content.highest-level-bug:not(.collapse-item) {
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
  `);

  createMenu();

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
