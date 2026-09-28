@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" copy /Y ".env.example" ".env" >nul
notepad ".env"
