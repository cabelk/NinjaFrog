(() => {
  // Movement slide cooldown (ms)
  const MOVE_COOLDOWN_MS = 140;

  const TILE = 72; // doubled tile size (larger squares)
  const TILE_INSET = 0.01; // 1% padding per side inside each tile (very tight)
  const ENTITY_SIZE = TILE * (1 - TILE_INSET * 2); // size of sprites/enemies inside a tile // doubled tile size (larger squares)
  const GRID_W = 6; // 13 -> remove 2 rows (13x11) then halve columns -> 6 // 13 -> remove 2 rows (13x11) then halve columns -> 6
  const GRID_H = 5; // 13 -> 11 -> halve rows -> 5 // 13 -> 11 -> halve rows -> 5
  const ENEMY_SPAWN_MS = 550;
  const MAX_ENEMIES = 10;

  // Reward flash settings
  const FLASH_KILLS_REQUIRED = 5;
  const FLASH_WINDOW_MS = 3600000; // 1 hour window (effectively no time limit)
  const FLASH_DURATION_MS = 150;   // ~9 frames at 60Hz (50% longer)   // ~6 frames at 60Hz
  const FLASH_SCALE = 0.55;

  // Put your images in /images and list them here.
  const INITIAL_PLAYER_KEY = "flash_flash2";

  const FLASH_IMAGES = [
    "images/flash1.png",
    "images/flash2.png",
    "images/flash3.png"
  ];

  const WORLD_W = GRID_W * TILE;
  const WORLD_H = GRID_H * TILE;

  const inputState = { moveQueue: [], attackQueue: [] };


// ===== Slide / Gesture Controls (thumb-drag) =====
function directionFromDelta(dx, dy, deadZone = 12) {
  const mag = Math.hypot(dx, dy);
  if (mag < deadZone) return null;

  const angle = Math.atan2(dy, dx); // screen-space: +y down
  const oct = Math.round((8 * angle) / (2 * Math.PI) + 8) % 8;

  // 8-direction map (dx, dy)
  const dirs = [
    [1, 0],   // E
    [1, 1],   // SE
    [0, 1],   // S
    [-1, 1],  // SW
    [-1, 0],  // W
    [-1, -1], // NW
    [0, -1],  // N
    [1, -1],  // NE
  ];
  return dirs[oct];
}

function bindSlidePad(padEl, queue, opts = {}) {
  const deadZone = Number.isFinite(opts.deadZone) ? opts.deadZone : 12;
  const cooldownMs = Number.isFinite(opts.cooldownMs) ? opts.cooldownMs : 0;

  let active = false;
  let lastDir = null;
  let rect = null;
  let lastEmitAt = 0;
  let pointerId = null;

  const computeAndMaybeEmit = (clientX, clientY, force = false) => {
    if (!rect) return;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = clientX - cx;
    const dy = clientY - cy;

    const dir = directionFromDelta(dx, dy, deadZone);
    if (!dir) return;

    const [x, y] = dir;
    const key = `${x},${y}`;

    const now = performance.now();
    const cooldownOk = force || cooldownMs <= 0 || (now - lastEmitAt) >= cooldownMs;

    if (key !== lastDir && cooldownOk) {
      queue.push({ dx: x, dy: y });
      lastDir = key;
      lastEmitAt = now;
    }
  };

  const onDown = (e) => {
    e.preventDefault();
    rect = padEl.getBoundingClientRect();
    active = true;
    lastDir = null;
    lastEmitAt = 0;
    pointerId = e.pointerId;

    try { padEl.setPointerCapture(pointerId); } catch (_) {}

    // Immediate action on down
    computeAndMaybeEmit(e.clientX, e.clientY, true);
  };

  const onMove = (e) => {
    if (!active) return;
    e.preventDefault();
    if (pointerId !== null && e.pointerId !== pointerId) return;
    computeAndMaybeEmit(e.clientX, e.clientY, false);
  };

  const stop = (e) => {
    active = false;
    lastDir = null;
    rect = null;
    try {
      if (pointerId !== null) padEl.releasePointerCapture(pointerId);
    } catch (_) {}
    pointerId = null;
  };

  // Capture-phase to receive events even when starting on child buttons.
  padEl.addEventListener("pointerdown", onDown, { passive: false, capture: true });
  padEl.addEventListener("pointermove", onMove, { passive: false, capture: true });

  padEl.addEventListener("pointerup", stop, { passive: true, capture: true });
  padEl.addEventListener("pointercancel", stop, { passive: true, capture: true });
  padEl.addEventListener("lostpointercapture", stop, { passive: true, capture: true });
}
// ================================================


  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
// Bind slide controls to pads (movement + attack)
const movePad = document.getElementById("movePad");
const attackPad = document.getElementById("attackPad");

if (movePad) {
  // Move pad: slide enabled with small delay between moves (easier control)
  bindSlidePad(movePad, inputState.moveQueue, { cooldownMs: MOVE_COOLDOWN_MS });
}
if (attackPad) {
  // Attack pad: slide enabled (no delay; keep responsive)
  bindSlidePad(attackPad, inputState.attackQueue);
}


  document.getElementById("restart").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    window.location.reload();
  }, { passive: false });

  const statusEl = document.getElementById("status");
  const setStatus = (t) => statusEl.textContent = t;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cellKey = (x, y) => `${x},${y}`;
  const isAdjacent = (dx, dy) => (dx !== 0 || dy !== 0) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1;

  const keyForImagePath = (path) => {
    const base = path.split("/").pop().split(".")[0];
    return `flash_${base}`;
  };

  class MainScene extends Phaser.Scene {
    constructor() {
      super("main");
      this.player = null;
      this.playerCell = { x: 0, y: 0 };
      this.enemies = new Map();
      this.kills = 0;
      this.startTime = 0;
      this.dead = false;

      this.attackFlash = null;

      this.killTimes = [];
      this.centerFlash = null;
      this.flashGrowTween = null;
      this.flashKeys = []; // rebuilt from FLASH_IMAGES every load
    }

    preload() {
      // Player sprite (must exist at images/flash2.png)
      this.load.image("player", "images/flash2.png");

      // Enemy sprite
      this.load.image("enemy_fly", "images/fly.png");

      // Surface asset load failures (common issue on GitHub Pages due to path/case)
      this.load.on('loaderror', (file) => {
        const el = document.getElementById('status');
        if (el) el.textContent = `ASSET LOAD ERROR: ${file.key} (${file.src || file.url || ''})`;
      });

      this.flashKeys = []; // rebuilt from FLASH_IMAGES every load
      for (const p of FLASH_IMAGES) {
        const k = keyForImagePath(p);
        this.flashKeys.push(k);
        this.load.image(k, p);
      }
    }

    create() {
      this.cameras.main.setBackgroundColor("#0b0f14");

      this.scale.resize(window.innerWidth, window.innerHeight);
      this.scale.on("resize", (gameSize) => {
        this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
        this.fitWorldToScreen(gameSize.width, gameSize.height);
      });

      this.fitWorldToScreen(window.innerWidth, window.innerHeight);

      this.gridGfx = this.add.graphics();
      this.drawGrid();

      this.playerCell = { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) };

      // Player logical object (container) with a child sprite.
      const px = this.cellToWorldX(this.playerCell.x);
      const py = this.cellToWorldY(this.playerCell.y);

      this.player = this.add.container(px, py);

      // Player visual (image inside container)
      this.playerSprite = this.add.image(0, 0, INITIAL_PLAYER_KEY);
      this.player.add(this.playerSprite);

      // Apply initial cover+crop
      this.updatePlayerSpriteTexture(INITIAL_PLAYER_KEY);

this.attackFlash = this.add.graphics();

      // Center flash image (hidden)
      const firstKey = this.flashKeys[0] || null;
      this.centerFlash = this.add.image(this.player.x, this.player.y, firstKey);
      this.centerFlash.setVisible(false);
      this.centerFlash.setDepth(9999);

      
      // Ensure flash is WORLD-SPACE (moves with camera) and centered on its texture
      this.centerFlash.setScrollFactor(1);
      this.centerFlash.setOrigin(0.5, 0.5);
this.kills = 0;
      this.startTime = performance.now();
      this.dead = false;
      setStatus(this.statusLine());

      this.time.addEvent({
        delay: ENEMY_SPAWN_MS,
        loop: true,
        callback: () => { if (!this.dead) this.spawnEnemyEdge(); }
      });

      // Flash initial sprite to indicate starting character image
      // initial flash disabled (function removed)

    }

    fitWorldToScreen(w, h) {
      const s = Math.min(w / (GRID_W * TILE), h / (GRID_H * TILE));
      const cam = this.cameras.main;
      cam.setZoom(s);
      cam.centerOn((GRID_W * TILE) / 2, (GRID_H * TILE) / 2);
    }

    drawGrid() {
      const WW = GRID_W * TILE, HH = GRID_H * TILE;
      this.gridGfx.clear();
      this.gridGfx.lineStyle(1, 0x1f2a36, 1);
      this.gridGfx.strokeRect(0, 0, WW, HH);
      for (let x = 1; x < GRID_W; x++) this.gridGfx.lineBetween(x * TILE, 0, x * TILE, HH);
      for (let y = 1; y < GRID_H; y++) this.gridGfx.lineBetween(0, y * TILE, WW, y * TILE);
    }

    cellToWorldX(cx) { return cx * TILE + TILE / 2; }
    cellToWorldY(cy) { return cy * TILE + TILE / 2; }

    statusLine(extra = "") {
      const t = ((performance.now() - this.startTime) / 1000).toFixed(1);
      const kps = (this.kills / Math.max(0.001, (performance.now() - this.startTime) / 1000)).toFixed(2);
      return `Kills: ${this.kills} | Time: ${t}s | KPS: ${kps} | Enemies: ${this.enemies.size}${extra ? " | " + extra : ""}`;
    }

    spawnEnemyEdge() {
      if (this.enemies.size >= MAX_ENEMIES) return;

      for (let tries = 0; tries < 70; tries++) {
        const side = Phaser.Math.Between(0, 3);
        let x, y;
        if (side === 0) { x = Phaser.Math.Between(0, GRID_W - 1); y = 0; }
        else if (side === 1) { x = GRID_W - 1; y = Phaser.Math.Between(0, GRID_H - 1); }
        else if (side === 2) { x = Phaser.Math.Between(0, GRID_W - 1); y = GRID_H - 1; }
        else { x = 0; y = Phaser.Math.Between(0, GRID_H - 1); }

        if (x === this.playerCell.x && y === this.playerCell.y) continue;
        const k = cellKey(x, y);
        if (this.enemies.has(k)) continue;

        const ex = this.cellToWorldX(x);
        const ey = this.cellToWorldY(y);

        // Enemy logical object (container) with a child sprite (mirrors player pattern)
        const enemy = this.add.container(ex, ey);
        const enemySprite = this.add.image(0, 0, "enemy_fly");

        // Apply cover+crop to fit exactly inside the tile (same approach as player)
        if (this.textures.exists("enemy_fly")) {
          if (enemySprite.setCrop) enemySprite.setCrop();

          const tex = this.textures.get("enemy_fly");
          const srcImg = (tex && tex.getSourceImage) ? tex.getSourceImage() : null;
          const texW = (srcImg && srcImg.width) ? srcImg.width : (enemySprite.width || 1);
          const texH = (srcImg && srcImg.height) ? srcImg.height : (enemySprite.height || 1);

          const targetW = ENTITY_SIZE;
          const targetH = ENTITY_SIZE;

          const sCover = Math.max(targetW / texW, targetH / texH);
          enemySprite.setScale(sCover);

          const cropW = targetW / sCover;
          const cropH = targetH / sCover;
          const cropX = (texW - cropW) / 2;
          const cropY = (texH - cropH) / 2;

          if (enemySprite.setCrop) enemySprite.setCrop(cropX, cropY, cropW, cropH);
        }

        enemy.add(enemySprite);

        this.enemies.set(k, enemy);
        setStatus(this.statusLine());
        return;
      }
    }

    die(reason) {
      this.dead = true;
      setStatus(this.statusLine(`DEAD: ${reason}. Tap Restart.`));
      if (this.playerSprite && this.playerSprite.setTint) { this.playerSprite.setTint(0x3b4b5c); }
      if (this.playerSprite && this.playerSprite.setAlpha) { this.playerSprite.setAlpha(0.85); }
    }

    tryMove(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      const nx = clamp(this.playerCell.x + dx, 0, GRID_W - 1);
      const ny = clamp(this.playerCell.y + dy, 0, GRID_H - 1);
      if (nx === this.playerCell.x && ny === this.playerCell.y) return;

      const k = cellKey(nx, ny);
      if (this.enemies.has(k)) {
        this.playerCell = { x: nx, y: ny };
        this.player.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
        this.die("stepped onto enemy");
        return;
      }

      this.playerCell = { x: nx, y: ny };
      this.player.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
      setStatus(this.statusLine());
    }

    playAttackFlash(dx, dy) {
      const x0 = this.cellToWorldX(this.playerCell.x);
      const y0 = this.cellToWorldY(this.playerCell.y);
      const x1 = x0 + dx * TILE * 0.95;
      const y1 = y0 + dy * TILE * 0.95;

      this.attackFlash.clear();
      this.attackFlash.alpha = 1;
      this.attackFlash.lineStyle(6, 0xf7f2a0, 1);
      this.attackFlash.lineBetween(x0, y0, x1, y1);

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

    
    updatePlayerSpriteTexture(key) {
      // Swap the player sprite texture and re-apply cover scale + centered square crop.
      if (!this.playerSprite || !key) return;
      if (!this.textures.exists(key)) return;

      // Clear any previous crop before reading source dimensions
      if (this.playerSprite.setCrop) this.playerSprite.setCrop();

      // Get source image size (more reliable than width/height after crops)
      const tex = this.textures.get(key);
      const src = (tex && tex.getSourceImage) ? tex.getSourceImage() : null;
      const texW = (src && src.width) ? src.width : (this.playerSprite.width || 1);
      const texH = (src && src.height) ? src.height : (this.playerSprite.height || 1);

      this.playerSprite.setTexture(key);

      const targetW = ENTITY_SIZE;
      const targetH = ENTITY_SIZE;

      const sCover = Math.max(targetW / texW, targetH / texH);
      this.playerSprite.setScale(sCover);

      // Crop a centered square region in texture space
      const cropW = targetW / sCover;
      const cropH = targetH / sCover;
      const cropX = (texW - cropW) / 2;
      const cropY = (texH - cropH) / 2;

      if (this.playerSprite.setCrop) this.playerSprite.setCrop(cropX, cropY, cropW, cropH);
    }

flashRandomImage() {
      if (!this.flashKeys.length || !this.centerFlash) return;

      const key = Phaser.Utils.Array.GetRandom(this.flashKeys); // uniform random over all flash images

      // Flash + adopt instantly
      this.updatePlayerSpriteTexture(key);

      const WW = GRID_W * TILE, HH = GRID_H * TILE;
      const minDim = Math.min(WW, HH);
      const target = minDim * FLASH_SCALE;

      this.centerFlash.setTexture(key);

      // Anchor flash at the player's rectangle center (keeps attention on the avatar)
      this.centerFlash.setPosition(this.player.x, this.player.y);
      this.centerFlash.setVisible(true);
      this.centerFlash.setAlpha(0.98);

      const w = this.centerFlash.width || 1;
      const h = this.centerFlash.height || 1;
      const s = target / Math.max(w, h);
      this.centerFlash.setScale(s * 0.90);

      // Pop animation (quick scale-in to full size)
      this.tweens.add({
        targets: this.centerFlash,
        scale: s,
        duration: 30,
        ease: "Quad.out"
      });

      this.time.delayedCall(FLASH_DURATION_MS, () => {
        if (this.centerFlash) this.centerFlash.setVisible(false);
      });
    }

    recordKillAndMaybeFlash() {
      const now = performance.now();
      this.killTimes.push(now);

      const cutoff = now - FLASH_WINDOW_MS;
      while (this.killTimes.length && this.killTimes[0] < cutoff) this.killTimes.shift();

      if (this.killTimes.length >= FLASH_KILLS_REQUIRED) {
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
      if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) {
        setStatus(this.statusLine("edge"));
        return;
      }

      const k = cellKey(tx, ty);
      const enemy = this.enemies.get(k);
      if (enemy) {
        enemy.destroy();
        this.enemies.delete(k);
        this.kills += 1;
        this.recordKillAndMaybeFlash();
        setStatus(this.statusLine("HIT"));
      } else {
        setStatus(this.statusLine("miss"));
      }
    }

    update() {
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

  const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#0b0f14",
    scene: [MainScene],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }
  };

  window.addEventListener("resize", () => {
    try {
      const game = Phaser.GAMES[0];
      if (game && game.scale) game.scale.resize(window.innerWidth, window.innerHeight);
    } catch (_) {}
  });

  new Phaser.Game(config);
})();
