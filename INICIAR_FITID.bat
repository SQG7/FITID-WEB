@echo off
setlocal
chcp 65001 >nul
title FITID - Inicializador
cd /d "%~dp0"

where node >nul 2>nul || (echo ERRO: Node.js não encontrado. & pause & exit /b 1)
where npm >nul 2>nul || (echo ERRO: npm não encontrado. & pause & exit /b 1)
if not exist "node_modules" (
  echo Dependências do backend não encontradas.
  echo Execute PREPARAR_FITID.bat antes.
  pause
  exit /b 1
)
if not exist "fitid-react\node_modules" (
  echo Dependências do React não encontradas.
  echo Execute PREPARAR_FITID.bat antes.
  pause
  exit /b 1
)
if not exist ".env" copy /Y ".env.example" ".env" >nul

echo Verificando se as portas 3000 e 5173 estão livres...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-NetTCPConnection -State Listen -LocalPort 3000,5173 -ErrorAction SilentlyContinue; if($p){exit 1}else{exit 0}" >nul 2>nul
if errorlevel 1 (
  echo ERRO: a porta 3000 ou 5173 já está em uso.
  echo Feche instâncias antigas do FITID/Node/Vite e tente novamente.
  pause
  exit /b 1
)

echo Iniciando backend e frontend...
start "FITID - Backend" /D "%~dp0" cmd /k "npm start"
start "FITID - React" /D "%~dp0fitid-react" cmd /k "npm run dev"

echo Aguardando API, MySQL e React ficarem prontos...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 35;$i++){ try { $r=Invoke-RestMethod -Uri 'http://localhost:3000/diagnostico' -TimeoutSec 2; if($r.sucesso -eq $true -and $r.banco -eq 'conectado'){ $ok=$true; break } } catch {}; Start-Sleep -Seconds 1 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 (
  echo.
  echo ERRO: o backend abriu, mas o diagnóstico não confirmou o MySQL.
  echo Confira se o serviço MySQL está ligado, se o banco fitid foi importado e se o .env está correto.
  start "" "http://localhost:3000/diagnostico"
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 25;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Seconds 1 }; if($ok){exit 0}else{exit 1}"
if errorlevel 1 (
  echo.
  echo ERRO: o frontend React não respondeu na porta 5173.
  echo Confira a janela FITID - React e rode VERIFICAR_FITID.bat se necessário.
  pause
  exit /b 1
)

echo.
echo FITID pronto: banco, API e frontend responderam corretamente.
start "" "http://localhost:5173"
echo Mantenha as janelas FITID - Backend e FITID - React abertas durante a apresentação.
