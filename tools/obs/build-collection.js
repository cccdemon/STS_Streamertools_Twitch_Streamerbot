#!/usr/bin/env node
'use strict';

/*
 * Baut die OBS-Szenensammlung "RDOC" und das OBS-Profil "RDOC".
 *
 *   node tools/obs/build-collection.js                 in den basic-Ordner der alten Sammlung (Streaming-PC)
 *   node tools/obs/build-collection.js --out <ordner>  in einen anderen basic-Ordner
 *   node tools/obs/build-collection.js --dry           nur pruefen und auflisten
 *
 * Schalter:
 *   --out <dir>          Zielordner (enthaelt scenes\ und profiles\)
 *   --name <name>        Name von Sammlung und Profil (Standard RDOC)
 *   --base <url>         Adresse der StreamSuite (Standard http://192.168.178.34)
 *   --channel <login>    Twitch-Kanal fuer den Chat (Standard justcallmedeimos)
 *   --old <json>         alte Sammlung: liefert Gast-Cams und Spieler-Feeds
 *   --devices <json>     Sammlung, die Kamera, Spielbild, Spotify und Mikrofone
 *                        liefert (Standard: dieselbe wie --old, also der Streaming-PC)
 *   --old-profile <dir>  altes Profil: liefert Kanal-Login und Stream-Key
 *   --local-profile <dir> nur wenn OBS auf einem ANDEREN PC als dem des alten Profils
 *                        laufen soll: liefert dessen Aufnahmepfade und Abhoergeraet
 *   --force              vorhandene Sammlung/Profil gleichen Namens ersetzen
 *   --encoder <id>       Encoder-ID fuer Stream und Aufnahme ersetzen, Werte bleiben.
 *                        Noetig, wenn das alte Profil einen Encoder nennt, den
 *                        dieser PC nicht hat (AMF auf einer NVIDIA-Karte):
 *                        --encoder obs_nvenc_h264_tex
 *   --only-profile       nur das Profil schreiben, die Sammlung bleibt wie sie ist
 *   --ignore-running     auch schreiben, wenn OBS laeuft
 *
 * Ziel ist der Streaming-PC. Geraete, Encoder und Pfade kommen deshalb aus
 * dessen alter Sammlung und dessen altem Profil, nie von dem PC, auf dem
 * dieses Skript zufaellig laeuft.
 *
 * Grundsaetze:
 *   · Koordinaten stehen NUR in services/gamescenes/public/rdoc-layout.js.
 *     Dieselbe Datei liest scene.js, das die Rahmen zeichnet.
 *   · Geraete, Gast-Links und Stream-Key stehen nicht im Repo. Sie werden
 *     aus vorhandenen OBS-Dateien uebernommen (--old, --local).
 *   · Es wird nichts Bestehendes veraendert: eine neue Datei, ein neuer
 *     Profilordner. Ohne --force wird nie ueberschrieben.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('../../services/gamescenes/public/rdoc-layout.js');

/* ── Argumente ─────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const APPDATA_BASIC = path.join(process.env.APPDATA || '.', 'obs-studio', 'basic');
const NAME = opt('name', 'RDOC');
const BASE = opt('base', 'http://192.168.178.34').replace(/\/+$/, '');
const CHANNEL = opt('channel', 'justcallmedeimos');
const OLD = opt('old', '\\\\Mywall-e\\obs\\obs-studio\\basic\\scenes\\Experimentaldeimos.json');
const DEVICES = opt('devices', OLD);
const OLD_PROFILE = opt('old-profile', '\\\\Mywall-e\\obs\\obs-studio\\basic\\profiles\\Experimental-deimos_profile');
// Standardziel: der basic-Ordner, aus dem die alte Sammlung stammt.
const OUT = path.resolve(opt('out', path.dirname(path.dirname(OLD))));
const LOCAL_PROFILE = opt('local-profile', null);
const DRY = flag('dry');
const FORCE = flag('force');
const ONLY_PROFILE = flag('only-profile'); // Sammlung nicht anfassen (in OBS angepasste Positionen bleiben)

let PREV_VER = 536936450; // OBS 32.x, wird unten aus der Geraete-Sammlung uebernommen
const W = L.W;
const H = L.H;
const MIX_ALL = 255;
const warnings = [];
const warn = (m) => warnings.push(m);

const uuid = () => crypto.randomUUID();
const clone = (o) => JSON.parse(JSON.stringify(o));
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; }
}

const audioDefaults = {
  sync: 0, flags: 0, volume: 1, balance: 0.5, enabled: true, muted: false,
  'push-to-mute': false, 'push-to-mute-delay': 0, 'push-to-talk': false, 'push-to-talk-delay': 0,
  hotkeys: {}, deinterlace_mode: 0, deinterlace_field_order: 0, monitoring_type: 0, private_settings: {},
};

/* ── Registry ──────────────────────────────────────────────── */
const registry = new Map();
function register(s) {
  if (registry.has(s.name)) throw new Error(`Name doppelt: ${s.name}`);
  registry.set(s.name, s);
  return s;
}
function source({ name, id, versioned_id, settings, mixers = 0, extra = {} }) {
  return register({ prev_ver: PREV_VER, name, uuid: uuid(), id, versioned_id: versioned_id || id, settings, mixers, ...audioDefaults, ...extra });
}

// Quelle aus einer vorhandenen Sammlung uebernehmen: Einstellungen, Filter,
// Lautstaerke und Spurbelegung bleiben, Name und UUIDs werden neu vergeben.
function adopt(coll, fromName, name, patch) {
  const names = [].concat(fromName);
  const src = coll && names.map((n) => (coll.sources || []).find((s) => s.name === n)).find(Boolean);
  if (!src) return null;
  const s = clone(src);
  s.name = name;
  s.uuid = uuid();
  s.prev_ver = PREV_VER;
  s.hotkeys = {};
  for (const f of s.filters || []) f.uuid = uuid();
  if (patch) patch(s);
  return register(s);
}

function browser(name, url, { w = W, h = H, restart = false, shutdown = false, audio = false } = {}) {
  const settings = { url, width: w, height: h };
  if (audio) settings.reroute_audio = true;
  if (restart) settings.restart_when_active = true;
  if (shutdown) settings.shutdown = true;
  return source({ name, id: 'browser_source', settings, mixers: audio ? MIX_ALL : 0 });
}
const frame = (name, query, o) => browser(name, `${BASE}/gamescenes/scene.html?${query}`, o);

/* ── Szenen-Items ──────────────────────────────────────────── */
// pos_rel/scale_rel sind die relativen Koordinaten seit OBS 30, gerechnet
// gegen die Groesse der Szene, in der das Item liegt (ref).
function item(spec, id, ref) {
  const src = registry.get(spec.name);
  if (!src) throw new Error(`Quelle fehlt: ${spec.name}`);
  const { x = 0, y = 0, scale = 1, visible = true, fill = null, crop = {} } = spec;
  const sc = typeof scale === 'object' ? scale : { x: scale, y: scale };
  const bounds = fill ? { x: fill.w, y: fill.h } : { x: 0, y: 0 };
  // Verkleinerte Quellen sauber herunterrechnen, sonst flimmern Gesichter
  // in den kleinen Cam-Zellen.
  const filter = fill || (sc.x === 1 && sc.y === 1) ? 'disable' : sc.x < 0.6 ? 'area' : 'bicubic';
  return {
    name: spec.name, source_uuid: src.uuid, visible, locked: false, rot: 0,
    scale_ref: { x: ref.w, y: ref.h }, align: 5,
    bounds_type: fill ? 2 : 0, bounds_align: 0, bounds_crop: false,
    crop_left: crop.left || 0, crop_top: crop.top || 0, crop_right: crop.right || 0, crop_bottom: crop.bottom || 0,
    id, group_item_backup: false,
    pos: { x, y },
    pos_rel: { x: (x - ref.w / 2) / (ref.h / 2), y: (y - ref.h / 2) / (ref.h / 2) },
    scale: { x: sc.x, y: sc.y }, scale_rel: { x: sc.x, y: sc.y },
    bounds, bounds_rel: { x: bounds.x / (ref.h / 2), y: bounds.y / (ref.h / 2) },
    scale_filter: filter, blend_method: 'default', blend_type: 'normal',
    show_transition: { duration: 300 }, hide_transition: { duration: 300 },
    private_settings: {},
  };
}

// items werden von unten nach oben gestapelt – das letzte liegt oben.
function scene(name, specs, size) {
  const ref = size || { w: W, h: H };
  const items = specs.filter(Boolean).map((sp, i) => item(sp, i + 1, ref));
  const hotkeys = { 'OBSBasic.SelectScene': [] };
  for (const it of items) {
    hotkeys[`libobs.show_scene_item.${it.id}`] = [];
    hotkeys[`libobs.hide_scene_item.${it.id}`] = [];
  }
  return register({
    prev_ver: PREV_VER, name, uuid: uuid(), id: 'scene', versioned_id: 'scene',
    settings: size
      ? { id_counter: items.length + 1, custom_size: true, cx: size.w, cy: size.h, items }
      : { id_counter: items.length + 1, custom_size: false, items },
    mixers: 0, ...audioDefaults, hotkeys,
  });
}

// Quelle der Groesse src formatfuellend in ein Rechteck setzen: skalieren,
// bis beide Kanten decken, Ueberstand mittig abschneiden.
function cover(name, r, src = { w: W, h: H }, more = {}) {
  const k = Math.max(r.w / src.w, r.h / src.h);
  const cx = Math.max(0, Math.round((src.w - r.w / k) / 2));
  const cy = Math.max(0, Math.round((src.h - r.h / k) / 2));
  return { name, x: r.x, y: r.y, scale: k, crop: { left: cx, right: cx, top: cy, bottom: cy }, ...more };
}

/* ── Vorhandene OBS-Dateien ────────────────────────────────── */
const oldColl = readJson(OLD);
const devColl = DEVICES === OLD ? oldColl : readJson(DEVICES);
// Versionsstempel der Quellen: der des OBS, das die Geraete-Sammlung zuletzt
// gespeichert hat. Ein neuerer Stempel als das dortige OBS waere gelogen.
PREV_VER = (devColl && devColl.sources && devColl.sources[0] && devColl.sources[0].prev_ver) || PREV_VER;
if (!oldColl) warn(`Alte Sammlung nicht lesbar (${OLD}): Gast-Cams und Feeds sind Platzhalter, Links in OBS eintragen.`);
if (!devColl) warn(`Geraete-Sammlung nicht lesbar (${DEVICES}): Kamera, Spielbild und Mikrofon in OBS neu waehlen.`);

const P = L.PEOPLE;
const GUESTS = L.ORDER.filter((k) => k !== 'deimos');
const OLD_CAM = { headwig: 'Headwig_SINGLE', jericho: 'Jericho_SINGLE', polder: 'Antje_SINGLE', jazzz: 'JazZz_SINGLE' };
const OLD_FEED = { headwig: 'rtc_headwig', jericho: 'rtc_jericho', polder: 'srt_polder', jazzz: 'rtc_jazzz' };

/* ── Geraete und Ton ───────────────────────────────────────── */
// Namen je nach Herkunft: die alte Sammlung des Streaming-PCs nennt die
// Kamera "Camera" und die Capture-Karte mit dem Spielbild "Videoaufnahmegerät".
adopt(devColl, ['Camera', 'Kamera'], 'Kamera')
  || source({ name: 'Kamera', id: 'dshow_input', settings: { resolution: '1920x1080', res_type: 0 }, mixers: MIX_ALL });
adopt(devColl, ['Videoaufnahmegerät', 'Bildschirm'], 'Spielbild')
  || source({ name: 'Spielbild', id: 'monitor_capture', settings: { method: 2 } });
adopt(devColl, 'Spotify', 'Spotify')
  || source({ name: 'Spotify', id: 'wasapi_process_output_capture', settings: { window: 'Spotify Premium:Chrome_WidgetWin_1:Spotify.exe', priority: 2 }, mixers: 193 });
// Discord-Ton als Anwendungsaufnahme. Die alte Sammlung hat dafuer ein
// Fenster aufgenommen und auf 0,3 % verkleinert, nur um an den Ton zu kommen.
source({
  name: 'Discord', id: 'wasapi_process_output_capture',
  settings: { window: 'Discord:Chrome_WidgetWin_1:Discord.exe', priority: 2 },
  mixers: 195, extra: { volume: 0.8 },
});

/* ── Gast-Cams und Spieler-Feeds (aus der alten Sammlung) ──── */
const camSize = {};
const feedSize = {};
for (const k of GUESTS) {
  const cam = adopt(oldColl, OLD_CAM[k], `VDO ${P[k].scene}`)
    || browser(`VDO ${P[k].scene}`, 'https://vdo.ninja/?view=HIER_EINTRAGEN', { w: 1280, h: 720, shutdown: true, restart: true });
  camSize[k] = { w: cam.settings.width || 1280, h: cam.settings.height || 720 };
  const feed = adopt(oldColl, OLD_FEED[k], `Feed ${P[k].scene}`)
    || browser(`Feed ${P[k].scene}`, 'about:blank', { w: 1920, h: 1080, shutdown: true, restart: true, audio: true });
  feedSize[k] = { w: feed.settings.width || 1920, h: feed.settings.height || 1080 };
}

/* ── StreamSuite-Quellen ───────────────────────────────────── */
// Alerts: ?latest=0, weil oben rechts der Cam-Block sitzt und "Zuletzt" in
// der Fussleiste steht. Lautstaerke und Monitoring aus der alten Sammlung.
adopt(oldColl, 'Overlay', 'Alerts', (s) => { s.settings.url = `${BASE}/alerts/overlay.html?latest=0`; s.settings.width = W; s.settings.height = H; })
  || browser('Alerts', `${BASE}/alerts/overlay.html?latest=0`, { audio: true });
adopt(oldColl, 'Hauling', 'Hauling', (s) => { s.settings.url = `${BASE}/alerts/haul.html`; s.settings.width = W; s.settings.height = H; })
  || browser('Hauling', `${BASE}/alerts/haul.html`, { audio: true });
const SF = { w: 1920, h: 1080 };
browser('Spacefight', `${BASE}/spacefight/spacefight.html`, { w: SF.w, h: SF.h, audio: true });

// Eine Chat-Quelle je Flaeche, siehe CHATS in rdoc-layout.js. shutdown:
// nur die Quelle der sichtbaren Szene haelt eine Verbindung.
const chatUrl = `${BASE}/alerts/chat.html?channel=${encodeURIComponent(CHANNEL)}&ident=0&glass=1`;
const chatName = (key) => `Chat ${key[0].toUpperCase()}${key.slice(1)}`;
for (const key of Object.keys(L.CHATS)) {
  const c = L.chatSource(key);
  browser(chatName(key), chatUrl, { w: c.w, h: c.h, shutdown: true });
}
const chat = (key) => { const c = L.chatSource(key); return { name: chatName(key), x: c.area.x, y: c.area.y, scale: c.k }; };

// Space #121416 als OBS-Farbe (ABGR).
source({ name: 'Hintergrund', id: 'color_source', versioned_id: 'color_source_v3', settings: { color: ((0xff << 24) >>> 0) + (0x16 << 16) + (0x14 << 8) + 0x12, width: W, height: H } });

frame('Rahmen Gaming', 's=gaming');
frame('Rahmen Talk', 's=talk');
frame('Rahmen Talk solo', 's=solo');
frame('Fussleiste', 's=footer&l=Gaming');
frame('Rahmen Multi 3', 's=multi3');
frame('Rahmen Multi 4', 's=multi4');
frame('Rahmen Multi 5', 's=multi5');
// Standbilder beim Szenenwechsel neu laden: der Countdown startet frisch.
frame('Seite Start', 's=start&min=5', { restart: true, shutdown: true });
frame('Seite Pause', 's=pause', { shutdown: true });
frame('Seite Ende', 's=ende', { restart: true, shutdown: true });
frame('Kachel Deimos', 's=tile&p=deimos');
for (const k of GUESTS) {
  frame(`Rahmen Spiel ${P[k].scene}`, `s=player&p=${k}`);
  frame(`Rahmen Cam ${P[k].scene}`, `s=cam&p=${k}`);
  frame(`Kachel ${P[k].scene}`, `s=tile&p=${k}`);
}

/* ── Baustein-Szenen ───────────────────────────────────────── */
const FULL = { w: W, h: H };
scene('SRC_Audio', [{ name: 'Spotify' }, { name: 'Discord' }]);
scene('SRC_Alerts', [{ name: 'Alerts' }, { name: 'Hauling' }]);

// Cam und Feed je Person, immer in Leinwandgroesse: alles darueber rechnet
// nur noch mit 2560x1440 und muss die Quellgroesse nicht kennen.
scene('SRC_Cam_Deimos', [{ name: 'Kamera', fill: FULL }]);
scene('SRC_Feed_Deimos', [{ name: 'Spielbild', fill: FULL }]);
for (const k of GUESTS) {
  scene(`SRC_Cam_${P[k].scene}`, [cover(`VDO ${P[k].scene}`, { x: 0, y: 0, ...FULL }, camSize[k])]);
  scene(`SRC_Feed_${P[k].scene}`, [cover(`Feed ${P[k].scene}`, { x: 0, y: 0, ...FULL }, feedSize[k])]);
}

// Cam-Block je "grosser" Person: eigene 4:3-Szene, 1440x1080. Fuer den
// Hochformat-Clip laesst sie sich unabhaengig vom Spielbild platzieren.
for (const big of L.ORDER) {
  scene(`SRC_Camblock_${P[big].scene}`, L.camBlock(L.BLOCK.w, big).map((c) => cover(`SRC_Cam_${P[c.who].scene}`, c)), L.BLOCK);
}

// Spiel-Kachel: Feed plus Cam des Spielers plus Kante/Schild. Die Cam ist
// Bestandteil der Kachel und wandert in den Multi-Szenen mit.
for (const k of L.ORDER) {
  const n = P[k].scene;
  scene(`SRC_Spiel_${n}`, [{ name: `SRC_Feed_${n}` }, cover(`SRC_Cam_${n}`, L.TILE.cam), { name: `Kachel ${n}` }]);
}

// Spacefight: die 640x200-Arena sitzt mittig im 1920x1080-Entwurfsraum der
// Seite. Zugeschnitten auf genau dieses Feld passt sie in die Fussleiste.
function arena(r) {
  return { name: 'Spacefight', x: r.x, y: r.y, crop: { left: (SF.w - r.w) / 2, right: (SF.w - r.w) / 2, top: (SF.h - r.h) / 2, bottom: (SF.h - r.h) / 2 } };
}
// Fussleiste als eigene Szene: EIN Auge in OBS blendet sie aus und ein.
scene('SRC_Fussleiste', [{ name: 'Fussleiste' }, arena(L.GAMING.arena)]);

/* ── Programmszenen ────────────────────────────────────────── */
const G = L.GAMING;
const blockAt = (big, r) => ({ name: `SRC_Camblock_${P[big].scene}`, x: r.x, y: r.y, scale: r.w / L.BLOCK.w });
const program = [];
const prog = (name, specs) => { program.push(scene(name, specs)); };

prog('Start', [{ name: 'SRC_Audio' }, { name: 'Seite Start' }, chat('still'), { name: 'SRC_Alerts' }]);
prog('Pause', [{ name: 'SRC_Audio' }, { name: 'Seite Pause' }, chat('still'), { name: 'SRC_Alerts' }]);
prog('Ende', [{ name: 'SRC_Audio' }, { name: 'Seite Ende' }, { name: 'SRC_Alerts' }]);
prog('Talk solo', [{ name: 'SRC_Audio' }, { name: 'SRC_Cam_Deimos' }, { name: 'Rahmen Talk solo' }, chat('solo'), { name: 'SRC_Alerts' }]);
prog('Talk', [{ name: 'SRC_Audio' }, { name: 'Hintergrund' }, blockAt('deimos', L.TALK.block), { name: 'Rahmen Talk' }, chat('talk'), { name: 'SRC_Alerts' }]);
prog('Gaming', [
  { name: 'SRC_Audio' }, { name: 'SRC_Feed_Deimos' }, blockAt('deimos', G.block),
  { name: 'Rahmen Gaming' }, chat('spalte'), { name: 'SRC_Fussleiste' }, { name: 'SRC_Alerts' },
]);
prog('Desktop', [{ name: 'SRC_Audio' }, { name: 'SRC_Feed_Deimos' }, { name: 'SRC_Alerts' }]);
for (const k of GUESTS) {
  const n = P[k].scene;
  prog(`Cam ${n}`, [{ name: 'SRC_Audio' }, { name: `SRC_Cam_${n}` }, { name: `Rahmen Cam ${n}` }, { name: 'SRC_Alerts' }]);
}
for (const k of GUESTS) {
  const n = P[k].scene;
  prog(`Spiel ${n}`, [
    { name: 'SRC_Audio' }, { name: `SRC_Feed_${n}` }, blockAt(k, G.block),
    { name: `Rahmen Spiel ${n}` }, chat('spalte'), { name: 'SRC_Fussleiste' }, { name: 'SRC_Alerts' },
  ]);
}
// Multi: je Feld liegen alle fuenf Kacheln uebereinander, sichtbar ist die
// Standardbelegung. Wer in welchem Feld sitzt, tauscht man per Auge.
for (const [key, title] of [['multi3', 'Multi 3'], ['multi4', 'Multi 4'], ['multi5', 'Multi 5']]) {
  const M = L.MULTI[key];
  const tiles = [];
  M.slots.forEach((r, i) => {
    for (const k of L.ORDER) tiles.push(cover(`SRC_Spiel_${P[k].scene}`, r, FULL, { visible: k === M.who[i] }));
  });
  prog(title, [
    { name: 'SRC_Audio' }, { name: 'Hintergrund' }, ...tiles, { name: `Rahmen ${title}` },
    M.chat ? chat(key) : null, M.arena ? arena(M.arena) : null, { name: 'SRC_Alerts' },
  ]);
}

/* ── Globale Audiogeraete ──────────────────────────────────── */
// Alle, die die Geraete-Sammlung kennt (Mikrofon, PC-Sound, ...), samt
// Filtern, Verzoegerung und Spurbelegung.
const AUDIO_KEYS = ['DesktopAudioDevice1', 'DesktopAudioDevice2', 'AuxAudioDevice1', 'AuxAudioDevice2', 'AuxAudioDevice3', 'AuxAudioDevice4'];
const globalAudio = {};
for (const key of AUDIO_KEYS) {
  if (!devColl || !devColl[key]) continue;
  const g = clone(devColl[key]);
  g.uuid = uuid();
  for (const f of g.filters || []) f.uuid = uuid();
  globalAudio[key] = g;
}
if (!Object.keys(globalAudio).length) {
  globalAudio.AuxAudioDevice1 = { prev_ver: PREV_VER, name: 'Mikrofon-/AUX-Audio', uuid: uuid(), id: 'wasapi_input_capture', versioned_id: 'wasapi_input_capture', settings: { device_id: 'default' }, mixers: 195, ...audioDefaults };
}

/* ── Sammlung ──────────────────────────────────────────────── */
const all = [...registry.values()];
const subScenes = all.filter((s) => s.id === 'scene' && !program.includes(s));
const collection = {
  name: NAME,
  ...globalAudio,
  sources: all,
  groups: [],
  scene_order: [...program, ...subScenes].map((s) => ({ name: s.name })),
  current_scene: 'Start',
  current_program_scene: 'Start',
  current_transition: 'Überblende',
  transition_duration: 300,
  transitions: [],
  quick_transitions: [
    { name: 'Schnitt', duration: 300, hotkeys: [], id: 1, fade_to_black: false },
    { name: 'Überblende', duration: 300, hotkeys: [], id: 2, fade_to_black: false },
  ],
  saved_projectors: [],
  preview_locked: false,
  scaling_enabled: false,
  scaling_level: 0,
  scaling_off_x: 0,
  scaling_off_y: 0,
  modules: {},
  resolution: { x: W, y: H },
  version: 2,
};

/* ── Selbstpruefung ────────────────────────────────────────── */
function selfCheck() {
  const byUuid = new Set(all.map((s) => s.uuid));
  if (byUuid.size !== all.length) throw new Error('UUID doppelt');
  for (const s of all.filter((x) => x.id === 'scene')) {
    const ref = s.settings.custom_size ? { w: s.settings.cx, h: s.settings.cy } : { w: W, h: H };
    for (const it of s.settings.items) {
      if (!byUuid.has(it.source_uuid)) throw new Error(`${s.name}: Item ${it.name} zeigt ins Leere`);
      if (it.name === s.name) throw new Error(`${s.name}: enthaelt sich selbst`);
      if (it.pos.x < 0 || it.pos.y < 0 || it.pos.x >= ref.w || it.pos.y >= ref.h) throw new Error(`${s.name}: ${it.name} liegt ausserhalb`);
      if (!(it.scale.x > 0) || !(it.scale.y > 0)) throw new Error(`${s.name}: ${it.name} hat Skalierung 0`);
    }
  }
  if (program.length !== 18) throw new Error(`erwartet 18 Programmszenen, gebaut ${program.length}`);
}
selfCheck();

/* ── Profil ────────────────────────────────────────────────── */
function parseIni(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  return {
    lines,
    find(section, key) {
      let cur = '';
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\[(.+)\]$/);
        if (m) { cur = m[1]; continue; }
        if (cur === section && lines[i].startsWith(`${key}=`)) return i;
      }
      return -1;
    },
    get(section, key) { const i = this.find(section, key); return i < 0 ? null : lines[i].slice(key.length + 1); },
    set(section, key, value) {
      const i = this.find(section, key);
      if (i >= 0) { lines[i] = `${key}=${value}`; return; }
      let s = lines.indexOf(`[${section}]`);
      if (s < 0) { lines.push('', `[${section}]`); s = lines.length - 1; }
      lines.splice(s + 1, 0, `${key}=${value}`);
    },
    remove(section, key) { const i = this.find(section, key); if (i >= 0) lines.splice(i, 1); },
    toString() { return lines.join('\n'); },
  };
}

function buildProfile() {
  const haveOld = fs.existsSync(path.join(OLD_PROFILE, 'basic.ini'));
  const haveLocal = !!LOCAL_PROFILE && fs.existsSync(path.join(LOCAL_PROFILE, 'basic.ini'));
  const baseDir = haveOld ? OLD_PROFILE : haveLocal ? LOCAL_PROFILE : null;
  if (!baseDir) { warn('Kein Profil als Vorlage gefunden: Profil nicht gebaut, in OBS neu anlegen (2560x1440, 60 fps).'); return null; }
  if (!haveOld) warn(`Altes Profil fehlt (${OLD_PROFILE}): Profil von diesem PC kopiert. ACHTUNG, Stream-Key gehoert dann zu dessen Kanal – in OBS pruefen.`);

  const ini = parseIni(fs.readFileSync(path.join(baseDir, 'basic.ini'), 'utf8'));
  ini.set('General', 'Name', NAME);
  for (const [k, v] of [['BaseCX', W], ['BaseCY', H], ['OutputCX', W], ['OutputCY', H], ['FPSType', 0], ['FPSCommon', 60]]) ini.set('Video', k, v);
  // Verweist auf die Hochformat-Leinwand der alten Sammlung, die es hier nicht gibt.
  ini.remove('Stream1', 'MultitrackExtraCanvas');

  // Vom Profil dieses PCs nur Pfade und Abhoergeraet. Die Encoder-
  // Einstellungen bleiben die des alten Profils (ausdruecklich so gewollt):
  // Encoder-Wahl in basic.ini plus streamEncoder.json / recordEncoder.json.
  if (haveOld && haveLocal) {
    const loc = parseIni(fs.readFileSync(path.join(LOCAL_PROFILE, 'basic.ini'), 'utf8'));
    for (const [sec, key] of [
      ['AdvOut', 'RecFilePath'], ['AdvOut', 'FFFilePath'], ['SimpleOutput', 'FilePath'],
      ['Audio', 'MonitoringDeviceId'], ['Audio', 'MonitoringDeviceName'],
    ]) {
      const v = loc.get(sec, key);
      if (v != null) ini.set(sec, key, v);
    }
  }

  const enc = opt('encoder', null);
  if (enc) { ini.set('AdvOut', 'Encoder', enc); ini.set('AdvOut', 'RecEncoder', enc); }

  const files = { 'basic.ini': ini.toString() };
  const service = path.join(baseDir, 'service.json');
  if (fs.existsSync(service)) files['service.json'] = fs.readFileSync(service, 'utf8');
  for (const f of ['streamEncoder.json', 'recordEncoder.json']) {
    const p = path.join(baseDir, f);
    if (fs.existsSync(p)) files[f] = fs.readFileSync(p, 'utf8');
  }
  return { files, encoder: ini.get('AdvOut', 'Encoder'), channel: ini.get('Twitch', 'Name') };
}
const profile = buildProfile();

/* ── Schreiben ─────────────────────────────────────────────── */
const sceneFile = path.join(OUT, 'scenes', `${NAME}.json`);
const profileDir = path.join(OUT, 'profiles', NAME);

function obsRunning() {
  if (process.platform !== 'win32' || flag('ignore-running')) return false;
  if (!OUT.toLowerCase().startsWith((process.env.APPDATA || '\0').toLowerCase())) return false;
  try {
    return require('node:child_process').execSync('tasklist /FI "IMAGENAME eq obs64.exe" /NH', { encoding: 'utf8' }).includes('obs64.exe');
  } catch (e) { return false; }
}

const counts = {
  programm: program.length,
  bausteine: subScenes.length,
  quellen: all.length - program.length - subScenes.length,
};

console.log(`${DRY ? 'PROBELAUF' : 'Ziel'}: ${OUT}`);
console.log(`  Sammlung ${NAME}: ${counts.programm} Programmszenen, ${counts.bausteine} Baustein-Szenen, ${counts.quellen} Quellen`);
console.log(`  Programmszenen: ${program.map((s) => s.name).join(', ')}`);
if (profile) console.log(`  Profil ${NAME}: ${W}x${H}, 60 fps, Encoder ${profile.encoder || '?'}, Kanal ${profile.channel || '?'}`);
for (const w of warnings) console.log(`  WARNUNG: ${w}`);

if (!DRY) {
  if (obsRunning()) {
    console.error('OBS laeuft – es wuerde die Datei beim Beenden ueberschreiben. OBS schliessen und erneut ausfuehren.');
    process.exit(2);
  }
  if (!ONLY_PROFILE && !FORCE && fs.existsSync(sceneFile)) {
    console.error(`Vorhanden: ${sceneFile}\nIn OBS gemachte Anpassungen gingen verloren. Mit --force trotzdem ersetzen.`);
    process.exit(3);
  }
  if (!FORCE && profile && fs.existsSync(profileDir)) {
    console.error(`Vorhanden: ${profileDir}\nMit --force trotzdem ersetzen.`);
    process.exit(3);
  }
  if (!ONLY_PROFILE) {
    fs.mkdirSync(path.dirname(sceneFile), { recursive: true });
    fs.writeFileSync(sceneFile, JSON.stringify(collection, null, 4));
    console.log(`  geschrieben: ${sceneFile}`);
  }
  if (profile) {
    fs.mkdirSync(profileDir, { recursive: true });
    for (const [f, text] of Object.entries(profile.files)) fs.writeFileSync(path.join(profileDir, f), text);
    console.log(`  geschrieben: ${profileDir}`);
  }
}

module.exports = { collection };
