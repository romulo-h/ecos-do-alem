# 🕯️ Documento de Game Design: Ecos do Além (Ghost Hunt)

---

## 1. Visão Geral
**Ecos do Além** é um jogo multiplayer assimétrico de dedução e perseguição.
* **Gênero:** Multiplayer Assimétrico / Prop Hunt & Deduction
* **Cenário:** Mansão Vitoriana de Dois Andares com Escada de Serviço
* **Plataforma Alvo:** PC / Consoles

---

## 2. Regras Principais e Condições de Vitória

| Equipe | Papel | Condição de Vitória | Condição de Derrota |
| :--- | :--- | :--- | :--- |
| **Fantasmas** | Camuflagem espectral em móveis | Sobreviver até o tempo esgotar (≥1 vivo) | Todos os fantasmas exorcizados |
| **Caçadores** | Triangulação, perseguição e exorcismo | Eliminar todos os fantasmas | Tempo limite esgotado |

### Configuração Padrão
* **Tempo de Rodada:** 6 minutos.
* **Proporção:** 2 Caçadores vs 4 Fantasmas.
* **Fase de Esconderijo:** 15 segundos iniciais livres para fantasmas.

---

## 3. Mecânica do Fantasma (Regra dos 20 Segundos)
* **Possessão:** O fantasma mira num móvel e assume a sua forma física.
* **Instabilidade Ectoplásmica (20s):**
  * Não pode ficar no mesmo móvel ou raio de 2m por mais de 20s.
  * **15s:** Objeto treme e emite pulso avermelhado na HUD.
  * **20s:** Expulsão forçada com ruído audível e silhueta brilhante visível por 3 segundos.
* **Habilidades:**
  * *Salto Espectral (CD: 20s):* Salta diretamente para outro móvel a até 6 metros sem revelar a forma espiritual.
  * *Assombração Ativa (CD: 12s):* Move louças, pisca lustres ou bate portas para enganar os radares.

---

## 4. Mecânica dos Caçadores
* **Sensor EMF:** Bips sonoros e visuais de 1 a 5 conforme a proximidade de móveis assombrados.
* **Câmera Térmica / UV:** Detecta pegadas espectrais frescas nos pisos e escadas.
* **Aspirador Ectoplásmico:** Canaliza feixe para expulsar e capturar o espírito.
* **Sal Purificador:** Bloqueia temporariamente passagens e escadas.

---

## 5. Mapa e Rotas Verticais (v1.3 — segue a planta baixa de referência)
Planta gerada: `Docs/planta_gerada.png` · referência: `Docs/planta_referencia.jpg`.
* **Térreo (13 áreas):** Varanda em L (frente e lateral), Vestíbulo, Hall de Entrada, Escritório/Biblioteca, Sala de Jantar, Sala de Estar, Cozinha + Bancada, Copa, Despensa, WC e Circulação de Serviço.
* **Primeiro andar (14):** Hall Superior, Galeria da Escada, Suíte Principal com Closet e Banheiro, Quarto de Apoio, Banheiro Social, Quartos dos Fundos (esq./dir.), Quarto de Costura, Quarto da Frente, Corredor Leste.
* **Escada Dupla (Hall de Entrada):** dois lances sobem da frente para os fundos, ao redor de um núcleo central. No andar de cima o núcleo vira uma passarela que liga o Hall Superior à frente da Galeria (Suíte e Quarto de Apoio). Alta visibilidade e risco.
* **Escada de Serviço:** *não existe na planta de referência*; mantida pelo game design. Sobe da Despensa ao Quarto dos Fundos (Esquerdo), ao lado do Banheiro Social. Caminho estreito e discreto para rotação de fantasmas.
* **Rotas de perseguição:** a ala da Cozinha/Escritório não se liga ao Hall por dentro (como na planta); o caminho passa pela Sala de Estar ou pela Varanda. A Sala de Jantar é um beco sem saída.

---

## 6. Regras Detalhadas (v1.1 — definidas na implementação)
Pontos que o documento original deixava em aberto e como o código resolve:

| Tema | Regra implementada | Onde ajustar |
| :--- | :--- | :--- |
| Fase de esconderijo | Os 15 s **não** são descontados dos 6 min; caçadores ficam parados e com a tela preta. | `GhostGameManager.hidePhaseCountsTowardRound` |
| Raio de 2 m | O contador continua ao trocar para móvel a ≤ 2 m do esconderijo original (mesmo andar). Zera após 10 s fora da zona. | `GhostController.zoneRadius`, `zoneMemoryDuration` |
| Após expulsão forçada | A zona fica bloqueada por 10 s (não dá para entrar de novo no mesmo esconderijo). | `zoneMemoryDuration` |
| Salto Espectral | Só de dentro de um móvel; alvo mirado (ou o mais à frente) a até 6 m; não atravessa Sal. Se o alvo estiver a ≤ 2 m, o contador **não** zera. | `spectralJumpRange`, `spectralJumpCooldown` |
| Assombração Ativa | De dentro do móvel ou num móvel mirado a até 3,5 m. O móvel "acende" o EMF por 6 s mesmo vazio (isca). | `hauntCooldown`, `PossessableProp.decoyEmfDuration` |
| Aspirador em móvel | 10 de dano/s; 1,5 s de feixe contínuo expulsa o fantasma (fica exposto 3 s). | `beamDamageOnProp`, `beamExpulsionTime` |
| Aspirador na forma etérea | 35 de dano/s (×1,5 enquanto exposto). Vida 100; regenera 5/s após 4 s sem dano. | `beamDamageEthereal`, `exposedDamageMultiplier`, `regen*` |
| EMF | Nível 1–5 pela distância até a superfície do móvel (alcance 6,5 m); distância vertical pesa 1,5×. | `HunterController.emf*` |
| Câmera Térmica/UV | Mostra pegadas espectrais (a cada 0,8 m, duram 12 s) só para o caçador que a ligou. | `T`, `footprintLifetime` |
| Portas | 15 portas (2 duplas) e 12 vãos abertos ou com verga. Caçador abre/fecha com **E**. Fantasma **atravessa** portas fechadas (não paredes) e pode **bater** uma porta com a Assombração Ativa (R) — barulho alto que confunde os caçadores. | `MansionDoor` |
| Sal Purificador | 3 cargas por caçador; linha de 1,6 m que bloqueia fantasmas por 20 s. Caçadores passam. | `saltCharges`, `saltDuration` |

## 6.0 Caçada Invertida (fim da busca)
Quando o cronômetro de 6 minutos zera com ao menos um fantasma livre, a caçada se inverte por 2 minutos:
* **Fantasmas** abandonam os móveis e caçam (5,6 m/s). **Toque Gélido** (botão esq.): 34 de dano, 1,8 m, recarga 1,1 s;
  bloqueado por paredes, portas fechadas e sal. Ainda podem bater portas (R).
* **Caçadores** ficam sem o aspirador e fogem: corrida limitada por estamina, sal ainda bloqueia, EMF acusa fantasmas próximos.
  100 de vida (3 golpes).
* **Vitória:** fantasmas, se todos os caçadores forem pegos; caçadores, se sobreviverem até o fim.

## 6.1 Móveis Possuíveis (58)
| Tipo | Qtd | Categoria | Assombração |
| :--- | :-: | :--- | :--- |
| Lustre / Candelabro | 7 | Iluminação | pisca e solta faíscas |
| Estante de Livros | 6 | Armazenamento | treme |
| Poltrona Vitoriana | 6 | Assento | treme |
| Vaso de Planta | 8 | Planta | folhas farfalham |
| Copo de Cristal | 12 | Louça | tilinta alto (sobre pias, mesa e aparador); tilinta também quando o apoio é assombrado |
| Mesa de Jantar | 1 | Decoração | sacode e faz os copos tilintarem |
| Aparador | 1 | Armazenamento | portas/gavetas batem, copos tilintam |
| Relógio de Pêndulo | 4 | Decoração | tic-tac constante |
| Pia | 4 | Hidráulica | água espectral |
| Cama | 4 | Dormitório | molas rangem |
| Vaso Sanitário | 3 | Sanitário | descarga barulhenta |
| Chuveiro | 2 | Hidráulica | vapor |

## 7. Controles
**Fantasma (3ª pessoa):** WASD mover · Mouse câmera · E possuir/sair · Space sair · Q Salto Espectral · R Assombração Ativa (também bate portas) · Botão esq. Toque Gélido (Caçada Invertida)
**Caçador (1ª pessoa):** WASD · Mouse · Shift correr (gasta estamina) · Botão esq. aspirador · Botão dir. mira · E porta · F lanterna · T térmica · G sal
