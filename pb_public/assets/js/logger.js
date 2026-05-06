/**
 * =============================================================================
 * logger.js — In-page debug logger
 * Writes to both the browser console and the on-page debug log panel.
 *
 * Depends on: config.js (escHtml)
 * =============================================================================
 */

const Logger = (() => {
  const entries = [];

  function write(level, msg, ctx) {
    const ts     = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const detail = ctx ? ' ' + JSON.stringify(ctx) : '';
    entries.push({ ts, level, msg, detail });

    const fn = { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' }[level] || 'log';
    console[fn](`[${ts}] [${level}] ${msg}`, ctx || '');

    const container = document.getElementById('log-entries');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML =
      `<span class="log-time">${ts}</span>` +
      `<span class="log-level-${level}">${level}</span>` +
      `<span class="log-msg">${escHtml(msg)}${escHtml(detail)}</span>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  return {
    debug          : (m, c) => write('DEBUG', m, c),
    info           : (m, c) => write('INFO',  m, c),
    warn           : (m, c) => write('WARN',  m, c),
    error          : (m, c) => write('ERROR', m, c),
    all            : ()     => [...entries],
    asText         : ()     => entries.map(e => `[${e.ts}] [${e.level}] ${e.msg}${e.detail}`).join('\n'),
    copyToClipboard: () => {
      navigator.clipboard.writeText(Logger.asText())
        .then(() => Logger.info('Log copied to clipboard'))
        .catch(e  => Logger.error('Clipboard copy failed', { error: e.message }));
    },
    clear: () => {
      entries.length = 0;
      const c = document.getElementById('log-entries');
      if (c) c.innerHTML = '';
      Logger.info('Log cleared by user');
    },
  };
})();
