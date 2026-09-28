@echo off
setlocal
chcp 65001 >nul
title FITID - Verificação técnica
cd /d "%~dp0"

echo =============================================
echo FITID - VERIFICAÇÃO TÉCNICA

echo =============================================
where node >nul 2>nul || (echo ERRO: Node.js não encontrado. & pause & exit /b 1)
where npm >nul 2>nul || (echo ERRO: npm não encontrado. & pause & exit /b 1)
if not exist "node_modules" (echo ERRO: dependências do backend ausentes. Rode PREPARAR_FITID.bat. & pause & exit /b 1)
if not exist "fitid-react\node_modules" (echo ERRO: dependências do React ausentes. Rode PREPARAR_FITID.bat. & pause & exit /b 1)

echo [1/3] Verificando sintaxe do backend...
call npm run check
if errorlevel 1 (echo ERRO NO BACKEND & pause & exit /b 1)

echo.
echo [2/3] Verificando TypeScript do React...
pushd "%~dp0fitid-react"
call npm run check
if errorlevel 1 (popd & echo ERRO NO TYPESCRIPT DO FRONTEND & pause & exit /b 1)

echo.
echo [3/3] Gerando build do React...
call npm run build
if errorlevel 1 (popd & echo ERRO NO BUILD DO FRONTEND & pause & exit /b 1)
popd

echo.
echo =============================================
echo VERIFICAÇÃO CONCLUÍDA SEM ERROS.
echo Agora teste o sistema com INICIAR_FITID.bat.
echo =============================================
pause
