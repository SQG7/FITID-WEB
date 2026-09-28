async function carregarAcademias() {
    const selectAcademia = document.getElementById("codigoAcademia");
    selectAcademia.innerHTML = `<option value="">Selecione a academia</option>`;

    const resposta = await fetch("/academias");
    const academias = await resposta.json();

    academias.forEach(academia => {
        selectAcademia.innerHTML += `<option value="${academia.codigo}">${academia.nome} • ${academia.codigo}</option>`;
    });

    const params = new URLSearchParams(window.location.search);
    const academiaUrl = params.get("academia") || "fitcenter";
    selectAcademia.value = academiaUrl;

    await carregarAparelhos();
}

async function carregarAparelhos() {
    const codigoAcademia = document.getElementById("codigoAcademia").value;
    const selectAparelho = document.getElementById("aparelhoId");

    selectAparelho.innerHTML = `<option value="">Selecione o aparelho físico</option>`;

    if (!codigoAcademia) return;

    const resposta = await fetch(`/aparelhos-publicos/${codigoAcademia}`);
    const aparelhos = await resposta.json();

    aparelhos.forEach(aparelho => {
        const bloqueado = aparelho.status !== "livre" ? "disabled" : "";
        const statusTexto = aparelho.status === "livre" ? "livre" : aparelho.status;
        selectAparelho.innerHTML += `
            <option value="${aparelho.id}" ${bloqueado}>
                ${aparelho.nome} • ${aparelho.grupo_nome} • ID ${aparelho.id} • ${statusTexto}
            </option>
        `;
    });
}

function aproximarPulseira() {
    const codigoAcademia = document.getElementById("codigoAcademia").value.trim().toLowerCase();
    const aparelhoId = document.getElementById("aparelhoId").value.trim();
    const rfid = document.getElementById("rfid").value.trim();
    const mensagem = document.getElementById("mensagemSimulador");

    if (!codigoAcademia || !aparelhoId || !rfid) {
        mensagem.innerText = "Selecione a academia, o aparelho e digite o RFID da pulseira.";
        return;
    }

    window.location.href = `aparelho.html?academia=${encodeURIComponent(codigoAcademia)}&aparelho=${encodeURIComponent(aparelhoId)}&rfid=${encodeURIComponent(rfid)}`;
}

document.getElementById("codigoAcademia").addEventListener("change", carregarAparelhos);
carregarAcademias();
