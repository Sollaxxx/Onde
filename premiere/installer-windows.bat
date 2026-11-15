@echo off
rem Installe le panneau Onde dans Premiere Pro (2019 et plus) pour l'utilisateur courant.
rem Le panneau n'est pas encore signe : on autorise les panneaux non signes (mode debug CEP).
set "DEST=%APPDATA%\Adobe\CEP\extensions\app.onde.premiere"
if exist "%DEST%" rmdir /S /Q "%DEST%"
xcopy "%~dp0cep" "%DEST%\" /E /I /Y /Q >nul
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo.
echo Panneau Onde installe dans :
echo   %DEST%
echo.
echo Redemarrez Premiere Pro, puis : Fenetre ^> Extensions ^> Onde
echo.
pause
