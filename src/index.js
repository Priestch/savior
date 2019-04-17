// ==UserScript==
// @name         Gitlab Issues Track
// @namespace    http://tampermonkey.net/
// @homepage     https://github.com/Priestch/savior
// @version      0.1.2
// @description  Savior of bug track in Gitlab issue!
// @author       Priestch
// @match        https://gitpd.paodingai.com/*/issues/*
// @grant        GM_addStyle
// @downloadURL  https://github.com/Priestch/savior/blob/master/src/index.js
// ==/UserScript==

(function () {
  'use strict';

  function formatTask(task) {
    return [
      'author=> ' + task.authorName,
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

  function generateReport(tasks) {
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

    const leftReport = [
      'A=> ' + ALevel.length,
      'B=> ' + BLevel.length,
      'C=> ' + CLevel.length,
    ].join('; ');
    console.log('Left:', leftReport);

    for (let i = 0; i < left.length; i++) {
      console.log(formatTask(left[i]));
    }
  }

  function collapseGitlabNotes(collapseComment = true) {
    const noteList = document.querySelectorAll('#notes-list .note');
    const filtered = Array.from(noteList).filter((item) => item.querySelector('.timeline-entry-inner .timeline-content'));
    const taskResult = [];
    filtered.forEach((item) => {
      const timelineContent = item.querySelector('.timeline-entry-inner .timeline-content');
      const tasks = timelineContent.querySelectorAll('.note-body .task-list');
      const task = {
        authorName: '',
        link: '',
        checked: false,
        priority: 'C',
      };
      if (tasks.length > 0) {
        task.authorName = timelineContent.querySelector('.note-header .note-header-author-name').textContent;
        const actions = timelineContent.querySelector('.note-header .note-actions .more-actions-dropdown');

        const actionList = actions.querySelectorAll('li .js-btn-copy-note-link');
        task.link = actionList[0].dataset.clipboardText;
        if (tasks.length > 1) {
          console.error(formatTask(task));
        }
        const taskItem = tasks[0].querySelector('.task-list-item');
        const taskInput = taskItem.querySelector('input');
        task.checked = taskInput.checked;
        const priorityPattern = /([ABC]).*bug/;
        const matchResult = timelineContent.querySelector('.note-body').textContent.match(priorityPattern);
        if (matchResult) {
          task.priority = matchResult[1];
        }
        if (task.checked) {
          if (!collapseComment) {
            return;
          }
          item.classList.add('callapse-item');
          item.style.height = '150px';
          item.style.backgroundColor = '#67c23a';
          item.style.overflow = 'hidden';
        } else {
          if (task.priority === 'A') {
            item.style.backgroundColor = '#f56c6c';
          }
        }
        taskResult.push(task);
      }
    });
    taskResult.sort(function (a, b) {
      if (a.priority < b.priority) {
        return -1;
      }
      if (a.priority > b.priority) {
        return 1;
      }
      return 0;
    });

    generateReport(taskResult);
    return taskResult;
  }

  function createMenuItem(content, title, handler) {
    let button = document.createElement('button');
    button.textContent = content;
    button.setAttribute('title', title);
    button.addEventListener('click', handler);
    return button
  }

  function exportAsCSV() {
    console.log('exportAsCSV');
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
