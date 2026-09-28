const socket = io();

let alunosCache = [];
let gruposCache = [];
let aparelhosCache = [];
let exerciciosCache = [];
let planosCache = [];
let treinosCache = [];
let dashboardCache = null;
let usuarioLogado = null;

function escapeHTML(valor) {
    return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(url, opcoes = {}) {
    const resposta = await fetch(url, opcoes);
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados.mensagem || "Erro na operação.");
    return dados;
}

function textoStatus(status) {
    const mapa = {
        ativo: "Ativo",
        inativo: "Inativo",
        livre: "Livre",
        ocupado: "Ocupado",
        manutencao: "Manutenção",
        offline: "Offline"
    };
    return mapa[status] || status;
}

function optionPadrao(texto) {
    return `<option value="">${texto}</option>`;
}

function filtrarLista(lista, termo, campos) {
    const busca = String(termo || "").toLowerCase().trim();
    if (!busca) return lista;
    return lista.filter(item => campos.some(campo => String(item[campo] || "").toLowerCase().includes(busca)));
}

function grupoNomePorId(id) {
    return gruposCache.find(g => String(g.id) === String(id))?.nome || "Grupo não encontrado";
}

async function verificarUsuarioLogado() {
    const resposta = await fetch("/usuario-logado");
    if (!resposta.ok) {
        window.location.href = "login.html";
        return false;
    }

    const dados = await resposta.json();
    if (!dados.logado || !dados.usuario) {
        window.location.href = "login.html";
        return false;
    }

    usuarioLogado = dados.usuario;
    const titulo = document.querySelector(".dashboard-header h1");
    const subtitulo = document.querySelector(".dashboard-header p");

    if (titulo) titulo.innerText = usuarioLogado.academia_nome;
    if (subtitulo) subtitulo.innerText = `Login único da academia • ${usuarioLogado.email}`;

    return true;
}

function configurarAbas() {
    document.querySelectorAll(".menu-item[data-section]").forEach(link => {
        link.addEventListener("click", (evento) => {
            evento.preventDefault();
            const id = link.dataset.section;

            document.querySelectorAll(".menu-item").forEach(item => item.classList.remove("active"));
            link.classList.add("active");

            document.querySelectorAll(".painel-section").forEach(secao => secao.classList.remove("active-section"));
            document.getElementById(id)?.classList.add("active-section");
        });
    });
}

function atualizarSelects() {
    const selectAlunoPlano = document.getElementById("plano_aluno_id");
    const selectPlano = document.getElementById("plano_id");
    const selectExercicio = document.getElementById("exercicio_id");
    const selectGrupoAparelho = document.getElementById("aparelho_grupo_id");
    const selectGrupoExercicio = document.getElementById("exercicio_base_grupo_id");

    const alunosAtivos = alunosCache.filter(aluno => aluno.status === "ativo");

    if (selectAlunoPlano) {
        selectAlunoPlano.innerHTML = optionPadrao("Selecione o aluno") + alunosAtivos.map(aluno => `
            <option value="${aluno.id}">${escapeHTML(aluno.nome)} • ID ${aluno.id}</option>
        `).join("");
    }

    if (selectPlano) {
        selectPlano.innerHTML = optionPadrao("Selecione o treino") + planosCache.map(plano => `
            <option value="${plano.id}">${escapeHTML(plano.nome)} • ${escapeHTML(plano.aluno_nome)}</option>
        `).join("");
    }

    if (selectExercicio) {
        selectExercicio.innerHTML = optionPadrao("Selecione o exercício da biblioteca") + exerciciosCache.map(exercicio => `
            <option value="${exercicio.id}">${escapeHTML(exercicio.nome)} • ${escapeHTML(exercicio.grupo_nome)}</option>
        `).join("");
    }

    const opcoesGrupos = optionPadrao("Serve para exercícios de...") + gruposCache.map(grupo => `
        <option value="${grupo.id}">${escapeHTML(grupo.nome)}</option>
    `).join("");

    if (selectGrupoAparelho) selectGrupoAparelho.innerHTML = opcoesGrupos;
    if (selectGrupoExercicio) selectGrupoExercicio.innerHTML = optionPadrao("Pode ser feito em...") + gruposCache.map(grupo => `
        <option value="${grupo.id}">${escapeHTML(grupo.nome)}</option>
    `).join("");
}

async function carregarGrupos() {
    gruposCache = await api("/grupos-equipamento");
    renderizarGrupos();
    atualizarSelects();
}

function renderizarGrupos() {
    const div = document.getElementById("gruposLista");
    if (!div) return;
    div.innerHTML = "";

    if (gruposCache.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum grupo cadastrado.</p>`;
        return;
    }

    gruposCache.forEach(grupo => {
        div.innerHTML += `
            <div class="dashboard-list-item">
                <div>
                    <strong>${escapeHTML(grupo.nome)}</strong>
                    <span>Grupo usado para conectar aparelhos físicos e exercícios compatíveis.</span>
                </div>
                <div class="crud-actions">
                    <button class="edit-btn" onclick="editarGrupo(${grupo.id})">Editar</button>
                    <button class="danger-btn" onclick="removerGrupo(${grupo.id})">Remover</button>
                </div>
            </div>
        `;
    });
}

async function carregarAlunos() {
    alunosCache = await api("/alunos");
    renderizarAlunos();
    atualizarSelects();
    atualizarKPIs();
}

function renderizarAlunos() {
    const div = document.getElementById("alunosLista");
    if (!div) return;
    const busca = document.getElementById("buscaAlunos")?.value || "";
    const lista = filtrarLista(alunosCache, busca, ["nome", "rfid", "status"]);
    div.innerHTML = "";

    if (lista.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum aluno encontrado.</p>`;
        return;
    }

    lista.forEach(aluno => {
        div.innerHTML += `
            <div class="card">
                <h3>${escapeHTML(aluno.nome)}</h3>
                <p>ID: ${aluno.id}</p>
                <p>RFID: ${escapeHTML(aluno.rfid)}</p>
                <span class="status-pill ${aluno.status}">${textoStatus(aluno.status)}</span>
                <div class="crud-actions">
                    <button class="edit-btn" onclick="editarAluno(${aluno.id})">Editar</button>
                    <button class="danger-btn" onclick="removerAluno(${aluno.id})">Remover</button>
                </div>
            </div>
        `;
    });
}

async function carregarAparelhos() {
    aparelhosCache = await api("/aparelhos");
    renderizarAparelhos();
    atualizarSelects();
    atualizarKPIs();
}

function renderizarAparelhos() {
    const div = document.getElementById("aparelhosLista");
    if (!div) return;
    const busca = document.getElementById("buscaAparelhos")?.value || "";
    const lista = filtrarLista(aparelhosCache, busca, ["nome", "grupo_nome", "status"]);
    div.innerHTML = "";

    if (lista.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum aparelho encontrado.</p>`;
        return;
    }

    lista.forEach(aparelho => {
        div.innerHTML += `
            <div class="aparelho">
                <h3>${escapeHTML(aparelho.nome)}</h3>
                <p>Serve para exercícios de: ${escapeHTML(aparelho.grupo_nome)}</p>
                <p>ID físico: ${aparelho.id}</p>
                <div class="status ${aparelho.status}">${textoStatus(aparelho.status).toUpperCase()}</div>
                <div class="crud-actions">
                    <button class="edit-btn" onclick="editarAparelho(${aparelho.id})">Editar</button>
                    <button class="danger-btn" onclick="removerAparelho(${aparelho.id})">Remover</button>
                </div>
            </div>
        `;
    });
}

async function carregarExerciciosBase() {
    exerciciosCache = await api("/exercicios");
    renderizarExerciciosBase();
    atualizarSelects();
}

function renderizarExerciciosBase() {
    const div = document.getElementById("exerciciosBaseLista");
    if (!div) return;
    const busca = document.getElementById("buscaExercicios")?.value || "";
    const lista = filtrarLista(exerciciosCache, busca, ["nome", "grupo_nome", "descricao"]);
    div.innerHTML = "";

    if (lista.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum exercício encontrado.</p>`;
        return;
    }

    lista.forEach(exercicio => {
        div.innerHTML += `
            <div class="card">
                <h3>${escapeHTML(exercicio.nome)}</h3>
                <p>Pode ser feito em: ${escapeHTML(exercicio.grupo_nome)}</p>
                <p>${escapeHTML(exercicio.descricao || "Sem descrição.")}</p>
                <div class="crud-actions">
                    <button class="edit-btn" onclick="editarExercicioBase(${exercicio.id})">Editar</button>
                    <button class="danger-btn" onclick="removerExercicioBase(${exercicio.id})">Remover</button>
                </div>
            </div>
        `;
    });
}

async function carregarPlanosTreino() {
    planosCache = await api("/planos-treino");
    atualizarSelects();
    renderizarTreinosAgrupados();
    atualizarKPIs();
}

async function carregarTreinos() {
    treinosCache = await api("/treinos");
    renderizarTreinosAgrupados();
    atualizarKPIs();
}

function agruparTreinos() {
    const mapa = new Map();

    planosCache.forEach(plano => {
        mapa.set(plano.id, {
            ...plano,
            exercicios: []
        });
    });

    treinosCache.forEach(item => {
        if (!mapa.has(item.plano_id)) {
            mapa.set(item.plano_id, {
                id: item.plano_id,
                nome: item.plano_nome,
                objetivo: item.objetivo,
                aluno_id: item.aluno_id,
                aluno_nome: item.aluno_nome,
                aluno_status: item.aluno_status,
                exercicios: []
            });
        }
        mapa.get(item.plano_id).exercicios.push(item);
    });

    return Array.from(mapa.values());
}

function renderizarTreinosAgrupados() {
    const div = document.getElementById("treinosAgrupadosLista");
    if (!div) return;

    const busca = String(document.getElementById("buscaTreinos")?.value || "").toLowerCase().trim();
    let treinos = agruparTreinos();

    if (busca) {
        treinos = treinos.filter(plano => {
            const textoPlano = `${plano.nome} ${plano.objetivo || ""} ${plano.aluno_nome || ""}`.toLowerCase();
            const textoExercicios = plano.exercicios.map(e => `${e.exercicio} ${e.grupo_nome}`).join(" ").toLowerCase();
            return textoPlano.includes(busca) || textoExercicios.includes(busca);
        });
    }

    div.innerHTML = "";

    if (treinos.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum treino encontrado.</p>`;
        return;
    }

    treinos.forEach(plano => {
        const exerciciosHtml = plano.exercicios.length === 0
            ? `<p class="lista-vazia">Nenhum exercício adicionado ainda.</p>`
            : plano.exercicios.map(item => `
                <div class="treino-exercicio-row">
                    <div>
                        <strong>${item.ordem || ""}. ${escapeHTML(item.exercicio)}</strong>
                        <span>${escapeHTML(item.grupo_nome)} • ${item.series} séries • ${item.repeticoes} repetições</span>
                    </div>
                    <div class="crud-actions">
                        <button class="edit-btn" onclick="editarItemTreino(${item.id})">Editar</button>
                        <button class="danger-btn" onclick="removerItemTreino(${item.id})">Remover</button>
                    </div>
                </div>
            `).join("");

        div.innerHTML += `
            <article class="treino-card">
                <div class="treino-card-header">
                    <div>
                        <h3>${escapeHTML(plano.nome)}</h3>
                        <p>Aluno: ${escapeHTML(plano.aluno_nome || "Aluno não encontrado")} • Objetivo: ${escapeHTML(plano.objetivo || "Não informado")}</p>
                    </div>
                    <div class="crud-actions">
                        <button class="edit-btn" onclick="editarPlanoTreino(${plano.id})">Editar treino</button>
                        <button class="danger-btn" onclick="removerPlanoTreino(${plano.id})">Remover treino</button>
                    </div>
                </div>
                <div class="treino-exercicios-lista">
                    ${exerciciosHtml}
                </div>
            </article>
        `;
    });
}

async function carregarDashboardInteligente() {
    dashboardCache = await api("/dashboard-inteligente");
    atualizarKPIs();
    carregarHistoricoRecente(dashboardCache.historicoRecente);
    carregarAlunosAtivos(dashboardCache.alunosAtivos);
}

function atualizarKPIs() {
    const totalAlunos = alunosCache.length;
    const alunosAtivos = alunosCache.filter(aluno => aluno.status === "ativo").length;
    const totalGrupos = gruposCache.length;
    const totalExercicios = exerciciosCache.length;
    const totalPlanos = planosCache.length;
    const totalAparelhos = aparelhosCache.length;
    const ocupados = aparelhosCache.filter(aparelho => aparelho.status === "ocupado").length;
    const livres = aparelhosCache.filter(aparelho => aparelho.status === "livre").length;
    const manutencao = aparelhosCache.filter(aparelho => aparelho.status === "manutencao" || aparelho.status === "offline").length;
    const lotacao = totalAparelhos > 0 ? Math.round((ocupados / totalAparelhos) * 100) : 0;
    const checkinsHoje = dashboardCache ? dashboardCache.checkinsHoje.total : 0;
    const exercicioMaisUsado = dashboardCache && dashboardCache.exercicioMaisUsado ? dashboardCache.exercicioMaisUsado.exercicio : "Nenhum";
    const ultimoAluno = dashboardCache && dashboardCache.ultimoAluno ? dashboardCache.ultimoAluno.nome : "Nenhum";

    const estatisticas = document.getElementById("estatisticas");
    if (!estatisticas) return;

    estatisticas.innerHTML = `
        <div class="estatistica"><h3>Alunos</h3><p>${alunosAtivos}</p><small>${totalAlunos} cadastros ativos/visíveis</small></div>
        <div class="estatistica"><h3>Grupos</h3><p>${totalGrupos}</p><small>Compatibilidades</small></div>
        <div class="estatistica"><h3>Aparelhos</h3><p>${totalAparelhos}</p><small>Equipamentos físicos</small></div>
        <div class="estatistica"><h3>Exercícios</h3><p>${totalExercicios}</p><small>Biblioteca da academia</small></div>
        <div class="estatistica"><h3>Treinos</h3><p>${totalPlanos}</p><small>Planos dos alunos</small></div>
        <div class="estatistica"><h3>Check-ins Hoje</h3><p>${checkinsHoje}</p><small>Exercícios concluídos</small></div>
        <div class="estatistica"><h3>Livres</h3><p>${livres}</p><small>Disponíveis agora</small></div>
        <div class="estatistica"><h3>Ocupados</h3><p>${ocupados}</p><small>Em uso agora</small></div>
        <div class="estatistica"><h3>Indisponíveis</h3><p>${manutencao}</p><small>Manutenção/offline</small></div>
        <div class="estatistica"><h3>Lotação</h3><p>${lotacao}%</p><small>Taxa atual</small></div>
        <div class="estatistica"><h3>Mais Usado</h3><p>${escapeHTML(exercicioMaisUsado)}</p><small>Exercício destaque</small></div>
        <div class="estatistica"><h3>Último Aluno</h3><p>${escapeHTML(ultimoAluno)}</p><small>Identificado no sistema</small></div>
    `;
}

function carregarHistoricoRecente(historico) {
    const div = document.getElementById("historicoRecente");
    if (!div) return;
    div.innerHTML = "";

    if (!historico || historico.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum histórico registrado.</p>`;
        return;
    }

    historico.forEach(item => {
        const data = new Date(item.data_execucao);
        const horario = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        div.innerHTML += `
            <div class="dashboard-list-item">
                <div>
                    <strong>${escapeHTML(item.nome)}</strong>
                    <span>${escapeHTML(item.exercicio)}${item.aparelho_nome ? " • " + escapeHTML(item.aparelho_nome) : ""}</span>
                </div>
                <small>${horario}</small>
            </div>
        `;
    });
}

function carregarAlunosAtivos(alunos) {
    const div = document.getElementById("alunosAtivos");
    if (!div) return;
    div.innerHTML = "";

    if (!alunos || alunos.length === 0) {
        div.innerHTML = `<p class="lista-vazia">Nenhum aluno ativo ainda.</p>`;
        return;
    }

    alunos.forEach((aluno, index) => {
        div.innerHTML += `
            <div class="dashboard-list-item">
                <div>
                    <strong>${index + 1}º ${escapeHTML(aluno.nome)}</strong>
                    <span>${aluno.total} execuções</span>
                </div>
            </div>
        `;
    });
}

// =============================
// CADASTROS
// =============================

document.getElementById("formAluno").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("nome").value.trim();
    const rfid = document.getElementById("rfid").value.trim();
    const status = document.getElementById("aluno_status").value;
    if (!nome || !rfid) return alert("Preencha nome e RFID.");

    try {
        await api("/alunos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, rfid, status })
        });
        document.getElementById("formAluno").reset();
        await carregarAlunos();
    } catch (erro) { alert(erro.message); }
});

document.getElementById("formGrupo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("grupo_nome").value.trim();
    if (!nome) return alert("Digite o nome do grupo.");

    try {
        await api("/grupos-equipamento", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome })
        });
        document.getElementById("formGrupo").reset();
        await carregarGrupos();
    } catch (erro) { alert(erro.message); }
});

document.getElementById("formAparelho").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("aparelho_nome").value.trim();
    const grupo_id = document.getElementById("aparelho_grupo_id").value;
    const status = document.getElementById("aparelho_status").value;
    if (!nome || !grupo_id) return alert("Preencha o nome e o grupo do aparelho.");

    try {
        await api("/aparelhos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, grupo_id, status })
        });
        document.getElementById("formAparelho").reset();
        await carregarAparelhos();
        await carregarDashboardInteligente();
    } catch (erro) { alert(erro.message); }
});

document.getElementById("formExercicioBase").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("exercicio_base_nome").value.trim();
    const grupo_id = document.getElementById("exercicio_base_grupo_id").value;
    const gif = document.getElementById("exercicio_base_gif").value.trim();
    const descricao = document.getElementById("exercicio_base_descricao").value.trim();
    if (!nome || !grupo_id) return alert("Preencha o nome do exercício e onde ele pode ser feito.");

    try {
        await api("/exercicios", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, grupo_id, gif, descricao })
        });
        document.getElementById("formExercicioBase").reset();
        await carregarExerciciosBase();
    } catch (erro) { alert(erro.message); }
});

document.getElementById("formPlanoTreino").addEventListener("submit", async (e) => {
    e.preventDefault();
    const aluno_id = document.getElementById("plano_aluno_id").value;
    const nome = document.getElementById("plano_nome").value.trim();
    const objetivo = document.getElementById("plano_objetivo").value.trim();
    if (!aluno_id || !nome) return alert("Selecione o aluno e informe o nome do treino.");

    try {
        await api("/planos-treino", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aluno_id, nome, objetivo })
        });
        document.getElementById("formPlanoTreino").reset();
        await carregarPlanosTreino();
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
});

document.getElementById("formTreino").addEventListener("submit", async (e) => {
    e.preventDefault();
    const plano_id = document.getElementById("plano_id").value;
    const exercicio_id = document.getElementById("exercicio_id").value;
    const series = document.getElementById("series").value;
    const repeticoes = document.getElementById("repeticoes").value;
    const ordem = document.getElementById("ordem").value || 1;
    if (!plano_id || !exercicio_id || !series || !repeticoes) return alert("Preencha treino, exercício, séries e repetições.");

    try {
        await api("/treinos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plano_id, exercicio_id, series, repeticoes, ordem })
        });
        document.getElementById("formTreino").reset();
        document.getElementById("ordem").value = 1;
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
});

// =============================
// EDIÇÃO / REMOÇÃO
// =============================

async function editarAluno(id) {
    const aluno = alunosCache.find(item => item.id === id);
    if (!aluno) return;

    const nome = prompt("Nome do aluno:", aluno.nome);
    if (nome === null) return;
    const rfid = prompt("RFID do aluno:", aluno.rfid);
    if (rfid === null) return;
    const status = prompt("Status do aluno: ativo ou inativo", aluno.status);
    if (status === null) return;

    try {
        await api(`/alunos/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim(), rfid: rfid.trim(), status: status.trim().toLowerCase() })
        });
        await carregarAlunos();
    } catch (erro) { alert(erro.message); }
}

async function removerAluno(id) {
    if (!confirm("Remover este aluno do cadastro visível? O histórico antigo será preservado.")) return;
    try {
        await api(`/alunos/${id}`, { method: "DELETE" });
        await carregarAlunos();
        await carregarPlanosTreino();
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

async function editarGrupo(id) {
    const grupo = gruposCache.find(item => item.id === id);
    if (!grupo) return;
    const nome = prompt("Nome do grupo:", grupo.nome);
    if (nome === null) return;

    try {
        await api(`/grupos-equipamento/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim() })
        });
        await carregarGrupos();
        await carregarAparelhos();
        await carregarExerciciosBase();
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

async function removerGrupo(id) {
    if (!confirm("Remover este grupo? Só será permitido se não houver aparelhos ou exercícios usando ele.")) return;
    try {
        await api(`/grupos-equipamento/${id}`, { method: "DELETE" });
        await carregarGrupos();
    } catch (erro) { alert(erro.message); }
}

async function editarAparelho(id) {
    const aparelho = aparelhosCache.find(item => item.id === id);
    if (!aparelho) return;

    const nome = prompt("Nome do aparelho físico:", aparelho.nome);
    if (nome === null) return;
    const grupoId = prompt("ID do grupo em que este aparelho se encaixa:", aparelho.grupo_id);
    if (grupoId === null) return;
    if (aparelho.status === "ocupado") {
        alert("Este aparelho está ocupado por uma sessão RFID. Finalize ou libere a sessão antes de editar.");
        return;
    }
    const status = prompt("Status: livre, manutencao ou offline", aparelho.status);
    if (status === null) return;

    try {
        await api(`/aparelhos/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim(), grupo_id: grupoId.trim(), status: status.trim().toLowerCase() })
        });
        await carregarAparelhos();
        await carregarDashboardInteligente();
    } catch (erro) { alert(erro.message); }
}

async function removerAparelho(id) {
    if (!confirm("Remover este aparelho do cadastro ativo? O histórico antigo será preservado.")) return;
    try {
        await api(`/aparelhos/${id}`, { method: "DELETE" });
        await carregarAparelhos();
        await carregarDashboardInteligente();
    } catch (erro) { alert(erro.message); }
}

async function editarExercicioBase(id) {
    const exercicio = exerciciosCache.find(item => item.id === id);
    if (!exercicio) return;

    const nome = prompt("Nome do exercício:", exercicio.nome);
    if (nome === null) return;
    const grupoId = prompt("ID do grupo onde esse exercício pode ser feito:", exercicio.grupo_id);
    if (grupoId === null) return;
    const gif = prompt("URL do GIF:", exercicio.gif || "");
    if (gif === null) return;
    const descricao = prompt("Descrição curta:", exercicio.descricao || "");
    if (descricao === null) return;

    try {
        await api(`/exercicios/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim(), grupo_id: grupoId.trim(), gif: gif.trim(), descricao: descricao.trim() })
        });
        await carregarExerciciosBase();
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

async function removerExercicioBase(id) {
    if (!confirm("Remover este exercício da biblioteca ativa? Ele não aparecerá para novos treinos.")) return;
    try {
        await api(`/exercicios/${id}`, { method: "DELETE" });
        await carregarExerciciosBase();
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

async function editarPlanoTreino(id) {
    const plano = planosCache.find(item => item.id === id);
    if (!plano) return;

    const nome = prompt("Nome do treino:", plano.nome);
    if (nome === null) return;
    const objetivo = prompt("Objetivo do treino:", plano.objetivo || "");
    if (objetivo === null) return;

    try {
        await api(`/planos-treino/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome: nome.trim(), objetivo: objetivo.trim() })
        });
        await carregarPlanosTreino();
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

async function removerPlanoTreino(id) {
    if (!confirm("Remover este treino do cadastro ativo?")) return;
    try {
        await api(`/planos-treino/${id}`, { method: "DELETE" });
        await carregarPlanosTreino();
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

async function editarItemTreino(id) {
    const item = treinosCache.find(treino => treino.id === id);
    if (!item) return;

    const exercicioId = prompt("ID do exercício da biblioteca:", item.exercicio_id);
    if (exercicioId === null) return;
    const series = prompt("Séries:", item.series);
    if (series === null) return;
    const repeticoes = prompt("Repetições:", item.repeticoes);
    if (repeticoes === null) return;
    const ordem = prompt("Ordem:", item.ordem || 1);
    if (ordem === null) return;

    try {
        await api(`/treinos/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ exercicio_id: exercicioId, series, repeticoes, ordem })
        });
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

async function removerItemTreino(id) {
    if (!confirm("Remover este exercício de dentro do treino?")) return;
    try {
        await api(`/treinos/${id}`, { method: "DELETE" });
        await carregarTreinos();
    } catch (erro) { alert(erro.message); }
}

// =============================
// MODAL DO EXERCÍCIO
// =============================

function abrirTreino(exercicio, series, repeticoes, gif) {
    const modal = document.getElementById("modal");
    const conteudo = document.getElementById("conteudo-modal");

    conteudo.innerHTML = `
        <h2>${escapeHTML(exercicio)}</h2>
        <p>Séries: ${series}</p>
        <p>Repetições: ${repeticoes}</p>
        <h3>Execução Correta</h3>
        ${gif ? `<img loading="lazy" src="${escapeHTML(gif)}">` : `<p style="color:#8fa4c5;">Nenhum GIF cadastrado para este exercício.</p>`}
    `;
    modal.style.display = "block";
}

document.getElementById("fechar").onclick = () => {
    document.getElementById("modal").style.display = "none";
};

socket.on("atualizar-aparelhos", () => carregarAparelhos());
socket.on("atualizar-dashboard", () => carregarDashboardInteligente());

document.getElementById("btnSairAdmin").addEventListener("click", async () => {
    await fetch("/logout", { method: "POST" });
    window.location.href = "login.html";
});

["buscaAlunos", "buscaAparelhos", "buscaExercicios", "buscaTreinos"].forEach(id => {
    document.addEventListener("input", (evento) => {
        if (evento.target.id === "buscaAlunos") renderizarAlunos();
        if (evento.target.id === "buscaAparelhos") renderizarAparelhos();
        if (evento.target.id === "buscaExercicios") renderizarExerciciosBase();
        if (evento.target.id === "buscaTreinos") renderizarTreinosAgrupados();
    });
});

async function iniciar() {
    configurarAbas();
    const logado = await verificarUsuarioLogado();
    if (!logado) return;

    await carregarGrupos();
    await carregarAlunos();
    await carregarAparelhos();
    await carregarExerciciosBase();
    await carregarPlanosTreino();
    await carregarTreinos();
    await carregarDashboardInteligente();
    atualizarSelects();
}

iniciar();
