using UnityEngine;

/// <summary>
/// Estilos e desenhos compartilhados pela interface (OnGUI, sem Canvas nem pacotes).
/// Todas as medidas são dadas numa tela virtual de 1080 px de altura; a largura acompanha a proporção
/// da janela. Os helpers convertem para pixels reais e as fontes são refeitas no tamanho certo
/// (em vez de escalar com GUI.matrix, que deixaria o texto borrado).
/// </summary>
public static class UITheme
{
    public const float ReferenceHeight = 1080f;

    public static readonly Color Ink = new Color(0.035f, 0.03f, 0.045f, 1f);
    public static readonly Color Gold = new Color(0.87f, 0.73f, 0.46f, 1f);
    public static readonly Color GoldDim = new Color(0.52f, 0.43f, 0.29f, 1f);
    public static readonly Color Spectral = new Color(0.56f, 0.94f, 1f, 1f);
    public static readonly Color Blood = new Color(0.78f, 0.16f, 0.14f, 1f);
    public static readonly Color TextColor = new Color(0.93f, 0.9f, 0.85f, 1f);
    public static readonly Color Muted = new Color(0.62f, 0.59f, 0.55f, 1f);

    public static float Scale => Mathf.Max(0.1f, Screen.height / ReferenceHeight);
    /// <summary>Largura da tela virtual.</summary>
    public static float Width => Screen.width / Scale;
    public static float Height => ReferenceHeight;

    public static GUIStyle Title, Subtitle, Heading, Body, BodyCenter, Small, SmallCenter;
    public static GUIStyle Button, ButtonPrimary, Card, CardSelected, Panel, Thumb, KeyCap;

    static Texture2D panelTex, buttonTex, buttonHoverTex, buttonDownTex, primaryTex, primaryHoverTex;
    static Texture2D cardSelectedTex, thumbTex, keyTex, vignetteTex, sideShadeTex;
    static float builtScale = -1f;

    /// <summary>Chamar no início de cada OnGUI que usa o tema.</summary>
    public static void Begin()
    {
        bool rebuiltTextures = EnsureTextures();
        if (rebuiltTextures || Title == null || Mathf.Abs(builtScale - Scale) > 0.001f) BuildStyles();
    }

    // ------------------------------------------------------------------ Desenho

    public static Rect R(Rect v) => new Rect(v.x * Scale, v.y * Scale, v.width * Scale, v.height * Scale);

    public static void Fill(Rect v, Color c)
    {
        Color old = GUI.color;
        GUI.color = c;
        GUI.DrawTexture(R(v), Texture2D.whiteTexture);
        GUI.color = old;
    }

    public static void Text(Rect v, string s, GUIStyle st, Color c, bool shadow = false)
    {
        Color old = st.normal.textColor;
        if (shadow)
        {
            st.normal.textColor = new Color(0f, 0f, 0f, c.a * 0.8f);
            GUI.Label(R(new Rect(v.x + 3, v.y + 3, v.width, v.height)), s, st);
        }
        st.normal.textColor = c;
        GUI.Label(R(v), s, st);
        st.normal.textColor = old;
    }

    public static bool Btn(Rect v, string s, bool primary = false) => GUI.Button(R(v), s, primary ? ButtonPrimary : Button);

    public static void Box(Rect v) => GUI.Box(R(v), GUIContent.none, Panel);

    public static void Line(float x, float y, float w, Color c) => Fill(new Rect(x, y, w, 2f), c);

    /// <summary>Escurece as bordas da tela.</summary>
    public static void Vignette(float alpha)
    {
        Color old = GUI.color;
        GUI.color = new Color(1f, 1f, 1f, alpha);
        GUI.DrawTexture(new Rect(0, 0, Screen.width, Screen.height), vignetteTex, ScaleMode.StretchToFill);
        GUI.color = old;
    }

    /// <summary>Sombra horizontal da esquerda para a direita (deixa o texto do menu legível).</summary>
    public static void SideShade(float width, float alpha)
    {
        Color old = GUI.color;
        GUI.color = new Color(1f, 1f, 1f, alpha);
        GUI.DrawTexture(R(new Rect(0, 0, width, Height)), sideShadeTex, ScaleMode.StretchToFill);
        GUI.color = old;
    }

    /// <summary>Linha "Rótulo   ‹ valor ›". Devolve o novo índice (dá a volta nas pontas).</summary>
    public static int Selector(Rect v, string label, string[] options, int index)
    {
        if (options == null || options.Length == 0) return index;
        index = Mathf.Clamp(index, 0, options.Length - 1);
        float labelW = v.width * 0.48f;
        Text(new Rect(v.x, v.y, labelW, v.height), label, Body, TextColor);

        float x = v.x + labelW, w = v.width - labelW, bw = 56f;
        if (Btn(new Rect(x, v.y + 4, bw, v.height - 8), "‹")) index = (index - 1 + options.Length) % options.Length;
        Text(new Rect(x + bw, v.y, w - bw * 2, v.height), options[index], BodyCenter, Gold);
        if (Btn(new Rect(x + w - bw, v.y + 4, bw, v.height - 8), "›")) index = (index + 1) % options.Length;
        return index;
    }

    /// <summary>Linha "Rótulo   ━━━●───  valor".</summary>
    public static float Slider(Rect v, string label, float value, float min, float max, string valueText)
    {
        float labelW = v.width * 0.48f, valueW = 96f;
        Text(new Rect(v.x, v.y, labelW, v.height), label, Body, TextColor);

        Rect track = new Rect(v.x + labelW + 8, v.y + 8, v.width - labelW - valueW - 16, v.height - 16);
        float t = Mathf.InverseLerp(min, max, value);
        float mid = track.y + track.height * 0.5f;
        Fill(new Rect(track.x, mid - 2, track.width, 4), new Color(1f, 1f, 1f, 0.15f));
        Fill(new Rect(track.x, mid - 2, track.width * t, 4), Gold);
        value = GUI.HorizontalSlider(R(track), value, min, max, GUIStyle.none, Thumb);

        Text(new Rect(v.x + v.width - valueW, v.y, valueW, v.height), valueText, BodyCenter, Gold);
        return value;
    }

    /// <summary>Tecla desenhada como uma plaquinha + descrição.</summary>
    public static void KeyRow(float x, float y, float width, string key, string description)
    {
        const float keyW = 150f, h = 42f;
        GUI.Box(R(new Rect(x, y, keyW, h)), key, KeyCap);
        Text(new Rect(x + keyW + 18, y, width - keyW - 18, h), description, Body, TextColor);
    }

    // ------------------------------------------------------------------ Estilos

    static void BuildStyles()
    {
        builtScale = Scale;

        Title = Label(104, FontStyle.Bold, TextAnchor.MiddleLeft);
        Subtitle = Label(28, FontStyle.Italic, TextAnchor.MiddleLeft);
        Heading = Label(44, FontStyle.Bold, TextAnchor.MiddleCenter);
        Body = Label(24, FontStyle.Normal, TextAnchor.MiddleLeft);
        Body.wordWrap = true;
        BodyCenter = Label(24, FontStyle.Normal, TextAnchor.MiddleCenter);
        BodyCenter.wordWrap = true;
        Small = Label(19, FontStyle.Normal, TextAnchor.MiddleLeft);
        Small.wordWrap = true;
        SmallCenter = Label(19, FontStyle.Normal, TextAnchor.MiddleCenter);
        SmallCenter.wordWrap = true;

        Button = Framed(buttonTex, buttonHoverTex, buttonDownTex, 26, TextColor, Gold);
        ButtonPrimary = Framed(primaryTex, primaryHoverTex, buttonDownTex, 26, Color.white, Color.white);
        Card = Framed(buttonTex, buttonHoverTex, buttonHoverTex, 1, TextColor, TextColor);
        CardSelected = Framed(cardSelectedTex, cardSelectedTex, cardSelectedTex, 1, TextColor, TextColor);
        Panel = Framed(panelTex, panelTex, panelTex, 1, TextColor, TextColor);

        Thumb = new GUIStyle();
        Thumb.normal.background = thumbTex;
        Thumb.hover.background = thumbTex;
        Thumb.active.background = thumbTex;
        Thumb.fixedWidth = Mathf.Round(16f * Scale);

        KeyCap = Framed(keyTex, keyTex, keyTex, 20, Gold, Gold);
    }

    static GUIStyle Label(int size, FontStyle fs, TextAnchor align)
    {
        var s = new GUIStyle(GUI.skin.label) { fontSize = Mathf.Max(8, Mathf.RoundToInt(size * Scale)), fontStyle = fs, alignment = align, richText = false };
        s.normal.textColor = TextColor;
        s.padding = new RectOffset(0, 0, 0, 0);
        s.margin = new RectOffset(0, 0, 0, 0);
        return s;
    }

    static GUIStyle Framed(Texture2D normal, Texture2D hover, Texture2D down, int size, Color text, Color hoverText)
    {
        var s = new GUIStyle(GUI.skin.button)
        {
            fontSize = Mathf.Max(8, Mathf.RoundToInt(size * Scale)),
            fontStyle = FontStyle.Bold,
            alignment = TextAnchor.MiddleCenter,
            border = new RectOffset(4, 4, 4, 4),
            padding = new RectOffset(8, 8, 4, 4),
            margin = new RectOffset(0, 0, 0, 0),
            richText = false,
        };
        s.normal.background = normal; s.normal.textColor = text;
        s.hover.background = hover; s.hover.textColor = hoverText;
        s.active.background = down; s.active.textColor = hoverText;
        s.focused.background = normal; s.focused.textColor = text;
        s.onNormal.background = normal; s.onHover.background = hover;
        s.onActive.background = down; s.onFocused.background = normal;
        return s;
    }

    /// <summary>Cria as texturas se ainda não existem. Devolve true se criou (os estilos precisam ser refeitos).</summary>
    static bool EnsureTextures()
    {
        if (panelTex != null) return false;
        panelTex = Frame(new Color(0.055f, 0.045f, 0.065f, 0.95f), new Color(0.52f, 0.43f, 0.29f, 0.9f));
        buttonTex = Frame(new Color(0.09f, 0.075f, 0.1f, 0.92f), new Color(0.42f, 0.35f, 0.24f, 1f));
        buttonHoverTex = Frame(new Color(0.16f, 0.12f, 0.14f, 0.96f), Gold);
        buttonDownTex = Frame(new Color(0.05f, 0.04f, 0.05f, 1f), Gold);
        primaryTex = Frame(new Color(0.36f, 0.07f, 0.08f, 0.96f), Gold);
        primaryHoverTex = Frame(new Color(0.5f, 0.1f, 0.1f, 1f), new Color(1f, 0.88f, 0.6f, 1f));
        cardSelectedTex = Frame(new Color(0.18f, 0.13f, 0.12f, 0.97f), Gold, 3);
        keyTex = Frame(new Color(0.12f, 0.1f, 0.12f, 1f), new Color(0.42f, 0.35f, 0.24f, 1f));
        thumbTex = Frame(Gold, new Color(1f, 0.9f, 0.65f, 1f));
        vignetteTex = VignetteTexture();
        sideShadeTex = SideShadeTexture();
        return true;
    }

    static Texture2D NewTex(int w, int h)
    {
        return new Texture2D(w, h, TextureFormat.RGBA32, false)
        {
            hideFlags = HideFlags.HideAndDontSave,
            wrapMode = TextureWrapMode.Clamp,
            filterMode = FilterMode.Bilinear,
        };
    }

    static Texture2D Frame(Color fill, Color border, int b = 2)
    {
        const int n = 12;
        var t = NewTex(n, n);
        t.filterMode = FilterMode.Point;
        var px = new Color[n * n];
        for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
                px[y * n + x] = (x < b || y < b || x >= n - b || y >= n - b) ? border : fill;
        t.SetPixels(px);
        t.Apply();
        return t;
    }

    static Texture2D VignetteTexture()
    {
        const int n = 128;
        var t = NewTex(n, n);
        var px = new Color[n * n];
        for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float dx = (x + 0.5f) / n - 0.5f, dy = (y + 0.5f) / n - 0.5f;
                float d = Mathf.Sqrt(dx * dx + dy * dy) / 0.7071f;
                float a = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.35f, 1f, d));
                px[y * n + x] = new Color(0f, 0f, 0f, a);
            }
        t.SetPixels(px);
        t.Apply();
        return t;
    }

    static Texture2D SideShadeTexture()
    {
        const int n = 128;
        var t = NewTex(n, 1);
        var px = new Color[n];
        for (int x = 0; x < n; x++)
        {
            float k = 1f - x / (float)(n - 1);
            px[x] = new Color(0.02f, 0.015f, 0.03f, k * k * (3f - 2f * k));
        }
        t.SetPixels(px);
        t.Apply();
        return t;
    }
}
