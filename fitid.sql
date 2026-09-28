DROP DATABASE IF EXISTS fitid;
CREATE DATABASE fitid CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fitid;

-- =========================================================
-- FITID - Banco lapidado logicamente
-- Ideia central:
-- Academia -> Grupos de equipamento -> Aparelhos físicos
-- Academia -> Biblioteca de exercícios -> Treinos dos alunos
-- RFID no aparelho -> identifica aluno + aparelho -> mostra exercício compatível
-- =========================================================

CREATE TABLE academias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    tipo VARCHAR(30) NOT NULL DEFAULT 'admin',
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE
);

CREATE TABLE alunos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    rfid VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ativo',
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE,
    UNIQUE (academia_id, rfid)
);

-- Grupo de equipamento é o que torna a lógica mais clara:
-- Ex.: Supino 01 e Supino 02 pertencem ao grupo "Supino".
-- Exercícios como "Supino reto" podem ser feitos em aparelhos do grupo "Supino".
CREATE TABLE grupos_equipamento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE,
    UNIQUE (academia_id, nome)
);

CREATE TABLE aparelhos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    grupo_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'livre',
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE,
    FOREIGN KEY (grupo_id) REFERENCES grupos_equipamento(id)
    ON DELETE RESTRICT
);

CREATE TABLE exercicios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    grupo_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    gif VARCHAR(500),
    descricao TEXT,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE,
    FOREIGN KEY (grupo_id) REFERENCES grupos_equipamento(id)
    ON DELETE RESTRICT
);

CREATE TABLE planos_treino (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    aluno_id INT NOT NULL,
    nome VARCHAR(100) NOT NULL,
    objetivo VARCHAR(200),
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE,
    FOREIGN KEY (aluno_id) REFERENCES alunos(id)
    ON DELETE CASCADE
);

CREATE TABLE plano_exercicios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    plano_id INT NOT NULL,
    exercicio_id INT NOT NULL,
    series INT NOT NULL,
    repeticoes INT NOT NULL,
    ordem INT DEFAULT 1,
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE,
    FOREIGN KEY (plano_id) REFERENCES planos_treino(id)
    ON DELETE CASCADE,
    FOREIGN KEY (exercicio_id) REFERENCES exercicios(id)
    ON DELETE RESTRICT
);

CREATE TABLE historico (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academia_id INT NOT NULL,
    aluno_id INT NOT NULL,
    aparelho_id INT NOT NULL,
    plano_exercicio_id INT NULL,
    exercicio VARCHAR(100) NOT NULL,
    inicio_execucao DATETIME NULL,
    fim_execucao DATETIME NULL,
    tempo_execucao INT NULL,
    data_execucao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'concluido',
    FOREIGN KEY (academia_id) REFERENCES academias(id)
    ON DELETE CASCADE,
    FOREIGN KEY (aluno_id) REFERENCES alunos(id)
    ON DELETE CASCADE,
    FOREIGN KEY (aparelho_id) REFERENCES aparelhos(id)
    ON DELETE RESTRICT,
    FOREIGN KEY (plano_exercicio_id) REFERENCES plano_exercicios(id)
    ON DELETE SET NULL
);
CREATE TABLE sessoes_uso (
    id INT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    academia_id INT NOT NULL,
    aluno_id INT NOT NULL,
    aparelho_id INT NOT NULL,
    plano_exercicio_id INT NULL,
    plano_nome VARCHAR(100) NULL,
    exercicio VARCHAR(100) NOT NULL,
    gif VARCHAR(500) NULL,
    series INT NOT NULL,
    repeticoes VARCHAR(20) NOT NULL,
    inicio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fim DATETIME NULL,
    ultima_atividade DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'em_andamento',
    INDEX idx_sessao_status (status),
    INDEX idx_sessao_aluno (aluno_id, status),
    INDEX idx_sessao_aparelho (aparelho_id, status),
    FOREIGN KEY (academia_id) REFERENCES academias(id) ON DELETE CASCADE,
    FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE RESTRICT,
    FOREIGN KEY (aparelho_id) REFERENCES aparelhos(id) ON DELETE RESTRICT,
    FOREIGN KEY (plano_exercicio_id) REFERENCES plano_exercicios(id) ON DELETE SET NULL
);


INSERT INTO academias (nome, codigo)
VALUES
('FitCenter Academia', 'fitcenter'),
('Iron Club Gym', 'ironclub');

INSERT INTO usuarios (academia_id, nome, email, senha, tipo)
VALUES
(1, 'Conta FitCenter', 'admin@fitid.com', 'scrypt$d94352024640b7ee1af8c2b783334102$543e92c49ea3f8cef2638a049831503dc97a6da068aff40b96cd1fc958580ced11335e55c5047e9449b09714ff4353d2d6a39f672a1dc2b7f480f972ad6a3cc3', 'admin'),
(2, 'Conta Iron Club', 'iron@fitid.com', 'scrypt$f2f1530052e17fdab5e2de44819478d0$168f7b94a534120895a8dec54ecc44cc96d01fc38ed33ad4cb543faef71b3911595c08b2fbd731391ca8440d26eb68e75ad2cf179af865b7f15ba2d7bdf1fc20', 'admin');

INSERT INTO alunos (academia_id, nome, rfid, status)
VALUES
(1, 'Bruce', '123456', 'ativo'),
(1, 'Carlos', '999999', 'ativo'),
(1, 'Bartolomeu', '888888', 'ativo'),
(1, 'Aluno Inativo Exemplo', '111111', 'inativo'),
(2, 'Mariana', '777777', 'ativo'),
(2, 'João', '666666', 'ativo');

INSERT INTO grupos_equipamento (academia_id, nome)
VALUES
(1, 'Supino'),
(1, 'Leg Press'),
(1, 'Polia'),
(1, 'Remada'),
(1, 'Cadeira Extensora'),
(1, 'Esteira'),
(2, 'Cadeira Extensora'),
(2, 'Esteira'),
(2, 'Supino');

INSERT INTO aparelhos (academia_id, grupo_id, nome, status)
VALUES
(1, 1, 'Supino 01', 'livre'),
(1, 1, 'Supino 02', 'livre'),
(1, 2, 'Leg Press 01', 'livre'),
(1, 3, 'Polia Alta 01', 'livre'),
(1, 4, 'Remada Baixa 01', 'livre'),
(1, 5, 'Cadeira Extensora 01', 'livre'),
(1, 6, 'Esteira 01', 'livre'),
(2, 7, 'Cadeira Extensora 01', 'livre'),
(2, 8, 'Esteira 01', 'livre'),
(2, 9, 'Supino 01', 'livre');

INSERT INTO exercicios (academia_id, grupo_id, nome, gif, descricao)
VALUES
(1, 1, 'Supino reto', 'https://www.mundoboaforma.com.br/wp-content/uploads/2020/12/supino-reto.gif', 'Exercício de peito realizado em aparelho do grupo Supino.'),
(1, 1, 'Supino inclinado', NULL, 'Variação para porção superior do peitoral.'),
(1, 3, 'Puxada alta', NULL, 'Exercício de costas feito na polia.'),
(1, 3, 'Tríceps corda', NULL, 'Exercício de tríceps feito na polia.'),
(1, 4, 'Remada baixa', 'https://www.mundoboaforma.com.br/wp-content/uploads/2020/12/remada-alta-com-barra.gif', 'Exercício de costas/remada.'),
(1, 2, 'Leg Press', 'https://www.mundoboaforma.com.br/wp-content/uploads/2020/12/leg-press-45-tradicional.gif', 'Exercício de pernas no leg press.'),
(1, 5, 'Cadeira Extensora', NULL, 'Exercício de quadríceps.'),
(1, 6, 'Caminhada na Esteira', NULL, 'Exercício cardiovascular.'),
(2, 7, 'Cadeira Extensora', NULL, 'Exercício de quadríceps.'),
(2, 8, 'Esteira leve', NULL, 'Cardio leve.'),
(2, 9, 'Supino reto', NULL, 'Exercício de peito.');

INSERT INTO planos_treino (academia_id, aluno_id, nome, objetivo)
VALUES
(1, 1, 'Treino A - Peito e Costas', 'Hipertrofia'),
(1, 2, 'Treino A - Pernas', 'Força'),
(1, 3, 'Treino A - Costas', 'Condicionamento'),
(2, 5, 'Treino A - Pernas', 'Hipertrofia'),
(2, 6, 'Treino A - Cardio', 'Condicionamento');

INSERT INTO plano_exercicios (academia_id, plano_id, exercicio_id, series, repeticoes, ordem)
VALUES
(1, 1, 1, 4, 10, 1),
(1, 1, 5, 3, 10, 2),
(1, 2, 6, 4, 12, 1),
(1, 3, 3, 3, 12, 1),
(2, 4, 9, 4, 12, 1),
(2, 5, 10, 1, 20, 1);

INSERT INTO historico (academia_id, aluno_id, aparelho_id, plano_exercicio_id, exercicio, status)
VALUES
(1, 1, 1, 1, 'Supino reto', 'concluido'),
(1, 1, 2, 1, 'Supino reto', 'concluido'),
(1, 1, 1, 1, 'Supino reto', 'concluido'),
(1, 1, 5, 2, 'Remada baixa', 'concluido'),
(1, 2, 3, 3, 'Leg Press', 'concluido'),
(1, 2, 3, 3, 'Leg Press', 'concluido'),
(1, 3, 4, 4, 'Puxada alta', 'concluido'),
(2, 5, 8, 5, 'Cadeira Extensora', 'concluido'),
(2, 6, 9, 6, 'Esteira leve', 'concluido');
