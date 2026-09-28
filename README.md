# FITID — Web + Backend

Projeto de TCC do 3º ano do Ensino Médio Integrado em Desenvolvimento de Sistemas da Etec de Hortolândia.

## Objetivo

O FITID é um sistema para academias que relaciona aluno, treino e aparelho por RFID. O protótipo identifica o aluno no equipamento, apresenta o exercício previsto, registra a sessão de uso e disponibiliza informações para professor, aluno e público.

## Aplicação Web

A aplicação Web foi desenvolvida com React, Vite e TypeScript. Ela possui:

- Firebase Authentication por e-mail e senha;
- proteção das rotas administrativas;
- React Router DOM;
- React Hook Form + Zod;
- CSS global com variáveis e CSS Modules;
- painel administrativo;
- alunos, grupos, aparelhos, exercícios e treinos;
- histórico e estatísticas;
- simulador RFID;
- página pública de lotação;
- página Sobre.

## Backend

O backend atual foi mantido conforme orientação do professor. O Firebase é usado nesta etapa para Authentication; os dados do sistema continuam no MySQL.

Tecnologias:

- Node.js + Express;
- MySQL;
- Socket.IO;
- sessões HTTP;
- hash de senha;
- isolamento dos dados por academia.

## Firebase Authentication

A mesma configuração do projeto Firebase é usada pela Web e pelo Mobile. O método habilitado deve ser **E-mail/senha**.

Na Web, o login funciona em duas etapas: o Firebase Authentication valida a credencial e o backend atual cria a sessão administrativa usada para acessar os dados da academia no MySQL.

As chaves do Firebase não ficam escritas no código. Elas devem ser copiadas para `fitid-react/.env.local`, usando `fitid-react/.env.example` como modelo.

## Protótipo físico

O projeto prevê integração com:

- ESP32-S3 N16R8;
- leitor RFID RC522;
- display IPS 3,5" com touch;
- identificação do aluno no aparelho;
- exibição de séries, repetições e exercício;
- registro da sessão no histórico.

## Como executar

1. Configure o MySQL usando `fitid.sql`.
2. Copie `.env.example` para `.env` e confira as credenciais do banco.
3. No projeto Web, copie `fitid-react/.env.example` para `fitid-react/.env.local` e preencha os dados do Firebase.
4. No Firebase Console, habilite Authentication > Sign-in method > E-mail/senha.
5. Instale as dependências do backend com `npm install`.
6. Instale as dependências Web em `fitid-react` com `npm install`.
7. Inicie o backend com `npm start`.
8. Inicie o Web em `fitid-react` com `npm run dev`.

## Integrantes

- Gustavo Squisatti Silva
- Giovanne Vieira Reinaldi
- Caleb Costa Jorge
- Fabricio De Campos Costa
