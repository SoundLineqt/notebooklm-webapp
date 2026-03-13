/**
 * NotebookLM WebApp
 * API: POST /generate, GET /status/{id}, GET /result/{id}, POST /upload (PDF)
 */

// ─── SET YOUR VPS ADDRESS HERE ────────────────────────────────────────────────
// Replace with your actual Russian VPS IP or domain, e.g. "http://1.2.3.4:8100"
// Leave empty ("") to require manual entry via the settings panel.
const DEFAULT_API_URL = "http://155.212.137.21:8100";
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_API_KEY  = "nlm_adapter_url";
const POLL_INTERVAL_MS = 8000;
const POLL_MAX_MS      = 18 * 60 * 1000;

// ─── Telegram Mini App SDK init ───────────────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();  // full-screen inside Telegram
}

const ARTIFACT_LABELS = {
    audio:      "Подкаст (MP3)",
    video:      "Видео (MP4)",
    mind_map:   "Mind Map (PNG)",
    slide_deck: "Презентация (PDF)",
    quiz:       "Квиз (JSON)",
    infographic:"Инфографика (PNG)",
    report:     "Отчёт (Markdown)",
    flashcards: "Флеш-карты (Markdown)",
};

const EXT_MAP = {
    audio: "mp3", video: "mp4", mind_map: "png",
    slide_deck: "pdf", quiz: "json", infographic: "png",
    report: "md", flashcards: "md",
};

let state = { sourceType: "text", language: "ru", format: "report" };
let elapsedInterval = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getApiBase() {
    const stored = localStorage.getItem(STORAGE_API_KEY);
    const field  = document.getElementById("apiUrl").value.trim();
    // Priority: manually saved > default hardcoded > field input
    const url = stored || DEFAULT_API_URL || field;
    return url ? url.replace(/\/$/, "") : null;
}

function setApiBase(url) {
    const u = url.trim().replace(/\/$/, "");
    localStorage.setItem(STORAGE_API_KEY, u);
    document.getElementById("apiUrl").value = u;
}

function setStatus(msg, type = "") {
    const el      = document.getElementById("statusMessage");
    el.textContent = msg;
    el.className  = "status-message" + (type ? " " + type : "");
}

function setGenerating(on) {
    const btn     = document.getElementById("submitBtn");
    const label   = document.getElementById("btnLabel");
    const spinner = document.getElementById("btnSpinner");
    const bar     = document.getElementById("progressBar");

    btn.disabled = on;
    btn.classList.toggle("running", on);
    label.textContent = on ? "Генерируется…" : "⚡ Генерировать";
    spinner.classList.toggle("hidden", !on);
    bar.classList.toggle("hidden", !on);
}

function startElapsedTimer() {
    let seconds = 0;
    elapsedInterval = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        const t = m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
        setStatus(`Генерируется… ${t}`, "info");
    }, 1000);
}

function stopElapsedTimer() {
    if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
}

function showResult(hasFile, downloadUrl, textContent, artifactType) {
    const section = document.getElementById("resultSection");
    const content = document.getElementById("resultContent");
    const link    = document.getElementById("downloadLink");
    const label   = document.getElementById("resultArtifactLabel");

    label.textContent = ARTIFACT_LABELS[artifactType] || "Готово";
    section.classList.remove("hidden");

    if (textContent) {
        content.textContent = textContent;
    } else if (hasFile) {
        content.textContent = "Файл готов. Нажмите кнопку ниже чтобы скачать.";
    } else {
        content.textContent = "";
    }

    if (hasFile && downloadUrl) {
        link.href = downloadUrl;
        link.download = `result.${EXT_MAP[artifactType] || "bin"}`;
        link.classList.remove("hidden");
    } else {
        link.classList.add("hidden");
    }

    section.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Settings toggle ──────────────────────────────────────────────────────────
document.getElementById("settingsToggle").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.classList.toggle("open");
});

if (localStorage.getItem(STORAGE_API_KEY)) {
    document.getElementById("apiUrl").value = localStorage.getItem(STORAGE_API_KEY);
    // Already saved — keep settings panel closed
} else if (DEFAULT_API_URL) {
    document.getElementById("apiUrl").value = DEFAULT_API_URL;
    // Default hardcoded — keep settings panel closed
} else {
    // No URL at all — open settings so user can enter it
    document.getElementById("settingsPanel").classList.add("open");
}

document.getElementById("saveApiUrl").addEventListener("click", () => {
    const url = document.getElementById("apiUrl").value.trim();
    if (!url) { setStatus("Введите URL бэкенда", "error"); return; }
    setApiBase(url);
    setStatus("URL сохранён ✓", "success");
    document.getElementById("settingsPanel").classList.remove("open");
});

// ─── Source tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.sourceType = btn.dataset.source;
        document.getElementById("sourceText").classList.toggle("hidden", state.sourceType !== "text");
        document.getElementById("sourceUrl").classList.toggle("hidden",  state.sourceType !== "url");
        document.getElementById("sourceFile").classList.toggle("hidden", state.sourceType !== "file");
    });
});

// ─── Language ─────────────────────────────────────────────────────────────────
document.querySelectorAll(".choice-btn[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".choice-btn[data-lang]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.language = btn.dataset.lang;
    });
});

// ─── Format ───────────────────────────────────────────────────────────────────
document.querySelectorAll(".format-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".format-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.format = btn.dataset.format;
    });
});

// ─── File input / drop zone ───────────────────────────────────────────────────
const dropZone  = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");

fileInput.addEventListener("change", (e) => {
    const name = e.target.files.length ? e.target.files[0].name : "";
    document.getElementById("fileName").textContent = name;
});

["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
});
["dragleave", "drop"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("drag-over"); });
});
dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length) {
        fileInput.files = files;
        document.getElementById("fileName").textContent = files[0].name;
    }
});

// ─── Source value ─────────────────────────────────────────────────────────────
async function getSourceValue() {
    if (state.sourceType === "text") {
        const v = document.getElementById("textInput").value.trim();
        if (!v) throw new Error("Введите текст или тему");
        return v;
    }
    if (state.sourceType === "url") {
        const v = document.getElementById("urlInput").value.trim();
        if (!v) throw new Error("Введите ссылку");
        return v;
    }
    if (state.sourceType === "file") {
        const input = fileInput;
        if (!input.files || !input.files[0]) throw new Error("Выберите PDF-файл");
        const base = getApiBase();
        if (!base) throw new Error("Укажите URL бэкенда");

        setStatus("Загружаю PDF…", "info");
        const form = new FormData();
        form.append("file", input.files[0]);
        const res = await fetch(`${base}/upload`, { method: "POST", body: form });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(t || `Ошибка загрузки (${res.status})`);
        }
        const data = await res.json();
        return data.path;
    }
    throw new Error("Выберите источник");
}

// ─── Submit ───────────────────────────────────────────────────────────────────
document.getElementById("submitBtn").addEventListener("click", async () => {
    const base = getApiBase();
    if (!base) {
        setStatus("Укажите URL бэкенда (кнопка ⚙ вверху)", "error");
        document.getElementById("settingsPanel").classList.add("open");
        return;
    }

    setGenerating(true);
    document.getElementById("resultSection").classList.add("hidden");
    setStatus("Подготовка…", "info");

    try {
        const sourceValue = await getSourceValue();
        setStatus("Задача отправлена…", "info");

        const res = await fetch(`${base}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                artifact_type: state.format,
                source_type:   state.sourceType,
                source_value:  sourceValue,
                language:      state.language,
                instructions:  "",
            }),
        });

        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(t || `Ошибка отправки (${res.status})`);
        }

        const { job_id } = await res.json();
        startElapsedTimer();

        // Polling
        const start = Date.now();
        while (Date.now() - start < POLL_MAX_MS) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

            const statusRes = await fetch(`${base}/status/${job_id}`);
            if (!statusRes.ok) throw new Error("Ошибка проверки статуса");
            const statusData = await statusRes.json();

            if (statusData.status === "pending" || statusData.status === "processing") continue;

            if (statusData.status === "error") {
                throw new Error(statusData.error || "Ошибка генерации");
            }

            if (statusData.status === "done") {
                stopElapsedTimer();
                setGenerating(false);
                setStatus("Готово ✓", "success");
                const dlUrl = statusData.has_file ? `${base}/result/${job_id}` : null;
                showResult(!!statusData.has_file, dlUrl, statusData.text_content || null, statusData.artifact_type);
                return;
            }
        }
        throw new Error("Таймаут — попробуйте ещё раз");

    } catch (e) {
        stopElapsedTimer();
        setGenerating(false);
        setStatus(e.message || "Неизвестная ошибка", "error");
    }
});
