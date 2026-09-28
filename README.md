# FITID Web

Aplicação Web administrativa do FITID, desenvolvida em React + Vite + TypeScript.

## Principais recursos

- Firebase Authentication com e-mail e senha;
- cadastro do usuário no Authentication;
- login, logout e rota administrativa protegida;
- React Router DOM;
- formulários com React Hook Form e Zod;
- CSS global com variáveis e CSS Modules;
- consumo da API Node/Express já existente no projeto;
- página Sobre com objetivo, funcionalidades e integrantes.

## Configuração do Firebase

Copie `.env.example` para `.env.local` e preencha as variáveis com os dados do projeto Firebase usado também pelo Mobile.

Depois execute:

```bash
npm install
npm run dev
```

O pacote `firebase` já está declarado no `package.json`.
