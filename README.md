# Ecos do Além

Caçada assimétrica numa mansão vitoriana. Fantasmas possuem móveis e precisam trocar de esconderijo a cada
20 s; caçadores rastreiam com EMF, câmera térmica e aspirador ectoplásmico. Quando o tempo da busca acaba
com fantasmas livres, a caçada se inverte por 2 minutos.

Este repositório tem duas versões do mesmo jogo:

| Pasta | O que é |
|---|---|
| [`ecos-web/`](ecos-web) | **Versão de navegador** (TypeScript + Three.js + React). Joga contra bots direto no navegador. |
| [`EcosDoAlem/`](EcosDoAlem) | Projeto Unity original: scripts, dados da mansão, modelos, sons e documentação. |

## Jogar no navegador

Precisa de Node 22+ e pnpm 10.

```bash
cd ecos-web
pnpm install
pnpm dev        # abre em http://localhost:5174
```

Os comandos de teste, build e os ajustes do jogo estão no [README da versão web](ecos-web/README.md).
