// Hero Game - Retro Space Shooter
// Initial Setup

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('hero-game-canvas');
    if (!canvas) {
        console.error('Hero Game Canvas not found!');
        return;
    }

    const ctx = canvas.getContext('2d');

    // Set explicit canvas size to match CSS display size to avoid scaling issues
    canvas.width = 1200;
    canvas.height = 550;

    // Background Pattern (Generative Grid) - DISABLED
    const bgElements = [];
    // const cellSize = 40;
    // ... generation logic removed to clear view for background image ...

    // Game Objects
    const ship = {
        x: canvas.width / 2 - 25, // Centered
        y: canvas.height - 70,    // Near bottom
        width: 45,                // Slightly wider for sprite
        height: 45,               // Square-ish for pixel art
        speed: 5,
        color: '#00ff00',
        dx: 0
    };

    const bullets = [];
    const bulletSpeed = 7;

    const enemies = [];
    const enemyRows = 3; // Reduced from 4
    const enemyCols = 8; // Reduced from 10
    const enemyWidth = 44; // 11 * 4
    const enemyHeight = 32; // 8 * 4
    const enemyPadding = 80; // Wider spacing
    const enemyOffsetTop = 50;
    const enemyOffsetLeft = 50; // Centered start

    // Initialize Enemies (Custom Formation: 5-7-5)
    function spawnEnemies() {
        enemies.length = 0;

        const rowsConfig = [5, 7, 5]; // Number of enemies per row
        const startY = 80;
        // Reduced padding for tighter formation
        const localEnemyPadding = 30; // Spacing between enemies

        rowsConfig.forEach((count, rowIndex) => {
            const rowWidth = (count * enemyWidth) + ((count - 1) * localEnemyPadding);
            const startX = (canvas.width - rowWidth) / 2;

            for (let i = 0; i < count; i++) {
                enemies.push({
                    x: startX + i * (enemyWidth + localEnemyPadding),
                    y: startY + rowIndex * (enemyHeight + localEnemyPadding),
                    width: enemyWidth,
                    height: enemyHeight,
                    color: '#ff0055',
                    type: Math.random() > 0.6 ? 'green' : 'pink', // 40% chance of green
                    status: 1
                });
            }
        });
    }

    // Initial spawn
    spawnEnemies();

    // Input Handling
    let rightPressed = false;
    let leftPressed = false;
    let spacePressed = false;

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Right' || e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') rightPressed = true;
        if (e.key === 'Left' || e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') leftPressed = true;
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault(); // Stop scrolling
            if (!spacePressed) fireBullet();
            spacePressed = true;
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'Right' || e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') rightPressed = false;
        if (e.key === 'Left' || e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') leftPressed = false;
        if (e.key === ' ' || e.code === 'Space') spacePressed = false;
    });

    function fireBullet() {
        bullets.push({
            x: ship.x + ship.width / 2 - 2,
            y: ship.y,
            width: 4,
            height: 10,
            color: '#ffff00' // Retro yellow
        });
    }

    // Helper: Draw Rectangle
    function drawRect(x, y, w, h, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
    }

    // Helper: Draw Retro Ship Sprite (Galaga Style)
    function drawShipSprite(x, y, w, h) {
        // Approximate grid 13x13 or similar. We scale pixels to fit 'w' and 'h'.
        const pixelSize = w / 15; // Assume 15 pixels wide

        // Color Palette
        const white = '#63666b'; // Darker Grey
        const red = '#2d7ff9'; // Bright Blue from reference
        const blue = '#2d7ff9'; // Also Blue
        const black = '#000000'; // For contrast details if needed

        // Define simple pixel map (0=empty, 1=white, 2=red, 3=blue)
        // This is a simplified Galaga fighter representation
        const sprite = [
            [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 0, 0], // Red center
            [0, 0, 0, 2, 0, 1, 2, 2, 2, 1, 0, 2, 0, 0, 0],
            [0, 0, 0, 2, 3, 1, 0, 2, 0, 1, 3, 2, 0, 0, 0], // Blue accents
            [0, 0, 2, 1, 3, 1, 1, 1, 1, 1, 3, 1, 2, 0, 0],
            [0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0],
            [0, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0],
            [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
            [2, 0, 1, 1, 2, 2, 0, 0, 0, 2, 2, 1, 1, 0, 2], // Red base
            [0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0]
        ];

        for (let r = 0; r < sprite.length; r++) {
            for (let c = 0; c < sprite[r].length; c++) {
                let color = null;
                if (sprite[r][c] === 1) color = white;
                if (sprite[r][c] === 2) color = red;
                if (sprite[r][c] === 3) color = blue;

                if (color) {
                    ctx.fillStyle = color;
                    ctx.fillRect(x + c * pixelSize, y + r * pixelSize, pixelSize, pixelSize);
                }
            }
        }
    }
    // Helper: Draw Retro Enemy Sprite (Invader Style)
    function drawEnemySprite(x, y, w, h, type) {
        const pixelSizeW = w / 11;
        const pixelSizeH = h / 8;

        const pink = '#8a2be2'; // Darker Purple (Blue Violet)
        const pinkGrey = '#b0b3b8'; // Grey for Pink variant

        const green = '#8a2be2'; // Darker Purple (Blue Violet)
        const greenGrey = '#b0b3b8'; // Grey for Green variant (same)

        let bodyColor = pink;
        let legColor = pinkGrey;

        if (type === 'green') {
            bodyColor = green;
            legColor = greenGrey;
        }

        // 11x8 Grid "Crab" invader
        // 0=Empty, 1=Pink (Body), 2=Grey (Legs/Antennae)
        const sprite = [
            [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
            [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
            [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0],
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            [2, 0, 1, 1, 1, 1, 1, 1, 1, 0, 2],
            [2, 0, 1, 0, 0, 0, 0, 0, 1, 0, 2],
            [0, 0, 0, 2, 2, 0, 2, 2, 0, 0, 0]
        ];

        for (let r = 0; r < sprite.length; r++) {
            for (let c = 0; c < sprite[r].length; c++) {
                let color = null;
                if (sprite[r][c] === 1) color = bodyColor;
                if (sprite[r][c] === 2) color = legColor;

                if (color) {
                    ctx.fillStyle = color;
                    ctx.fillRect(x + c * pixelSizeW, y + r * pixelSizeH, pixelSizeW, pixelSizeH);
                }
            }
        }
    }

    // Update Game State
    function update() {
        // Move Background Grid
        bgElements.forEach(el => {
            el.y += el.speed;
            // Wrap around
            if (el.y > canvas.height + cellSize) {
                el.y = -cellSize;
                // Optional: Randomize x slightly on wrap to reduce visible repetition pattern
                // el.x = Math.random() * canvas.width; 
            }
        });

        // Move Ship
        if (rightPressed && ship.x < canvas.width - ship.width) {
            ship.x += ship.speed;
        }
        if (leftPressed && ship.x > 0) {
            ship.x -= ship.speed;
        }

        // Move Bullets
        for (let i = 0; i < bullets.length; i++) {
            bullets[i].y -= bulletSpeed;
            // Remove off-screen bullets
            if (bullets[i].y < 0) {
                bullets.splice(i, 1);
                i--;
            }
        }

        // Move Enemies (Simple patrol)
        // For simplicity in this step, we'll keep them static or add simple wobble later
        // Let's make them move down slowly
        enemies.forEach(enemy => {
            if (enemy.status === 1) {
                enemy.y += 0.2; // Slow descent

                // Reset if they hit bottom (infinite mode)
                if (enemy.y > canvas.height) {
                    enemy.y = -50;
                }
            }
        });

        // Collision Detection: Bullets hitting Enemies
        bullets.forEach((bullet, bIndex) => {
            enemies.forEach((enemy, eIndex) => {
                if (enemy.status === 1) {
                    if (bullet.x > enemy.x &&
                        bullet.x < enemy.x + enemy.width &&
                        bullet.y > enemy.y &&
                        bullet.y < enemy.y + enemy.height) {

                        enemy.status = 0; // Kill enemy
                        bullets.splice(bIndex, 1); // Remove bullet
                        score += 10; // Increase score
                    }
                }
            });
        });

        // Collision Detection: Enemies hitting Ship (Game Over -> Reset)
        enemies.forEach(enemy => {
            if (enemy.status === 1) {
                if (ship.x < enemy.x + enemy.width &&
                    ship.x + ship.width > enemy.x &&
                    ship.y < enemy.y + enemy.height &&
                    ship.y + ship.height > enemy.y) {
                    resetGame();
                }
            }
        });
    }

    let score = 0;

    function resetGame() {
        score = 0;
        bullets.length = 0; // Clear bullets
        ship.x = canvas.width / 2 - 25;

        // Reset Enemies (16 count, 2x8)
        enemies.length = 0;
        const rows = 2;
        const cols = 8;
        const startX = (canvas.width - (cols * (enemyWidth + enemyPadding))) / 2 + enemyPadding / 2;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                enemies.push({
                    x: startX + c * (enemyWidth + enemyPadding),
                    y: enemyOffsetTop + r * (enemyHeight + enemyPadding),
                    width: enemyWidth,
                    height: enemyHeight,
                    color: '#ff0055',
                    type: Math.random() > 0.6 ? 'green' : 'pink',
                    status: 1
                });
            }
        }
    }

    // Draw Score removed (moved to DOM)
    // function drawScore() { ... }

    // Draw Frame
    function draw() {
        // Clear Canvas
        // Clear Canvas (Transparent to show CSS background)
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Stars - DISABLED
        // Draw Background Pattern - DISABLED
        /*
        bgElements.forEach(el => {
            ctx.fillStyle = el.color;
            if (el.type === 'circle') {
                ctx.beginPath();
                ctx.arc(el.x, el.y, el.size / 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillRect(el.x - el.size / 2, el.y - el.size / 2, el.size, el.size);
            }
        });
        */
        ctx.globalAlpha = 1.0; // Reset alpha

        // Draw Player
        drawShipSprite(ship.x, ship.y, ship.width, ship.height);

        // Draw Bullets
        bullets.forEach(bullet => {
            drawRect(bullet.x, bullet.y, bullet.width, bullet.height, bullet.color);
        });

        // Draw Enemies
        enemies.forEach(enemy => {
            if (enemy.status === 1) {
                drawEnemySprite(enemy.x, enemy.y, enemy.width, enemy.height, enemy.type);
            }
        });

        // Update Score DOM
        const scoreEl = document.getElementById('game-score');
        if (scoreEl) scoreEl.innerText = 'SCORE: ' + score;
    }

    // Game Loop
    function loop() {
        update();
        draw();
        requestAnimationFrame(loop);
    }

    // Start Game
    loop();
    console.log('Game Loop Started');
});
