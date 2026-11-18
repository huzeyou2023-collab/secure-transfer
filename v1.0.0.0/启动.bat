@echo off
cd /d "%~dp0"
py -3 -c "import cryptography,tkinterdnd2" 1>nul 2>nul
if errorlevel 1 py -3 -m pip install -r requirements.txt
start "" pyw -3 "%~dp0secure_transfer.py"
