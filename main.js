(() => {
  const TILE = 36;
  const GRID_W = 11;
  const GRID_H = 17;

  const input = {
    moveQueue: [],
    atk: { up:false, right:false, down:false, left:false },
    atkTrigger: 0
  };

  document.querySelectorAll("[data-move]").forEach(b => {
    b.addEventListener("pointerdown", e => {
      const [dx,dy] = b.dataset.move.split(",").map(Number);
      input.moveQueue.push({dx,dy});
    });
  });

  document.querySelectorAll("[data-atk]").forEach(b => {
    const k = b.dataset.atk;
    b.addEventListener("pointerdown", e => {
      input.atk[k] = true;
      input.atkTrigger++;
    });
    b.addEventListener("pointerup", e => input.atk[k]=false);
    b.addEventListener("pointerleave", e => input.atk[k]=false);
  });

  document.getElementById("restart").onclick = () => location.reload();

  function attackDir(a){
    const U=a.up,R=a.right,D=a.down,L=a.left;
    const c=(U+R+D+L);
    if(c===1){
      if(U) return {x:0,y:-1};
      if(R) return {x:1,y:0};
      if(D) return {x:0,y:1};
      if(L) return {x:-1,y:0};
    }
    if(c===2){
      if(U&&R) return {x:1,y:-1};
      if(R&&D) return {x:1,y:1};
      if(D&&L) return {x:-1,y:1};
      if(L&&U) return {x:-1,y:-1};
    }
    return null;
  }

  class Game extends Phaser.Scene {
    constructor(){
      super();
      this.player={x:5,y:8};
      this.enemies=new Map();
      this.lastAtk=0;
      this.kills=0;
    }

    create(){
      this.add.grid(
        (GRID_W*TILE)/2,(GRID_H*TILE)/2,
        GRID_W*TILE,GRID_H*TILE,
        TILE,TILE,0x1f2a36
      );

      this.pRect=this.add.rectangle(0,0,TILE*0.7,TILE*0.7,0x5dd6ff);
      this.updatePlayer();

      this.time.addEvent({
        delay:700,loop:true,callback:()=>this.spawnEnemy()
      });
    }

    updatePlayer(){
      this.pRect.setPosition(
        this.player.x*TILE+TILE/2,
        this.player.y*TILE+TILE/2
      );
    }

    spawnEnemy(){
      if(this.enemies.size>15) return;
      for(let i=0;i<30;i++){
        const x=Math.floor(Math.random()*GRID_W);
        const y=Math.floor(Math.random()*GRID_H);
        const k=`${x},${y}`;
        if(this.enemies.has(k)) continue;
        if(x===this.player.x&&y===this.player.y) continue;
        const r=this.add.rectangle(
          x*TILE+TILE/2,y*TILE+TILE/2,
          TILE*0.7,TILE*0.7,0xff5d6c
        );
        this.enemies.set(k,r);
        return;
      }
    }

    update(){
      if(input.moveQueue.length){
        const {dx,dy}=input.moveQueue.shift();
        const nx=this.player.x+dx;
        const ny=this.player.y+dy;
        const k=`${nx},${ny}`;
        if(this.enemies.has(k)){
          alert("You died");
          location.reload();
        }
        if(nx>=0&&nx<GRID_W&&ny>=0&&ny<GRID_H){
          this.player={x:nx,y:ny};
          this.updatePlayer();
        }
      }

      if(input.atkTrigger!==this.lastAtk){
        this.lastAtk=input.atkTrigger;
        const d=attackDir(input.atk);
        if(!d) return;
        const tx=this.player.x+d.x;
        const ty=this.player.y+d.y;
        const k=`${tx},${ty}`;
        if(this.enemies.has(k)){
          this.enemies.get(k).destroy();
          this.enemies.delete(k);
          this.kills++;
        }
      }
    }
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: GRID_W*TILE,
    height: GRID_H*TILE,
    scene: Game
  });
})();
