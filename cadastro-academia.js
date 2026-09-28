document
.getElementById("formCadastroAcademia")
.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nomeAcademia = document.getElementById("nomeAcademia").value.trim();
    const codigo = document.getElementById("codigoAcademia").value.trim().toLowerCase();
    const nomeAdmin = document.getElementById("nomeAdmin").value.trim();
    const email = document.getElementById("emailAdmin").value.trim();
    const senha = document.getElementById("senhaAdmin").value.trim();
    const mensagem = document.getElementById("mensagemCadastro");

    if (!nomeAcademia || !codigo || !nomeAdmin || !email || !senha) {
        mensagem.innerText = "Preencha todos os campos.";
        return;
    }

    const resposta = await fetch("/academias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            nomeAcademia,
            codigo,
            nomeAdmin,
            email,
            senha
        })
    });

    const dados = await resposta.json();

    if (dados.sucesso) {
        mensagem.style.color = "#4ade80";
        mensagem.innerText = "Academia cadastrada! Redirecionando para o login...";

        setTimeout(() => {
            window.location.href = "login.html";
        }, 1200);
    } else {
        mensagem.style.color = "#f87171";
        mensagem.innerText = dados.mensagem || "Erro ao cadastrar academia.";
    }
});
