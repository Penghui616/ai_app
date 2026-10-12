@echo off
cd /d "%~dp0"
"backend\.venv\Scripts\python.exe" -X utf8 -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log
pause
