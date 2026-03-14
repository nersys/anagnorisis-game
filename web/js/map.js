/**
 * Canvas-based dungeon map renderer
 * Draws rooms, corridors, current position, and status indicators
 */

const ROOM_COLORS = {
  start:    { bg: '#1a2a1a', border: '#43a047' },
  corridor: { bg: '#1a1a2a', border: '#2a2a60' },
  chamber:  { bg: '#1e1a2e', border: '#4a3a80' },
  treasure: { bg: '#2a2000', border: '#c9a84c' },
  boss:     { bg: '#2a0a0a', border: '#7c3aed' },
  default:  { bg: '#141428', border: '#2a2a50' },
};

const ROOM_ICONS = {
  start:    '🚪',
  corridor: '🏚',
  chamber:  '🏛',
  treasure: '💰',
  boss:     '💀',
};

export class MapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._animFrame = 0;
    this._pulse = 0;
    this._animating = false;
  }

  render(dungeon) {
    if (!dungeon || !dungeon.rooms) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, W, H);

    const rooms = Object.values(dungeon.rooms);
    if (!rooms.length) return;

    // Find bounds
    const xs = rooms.map(r => r.x);
    const ys = rooms.map(r => r.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const gridW = Math.max(maxX - minX + 1, 1);
    const gridH = Math.max(maxY - minY + 1, 1);
    const padding = 20;
    const cellSize = Math.min(
      Math.floor((W - padding * 2) / gridW),
      Math.floor((H - padding * 2) / gridH),
      52
    );
    const offsetX = (W - cellSize * gridW) / 2;
    const offsetY = (H - cellSize * gridH) / 2;

    const toScreen = (rx, ry) => ({
      x: offsetX + (rx - minX) * cellSize + cellSize / 2,
      y: offsetY + (ry - minY) * cellSize + cellSize / 2,
    });

    // Draw connections first
    rooms.forEach(room => {
      const from = toScreen(room.x, room.y);
      Object.entries(room.exits || {}).forEach(([dir, targetId]) => {
        const target = dungeon.rooms[targetId];
        if (!target) return;
        const to = toScreen(target.x, target.y);
        const explored = room.explored && target.explored;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = explored ? '#2a2a60' : '#161630';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    });

    // Draw rooms
    rooms.forEach(room => {
      const pos = toScreen(room.x, room.y);
      const isCurrent = room.id === dungeon.current_room_id;
      const size = cellSize * 0.52;
      const half = size / 2;

      if (!room.explored) {
        // Unexplored: dim square
        ctx.fillStyle = '#0f0f1f';
        ctx.strokeStyle = '#1a1a30';
        ctx.lineWidth = 1;
        this._roundRect(ctx, pos.x - half, pos.y - half, size, size, 4);
        ctx.fill(); ctx.stroke();
        // Question mark
        ctx.fillStyle = '#2a2a4a';
        ctx.font = `${size * 0.45}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', pos.x, pos.y);
        return;
      }

      const colors = ROOM_COLORS[room.room_type] || ROOM_COLORS.default;

      // Glow for current room
      if (isCurrent) {
        ctx.shadowColor = '#c9a84c';
        ctx.shadowBlur = 12 + Math.sin(this._pulse) * 4;
      }

      // Room background
      ctx.fillStyle = colors.bg;
      ctx.strokeStyle = isCurrent ? '#c9a84c' : colors.border;
      ctx.lineWidth = isCurrent ? 2 : 1;
      this._roundRect(ctx, pos.x - half, pos.y - half, size, size, 4);
      ctx.fill(); ctx.stroke();

      ctx.shadowBlur = 0;

      // Room icon
      ctx.font = `${size * 0.42}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ROOM_ICONS[room.room_type] || '❓', pos.x, pos.y - 2);

      // Status dots
      const hasEnemies = room.enemies && room.enemies.some(e => !e.defeated && e.hp > 0);
      const hasLoot = !room.cleared && room.gold > 0;

      if (hasEnemies) {
        ctx.beginPath();
        ctx.arc(pos.x + half - 5, pos.y - half + 5, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#e53935';
        ctx.fill();
      }
      if (hasLoot && room.cleared) {
        ctx.beginPath();
        ctx.arc(pos.x + half - 5, pos.y + half - 5, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#43a047';
        ctx.fill();
      }

      // Current position marker
      if (isCurrent) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#c9a84c';
        ctx.fillText('@', pos.x, pos.y + half - 4);
      }

      // Cleared dim
      if (room.cleared && !isCurrent) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        this._roundRect(ctx, pos.x - half, pos.y - half, size, size, 4);
        ctx.fill();
      }
    });
  }

  startAnimation() {
    if (this._animating) return;
    this._animating = true;
    const tick = () => {
      this._pulse += 0.05;
      if (this._animating) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stopAnimation() {
    this._animating = false;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}
