@echo off
REM Inicia o Hive DESTACADO (sobrevive ao fechamento desta janela).
REM Logs: %LOCALAPPDATA%\Temp\hive\hive-out.log / hive-err.log
powershell -NoProfile -ExecutionPolicy Bypass -File "E:\Local\hive\hive-start.ps1"
pause
