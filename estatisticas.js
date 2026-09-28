let graficoTreinos = null;

async function carregarAlunos() {

    const resposta = await fetch("/alunos");

    if (!resposta.ok) {
        window.location.href = "login.html";
        return;
    }

    const alunos = await resposta.json();

    const select = document.getElementById("alunoSelect");

    select.innerHTML = "";

    alunos.forEach(aluno => {

        select.innerHTML += `

            <option value="${aluno.id}">
                ${aluno.nome}
            </option>

        `;

    });

    if (alunos.length > 0) {

        carregarEstatisticas(alunos[0].id);

    }

    select.addEventListener("change", () => {

        carregarEstatisticas(select.value);

    });

}



async function carregarEstatisticas(alunoId) {

    const respostaAvancada =
    await fetch(`/estatisticas-avancadas/${alunoId}`);

    const dadosAvancados =
    await respostaAvancada.json();

    const resumo = dadosAvancados.resumo;

    const favorito = dadosAvancados.favorito;

    const ultimo = dadosAvancados.ultimo;

    const ranking = dadosAvancados.ranking;

    const div =
    document.getElementById("estatisticas");

    let dataUltimoTreino =
    "Nenhum registro";

    if (ultimo.data_execucao) {

        const data =
        new Date(ultimo.data_execucao);

        dataUltimoTreino =
        data.toLocaleString("pt-BR", {

            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"

        });

    }

    div.innerHTML = `

        <div class="estatistica">

            <h3>Total de Treinos</h3>

            <p>${resumo.total_treinos}</p>

            <small>Execuções registradas</small>

        </div>

        <div class="estatistica">

            <h3>Exercício Favorito</h3>

            <p>${favorito.exercicio}</p>

            <small>${favorito.total} execuções</small>

        </div>

        <div class="estatistica">

            <h3>Exercícios Diferentes</h3>

            <p>${resumo.exercicios_diferentes}</p>

            <small>Variações realizadas</small>

        </div>

        <div class="estatistica">

            <h3>Último Treino</h3>

            <p>${ultimo.exercicio}</p>

            <small>${dataUltimoTreino}</small>

        </div>

    `;

    carregarRanking(ranking);

    carregarGrafico(alunoId);

}



function carregarRanking(ranking) {

    const container =
    document.getElementById("rankingContainer");

    let html = `

        <section class="section-card ranking-card">

            <h2>Ranking de Exercícios</h2>

            <div class="ranking-lista">

    `;

    if (ranking.length === 0) {

        html += `

            <p class="ranking-vazio">
                Nenhum exercício registrado ainda.
            </p>

        `;

    } else {

        ranking.forEach((item, index) => {

            html += `

                <div class="ranking-item">

                    <div class="ranking-posicao">
                        ${index + 1}º
                    </div>

                    <div class="ranking-info">

                        <strong>${item.exercicio}</strong>

                        <span>${item.total} execuções</span>

                    </div>

                </div>

            `;

        });

    }

    html += `

            </div>

        </section>

    `;

    container.innerHTML = html;

}



async function carregarGrafico(alunoId) {

    const respostaGrafico =
    await fetch(`/grafico/${alunoId}`);

    const graficoDados =
    await respostaGrafico.json();

    const labels =
    graficoDados.map(item => item.exercicio);

    const valores =
    graficoDados.map(item => item.total);

    const ctx =
    document.getElementById("graficoTreinos");

    if (graficoTreinos) {

        graficoTreinos.destroy();

    }

    graficoTreinos = new Chart(ctx, {

        type: "bar",

        data: {

            labels: labels,

            datasets: [{

                label: "Treinos realizados",

                data: valores

            }]

        }

    });

}

carregarAlunos();