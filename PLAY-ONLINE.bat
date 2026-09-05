@echo off
REM ============================================================
REM  Rank Up! — one-click ONLINE host
REM  Starts the room server (localhost:8833) and a public
REM  Cloudflare tunnel so friends can join over the internet.
REM  Leave this window OPEN while you play. Close it to go offline.
REM ============================================================
cd /d "%~dp0"

echo Starting the Rank Up! room server on http://localhost:8833 ...
start "Rank Up Room Server" cmd /c "node server\room-server.js"

REM give the server a moment to bind the port
timeout /t 2 /nobreak >nul

echo.
echo Opening the public tunnel. Your shareable link will appear below
echo as  https://SOMETHING.trycloudflare.com  — copy it and send it to
echo your friends. Everyone opens that link, picks a class, and enters
echo the SAME room code in the "Play Online" panel.
echo.
echo (The link is new every time you launch this. Keep this window open.)
echo ============================================================
echo.
cloudflared.exe tunnel --url http://localhost:8833 --no-autoupdate
