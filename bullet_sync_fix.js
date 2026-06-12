      // 改进子弹同步：不完全替换，而是增量更新
      if (Network._oppStateDirty) {
        Network._oppStateDirty = false;
        
        // 移除所有旧的网络子弹
        this.bullets = this.bullets.filter(b => !b.fromNetwork);
        
        // 添加对手的所有子弹
        for (const bd of Network.oppState.bullets) {
          const b = new Bullet(bd.x, bd.y, bd.vx, bd.vy, bd.color);
          b.fromNetwork = true;
          this.bullets.push(b);
        }
      }
