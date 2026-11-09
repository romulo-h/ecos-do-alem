# Ecos do Além — versão web

Jogo de navegador: caçada assimétrica numa mansão vitoriana. Fantasmas possuem móveis e precisam trocar de
esconderijo a cada 20 s; caçadores rastreiam com EMF, câmera térmica e aspirador ectoplásmico. Quando o tempo
da busca acaba com fantasmas livres, a caçada se inverte por 2 minutos.

É o mesmo jogo do projeto Unity (`../EcosDoAlem`), reescrito em TypeScript + Three.js na arquitetura do
expediente-caotico: a regra fica num pacote puro e testado, e o cliente só desenha e manda intenções.
Os dados da mansão (`map_data.json`, `props_layout.json`), os 12 modelos dos móveis e os 13 sons são os originais.

## Requisitos

- Node 22 ou mais novo.
- pnpm 10 (`npm i -g pnpm`).

## Comandos

```bash
pnpm install     # instala tudo
pnpm dev         # jogo em http://localhost:5174
pnpm test        # regras do jogo (Vitest)
pnpm typecheck   # TypeScript nos pacotes
pnpm build       # build de produção em apps/web/dist (site estático)
```

O build é um site estático: dá para publicar `apps/web/dist` em qualquer hospedagem de arquivos
(itch.io, GitHub Pages, Netlify, Nginx). Precisa ser servido por HTTP; abrir o `index.html` direto não funciona.

## Como jogar

Escolha o time em **Jogar**. Os outros lugares (até 2 caçadores e 4 fantasmas) são preenchidos por bots.
Clique na tela para prender o mouse. **Esc** ou **P** pausa; a partida também pausa quando a janela perde o foco.

| Fantasma (3ª pessoa) | | Caçador (1ª pessoa) | |
|---|---|---|---|
| WASD / mouse | mover / câmera | WASD / mouse | andar / olhar |
| E | possuir o móvel mirado / sair | Shift | correr (gasta estamina) |
| Espaço | sair do móvel | Botão esq. | Aspirador Ectoplásmico |
| Q | Salto Espectral (até 6 m) | Botão dir. | mirar |
| R | Assombração Ativa · bater porta | E | abrir / fechar porta |
| Botão esq. | Toque Gélido (Caçada Invertida) | F · T · G | lanterna · câmera térmica · sal |

## Estrutura

```
packages/shared   TODA a regra do jogo, sem navegador (roda igual no servidor da etapa 2)
  src/data/       balance.ts (números), mansion.ts (lê os JSON), map_data.json, props_layout.json
  src/world/      walls.ts (porte do MansionWalls.cs), world.ts (colisão 2,5D, chão, escadas, raycast),
                  nav.ts (grafo de cômodos para os bots)
  src/sim/        match.ts (partida: fases, possessão, regra dos 20 s, aspirador, EMF, sal, portas,
                  Caçada Invertida, vitória), bots.ts, types.ts (Intent, estado, eventos)
  src/test/       testes das regras e uma partida inteira só com bots
apps/web          React (menus, HUD, pausa, resultado) + Three.js (cena, câmeras, som)
  src/game/       session.ts (laço de 30 passos/s), scene.ts, actors.ts, audio.ts, input.ts
  public/assets/  moveis/ (.obj + .mtl) e audio/ (.wav), copiados do projeto Unity
```

Regras da casa (iguais às do expediente): a simulação decide dano, possessão e recargas; o cliente só manda
intenções (`Intent`). Números de balanceamento ficam em `packages/shared/src/data/balance.ts`. Regra nova vem
com teste em `packages/shared/src/test/`.

Em modo dev, `window.__ecos` dá acesso à sessão (`window.__ecos.debugState` é o estado da partida), para
depurar pelo console. Não existe no build de produção.

## Ajustando o jogo

- **Tempos, danos, alcances:** `packages/shared/src/data/balance.ts`.
- **Mansão e móveis:** os JSON em `packages/shared/src/data/` (mesmo formato do projeto Unity; o teste avisa se
  uma porta não cair sobre uma parede). Paredes, portas, escadas e colisão saem desses dados.
- **Janelas e luar:** posição em `packages/shared/src/world/windows.ts` (`WINDOW`: largura, espaçamento, peitoril);
  cor e força do luar em `MOON`, em `apps/web/src/game/scene.ts`. As janelas são só visuais: na física a parede
  continua inteira (vidro).
- **Candelabros:** um de parede em cada cômodo interno; posição em `packages/shared/src/world/candelabra.ts`,
  luz e cor em `CANDLE` (`scene.ts`). Só visuais, acima da cabeça.
- **Luzes e desempenho:** luz real custa caro por pixel em GPU integrada (33 luzes derrubavam o jogo para
  15 FPS). Por isso o luar e as velas usam um grupo fixo de luzes (`LightPool` em `scene.ts`) que segue as
  janelas e candelabros mais perto da câmera; os outros ficam só com o brilho desenhado. Quantas luzes cada
  qualidade usa está em `session.ts` (baixa 2+1, média 3+2, alta 5+4).
- **Bots:** `packages/shared/src/sim/bots.ts`.
- **Visual:** cores e luzes em `apps/web/src/game/scene.ts`; personagens em `apps/web/src/game/actors.ts`.

## Diferenças em relação ao Unity

- Física própria em 2,5D (cilindros contra caixas, por andar) no lugar do PhysX. As escadas são rampa na
  física e degraus no visual, como no loader do Unity.
- A cena é espelhada em relação ao Unity (mesmos números de coordenada, convenção do Three.js); para quem joga
  não muda nada.
- Personagens são as figuras procedurais (caçador de casaco e chapéu; fantasma de mortalha), como no Unity
  enquanto o `.glb` real não chega.

## Próxima etapa (2): multiplayer

Servidor Node + WebSocket com salas, como o `apps/server` do expediente-caotico: o servidor roda o mesmo
`stepMatch` a 30 passos/s, recebe as `Intent` de cada jogador, completa com bots e manda snapshots. O cliente
passa a interpolar snapshots em vez de rodar a simulação. Pontos já preparados: a simulação é pura e
determinística, o cliente só gera `Intent`, e o estado é serializável.
Atenção para a etapa 2: hoje o estado inclui `possessedBy` de cada móvel; o servidor deve filtrar isso nos
snapshots dos caçadores.
