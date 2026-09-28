document
.getElementById("formLoginAluno")
.addEventListener("submit", async (e) => {

    e.preventDefault();

    const codigo = document
    .getElementById("codigoAcademiaAluno")
    .value
    .trim()
    .toLowerCase();

    const rfid = document
    .getElementById("rfidAluno")
    .value
    .trim();

    const mensagem = document
    .getElementById("mensagemAluno");

    if (!codigo || !rfid) {
        mensagem.innerText = "Digite o código da academia e o RFID.";
        return;
    }

    const resposta = await fetch("/login-aluno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            codigo,
            rfid
        })
    });

    const dados = await resposta.json();

    if (dados.sucesso) {
        window.location.href = "aluno.html";
    } else {
        mensagem.innerText = dados.mensagem || "Dados inválidos.";
    }

});
