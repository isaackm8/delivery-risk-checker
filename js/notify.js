// Delay notices: a message per selected order, handed to the merchant's own email
// app as a draft (nothing is sent automatically), copied, or exported as CSV.
// Loaded after app.js and uses its helpers (el, fmtDate, state, render).

const UPS_TRACKING_URL = "https://www.ups.com/track?loc=en_US&tracknum=";

const DEFAULT_SUBJECT = "An update on your order {order_id}";
const DEFAULT_BODY = [
  "Hi {first_name},",
  "",
  "We promised your order {order_id} ({product}) by {promised_date}. {delay_update}",
  "",
  "{carrier_section}",
  "",
  "We're sorry for the inconvenience.",
  "",
  "{signature}",
].join("\n");
const DEFAULT_SIGNATURE = "The customer care team";

const PLACEHOLDERS = [
  "{first_name}", "{order_id}", "{product}", "{promised_date}", "{delay_update}",
  "{new_date}", "{reason}", "{carrier_section}", "{signature}",
];

// --- Browser storage (this browser only; every access may fail, e.g. in private windows) ---

const STORAGE_KEYS = { notified: "drc-notified", template: "drc-notify-template" };

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not saved; the page still works, it just won't remember.
  }
}

// Order ID -> YYYY-MM-DD the merchant opened a notice for it.
function notifiedOn(orderId) {
  return readStored(STORAGE_KEYS.notified, {})[orderId] || null;
}

function markNotified(orderIds) {
  const all = readStored(STORAGE_KEYS.notified, {});
  for (const id of orderIds) all[id] = isoDate(TODAY);
  writeStored(STORAGE_KEYS.notified, all);
}

function savedTemplate() {
  const t = readStored(STORAGE_KEYS.template, {});
  return {
    subject: t.subject || DEFAULT_SUBJECT,
    body: t.body || DEFAULT_BODY,
    signature: t.signature || DEFAULT_SIGNATURE,
  };
}

// --- Building one message ---

const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const longWeekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

// The date to tell the customer: one delivery day after the expected window when
// weather is likely, otherwise the end of the expected window.
function noticeDate(o) {
  return o.weather.delayedTo || o.expectedLatest;
}

function reasonText(o) {
  const r = o.weather.reasons[0];
  if (r) {
    const where = r.place === "Origin" ? "near our warehouse" : "near the delivery address";
    const when = longWeekday.format(r.day);
    return /snow/.test(r.text)
      ? `About ${r.text.replace(" snow", "")} of snow is forecast ${where} on ${when}`
      : `${/^[AEIOU]/i.test(r.text) ? "An" : "A"} ${r.text} is in effect ${where} on ${when}`;
  }
  if (o.timingRisk !== "on-track") return "Your order is running behind schedule";
  return "We want to let you know about a possible delay";
}

// One or two sentences that fit the order's situation. The merchant can select any
// order that isn't delivered, so not every notice is about a missed promise.
function delayUpdate(o) {
  const date = longDate.format(noticeDate(o));
  if (isFlagged(o)) return `${reasonText(o)}, so it may now arrive by ${date}.`;
  if (o.weather.reasons.length) {
    return (
      `${reasonText(o)}, so it could arrive a day later than planned, by ${date}. ` +
      "That's still within the date we promised."
    );
  }
  return `It's still on schedule to arrive by ${date}, and we'll let you know if that changes.`;
}

function carrierSection(o) {
  if (!o.shipped) {
    return (
      "We'll email your tracking number as soon as it ships. From the UPS tracking page you'll then " +
      "be able to have it delivered to another address or held at a UPS Access Point near you."
    );
  }
  if (o.trackingNumber) {
    return (
      "You can follow your package, have it delivered to another address, or hold it at a " +
      `UPS Access Point near you here:\n${UPS_TRACKING_URL}${encodeURIComponent(o.trackingNumber)}\n` +
      "(Changes are made through UPS My Choice; UPS may charge for some options.)"
    );
  }
  return (
    "You can follow your package, have it delivered to another address, or hold it at a " +
    "UPS Access Point from the UPS tracking page, using the tracking number in your shipping email."
  );
}

function fillTemplate(text, o, signature) {
  const values = {
    "{first_name}": (o.customerName.trim().split(/\s+/)[0] || "there"),
    "{order_id}": o.id,
    "{product}": o.productName,
    "{promised_date}": longDate.format(o.promised),
    "{delay_update}": delayUpdate(o),
    "{new_date}": longDate.format(noticeDate(o)),
    "{reason}": reasonText(o),
    "{carrier_section}": carrierSection(o),
    "{signature}": signature,
  };
  return text.replace(/\{[a-z_]+\}/g, (key) => (key in values ? values[key] : key));
}

function buildNotice(o, template) {
  return {
    order: o,
    subject: fillTemplate(template.subject, o, template.signature),
    body: fillTemplate(template.body, o, template.signature),
  };
}

function mailtoLink({ order, subject, body }) {
  return `mailto:${order.customerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// --- Copy and export ---

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or pages where the clipboard API isn't allowed.
    const area = el("textarea", { class: "visually-hidden" });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadNoticesCSV(notices) {
  const header = ["order_id", "customer_name", "customer_email", "tracking_number", "subject", "message"];
  const lines = [header.join(",")].concat(
    notices.map(({ order: o, subject, body }) =>
      [o.id, o.customerName, o.customerEmail, o.trackingNumber, subject, body].map(csvField).join(",")
    )
  );
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }); // BOM so Excel reads UTF-8
  const link = el("a", { href: URL.createObjectURL(blob), download: `delay-notices-${isoDate(TODAY)}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// --- The panel ---

function openNotifyDialog() {
  const orders = state.orders.filter((o) => state.selected.has(o.id));
  if (!orders.length) return;
  const dialog = document.getElementById("notify-dialog");
  const template = savedTemplate();
  const templateBefore = readStored(STORAGE_KEYS.template, null); // restored by Cancel

  const subjectInput = el("input", { type: "text", id: "notify-subject" });
  subjectInput.value = template.subject;
  const bodyInput = el("textarea", { id: "notify-body", rows: "11" });
  bodyInput.value = template.body;
  const signatureInput = el("input", { type: "text", id: "notify-signature" });
  signatureInput.value = template.signature;

  const preview = el("pre", { class: "notice-preview" });
  const previewHeading = el("h3", { text: "Preview" });
  const list = el("ul", { class: "recipient-list" });
  const status = el("p", { class: "dialog-status", role: "status" });

  // Whose email the preview shows; clicking a recipient's name changes it.
  let previewId = (orders.find((o) => o.customerEmail) || orders[0]).id;
  const draftsOpened = new Set(); // this visit only; opening a draft isn't sending it

  const current = () => ({ subject: subjectInput.value, body: bodyInput.value, signature: signatureInput.value });
  const notices = () => orders.map((o) => buildNotice(o, current()));

  function refresh() {
    writeStored(STORAGE_KEYS.template, current());
    const all = notices();
    const shown = all.find((n) => n.order.id === previewId);
    previewHeading.textContent = `Preview: ${shown.order.customerName || shown.order.id}`;
    preview.textContent = `To: ${shown.order.customerEmail || "(no usable email)"}\nSubject: ${shown.subject}\n\n${shown.body}`;
    list.replaceChildren(...all.map(recipientItem));
  }

  function recipientItem(notice) {
    const o = notice.order;
    const who = el("button", { type: "button", class: "recipient-button", title: "Show this customer's email in the preview" }, [
      el("strong", { text: o.customerName || "(no name)" }),
      el("span", { class: "sub", text: `${o.id} · ${o.shipped ? (o.trackingNumber ? "tracking link" : "no tracking number") : "not shipped yet"}` }),
    ]);
    who.addEventListener("click", () => {
      previewId = o.id;
      refresh();
    });
    const rowClass = o.id === previewId ? "previewing" : "";
    if (!o.customerEmail) {
      return el("li", { class: rowClass }, [who, el("span", { class: "sub missing", text: "No usable email in the file; skipped" })]);
    }
    const when = notifiedOn(o.id);
    const link = el("a", { href: mailtoLink(notice), class: "button-secondary", text: "Open email draft" });
    link.addEventListener("click", () => {
      draftsOpened.add(o.id);
      setTimeout(refresh, 0);
    });
    const progress = when
      ? el("span", { class: "sub notified", text: `Notified ${shortFormat.format(parseDate(when))}` })
      : draftsOpened.has(o.id)
        ? el("span", { class: "sub", text: "Draft opened" })
        : null;
    return el("li", { class: rowClass }, [who, el("span", { class: "recipient-actions" }, [progress, link])]);
  }

  const reachable = orders.filter((o) => o.customerEmail);
  const copyButton = el("button", { type: "button", class: "button-secondary", text: "Copy all messages" });
  copyButton.addEventListener("click", async () => {
    const text = notices()
      .filter((n) => n.order.customerEmail)
      .map((n) => `To: ${n.order.customerEmail}\nSubject: ${n.subject}\n\n${n.body}`)
      .join("\n\n----------\n\n");
    status.textContent = (await copyText(text))
      ? `Copied ${reachable.length} messages.`
      : "Couldn't copy. Try Download CSV instead.";
  });
  const csvButton = el("button", { type: "button", class: "button-secondary", text: "Download CSV" });
  csvButton.addEventListener("click", () => {
    downloadNoticesCSV(notices().filter((n) => n.order.customerEmail));
    status.textContent = `Downloaded ${reachable.length} messages for an email or text-message tool.`;
  });
  // This prototype doesn't email anyone: "sending" marks each customer as notified.
  const emails = (n) => `${n} ${n === 1 ? "email" : "emails"}`;
  const sendButton = el("button", { type: "button", class: "button-primary", text: `Send all emails (${reachable.length})` });
  sendButton.disabled = !reachable.length;
  sendButton.addEventListener("click", () => {
    markNotified(reachable.map((o) => o.id));
    status.textContent =
      `Sent ${emails(reachable.length)}: ${reachable.length === 1 ? "the order is" : "those orders are"} now marked Notified. ` +
      "(Simulated: this prototype doesn't actually email anyone.)";
    refresh();
    render();
  });
  const resetButton = el("button", { type: "button", class: "link-button", text: "Reset message to default" });
  resetButton.addEventListener("click", () => {
    subjectInput.value = DEFAULT_SUBJECT;
    bodyInput.value = DEFAULT_BODY;
    signatureInput.value = DEFAULT_SIGNATURE;
    refresh();
  });
  const closeButton = el("button", { type: "button", class: "button-secondary", text: "Done" });
  closeButton.addEventListener("click", () => dialog.close());

  // Cancel, the × and the Esc key close the panel and undo this time's message edits.
  // (Orders already marked as notified stay marked.)
  function cancel() {
    if (templateBefore) writeStored(STORAGE_KEYS.template, templateBefore);
    else {
      try {
        localStorage.removeItem(STORAGE_KEYS.template);
      } catch {
        // nothing saved, nothing to undo
      }
    }
    dialog.close();
  }
  const cancelButton = el("button", { type: "button", class: "button-secondary", text: "Cancel" });
  cancelButton.addEventListener("click", cancel);
  const closeX = el("button", { type: "button", class: "dialog-close", "aria-label": "Cancel", title: "Cancel", text: "×" });
  closeX.addEventListener("click", cancel);
  dialog.oncancel = (event) => {
    event.preventDefault();
    cancel();
  };

  for (const input of [subjectInput, bodyInput, signatureInput]) input.addEventListener("input", refresh);

  const missing = orders.length - reachable.length;
  dialog.replaceChildren(
    closeX,
    el("div", { class: "dialog-body" }, [
      el("h2", { text: `Notify ${reachable.length} ${reachable.length === 1 ? "customer" : "customers"} about a possible delay` }),
      el("p", {
        class: "sub",
        text:
          "Click a customer to preview their email. Send all emails marks every customer below as notified " +
          "(simulated: no email is actually sent). Open email draft opens one in your email app if you want to send it yourself." +
          (missing ? ` ${missing} selected ${missing === 1 ? "order has" : "orders have"} no usable customer email and will be skipped.` : ""),
      }),
      el("div", { class: "notify-grid" }, [
        el("div", { class: "notify-edit" }, [
          el("label", { for: "notify-subject", text: "Subject" }),
          subjectInput,
          el("label", { for: "notify-body", text: "Message" }),
          bodyInput,
          el("p", { class: "sub", text: `Filled in for each order: ${PLACEHOLDERS.join(" ")}` }),
          el("label", { for: "notify-signature", text: "Signed" }),
          signatureInput,
          resetButton,
        ]),
        el("div", { class: "notify-preview" }, [previewHeading, preview]),
      ]),
      el("h3", { text: "Recipients" }),
      list,
      status,
    ]),
    el("div", { class: "dialog-footer" }, [cancelButton, copyButton, csvButton, closeButton, sendButton]),
  );
  refresh();
  dialog.showModal();
}
