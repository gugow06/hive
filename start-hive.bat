@echo off
cd /d E:\LOCAL\Hive
E:\Local\nvm\v24.22.0\node.exe cli\node_modules\tsx\dist\cli.mjs cli\src\index.ts run > "%LOCALAPPDATA%\Temp\paperclip_hive.log" 2>&1
