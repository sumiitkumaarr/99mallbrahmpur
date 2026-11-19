const PRICE_PER_ITEM = 99;
const ALLOWED_EMAILS = new Set([
  "sumiitkumar.it@gmail.com",
  "amiitkumar.it@gmail.com",
]);
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAuDGd1B30OhurOb45-XyMDN4-M-2847qo",
  authDomain: "mallbrahmpur.firebaseapp.com",
  projectId: "mallbrahmpur",
  storageBucket: "mallbrahmpur.firebasestorage.app",
  messagingSenderId: "575014852170",
  appId: "1:575014852170:web:20d05c30b911bafd08b8b3",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const $ = (selector) => document.querySelector(selector);
const authScreen = $("#auth-screen");
const appScreen = $("#app-screen");
const forms = {
  login: $("#login-form"),
  setup: $("#setup-form"),
  reset: $("#reset-form"),
};
let currentPage = "billing";
let account = null;
let sales = [];
let billPendingSave = true;

function isAllowedEmail(email) {
  return ALLOWED_EMAILS.has(String(email || "").trim().toLowerCase());
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "This email is already registered.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
  };
  return messages[error.code] || "Could not complete the request. Please try again.";
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCurrency(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
}

function formatDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-IN", {
    hour: "numeric", minute: "2-digit",
  });
}

function createdAtMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function showAuth(view) {
  Object.entries(forms).forEach(([name, form]) => {
    form.classList.toggle("hidden", name !== view);
    form.reset();
    form.querySelector(".form-error").textContent = "";
  });
  $("#login-password").type = "password";
  $("#toggle-login-password").textContent = "Show";
  $("#toggle-login-password").setAttribute("aria-label", "Show password");
  $("#toggle-login-password").setAttribute("aria-pressed", "false");
  const setup = view === "setup";
  const reset = view === "reset";
  $("#auth-kicker").textContent = setup ? "LET'S GET YOU SET UP" : reset ? "ACCOUNT RECOVERY" : "WELCOME BACK";
  $("#auth-title").textContent = setup ? "Create your store account" : reset ? "Reset your password" : "Sign in to your store";
  $("#auth-description").textContent = setup
    ? "Set up your owner account to start billing."
    : reset ? "Enter your email to receive a secure password reset link." : "Enter your details to continue to billing.";
  $("#auth-switch").innerHTML = setup
    ? 'Already set up? <button class="text-button" type="button" data-auth-view="login">Sign in</button>'
    : reset
      ? 'Remember your password? <button class="text-button" type="button" data-auth-view="login">Back to sign in</button>'
      : account
        ? ""
        : 'First time here? <button class="text-button" type="button" data-auth-view="setup">Create your store account</button>';
}

function renderSalesList(container, sales, limit = Infinity) {
  if (!sales.length) {
    container.innerHTML = '<div class="empty-state">No bills yet. Create your first bill to see it here.</div>';
    return;
  }
  container.innerHTML = sales.slice(0, limit).map((sale) => `
    <article class="sale-row">
      <div><div class="sale-id">${escapeHTML(sale.id)}</div><div class="sale-meta">${formatDate(sale.date)} · ${formatTime(sale.time)}</div></div>
      <span class="sale-quantity">${sale.quantity} ${sale.quantity === 1 ? "item" : "items"}</span>
      <strong class="sale-amount">${formatCurrency(sale.total)}</strong>
    </article>
  `).join("");
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function salesSummary(sales) {
  const today = localDateKey();
  const now = new Date();
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = localDateKey(yesterdayDate);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  const weekStartKey = localDateKey(weekStart);
  const monthPrefix = today.slice(0, 7);
  const todaySales = sales.filter((sale) => sale.date === today);
  const yesterdaySales = sales.filter((sale) => sale.date === yesterday);
  const weekSales = sales.filter((sale) => sale.date >= weekStartKey && sale.date <= today);
  const monthSales = sales.filter((sale) => sale.date.startsWith(monthPrefix));
  const totals = (items) => items.reduce((sum, sale) => sum + sale.total, 0);
  const items = (list) => list.reduce((sum, sale) => sum + sale.quantity, 0);
  return {
    todaySales, yesterdaySales, weekSales, monthSales,
    todayTotal: totals(todaySales), yesterdayTotal: totals(yesterdaySales),
    weekTotal: totals(weekSales), monthTotal: totals(monthSales),
    weekItems: items(weekSales),
  };
}

function updateDashboard() {
  const sortedSales = [...sales].sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
  const summary = salesSummary(sortedSales);
  $("#report-today").textContent = formatCurrency(summary.todayTotal);
  $("#report-today-count").textContent = `${summary.todaySales.length} ${summary.todaySales.length === 1 ? "bill" : "bills"}`;
  $("#report-yesterday").textContent = formatCurrency(summary.yesterdayTotal);
  $("#report-yesterday-count").textContent = `${summary.yesterdaySales.length} ${summary.yesterdaySales.length === 1 ? "bill" : "bills"} yesterday`;
  $("#report-week").textContent = formatCurrency(summary.weekTotal);
  $("#report-week-items").textContent = `${summary.weekItems} items sold`;
  $("#report-month").textContent = formatCurrency(summary.monthTotal);
  $("#report-month-count").textContent = `${summary.monthSales.length} ${summary.monthSales.length === 1 ? "bill" : "bills"}`;
  $("#billing-report-today").textContent = formatCurrency(summary.todayTotal);
  $("#billing-report-today-count").textContent = `${summary.todaySales.length} ${summary.todaySales.length === 1 ? "bill" : "bills"} today`;
  $("#billing-report-yesterday").textContent = formatCurrency(summary.yesterdayTotal);
  $("#billing-report-yesterday-count").textContent = `${summary.yesterdaySales.length} ${summary.yesterdaySales.length === 1 ? "bill" : "bills"} yesterday`;
  $("#billing-report-week").textContent = formatCurrency(summary.weekTotal);
  $("#billing-report-week-items").textContent = `${summary.weekItems} items sold`;
  $("#billing-report-month").textContent = formatCurrency(summary.monthTotal);
  $("#billing-report-month-count").textContent = `${summary.monthSales.length} ${summary.monthSales.length === 1 ? "bill" : "bills"} this month`;
  renderSalesList($("#billing-recent-sales"), sortedSales, 5);
  renderSalesTable(sortedSales);
  renderDailyReport(sortedSales);
  renderDailySalesChart(sortedSales);
}

function renderSalesTable(sales) {
  const filter = $("#sales-date-filter").value;
  const filtered = filter ? sales.filter((sale) => sale.date === filter) : sales;
  $("#sales-subtitle").textContent = filter
    ? `Showing ${filtered.length} ${filtered.length === 1 ? "bill" : "bills"} for ${formatDate(filter)}`
    : `${sales.length} ${sales.length === 1 ? "bill" : "bills"} recorded`;
  const container = $("#sales-table-wrap");
  if (!filtered.length) {
    container.innerHTML = '<div class="sales-empty">No bills found for this date.</div>';
    return;
  }
  container.innerHTML = `
    <table class="sales-table">
      <thead><tr><th>Bill</th><th>Date</th><th>Time</th><th>Items</th><th>Amount</th></tr></thead>
      <tbody>${filtered.map((sale) => `
        <tr><td>${escapeHTML(sale.id)}</td><td>${formatDate(sale.date)}</td><td>${formatTime(sale.time)}</td>
        <td>${sale.quantity}</td><td class="table-amount">${formatCurrency(sale.total)}</td></tr>
      `).join("")}</tbody>
    </table>`;
}

function renderDailyReport(sales) {
    const date = $("#sales-date-filter").value;
    const label = $("#daily-report-date");
    const daySelect = $("#daily-report-day-select");
    const dates = [...new Set([...sales.map((sale) => sale.date), date].filter(Boolean))].sort().reverse();
    daySelect.replaceChildren(new Option("Choose a day with sales", ""));
    dates.forEach((day) => {
      const daySales = sales.filter((sale) => sale.date === day);
      const total = daySales.reduce((sum, sale) => sum + sale.total, 0);
      daySelect.add(new Option(
        `${formatDate(day)} — ${formatCurrency(total)}, ${daySales.length} bills`,
        day,
      ));
    });
    daySelect.value = date;

    if (!date) {
      label.textContent = "Choose a date to view its daily report.";
      $("#daily-report-total").textContent = "—";
      $("#daily-report-bills").textContent = "—";
      $("#daily-report-items").textContent = "—";
      return;
    }

    const daySales = sales.filter((sale) => sale.date === date);
    label.textContent = `Daily report for ${formatDate(date)}`;
    $("#daily-report-total").textContent = formatCurrency(
      daySales.reduce((total, sale) => total + sale.total, 0),
    );
    $("#daily-report-bills").textContent = String(daySales.length);
    $("#daily-report-items").textContent = String(
      daySales.reduce((total, sale) => total + sale.quantity, 0),
    );
}

function renderDailySalesChart(sales) {
    const selectedDate = $("#sales-date-filter").value;
    const endDate = selectedDate
      ? new Date(`${selectedDate}T00:00:00`)
      : new Date();
    const days = [];

    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(endDate);
      date.setDate(date.getDate() - offset);
      const key = localDateKey(date);
      const daySales = sales.filter((sale) => sale.date === key);
      days.push({
        key,
        date,
        total: daySales.reduce((sum, sale) => sum + sale.total, 0),
        bills: daySales.length,
      });
    }

    const maxTotal = Math.max(1, ...days.map((day) => day.total));
    const shortCurrency = new Intl.NumberFormat("en-IN", {
      notation: "compact",
      maximumFractionDigits: 1,
    });
    const rangeStart = formatDate(days[0].key);
    const rangeEnd = formatDate(days[days.length - 1].key);
    $("#sales-chart-period").textContent = `Daily totals from ${rangeStart} to ${rangeEnd}`;
    const chart = $("#daily-sales-chart");
    chart.setAttribute("aria-label", days.map((day) =>
      `${formatDate(day.key)}: ${formatCurrency(day.total)}, ${day.bills} bills`
    ).join(". "));
    chart.innerHTML = days.map((day) => {
      const height = day.total ? Math.max(4, (day.total / maxTotal) * 100) : 0;
      const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(day.date);
      const dayOfMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(day.date);
      const title = `${formatDate(day.key)} · ${formatCurrency(day.total)} · ${day.bills} ${day.bills === 1 ? "bill" : "bills"}`;
      return `
        <div class="bar-chart-column" title="${title}">
          <span class="bar-chart-value">${day.total ? `₹${shortCurrency.format(day.total)}` : "₹0"}</span>
          <div class="bar-chart-track"><span class="bar-chart-fill" style="height: ${height}%"></span></div>
          <span class="bar-chart-weekday">${weekday}</span>
          <span class="bar-chart-date">${dayOfMonth}</span>
        </div>
      `;
    }).join("");
}

function confirmSalesDeletion() {
    const dialog = $("#clear-sales-dialog");
    $("#clear-sales-dialog-message").textContent =
      "Are you sure you want to permanently delete all saved bills and sales reports? Your login account will not be deleted.";
    dialog.returnValue = "";

    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        resolve(dialog.returnValue === "confirm");
      }, { once: true });
      dialog.showModal();
    });
}

async function clearSalesData() {
    const button = $("#clear-sales-button");
    const status = $("#clear-sales-message");
    button.disabled = true;
    status.textContent = "";
    status.classList.remove("success");

    try {
      const confirmed = await confirmSalesDeletion();
      if (!confirmed) return;

      const snapshot = await getDocs(query(
        collection(db, "sales"),
        where("ownerId", "==", auth.currentUser.uid),
      ));
      if (snapshot.empty) {
        status.textContent = "There are no sales to clear.";
        return;
      }

      let deletedCount = 0;
      for (let start = 0; start < snapshot.docs.length; start += 500) {
        const batch = writeBatch(db);
        snapshot.docs.slice(start, start + 500).forEach((saleDoc) => batch.delete(saleDoc.ref));
        await batch.commit();
        deletedCount += Math.min(500, snapshot.docs.length - start);
      }

      sales = [];
      $("#sales-date-filter").value = "";
      updateDashboard();
      status.textContent = `${deletedCount} bills and reports deleted.`;
      status.classList.add("success");
    } catch (error) {
      console.error("Could not clear sales data:", error);
      status.textContent = `Could not clear all sales data: ${error.message}`;
    } finally {
      button.disabled = false;
    }
}

function showPrintReceipt(sale) {
    $("#receipt-bill-number").textContent = sale.id;
    $("#receipt-date-time").textContent = `${formatDate(sale.date)} · ${formatTime(sale.time)}`;
    $("#receipt-description").textContent = sale.manualAmount
      ? "Manual amount"
      : `Everyday item × ${sale.quantity}`;
    $("#receipt-total").textContent = formatCurrency(sale.total);
    $("#receipt-grand-total").textContent = formatCurrency(sale.total);
    $("#print-receipt").classList.remove("hidden");
    $("#print-bill-button").classList.remove("hidden");
}

function showProfileDialog() {
  $("#profile-name").textContent = account?.name || "My store";
  $("#profile-email").textContent = account?.email || "No email address";
  const message = $("#profile-message");
  message.textContent = "";
  message.classList.remove("error", "success");
  $("#profile-reset-button").disabled = !account?.email;
  $("#profile-dialog").showModal();
}

async function sendAccountPasswordReset() {
  const button = $("#profile-reset-button");
  const message = $("#profile-message");
  const email = account?.email;
  message.textContent = "";
  message.classList.remove("error", "success");
  if (!email) {
    message.textContent = "No email address is associated with this account.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    message.textContent = `Password reset email sent to ${email}.`;
    message.classList.add("success");
  } catch (error) {
    console.error("Could not send account password reset email:", error);
    message.textContent = authErrorMessage(error);
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
}

function showBillSavedDialog(quantity, total) {
    const dialog = $("#bill-saved-dialog");
    $("#bill-saved-dialog-message").textContent =
      `${quantity} ${quantity === 1 ? "item" : "items"} saved for ${formatCurrency(total)}.`;
    dialog.showModal();
    window.setTimeout(() => {
      if (dialog.open) dialog.close();
    }, 2200);
}

function refreshDateReport() {
    const sortedSales = [...sales].sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
    renderSalesTable(sortedSales);
    renderDailyReport(sortedSales);
    renderDailySalesChart(sortedSales);
}

function setPage(page) {
  currentPage = page;
  if (page === "billing") {
    $("#item-quantity").value = "1";
    document.querySelector('input[name="billing-mode"][value="standard"]').checked = true;
    $("#manual-amount-entry").classList.add("hidden");
    $("#quantity-entry").classList.remove("hidden");
    $("#manual-amount").value = "";
    $("#fixed-price").innerHTML = "₹99 <small>/ item</small>";
    $("#product-price").textContent = "₹99";
    $("#bill-message").textContent = "";
    $("#bill-message").classList.remove("error");
    $("#print-receipt").classList.add("hidden");
    billPendingSave = true;
    $("#print-bill-button").textContent = "Save & Print";
    const bill = updateBillTotal();
    $("#print-bill-button").disabled = bill === null;
  }
  document.querySelectorAll(".page-section").forEach((section) => section.classList.add("hidden"));
  $(`#${page}-page`).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  $("#page-breadcrumb").textContent = page === "sales" ? "Sales & reports" : page === "billing" ? "New bill" : "Overview";
  updateDashboard();
  window.scrollTo(0, 0);
}

async function enterApp() {
  if (!auth.currentUser) {
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    showAuth("login");
    return;
  }
  account = {
    id: auth.currentUser.uid,
    name: auth.currentUser.displayName || "My store",
    email: auth.currentUser.email || "",
  };
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  $("#store-name").textContent = account.name || "My store";
  $("#profile-avatar").textContent = (account.name || "S").slice(0, 1).toUpperCase();
  $("#header-date").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });
  await loadSales();
  setPage(currentPage);
}

function showFormError(form, message) {
  form.querySelector(".form-error").classList.remove("success");
  form.querySelector(".form-error").textContent = message;
}

function showFormSuccess(form, message) {
  const feedback = form.querySelector(".form-error");
  feedback.classList.add("success");
  feedback.textContent = message;
}

async function handleSetup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const password = String(data.get("password"));
  const email = String(data.get("email")).trim();
  if (!isAllowedEmail(email)) {
    showFormError(form, "This email address is not allowed to create an account.");
    return;
  }
  if (password.length < 8) {
    showFormError(form, "Password must be at least 8 characters.");
    return;
  }
  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );
    await updateProfile(credential.user, { displayName: String(data.get("name")).trim() });
    await setDoc(doc(db, "accounts", credential.user.uid), {
      name: String(data.get("name")).trim(),
      email: credential.user.email,
      ownerId: credential.user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    showFormError(form, authErrorMessage(error));
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email")).trim();
  if (!isAllowedEmail(email)) {
    showFormError(form, "This email address is not allowed to sign in.");
    return;
  }
  try {
    await signInWithEmailAndPassword(
      auth,
      email,
      String(data.get("password")),
    );
  } catch (error) {
    showFormError(form, authErrorMessage(error));
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email")).trim();
  if (!isAllowedEmail(email)) {
    showFormError(form, "Password reset is available only for the two allowed email addresses.");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showAuth("login");
    showFormSuccess(forms.login, "Password reset email sent. Check your inbox.");
  } catch (error) {
    showFormError(form, authErrorMessage(error));
  }
}

function updateBillTotal() {
  const manualMode = document.querySelector('input[name="billing-mode"]:checked').value === "manual";
  const field = manualMode ? $("#manual-amount") : $("#item-quantity");
  const parsed = Number(field.value);
  const quantity = manualMode ? 1 : parsed;
  const total = manualMode ? parsed : parsed * PRICE_PER_ITEM;
  const isValid = field.value.trim() !== ""
    && Number.isSafeInteger(parsed)
    && parsed > 0
    && Number.isSafeInteger(total);
  $("#save-bill").disabled = !isValid;
  $("#print-bill-button").disabled = !isValid;
  $("#bill-total").textContent = isValid ? formatCurrency(total) : "—";
  return isValid ? { quantity, total, manualAmount: manualMode } : null;
}

async function loadSales() {
  try {
    const salesQuery = query(
      collection(db, "sales"),
      where("ownerId", "==", auth.currentUser.uid),
    );
    const snapshot = await getDocs(salesQuery);
    sales = snapshot.docs.map((saleDoc) => ({
      id: saleDoc.id,
      ...saleDoc.data(),
    })).sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
  } catch (error) {
    console.error("Could not load sales:", error);
    sales = [];
  }
}

async function createBill({
  inputId,
  totalId,
  buttonId,
  messageId,
  printAfterSave = false,
  showSavedDialog = false,
}) {
  const button = $(`#${buttonId}`);
  const printButton = $("#print-bill-button");
  const message = $(`#${messageId}`);
  message.textContent = "";
  message.classList.remove("error");
  const bill = updateBillTotal();
  if (bill === null) {
    message.textContent = document.querySelector('input[name="billing-mode"]:checked').value === "manual"
      ? "Enter a whole amount greater than zero."
      : "Enter a whole number of items greater than zero.";
    message.classList.add("error");
    return;
  }
  const { quantity, total, manualAmount } = bill;
  button.disabled = true;
  printButton.disabled = true;
  try {
    const now = new Date();
    const date = localDateKey(now);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const billNumber = `BILL-${now.getTime().toString().slice(-8)}`;
    const sale = {
      id: billNumber,
      billNumber,
      quantity,
      unitPrice: manualAmount ? total : PRICE_PER_ITEM,
      manualAmount,
      total,
      date,
      time,
    };
    await addDoc(collection(db, "sales"), {
      ownerId: auth.currentUser.uid,
      ...sale,
      createdAt: serverTimestamp(),
    });
    showPrintReceipt(sale);
    await loadSales();
    const quantityField = $(`#${inputId}`);
    if (!manualAmount) quantityField.value = "1";
    billPendingSave = false;
    printButton.textContent = "Print bill";
    updateBillTotal();
    message.textContent = manualAmount
      ? `Your bill is saved for ${formatCurrency(total)}.`
      : `Your bill is saved — ${quantity} ${quantity === 1 ? "item" : "items"}, ${formatCurrency(total)}.`;
    button.blur();
    (manualAmount ? $("#manual-amount") : quantityField).focus();
    updateDashboard();
    if (showSavedDialog) showBillSavedDialog(quantity, total);
    if (printAfterSave) window.print();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    if (billPendingSave) updateBillTotal();
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-auth-view], [data-go], [data-page], [data-sales-date]");
  if (!target) return;
  if (target.dataset.authView) {
    showAuth(target.dataset.authView);
  } else if (target.dataset.salesDate) {
    const filter = $("#sales-date-filter");
    if (target.dataset.salesDate === "today") {
      filter.value = localDateKey();
    } else if (target.dataset.salesDate === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      filter.value = localDateKey(yesterday);
    } else {
      filter.value = "";
    }
    refreshDateReport();
  } else if (target.dataset.go) {
    setPage(target.dataset.go);
  } else if (target.dataset.page) {
    setPage(target.dataset.page);
  }
});

forms.setup.addEventListener("submit", handleSetup);
forms.login.addEventListener("submit", handleLogin);
forms.reset.addEventListener("submit", handlePasswordReset);
$("#profile-avatar").addEventListener("click", showProfileDialog);
$("#profile-reset-button").addEventListener("click", sendAccountPasswordReset);
$("#toggle-login-password").addEventListener("click", (event) => {
  const password = $("#login-password");
  const showPassword = password.type === "password";
  password.type = showPassword ? "text" : "password";
  event.currentTarget.textContent = showPassword ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", `${showPassword ? "Hide" : "Show"} password`);
  event.currentTarget.setAttribute("aria-pressed", String(showPassword));
});
$("#logout-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const message = $("#logout-message");
  button.disabled = true;
  message.textContent = "";
  try {
    await signOut(auth);
    currentPage = "billing";
    sales = [];
    account = null;
  } catch (error) {
    console.error("Could not sign out:", error);
    message.textContent = authErrorMessage(error);
  } finally {
    button.disabled = false;
  }
});
function adjustQuantity(inputId, increment) {
  const field = $(`#${inputId}`);
  const parsed = Number(field.value);
  const maxQuantity = Math.floor(Number.MAX_SAFE_INTEGER / PRICE_PER_ITEM);
  const current = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : (increment ? 0 : 1);
  field.value = String(Math.min(maxQuantity, Math.max(1, current + increment)));
  billPendingSave = true;
  $("#print-bill-button").textContent = "Save & Print";
  updateBillTotal();
}

$("#item-quantity").addEventListener("input", () => {
  billPendingSave = true;
  $("#print-bill-button").textContent = "Save & Print";
  updateBillTotal();
});
$("#item-quantity").addEventListener("blur", (event) => {
  if (event.currentTarget.value.trim() === "") {
    event.currentTarget.value = "1";
    billPendingSave = true;
    $("#print-bill-button").textContent = "Save & Print";
    updateBillTotal();
  }
});
$("#manual-amount").addEventListener("input", () => {
  billPendingSave = true;
  $("#print-bill-button").textContent = "Save & Print";
  updateBillTotal();
});
document.querySelectorAll('input[name="billing-mode"]').forEach((input) => {
  input.addEventListener("change", (event) => {
    const manualMode = event.currentTarget.value === "manual";
    $("#quantity-entry").classList.toggle("hidden", manualMode);
    $("#manual-amount-entry").classList.toggle("hidden", !manualMode);
    $("#fixed-price").innerHTML = manualMode ? "Custom <small>amount</small>" : "₹99 <small>/ item</small>";
    $("#product-price").textContent = manualMode ? "Custom" : "₹99";
    billPendingSave = true;
    $("#print-bill-button").textContent = "Save & Print";
    updateBillTotal();
  });
});
$("#quantity-minus").addEventListener("click", () => adjustQuantity("item-quantity", -1));
$("#quantity-plus").addEventListener("click", () => adjustQuantity("item-quantity", 1));

$("#save-bill").addEventListener("click", () => createBill({
  inputId: "item-quantity",
  totalId: "bill-total",
  buttonId: "save-bill",
  messageId: "bill-message",
  showSavedDialog: true,
}));
$("#print-bill-button").addEventListener("click", () => {
  if (!billPendingSave) {
    window.print();
    return;
  }
  createBill({
    inputId: "item-quantity",
    totalId: "bill-total",
    buttonId: "save-bill",
    messageId: "bill-message",
    printAfterSave: true,
    showSavedDialog: true,
  });
});
$("#sales-date-filter").addEventListener("input", refreshDateReport);
$("#clear-sales-button").addEventListener("click", clearSalesData);
$("#daily-report-day-select").addEventListener("change", (event) => {
  $("#sales-date-filter").value = event.currentTarget.value;
  refreshDateReport();
});
document.addEventListener("keydown", (event) => {
  if ((event.key === "b" || event.key === "B") && !event.target.matches("input,textarea")) {
    if (!appScreen.classList.contains("hidden")) setPage("billing");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    if (!isAllowedEmail(user.email)) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Could not sign out an unauthorized account:", error);
      }
      account = null;
      sales = [];
      authScreen.classList.remove("hidden");
      appScreen.classList.add("hidden");
      showAuth("login");
      showFormError(forms.login, "This email address is not allowed to sign in.");
      return;
    }
    await enterApp();
  } else {
    account = null;
    sales = [];
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    showAuth("login");
  }
});

billInputs.forEach((controls) => {
  $("#print-bill-button").disabled = updateQuantity(controls) === null;
});
