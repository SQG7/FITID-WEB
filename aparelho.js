let tempo = 45;
let intervalo;
let treinoAtual = null;
let historicoRegistrado = false;
let modoDemo = false;
let inicioExecucao = null;

const timer = document.getElementById("timer");

function escreverEstado(nome, exercicio, status) {
    document.getElementById("nomeAluno").innerText = nome;
    document.getElementById("exercicio").innerText = exercicio;
    document.getElementById("statusTreino").innerText = status;
}

async function carregarTreino() {
    const params = new URLSearchParams(window.location.search);
    const rfid = params.get("rfid");
    const codigoAcademia = params.get("academia") || "fitcenter";
    const aparelhoId = params.get("aparelho");
    modoDemo = params.get("demo") === "1";

    if (!aparelhoId) {
        escreverEstado("Aparelho não informado", "Abra esta tela pelo simulador ou por um aparelho configurado", "Aguardando aparelho");
        return;
    }

    if (!rfid) {
        escreverEstado("RFID não informado", "Abra esta tela pelo simulador", "Aguardando identificação");
        return;
    }

    const resposta = await fetch(`/dispositivo/${codigoAcademia}/${aparelhoId}/${rfid}`);

    if (!resposta.ok) {
        const erro = await resposta.json().catch(() => ({}));
        escreverEstado("Identificação não concluída", erro.mensagem || "RFID ou aparelho inválido", "Erro de identificação");
        return;
    }

    const treino = await resposta.json();
    treinoAtual = treino;
    if (treino.sessao_token) {
        setInterval(() => fetch(`/sessoes/${encodeURIComponent(treino.sessao_token)}/heartbeat`, { method: "POST" }).catch(() => {}), 20000);
    }
    inicioExecucao = new Date().toISOString().slice(0, 19).replace("T", " ");

    if (!treino.aluno_id || !treino.exercicio) {
        escreverEstado("Erro nos dados do aluno", "Dados incompletos", "Erro nos dados");
        return;
    }

    document.getElementById("nomeAluno").innerText = `${treino.nome} • ${treino.academia_nome}`;

    const proximo = document.getElementById("proximo");
    if (proximo) {
        proximo.innerText = `${treino.aparelho_nome} • serve para exercícios de ${treino.grupo_nome}`;
    }

    document.getElementById("exercicio").innerText = `${treino.exercicio}${treino.plano_nome ? " • " + treino.plano_nome : ""}`;
    document.getElementById("series").innerText = treino.series + " séries";
    document.getElementById("repeticoes").innerText = treino.repeticoes + " repetições";
    document.getElementById("statusTreino").innerText = modoDemo ? "Modo demonstração" : "Em execução";

    const gif = document.getElementById("gifExercicio");
    if (treino.gif && gif) gif.src = treino.gif;
}

function iniciarTimer() {
    clearInterval(intervalo);
    intervalo = setInterval(() => {
        tempo--;
        timer.innerText = tempo + "s";
        if (tempo <= 0) {
            clearInterval(intervalo);
            timer.innerText = "Descanso concluído!";
            document.getElementById("statusTreino").innerText = "Descanso concluído";
        }
    }, 1000);
}

async function registrarHistorico() {
    if (!treinoAtual || historicoRegistrado) return;
    if (!treinoAtual.sessao_token) {
        alert("Sessão de uso não encontrada. Abra novamente pelo simulador.");
        return;
    }

    const resposta = await fetch(`/sessoes/${encodeURIComponent(treinoAtual.sessao_token)}/finalizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "concluido" })
    });

    if (!resposta.ok) {
        const erro = await resposta.json().catch(() => ({}));
        alert(erro.mensagem || "Erro ao finalizar a sessão.");
        return;
    }
    historicoRegistrado = true;
}

async function finalizarExercicio() {
    clearInterval(intervalo);
    document.getElementById("series").innerText = "Treino concluído";
    timer.innerText = "Treino finalizado";
    document.getElementById("statusTreino").innerText = modoDemo ? "Demonstração concluída" : "Exercício concluído";

    await registrarHistorico();

    document.getElementById("btnProximaSerie").disabled = true;
    document.getElementById("btnFinalizarTreino").disabled = true;
}

document.getElementById("btnProximaSerie").addEventListener("click", async () => {
    const campoSeries = document.getElementById("series");
    let numero = parseInt(campoSeries.innerText);

    if (numero > 1) {
        numero--;
        campoSeries.innerText = numero + " séries";
        tempo = 45;
        timer.innerText = "45s";
        document.getElementById("statusTreino").innerText = "Descanso iniciado";
        iniciarTimer();
    } else {
        await finalizarExercicio();
    }
});

document.getElementById("btnFinalizarTreino").addEventListener("click", finalizarExercicio);

carregarTreino();
iniciarTimer();
