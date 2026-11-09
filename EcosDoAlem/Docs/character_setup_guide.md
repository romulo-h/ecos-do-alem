# Guia de Configuração: Personagens & Câmeras (v1.1)

> ⚠️ O arquivo `cacador_e_fantasma.glb` original era só um atalho do Google Drive (346 bytes), não um modelo.
> Baixe o .glb verdadeiro e importe com um importador glTF (ex.: pacote **glTFast**, `com.unity.cloud.gltfast`).
> Sem o modelo, tudo funciona com uma cápsula no lugar. (Os móveis já têm modelos: `Assets/Resources/Moveis`.)

---

## 1. Caçador — Primeira Pessoa (prefab `Hunter_FPS`)
```
Hunter_Player (CharacterController, HunterController, AudioSource "EMF" 2D)
│
├── FirstPersonCamera (Camera, AudioListener, Y = 1.65m)
│   ├── Flashlight (Spot Light — tecla F)
│   ├── Gadget_EMF (Sensor com agulha / display)
│   └── Weapon_ProtonBeam (LineRenderer, 2 posições, largura ~0.05)
│
└── Hunter_Body_Mesh (malha do caçador do .glb — fica 'Shadows Only' automaticamente)
```
* No `HunterController`: arraste a câmera, a lanterna, o LineRenderer, a AudioSource do EMF e o clip `emf_detector_beep.wav`.
* `isLocallyControlled` ligado só no caçador do jogador local.
* `saltBarrierPrefab` e `thermalOverlay` são opcionais (há visual padrão).

## 2. Fantasma — Terceira Pessoa (prefab `Ghost`)
```
Ghost_Player (CharacterController altura 1.6 / raio 0.35, GhostController, AudioSource "Alertas" 2D)
└── Ghost_Mesh (malha do fantasma do .glb ou cápsula) → campo ghostVisualModel

Ghost_Camera (Camera, AudioListener, GhostCamera → campo ghost = Ghost_Player)
```
* No `GhostController`: `localAudio`, `instabilityAlertClip` = `fantasma_instabilidade_alerta.wav`,
  `forcedEjectClip` = `fantasma_ejecao_forcada.wav`; materiais normal/exposto opcionais.
* A câmera do fantasma é um objeto separado (não filho), para não tremer junto com o móvel.
* Use **apenas uma** câmera com AudioListener ativa por jogador local.

## 2.1 Animações
* Sem modelo, `HunterController`/`GhostController` criam sozinhos a figura (`ProceduralCharacterRig`) e o `CharacterAnimator`.
* Com o modelo real: arraste-o para `hunterBodyModel`/`ghostVisualModel`. Se ele tiver um `Animator`, o `CharacterAnimator`
  envia os parâmetros `Speed`, `Sprint`, `Aiming`, `Dead`, `Possessing`, `Fury`, `Attack`, `Hit`, `Emerge`.
* Sons da Caçada Invertida: `GhostController.attackClip` = `ataque_fantasma.wav`, `HunterController.hurtClip` =
  `cacador_ferido.wav`, `GhostGameManager.reversalSting` = `inversao_cacada.wav`.

## 3. Cena de teste rápida (sem modelos)
1. GameObject vazio `Mansao` + `MansionLayoutLoader`: arraste `map_data.json`, `props_layout.json`,
   `interacao_movel_assombrado.wav` (haunt), `relogio_pendulo_tic_tac.wav` (relógio),
   `porta_rangendo.wav` e `porta_batendo.wav` (portas), `copo_tilintando.wav` (copos) e `planta_farfalhar.wav` (plantas).
2. GameObject `Partida` + `GhostGameManager` (clip ambiente `mansao_drone_ambiente.wav`) + `GameHUD` + `GameMenu`
   (o `GameMenu` adiciona o `MatchSetup`, que já preenche os sons dos jogadores a partir de `Assets/Audio`).
3. **Com o `GameMenu`, pule este passo:** escolha time e jogadores no menu, e eles são criados sozinhos.
   Sem o menu: um caçador **ou** um fantasma com `isLocallyControlled = true` (o outro time pode ficar com `false`).
4. Play. O loader gera pisos, escadas, todas as paredes (internas, externas, guarda-corpos), as portas,
   os 58 móveis, e posiciona os jogadores nos spawns (caçadores na varanda).
   Dica: com o objeto selecionado, a cena mostra o contorno dos cômodos; clique com o botão direito no
   componente > "Gerar Mansão" para gerar no modo de edição.
