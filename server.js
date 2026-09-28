require("./config");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const PDFDocument = require("pdfkit");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const db = require("./database");

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "fitid-demo-local-troque-em-producao";
const SESSION_TIMEOUT_MINUTES = Math.max(1, Number(process.env.SESSION_TIMEOUT_MINUTES || 10));
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function origemPermitida(origin, callback) {
    if (!origin || FRONTEND_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("Origem não permitida pelo CORS."));
}

const io = new Server(server, {
    cors: {
        origin: origemPermitida,
        credentials: true
    }
});

app.use(cors({
    origin: origemPermitida,
    credentials: true
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 8 * 60 * 60 * 1000
    }
}));

const STATUS_ALUNO = ["ativo", "inativo"];
const STATUS_APARELHO = ["livre", "ocupado", "manutencao", "offline"];
const STATUS_APARELHO_MANUAL = ["livre", "manutencao", "offline"];
const STATUS_SESSAO_FINAL = ["concluido", "cancelado", "abandonado"];

function exigirProfessor(req, res, next) {
    const usuario = req.session.usuario;
    if (!usuario || usuario.tipo !== "admin" || !usuario.academia_id) {
        return res.status(401).json({
            sucesso: false,
            mensagem: "Acesso restrito. Faça login como administrador da academia."
        });
    }
    next();
}

function academiaLogada(req) {
    return req.session.usuario ? req.session.usuario.academia_id : null;
}

function academiaParaAlunoOuUsuario(req) {
    if (req.session.usuario) return req.session.usuario.academia_id;
    if (req.session.aluno) return req.session.aluno.academia_id;
    return null;
}

function normalizarCodigo(codigo) {
    return String(codigo || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function erroServidor(res, err) {
    console.error("[FITID] Erro interno:", err && err.stack ? err.stack : err);

    if (err && err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            sucesso: false,
            mensagem: "Já existe um cadastro com esses dados. Verifique código, e-mail, RFID ou nome duplicado."
        });
    }

    return res.status(500).json({
        sucesso: false,
        mensagem: "O servidor não conseguiu concluir a operação. Tente novamente."
    });
}

function validarStatusAluno(status) {
    return STATUS_ALUNO.includes(String(status || "").toLowerCase());
}

function validarStatusAparelho(status) {
    return STATUS_APARELHO.includes(String(status || "").toLowerCase());
}

function validarStatusAparelhoManual(status) {
    return STATUS_APARELHO_MANUAL.includes(String(status || "").toLowerCase());
}

function hashSenha(senha) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString("hex");
        crypto.scrypt(String(senha), salt, 64, (err, derivedKey) => {
            if (err) return reject(err);
            resolve(`scrypt$${salt}$${derivedKey.toString("hex")}`);
        });
    });
}

function verificarSenha(senha, armazenada) {
    return new Promise((resolve, reject) => {
        const valor = String(armazenada || "");
        if (!valor.startsWith("scrypt$")) return resolve(valor === String(senha));

        const partes = valor.split("$");
        if (partes.length !== 3) return resolve(false);
        const [, salt, hashHex] = partes;

        crypto.scrypt(String(senha), salt, 64, (err, derivedKey) => {
            if (err) return reject(err);
            const esperado = Buffer.from(hashHex, "hex");
            if (esperado.length !== derivedKey.length) return resolve(false);
            resolve(crypto.timingSafeEqual(esperado, derivedKey));
        });
    });
}

function acessoAoAlunoPermitido(req, alunoId) {
    if (req.session.usuario) return true;
    return Boolean(req.session.aluno && String(req.session.aluno.id) === String(alunoId));
}

async function prepararBanco() {
    try {
        await db.promise().query(`ALTER TABLE usuarios MODIFY senha VARCHAR(255) NOT NULL`);
        const [colunasHistorico] = await db.promise().query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico'
        `);
        const nomes = new Set(colunasHistorico.map((c) => c.COLUMN_NAME));
        if (!nomes.has("fim_execucao")) {
            await db.promise().query(`ALTER TABLE historico ADD COLUMN fim_execucao DATETIME NULL AFTER inicio_execucao`);
        }
        if (!nomes.has("tempo_execucao")) {
            await db.promise().query(`ALTER TABLE historico ADD COLUMN tempo_execucao INT NULL AFTER fim_execucao`);
        }

        await db.promise().query(`
            CREATE TABLE IF NOT EXISTS sessoes_uso (
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
            )
        `);
        // Versões anteriores usavam ativo=0 como remoção definitiva do aluno.
        // Para permitir inativação/reativação sem perder histórico, recuperamos esses registros
        // como cadastros visíveis, porém inativos.
        await db.promise().query(`UPDATE alunos SET ativo = 1, status = 'inativo' WHERE ativo = 0`);

        console.log("[FITID] Estrutura complementar do banco pronta.");
    } catch (err) {
        console.error("[FITID] Não foi possível preparar a estrutura complementar:", err.message);
    }
}

app.get("/api", (req, res) => {
    res.json({ mensagem: "API FITID funcionando!" });
});

app.get("/diagnostico", async (req, res) => {
    try {
        await db.promise().query("SELECT 1 AS ok");
        res.json({
            sucesso: true,
            servidor: "online",
            banco: "conectado",
            porta: PORT,
            timeout_sessao_minutos: SESSION_TIMEOUT_MINUTES,
            mensagem: "FITID pronto para demonstração."
        });
    } catch (err) {
        res.status(503).json({
            sucesso: false,
            servidor: "online",
            banco: "indisponivel",
            mensagem: "Servidor iniciou, mas não conseguiu acessar o MySQL. Confira o arquivo .env e se o serviço MySQL está ligado."
        });
    }
});

// =============================
// CADASTRO E LOGIN DA ACADEMIA
// =============================

app.post("/academias", async (req, res) => {
    const { nomeAcademia, codigo, nomeAdmin, email, senha } = req.body;

    if (!nomeAcademia || !codigo || !nomeAdmin || !email || !senha) {
        return res.status(400).json({
            sucesso: false,
            mensagem: "Preencha nome da academia, código, nome do responsável, e-mail e senha."
        });
    }

    if (String(senha).length < 6) {
        return res.status(400).json({ sucesso: false, mensagem: "A senha deve possuir pelo menos 6 caracteres." });
    }

    const codigoLimpo = normalizarCodigo(codigo);
    let connection;
    try {
        const senhaHash = await hashSenha(senha);
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        const [resultAcademia] = await connection.query(
            `INSERT INTO academias (nome, codigo) VALUES (?, ?)`,
            [String(nomeAcademia).trim(), codigoLimpo]
        );
        const academiaId = resultAcademia.insertId;
        await connection.query(
            `INSERT INTO usuarios (academia_id, nome, email, senha, tipo) VALUES (?, ?, ?, ?, 'admin')`,
            [academiaId, String(nomeAdmin).trim(), String(email).trim().toLowerCase(), senhaHash]
        );
        await connection.commit();
        res.json({
            sucesso: true,
            mensagem: "Academia cadastrada com sucesso!",
            academia: { id: academiaId, nome: nomeAcademia, codigo: codigoLimpo }
        });
    } catch (err) {
        if (connection) await connection.rollback().catch(() => {});
        return erroServidor(res, err);
    } finally {
        if (connection) connection.release();
    }
});

app.get("/academias", (req, res) => {
    db.query(`SELECT id, nome, codigo FROM academias ORDER BY nome`, (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.get("/academias/:codigo", (req, res) => {
    const codigo = normalizarCodigo(req.params.codigo);
    db.query(
        `SELECT id, nome, codigo FROM academias WHERE codigo = ? LIMIT 1`,
        [codigo],
        (err, results) => {
            if (err) return erroServidor(res, err);
            if (results.length === 0) return res.status(404).json({ mensagem: "Academia não encontrada." });
            res.json(results[0]);
        }
    );
});

app.post("/login", async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ sucesso: false, mensagem: "E-mail e senha são obrigatórios." });
    }

    const sql = `
        SELECT
            usuarios.id,
            usuarios.academia_id,
            usuarios.nome,
            usuarios.email,
            usuarios.tipo,
            usuarios.senha,
            academias.nome AS academia_nome,
            academias.codigo AS academia_codigo
        FROM usuarios
        JOIN academias ON academias.id = usuarios.academia_id
        WHERE LOWER(usuarios.email) = LOWER(?)
        LIMIT 1
    `;

    try {
        const [results] = await db.promise().query(sql, [String(email).trim()]);
        if (results.length === 0) {
            return res.status(401).json({ sucesso: false, mensagem: "E-mail ou senha inválidos." });
        }

        const registro = results[0];
        const senhaValida = await verificarSenha(senha, registro.senha);
        if (!senhaValida) {
            return res.status(401).json({ sucesso: false, mensagem: "E-mail ou senha inválidos." });
        }

        // Compatibilidade com bancos antigos: no primeiro login correto, migra senha em texto para hash.
        if (!String(registro.senha).startsWith("scrypt$")) {
            const senhaHash = await hashSenha(senha);
            await db.promise().query(`UPDATE usuarios SET senha = ? WHERE id = ?`, [senhaHash, registro.id]);
        }

        delete registro.senha;
        req.session.regenerate((sessionErr) => {
            if (sessionErr) return erroServidor(res, sessionErr);
            req.session.usuario = registro;
            res.json({ sucesso: true, usuario: registro });
        });
    } catch (err) {
        return erroServidor(res, err);
    }
});

app.get("/usuario-logado", (req, res) => {
    if (!req.session.usuario) return res.status(401).json({ logado: false });
    res.json({ logado: true, usuario: req.session.usuario });
});

app.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) return erroServidor(res, err);
        res.clearCookie("connect.sid");
        res.json({ sucesso: true });
    });
});

// =============================
// LOGIN DO ALUNO POR ACADEMIA + RFID
// =============================

app.post("/login-aluno", (req, res) => {
    const { codigo, rfid } = req.body;

    if (!codigo || !rfid) {
        return res.status(400).json({ sucesso: false, mensagem: "Digite o código da academia e o código da pulseira." });
    }

    const sql = `
        SELECT
            alunos.id,
            alunos.academia_id,
            alunos.nome,
            alunos.rfid,
            alunos.status,
            academias.nome AS academia_nome,
            academias.codigo AS academia_codigo
        FROM alunos
        JOIN academias ON academias.id = alunos.academia_id
        WHERE academias.codigo = ?
        AND alunos.rfid = ?
        AND alunos.ativo = 1
        LIMIT 1
    `;

    db.query(sql, [normalizarCodigo(codigo), rfid], (err, results) => {
        if (err) return erroServidor(res, err);
        if (results.length === 0) {
            return res.status(404).json({ sucesso: false, mensagem: "Aluno não encontrado nessa academia." });
        }

        const aluno = results[0];
        if (aluno.status !== "ativo") {
            return res.status(403).json({ sucesso: false, mensagem: "Cadastro do aluno está inativo nesta academia." });
        }

        req.session.regenerate((sessionErr) => {
            if (sessionErr) return erroServidor(res, sessionErr);
            req.session.aluno = aluno;
            res.json({ sucesso: true, aluno });
        });
    });
});

app.get("/aluno-logado", (req, res) => {
    if (!req.session.aluno) return res.status(401).json({ logado: false, mensagem: "Aluno não autenticado." });
    res.json({ logado: true, aluno: req.session.aluno });
});

app.post("/logout-aluno", (req, res) => {
    req.session.destroy((err) => {
        if (err) return erroServidor(res, err);
        res.clearCookie("connect.sid");
        res.json({ sucesso: true });
    });
});

// =============================
// ALUNOS - CRUD
// =============================

app.get("/alunos", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const sql = `
        SELECT id, academia_id, nome, rfid, status, ativo
        FROM alunos
        WHERE academia_id = ?
        AND ativo = 1
        ORDER BY FIELD(status, 'ativo', 'inativo'), nome
    `;

    db.query(sql, [academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.get("/alunos/:id", (req, res) => {
    const id = req.params.id;
    const alunoSessao = req.session.aluno;
    const usuarioSessao = req.session.usuario;

    let sql = `SELECT id, academia_id, nome, rfid, status, ativo FROM alunos WHERE id = ? AND ativo = 1`;
    const params = [id];

    if (usuarioSessao) {
        sql += " AND academia_id = ?";
        params.push(usuarioSessao.academia_id);
    } else if (alunoSessao) {
        sql += " AND id = ? AND academia_id = ? AND status = 'ativo'";
        params.push(alunoSessao.id, alunoSessao.academia_id);
    } else {
        return res.status(401).json({ mensagem: "Faça login para acessar o aluno." });
    }

    sql += " LIMIT 1";

    db.query(sql, params, (err, results) => {
        if (err) return erroServidor(res, err);
        if (results.length === 0) return res.status(404).json({ mensagem: "Aluno não encontrado." });
        res.json(results[0]);
    });
});

app.post("/alunos", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const { nome, rfid, status } = req.body;
    const statusAluno = String(status || "ativo").toLowerCase();

    if (!nome || !rfid) return res.status(400).json({ mensagem: "Nome e RFID são obrigatórios." });
    if (!validarStatusAluno(statusAluno)) return res.status(400).json({ mensagem: "Status do aluno inválido." });

    const sql = `INSERT INTO alunos (academia_id, nome, rfid, status) VALUES (?, ?, ?, ?)`;
    db.query(sql, [academiaId, nome, rfid, statusAluno], (err, result) => {
        if (err) return erroServidor(res, err);
        res.json({ sucesso: true, mensagem: "Aluno cadastrado com sucesso!", id: result.insertId });
    });
});

app.put("/alunos/:id", exigirProfessor, async (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const { nome, rfid, status } = req.body;
    const statusAluno = String(status || "ativo").toLowerCase();

    if (!nome || !rfid) return res.status(400).json({ mensagem: "Nome e RFID são obrigatórios." });
    if (!validarStatusAluno(statusAluno)) return res.status(400).json({ mensagem: "Status do aluno inválido." });

    try {
        const [result] = await db.promise().query(`
            UPDATE alunos
            SET nome = ?, rfid = ?, status = ?
            WHERE id = ? AND academia_id = ? AND ativo = 1
        `, [String(nome).trim(), String(rfid).trim(), statusAluno, id, academiaId]);

        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Aluno não encontrado nesta academia." });

        if (statusAluno === "inativo") {
            await encerrarSessoesDoAluno(id, academiaId, "cancelado");
        }
        res.json({ sucesso: true, mensagem: "Aluno atualizado!" });
    } catch (err) {
        return erroServidor(res, err);
    }
});

app.delete("/alunos/:id", exigirProfessor, async (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    try {
        await encerrarSessoesDoAluno(id, academiaId, "cancelado");
        const [result] = await db.promise().query(
            `UPDATE alunos SET status = 'inativo' WHERE id = ? AND academia_id = ? AND ativo = 1`,
            [id, academiaId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Aluno não encontrado nesta academia." });
        res.json({ sucesso: true, mensagem: "Aluno inativado. Histórico preservado e cadastro disponível para reativação." });
    } catch (err) {
        return erroServidor(res, err);
    }
});

// =============================
// GRUPOS DE EQUIPAMENTO - CRUD
// =============================

app.get("/grupos-equipamento", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const sql = `
        SELECT id, academia_id, nome, ativo
        FROM grupos_equipamento
        WHERE academia_id = ?
        AND ativo = 1
        ORDER BY nome
    `;

    db.query(sql, [academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.post("/grupos-equipamento", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const { nome } = req.body;

    if (!nome) return res.status(400).json({ mensagem: "Nome do grupo é obrigatório." });

    const sql = `INSERT INTO grupos_equipamento (academia_id, nome) VALUES (?, ?)`;
    db.query(sql, [academiaId, nome.trim()], (err, result) => {
        if (err) return erroServidor(res, err);
        res.json({ sucesso: true, mensagem: "Grupo cadastrado!", id: result.insertId });
    });
});

app.put("/grupos-equipamento/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const { id } = req.params;
    const { nome } = req.body;

    if (!nome) return res.status(400).json({ mensagem: "Nome do grupo é obrigatório." });

    const sql = `UPDATE grupos_equipamento SET nome = ? WHERE id = ? AND academia_id = ? AND ativo = 1`;
    db.query(sql, [nome.trim(), id, academiaId], (err, result) => {
        if (err) return erroServidor(res, err);
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Grupo não encontrado nesta academia." });
        res.json({ sucesso: true, mensagem: "Grupo atualizado!" });
    });
});

app.delete("/grupos-equipamento/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const { id } = req.params;

    const sqlUso = `
        SELECT
            (SELECT COUNT(*) FROM aparelhos WHERE grupo_id = ? AND academia_id = ? AND ativo = 1) AS aparelhos,
            (SELECT COUNT(*) FROM exercicios WHERE grupo_id = ? AND academia_id = ? AND ativo = 1) AS exercicios
    `;

    db.query(sqlUso, [id, academiaId, id, academiaId], (errUso, uso) => {
        if (errUso) return erroServidor(res, errUso);
        if (uso[0].aparelhos > 0 || uso[0].exercicios > 0) {
            return res.status(400).json({ mensagem: "Não remova este grupo enquanto houver aparelhos ou exercícios usando ele." });
        }

        db.query(
            `UPDATE grupos_equipamento SET ativo = 0 WHERE id = ? AND academia_id = ? AND ativo = 1`,
            [id, academiaId],
            (err, result) => {
                if (err) return erroServidor(res, err);
                if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Grupo não encontrado nesta academia." });
                res.json({ sucesso: true, mensagem: "Grupo removido." });
            }
        );
    });
});

// =============================
// APARELHOS - CRUD / LOTAÇÃO
// =============================

app.get("/aparelhos", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const sql = `
        SELECT aparelhos.*, grupos_equipamento.nome AS grupo_nome
        FROM aparelhos
        JOIN grupos_equipamento ON grupos_equipamento.id = aparelhos.grupo_id
        WHERE aparelhos.academia_id = ?
        AND aparelhos.ativo = 1
        ORDER BY aparelhos.id
    `;

    db.query(sql, [academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.post("/aparelhos", exigirProfessor, async (req, res) => {
    const academiaId = academiaLogada(req);
    const { nome, grupo_id, status } = req.body;
    const statusInicial = String(status || "livre").toLowerCase();

    if (!nome || !grupo_id) {
        return res.status(400).json({ sucesso: false, mensagem: "Nome do aparelho e grupo são obrigatórios." });
    }
    if (!validarStatusAparelhoManual(statusInicial)) {
        return res.status(400).json({ sucesso: false, mensagem: "Use apenas livre, manutenção ou offline. 'Ocupado' é controlado automaticamente pela sessão de uso." });
    }

    try {
        const [grupos] = await db.promise().query(
            `SELECT id FROM grupos_equipamento WHERE id = ? AND academia_id = ? AND ativo = 1 LIMIT 1`,
            [grupo_id, academiaId]
        );
        if (grupos.length === 0) return res.status(400).json({ mensagem: "Grupo não pertence a esta academia." });

        const [result] = await db.promise().query(
            `INSERT INTO aparelhos (academia_id, grupo_id, nome, status) VALUES (?, ?, ?, ?)`,
            [academiaId, grupo_id, String(nome).trim(), statusInicial]
        );
        io.emit("atualizar-aparelhos");
        io.emit("atualizar-dashboard");
        res.json({ sucesso: true, mensagem: "Aparelho cadastrado com sucesso!", id: result.insertId });
    } catch (err) {
        return erroServidor(res, err);
    }
});

app.get("/aparelhos-publicos/:codigo", (req, res) => {
    const codigo = normalizarCodigo(req.params.codigo);
    const sql = `
        SELECT aparelhos.id, aparelhos.nome, aparelhos.grupo_id, grupos_equipamento.nome AS grupo_nome, aparelhos.status
        FROM aparelhos
        JOIN academias ON academias.id = aparelhos.academia_id
        JOIN grupos_equipamento ON grupos_equipamento.id = aparelhos.grupo_id
        WHERE academias.codigo = ?
        AND aparelhos.ativo = 1
        ORDER BY grupos_equipamento.nome, aparelhos.nome
    `;

    db.query(sql, [codigo], (err, results) => {
        if (err) return erroServidor(res, err);
        res.setHeader("X-FITID-Updated-At", new Date().toISOString());
        res.json(results);
    });
});

app.put("/aparelhos/:id", exigirProfessor, async (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const { nome, grupo_id, status } = req.body;
    const statusAparelho = String(status || "").toLowerCase();

    if (!nome || !grupo_id || !statusAparelho) {
        return res.status(400).json({ mensagem: "Nome, grupo e status são obrigatórios." });
    }
    if (!validarStatusAparelhoManual(statusAparelho)) {
        return res.status(400).json({ mensagem: "Use apenas livre, manutenção ou offline. 'Ocupado' é controlado automaticamente pela sessão de uso." });
    }

    try {
        const [[grupo]] = await db.promise().query(
            `SELECT id FROM grupos_equipamento WHERE id = ? AND academia_id = ? AND ativo = 1 LIMIT 1`,
            [grupo_id, academiaId]
        );
        if (!grupo) return res.status(400).json({ mensagem: "Grupo não pertence a esta academia." });

        const [[sessao]] = await db.promise().query(
            `SELECT id FROM sessoes_uso WHERE aparelho_id = ? AND academia_id = ? AND status = 'em_andamento' LIMIT 1`,
            [id, academiaId]
        );
        if (sessao) {
            return res.status(409).json({ mensagem: "Este aparelho está em uma sessão de uso. Finalize/cancele a sessão antes de editar seu status ou grupo." });
        }

        const [result] = await db.promise().query(
            `UPDATE aparelhos SET nome = ?, grupo_id = ?, status = ? WHERE id = ? AND academia_id = ? AND ativo = 1`,
            [String(nome).trim(), grupo_id, statusAparelho, id, academiaId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Aparelho não encontrado nesta academia." });
        io.emit("atualizar-aparelhos");
        io.emit("atualizar-dashboard");
        res.json({ sucesso: true, mensagem: "Aparelho atualizado!" });
    } catch (err) {
        return erroServidor(res, err);
    }
});

app.delete("/aparelhos/:id", exigirProfessor, async (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    try {
        const [[sessao]] = await db.promise().query(
            `SELECT id FROM sessoes_uso WHERE aparelho_id = ? AND academia_id = ? AND status = 'em_andamento' LIMIT 1`,
            [id, academiaId]
        );
        if (sessao) return res.status(409).json({ mensagem: "Não é possível remover um aparelho enquanto ele estiver em uso." });

        const [result] = await db.promise().query(
            `UPDATE aparelhos SET ativo = 0, status = 'livre' WHERE id = ? AND academia_id = ? AND ativo = 1`,
            [id, academiaId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Aparelho não encontrado nesta academia." });
        io.emit("atualizar-aparelhos");
        io.emit("atualizar-dashboard");
        res.json({ sucesso: true, mensagem: "Aparelho removido do cadastro ativo. Histórico preservado." });
    } catch (err) {
        return erroServidor(res, err);
    }
});

// =============================
// BIBLIOTECA DE EXERCÍCIOS - CRUD
// =============================

app.get("/exercicios", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const sql = `
        SELECT exercicios.id, exercicios.academia_id, exercicios.grupo_id,
               grupos_equipamento.nome AS grupo_nome,
               exercicios.nome, exercicios.gif, exercicios.descricao, exercicios.ativo
        FROM exercicios
        JOIN grupos_equipamento ON grupos_equipamento.id = exercicios.grupo_id
        WHERE exercicios.academia_id = ?
        AND exercicios.ativo = 1
        ORDER BY grupos_equipamento.nome, exercicios.nome
    `;

    db.query(sql, [academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.post("/exercicios", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const { nome, grupo_id, gif, descricao } = req.body;

    if (!nome || !grupo_id) {
        return res.status(400).json({ mensagem: "Nome do exercício e grupo compatível são obrigatórios." });
    }

    db.query(
        `SELECT id FROM grupos_equipamento WHERE id = ? AND academia_id = ? AND ativo = 1 LIMIT 1`,
        [grupo_id, academiaId],
        (errGrupo, grupos) => {
            if (errGrupo) return erroServidor(res, errGrupo);
            if (grupos.length === 0) return res.status(400).json({ mensagem: "Grupo não pertence a esta academia." });

            const sql = `INSERT INTO exercicios (academia_id, grupo_id, nome, gif, descricao) VALUES (?, ?, ?, ?, ?)`;
            db.query(sql, [academiaId, grupo_id, nome, gif || null, descricao || null], (err, result) => {
                if (err) return erroServidor(res, err);
                res.json({ sucesso: true, mensagem: "Exercício cadastrado na biblioteca!", id: result.insertId });
            });
        }
    );
});

app.put("/exercicios/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const { nome, grupo_id, gif, descricao } = req.body;

    if (!nome || !grupo_id) return res.status(400).json({ mensagem: "Nome do exercício e grupo compatível são obrigatórios." });

    db.query(
        `SELECT id FROM grupos_equipamento WHERE id = ? AND academia_id = ? AND ativo = 1 LIMIT 1`,
        [grupo_id, academiaId],
        (errGrupo, grupos) => {
            if (errGrupo) return erroServidor(res, errGrupo);
            if (grupos.length === 0) return res.status(400).json({ mensagem: "Grupo não pertence a esta academia." });

            const sql = `
                UPDATE exercicios
                SET nome = ?, grupo_id = ?, gif = ?, descricao = ?
                WHERE id = ?
                AND academia_id = ?
                AND ativo = 1
            `;
            db.query(sql, [nome, grupo_id, gif || null, descricao || null, id, academiaId], (err, result) => {
                if (err) return erroServidor(res, err);
                if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Exercício não encontrado nesta academia." });
                res.json({ sucesso: true, mensagem: "Exercício atualizado!" });
            });
        }
    );
});

app.delete("/exercicios/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const sql = `UPDATE exercicios SET ativo = 0 WHERE id = ? AND academia_id = ? AND ativo = 1`;

    db.query(sql, [id, academiaId], (err, result) => {
        if (err) return erroServidor(res, err);
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Exercício não encontrado nesta academia." });
        res.json({ sucesso: true, mensagem: "Exercício removido da biblioteca ativa." });
    });
});

// =============================
// PLANOS DE TREINO - CRUD
// =============================

app.get("/planos-treino", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const sql = `
        SELECT planos_treino.id, planos_treino.academia_id, planos_treino.aluno_id,
               alunos.nome AS aluno_nome, alunos.status AS aluno_status,
               planos_treino.nome, planos_treino.objetivo, planos_treino.ativo
        FROM planos_treino
        JOIN alunos ON alunos.id = planos_treino.aluno_id
        WHERE planos_treino.academia_id = ?
        AND planos_treino.ativo = 1
        AND alunos.ativo = 1
        ORDER BY alunos.nome, planos_treino.nome
    `;

    db.query(sql, [academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.post("/planos-treino", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const { aluno_id, nome, objetivo } = req.body;

    if (!aluno_id || !nome) return res.status(400).json({ mensagem: "Aluno e nome do treino são obrigatórios." });

    const sqlAluno = `SELECT id FROM alunos WHERE id = ? AND academia_id = ? AND ativo = 1 LIMIT 1`;
    db.query(sqlAluno, [aluno_id, academiaId], (errAluno, alunos) => {
        if (errAluno) return erroServidor(res, errAluno);
        if (alunos.length === 0) return res.status(400).json({ mensagem: "Aluno não pertence a esta academia." });

        const sql = `INSERT INTO planos_treino (academia_id, aluno_id, nome, objetivo) VALUES (?, ?, ?, ?)`;
        db.query(sql, [academiaId, aluno_id, nome, objetivo || null], (err, result) => {
            if (err) return erroServidor(res, err);
            res.json({ sucesso: true, mensagem: "Treino cadastrado para o aluno!", id: result.insertId });
        });
    });
});

app.put("/planos-treino/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const { nome, objetivo } = req.body;

    if (!nome) return res.status(400).json({ mensagem: "Nome do treino é obrigatório." });

    const sql = `
        UPDATE planos_treino
        SET nome = ?, objetivo = ?
        WHERE id = ?
        AND academia_id = ?
        AND ativo = 1
    `;

    db.query(sql, [nome, objetivo || null, id, academiaId], (err, result) => {
        if (err) return erroServidor(res, err);
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Treino não encontrado nesta academia." });
        res.json({ sucesso: true, mensagem: "Treino atualizado!" });
    });
});

app.delete("/planos-treino/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const sql = `UPDATE planos_treino SET ativo = 0 WHERE id = ? AND academia_id = ? AND ativo = 1`;

    db.query(sql, [id, academiaId], (err, result) => {
        if (err) return erroServidor(res, err);
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Treino não encontrado nesta academia." });
        res.json({ sucesso: true, mensagem: "Treino removido do cadastro ativo." });
    });
});

// =============================
// EXERCÍCIOS DENTRO DOS TREINOS
// =============================

app.get("/treinos", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const sql = `
        SELECT plano_exercicios.id, plano_exercicios.academia_id,
               planos_treino.id AS plano_id, planos_treino.nome AS plano_nome,
               planos_treino.objetivo, planos_treino.aluno_id,
               alunos.nome AS aluno_nome, alunos.status AS aluno_status,
               exercicios.id AS exercicio_id, exercicios.nome AS exercicio,
               exercicios.grupo_id, grupos_equipamento.nome AS grupo_nome,
               exercicios.gif, plano_exercicios.series, plano_exercicios.repeticoes,
               plano_exercicios.ordem
        FROM plano_exercicios
        JOIN planos_treino ON planos_treino.id = plano_exercicios.plano_id
        JOIN alunos ON alunos.id = planos_treino.aluno_id
        JOIN exercicios ON exercicios.id = plano_exercicios.exercicio_id
        JOIN grupos_equipamento ON grupos_equipamento.id = exercicios.grupo_id
        WHERE plano_exercicios.academia_id = ?
        AND planos_treino.ativo = 1
        AND alunos.ativo = 1
        AND exercicios.ativo = 1
        ORDER BY alunos.nome, planos_treino.nome, plano_exercicios.ordem, plano_exercicios.id
    `;

    db.query(sql, [academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.get("/alunos/:id/treinos", (req, res) => {
    const alunoId = req.params.id;

    if (req.session.aluno && String(req.session.aluno.id) !== String(alunoId)) {
        return res.status(403).json({ mensagem: "Você só pode acessar seus próprios treinos." });
    }

    const academiaId = academiaParaAlunoOuUsuario(req);
    if (!academiaId) return res.status(401).json({ mensagem: "Faça login para acessar os treinos." });

    const sql = `
        SELECT plano_exercicios.id, plano_exercicios.academia_id,
               planos_treino.id AS plano_id, planos_treino.nome AS plano_nome,
               planos_treino.objetivo, planos_treino.aluno_id,
               exercicios.id AS exercicio_id, exercicios.nome AS exercicio,
               exercicios.grupo_id, grupos_equipamento.nome AS grupo_nome,
               exercicios.gif, plano_exercicios.series, plano_exercicios.repeticoes,
               plano_exercicios.ordem
        FROM plano_exercicios
        JOIN planos_treino ON planos_treino.id = plano_exercicios.plano_id
        JOIN exercicios ON exercicios.id = plano_exercicios.exercicio_id
        JOIN grupos_equipamento ON grupos_equipamento.id = exercicios.grupo_id
        WHERE planos_treino.aluno_id = ?
        AND plano_exercicios.academia_id = ?
        AND planos_treino.ativo = 1
        AND exercicios.ativo = 1
        ORDER BY planos_treino.nome, plano_exercicios.ordem, plano_exercicios.id
    `;

    db.query(sql, [alunoId, academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.post("/treinos", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const { plano_id, exercicio_id, series, repeticoes, ordem } = req.body;

    if (!plano_id || !exercicio_id || !series || !repeticoes) {
        return res.status(400).json({ mensagem: "Treino, exercício, séries e repetições são obrigatórios." });
    }

    const sqlConfere = `
        SELECT planos_treino.id AS plano_id, exercicios.id AS exercicio_id
        FROM planos_treino
        JOIN exercicios ON exercicios.academia_id = planos_treino.academia_id
        WHERE planos_treino.id = ?
        AND exercicios.id = ?
        AND planos_treino.academia_id = ?
        AND planos_treino.ativo = 1
        AND exercicios.ativo = 1
        LIMIT 1
    `;

    db.query(sqlConfere, [plano_id, exercicio_id, academiaId], (errConfere, dados) => {
        if (errConfere) return erroServidor(res, errConfere);
        if (dados.length === 0) return res.status(400).json({ mensagem: "Treino ou exercício não pertence a esta academia." });

        const sql = `
            INSERT INTO plano_exercicios (academia_id, plano_id, exercicio_id, series, repeticoes, ordem)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        db.query(sql, [academiaId, plano_id, exercicio_id, series, repeticoes, ordem || 1], (err, result) => {
            if (err) return erroServidor(res, err);
            res.json({ sucesso: true, mensagem: "Exercício adicionado ao treino!", id: result.insertId });
        });
    });
});

app.put("/treinos/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const { exercicio_id, series, repeticoes, ordem } = req.body;

    if (!exercicio_id || !series || !repeticoes) {
        return res.status(400).json({ mensagem: "Exercício, séries e repetições são obrigatórios." });
    }

    const sqlExercicio = `SELECT id FROM exercicios WHERE id = ? AND academia_id = ? AND ativo = 1 LIMIT 1`;
    db.query(sqlExercicio, [exercicio_id, academiaId], (errExercicio, exercicios) => {
        if (errExercicio) return erroServidor(res, errExercicio);
        if (exercicios.length === 0) return res.status(400).json({ mensagem: "Exercício não pertence a esta academia." });

        const sql = `
            UPDATE plano_exercicios
            SET exercicio_id = ?, series = ?, repeticoes = ?, ordem = ?
            WHERE id = ?
            AND academia_id = ?
        `;
        db.query(sql, [exercicio_id, series, repeticoes, ordem || 1, id, academiaId], (err, result) => {
            if (err) return erroServidor(res, err);
            if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Item do treino não encontrado nesta academia." });
            res.json({ sucesso: true, mensagem: "Exercício do treino atualizado!" });
        });
    });
});

app.delete("/treinos/:id", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const id = req.params.id;
    const sql = `DELETE FROM plano_exercicios WHERE id = ? AND academia_id = ?`;

    db.query(sql, [id, academiaId], (err, result) => {
        if (err) return erroServidor(res, err);
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Item do treino não encontrado nesta academia." });
        res.json({ sucesso: true, mensagem: "Exercício removido do treino." });
    });
});

// =============================
// DISPOSITIVO RFID / SESSÕES DE USO
// =============================

async function finalizarSessaoPorToken(token, statusFinal = "concluido") {
    if (!STATUS_SESSAO_FINAL.includes(statusFinal)) throw new Error("Status final inválido.");
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();
        const [sessoes] = await connection.query(
            `SELECT * FROM sessoes_uso WHERE token = ? AND status = 'em_andamento' LIMIT 1 FOR UPDATE`,
            [token]
        );
        if (sessoes.length === 0) {
            await connection.rollback();
            return null;
        }
        const sessao = sessoes[0];
        const [resultado] = await connection.query(
            `UPDATE sessoes_uso SET status = ?, fim = NOW(), ultima_atividade = NOW()
             WHERE id = ? AND status = 'em_andamento'`,
            [statusFinal, sessao.id]
        );
        if (resultado.affectedRows === 0) {
            await connection.rollback();
            return null;
        }

        await connection.query(
            `INSERT INTO historico
             (academia_id, aluno_id, aparelho_id, plano_exercicio_id, exercicio, inicio_execucao, fim_execucao, tempo_execucao, status)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), TIMESTAMPDIFF(SECOND, ?, NOW()), ?)`,
            [sessao.academia_id, sessao.aluno_id, sessao.aparelho_id, sessao.plano_exercicio_id,
             sessao.exercicio, sessao.inicio, sessao.inicio, statusFinal]
        );

        await connection.query(
            `UPDATE aparelhos SET status = 'livre'
             WHERE id = ? AND academia_id = ? AND ativo = 1 AND status = 'ocupado'`,
            [sessao.aparelho_id, sessao.academia_id]
        );
        await connection.commit();
        io.emit("atualizar-aparelhos");
        io.emit("atualizar-dashboard");
        return { ...sessao, status: statusFinal };
    } catch (err) {
        await connection.rollback().catch(() => {});
        throw err;
    } finally {
        connection.release();
    }
}

async function encerrarSessoesExpiradas() {
    try {
        const [rows] = await db.promise().query(
            `SELECT token FROM sessoes_uso
             WHERE status = 'em_andamento'
             AND ultima_atividade < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [SESSION_TIMEOUT_MINUTES]
        );
        for (const row of rows) {
            await finalizarSessaoPorToken(row.token, "abandonado").catch((err) => {
                console.error("[FITID] Falha ao encerrar sessão expirada:", err.message);
            });
        }
    } catch (err) {
        // Durante a inicialização o banco pode ainda não estar disponível.
        console.error("[FITID] Verificação de timeout indisponível:", err.message);
    }
}

async function encerrarSessoesDoAluno(alunoId, academiaId, status = "cancelado") {
    const [rows] = await db.promise().query(
        `SELECT token FROM sessoes_uso WHERE aluno_id = ? AND academia_id = ? AND status = 'em_andamento'`,
        [alunoId, academiaId]
    );
    for (const row of rows) {
        await finalizarSessaoPorToken(row.token, status);
    }
}

app.get("/dispositivo/:codigo/:aparelhoId/:rfid", async (req, res) => {
    const codigo = normalizarCodigo(req.params.codigo);
    const aparelhoId = Number(req.params.aparelhoId);
    const rfid = String(req.params.rfid || "").trim();
    if (!codigo || !aparelhoId || !rfid) return res.status(400).json({ mensagem: "Dados de identificação incompletos." });

    await encerrarSessoesExpiradas();
    const connection = await db.promise().getConnection();
    try {
        await connection.beginTransaction();

        const [aparelhos] = await connection.query(`
            SELECT a.id AS aparelho_id, a.academia_id, a.nome AS aparelho_nome, a.status AS aparelho_status,
                   a.grupo_id, g.nome AS grupo_nome, ac.nome AS academia_nome, ac.codigo AS academia_codigo
            FROM aparelhos a
            JOIN academias ac ON ac.id = a.academia_id
            JOIN grupos_equipamento g ON g.id = a.grupo_id
            WHERE ac.codigo = ? AND a.id = ? AND a.ativo = 1
            LIMIT 1 FOR UPDATE
        `, [codigo, aparelhoId]);
        if (aparelhos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ mensagem: "Aparelho não encontrado nessa academia." });
        }
        const aparelho = aparelhos[0];
        if (aparelho.aparelho_status !== "livre") {
            await connection.rollback();
            return res.status(409).json({ mensagem: `Aparelho indisponível no momento: ${aparelho.aparelho_status}.` });
        }

        const [alunos] = await connection.query(`
            SELECT id AS aluno_id, academia_id, nome, status
            FROM alunos
            WHERE academia_id = ? AND rfid = ? AND ativo = 1
            LIMIT 1 FOR UPDATE
        `, [aparelho.academia_id, rfid]);
        if (alunos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ mensagem: "Pulseira não está vinculada a um aluno ativo desta academia." });
        }
        const aluno = alunos[0];
        if (aluno.status !== "ativo") {
            await connection.rollback();
            return res.status(403).json({ mensagem: "Cadastro do aluno está inativo nesta academia." });
        }

        const [abertas] = await connection.query(`
            SELECT su.id, su.aluno_id, su.aparelho_id, a.nome AS aparelho_nome
            FROM sessoes_uso su
            JOIN aparelhos a ON a.id = su.aparelho_id
            WHERE su.academia_id = ? AND su.status = 'em_andamento'
              AND (su.aluno_id = ? OR su.aparelho_id = ?)
            LIMIT 1
        `, [aparelho.academia_id, aluno.aluno_id, aparelho.aparelho_id]);
        if (abertas.length > 0) {
            await connection.rollback();
            return res.status(409).json({ mensagem: `Já existe uma sessão em andamento para este aluno ou aparelho (${abertas[0].aparelho_nome}). Finalize-a primeiro.` });
        }

        const [treinos] = await connection.query(`
            SELECT pt.id AS plano_id, pt.nome AS plano_nome, pe.id AS plano_exercicio_id,
                   e.nome AS exercicio, e.gif, pe.series, pe.repeticoes, pe.ordem
            FROM planos_treino pt
            JOIN plano_exercicios pe ON pe.plano_id = pt.id AND pe.academia_id = pt.academia_id
            JOIN exercicios e ON e.id = pe.exercicio_id AND e.academia_id = pt.academia_id
            WHERE pt.academia_id = ? AND pt.aluno_id = ? AND pt.ativo = 1
              AND e.ativo = 1 AND e.grupo_id = ?
            ORDER BY pt.criado_em DESC, pe.ordem ASC, pe.id ASC
            LIMIT 1
        `, [aparelho.academia_id, aluno.aluno_id, aparelho.grupo_id]);
        if (treinos.length === 0) {
            await connection.rollback();
            return res.status(404).json({ mensagem: "Não há exercício compatível com este aparelho nos treinos ativos do aluno." });
        }
        const treino = treinos[0];
        const token = crypto.randomUUID();

        await connection.query(`
            INSERT INTO sessoes_uso
            (token, academia_id, aluno_id, aparelho_id, plano_exercicio_id, plano_nome, exercicio, gif, series, repeticoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [token, aparelho.academia_id, aluno.aluno_id, aparelho.aparelho_id, treino.plano_exercicio_id,
            treino.plano_nome, treino.exercicio, treino.gif || null, treino.series, String(treino.repeticoes)]);

        await connection.query(`UPDATE aparelhos SET status = 'ocupado' WHERE id = ? AND status = 'livre'`, [aparelho.aparelho_id]);
        await connection.commit();
        io.emit("atualizar-aparelhos");
        io.emit("atualizar-dashboard");

        res.json({
            sessao_token: token,
            academia_id: aparelho.academia_id,
            academia_nome: aparelho.academia_nome,
            academia_codigo: aparelho.academia_codigo,
            aluno_id: aluno.aluno_id,
            nome: aluno.nome,
            aparelho_id: aparelho.aparelho_id,
            aparelho_nome: aparelho.aparelho_nome,
            grupo_id: aparelho.grupo_id,
            grupo_nome: aparelho.grupo_nome,
            plano_id: treino.plano_id,
            plano_nome: treino.plano_nome,
            plano_exercicio_id: treino.plano_exercicio_id,
            exercicio: treino.exercicio,
            gif: treino.gif,
            series: treino.series,
            repeticoes: treino.repeticoes,
            inicio: new Date().toISOString()
        });
    } catch (err) {
        await connection.rollback().catch(() => {});
        return erroServidor(res, err);
    } finally {
        connection.release();
    }
});

app.get("/sessoes/:token", async (req, res) => {
    try {
        const [rows] = await db.promise().query(`
            SELECT su.token AS sessao_token, su.status, su.inicio, su.fim, su.ultima_atividade,
                   su.academia_id, ac.nome AS academia_nome, ac.codigo AS academia_codigo,
                   su.aluno_id, al.nome,
                   su.aparelho_id, ap.nome AS aparelho_nome, g.nome AS grupo_nome,
                   su.plano_exercicio_id, su.plano_nome, su.exercicio, su.gif, su.series, su.repeticoes
            FROM sessoes_uso su
            JOIN academias ac ON ac.id = su.academia_id
            JOIN alunos al ON al.id = su.aluno_id
            JOIN aparelhos ap ON ap.id = su.aparelho_id
            JOIN grupos_equipamento g ON g.id = ap.grupo_id
            WHERE su.token = ? LIMIT 1
        `, [req.params.token]);
        if (rows.length === 0) return res.status(404).json({ mensagem: "Sessão não encontrada." });
        res.json(rows[0]);
    } catch (err) {
        return erroServidor(res, err);
    }
});

app.post("/sessoes/:token/heartbeat", async (req, res) => {
    try {
        const [result] = await db.promise().query(
            `UPDATE sessoes_uso SET ultima_atividade = NOW() WHERE token = ? AND status = 'em_andamento'`,
            [req.params.token]
        );
        if (result.affectedRows === 0) return res.status(404).json({ mensagem: "Sessão não está mais em andamento." });
        res.json({ sucesso: true });
    } catch (err) {
        return erroServidor(res, err);
    }
});

app.post("/sessoes/:token/finalizar", async (req, res) => {
    const status = String(req.body?.status || "concluido").toLowerCase();
    if (!["concluido", "cancelado"].includes(status)) {
        return res.status(400).json({ mensagem: "Status de finalização inválido." });
    }
    try {
        const sessao = await finalizarSessaoPorToken(req.params.token, status);
        if (!sessao) return res.status(409).json({ mensagem: "Sessão já foi finalizada ou não existe." });
        res.json({ sucesso: true, mensagem: status === "concluido" ? "Exercício concluído e histórico registrado." : "Sessão cancelada e aparelho liberado." });
    } catch (err) {
        return erroServidor(res, err);
    }
});

app.post("/demo/liberar-sessoes", exigirProfessor, async (req, res) => {
    const academiaId = academiaLogada(req);
    try {
        const [rows] = await db.promise().query(
            `SELECT token FROM sessoes_uso WHERE academia_id = ? AND status = 'em_andamento'`,
            [academiaId]
        );
        for (const row of rows) await finalizarSessaoPorToken(row.token, "cancelado");
        await db.promise().query(
            `UPDATE aparelhos SET status = 'livre' WHERE academia_id = ? AND ativo = 1 AND status = 'ocupado'
             AND id NOT IN (SELECT aparelho_id FROM sessoes_uso WHERE academia_id = ? AND status = 'em_andamento')`,
            [academiaId, academiaId]
        );
        io.emit("atualizar-aparelhos");
        res.json({ sucesso: true, mensagem: `${rows.length} sessão(ões) de demonstração liberada(s).` });
    } catch (err) {
        return erroServidor(res, err);
    }
});

// Compatibilidade com a tela antiga: informa explicitamente o novo fluxo seguro.
app.post("/historico", (req, res) => {
    res.status(410).json({
        sucesso: false,
        mensagem: "A finalização agora é feita pela sessão de uso. Utilize /sessoes/:token/finalizar."
    });
});

// =============================
// HISTÓRICO
// =============================

app.get("/alunos/:id/historico-recente", (req, res) => {
    const alunoId = req.params.id;
    const academiaId = academiaParaAlunoOuUsuario(req);

    if (!academiaId) return res.status(401).json({ mensagem: "Faça login para acessar o histórico." });
    if (req.session.aluno && String(req.session.aluno.id) !== String(alunoId)) {
        return res.status(403).json({ mensagem: "Você só pode acessar seu próprio histórico." });
    }

    const sql = `
        SELECT historico.exercicio, historico.data_execucao, historico.status,
               aparelhos.nome AS aparelho_nome, grupos_equipamento.nome AS grupo_nome
        FROM historico
        JOIN aparelhos ON aparelhos.id = historico.aparelho_id
        JOIN grupos_equipamento ON grupos_equipamento.id = aparelhos.grupo_id
        WHERE historico.aluno_id = ?
        AND historico.academia_id = ?
        ORDER BY historico.data_execucao DESC
        LIMIT 5
    `;

    db.query(sql, [alunoId, academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});


app.get("/historico", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);
    const sql = `
        SELECT historico.id, historico.academia_id, historico.aluno_id, historico.aparelho_id,
               historico.plano_exercicio_id, historico.exercicio, historico.inicio_execucao,
               historico.fim_execucao, historico.tempo_execucao, historico.data_execucao, historico.status,
               alunos.nome AS aluno_nome,
               aparelhos.nome AS aparelho_nome,
               grupos_equipamento.nome AS grupo_nome
        FROM historico
        JOIN alunos ON alunos.id = historico.aluno_id
        JOIN aparelhos ON aparelhos.id = historico.aparelho_id
        JOIN grupos_equipamento ON grupos_equipamento.id = aparelhos.grupo_id
        WHERE historico.academia_id = ?
        ORDER BY historico.data_execucao DESC
        LIMIT 50
    `;

    db.query(sql, [academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

// =============================
// ESTATÍSTICAS
// =============================

app.get("/estatisticas/:aluno", (req, res) => {
    const aluno = req.params.aluno;
    const academiaId = academiaParaAlunoOuUsuario(req);
    if (!academiaId) return res.status(401).json({ mensagem: "Faça login para acessar estatísticas." });
    if (!acessoAoAlunoPermitido(req, aluno)) return res.status(403).json({ mensagem: "Você só pode acessar seus próprios dados." });

    db.query(`SELECT COUNT(*) AS total_treinos FROM historico WHERE aluno_id = ? AND academia_id = ? AND status = 'concluido'`, [aluno, academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results[0]);
    });
});

app.get("/favorito/:aluno", (req, res) => {
    const aluno = req.params.aluno;
    const academiaId = academiaParaAlunoOuUsuario(req);
    if (!academiaId) return res.status(401).json({ mensagem: "Faça login para acessar estatísticas." });
    if (!acessoAoAlunoPermitido(req, aluno)) return res.status(403).json({ mensagem: "Você só pode acessar seus próprios dados." });

    const sql = `
        SELECT exercicio, COUNT(*) AS total
        FROM historico
        WHERE aluno_id = ? AND academia_id = ? AND status = 'concluido'
        GROUP BY exercicio
        ORDER BY total DESC
        LIMIT 1
    `;
    db.query(sql, [aluno, academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results[0] || { exercicio: "Nenhum", total: 0 });
    });
});

app.get("/grafico/:aluno", (req, res) => {
    const aluno = req.params.aluno;
    const academiaId = academiaParaAlunoOuUsuario(req);
    if (!academiaId) return res.status(401).json({ mensagem: "Faça login para acessar estatísticas." });
    if (!acessoAoAlunoPermitido(req, aluno)) return res.status(403).json({ mensagem: "Você só pode acessar seus próprios dados." });

    const sql = `
        SELECT exercicio, COUNT(*) AS total
        FROM historico
        WHERE aluno_id = ? AND academia_id = ? AND status = 'concluido'
        GROUP BY exercicio
        ORDER BY total DESC
    `;
    db.query(sql, [aluno, academiaId], (err, results) => {
        if (err) return erroServidor(res, err);
        res.json(results);
    });
});

app.get("/estatisticas-avancadas/:aluno", (req, res) => {
    const aluno = req.params.aluno;
    const academiaId = academiaParaAlunoOuUsuario(req);
    if (!academiaId) return res.status(401).json({ mensagem: "Faça login para acessar estatísticas." });
    if (req.session.aluno && String(req.session.aluno.id) !== String(aluno)) {
        return res.status(403).json({ mensagem: "Você só pode acessar suas próprias estatísticas." });
    }

    const sqlResumo = `SELECT COUNT(*) AS total_treinos, COUNT(DISTINCT exercicio) AS exercicios_diferentes FROM historico WHERE aluno_id = ? AND academia_id = ? AND status = 'concluido'`;
    const sqlFavorito = `SELECT exercicio, COUNT(*) AS total FROM historico WHERE aluno_id = ? AND academia_id = ? AND status = 'concluido' GROUP BY exercicio ORDER BY total DESC LIMIT 1`;
    const sqlUltimo = `SELECT exercicio, data_execucao FROM historico WHERE aluno_id = ? AND academia_id = ? AND status = 'concluido' ORDER BY data_execucao DESC LIMIT 1`;
    const sqlRanking = `SELECT exercicio, COUNT(*) AS total FROM historico WHERE aluno_id = ? AND academia_id = ? AND status = 'concluido' GROUP BY exercicio ORDER BY total DESC LIMIT 5`;

    db.query(sqlResumo, [aluno, academiaId], (errResumo, resumo) => {
        if (errResumo) return erroServidor(res, errResumo);
        db.query(sqlFavorito, [aluno, academiaId], (errFavorito, favorito) => {
            if (errFavorito) return erroServidor(res, errFavorito);
            db.query(sqlUltimo, [aluno, academiaId], (errUltimo, ultimo) => {
                if (errUltimo) return erroServidor(res, errUltimo);
                db.query(sqlRanking, [aluno, academiaId], (errRanking, ranking) => {
                    if (errRanking) return erroServidor(res, errRanking);
                    res.json({
                        resumo: resumo[0],
                        favorito: favorito[0] || { exercicio: "Nenhum", total: 0 },
                        ultimo: ultimo[0] || { exercicio: "Nenhum", data_execucao: null },
                        ranking
                    });
                });
            });
        });
    });
});

// =============================
// DASHBOARD INTELIGENTE
// =============================

app.get("/dashboard-inteligente", exigirProfessor, (req, res) => {
    const academiaId = academiaLogada(req);

    const sqlCheckinsHoje = `SELECT COUNT(*) AS total FROM historico WHERE academia_id = ? AND status = 'concluido' AND DATE(data_execucao) = CURDATE()`;
    const sqlUltimoAluno = `
        SELECT alunos.nome, historico.exercicio, historico.data_execucao, aparelhos.nome AS aparelho_nome
        FROM historico
        JOIN alunos ON alunos.id = historico.aluno_id
        JOIN aparelhos ON aparelhos.id = historico.aparelho_id
        WHERE historico.academia_id = ?
        ORDER BY historico.data_execucao DESC
        LIMIT 1
    `;
    const sqlExercicioMaisUsado = `SELECT exercicio, COUNT(*) AS total FROM historico WHERE academia_id = ? AND status = 'concluido' GROUP BY exercicio ORDER BY total DESC LIMIT 1`;
    const sqlHistoricoRecente = `
        SELECT alunos.nome, historico.exercicio, historico.data_execucao, aparelhos.nome AS aparelho_nome
        FROM historico
        JOIN alunos ON alunos.id = historico.aluno_id
        JOIN aparelhos ON aparelhos.id = historico.aparelho_id
        WHERE historico.academia_id = ?
        ORDER BY historico.data_execucao DESC
        LIMIT 5
    `;
    const sqlAlunosAtivos = `
        SELECT alunos.nome, COUNT(*) AS total
        FROM historico
        JOIN alunos ON alunos.id = historico.aluno_id
        WHERE historico.academia_id = ? AND historico.status = 'concluido'
        GROUP BY alunos.nome
        ORDER BY total DESC
        LIMIT 5
    `;

    db.query(sqlCheckinsHoje, [academiaId], (err1, checkins) => {
        if (err1) return erroServidor(res, err1);
        db.query(sqlUltimoAluno, [academiaId], (err2, ultimoAluno) => {
            if (err2) return erroServidor(res, err2);
            db.query(sqlExercicioMaisUsado, [academiaId], (err3, exercicioMaisUsado) => {
                if (err3) return erroServidor(res, err3);
                db.query(sqlHistoricoRecente, [academiaId], (err4, historicoRecente) => {
                    if (err4) return erroServidor(res, err4);
                    db.query(sqlAlunosAtivos, [academiaId], (err5, alunosAtivos) => {
                        if (err5) return erroServidor(res, err5);
                        res.json({
                            checkinsHoje: checkins[0],
                            ultimoAluno: ultimoAluno[0] || null,
                            exercicioMaisUsado: exercicioMaisUsado[0] || null,
                            historicoRecente,
                            alunosAtivos
                        });
                    });
                });
            });
        });
    });
});

// =============================
// RELATÓRIO PDF
// =============================

app.get("/relatorio/:aluno", (req, res) => {
    const aluno = req.params.aluno;
    const academiaId = academiaParaAlunoOuUsuario(req);
    if (!academiaId) return res.status(401).json({ mensagem: "Faça login para acessar o relatório." });
    if (req.session.aluno && String(req.session.aluno.id) !== String(aluno)) {
        return res.status(403).json({ mensagem: "Você só pode acessar seu próprio relatório." });
    }

    const sql = `
        SELECT alunos.nome, historico.exercicio, historico.data_execucao, historico.status,
               aparelhos.nome AS aparelho_nome, grupos_equipamento.nome AS grupo_nome
        FROM historico
        JOIN alunos ON alunos.id = historico.aluno_id
        JOIN aparelhos ON aparelhos.id = historico.aparelho_id
        JOIN grupos_equipamento ON grupos_equipamento.id = aparelhos.grupo_id
        WHERE historico.aluno_id = ?
        AND historico.academia_id = ?
        ORDER BY historico.data_execucao DESC
    `;

    db.query(sql, [aluno, academiaId], (err, results) => {
        if (err) return erroServidor(res, err);

        const doc = new PDFDocument();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline; filename=relatorio-fitid.pdf");

        doc.pipe(res);
        doc.fontSize(25).text("FITID - Relatório do Aluno");
        doc.moveDown();

        const nomeAluno = results[0] ? results[0].nome : `Aluno ID: ${aluno}`;
        doc.fontSize(18).text(nomeAluno);
        doc.moveDown();

        if (results.length === 0) {
            doc.fontSize(14).text("Nenhum histórico registrado.");
        } else {
            results.forEach((item, index) => {
                doc.fontSize(12).text(`${index + 1}. ${item.exercicio} | ${item.aparelho_nome} (${item.grupo_nome}) | ${item.status} | ${item.data_execucao}`);
            });
        }
        doc.end();
    });
});

// Tratamento global: evita que erros de middleware/JSON exponham stack traces ao cliente.
app.use((err, req, res, next) => {
    console.error("[FITID] Erro de middleware:", err && err.message ? err.message : err);
    if (res.headersSent) return next(err);

    if (err && err.message === "Origem não permitida pelo CORS.") {
        return res.status(403).json({ sucesso: false, mensagem: "Origem não autorizada." });
    }
    if (err && err.type === "entity.parse.failed") {
        return res.status(400).json({ sucesso: false, mensagem: "JSON inválido na requisição." });
    }
    return res.status(500).json({ sucesso: false, mensagem: "O servidor não conseguiu concluir a operação." });
});

async function iniciarServidor() {
    await prepararBanco();
    await encerrarSessoesExpiradas();
    try {
        await db.promise().query(`
            UPDATE aparelhos a
            LEFT JOIN sessoes_uso su ON su.aparelho_id = a.id AND su.status = 'em_andamento'
            SET a.status = 'livre'
            WHERE a.status = 'ocupado' AND su.id IS NULL
        `);
    } catch (err) {
        console.error("[FITID] Recuperação inicial de ocupações não executada:", err.message);
    }

    setInterval(encerrarSessoesExpiradas, 30 * 1000).unref();
    server.listen(PORT, () => {
        console.log(`[FITID] Servidor rodando em http://localhost:${PORT}`);
        console.log(`[FITID] Diagnóstico: http://localhost:${PORT}/diagnostico`);
        if (SESSION_SECRET === "fitid-demo-local-troque-em-producao") {
            console.warn("[FITID] Aviso: usando segredo de sessão local de demonstração. Configure SESSION_SECRET em produção.");
        }
    });
}

iniciarServidor();
