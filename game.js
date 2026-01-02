/**
 * ピグミントン - メインゲームロジック
 */

class PigmintonGame {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        // キャンバスサイズの設定
        this.resizeCanvas();

        // Resize debouncing
        this.resizeTimeout = null;
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => this.resizeCanvas(), 300);
        });

        // 物理世界の初期化
        this.world = new PhysicsWorld(this.canvas.width, this.canvas.height);

        // ゲーム状態
        this.state = 'ready'; // ready, playing, paused, ended
        this.scores = { p1: 0, p2: 0 };
        this.winScore = 11;
        this.lastTime = 0;

        // 羽根の初期化
        this.shuttlecock = new Shuttlecock(
            this.canvas.width / 2,
            this.canvas.height * 0.2
        );
        this.world.setShuttlecock(this.shuttlecock);

        // 風の力の初期化
        this.wind1 = new WindForce(50, this.canvas.height / 2, 1);
        this.wind2 = new WindForce(this.canvas.width - 50, this.canvas.height / 2, 2);
        this.world.addWindForce(this.wind1);
        this.world.addWindForce(this.wind2);

        // マイク入力
        this.micEnabled = false;
        this.audioContext = null;
        this.analyzer = null;
        this.micDataArray = null; // 再利用するためのバッファ

        // UI要素
        this.elements = {
            pig1: document.getElementById('pig1'),
            pig2: document.getElementById('pig2'),
            wind1: document.getElementById('wind1'),
            wind2: document.getElementById('wind2'),
            scoreP1: document.getElementById('score-p1'),
            scoreP2: document.getElementById('score-p2'),
            startBtn: document.getElementById('start-btn'),
            resetBtn: document.getElementById('reset-btn'),
            micToggle: document.getElementById('mic-toggle'),
            micStatus: document.getElementById('mic-status'),
            instructions: document.getElementById('instructions'),
            closeInstructions: document.getElementById('close-instructions')
        };

        // キャッシュされたグラデーション（パフォーマンス最適化）
        this.cachedGradients = {
            background: null,
            shuttlecock: null
        };

        // 前回の風メーター値（DOM更新の最適化）
        this.lastWindPercentages = { p1: -1, p2: -1 };

        this.initializeEvents();
        this.showInstructions();
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        this.canvas.width = Math.min(rect.width - 40, 1000);
        this.canvas.height = 400;

        if (this.world) {
            this.world.width = this.canvas.width;
            this.world.height = this.canvas.height;
        }

        // グラデーションをキャンバスサイズに合わせて再作成
        this.createCachedGradients();
    }

    createCachedGradients() {
        const ctx = this.ctx;
        const h = this.canvas.height;

        // 背景グラデーション
        this.cachedGradients.background = ctx.createLinearGradient(0, 0, 0, h);
        this.cachedGradients.background.addColorStop(0, '#74b9ff');
        this.cachedGradients.background.addColorStop(1, '#a29bfe');

        // 羽根のグラデーション（サイズは固定なので一度だけ作成）
        const s = this.shuttlecock;
        if (s) {
            this.cachedGradients.shuttlecock = ctx.createRadialGradient(0, 0, 2, 0, 0, s.radius);
            this.cachedGradients.shuttlecock.addColorStop(0, '#ffffff');
            this.cachedGradients.shuttlecock.addColorStop(0.5, '#ffeaa7');
            this.cachedGradients.shuttlecock.addColorStop(1, '#fdcb6e');
        }
    }

    initializeEvents() {
        // スタートボタン
        this.elements.startBtn.addEventListener('click', () => this.startGame());

        // リセットボタン
        this.elements.resetBtn.addEventListener('click', () => this.resetGame());

        // マイク切替
        this.elements.micToggle.addEventListener('click', () => this.toggleMicrophone());

        // 説明を閉じる
        this.elements.closeInstructions.addEventListener('click', () => {
            this.elements.instructions.classList.add('hidden');
        });

        // プレイヤー1の操作（マウス/タッチ）
        this.setupPigControls(this.elements.pig1, this.wind1);

        // プレイヤー2の操作（マウス/タッチ）
        this.setupPigControls(this.elements.pig2, this.wind2);

        // キーボード操作（デバッグ用）
        document.addEventListener('keydown', (e) => {
            if (this.state !== 'playing') return;

            if (e.key === 'a' || e.key === 'A') {
                this.wind1.startCharging();
            }
            if (e.key === 'l' || e.key === 'L') {
                this.wind2.startCharging();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'a' || e.key === 'A') {
                this.wind1.stopCharging();
                this.wind1.blow();
                this.playBlowSound(1);
            }
            if (e.key === 'l' || e.key === 'L') {
                this.wind2.stopCharging();
                this.wind2.blow();
                this.playBlowSound(2);
            }
        });
    }

    setupPigControls(element, wind) {
        let isPressed = false;

        const startBlow = () => {
            isPressed = true;
            wind.startCharging();
            element.classList.add('blowing');
        };

        const endBlow = () => {
            if (!isPressed) return;
            isPressed = false;
            wind.stopCharging();
            if (wind.blow()) {
                const player = wind.player;
                this.playBlowSound(player);
            }
            element.classList.remove('blowing');
        };

        // マウスイベント
        element.addEventListener('mousedown', startBlow);
        element.addEventListener('mouseup', endBlow);
        element.addEventListener('mouseleave', endBlow);

        // タッチイベント
        element.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startBlow();
        });
        element.addEventListener('touchend', (e) => {
            e.preventDefault();
            endBlow();
        });
        element.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            endBlow();
        });
    }

    async toggleMicrophone() {
        if (!this.micEnabled) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.analyzer = this.audioContext.createAnalyser();
                const source = this.audioContext.createMediaStreamSource(stream);
                source.connect(this.analyzer);
                this.analyzer.fftSize = 256;

                // バッファを一度だけ作成（パフォーマンス最適化）
                this.micDataArray = new Uint8Array(this.analyzer.frequencyBinCount);

                this.micEnabled = true;
                this.elements.micStatus.classList.remove('hidden');
                this.elements.micStatus.classList.add('active');
                this.elements.micStatus.textContent = 'マイク: ON';
                this.elements.micToggle.textContent = '🎤 マイクOFF';

                this.processMicrophoneInput();
            } catch (err) {
                alert('マイクへのアクセスが拒否されました。\nブラウザの設定を確認してください。');
                console.error('Microphone error:', err);
            }
        } else {
            this.micEnabled = false;
            if (this.audioContext) {
                this.audioContext.close();
            }
            this.elements.micStatus.classList.remove('active');
            this.elements.micStatus.classList.add('hidden');
            this.elements.micToggle.textContent = '🎤 マイク入力';
        }
    }

    processMicrophoneInput() {
        if (!this.micEnabled || !this.analyzer || !this.micDataArray) return;

        const bufferLength = this.analyzer.frequencyBinCount;

        const checkMic = () => {
            if (!this.micEnabled) return;

            this.analyzer.getByteFrequencyData(this.micDataArray);

            // 低周波数帯域の平均振幅を計算（息の音は低周波ノイズ）
            let sum = 0;
            for (let i = 0; i < bufferLength / 4; i++) {
                sum += this.micDataArray[i];
            }
            const average = sum / (bufferLength / 4);

            // 閾値を超えたら風を発生（プレイヤー1とプレイヤー2で交互に）
            const threshold = 40; // この値は調整可能
            if (average > threshold && this.state === 'playing') {
                // 簡易実装：両方のプレイヤーに適用
                // 実際にはマイクの位置や音声認識でプレイヤーを区別する
                if (!this.wind1.isBlowing) {
                    this.wind1.strength = Math.min(average * 0.8, this.wind1.maxStrength);
                    this.wind1.blow();
                }
            }

            requestAnimationFrame(checkMic);
        };

        checkMic();
    }

    showInstructions() {
        this.elements.instructions.classList.remove('hidden');
    }

    startGame() {
        this.state = 'playing';
        this.elements.startBtn.textContent = '再開';
        this.world.reset();
        this.gameLoop();
    }

    resetGame() {
        this.state = 'ready';
        this.scores = { p1: 0, p2: 0 };
        this.updateScore();
        this.world.reset();
        this.elements.startBtn.textContent = 'ゲーム開始';
    }

    updateScore() {
        this.elements.scoreP1.textContent = this.scores.p1;
        this.elements.scoreP2.textContent = this.scores.p2;
    }

    checkWinCondition() {
        if (this.scores.p1 >= this.winScore) {
            this.endGame('プレイヤー1の勝利！🎉');
            return true;
        } else if (this.scores.p2 >= this.winScore) {
            this.endGame('プレイヤー2の勝利！🎉');
            return true;
        }
        return false;
    }

    endGame(message) {
        this.state = 'ended';
        setTimeout(() => {
            alert(message);
            this.resetGame();
        }, 500);
    }

    gameLoop(timestamp = 0) {
        if (this.state !== 'playing') return;

        const deltaTime = this.lastTime ? (timestamp - this.lastTime) / 1000 : 0.016;
        this.lastTime = timestamp;

        // 物理更新
        this.world.update(Math.min(deltaTime, 0.033)); // 最大33ms

        // 地面との衝突チェック
        const groundHit = this.world.checkGroundCollision();
        if (groundHit) {
            if (groundHit === 'left') {
                this.scores.p2++; // プレイヤー2が得点
            } else {
                this.scores.p1++; // プレイヤー1が得点
            }
            this.updateScore();

            if (!this.checkWinCondition()) {
                // 次のラウンド
                setTimeout(() => {
                    this.world.reset();
                }, 500);
            }
        }

        // UI更新（風メーター） - 値が変わった時のみ更新
        const wind1Pct = Math.round(this.wind1.getChargePercentage());
        const wind2Pct = Math.round(this.wind2.getChargePercentage());

        if (wind1Pct !== this.lastWindPercentages.p1) {
            this.elements.wind1.style.width = wind1Pct + '%';
            this.lastWindPercentages.p1 = wind1Pct;
        }
        if (wind2Pct !== this.lastWindPercentages.p2) {
            this.elements.wind2.style.width = wind2Pct + '%';
            this.lastWindPercentages.p2 = wind2Pct;
        }

        // 描画
        this.render();

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // 背景クリア
        ctx.clearRect(0, 0, w, h);

        // グラデーション背景（キャッシュ使用）
        ctx.fillStyle = this.cachedGradients.background;
        ctx.fillRect(0, 0, w, h);

        // コート境界線（中央）
        ctx.strokeStyle = '#2d3436';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // ネット
        ctx.fillStyle = '#2d3436';
        ctx.fillRect(w / 2 - 2, h * 0.7, 4, h * 0.3);

        // 地面
        ctx.fillStyle = '#00b894';
        ctx.fillRect(0, h - 20, w, 20);

        // 風のエフェクト描画
        this.renderWindEffect(this.wind1, 50, h / 2);
        this.renderWindEffect(this.wind2, w - 50, h / 2);

        // 羽根の描画
        this.renderShuttlecock();

        // デバッグ情報
        if (false) { // デバッグモード
            ctx.fillStyle = 'black';
            ctx.font = '12px monospace';
            ctx.fillText(`Velocity: ${this.shuttlecock.velocity.x.toFixed(2)}, ${this.shuttlecock.velocity.y.toFixed(2)}`, 10, 20);
            ctx.fillText(`Position: ${this.shuttlecock.position.x.toFixed(2)}, ${this.shuttlecock.position.y.toFixed(2)}`, 10, 35);
        }
    }

    renderWindEffect(wind, x, y) {
        if (!wind.isBlowing) return;

        const ctx = this.ctx;
        const strength = wind.getChargePercentage() / 100;

        // 風の円錐形エフェクト
        ctx.save();
        ctx.translate(x, y);

        const angle = wind.player === 1 ? 0 : Math.PI;
        ctx.rotate(angle);

        // 半透明の風エフェクト
        const gradient = ctx.createLinearGradient(0, -30, 150, 0);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${strength * 0.6})`);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(150 * strength, -30 * strength);
        ctx.lineTo(150 * strength, 30 * strength);
        ctx.closePath();
        ctx.fill();

        // 風のパーティクル
        for (let i = 0; i < 5; i++) {
            const particleX = Math.random() * 100 * strength;
            const particleY = (Math.random() - 0.5) * 40 * strength;
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.5})`;
            ctx.beginPath();
            ctx.arc(particleX, particleY, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    renderShuttlecock() {
        const ctx = this.ctx;
        const s = this.shuttlecock;

        // 影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.ellipse(s.position.x, this.canvas.height - 15, 10, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        // 羽根本体
        ctx.save();
        ctx.translate(s.position.x, s.position.y);

        // 回転エフェクト（速度に応じて）
        const rotation = Math.atan2(s.velocity.y, s.velocity.x);
        ctx.rotate(rotation);

        // 羽根のグラデーション（キャッシュ使用）
        ctx.fillStyle = this.cachedGradients.shuttlecock;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
        ctx.fill();

        // 羽根の詳細
        ctx.strokeStyle = '#e17055';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 羽根の模様
        ctx.strokeStyle = '#d63031';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            const angle = (Math.PI * 2 / 4) * i;
            ctx.lineTo(Math.cos(angle) * s.radius, Math.sin(angle) * s.radius);
            ctx.stroke();
        }

        ctx.restore();

        // 浮遊エフェクト
        if (s.isFloating()) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(s.position.x, s.position.y, s.radius + 5, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    playBlowSound(player) {
        // Web Audio APIでブー音を生成
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const ctx = this.audioContext;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        // 風の強さに応じた周波数
        const strength = player === 1 ? this.wind1.strength : this.wind2.strength;
        const frequency = 80 + (strength / 100) * 40; // 80-120Hz

        oscillator.type = 'sawtooth'; // ブタの鳴き声っぽい音
        oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

        gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.2);
    }
}

// ゲーム開始
let game;
window.addEventListener('DOMContentLoaded', () => {
    game = new PigmintonGame();
});
