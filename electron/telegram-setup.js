const api = window.telegramSetup;
const root = document.querySelector("#root");
let state;
let step = 0;
let message = "";
let messageError = false;
let busy = false;

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === "className") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== false) element.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) element.append(child);
  return element;
}

function setMessage(value, error = false) {
  message = value;
  messageError = error;
  render();
}

async function run(action, waiting) {
  if (busy) return null;
  busy = true;
  message = waiting ?? "";
  messageError = false;
  render();
  try {
    const result = await action();
    if (!result.ok) {
      setMessage(state.strings[result.error] ?? state.strings.genericError, true);
      return null;
    }
    state = result.state ?? state;
    return result;
  } catch {
    setMessage(state.strings.genericError, true);
    return null;
  } finally {
    busy = false;
    render();
  }
}

function stepCreate(strings) {
  return node("section", { className: "card" }, [
    node("h2", { text: strings.stepCreate }),
    node("p", { text: strings.botFatherHelp }),
    node("div", { className: "actions" }, [
      node("button", { type: "button", text: strings.openBotFather, onclick: () => void api.openBotFather() }),
      node("button", { type: "button", text: strings.copyNewBot, onclick: async () => { await api.copy("/newbot"); setMessage(strings.copied); } }),
    ]),
    node("p", { className: "muted", text: strings.existingBot }),
  ]);
}

function stepToken(strings) {
  const input = node("input", {
    type: "password",
    autocomplete: "off",
    placeholder: strings.tokenPlaceholder,
    "aria-label": strings.tokenLabel,
  });
  const children = [
    node("h2", { text: strings.stepToken }),
    node("label", {}, [node("span", { text: strings.tokenLabel }), input]),
    node("div", { className: "actions" }, [
      node("button", {
        type: "button",
        text: busy ? strings.verifying : strings.verifyBot,
        disabled: busy,
        onclick: async () => {
          const token = input.value.trim();
          if (!token) return setMessage(strings.invalidToken, true);
          const result = await run(() => api.verify(token), strings.verifying);
          input.value = "";
          if (result) setMessage(`${strings.verifiedBot}: @${state.bot.username}`);
        },
      }),
    ]),
    node("p", { className: "muted", text: strings.tokenSecurity }),
  ];
  if (state.bot) children.splice(1, 0, node("p", { className: "bot", text: `${strings.verifiedBot}: ${state.bot.name} (@${state.bot.username})` }));
  return node("section", { className: "card" }, children);
}

function chatRow(chat, strings) {
  const kind = chat.type === "private" ? strings.privateChat : strings.groupChat;
  return node("div", { className: "chat" }, [
    node("div", { className: "chat-name", text: `${chat.title} · ${kind}` }),
    node("button", {
      type: "button",
      text: strings.test,
      disabled: busy,
      onclick: async () => {
        const result = await run(() => api.testChat(chat.id));
        if (result) setMessage(strings.testSent);
      },
    }),
    node("button", {
      type: "button",
      text: strings.remove,
      disabled: busy,
      onclick: async () => {
        const result = await run(() => api.removeChat(chat.id));
        if (result) setMessage("");
      },
    }),
  ]);
}

function stepChats(strings) {
  const list = state.chats.length
    ? state.chats.map((chat) => chatRow(chat, strings))
    : [node("p", { className: "muted", text: strings.noRecipients })];
  return node("section", { className: "card" }, [
    node("h2", { text: strings.stepChats }),
    node("p", { text: strings.connectHelp }),
    node("div", { className: "actions" }, [
      node("button", {
        type: "button",
        text: strings.connectPrivate,
        disabled: busy || !state.bot,
        onclick: async () => {
          const result = await run(() => api.pair("private"), strings.waitingPrivate);
          if (result) setMessage("");
        },
      }),
      node("button", {
        type: "button",
        text: strings.connectGroup,
        disabled: busy || !state.bot,
        onclick: async () => {
          const result = await run(() => api.pair("group"), strings.waitingGroup);
          if (result) setMessage("");
        },
      }),
    ]),
    node("h2", { text: strings.recipients }),
    node("div", {}, list),
  ]);
}

function stepEnable(strings) {
  const checkbox = node("input", {
    type: "checkbox",
    checked: state.autoTunnel,
    disabled: busy || !state.bot || state.chats.length === 0,
    onchange: async (event) => {
      const result = await run(() => api.setAutoTunnel(event.target.checked));
      if (!result) event.target.checked = state.autoTunnel;
      else setMessage("");
    },
  });
  checkbox.checked = state.autoTunnel;
  return node("section", { className: "card" }, [
    node("h2", { text: strings.stepEnable }),
    node("label", { className: "toggle" }, [checkbox, node("div", {}, [
      node("strong", { text: strings.autoLabel }),
      node("p", { className: "muted", text: strings.autoHelp }),
    ])]),
    node("p", { className: "notice", text: strings.quickTunnelNotice }),
  ]);
}

function changeStep(next) {
  const strings = state.strings;
  if (next >= 2 && !state.bot) return setMessage(strings.botRequired, true);
  if (next >= 3 && state.chats.length === 0) return setMessage(strings.recipientRequired, true);
  step = Math.max(0, Math.min(3, next));
  message = "";
  messageError = false;
  render();
}

function render() {
  if (!state) return;
  const strings = state.strings;
  document.documentElement.lang = state.locale;
  document.title = strings.windowTitle;
  root.replaceChildren(node("main", {}, [
    node("header", {}, [
      node("h1", { text: strings.title }),
      node("p", { className: "muted", text: strings.subtitle }),
      ...(state.bot ? [node("p", { className: "bot", text: `${strings.verifiedBot}: @${state.bot.username} · ${strings.recipients}: ${state.chats.length}` })] : []),
    ]),
    node("nav", { className: "steps", "aria-label": strings.title }, [strings.stepCreate, strings.stepToken, strings.stepChats, strings.stepEnable].map((label, index) =>
      node("button", { type: "button", text: label, "aria-current": index === step ? "step" : undefined, onclick: () => changeStep(index) })
    )),
    [stepCreate, stepToken, stepChats, stepEnable][step](strings),
    node("p", { className: `message${messageError ? " error" : ""}`, text: message, role: messageError ? "alert" : "status" }),
    node("footer", {}, [
      node("button", { type: "button", text: strings.close, onclick: () => void api.close() }),
      node("div", {}, [
        node("button", { type: "button", text: strings.back, disabled: step === 0, onclick: () => changeStep(step - 1) }),
        node("button", { type: "button", text: strings.next, disabled: step === 3, onclick: () => changeStep(step + 1) }),
      ]),
    ]),
  ]));
}

api.getState().then((result) => {
  if (!result.ok) throw new Error(result.error);
  state = result.state;
  step = state.chats.length ? 3 : state.bot ? 2 : 0;
  render();
}).catch(() => {
  root.textContent = "Telegram";
});
