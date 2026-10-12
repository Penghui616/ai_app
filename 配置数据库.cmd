@echo off
cd /d "%~dp0"
"backend\.venv\Scripts\python.exe" -X utf8 -m backend.configure_mysql
pause
