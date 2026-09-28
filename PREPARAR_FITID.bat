@echo off
setlocal
chcp 65001 >nul
title FITID - Preparação antes da apresentação
cd /d "%~dp0"

echo =============================================
echo FITID - PREPARAÇÃO DO PROJETO
echo =============================================
where node >nul 2>nul || (echo ERRO: Node.js não encontrado. Instale o Node.js LTS. & pause & exit /b 1)
where npm >nul 2>nul || (echo ERRO: npm não encontrado. Reinstale o Node.js LTS. & pause & exit /b 1)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Arquivo .env criado com a configuração padrão do projeto.
  echo Se sua senha do MySQL root não for 1234, execute EDITAR_CONFIG_FITID.bat.
)

echo.
echo [1/2] Instalando dependências do backend...
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo npm ci não concluiu. Tentando npm install como compatibilidade...
  call npm install --no-audit --no-fund
)
if errorlevel 1 (echo ERRO na instalação do backend. Confira sua internet e tente novamente. & pause & exit /b 1)

echo.
echo [2/2] Instalando dependências do frontend React...
pushd "%~dp0fitid-react"
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo npm ci não concluiu. Tentando npm install como compatibilidade...
  call npm install --no-audit --no-fund
)
if errorlevel 1 (popd & echo ERRO na instalação do frontend. Confira sua internet e tente novamente. & pause & exit /b 1)
popd

echo.
echo =============================================
echo PREPARAÇÃO CONCLUÍDA

echo 1. Importe fitid.sql no MySQL Workbench.
echo 2. Se necessário, ajuste a senha em EDITAR_CONFIG_FITID.bat.
echo 3. Rode VERIFICAR_FITID.bat.
echo 4. Depois rode INICIAR_FITID.bat.
echo =============================================
pause
