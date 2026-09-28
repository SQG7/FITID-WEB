const socket = io();

const params = new URLSearchParams(window.location.search);
const codigoAcademia = params.get("academia") || "fitcenter";

function escapeHTML(valor) {
    return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function textoStatus(status) {
    const mapa = {
        livre: "LIVRE",
        ocupado: "OCUPADO",
        manutencao: "MANUTENÇÃO",
        offline: "OFFLINE"
    };
    return mapa[status] || String(status).toUpperCase();
}

async function carregarAparelhos() {
    const respostaAcademia = await fetch(`/academias/${codigoAcademia}`);
    if (respostaAcademia.ok) {
        const academia = await respostaAcademia.json();
        const titulo = document.querySelector(".public-header h1");
        if (titulo) titulo.innerText = `Lotação - ${academia.nome}`;
    }

    const resposta = await fetch(`/aparelhos-publicos/${codigoAcademia}`);
    const aparelhos = await resposta.json();
    const total = aparelhos.length;
    const ocupados = aparelhos.filter(a => a.status === "ocupado").length;
    const livres = aparelhos.filter(a => a.status === "livre").length;
    const indisponiveis = aparelhos.filter(a => a.status === "manutencao" || a.status === "offline").length;
    const porcentagem = total > 0 ? Math.round((ocupados / total) * 100) : 0;

    document.getElementById("estatisticas").innerHTML = `
        <div class="estatistica"><h3>Total</h3><p>${total}</p></div>
        <div class="estatistica"><h3>Ocupados</h3><p>${ocupados}</p></div>
        <div class="estatistica"><h3>Livres</h3><p>${livres}</p></div>
        <div class="estatistica"><h3>Indisponíveis</h3><p>${indisponiveis}</p></div>
        <div class="estatistica"><h3>Lotação</h3><p>${porcentagem}%</p></div>
    `;

    const div = document.getElementById("aparelhos");
    div.innerHTML = "";

    aparelhos.forEach(aparelho => {
        div.innerHTML += `
            <div class="aparelho">
                <h3>${escapeHTML(aparelho.nome)}</h3>
                <p>Serve para exercícios de: ${escapeHTML(aparelho.grupo_nome)}</p>
                <div class="status ${aparelho.status}">${textoStatus(aparelho.status)}</div>
            </div>
        `;
    });
}

carregarAparelhos();
socket.on("atualizar-aparelhos", () => carregarAparelhos());
