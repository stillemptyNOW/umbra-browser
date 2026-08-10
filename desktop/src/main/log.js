'use strict';
/**
 * Logging that cannot take the browser down with it.
 *
 * A packaged GUI application often has no usable stdout: launched from a
 * shortcut there is no console at all, and launched from a parent that exits
 * first the pipe is closed. Writing to it then throws EPIPE, and an EPIPE
 * escaping from a console.error inside an event handler reaches Electron's
 * uncaught-exception dialog — a browser dying with "A JavaScript error
 * occurred in the main process" because a log line failed to write.
 */

function safely(write) {
  return (...args) => {
    try {
      write(...args);
    } catch {
      // Nowhere to write. That is not worth an exception.
    }
  };
}

const log = {
  info: safely(console.log.bind(console)),
  warn: safely(console.warn.bind(console)),
  error: safely(console.error.bind(console)),
};

/**
 * Stop stdio write failures reaching the crash dialog. Anything else is a real
 * bug and is left to propagate.
 */
function installStdioGuards() {
  const isBrokenPipe = (err) => err && (err.code === 'EPIPE' || err.code === 'EIO');

  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (err) => {
      if (!isBrokenPipe(err)) throw err;
    });
  }

  process.on('uncaughtException', (err) => {
    if (isBrokenPipe(err)) return;
    throw err;
  });
}

module.exports = { log, installStdioGuards };
