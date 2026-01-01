/**
 * ピグミントン物理演算エンジン
 * レポート仕様に基づく空気力学シミュレーション
 */

class Vector2D {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        return new Vector2D(this.x + v.x, this.y + v.y);
    }

    subtract(v) {
        return new Vector2D(this.x - v.x, this.y - v.y);
    }

    multiply(scalar) {
        return new Vector2D(this.x * scalar, this.y * scalar);
    }

    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    normalize() {
        const mag = this.magnitude();
        if (mag === 0) return new Vector2D(0, 0);
        return new Vector2D(this.x / mag, this.y / mag);
    }

    distanceTo(v) {
        return Math.sqrt(Math.pow(this.x - v.x, 2) + Math.pow(this.y - v.y, 2));
    }
}

class Shuttlecock {
    constructor(x, y) {
        this.position = new Vector2D(x, y);
        this.velocity = new Vector2D(0, 0);
        this.acceleration = new Vector2D(0, 0);

        // レポート仕様パラメータ
        this.mass = 0.005; // kg (5g)
        this.dragCoefficient = 1.2; // 高い空気抵抗
        this.crossSectionalArea = 0.002; // m^2
        this.airDensity = 1.225; // kg/m^3

        this.radius = 8; // 描画サイズ
        this.spin = 0; // 回転（将来の拡張用）
        this.floatTime = 0; // 浮遊時間
    }

    applyForce(force) {
        // F = ma → a = F/m
        const accel = force.multiply(1 / this.mass);
        this.acceleration = this.acceleration.add(accel);
    }

    update(deltaTime) {
        // 重力の適用
        const gravity = new Vector2D(0, 9.8 * this.mass * 0.1); // スケール調整
        this.applyForce(gravity);

        // 空気抵抗の計算 (Fd = 0.5 * ρ * v² * Cd * A)
        const speed = this.velocity.magnitude();
        if (speed > 0) {
            const dragMagnitude = 0.5 * this.airDensity * speed * speed *
                                 this.dragCoefficient * this.crossSectionalArea;
            const dragDirection = this.velocity.normalize().multiply(-1);
            const drag = dragDirection.multiply(dragMagnitude);
            this.applyForce(drag);
        }

        // 速度と位置の更新
        this.velocity = this.velocity.add(this.acceleration.multiply(deltaTime));
        this.position = this.position.add(this.velocity.multiply(deltaTime));

        // 浮遊時間の追跡（ゆっくり落ちている時間）
        if (speed < 2 && this.velocity.y > 0) {
            this.floatTime += deltaTime;
        } else {
            this.floatTime = 0;
        }

        // 加速度のリセット
        this.acceleration = new Vector2D(0, 0);
    }

    isFloating() {
        return this.floatTime > 0.1;
    }
}

class WindForce {
    constructor(sourceX, sourceY, player) {
        this.source = new Vector2D(sourceX, sourceY);
        this.player = player; // 1 or 2
        this.strength = 0;
        this.maxStrength = 50;
        this.chargeRate = 80; // 充填速度
        this.decayRate = 100; // 減衰速度
        this.isCharging = false;
        this.isBlowing = false;
        this.blowDuration = 0;
        this.maxBlowDuration = 0.3; // 秒

        // レポート仕様パラメータ
        this.airCapacity = 100; // 肺活量
        this.restorationRate = 60; // 復元速度（秒あたり）
        this.nozzleDiameter = 30; // 鼻の大きさ（効果範囲）
        this.maxRange = 200; // 最大到達距離
    }

    startCharging() {
        this.isCharging = true;
    }

    stopCharging() {
        this.isCharging = false;
    }

    blow() {
        if (this.strength > 10) { // 最低限のチャージが必要
            this.isBlowing = true;
            this.blowDuration = 0;
            return true;
        }
        return false;
    }

    update(deltaTime) {
        if (this.isCharging && this.strength < this.maxStrength) {
            this.strength += this.chargeRate * deltaTime;
            if (this.strength > this.maxStrength) {
                this.strength = this.maxStrength;
            }
        }

        if (this.isBlowing) {
            this.blowDuration += deltaTime;
            if (this.blowDuration >= this.maxBlowDuration) {
                this.isBlowing = false;
                this.strength = 0; // 風を使い切る
            }
        } else if (!this.isCharging && this.strength > 0) {
            // 自然減衰
            this.strength -= this.decayRate * deltaTime;
            if (this.strength < 0) this.strength = 0;
        }
    }

    applyToShuttlecock(shuttlecock) {
        if (!this.isBlowing || this.strength === 0) return null;

        const distance = this.source.distanceTo(shuttlecock.position);

        // 到達範囲外
        if (distance > this.maxRange) return null;

        // 距離による減衰 (F ∝ 1/d²)
        const distanceFactor = Math.max(0, 1 - (distance / this.maxRange));
        const effectiveStrength = this.strength * distanceFactor * distanceFactor;

        // 風の方向を計算
        let direction;
        if (this.player === 1) {
            // プレイヤー1は右向き
            direction = new Vector2D(1, -0.2); // 少し上向き
        } else {
            // プレイヤー2は左向き
            direction = new Vector2D(-1, -0.2);
        }

        // 風の力ベクトル
        const windForce = direction.normalize().multiply(effectiveStrength * 0.5);

        return {
            force: windForce,
            distance: distance,
            strength: effectiveStrength
        };
    }

    getChargePercentage() {
        return (this.strength / this.maxStrength) * 100;
    }
}

class PhysicsWorld {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.shuttlecock = null;
        this.windForces = [];
        this.netHeight = height * 0.3;
        this.netX = width / 2;
        this.groundY = height - 20;
    }

    setShuttlecock(shuttlecock) {
        this.shuttlecock = shuttlecock;
    }

    addWindForce(windForce) {
        this.windForces.push(windForce);
    }

    update(deltaTime) {
        if (!this.shuttlecock) return;

        // 風の力を更新
        this.windForces.forEach(wind => wind.update(deltaTime));

        // 各風の力を羽根に適用
        this.windForces.forEach(wind => {
            const windEffect = wind.applyToShuttlecock(this.shuttlecock);
            if (windEffect) {
                this.shuttlecock.applyForce(windEffect.force);
            }
        });

        // 羽根の物理更新
        this.shuttlecock.update(deltaTime);

        // 境界チェック
        this.checkBoundaries();
    }

    checkBoundaries() {
        const s = this.shuttlecock;

        // 左右の壁
        if (s.position.x - s.radius < 0) {
            s.position.x = s.radius;
            s.velocity.x *= -0.5; // 反発係数
        } else if (s.position.x + s.radius > this.width) {
            s.position.x = this.width - s.radius;
            s.velocity.x *= -0.5;
        }

        // 天井
        if (s.position.y - s.radius < 0) {
            s.position.y = s.radius;
            s.velocity.y *= -0.3;
        }

        // 地面での判定は別途（ゲームオーバー処理）
    }

    checkGroundCollision() {
        if (!this.shuttlecock) return null;

        if (this.shuttlecock.position.y + this.shuttlecock.radius >= this.groundY) {
            // どちら側に落ちたか判定
            if (this.shuttlecock.position.x < this.netX) {
                return 'left'; // プレイヤー1のコート
            } else {
                return 'right'; // プレイヤー2のコート
            }
        }
        return null;
    }

    reset() {
        // 羽根を中央上空にリセット
        if (this.shuttlecock) {
            this.shuttlecock.position = new Vector2D(this.width / 2, 50);
            this.shuttlecock.velocity = new Vector2D(0, 0);
            this.shuttlecock.acceleration = new Vector2D(0, 0);
            this.shuttlecock.floatTime = 0;
        }
    }
}
