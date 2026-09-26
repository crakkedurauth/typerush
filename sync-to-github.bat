@echo off
setlocal
cd /d "%~dp0"
echo === TypeRush GitHub sync ===
git status
echo.
set /p MSG=Commit message [Update TypeRush]: 
if "%MSG%"=="" set "MSG=Update TypeRush"
git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo No changes to commit, or Git reported an error.
  pause
  exit /b 1
)
git branch --show-current
for /f "delims=" %%B in ('git branch --show-current') do set BRANCH=%%B
git push origin %BRANCH%
if errorlevel 1 (
  echo.
  echo Push failed. If this is the first push, make sure the repo has origin configured.
  pause
  exit /b 1
)
echo.
echo Done. GitHub has been updated. Render should redeploy automatically if connected.
pause
