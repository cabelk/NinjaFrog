/* eslint-disable no-console */
(() => {
  'use strict';

  /**
   * Game intent (current prototype):
   * - You are on a small grid.
   * - Enemies spawn on the edges over time.
   * - You move 1 cell per input (8 directions).
   * - You attack 1 adjacent cell per input (8 directions). If an enemy is there, it dies.
   * - If you step onto an enemy, you die.
   * - After N kills (within a generous window), your character skin flashes and changes.
   */

  // -------------------------
  // Tunables
  // -------------------------
  const CONFIG = Object.freeze({
    grid: { w: 6, h: 5 },
    tilePx: 72,
    // How much smaller entities are than a tile (tight board = low inset).
    // This directly affects the "black gaps" you were seeing between occupied squares.
    entityInsetPct: 0.002, // 0.2% per side

    enemy: {
      spawnMs: 550,
      max: 10,
      color: 0xff5d6c
    },

    flashReward: {
      killsRequired: 5,
      windowMs: 60 * 60 * 1000, // 1 hour (effectively no pressure)
      durationMs: 150,
      scaleOfMinWorldDim: 0.55
    },

    // Keep all filenames lowercase to avoid case-sensitive deploy failures (GitHub Pages).
    images: [
      'images/flash1.png',
      'images/flash2.png',
      'images/flash3.png'
    ],

    // Subtle board styling to reduce "empty black" between tiles.
    board: {
      tileFill: 0x111824,
      tileFillAlpha: 1,
      gridLine: 0x1f2a36,
      gridLineAlpha: 1,
      gridLineWidth: 1
    }
  });

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cellKey = (x, y) => `${x},${y}`;
  const isAdjacent = (dx, dy) => (dx !== 0 || dy !== 0) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1;

  const WORLD_W = CONFIG.grid.w * CONFIG.tilePx;
  const WORLD_H = CONFIG.grid.h * CONFIG.tilePx;

  const TILE_INSET = CONFIG.entityInsetPct;
  const ENTITY_SIZE = CONFIG.tilePx * (1 - TILE_INSET * 2);

  // -------------------------
  // UI / Input plumbing
  // -------------------------
  const statusEl = document.getElementById('status');
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

  // Centralized input queues (one input == one action). This keeps gameplay deterministic.
  const inputState = {
    moveQueue: /** @type {{dx:number,dy:number}[]} */ ([]),
    attackQueue: /** @type {{dx:number,dy:number}[]} */ ([])
  };

  // Prevent browser gestures from interfering with pads on mobile.
  // Limit it to the HUD so the page remains well-behaved.
  const hudEl = document.getElementById('hud');
  if (hudEl) {
    hudEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  const wirePadButtons = (selector, attr, queue) => {
    document.querySelectorAll(selector).forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const raw = /** @type {HTMLElement} */ (btn).getAttribute(attr);
        if (!raw) return;
        const [dx, dy] = raw.split(',').map(Number);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        queue.push({ dx, dy });
      }, { passive: false });
    });
  };

  wirePadButtons('[data-move]', 'data-move', inputState.moveQueue);
  wirePadButtons('[data-atk]', 'data-atk', inputState.attackQueue);

  // We will replace hard reload with a scene restart.
  const restartBtn = document.getElementById('restart');

  // -------------------------
  // Asset keys
  // -------------------------
  const keyForImagePath = (path) => {
    const base = path.split('/').pop().split('.')[0];
    return `flash_${base}`; // e.g., images/flash2.png -> flash_flash2
  };

  // -------------------------
  // Scene
  // -------------------------
  class MainScene extends Phaser.Scene {
    constructor() {
      super({ key: 'main' });

      this.playerCell = { x: 0, y: 0 };
      this.player = null;
      this.playerSprite = null;

      /** @type {Map<string, Phaser.GameObjects.Rectangle>} */
      this.enemies = new Map();

      this.dead = false;
      this.kills = 0;
      this.startTime = 0;

      /** @type {number[]} */
      this.killTimes = [];

      this.gridGfx = null;
      this.attackFlash = null;
      this.centerFlash = null;

      /** @type {string[]} */
      this.flashKeys = [];

      this.spawnTimer = null;
    }

    preload() {
      // Surface asset load failures (common on static hosting due to path/case).
      this.load.on('loaderror', (file) => {
        setStatus(`ASSET LOAD ERROR: ${file.key} (${file.src || file.url || ''})`);
      });

      this.flashKeys = [];
      for (const p of CONFIG.images) {
        const k = keyForImagePath(p);
        this.flashKeys.push(k);
        this.load.image(k, p);
      }
    }

    create() {
      this.cameras.main.setBackgroundColor('#0b0f14');
      this.cameras.main.setRoundPixels(true);

      // Resize + zoom to fit the world.
      this.scale.on('resize', (gameSize) => {
        this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
        this.fitWorldToScreen(gameSize.width, gameSize.height);
      });
      this.fitWorldToScreen(this.scale.width, this.scale.height);

      // Board graphics
      this.gridGfx = this.add.graphics();
      this.drawBoard();

      // Player starts centered
      this.playerCell = {
        x: Math.floor(CONFIG.grid.w / 2),
        y: Math.floor(CONFIG.grid.h / 2)
      };

      const px = this.cellToWorldX(this.playerCell.x);
      const py = this.cellToWorldY(this.playerCell.y);

      this.player = this.add.container(px, py);
      this.player.setDepth(10);

      const initialKey = this.flashKeys.includes('flash_flash2') ? 'flash_flash2' : (this.flashKeys[0] || null);
      if (!initialKey) {
        setStatus('ERROR: no images configured/loaded.');
        return;
      }

      this.playerSprite = this.add.image(0, 0, initialKey);
      this.player.add(this.playerSprite);
      this.updatePlayerSpriteTexture(initialKey);

      // Attack line flash
      this.attackFlash = this.add.graphics();
      this.attackFlash.setDepth(50);

      // Center flash image (hidden)
      this.centerFlash = this.add.image(this.player.x, this.player.y, initialKey);
      this.centerFlash.setVisible(false);
      this.centerFlash.setDepth(9999);
      this.centerFlash.setOrigin(0.5, 0.5);
      this.centerFlash.setScrollFactor(1);

      // Run state
      this.dead = false;
      this.kills = 0;
      this.killTimes = [];
      this.startTime = performance.now();
      setStatus(this.statusLine());

      // Enemy spawns
      this.spawnTimer = this.time.addEvent({
        delay: CONFIG.enemy.spawnMs,
        loop: true,
        callback: this.spawnEnemyEdge,
        callbackScope: this
      });

      // Restart button -> restart scene (no hard reload)
      if (restartBtn) {
        restartBtn.onclick = () => this.scene.restart();
      }

      // Optional: basic keyboard support for desktop testing
      this.cursors = this.input.keyboard?.createCursorKeys?.() || null;
      this.keyW = this.input.keyboard?.addKey?.(Phaser.Input.Keyboard.KeyCodes.W) || null;
      this.keyA = this.input.keyboard?.addKey?.(Phaser.Input.Keyboard.KeyCodes.A) || null;
      this.keyS = this.input.keyboard?.addKey?.(Phaser.Input.Keyboard.KeyCodes.S) || null;
      this.keyD = this.input.keyboard?.addKey?.(Phaser.Input.Keyboard.KeyCodes.D) || null;
      this.keySpace = this.input.keyboard?.addKey?.(Phaser.Input.Keyboard.KeyCodes.SPACE) || null;
    }

    fitWorldToScreen(w, h) {
      const zoom = Math.min(w / WORLD_W, h / WORLD_H);
      const cam = this.cameras.main;
      cam.setZoom(zoom);
      cam.centerOn(WORLD_W / 2, WORLD_H / 2);
    }

    drawBoard() {
      const g = this.gridGfx;
      if (!g) return;

      g.clear();

      // Fill tiles so the board looks tight and "not empty black".
      g.fillStyle(CONFIG.board.tileFill, CONFIG.board.tileFillAlpha);
      for (let y = 0; y < CONFIG.grid.h; y++) {
        for (let x = 0; x < CONFIG.grid.w; x++) {
          g.fillRect(x * CONFIG.tilePx, y * CONFIG.tilePx, CONFIG.tilePx, CONFIG.tilePx);
        }
      }

      // Grid lines on top.
      g.lineStyle(CONFIG.board.gridLineWidth, CONFIG.board.gridLine, CONFIG.board.gridLineAlpha);
      g.strokeRect(0, 0, WORLD_W, WORLD_H);
      for (let x = 1; x < CONFIG.grid.w; x++) g.lineBetween(x * CONFIG.tilePx, 0, x * CONFIG.tilePx, WORLD_H);
      for (let y = 1; y < CONFIG.grid.h; y++) g.lineBetween(0, y * CONFIG.tilePx, WORLD_W, y * CONFIG.tilePx);
    }

    cellToWorldX(cx) { return cx * CONFIG.tilePx + CONFIG.tilePx / 2; }
    cellToWorldY(cy) { return cy * CONFIG.tilePx + CONFIG.tilePx / 2; }

    statusLine(extra = '') {
      const elapsedSec = (performance.now() - this.startTime) / 1000;
      const t = elapsedSec.toFixed(1);
      const kps = (this.kills / Math.max(0.001, elapsedSec)).toFixed(2);
      return `Kills: ${this.kills} | Time: ${t}s | KPS: ${kps} | Enemies: ${this.enemies.size}${extra ? ' | ' + extra : ''}`;
    }

    die(reason) {
      this.dead = true;
      setStatus(this.statusLine(`DEAD: ${reason}. Tap Restart.`));

      if (this.spawnTimer) this.spawnTimer.paused = true;

      if (this.playerSprite?.setTint) this.playerSprite.setTint(0x3b4b5c);
      if (this.playerSprite?.setAlpha) this.playerSprite.setAlpha(0.85);
    }

    spawnEnemyEdge() {
      if (this.dead) return;
      if (this.enemies.size >= CONFIG.enemy.max) return;

      for (let tries = 0; tries < 70; tries++) {
        const side = Phaser.Math.Between(0, 3);
        let x, y;
        if (side === 0) { x = Phaser.Math.Between(0, CONFIG.grid.w - 1); y = 0; }
        else if (side === 1) { x = CONFIG.grid.w - 1; y = Phaser.Math.Between(0, CONFIG.grid.h - 1); }
        else if (side === 2) { x = Phaser.Math.Between(0, CONFIG.grid.w - 1); y = CONFIG.grid.h - 1; }
        else { x = 0; y = Phaser.Math.Between(0, CONFIG.grid.h - 1); }

        if (x === this.playerCell.x && y === this.playerCell.y) continue;

        const k = cellKey(x, y);
        if (this.enemies.has(k)) continue;

        const enemy = this.add.rectangle(
          this.cellToWorldX(x),
          this.cellToWorldY(y),
          ENTITY_SIZE,
          ENTITY_SIZE,
          CONFIG.enemy.color
        );
        enemy.setDepth(20);

        this.enemies.set(k, enemy);
        setStatus(this.statusLine());
        return;
      }
    }

    tryMove(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      const nx = clamp(this.playerCell.x + dx, 0, CONFIG.grid.w - 1);
      const ny = clamp(this.playerCell.y + dy, 0, CONFIG.grid.h - 1);
      if (nx === this.playerCell.x && ny === this.playerCell.y) return;

      const k = cellKey(nx, ny);
      if (this.enemies.has(k)) {
        // Move into the cell (so the death feels immediate and consistent), then die.
        this.playerCell = { x: nx, y: ny };
        this.player?.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
        this.die('stepped onto enemy');
        return;
      }

      this.playerCell = { x: nx, y: ny };
      this.player?.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
      setStatus(this.statusLine());
    }

    playAttackFlash(dx, dy) {
      if (!this.attackFlash) return;

      const x0 = this.cellToWorldX(this.playerCell.x);
      const y0 = this.cellToWorldY(this.playerCell.y);
      const x1 = x0 + dx * CONFIG.tilePx * 0.95;
      const y1 = y0 + dy * CONFIG.tilePx * 0.95;

      this.attackFlash.clear();
      this.attackFlash.alpha = 1;
      this.attackFlash.lineStyle(6, 0xf7f2a0, 1);
      this.attackFlash.lineBetween(x0, y0, x1, y1);

      this.tweens.add({
        targets: this.attackFlash,
        alpha: 0,
        duration: 55,
        onComplete: () => {
          this.attackFlash?.clear();
          if (this.attackFlash) this.attackFlash.alpha = 1;
        }
      });
    }

    updatePlayerSpriteTexture(key) {
      // Swap player texture and apply cover scale + centered square crop.
      if (!this.playerSprite || !key) return;
      if (!this.textures.exists(key)) return;

      // Clear any previous crop before measuring.
      this.playerSprite.setCrop();

      const tex = this.textures.get(key);
      const src = tex?.getSourceImage?.();
      const texW = (src && src.width) ? src.width : (this.playerSprite.width || 1);
      const texH = (src && src.height) ? src.height : (this.playerSprite.height || 1);

      this.playerSprite.setTexture(key);

      const target = ENTITY_SIZE;
      const sCover = Math.max(target / texW, target / texH);
      this.playerSprite.setScale(sCover);

      const cropW = target / sCover;
      const cropH = target / sCover;
      const cropX = (texW - cropW) / 2;
      const cropY = (texH - cropH) / 2;

      this.playerSprite.setCrop(cropX, cropY, cropW, cropH);
    }

    flashRandomImage() {
      if (!this.flashKeys.length || !this.centerFlash) return;

      const key = Phaser.Utils.Array.GetRandom(this.flashKeys);
      this.updatePlayerSpriteTexture(key);

      const minDim = Math.min(WORLD_W, WORLD_H);
      const target = minDim * CONFIG.flashReward.scaleOfMinWorldDim;

      this.centerFlash.setTexture(key);
      this.centerFlash.setPosition(this.player.x, this.player.y);
      this.centerFlash.setVisible(true);
      this.centerFlash.setAlpha(0.98);

      const w = this.centerFlash.width || 1;
      const h = this.centerFlash.height || 1;
      const s = target / Math.max(w, h);
      this.centerFlash.setScale(s * 0.90);

      this.tweens.add({
        targets: this.centerFlash,
        scale: s,
        duration: 30,
        ease: 'Quad.out'
      });

      this.time.delayedCall(CONFIG.flashReward.durationMs, () => {
        if (this.centerFlash) this.centerFlash.setVisible(false);
      });
    }

    recordKillAndMaybeFlash() {
      const now = performance.now();
      this.killTimes.push(now);

      const cutoff = now - CONFIG.flashReward.windowMs;
      while (this.killTimes.length && this.killTimes[0] < cutoff) this.killTimes.shift();

      if (this.killTimes.length >= CONFIG.flashReward.killsRequired) {
        this.killTimes = [];
        this.flashRandomImage();
      }
    }

    tryAttack(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      this.playAttackFlash(dx, dy);

      const tx = this.playerCell.x + dx;
      const ty = this.playerCell.y + dy;
      if (tx < 0 || tx >= CONFIG.grid.w || ty < 0 || ty >= CONFIG.grid.h) {
        setStatus(this.statusLine('edge'));
        return;
      }

      const k = cellKey(tx, ty);
      const enemy = this.enemies.get(k);
      if (enemy) {
        enemy.destroy();
        this.enemies.delete(k);
        this.kills += 1;
        this.recordKillAndMaybeFlash();
        setStatus(this.statusLine('HIT'));
      } else {
        setStatus(this.statusLine('miss'));
      }
    }

    pollKeyboard() {
      if (!this.cursors) return;

      // Movement (WASD / arrows)
      const up = this.cursors.up?.isDown || this.keyW?.isDown;
      const down = this.cursors.down?.isDown || this.keyS?.isDown;
      const left = this.cursors.left?.isDown || this.keyA?.isDown;
      const right = this.cursors.right?.isDown || this.keyD?.isDown;

      // Only enqueue on edge (key down event) would be nicer, but this is adequate for quick desktop testing.
      // To avoid spamming moves, require the key to be "just down".
      const just = Phaser.Input.Keyboard.JustDown;
      const kUp = this.cursors.up || this.keyW;
      const kDown = this.cursors.down || this.keyS;
      const kLeft = this.cursors.left || this.keyA;
      const kRight = this.cursors.right || this.keyD;

      const wantsMove = (just(kUp) || just(kDown) || just(kLeft) || just(kRight));
      if (wantsMove) {
        const dx = (right ? 1 : 0) + (left ? -1 : 0);
        const dy = (down ? 1 : 0) + (up ? -1 : 0);
        if (isAdjacent(dx, dy)) inputState.moveQueue.push({ dx, dy });
      }

      // Attack (space attacks in last move direction; default north)
      if (this.keySpace && just(this.keySpace)) {
        // Reuse the last movement direction if available.
        const last = inputState.moveQueue.length ? inputState.moveQueue[inputState.moveQueue.length - 1] : { dx: 0, dy: -1 };
        inputState.attackQueue.push({ dx: last.dx || 0, dy: last.dy || -1 });
      }
    }

    update() {
      // Desktop convenience
      this.pollKeyboard();

      if (!this.dead && inputState.moveQueue.length) {
        const { dx, dy } = inputState.moveQueue.shift();
        this.tryMove(dx, dy);
      }
      if (!this.dead && inputState.attackQueue.length) {
        const { dx, dy } = inputState.attackQueue.shift();
        this.tryAttack(dx, dy);
      }
    }
  }

  // -------------------------
  // Bootstrap
  // -------------------------
  const config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#0b0f14',
    scene: [MainScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    }
  };

  /** @type {Phaser.Game | null} */
  let game = null;

  const start = () => {
    try {
      game = new Phaser.Game(config);
      setStatus('Ready');
    } catch (err) {
      console.error(err);
      setStatus(`ERROR: ${err?.message || String(err)}`);
    }
  };

  window.addEventListener('resize', () => {
    try {
      if (game?.scale) game.scale.resize(window.innerWidth, window.innerHeight);
    } catch (_) {
      // ignore
    }
  });

  // Global error surface (helps on mobile where console is inaccessible).
  window.addEventListener('error', (e) => {
    setStatus(`ERROR: ${e.message || 'unknown error'}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
    setStatus(`ERROR: ${msg}`);
  });

  start();
})();
