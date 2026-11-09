// Usado pelo GameMenu.cs na build WebGL: diz se o navegador está com o mouse preso (pointer lock).
// No navegador, o Esc solta o mouse sem que o jogo receba a tecla; o menu usa isto para pausar.
mergeInto(LibraryManager.library, {
  EcosPointerLockActive: function () {
    return document.pointerLockElement ? 1 : 0;
  }
});
