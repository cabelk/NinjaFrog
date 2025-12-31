const GRID_COLS = 6;
const GRID_ROWS = 5;
const MAX_ENEMIES = 6;

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    this.load.image('flash1', 'images/flash1.png');
    this.load.image('flash2', 'images/flash2.png');
    this.load.image('flash3', 'images/flash3.png');
    this.load.image('enemy_fly', 'images/fly.png');
  }

  create() {
    this.enemies = [];
    this.kills = 0;

    this.computeLayout();
    this.drawBoard();

    this.player = this.add.rectangle(
      this.playerX,
      this.playerY,
      this.tileSize * 0.8,
      this.tileSize * 0.8,
      0x00ff00
    );

    this.time.addEvent({
      delay: 1200,
      loop: true,
      callback: this.spawnEnemyEdge,
      callbackScope: this
    });

    this.input.keyboard.on('keydown', e => this.handleKey(e));
  }

  computeLayout() {
    const w = this.scale.width;
    const h = this.scale.height;

    this.tileSize = Math.min(
      Math.floor(w / GRID_COLS),
      Math.floor(h / GRID_ROWS)
    );

    this.boardWidth = this.tileSize * GRID_COLS;
    this.boardHeight = this.tileSize * GRID_ROWS;

    this.boardOffsetX = (w - this.boardWidth) / 2;
    this.boardOffsetY = (h - this.boardHeight) / 2;

    this.playerCol = Math.floor(GRID_COLS / 2);
    this.playerRow = Math.floor(GRID_ROWS / 2);

    const pos = this.gridToWorld(this.playerCol, this.playerRow);
    this.playerX = pos.x;
    this.playerY = pos.y;
  }

  drawBoard() {
    this.graphics = this.add.graphics();
    this.graphics.fillStyle(0x222222);

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const { x, y } = this.gridToWorld(c, r);
        this.graphics.fillRect(
          x - this.tileSize / 2,
          y - this.tileSize / 2,
          this.tileSize,
          this.tileSize
        );
      }
    }
  }

  gridToWorld(col, row) {
    return {
      x: this.boardOffsetX + col * this.tileSize + this.tileSize / 2,
      y: this.boardOffsetY + row * this.tileSize + this.tileSize / 2
    };
  }

  spawnEnemyEdge() {
    if (this.enemies.length >= MAX_ENEMIES) return;

    const side = Phaser.Math.Between(0, 3);
    let col, row;

    if (side === 0) { col = Phaser.Math.Between(0, GRID_COLS - 1); row = 0; }
    if (side === 1) { col = Phaser.Math.Between(0, GRID_COLS - 1); row = GRID_ROWS - 1; }
    if (side === 2) { col = 0; row = Phaser.Math.Between(0, GRID_ROWS - 1); }
    if (side === 3) { col = GRID_COLS - 1; row = Phaser.Math.Between(0, GRID_ROWS - 1); }

    if (col === this.playerCol && row === this.playerRow) return;

    this.spawnEnemyAt(col, row);
  }

  spawnEnemyAt(col, row) {
    const { x, y } = this.gridToWorld(col, row);
    const enemy = this.add.image(x, y, 'enemy_fly');

    const scale = Math.min(
      this.tileSize / enemy.width,
      this.tileSize / enemy.height
    ) * 0.96;

    enemy.setScale(scale);
    enemy.gridX = col;
    enemy.gridY = row;
    enemy.setDepth(2);

    this.enemies.push(enemy);
  }

  handleKey(e) {
    const map = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0]
    };

    if (!map[e.key]) return;

    const [dx, dy] = map[e.key];
    const nc = this.playerCol + dx;
    const nr = this.playerRow + dy;

    if (nc < 0 || nr < 0 || nc >= GRID_COLS || nr >= GRID_ROWS) return;

    const enemyIndex = this.enemies.findIndex(
      e => e.gridX === nc && e.gridY === nr
    );

    if (enemyIndex !== -1) {
      this.enemies[enemyIndex].destroy();
      this.enemies.splice(enemyIndex, 1);
      this.kills++;
      return;
    }

    this.playerCol = nc;
    this.playerRow = nr;
    const pos = this.gridToWorld(nc, nr);
    this.player.setPosition(pos.x, pos.y);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: GameScene
};

new Phaser.Game(config);
