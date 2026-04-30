'use strict';

// ════════════════════════════════════════════════════════
// CHAOS CREW – Game Scenes Service
// Serves static OBS overlay pages for in-game scene
// transitions (bodycam feed, player switches, etc.).
// No WS, no Redis, no DB — pure static file server.
// ════════════════════════════════════════════════════════

const express = require('express');

function log(tag, ...args) { console.log(`[${tag}]`, ...args); }

const CFG = {
  port: parseInt(process.env.PORT || '3006'),
};

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gamescenes' });
});

app.use(express.static('public'));

app.listen(CFG.port, () => log('GameScenes', `Service on port ${CFG.port}`));
