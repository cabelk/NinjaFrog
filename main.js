(() => {
  // --- Tunables ---
  const TILE = 36;                 // grid pixel size
  const GRID_W = 13;               // columns
  const GRID_H = 13;               // rows
  const ENEMY_SPAWN_MS = 550;      // spawn pace
  const MAX_ENEMIES = 22;

  const WORLD_W = GRID_W * TILE;
  const WORLD_H = GRID_H * TILE;

  // --- Input state shared between UI and game ---
  const inputState = {
    moveQueue: [],       // one-step-per-tap
    attackQueue: [],     // queued attacks (dx,dy)
  };

  // Disable browser gestures / scrolling during play
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // Movement wheel buttons
  document.querySelectorAll("[data-move]").forEach(btn => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const [dx, dy] = btn.dataset.move.split(",").map(Number);
      inputState.moveQueue.push({ dx, dy });
    }, { passive: false });
  });

  // Attack wheel buttons (8 individual directions)
  document.querySelectorAll("[data-atk]").forEach(btn => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const [dx, dy] = btn.dataset.atk.split(",").map(Number);
      inputState.attackQueue.push({ dx, dy });
    }, { passive: false });
  });

  // Restart
  document.getElementById("restart").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    window.location.reload();
  }, { passive: false });

  const statusEl = document.getElementById("status");
  function setStatus(text) { statusEl.textContent = text; }

  // --- Helpers ---
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function cellKey(x, y) { return `${x},${y}`; }
  function isAdjacent(dx, dy) {
    return (dx !== 0 || dy !== 0) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
  }
  function isEdgeCell(x, y) {
    return x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
  }

  class MainScene extends Phaser.Scene {
    constructor() {
      super("main");
      this.player = null;
      this.playerCell = { x: 0, y: 0 };
      this.enemies = new Map();   // key -> sprite
      this.kills = 0;
      this.startTime = 0;
      this.dead = false;

      this.attackFlash = null;    // graphics reused
    }

    create() {
      this.cameras.main.setBackgroundColor("#0b0f14");

      // Make canvas fit the screen (including landscape) while preserving aspect ratio.
      this.scale.resize(window.innerWidth, window.innerHeight);
      this.scale.on('resize', (gameSize) => {
        this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
        this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
      });

      // World camera zoom to fit
      this.fitWorldToScreen();

      // Grid visuals
      this.gridGfx = this.add.graphics();
      this.drawGrid();

      // Player starts center
      this.playerCell = { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) };
      this.player = this.add.rectangle(
        this.cellToWorldX(this.playerCell.x),
        this.cellToWorldY(this.playerCell.y),
        TILE * 0.70,
        TILE * 0.70,
        0x5dd6ff
      );

      // Attack flash graphics
      this.attackFlash = this.add.graphics();

      // Game state
      this.kills = 0;
      this.startTime = performance.now();
      this.dead = false;
      setStatus(this.statusLine());

      // Spawn timer (edge spawns only)
      this.time.addEvent({
        delay: ENEMY_SPAWN_MS,
        loop: true,
        callback: () => {
          if (!this.dead) this.spawnEnemyEdge();
        }
      });
    }

    fitWorldToScreen() {
      const w = window.innerWidth;
      const h = window.innerHeight;

      const scaleX = w / WORLD_W;
      const scaleY = h / WORLD_H;
      const s = Math.min(scaleX, scaleY);

      const cam = this.cameras.main;
      cam.setZoom(s);
      cam.centerOn(WORLD_W / 2, WORLD_H / 2);
    }

    drawGrid() {
      this.gridGfx.clear();
      this.gridGfx.lineStyle(1, 0x1f2a36, 1);
      this.gridGfx.strokeRect(0, 0, WORLD_W, WORLD_H);

      for (let x = 1; x < GRID_W; x++) this.gridGfx.lineBetween(x * TILE, 0, x * TILE, WORLD_H);
      for (let y = 1; y < GRID_H; y++) this.gridGfx.lineBetween(0, y * TILE, WORLD_W, y * TILE);
    }

    cellToWorldX(cx) { return cx * TILE + TILE / 2; }
    cellToWorldY(cy) { return cy * TILE + TILE / 2; }

    statusLine(extra = "") {
      const t = ((performance.now() - this.startTime) / 1000).toFixed(1);
      const kps = (this.kills / Math.max(0.001, (performance.now() - this.startTime) / 1000)).toFixed(2);
      return `Kills: ${this.kills} | Time: ${t}s | KPS: ${kps} | Enemies: ${this.enemies.size}${extra ? " | " + extra : ""}`;
    }

    // Spawn enemies only on the perimeter
    spawnEnemyEdge() {
      if (this.enemies.size >= MAX_ENEMIES) return;

      // Precompute random edge pick: choose a side then coordinate
      for (let tries = 0; tries < 60; tries++) {
        const side = Phaser.Math.Between(0, 3); // 0 top, 1 right, 2 bottom, 3 left
        let x, y;
        if (side === 0) { x = Phaser.Math.Between(0, GRID_W - 1); y = 0; }
        else if (side === 1) { x = GRID_W - 1; y = Phaser.Math.Between(0, GRID_H - 1); }
        else if (side === 2) { x = Phaser.Math.Between(0, GRID_W - 1); y = GRID_H - 1; }
        else { x = 0; y = Phaser.Math.Between(0, GRID_H - 1); }

        // Avoid player cell
        if (x === this.playerCell.x && y === this.playerCell.y) continue;

        const k = cellKey(x, y);
        if (this.enemies.has(k)) continue;

        const enemy = this.add.rectangle(
          this.cellToWorldX(x),
          this.cellToWorldY(y),
          TILE * 0.68,
          TILE * 0.68,
          0xff5d6c
        );
        this.enemies.set(k, enemy);
        setStatus(this.statusLine());
        return;
      }
    }

    die(reason) {
      this.dead = true;
      setStatus(this.statusLine(`DEAD: ${reason}. Tap Restart.`));
      this.player.setFillStyle(0x3b4b5c);
    }

    tryMove(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      const nx = clamp(this.playerCell.x + dx, 0, GRID_W - 1);
      const ny = clamp(this.playerCell.y + dy, 0, GRID_H - 1);
      if (nx === this.playerCell.x && ny === this.playerCell.y) return;

      const k = cellKey(nx, ny);
      if (this.enemies.has(k)) {
        // You stepped onto enemy before killing it
        this.playerCell = { x: nx, y: ny };
        this.player.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
        this.die("stepped onto enemy");
        return;
      }

      this.playerCell = { x: nx, y: ny };
      this.player.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
      setStatus(this.statusLine());
    }

    // 1-2 frame-ish attack flash in direction (very short lifetime)
    playAttackFlash(dx, dy) {
      const x0 = this.cellToWorldX(this.playerCell.x);
      const y0 = this.cellToWorldY(this.playerCell.y);
      const x1 = x0 + dx * TILE * 0.95;
      const y1 = y0 + dy * TILE * 0.95;

      this.attackFlash.clear();
      this.attackFlash.lineStyle(6, 0xf7f2a0, 1);
      this.attackFlash.lineBetween(x0, y0, x1, y1);

      // Fade quickly (about 2 frames at 60hz ~= 33ms; use 45ms to be visible)
      this.tweens.add({
        targets: this.attackFlash,
        alpha: 0,
        duration: 55,
        onComplete: () => {
          this.attackFlash.clear();
          this.attackFlash.alpha = 1;
        }
      });
    }

    tryAttack(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      this.playAttackFlash(dx, dy);

      const tx = this.playerCell.x + dx;
      const ty = this.playerCell.y + dy;

      if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) {
        setStatus(this.statusLine("Attack: edge"ানি));
        return;
      }

      const k = cellKey(tx, ty);
      const enemy = this.enemies.get(k);
      if (enemy) {
        enemy.destroy();
        this.enemies.delete(k);
        this.kills += 1;
        setStatus(this.statusLine("HIT")); 
      } else {
        setStatus(this.statusLine("miss")); 
      }
    }

    update() {
      // Fit camera if device rotates
      // (Phaser resize events can be inconsistent across mobile browsers, so this is a safe backstop)
      // Only recompute if needed (cheap anyway).
      // Note: you can remove if you see jitter.
      // this.fitWorldToScreen();

      if (!this.dead && inputState.moveQueue.length > 0) {
        const { dx, dy } = inputState.moveQueue.shift();
        this.tryMove(dx, dy);
      }

      if (!this.dead && inputState.attackQueue.length > 0) {
        const { dx, dy } = inputState.attackQueue.shift();
        this.tryAttack(dx, dy);
      }
    }
  }

  const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#0b0f14",
    scene: [MainScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    }
  };

  window.addEventListener('resize', () => {
    // Phaser RESIZE handles this, but calling resize helps some mobile browsers.
    try {
      const game = Phaser.GAMES[0];
      if (game && game.scale) game.scale.resize(window.innerWidth, window.innerHeight);
    } catch (_) {}
  });

  new Phaser.Game(config);
})();
