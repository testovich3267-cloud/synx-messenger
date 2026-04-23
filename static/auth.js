console.log("AUTH.JS LOADED");

const API_URL = window.location.origin; // ← ВАЖНО

document.addEventListener("DOMContentLoaded", () => {
    const loginBtn = document.getElementById("loginBtn");
    const regBtn = document.getElementById("regBtn");

    if (loginBtn) loginBtn.onclick = login;
    if (regBtn) regBtn.onclick = registerUser;
});

async function login() {
    const username = document.getElementById("loginUsername").value;
    const password = document.getElementById("loginPassword").value;

    const body = new URLSearchParams();
    body.append("username", username);
    body.append("password", password);
    body.append("grant_type", "");

    const res = await fetch(API_URL + "/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body
    });

    const data = await res.json();

    if (data.access_token) {
        localStorage.setItem("token", data.access_token);
        window.location.href = "/static/index.html";
    } else {
        document.getElementById("authError").textContent = "Неверный логин или пароль";
    }
}

async function registerUser() {
    const username = document.getElementById("regUsername").value;
    const password = document.getElementById("regPassword").value;

    const res = await fetch(API_URL + "/register", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username, password})
    });

    const data = await res.json();

    if (data.access_token) {
        localStorage.setItem("token", data.access_token);
        window.location.href = "/static/index.html";
    } else {
        showError("Ошибка регистрации");
    }
}

function showError(msg) {
    const box = document.getElementById("authError");
    if (box) box.textContent = msg;
}
