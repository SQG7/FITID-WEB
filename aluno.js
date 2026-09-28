const socket = io();
let alunoAtual = null;

function escapeHTML(valor) {
    return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function verificarAlunoLogado() {
    const resposta = await fetch("/aluno-logado");
    if (!resposta.ok) {
        window.location.href = "aluno-login.html";
        return null;
    }

    const dados = await resposta.json();
    if (!dados.logado || !dados.aluno) {
        window.location.href = "aluno-login.html";
        return null;
    }

    alunoAtual = dados.aluno;
    document.getElementById("nomeAlunoApp").innerText = `Olá, ${alunoAtual.nome}`;

    const subtitulo = document.querySelector(".aluno-header-page p");
    if (subtitulo) {
        subtitulo.innerText = `Academia: ${alunoAtual.academia_nome} • acompanhe seus treinos, histórico, desempenho e lotação.`;
    }

    document.getElementById("linkRelatorioAluno").href = `/relatorio/${alunoAtual.id}`;

    const linkLotacao = document.querySelector(".aluno-header-actions a");
    if (linkLotacao) linkLotacao.href = `publico.html?academia=${alunoAtual.academia_codigo}`;

    return alunoAtual;
}

async function carregarEstatisticasAluno() {
    const resposta = await fetch(`/estatisticas-avancadas/${alunoAtual.id}`);
    const dados = await resposta.json();
    const resumo = dados.resumo;
    const favorito = dados.favorito;
    const ultimo = dados.ultimo;
    const estatisticas = document.getElementById("estatisticasAluno");

    estatisticas.innerHTML = `
        <div class="estatistica"><h3>Execuções</h3><p>${resumo.total_treinos}</p><small>Exercícios concluídos</small></div>
        <div class="estatistica"><h3>Favorito</h3><p>${escapeHTML(favorito.exercicio)}</p><small>${favorito.total} execuções</small></div>
        <div class="estatistica"><h3>Variações</h3><p>${resumo.exercicios_diferentes}</p><small>Exercícios diferentes</small></div>
        <div class="estatistica"><h3>Último</h3><p>${escapeHTML(ultimo.exercicio || "Nenhum")}</p><small>Último exercício registrado</small></div>
    `;
}

function agruparPorPlano(treinos) {
    const mapa = new Map();
    treinos.forEach(item => {
        if (!mapa.has(item.plano_id)) {
            mapa.set(item.plano_id, {
                nome: item.plano_nome,
                objetivo: item.objetivo,
                exercicios: []
            });
        }
        mapa.get(item.plano_id).exercicios.push(item);
    });
    return Array.from(mapa.values());
}

async function carregarTreinoAtual() {
    const resposta = await fetch(`/alunos/${alunoAtual.id}/treinos`);
    const treinos = await resposta.json();
    const div = document.getElementById("treinoAtual");

    if (!treinos || treinos.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum treino cadastrado para este aluno.</p>`;
        return;
    }

    const planos = agruparPorPlano(treinos);

    div.innerHTML = planos.map(plano => `
        <div class="aluno-treino-card aluno-plano-card">
            <h3>${escapeHTML(plano.nome)}</h3>
            <p>${plano.exercicios.length} exercício(s)${plano.objetivo ? " • " + escapeHTML(plano.objetivo) : ""}</p>
            <div class="aluno-aparelhos-mini">
                ${plano.exercicios.map(treino => `
                    <div class="aluno-aparelho-mini">
                        <span>
                            <strong>${treino.ordem || ""}. ${escapeHTML(treino.exercicio)}</strong><br>
                            <small>Pode ser feito em ${escapeHTML(treino.grupo_nome)} • ${treino.series} séries • ${treino.repeticoes} repetições</small>
                        </span>
                    </div>
                `).join("")}
            </div>
        </div>
    `).join("") + `
        <div class="aluno-acoes-treino">
            <a href="simulador.html?academia=${encodeURIComponent(alunoAtual.academia_codigo)}" class="secondary-btn">Abrir Simulador do Aparelho</a>
            <small>No uso real, o aluno aproxima a pulseira no aparelho físico. No protótipo, selecione o aparelho no simulador.</small>
        </div>
    `;
}

async function carregarLotacao() {
    const resposta = await fetch(`/aparelhos-publicos/${alunoAtual.academia_codigo}`);
    const aparelhos = await resposta.json();
    const total = aparelhos.length;
    const ocupados = aparelhos.filter(item => item.status === "ocupado").length;
    const livres = aparelhos.filter(item => item.status === "livre").length;
    const indisponiveis = aparelhos.filter(item => item.status === "manutencao" || item.status === "offline").length;
    const porcentagem = total > 0 ? Math.round((ocupados / total) * 100) : 0;

    document.getElementById("lotacaoAluno").innerHTML = `
        <div class="aluno-lotacao-numero">${porcentagem}%</div>
        <p>${livres} livres • ${ocupados} ocupados • ${indisponiveis} indisponíveis</p>
        <div class="aluno-aparelhos-mini">
            ${aparelhos.map(aparelho => `
                <div class="aluno-aparelho-mini">
                    <span>${escapeHTML(aparelho.nome)} <small>(${escapeHTML(aparelho.grupo_nome)})</small></span>
                    <strong class="${aparelho.status}">${escapeHTML(aparelho.status)}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

async function carregarHistoricoRecente() {
    const resposta = await fetch(`/alunos/${alunoAtual.id}/historico-recente`);
    const historico = await resposta.json();
    const div = document.getElementById("historicoAluno");

    if (!historico || historico.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum histórico registrado ainda.</p>`;
        return;
    }

    div.innerHTML = "";
    historico.forEach(item => {
        const data = new Date(item.data_execucao);
        const dataFormatada = data.toLocaleString("pt-BR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
        });

        div.innerHTML += `
            <div class="dashboard-list-item">
                <div>
                    <strong>${escapeHTML(item.exercicio)}</strong>
                    <span>${item.aparelho_nome ? escapeHTML(item.aparelho_nome) + " • " : ""}${dataFormatada}</span>
                </div>
            </div>
        `;
    });
}

async function sairAluno() {
    await fetch("/logout-aluno", { method: "POST" });
    window.location.href = "aluno-login.html";
}

async function iniciarAreaAluno() {
    const aluno = await verificarAlunoLogado();
    if (!aluno) return;
    await carregarEstatisticasAluno();
    await carregarTreinoAtual();
    await carregarLotacao();
    await carregarHistoricoRecente();
}

socket.on("atualizar-aparelhos", () => carregarLotacao());
socket.on("atualizar-dashboard", () => {
    carregarEstatisticasAluno();
    carregarHistoricoRecente();
});

document.getElementById("btnSairAluno").addEventListener("click", sairAluno);
iniciarAreaAluno();
