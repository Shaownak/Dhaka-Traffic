@echo off
rem ============================================================
rem  Seven Kilometers an Hour - project launcher
rem
rem    start.bat              start the dev server and open default browser
rem    start.bat build        build the production site into dist\
rem    start.bat preview      serve the built production site
rem    start.bat test         run Vitest unit tests
rem    start.bat typecheck    run TypeScript compiler check (tsc --noEmit)
rem    start.bat check        typecheck, test, and build in one go
rem    start.bat install      re-install npm dependencies
rem    start.bat clean        remove dist\ build directory
rem    start.bat help         show available commands
rem
rem  Safe to double-click. Installs dependencies on first run.
rem ============================================================

setlocal
cd /d "%~dp0"

set "TASK=%~1"
if "%TASK%"=="" set "TASK=dev"

rem Normalize help flags
if "%TASK%"=="-h" goto :help
if "%TASK%"=="--help" goto :help
if "%TASK%"=="-help" goto :help
if "%TASK%"=="/?" goto :help
if "%TASK%"=="help" goto :help

rem --- Find Node & NPM (Desktop Environment) -----------------------
rem Prioritize portable Node if present in .\node\, then standard
rem system installations (e.g. C:\Program Files\nodejs), then user PATH.
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
for /d %%D in ("%~dp0node\node-v*") do if exist "%%D\node.exe" set "PATH=%%D;%PATH%"
if defined NODE_HOME if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if exist "%APPDATA%\npm" set "PATH=%APPDATA%\npm;%PATH%"
if exist "%~dp0node_modules\.bin" set "PATH=%~dp0node_modules\.bin;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto :no_node

where npm >nul 2>nul
if errorlevel 1 goto :no_npm

for /f "tokens=*" %%V in ('node -v') do set "NODE_VERSION=%%V"
for /f "tokens=*" %%V in ('npm -v') do set "NPM_VERSION=%%V"
echo [Environment] Node %NODE_VERSION% ^| npm %NPM_VERSION% ^| %CD%

rem --- Dependencies -------------------------------------------------
if not exist "node_modules\" (
    echo.
    echo Installing dependencies for first-time setup...
    call npm install --no-audit --no-fund
    if errorlevel 1 goto :failed
)

rem --- Route Tasks --------------------------------------------------
if /i "%TASK%"=="dev"       goto :dev
if /i "%TASK%"=="build"     goto :build
if /i "%TASK%"=="preview"   goto :preview
if /i "%TASK%"=="test"      goto :test
if /i "%TASK%"=="typecheck" goto :typecheck
if /i "%TASK%"=="check"     goto :check
if /i "%TASK%"=="install"   goto :install
if /i "%TASK%"=="clean"     goto :clean
if /i "%TASK%"=="api"       goto :api
if /i "%TASK%"=="journey"   goto :journey
if /i "%TASK%"=="audit"     goto :audit

echo.
echo [!] Unknown command "%TASK%".
goto :help

:dev
echo.
echo Starting Vite development server...
echo Press Ctrl+C in this window to stop the server.
call npm run dev -- --open
goto :done

:build
echo.
echo Building production bundle into dist\...
call npm run build
if errorlevel 1 goto :failed
echo.
echo [OK] Built into dist\. Run "start.bat preview" to test the build.
goto :done

:preview
echo.
echo Serving production build from dist\...
echo Press Ctrl+C in this window to stop.
call npm run preview -- --open
goto :done

:test
echo.
echo Running unit tests with Vitest...
call npm run test
if errorlevel 1 goto :failed
goto :done

:typecheck
echo.
echo Running TypeScript typecheck...
call npm run typecheck
if errorlevel 1 goto :failed
echo [OK] Typecheck passed without errors.
goto :done

:check
echo.
echo [1/3] Typechecking...
call npm run typecheck
if errorlevel 1 goto :failed
echo.
echo [2/3] Testing...
call npm run test
if errorlevel 1 goto :failed
echo.
echo [3/3] Building...
call npm run build
if errorlevel 1 goto :failed
echo.
echo ============================================================
echo [SUCCESS] Typecheck, tests, and production build all passed!
echo ============================================================
goto :done

:install
echo.
echo Reinstalling dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed
echo [OK] Dependencies installed successfully.
goto :done

:clean
echo.
if exist "dist\" (
    echo Removing dist\ directory...
    rd /s /q "dist"
    echo [OK] Cleaned dist\.
) else (
    echo [OK] dist\ directory does not exist. Nothing to clean.
)
goto :done

:api
echo.
echo Starting the journey API on http://localhost:8787 ...
echo Press Ctrl+C in this window to stop.
call npm run api
goto :done

:journey
rem Everything after the command word is passed straight to the planner, e.g.
rem   start.bat journey --from gulshan --to mirpur --at 17:00 --stop any
echo.
call npm run journey -- %2 %3 %4 %5 %6 %7 %8 %9
if errorlevel 1 goto :failed
goto :done

:audit
echo.
echo Auditing the routable network...
call npm run audit:network
if errorlevel 1 goto :failed
goto :done

:help
echo.
echo ============================================================
echo  Seven Kilometers an Hour - Launcher Usage:
echo ============================================================
echo    start.bat [task]
echo.
echo  Available Tasks:
echo    dev         Start Vite dev server and open browser (default)
echo    build       Compile production build into dist\
echo    preview     Preview production build in browser
echo    test        Run unit tests (Vitest)
echo    typecheck   Check TypeScript types without emitting files
echo    check       Run typecheck, tests, and build in sequence
echo    install     Install/refresh npm dependencies
echo    clean       Remove dist\ build artifacts
echo    api         Start the journey API (port 8787)
echo    journey     Plan a journey from the command line
echo    audit       Report gaps in the routable road network
echo    help        Show this help message
echo.
echo  Example:
echo    start.bat journey --from gulshan --to mirpur --at 17:00 --stop any
echo ============================================================
goto :done

:no_node
echo.
echo [ERROR] Node.js was not found in your environment or PATH.
echo.
echo Looked for:
echo   - C:\Program Files\nodejs\node.exe
echo   - Local portable node folder at %~dp0node\
echo   - System PATH
echo.
echo Please ensure Node.js (LTS version recommended) is installed from:
echo   https://nodejs.org/ or run: winget install OpenJS.NodeJS.LTS
echo.
goto :exit_pause

:no_npm
echo.
echo [ERROR] npm was not found, though Node was detected.
echo Please reinstall Node.js LTS to repair your npm installation.
echo.
goto :exit_pause

:failed
echo.
echo [ERROR] The task "%TASK%" failed. See error output above.
echo.
goto :exit_pause

:exit_pause
rem Pause on error only if launched by double-clicking in Explorer
echo %cmdcmdline% | find /i "%~f0" >nul
if not errorlevel 1 pause
exit /b 1

:done
rem If launched by double-clicking in Windows Explorer, pause before closing
rem so the window doesn't vanish immediately.
echo %cmdcmdline% | find /i "%~f0" >nul
if not errorlevel 1 (
    if /i not "%TASK%"=="dev" (
        if /i not "%TASK%"=="preview" (
            if /i not "%TASK%"=="api" (
                echo.
                pause
            )
        )
    )
)
endlocal
