using System.Collections.Generic;
using UnityEngine;

public enum PlayerTeam { Ghost, Hunter }

/// <summary>
/// Escolhas do menu. Os campos são estáticos para sobreviver ao recarregar a cena ("Jogar de novo");
/// tudo é gravado em PlayerPrefs para valer também na próxima vez que o jogo abrir.
/// </summary>
public static class MatchSettings
{
    // Limitado pelos pontos de spawn do map_data.json (2 caçadores, 4 fantasmas).
    public const int MaxGhosts = 4;
    public const int MaxHunters = 2;
    public static readonly int[] RoundMinuteOptions = { 3, 6, 9, 12 };

    // ---- Partida ----
    public static PlayerTeam Team = PlayerTeam.Hunter;
    public static int Ghosts = MaxGhosts;
    public static int Hunters = MaxHunters;
    public static int RoundMinutes = 6;
    public static bool Reversal = true;
    /// <summary>Ligado por "Jogar de novo": a cena recarrega e a partida começa sem passar pelo menu.</summary>
    public static bool StartImmediately;

    // ---- Opções ----
    /// <summary>Multiplicador sobre a sensibilidade configurada no Inspector.</summary>
    public static float Sensitivity = 1f;
    public static float MasterVolume = 0.8f;
    public static float AmbientVolume = 0.5f;

    static bool loaded;
    static readonly Dictionary<int, float> baseSensitivity = new Dictionary<int, float>();

    public static void Load()
    {
        if (loaded) return;
        loaded = true;
        Team = (PlayerTeam)Mathf.Clamp(PlayerPrefs.GetInt("ecos.team", (int)PlayerTeam.Hunter), 0, 1);
        Ghosts = Mathf.Clamp(PlayerPrefs.GetInt("ecos.ghosts", MaxGhosts), 1, MaxGhosts);
        Hunters = Mathf.Clamp(PlayerPrefs.GetInt("ecos.hunters", MaxHunters), 1, MaxHunters);
        RoundMinutes = PlayerPrefs.GetInt("ecos.roundMinutes", 6);
        if (System.Array.IndexOf(RoundMinuteOptions, RoundMinutes) < 0) RoundMinutes = 6;
        Reversal = PlayerPrefs.GetInt("ecos.reversal", 1) == 1;
        Sensitivity = Mathf.Clamp(PlayerPrefs.GetFloat("ecos.sensitivity", 1f), 0.25f, 3f);
        MasterVolume = Mathf.Clamp01(PlayerPrefs.GetFloat("ecos.masterVolume", 0.8f));
        AmbientVolume = Mathf.Clamp01(PlayerPrefs.GetFloat("ecos.ambientVolume", 0.5f));

        int quality = PlayerPrefs.GetInt("ecos.quality", -1);
        if (quality >= 0 && quality < QualitySettings.names.Length && quality != QualitySettings.GetQualityLevel())
            QualitySettings.SetQualityLevel(quality, true);
    }

    public static void Save()
    {
        PlayerPrefs.SetInt("ecos.team", (int)Team);
        PlayerPrefs.SetInt("ecos.ghosts", Ghosts);
        PlayerPrefs.SetInt("ecos.hunters", Hunters);
        PlayerPrefs.SetInt("ecos.roundMinutes", RoundMinutes);
        PlayerPrefs.SetInt("ecos.reversal", Reversal ? 1 : 0);
        PlayerPrefs.SetFloat("ecos.sensitivity", Sensitivity);
        PlayerPrefs.SetFloat("ecos.masterVolume", MasterVolume);
        PlayerPrefs.SetFloat("ecos.ambientVolume", AmbientVolume);
        PlayerPrefs.SetInt("ecos.quality", QualitySettings.GetQualityLevel());
        PlayerPrefs.Save();
    }

    /// <summary>Aplica volume e sensibilidade em tudo o que existe na cena agora.</summary>
    public static void Apply()
    {
        AudioListener.volume = MasterVolume;

        GhostGameManager m = GhostGameManager.Instance;
        if (m != null)
        {
            m.ambientVolume = AmbientVolume;
            if (m.ambientSource != null) m.ambientSource.volume = AmbientVolume;
        }

        foreach (var h in HunterController.All)
            if (h != null) h.lookSensitivity = Base(h, h.lookSensitivity) * Sensitivity;
        foreach (var c in Object.FindObjectsOfType<GhostCamera>())
            c.sensitivity = Base(c, c.sensitivity) * Sensitivity;
    }

    /// <summary>Guarda o valor do Inspector na primeira vez, para o multiplicador não se acumular.</summary>
    static float Base(Object o, float current)
    {
        int id = o.GetInstanceID();
        if (!baseSensitivity.TryGetValue(id, out float b))
        {
            b = current;
            baseSensitivity[id] = b;
        }
        return b;
    }
}
