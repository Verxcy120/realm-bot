const express = require('express');

function startAuthServer(client) {
    const app = express();
    const port = process.env.PORT || 3000;

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            bot: client.user?.tag || 'Not logged in'
        });
    });

    app.get('/', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>RealmShield</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #1a1a2e; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .container { text-align: center; }
                    h1 { color: #5865F2; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🛡️ RealmShield</h1>
                    <p>Bot is running! Use /setup in Discord to link your account.</p>
                </div>
            </body>
            </html>
        `);
    });

    app.listen(port, () => {
        console.log(`🌐 Health server running on http://localhost:${port}`);
    });

    return app;
}

module.exports = { startAuthServer };
