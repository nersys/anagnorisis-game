/**
 * Anagnorisis — Main Web Application
 * Handles all screens, UI rendering, and WebSocket message dispatch
 */

import { GameWebSocket } from '/static/js/ws.js';
import { state, on, applyStateUpdate } from '/static/js/state.js';
import { LAMap } from '/static/js/la-map.js';

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

/** Player stats live under player.stats — this helper flattens access */
function ps(player) { return (player && player.stats) ? player.stats : (player || {}); }

const CLASSES = {
  warrior: { emoji: '⚔️', name: 'Warrior', tag: 'Tank & Brawler', color: '#e53935' },
  mage:    { emoji: '🔮', name: 'Mage',    tag: 'Arcane Power',  color: '#7c3aed' },
  rogue:   { emoji: '🗡️', name: 'Rogue',   tag: 'Swift & Deadly', color: '#1e88e5' },
  cleric:  { emoji: '✨', name: 'Cleric',  tag: 'Divine Healer', color: '#f0cc6a' },
  ranger:  { emoji: '🏹', name: 'Ranger',  tag: 'Eagle Eye',     color: '#43a047' },
};

const SKILLS = {
  slash:          { name: 'Slash',         emoji: '⚔️', mp: 10, desc: 'A powerful sword strike dealing bonus damage.' },
  shield_bash:    { name: 'Shield Bash',   emoji: '🛡️', mp: 8,  desc: 'Bash the enemy, stunning them for one turn.' },
  battle_cry:     { name: 'Battle Cry',    emoji: '📣', mp: 12, desc: 'Raise your attack power for 3 turns.' },
  fireball:       { name: 'Fireball',      emoji: '🔥', mp: 20, desc: 'Hurl a ball of fire that ignores armor.' },
  frost_shield:   { name: 'Frost Shield',  emoji: '❄️', mp: 15, desc: 'Conjure ice armor, halving damage for 3 turns.' },
  arcane_missile: { name: 'Arcane Missile',emoji: '💫', mp: 10, desc: 'A bolt of pure arcane energy.' },
  backstab:       { name: 'Backstab',      emoji: '🗡️', mp: 15, desc: 'Strike from the shadows for massive damage.' },
  stealth:        { name: 'Stealth',       emoji: '👤', mp: 10, desc: 'Vanish! Next attack deals triple damage.' },
  pickpocket:     { name: 'Pickpocket',    emoji: '💰', mp: 5,  desc: 'Steal gold from an enemy.' },
  heal:           { name: 'Heal',          emoji: '💚', mp: 20, desc: 'Restore 30% of your max HP.' },
  smite:          { name: 'Smite',         emoji: '☀️', mp: 18, desc: 'Divine strike that bypasses defense.' },
  bless:          { name: 'Bless',         emoji: '🙏', mp: 12, desc: 'Blessed by the gods, attack up for 3 turns.' },
  aimed_shot:     { name: 'Aimed Shot',    emoji: '🎯', mp: 12, desc: 'A precise shot dealing heavy damage.' },
  trap:           { name: 'Trap',          emoji: '🪤', mp: 8,  desc: 'Set a trap that stuns the enemy.' },
  animal_companion:{ name: 'Companion',    emoji: '🐺', mp: 15, desc: 'Your wolf companion attacks for you.' },
};

const ITEM_EMOJIS = {
  health_potion: '🧪', greater_health_potion: '💊', mana_potion: '🔵',
  iron_sword: '⚔️', oak_staff: '🪄', twin_daggers: '🗡️', holy_mace: '🔨', longbow: '🏹',
  wooden_shield: '🛡️', spellbook: '📖', lockpicks: '🔑', prayer_beads: '📿', quiver: '🪄',
  smoke_bomb: '💨', hunting_knife: '🔪', bandages: '🩹',
  default: '📦',
};

const PHASE_LABELS = {
  exploring: '🧭 EXPLORING',
  combat:    '⚔️ COMBAT',
  looting:   '💰 LOOTING',
  victory:   '🏆 VICTORY',
  game_over: '💀 GAME OVER',
  resting:   '💤 RESTING',
};

// ═══════════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════════

const ws = new GameWebSocket();
let laMap = null;
let selectedClass = 'warrior';
let selectedMode = 'guided';
let currentRoomData = null;
let sceneImageSeed = 1;

// ═══════════════════════════════════════════════════════
// SCREEN ROUTER
// ═══════════════════════════════════════════════════════

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
  state.screen = name;

  if (name === 'game') {
    setTimeout(() => {
      setupMapCanvas();
      renderGameUI();
    }, 50);
  }
}

// ═══════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════

function initLogin() {
  // Particle canvas background
  initParticles();

  // Render class cards
  const grid = document.getElementById('class-grid');
  grid.innerHTML = Object.entries(CLASSES).map(([key, cls]) => `
    <div class="class-card ${key === selectedClass ? 'selected' : ''}"
         data-class="${key}" style="--class-color:${cls.color}">
      <span class="class-emoji">${cls.emoji}</span>
      <span class="class-name">${cls.name}</span>
      <span class="class-tag">${cls.tag}</span>
    </div>
  `).join('');

  grid.querySelectorAll('.class-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedClass = card.dataset.class;
      grid.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      validateLoginForm();
    });
  });

  // Name input validation
  const nameInput = document.getElementById('input-name');
  nameInput.addEventListener('input', validateLoginForm);

  // Server config toggle
  document.getElementById('toggle-server-config').addEventListener('click', () => {
    document.getElementById('server-config-panel').classList.toggle('hidden');
  });

  // Default server URL
  const serverInput = document.getElementById('input-server');
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  serverInput.value = `${protocol}//${location.host}/ws`;

  // Login button
  document.getElementById('btn-login').addEventListener('click', doLogin);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

function validateLoginForm() {
  const name = document.getElementById('input-name').value.trim();
  document.getElementById('btn-login').disabled = !name;
}

async function doLogin() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) return;

  const serverInput = document.getElementById('input-server');
  const url = serverInput.value.trim() || `ws://${location.host}/ws`;

  setLoginStatus('Connecting to server...');
  hideLoginError();
  document.getElementById('btn-login').disabled = true;

  try {
    await ws.connect(url);
    setLoginStatus('Authenticating...');
    ws.send('CONNECT', { player_name: name, player_class: selectedClass });
  } catch (e) {
    showLoginError(`Could not connect: ${e.message}`);
    document.getElementById('btn-login').disabled = false;
    setLoginStatus('');
  }
}

function setLoginStatus(msg) {
  const el = document.getElementById('login-status');
  const txt = document.getElementById('login-status-text');
  if (msg) {
    el.classList.remove('hidden');
    txt.textContent = msg;
  } else {
    el.classList.add('hidden');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideLoginError() {
  document.getElementById('login-error').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// PARTICLE BACKGROUND
// ═══════════════════════════════════════════════════════

function initParticles() {
  const canvas = document.getElementById('login-particles');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let W, H;

  const resize = () => {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
    particles = Array.from({ length: 80 }, () => createParticle());
  };

  const createParticle = () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -Math.random() * 0.5 - 0.1,
    size: Math.random() * 2 + 0.5,
    alpha: Math.random() * 0.6 + 0.1,
    color: Math.random() > 0.7 ? '#c9a84c' : '#ffffff',
  });

  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.alpha -= 0.001;
      if (p.y < 0 || p.alpha <= 0) Object.assign(p, createParticle(), { y: H });
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    requestAnimationFrame(tick);
  };

  window.addEventListener('resize', resize);
  resize();
  tick();
}

// ═══════════════════════════════════════════════════════
// LOBBY SCREEN
// ═══════════════════════════════════════════════════════

function initLobby() {
  document.getElementById('btn-disconnect').addEventListener('click', () => {
    ws.disconnect();
    showScreen('login');
    setLoginStatus('');
    document.getElementById('btn-login').disabled = false;
  });

  document.getElementById('btn-refresh-parties').addEventListener('click', refreshParties);
  document.getElementById('btn-create-party').addEventListener('click', createParty);
  document.getElementById('btn-leave-party').addEventListener('click', leaveParty);
  document.getElementById('btn-start-adventure').addEventListener('click', startAdventure);

  document.getElementById('mode-selector').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    selectedMode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
}

function renderLobbyPlayer() {
  const player = state.player;
  if (!player) return;
  const cls = CLASSES[player.player_class] || CLASSES.warrior;
  const s = ps(player);
  const pct = pctOf(s.health, s.max_health);
  const mptc = pctOf(s.mana, s.max_mana);

  document.getElementById('lobby-player-card').innerHTML = `
    <div class="class-emoji-lg">${cls.emoji}</div>
    <div class="player-info">
      <h3>${player.name}</h3>
      <p>${cls.name} · Level ${s.level || 1} · ${s.gold || 0} gold</p>
    </div>
    <div class="mini-bars">
      ${miniBar(pct, 'hp')}
      ${miniBar(mptc, 'mp')}
    </div>
  `;
}

function miniBar(pct, type) {
  return `<div class="bar-track" style="height:5px">
    <div class="bar-fill bar-${type}" style="width:${pct}%"></div>
  </div>`;
}

function renderPartyList() {
  const parties = state.parties || [];
  const el = document.getElementById('party-list');
  if (!parties.length) {
    el.innerHTML = '<div class="empty-state">No parties available. Create one!</div>';
    return;
  }
  el.innerHTML = parties.map(p => `
    <div class="party-item" data-id="${p.id}">
      <span class="party-name">🏰 ${p.name}</span>
      <span class="party-meta">${p.member_count || 0}/6 members</span>
      <span class="party-size">${p.status === 'lobby' ? '🟢' : '🔴'}</span>
    </div>
  `).join('');

  el.querySelectorAll('.party-item').forEach(item => {
    item.addEventListener('click', () => {
      if (state.party) return; // already in party
      ws.send('JOIN_PARTY', { party_id: item.dataset.id });
    });
  });
}

function renderCurrentParty() {
  const party = state.party;
  if (!party) {
    document.getElementById('panel-create-party').classList.remove('hidden');
    document.getElementById('panel-current-party').classList.add('hidden');
    return;
  }
  document.getElementById('panel-create-party').classList.add('hidden');
  document.getElementById('panel-current-party').classList.remove('hidden');

  document.getElementById('current-party-name').textContent = `🏰 ${party.name}`;
  document.getElementById('party-status-badge').textContent = (party.status || 'LOBBY').toUpperCase();
  document.getElementById('party-status-badge').className = `badge badge-${party.status === 'in_adventure' ? 'active' : 'lobby'}`;

  const membersEl = document.getElementById('party-members-list');
  const members = party.member_ids || [];
  membersEl.innerHTML = members.map(id => {
    const isLeader = id === party.leader_id;
    const isSelf   = id === state.playerId;
    const p        = isSelf ? state.player : null;
    const cls      = p ? (CLASSES[p.player_class] || CLASSES.warrior) : { emoji: '👤' };
    const name     = p ? p.name : `Player ${id.slice(0,6)}`;
    return `<div class="party-member">
      <span class="member-emoji">${cls.emoji}</span>
      <span class="member-name">${name}${isSelf ? ' (you)' : ''}</span>
      ${isLeader ? '<span class="leader-crown">👑</span>' : ''}
    </div>`;
  }).join('');

  const isLeader = party.leader_id === state.playerId;
  document.getElementById('panel-start-adventure').classList.toggle('hidden', !isLeader);
}

function refreshParties() {
  ws.send('LIST_PARTIES', {});
}

function createParty() {
  const name = document.getElementById('input-party-name').value.trim();
  if (!name) { lobbyToast('Enter a party name first.'); return; }
  ws.send('CREATE_PARTY', { party_name: name });
}

function leaveParty() {
  ws.send('LEAVE_PARTY', {});
}

function startAdventure() {
  const name = document.getElementById('input-adventure-name').value.trim() || 'Into the Depths';
  ws.send('START_ADVENTURE', {
    adventure_name: name,
    description: 'A perilous dungeon adventure',
    mode: selectedMode,
  });
}

function lobbyToast(msg) {
  const el = document.getElementById('lobby-message');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ═══════════════════════════════════════════════════════
// GAME SCREEN
// ═══════════════════════════════════════════════════════

function setupMapCanvas() {
  if (!laMap) {
    laMap = new LAMap('la-map');
    laMap.init();
  }
  if (state.dungeon) laMap.render(state.dungeon);
}

function initGame() {
  document.getElementById('btn-toggle-inventory').addEventListener('click', openInventory);
  document.getElementById('btn-close-inventory').addEventListener('click', closeInventory);
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    document.getElementById('narrative-log').innerHTML = '';
    state.narrativeLog = [];
  });
  document.getElementById('btn-regen-image').addEventListener('click', () => {
    sceneImageSeed = Math.floor(Math.random() * 99999);
    generateSceneImage(currentRoomData);
  });
  document.getElementById('btn-generate-art').addEventListener('click', generateCustomArt);
}

function renderGameUI() {
  renderStats();
  renderPhaseBanner();
  renderActionBar();
  renderEnemies();
  renderGameParty();
  if (laMap && state.dungeon) laMap.render(state.dungeon);
  updateMapProgress();
}

function renderStats() {
  const p = state.player;
  if (!p) return;
  const cls = CLASSES[p.player_class] || CLASSES.warrior;
  const s = ps(p);
  const hpPct = pctOf(s.health, s.max_health);
  const mpPct = pctOf(s.mana, s.max_mana);
  const xpNeed = [0,100,250,500,900,1400,2000,2700,3500,4500][s.level] || 999;
  const xpPct = pctOf(s.xp || 0, xpNeed);
  const hpLow = hpPct < 25;

  document.getElementById('stats-panel').innerHTML = `
    <div class="stats-header">
      <span class="class-emoji">${cls.emoji}</span>
      <div>
        <h3>${p.name}</h3>
        <p>${cls.name} · Lv ${s.level || 1}</p>
      </div>
    </div>
    <div class="bar-wrap">
      <div class="bar-label"><span>❤️ HP</span><span>${s.health}/${s.max_health}</span></div>
      <div class="bar-track"><div class="bar-fill bar-hp ${hpLow?'low':''}" style="width:${hpPct}%"></div></div>
    </div>
    <div class="bar-wrap">
      <div class="bar-label"><span>💙 MP</span><span>${s.mana}/${s.max_mana}</span></div>
      <div class="bar-track"><div class="bar-fill bar-mp" style="width:${mpPct}%"></div></div>
    </div>
    <div class="bar-wrap">
      <div class="bar-label"><span>⭐ XP</span><span>${s.xp||0}/${xpNeed}</span></div>
      <div class="bar-track" style="height:4px"><div class="bar-fill bar-xp" style="width:${xpPct}%"></div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-label">Gold</div><div class="stat-value stat-gold">💰 ${s.gold||0}</div></div>
      <div class="stat-item"><div class="stat-label">STR</div><div class="stat-value stat-str">${s.strength||0}</div></div>
      <div class="stat-item"><div class="stat-label">INT</div><div class="stat-value stat-int">${s.intelligence||0}</div></div>
      <div class="stat-item"><div class="stat-label">DEX</div><div class="stat-value stat-dex">${s.dexterity||0}</div></div>
    </div>
  `;
}

function renderPhaseBanner() {
  const banner = document.getElementById('phase-banner');
  const phase = state.phase || 'exploring';
  banner.className = `phase-banner ${phase}`;
  document.getElementById('phase-text').textContent = PHASE_LABELS[phase] || phase.toUpperCase();
  document.getElementById('game-time').textContent = `Day ${state.gameDay} · ${String(state.gameHour).padStart(2,'0')}:00`;
}

function renderActionBar() {
  const bar = document.getElementById('action-bar');
  const phase = state.phase || 'exploring';

  if (phase === 'victory' || phase === 'game_over') {
    bar.innerHTML = `
      <button class="btn btn-primary" id="btn-return-lobby">
        ${phase === 'victory' ? '🏆 Return to Lobby' : '💀 Back to Lobby'}
      </button>
    `;
    document.getElementById('btn-return-lobby').addEventListener('click', returnToLobby);
    return;
  }

  if (phase === 'combat') {
    const p = state.player;
    const skills = (p && p.skills) ? p.skills.slice(0, 3) : [];
    const hasPotion = p && p.inventory && p.inventory.some(i => (typeof i === 'string' ? i : i.name || '').includes('health_potion'));

    bar.innerHTML = `
      <div class="action-group">
        <button class="attack-btn" id="btn-attack">⚔️ ATTACK</button>
      </div>
      <div class="action-divider"></div>
      <div class="action-group" id="skill-buttons"></div>
      <div class="action-divider"></div>
      <button class="flee-btn" id="btn-flee">🏃 FLEE</button>
    `;

    document.getElementById('btn-attack').addEventListener('click', () => {
      ws.send('COMBAT_ACTION', { action: 'attack' });
    });
    document.getElementById('btn-flee').addEventListener('click', () => {
      ws.send('COMBAT_ACTION', { action: 'flee' });
    });

    const skillContainer = document.getElementById('skill-buttons');
    skills.forEach(skillKey => {
      const skill = SKILLS[skillKey] || { name: skillKey, emoji: '✨', mp: 0 };
      const p = state.player;
      const canUse = !p || (ps(p).mana >= skill.mp);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.disabled = !canUse;
      btn.innerHTML = `<span>${skill.emoji} ${skill.name}</span><span class="skill-cost">${skill.mp} MP</span>`;
      btn.addEventListener('click', () => {
        ws.send('COMBAT_ACTION', { action: 'skill', skill_name: skillKey });
      });
      skillContainer.appendChild(btn);
    });

    // Potion button if available
    if (p && p.inventory) {
      const potionItem = p.inventory.find(item => {
        const name = typeof item === 'string' ? item : item.name;
        return name && name.includes('health_potion');
      });
      if (potionItem) {
        const potBtn = document.createElement('button');
        potBtn.className = 'skill-btn';
        potBtn.innerHTML = `<span>🧪 Potion</span><span class="skill-cost">use</span>`;
        potBtn.addEventListener('click', () => {
          const name = typeof potionItem === 'string' ? potionItem : potionItem.name;
          ws.send('COMBAT_ACTION', { action: 'use_item', item_id: name });
        });
        skillContainer.appendChild(potBtn);
      }
    }
    return;
  }

  if (phase === 'looting') {
    bar.innerHTML = `
      <button class="btn btn-accent btn-large" id="btn-loot">💰 LOOT THE ROOM</button>
      <span style="color:var(--text-muted);font-size:11px">or continue exploring</span>
    `;
    document.getElementById('btn-loot').addEventListener('click', () => {
      ws.send('LOOT_ROOM', {});
    });
    // Also show direction buttons for already-cleared rooms
    renderDirectionButtons(bar, true);
    return;
  }

  // Exploring (default)
  bar.innerHTML = `<div class="action-group" id="dir-group"></div>`;
  renderDirectionButtons(document.getElementById('dir-group'), false);
}

function renderDirectionButtons(container, append) {
  const dungeon = state.dungeon;
  const currentRoom = dungeon && dungeon.current_room_id ? dungeon.rooms[dungeon.current_room_id] : null;
  const exits = currentRoom ? (currentRoom.exits || {}) : {};

  const dirs = [
    { key: 'north', icon: '↑', label: 'N' },
    { key: 'south', icon: '↓', label: 'S' },
    { key: 'west',  icon: '←', label: 'W' },
    { key: 'east',  icon: '→', label: 'E' },
  ];

  const group = append ? document.createElement('div') : container;
  if (append) {
    group.className = 'action-group';
    container.appendChild(group);
  }

  dirs.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'dir-btn';
    btn.title = d.key.charAt(0).toUpperCase() + d.key.slice(1);
    btn.innerHTML = d.icon;
    btn.disabled = !exits[d.key];
    btn.addEventListener('click', () => ws.send('MOVE', { direction: d.key }));
    group.appendChild(btn);
  });
}

function renderEnemies() {
  const el = document.getElementById('enemy-list');
  const combat = state.combat;
  const phase = state.phase;

  if (!combat || !combat.enemies || phase !== 'combat') {
    el.innerHTML = '<div class="empty-state">The room is clear.</div>';
    document.getElementById('combat-panel-title').textContent = '⚔ Encounter';
    return;
  }

  document.getElementById('combat-panel-title').textContent = `⚔ Combat — Turn ${combat.turn_number || 1}`;

  el.innerHTML = combat.enemies.map(enemy => {
    const hpPct = pctOf(enemy.hp, enemy.max_hp);
    const isDead = enemy.hp <= 0;
    return `
      <div class="enemy-card ${enemy.stunned ? 'stunned' : ''} ${isDead ? 'dead' : ''}" id="enemy-${enemy.id}">
        <div class="enemy-header">
          <span class="enemy-emoji">${enemy.emoji || '👹'}</span>
          <span class="enemy-name">${enemy.name}</span>
          ${enemy.is_boss ? '<span class="enemy-boss-tag">BOSS</span>' : ''}
          ${enemy.stunned ? '<span class="enemy-stun-tag">STUNNED</span>' : ''}
        </div>
        <div class="enemy-hp-bar">
          <div class="enemy-hp-fill" style="width:${hpPct}%"></div>
        </div>
        <div class="enemy-hp-text">${enemy.hp}/${enemy.max_hp} HP · ATK ${enemy.attack} · DEF ${enemy.defense}</div>
      </div>
    `;
  }).join('');
}

function renderGameParty() {
  const el = document.getElementById('game-party-members');
  const party = state.party;
  if (!party || !party.member_ids || party.member_ids.length <= 1) {
    el.innerHTML = '<div class="empty-state" style="font-size:10px">Solo adventure</div>';
    return;
  }
  const p = state.player;
  el.innerHTML = party.member_ids.map(id => {
    const isSelf = id === state.playerId;
    const member = isSelf ? p : null;
    const cls = member ? (CLASSES[member.player_class] || CLASSES.warrior) : { emoji: '👤' };
    const name = member ? member.name : `Player...`;
    const hpPct = member ? pctOf(ps(member).health, ps(member).max_health) : 100;
    return `<div class="game-party-member">
      <div class="gpm-header">
        <span class="gpm-emoji">${cls.emoji}</span>
        <span class="gpm-name">${name}${isSelf ? ' ★' : ''}</span>
      </div>
      <div class="bar-track" style="height:4px">
        <div class="bar-fill bar-hp" style="width:${hpPct}%"></div>
      </div>
    </div>`;
  }).join('');
}

function updateMapProgress() {
  const dungeon = state.dungeon;
  if (!dungeon) return;
  const rooms = Object.values(dungeon.rooms || {});
  const cleared = rooms.filter(r => r.cleared).length;
  document.getElementById('map-progress').textContent = `${cleared}/${rooms.length}`;
}

function returnToLobby() {
  state.dungeon = null;
  state.combat = null;
  state.phase = 'exploring';
  if (laMap) laMap.reset();
  showScreen('lobby');
  renderCurrentParty();
  refreshParties();
}

// ═══════════════════════════════════════════════════════
// NARRATIVE LOG
// ═══════════════════════════════════════════════════════

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function addLog(text, kind = 'narrative') {
  const el = document.getElementById('narrative-log');
  if (!el) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${kind}`;
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  entry.innerHTML = `${renderMarkdown(text)}<span class="log-time">${timeStr}</span>`;
  el.appendChild(entry);

  // Auto-scroll
  el.scrollTop = el.scrollHeight;

  // Keep log manageable
  while (el.children.length > 100) el.removeChild(el.firstChild);
}

// ═══════════════════════════════════════════════════════
// SCENE IMAGE GENERATION (Pollinations.ai)
// ═══════════════════════════════════════════════════════

function generateSceneImage(room) {
  if (!room) return;
  currentRoomData = room;

  const img = document.getElementById('scene-image');
  const loading = document.getElementById('scene-loading');
  const nameEl = document.getElementById('scene-room-name');
  const wrapper = document.getElementById('scene-wrapper');

  const realName = (laMap && laMap.getRoomName(room.id)) || room.name || '';
  nameEl.textContent = realName;
  // Show gradient immediately — image overlays when ready
  wrapper.style.background = roomGradient(room.room_type);
  img.style.display = 'none';
  loading.style.display = 'flex';

  const realName = (laMap && laMap.getRoomName(room.id)) || room.name || '';
  const zoneName = (laMap && laMap.getZoneName()) || 'Los Angeles';
  const roomDesc = room.description || room.name || 'dungeon room';
  const hasEnemies = room.enemies && room.enemies.length > 0;
  const enemyDesc = hasEnemies ? room.enemies.map(e => e.name).join(', ') : '';

  let prompt = `dark fantasy RPG scene at ${realName} in ${zoneName}`;
  if (room.room_type === 'boss') prompt += ', dramatic final boss chamber, ancient evil, purple ominous light';
  else if (room.room_type === 'treasure') prompt += ', hidden treasure vault, gold and gemstones glowing';
  else if (room.room_type === 'start') prompt += ', adventure starting point, torch-lit entrance';
  else prompt += `, ${roomDesc}`;
  if (hasEnemies) prompt += `, ${enemyDesc} creature lurking in shadows`;
  prompt += ', cinematic, atmospheric lighting, concept art, oil painting, wide shot';

  const encoded = encodeURIComponent(prompt);
  const url = `/scene-art?prompt=${encoded}`;

  const showFallback = () => {
    img.classList.remove('loading');
    loading.style.display = 'none';
    img.style.display = 'none';
    document.getElementById('scene-wrapper').style.background = roomGradient(room.room_type);
  };

  // Load image with 20s timeout
  const tempImg = new Image();
  const timeout = setTimeout(showFallback, 20000);
  tempImg.onload = () => {
    clearTimeout(timeout);
    img.src = url;
    img.style.display = '';
    img.style.opacity = '0';
    img.classList.remove('loading');
    loading.style.display = 'none';
    // Fade in over gradient
    requestAnimationFrame(() => {
      img.style.transition = 'opacity 0.8s ease';
      img.style.opacity = '1';
    });
  };
  tempImg.onerror = () => {
    clearTimeout(timeout);
    showFallback();
  };
  tempImg.src = url;
}

function roomGradient(type) {
  const gradients = {
    start:    'radial-gradient(ellipse at 50% 80%, #1a3a1a 0%, #0a1a0a 60%, #050a05 100%)',
    corridor: 'radial-gradient(ellipse at 30% 70%, #1a1a3a 0%, #0d0d20 60%, #080810 100%)',
    chamber:  'radial-gradient(ellipse at 50% 60%, #221535 0%, #130d22 60%, #080810 100%)',
    treasure: 'radial-gradient(ellipse at 50% 80%, #3a2e00 0%, #1f1800 50%, #0a0800 100%)',
    boss:     'radial-gradient(ellipse at 50% 40%, #3a0a4a 0%, #1a0028 50%, #080010 100%)',
  };
  return gradients[type] || gradients.chamber;
}

function generateCustomArt() {
  const promptEl = document.getElementById('art-prompt');
  const prompt = promptEl.value.trim();
  if (!prompt) return;

  const gallery = document.getElementById('art-gallery');
  const fullPrompt = `${prompt}, dark fantasy RPG, dramatic lighting, Los Angeles`;
  const encoded = encodeURIComponent(fullPrompt);
  const url = `/scene-art?prompt=${encoded}`;

  // Add placeholder
  const item = document.createElement('div');
  item.className = 'art-item';
  item.innerHTML = `<div style="height:120px;display:flex;align-items:center;justify-content:center;background:var(--surface2);gap:8px">
    <span class="spinner"></span><span style="font-size:11px;color:var(--text-dim)">Painting...</span>
  </div>`;
  gallery.insertBefore(item, gallery.firstChild);

  const img = new Image();
  img.onload = () => {
    item.innerHTML = '';
    const imgEl = document.createElement('img');
    imgEl.src = url;
    imgEl.style.cssText = 'width:100%;display:block;border-radius:var(--radius)';
    item.appendChild(imgEl);
    // Click to expand
    item.addEventListener('click', () => expandImage(url, prompt));
  };
  img.onerror = () => {
    item.innerHTML = `<div style="padding:12px;font-size:11px;color:var(--red)">Failed to generate image.</div>`;
  };
  img.src = url;

  promptEl.value = '';
}

function expandImage(url, caption) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:pointer';
  overlay.innerHTML = `<img src="${url}" style="max-width:90vw;max-height:80vh;border-radius:8px;border:1px solid var(--border2)">
    <p style="color:var(--text-dim);font-size:12px;max-width:600px;text-align:center">${caption}</p>
    <span style="font-size:11px;color:var(--text-muted)">Click to close</span>`;
  overlay.addEventListener('click', () => document.body.removeChild(overlay));
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════
// INVENTORY MODAL
// ═══════════════════════════════════════════════════════

function openInventory() {
  const p = state.player;
  if (!p) return;

  const items = p.inventory || [];
  const skills = p.skills || [];

  document.getElementById('inventory-items').innerHTML = items.length
    ? items.map(item => {
        const name = typeof item === 'string' ? item : item.name;
        const desc = typeof item === 'object' ? item.description : '';
        const emoji = ITEM_EMOJIS[name] || ITEM_EMOJIS.default;
        const isConsumable = name.includes('potion') || name.includes('bandage');
        return `<div class="item-row">
          <span class="item-emoji">${emoji}</span>
          <div class="item-info">
            <div class="item-name">${formatName(name)}</div>
            ${desc ? `<div class="item-desc">${desc}</div>` : ''}
          </div>
          ${isConsumable && state.phase !== 'combat' ?
            `<button class="btn btn-ghost btn-sm use-item-btn" data-item="${name}">Use</button>` : ''}
        </div>`;
      }).join('')
    : '<div class="empty-state">No items</div>';

  document.getElementById('inventory-skills').innerHTML = skills.map(key => {
    const skill = SKILLS[key] || { name: key, emoji: '✨', mp: 0, desc: '' };
    return `<div class="skill-card">
      <div class="skill-header">
        <span class="skill-emoji">${skill.emoji}</span>
        <span class="skill-name">${skill.name}</span>
        <span class="skill-mp">${skill.mp} MP</span>
      </div>
      <div class="skill-desc">${skill.desc}</div>
    </div>`;
  }).join('');

  // Bind use-item buttons
  document.querySelectorAll('.use-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ws.send('USE_ITEM', { item_name: btn.dataset.item });
      closeInventory();
    });
  });

  document.getElementById('inventory-modal').classList.remove('hidden');
}

function closeInventory() {
  document.getElementById('inventory-modal').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// DAMAGE NUMBER ANIMATION
// ═══════════════════════════════════════════════════════

function showDamageNumber(amount, x, y, type = 'damage') {
  const el = document.createElement('div');
  el.className = `damage-number ${type === 'heal' ? 'heal' : type === 'mana' ? 'mana' : ''}`;
  el.textContent = type === 'damage' ? `-${amount}` : type === 'heal' ? `+${amount}` : `${amount} MP`;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => document.body.removeChild(el), 1200);
}

// ═══════════════════════════════════════════════════════
// WEBSOCKET MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════

function setupHandlers() {

  // Initial welcome (connection established)
  ws.on('SUCCESS', msg => {
    const payload = msg.payload || {};

    // Login response
    if (payload.player) {
      state.player  = payload.player;
      state.playerId = payload.player.id;

      // Check if also in a party
      if (payload.party) {
        state.party = payload.party;
      }
      if (payload.parties) {
        state.parties = payload.parties;
      }

      setLoginStatus('');
      showScreen('lobby');
      renderLobbyPlayer();
      renderCurrentParty();
      refreshParties();
    }

    // Party created / joined
    if (payload.party && !payload.player) {
      state.party = payload.party;
      renderCurrentParty();
    }

    // Party list
    if (payload.parties && !payload.player) {
      state.parties = payload.parties;
      renderPartyList();
    }

    // Left party
    if (payload.left_party) {
      state.party = null;
      renderCurrentParty();
    }

    // Adventure started
    if (payload.dungeon) {
      state.dungeon = payload.dungeon;
      state.phase   = payload.phase || 'exploring';
      if (payload.player) state.player = payload.player;
      showScreen('game');
      renderGameUI();
    }

    // Loot collected
    if (payload.gold_collected !== undefined) {
      if (payload.player) state.player = payload.player;
      addLog(`💰 Collected ${payload.gold_collected} gold and ${payload.items_collected || 0} items!`, 'loot');
      state.phase = 'exploring';
      renderStats();
      renderPhaseBanner();
      renderActionBar();
    }

    // Item used
    if (msg.message && msg.message.includes('used')) {
      if (payload.player) state.player = payload.player;
      addLog(`🧪 ${msg.message}`, 'loot');
      renderStats();
      renderActionBar();
    }
  });

  // State updates
  ws.on('STATE_UPDATE', msg => {
    applyStateUpdate(msg.payload || {});
    if (state.screen === 'game') {
      renderStats();
      renderPhaseBanner();
      renderActionBar();
      renderEnemies();
      renderGameParty();
      if (laMap && state.dungeon) laMap.render(state.dungeon);
      updateMapProgress();
    }
  });

  // New room entered
  ws.on('ROOM_ENTERED', msg => {
    const payload = msg.payload || {};
    applyStateUpdate(payload);

    if (state.screen !== 'game') {
      showScreen('game');
    }

    const room = payload.room;
    if (room) {
      currentRoomData = room;
      sceneImageSeed = Math.floor(Math.random() * 99999);
      generateSceneImage(room);
      if (laMap && state.dungeon) laMap.render(state.dungeon);
      updateMapProgress();
    }

    if (payload.narrative) {
      addLog(payload.narrative, 'narrative');
    }

    renderPhaseBanner();
    renderActionBar();
    renderEnemies();
  });

  // Combat updates
  ws.on('COMBAT_UPDATE', msg => {
    const payload = msg.payload || {};
    applyStateUpdate(payload);

    if (state.screen === 'game') {
      renderStats();
      renderPhaseBanner();
      renderActionBar();
      renderEnemies();
      if (laMap && state.dungeon) laMap.render(state.dungeon);
    }

    // Log combat events
    const log = payload.combat_log || payload.log || [];
    if (typeof log === 'string') {
      addLog(log, 'combat');
    } else if (Array.isArray(log)) {
      log.forEach(entry => addLog(entry, 'combat'));
    }

    // Damage numbers (animate near enemies)
    if (payload.damage_dealt) {
      const enemyEl = document.querySelector('.enemy-card');
      if (enemyEl) {
        const rect = enemyEl.getBoundingClientRect();
        showDamageNumber(payload.damage_dealt, rect.left + rect.width/2, rect.top + 20, 'damage');
        enemyEl.classList.add('hit-flash');
        setTimeout(() => enemyEl.classList.remove('hit-flash'), 400);
      }
    }
    if (payload.damage_taken) {
      const statsEl = document.getElementById('stats-panel');
      if (statsEl) {
        const rect = statsEl.getBoundingClientRect();
        showDamageNumber(payload.damage_taken, rect.left + 80, rect.top + 40, 'damage');
        statsEl.classList.add('hit-flash');
        setTimeout(() => statsEl.classList.remove('hit-flash'), 400);
      }
    }
  });

  // AI DM narrative
  ws.on('DM_RESPONSE', msg => {
    const payload = msg.payload || {};
    const text = payload.narrative || payload.response || payload.text || '';
    if (text) addLog(text, 'narrative');
  });

  // Game events (world events, broadcasts)
  ws.on('GAME_EVENT', msg => {
    const payload = msg.payload || {};
    const event = payload.event || payload.event_type || '';
    const data = payload.data || payload;

    if (event === 'adventure_started') {
      // Server sends dungeon + player + phase here — transition to game
      if (payload.dungeon) {
        state.dungeon = payload.dungeon;
        state.phase   = payload.phase || 'exploring';
        if (payload.player) state.player = payload.player;
        if (payload.party)  state.party  = payload.party;
        showScreen('game');
        renderGameUI();

        // Load the starting room scene image and log
        const startRoom = payload.dungeon.rooms && payload.dungeon.rooms[payload.dungeon.current_room_id];
        if (startRoom) {
          currentRoomData = startRoom;
          sceneImageSeed = Math.floor(Math.random() * 99999);
          generateSceneImage(startRoom);
          document.getElementById('scene-room-name').textContent = startRoom.name || '';
        }
      }
      if (payload.narrative) addLog(payload.narrative, 'narrative');
      addLog(`🗡️ The adventure begins! Use the arrow buttons to explore.`, 'system');
    } else if (event === 'player_joined') {
      addLog(`👤 ${data.player_name || 'A hero'} joined the party!`, 'system');
    } else if (event === 'player_left') {
      addLog(`💨 ${data.player_name || 'A hero'} left.`, 'system');
    } else if (payload.message) {
      addLog(payload.message, 'system');
    }

    if (payload.party) {
      state.party = payload.party;
      if (state.screen === 'lobby') renderCurrentParty();
      if (state.screen === 'game') renderGameParty();
    }
  });

  // Errors
  ws.on('ERROR', msg => {
    const payload = msg.payload || {};
    const errText = payload.error || payload.message || 'Unknown error';
    if (state.screen === 'login') {
      showLoginError(errText);
      setLoginStatus('');
      document.getElementById('btn-login').disabled = false;
    } else if (state.screen === 'game') {
      addLog(`⚠️ ${errText}`, 'error');
    } else {
      lobbyToast(`⚠️ ${errText}`);
    }
  });

  // Heartbeat response (has game time)
  ws.on('SUCCESS', msg => {
    const payload = msg.payload || {};
    if (payload.game_day !== undefined) {
      state.gameDay  = payload.game_day;
      state.gameHour = payload.game_hour || 0;
      if (state.screen === 'game') renderPhaseBanner();
    }
  });

  // WS disconnect
  ws.onDisconnect = () => {
    if (state.screen === 'game') {
      addLog('🔌 Disconnected from server.', 'error');
    }
  };
}

// ═══════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════

function pctOf(val, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round((val / max) * 100)));
}

function formatName(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════

function boot() {
  setupHandlers();
  initLogin();
  initLobby();
  initGame();
  showScreen('login');
}

document.addEventListener('DOMContentLoaded', boot);
