@echo off
REM Certificate Lookup Server - Windows Batch Script

echo.
echo ============================================
echo  Certificate Lookup & Download Server
echo ============================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)

REM Install dependencies
echo Installing required packages...
python -m pip install -r requirements.txt --quiet

if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ✓ Dependencies installed successfully
echo.
echo Starting the server...
echo.
echo ============================================
echo  ✓ Server is running!
echo  ✓ Open your browser to: http://localhost:5000
echo  ✓ Press Ctrl+C to stop the server
echo ============================================
echo.

REM Run the Flask app
python app.py

pause
