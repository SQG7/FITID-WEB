const fs = require("fs");
const path = require("path");

// Carrega um arquivo .env local sem dependência externa.
// Variáveis já definidas no sistema sempre têm prioridade.
function carregarEnvLocal() {
    const arquivo = path.join(__dirname, ".env");
    if (!fs.existsSync(arquivo)) return;

    const conteudo = fs.readFileSync(arquivo, "utf8");
    for (const linhaOriginal of conteudo.split(/\r?\n/)) {
        const linha = linhaOriginal.trim();
        if (!linha || linha.startsWith("#")) continue;

        const separador = linha.indexOf("=");
        if (separador <= 0) continue;

        const chave = linha.slice(0, separador).trim();
        let valor = linha.slice(separador + 1).trim();
        if (!chave || Object.prototype.hasOwnProperty.call(process.env, chave)) continue;

        if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
            valor = valor.slice(1, -1);
        }
        process.env[chave] = valor;
    }
}

carregarEnvLocal();
module.exports = { carregarEnvLocal };
