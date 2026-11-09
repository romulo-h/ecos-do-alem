# Ecos do Além — v1.8

Projeto Unity (2021.3 LTS ou mais novo, C# 9). Copie a pasta `Assets/` para dentro do seu projeto.
Montagem passo a passo: `Docs/character_setup_guide.md` (seção 3 = cena de teste em 4 passos).

## Estrutura
```
Assets/Scripts   GhostGameManager, GhostController, GhostCamera, HunterController, PossessableProp,
                 SaltBarrier, SpectralFootprint, GameHUD, MansionLayoutLoader, MansionWalls, MansionDoor,
                 CharacterAnimationCore, CharacterAnimator, ProceduralCharacterRig,
                 GameMenu, MatchSetup, MatchSettings, UITheme (interface — v1.8)
Assets/Data      map_data.json, props_layout.json (corrigidos)
Assets/Audio     13 sons (.wav)
Assets/Models    LEIA-ME.txt — o .glb original era só um atalho do Drive
Assets/Resources/Moveis   8 modelos .obj dos móveis + materiais (.mtl)
Docs             game_design.md, character_setup_guide.md, planta_gerada.png, planta_referencia.jpg,
                 moveis_preview.png, animacoes_quadros.png, animacoes.gif
Tools            validate_data.py — valida os JSON (python3 Tools/validate_data.py)
```

## Novidades da v1.8 — interface do jogo
Menus em OnGUI, no mesmo esquema da HUD (sem Canvas nem pacotes), com tema vitoriano (dourado, vinho, ciano espectral)
e layout que se ajusta a qualquer resolução (referência de 1080 px de altura, fontes refeitas no tamanho real).
- **Menu principal** sobre a mansão gerada, com câmera orbitando: Jogar · Opções · Controles · Sair.
- **Nova partida:** escolha do time (Fantasma/Caçador), 1–4 fantasmas, 1–2 caçadores, duração da busca (3/6/9/12 min)
  e Caçada Invertida ligada ou desligada. O `MatchSetup` **cria os jogadores sozinho**, com câmera, lanterna,
  feixe do aspirador e sons, e coloca todos nos spawns. Não é mais preciso montar personagem à mão.
- **Pausa (Esc):** congela a partida e o áudio; Continuar · Opções · Controles · Reiniciar · Menu principal.
- **Opções:** sensibilidade do mouse, volume geral, som ambiente, tela cheia e qualidade gráfica (salvos em PlayerPrefs).
- **Controles:** as teclas dos dois times.
- **Resultado:** vencedor, motivo, "Você venceu/perdeu", fantasmas livres, caçadores de pé, duração e seu destino;
  Jogar de novo (mesmas escolhas) · Menu principal · Sair.
- Enquanto um menu está aberto, caçador, fantasma e câmera do fantasma ignoram teclado e mouse (`GameMenu.InputBlocked`).
- **Modo treino:** sem rede, os outros jogadores ficam parados nos spawns.
- Cena antiga com jogadores montados à mão continua funcionando: o menu usa esses jogadores e só deixa escolher
  duração e Caçada Invertida. Para pular o menu, desligue `GameMenu.showMenuOnStart`.
- "Jogar de novo" e "Menu principal" recarregam a cena. Na build, a cena precisa estar em *File > Build Settings*.
- Verificado: todos os scripts compilam com 0 erros e 0 avisos contra UnityEngine 2021.3 (build do jogo e do editor).

### Jogar no navegador (WebGL)
*File > Build Settings* → instale **WebGL Build Support** no Unity Hub → adicione a cena → **WebGL** → *Build*.
A build precisa ser servida por um servidor web (o *Build And Run* do Unity serve para testar; para publicar,
itch.io ou GitHub Pages com *Decompression Fallback* ligado). Só computador: teclado e mouse.
- No navegador, o Esc solta o mouse e não chega ao jogo; o menu percebe isso e **pausa sozinho**
  (`Assets/Plugins/WebGL/EcosPointerLock.jslib`). **P** também pausa/despausa, em qualquer plataforma.
- Depois de despausar, clique na tela para o navegador prender o mouse de novo (aparece um aviso).
- O botão **Sair** some no WebGL (uma página não pode fechar o jogo).
- A partida também pausa quando a janela/aba perde o foco (`GameMenu.pauseOnFocusLoss`).

## Novidades da v1.7 — Caçada Invertida e animações
**Caçada Invertida** (`GhostGameManager.enableReversal`, 2 min): quando os 6 min de busca acabam com fantasmas vivos,
a caçada se inverte.
- Fantasmas saem dos móveis (não podem mais possuir), ficam mais rápidos (5,6 m/s) e atacam com o **Toque Gélido**
  (botão esquerdo, 34 de dano, alcance 1,8 m, recarga 1,1 s). O golpe não atravessa parede, porta fechada nem sal.
- Caçadores ficam com o aspirador **sem bateria** e precisam fugir: correr gasta **estamina** (corrida 6,2 m/s, só
  enquanto houver estamina; esgotou, recupera até 25% antes de correr de novo). O sal continua bloqueando fantasmas,
  e o EMF passa a apitar com fantasmas por perto.
- Caçador tem 100 de vida (3 golpes). **Todos os caçadores mortos → vitória dos fantasmas.** Caçadores vencem se
  sobreviverem os 2 min (ou se exorcizarem todos os fantasmas antes).
- HUD: faixa "A CAÇADA SE INVERTEU!", cronômetro vermelho, vida/estamina, tela de morte. Sons novos:
  `inversao_cacada.wav`, `ataque_fantasma.wav`, `cacador_ferido.wav`.

**Animações** (`CharacterAnimator`): enquanto o `.glb` real não chega, cada personagem ganha uma figura própria
(caçador de casaco e chapéu com o aspirador; fantasma de mortalha com olhos brilhantes) animada por código:
- Caçador: parado (respiração), andar, correr (inclinado, braços dobrados), mirar o aspirador, golpeado, morte (cai de costas;
  a câmera em 1ª pessoa cai junto).
- Fantasma: flutuar, deslizar (cauda arrastando), fúria na Caçada Invertida (garras, olhos vermelhos), Toque Gélido
  (prepara e golpeia; o dano sai no instante do golpe), surgir do móvel, piscar quando exposto, exorcismo (gira, sobe e some).
- Quadros gerados pelo próprio código de poses do jogo: `Docs/animacoes_quadros.png` e `Docs/animacoes.gif`.
- **Modelo real com Animator:** coloque o modelo como `ghostVisualModel`/`hunterBodyModel`; o `CharacterAnimator`
  envia `Speed` (float), `Sprint`, `Aiming`, `Dead`, `Possessing`, `Fury` (bool) e `Attack`, `Hit`, `Emerge` (trigger)
  — só os que existirem no seu Animator Controller.

## Novidades da v1.6 — mesa de jantar e aparador
- **Mesa de Jantar** (Sala de Jantar, sob o lustre) com **4 copos**; **Aparador** (Copa, encostado na parede) com **3 copos**.
  Os dois são possuíveis. Modelos `mesa_jantar.obj` e `aparador.obj`.
- Objetos apoiados reagem ao apoio: assombrar a mesa, o aparador ou uma pia faz os copos em cima **tilintarem e sacudirem**;
  no aviso dos 15 s os copos tremem junto com o móvel de baixo (`PossessableProp.supportedBy`, ligado pelo loader via `on_top_of`).
- Total de móveis possuíveis: 49 → **58** (12 copos ao todo).

## Novidades da v1.5 — vasos de planta e copos
- **8 Vasos de Planta** (categoria Planta): Vestíbulo, Hall de Entrada, Sala de Jantar, Sala de Estar, Escritório,
  Varanda, Hall Superior e Suíte. Assombrados, as folhas balançam e farfalham (`planta_farfalhar.wav`).
- **5 Copos de Cristal** (categoria Louça), apoiados nas pias: 2 na Cozinha, 1 no WC e 1 em cada banheiro de cima.
  Difíceis de achar, mas assombrados tilintam alto (`copo_tilintando.wav`) e tremem pouco (objeto pequeno).
- Total de móveis possuíveis: 36 → **49**. Modelos novos em `Assets/Resources/Moveis/` (`vaso_planta.obj`, `copo_cristal.obj`).
- Campo novo `on_top_of` no `props_layout.json` para objetos apoiados em outro móvel; o validador confere se
  o objeto está na altura do tampo (`top_surface`) e dentro dele.

## Novidades da v1.4 — modelos 3D dos móveis
- 8 modelos low-poly vitorianos em `Assets/Resources/Moveis/` (`.obj` + `moveis_vitorianos.mtl`), um para cada item do
  catálogo, nas medidas do `props_layout.json`. Prévia: `Docs/moveis_preview.png`.
- O `MansionLayoutLoader` carrega os modelos sozinho (pasta Resources); não precisa ligar nada.
  Para trocar por modelos finais, use o campo *Prop Prefabs* (tem prioridade) ou substitua os `.obj` com o mesmo nome.
- Colisor de cada móvel calculado no espaço local (fica certo com o móvel girado); luz do lustre no centro do modelo.
- Convenção dos modelos: metros, pivô no centro da base, frente para +Z. 5 móveis foram girados para encostar
  o fundo/cabeceira na parede.
- Projeto em URP/HDRP: se os materiais importados aparecerem rosa, use *Edit > Rendering > Materials > Convert…*
  (ou troque o shader para Lit).

## Novidades da v1.3 — mapa da planta baixa, paredes internas e portas
- `map_data.json` refeito a partir da planta de referência (`Docs/planta_referencia.jpg`): 27 cômodos, varanda em L,
  escada dupla com núcleo central. Resultado em `Docs/planta_gerada.png`.
- `MansionWalls.cs` gera as paredes sozinho a partir dos cômodos: interna onde dois cômodos se encostam,
  externa (altura cheia) na fachada, guarda-corpo na varanda e em volta das escadas, vergas acima dos vãos.
- 27 aberturas: 13 portas simples, 2 duplas, 4 passagens com verga e 8 vãos abertos. Cada porta abre para o cômodo definido em `swing_into`.
- `MansionDoor.cs`: caçador abre/fecha com **E**; fantasma atravessa portas fechadas e as **bate** com R. Sons novos `porta_rangendo.wav` e `porta_batendo.wav`.
- Escadas com rampa invisível (subida suave do CharacterController).
- Os 36 móveis foram redistribuídos nos novos cômodos, sem bloquear nenhuma porta.
- `Tools/validate_data.py` agora também confere portas, área de abertura e se todos os cômodos são alcançáveis.
- Diferenças em relação à planta: janelas em bay, lareiras e colunas da varanda foram simplificadas para retângulos;
  a Escada de Serviço não existe na planta e foi mantida pelo game design (Despensa → Quarto dos Fundos Esquerdo);
  o Quarto de Apoio não tem porta desenhada — ganhou uma porta para a Galeria.

## O que foi corrigido na v1.1
**Compilação e execução**
- Removida a classe `HunterController` duplicada em `GhostGameManager.cs` (erro CS0101/CS0111).
- `PossessableProp` não exige mais a tag "Possessable" (que gerava erro se não existisse).
- Sensor EMF não depende mais de `propLayer` (que vinha como "Nothing").
- Verificado: os scripts compilam com 0 erros e 0 avisos.

**Mecânicas do design que faltavam**
- Regra dos 20 s com raio de 2 m, bloqueio da zona após expulsão e pulso vermelho na HUD aos 15 s.
- Salto Espectral (Q) e Assombração Ativa (R), com isca no EMF para enganar os caçadores.
- Aspirador atinge o fantasma na forma etérea/exposta; dentro do móvel ele é expulso após 1,5 s de feixe.
- Câmera Térmica/UV (T) com pegadas espectrais; Sal Purificador (G) que bloqueia passagens e o salto.
- Bipes do EMF (1–5), alerta de instabilidade, ruído de expulsão, tic-tac do relógio, som ambiente.
- Fantasma com CharacterController: colide com paredes e sobe as escadas. Câmera em 3ª pessoa própria.
- Fase de esconderijo separada dos 6 min; fim de partida congela todos e mostra o vencedor.
- HUD (OnGUI, sem dependências) para os dois times.
- `MansionLayoutLoader`: gera a mansão jogável a partir dos JSON (pisos, escadas, paredes externas, 36 móveis).

**Dados**
- `depth_z` 17 → 14 m (medida real dos cômodos).
- Criados os cômodos que os móveis citavam e o mapa não tinha (Lavabo, Banheiro da Suite, Ala Direita Frente/Posterior),
  mais Corredor Térreo, Hall da Escada e Patamar de Serviço para fechar buracos no piso.
- Cama `prop_25` saiu de cima da poltrona do Quarto de Costura; `prop_35` agora está dentro do Quarto de Apoio.
- Dimensões dos móveis no catálogo, direção de subida das escadas e pontos de spawn.

**Áudio**
- `interacao_movel_assombrado.wav` estava no volume máximo → normalizado em −1 dBFS.
- `mansao_drone_ambiente.wav` sumia no fim e no início (queda a cada 6 s no loop) → emenda com crossfade, 5 s.

## O que ainda falta (não dá para resolver só com código)
- **Modelo 3D dos personagens:** o `.glb` real do caçador e do fantasma (está no Google Drive). Até lá, figuras procedurais animadas.
- **Multiplayer em rede:** o jogo roda localmente (um jogador controlado por máquina via `isLocallyControlled`).
  Para 2v4 online é preciso integrar Netcode for GameObjects, Mirror ou Photon.
- Vapor do chuveiro reduzindo a visão térmica (citado no catálogo) não foi implementado.
