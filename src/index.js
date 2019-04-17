// ==UserScript==
// @name         Gitlab Issues Track
// @namespace    http://tampermonkey.net/
// @homepage     https://github.com/Priestch/savior
// @version      0.1
// @description  Savior of bug track in Gitlab issue!
// @author       Priestch
// @match        https://gitpd.paodingai.com/*/issues/*
// @grant        none
// @downloadURL  https://github.com/Priestch/savior/blob/master/src/index.js
// ==/UserScript==

(function () {
  'use strict'

  function formatTask(task) {
    return [
      'author=> ' + task.authorName,
      'checked=> ' + task.checked,
      'priority=> ' + task.priority,
      'link=> ' + task.link,
    ].join('; ')
  }

  function filterTasksByPriority(tasks, priority) {
    return tasks.filter(function (task) {
      return task.priority === priority
    })
  }

  function generateReport(tasks) {
    const done = tasks.filter(function (task) {
      return task.checked
    })
    const left = tasks.filter(function (task) {
      return !task.checked
    })
    const totalReport = [
      'total=> ' + tasks.length,
      'done=> ' + done.length,
      'left=> ' + left.length,
    ].join('; ')
    console.log('Summary:', totalReport)
    console.log()

    const ALevel = filterTasksByPriority(left, 'A')
    const BLevel = filterTasksByPriority(left, 'B')
    const CLevel = filterTasksByPriority(left, 'C')

    const leftReport = [
      'A=> ' + ALevel.length,
      'B=> ' + BLevel.length,
      'C=> ' + CLevel.length,
    ].join('; ')
    console.log('Left:', leftReport)

    for (let i = 0; i < left.length; i++) {
      console.log(formatTask(left[i]))
    }
  }

  function collapseNote(collapseComment = true) {
    const noteList = document.querySelectorAll('#notes-list .note')
    const filtered = Array.from(noteList).filter((item) => item.querySelector('.timeline-entry-inner .timeline-content'))
    const taskResult = []
    filtered.forEach((item) => {
      const timelineContent = item.querySelector('.timeline-entry-inner .timeline-content')
      const tasks = timelineContent.querySelectorAll('.note-body .task-list')
      const task = {
        authorName: '',
        link: '',
        checked: false,
        priority: 'C',
      }
      if (tasks.length > 0) {
        task.authorName = timelineContent.querySelector('.note-header .note-header-author-name').textContent
        const actions = timelineContent.querySelector('.note-header .note-actions .more-actions-dropdown')

        const actionList = actions.querySelectorAll('li .js-btn-copy-note-link')
        task.link = actionList[0].dataset.clipboardText
        if (tasks.length > 1) {
          console.error(formatTask(task))
        }
        const taskItem = tasks[0].querySelector('.task-list-item')
        const taskInput = taskItem.querySelector('input')
        task.checked = taskInput.checked
        const priorityPattern = /([ABC]).*bug/
        const matchResult = timelineContent.querySelector('.note-body').textContent.match(priorityPattern)
        if (matchResult) {
          task.priority = matchResult[1]
        }
        if (task.checked) {
          if (!collapseComment) {
            return
          }
          item.classList.add('callapse-item')
          item.style.height = '150px'
          item.style.backgroundColor = '#67c23a'
          item.style.overflow = 'hidden'
        } else {
          if (task.priority === 'A') {
            item.style.backgroundColor = '#f56c6c'
          }
        }
        taskResult.push(task)
      }
    })
    taskResult.sort(function (a, b) {
      if (a.priority < b.priority) {
        return -1
      }
      if (a.priority > b.priority) {
        return 1
      }
      return 0
    })

    generateReport(taskResult)
    return taskResult
  }

  window.collapseGitlabNotes = collapseNote
})()
