@echo off
rem ============================================================
rem  Seven Kilometers an Hour - project launcher
rem
rem    start.bat            start the dev server and open a browser
rem    start.bat build      build the production site into dist\
rem    start.bat preview    serve the built site
rem    start.bat test       run the unit tests
rem    start.bat check      typecheck, test and build in one go
rem
rem  Safe to double-click. Installs dependencies on first run.
rem ============================================================

setlocal
cd /d "%~dp0"

set "TASK=%~1"
if "%TASK%"=="" set "TASK=dev"

rem --- Find Node -------------------------------------------------
rem  A portable Node dropped in .\node\ is picked up automatically,
rem  so the project runs without installing anything system-wide.
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
for /d %%D in ("%~dp0node\node-v*") do if exist "%%D\node.exe" set "PATH=%%D;%PATH%"
if defined NODE_HOME if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto :no_node

for /f "tokens=*" %%V in ('node -v') do set "NODE_VERSION=%%V"
echo Node %NODE_VERSION%

rem --- Dependencies ----------------------------------------------
if not exist "node_modules\" (
    echo Installing dependencies. This happens once and takes a minute.
    call npm install --no-audit --no-fund
    if errorlevel 1 goto :failed
)

rem --- Run --------------------------------------------------------
if /i "%TASK%"=="dev"     goto :dev
if /i "%TASK%"=="build"   goto :build
if /i "%TASK%"=="preview" goto :preview
if /i "%TASK%"=="test"    goto :test
if /i "%TASK%"=="check"   goto :check

echo Unknown command "%TASK%".
echo Use: start.bat [dev^|build^|preview^|test^|check]
exit /b 1

:dev
echo Starting the dev server. Press Ctrl+C to stop.
call npm run dev -- --open
goto :done

:build
call npm run build
if errorlevel 1 goto :failed
echo.
echo Built into dist\. Run "start.bat preview" to look at it.
goto :done

:preview
call npm run preview
goto :done

:test
call npm run test
if errorlevel 1 goto :failed
goto :done

:check
call npm run typecheck
if errorlevel 1 goto :failed
call npm run test
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
echo.
echo Typecheck, tests and build all passed.
goto :done

:no_node
echo.
echo Node.js was not found.
echo.
echo Install it once with:
echo     winget install OpenJS.NodeJS.LTS
echo.
echo Then close this window, open a new one, and run start.bat again.
echo.
echo Alternatively, unzip a portable Node into a folder called "node"
echo next to this file and it will be picked up automatically.
echo.
pause
exit /b 1

:failed
echo.
echo That step failed. The output above says why.
echo.
pause
exit /b 1

:done
endlocal
