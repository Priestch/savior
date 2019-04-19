// ==UserScript==
// @name         Gitlab Issues Track
// @namespace    http://tampermonkey.net/
// @homepage     https://github.com/Priestch/savior
// @version      0.2.2
// @description  Savior of bug track in Gitlab issue!
// @author       Priestch
// @match        https://gitpd.paodingai.com/*/issues/*
// @grant        GM_addStyle
// @downloadURL  https://github.com/Priestch/savior/blob/master/src/index.js
// ==/UserScript==

(function () {
  'use strict';

  function exportToCsv(filename, rows) {
    const processRow = function (row) {
      let finalVal = '';
      for (let j = 0; j < row.length; j++) {
        let innerValue = row[j] === null ? '' : row[j].toString();
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
    };
  }

  function parseTask(taskContainer) {
    const timelineContent = taskContainer.querySelector('.timeline-entry-inner .timeline-content');
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
    const matchResult = commentWrapper.querySelector('.note-body').textContent.match(priorityPattern);
    if (matchResult) {
      task.priority = matchResult[1];
    }
    return task;
  }

  function parseLink(timelineContent) {
    const actions = timelineContent.querySelector('.note-header .note-actions .more-actions-dropdown');
    const actionList = actions.querySelectorAll('li .js-btn-copy-note-link');
    return actionList[0].dataset.clipboardText
  }

  function collectTasks() {
    const noteList = document.querySelectorAll('#notes-list > .note:not(.system-note)');
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

  function collapseGitlabNotes() {
    const tasks = collectTasks();
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.checked) {
        task.domWrapper.classList.add('collapse-item')
      } else {
        if (task.priority === 'A') {
          task.domWrapper.classList.add('highest-level-bug')
        }
      }
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

  function parseProject() {
    let prefix = window.location.protocol + '//' + window.location.hostname + '/cheftin/';
    return window.location.href.replace(prefix, '').split('/')[0];
  }

  function generateFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = padStart(now.getMonth() + 1, 2, '0');
    const day = padStart(`${now.getDate()}`, 2, '0');
    return `${year}_${month}_${day}_${parseProject()}.csv`
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
        row.push(task[key]);
      }
      rows.push(row);
    }
    let filename = generateFilename();
    exportToCsv(filename, rows)
  }

  function createMenu() {
    const descContainer = document.querySelector('.detail-page-description');
    descContainer.classList.add('savior');

    const menuDom = document.createElement('div');
    menuDom.classList.add('savior-menu');
    const menuItems = [
      createMenuItem('导出', '导出CSV', exportAsCSV),
      createMenuItem('折叠', '折叠评论', collapseGitlabNotes),
    ];
    for (let i = 0; i < menuItems.length; i++) {
      const menuItem = menuItems[i];
      menuDom.appendChild(menuItem);
    }
    descContainer.appendChild(menuDom);
  }

  GM_addStyle(`
  .notes .note.collapse-item:not(.highest-level-bug) {
    height: 150px;
    background-color: #67c23a;
    overflow: hidden;
  }
  
  .notes-list .note.highest-level-bug {
    background: #f56c6c;
  }
  
  .detail-page-description.savior {
    position: relative;
    border-top-right-radius: 5px;
    border-bottom-right-radius: 5px;
    border-right: 1px solid #eaeaea;
  }

  .savior-menu {
    top: 0;
    right: -56px;
    position: absolute;
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
  }

  .savior-menu button:hover {
    background-color: #cacbcd;
    color: #000c;
  }
  `);

  createMenu();
})();
