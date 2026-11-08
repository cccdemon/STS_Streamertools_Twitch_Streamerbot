'use strict';

// Gleiche Form wie log()/logErr() in server.js.
function log(tag, ...args)    { console.log( `[${tag}]`, ...args); }
function logErr(tag, ...args) { console.error(`[${tag}]`, ...args); }

module.exports = { log, logErr };
