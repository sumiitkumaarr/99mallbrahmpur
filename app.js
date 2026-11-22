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
  serverTimestamp,
  setDoc,
  deleteDoc,
  getDoc,
  runTransaction,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const PRICE_PER_ITEM = 99;
const DELETE_PASSWORD = "12345";
const SHARED_STORE_ID = "99mallbrahmpur";
const ALLOWED_EMAILS = new Set([
  "sumiitkumar.it@gmail.com",
  "amiitkumar.it@gmail.com",
]);
const PROJECTS = {
  "99mall": {
    label: "99 Mall",
    avatar: "99",
    defaultPage: "billing",
    pages: ["billing", "sales", "expenses"],
    collections: ["sales", "expenses", "bill_counters"],
  },
  "aimur-goldmedal": {
    label: "Goldmedal Electrical",
    avatar: "A",
    defaultPage: "goldmedal",
    pages: ["goldmedal"],
    collections: ["goldmedal_sales", "bill_counters"],
  },
};
const PROJECT_STORAGE_KEY = "99mall-active-project";
const BILL_TYPES = {
  standard: { collection: "sales", prefix: "99BILL", label: "99 Mall" },
  manual: { collection: "sales", prefix: "MANBILL", label: "Manual" },
  expense: { collection: "expenses", prefix: "MISEXPBILL", label: "Misc. expenses" },
  goldmedal: { collection: "goldmedal_sales", prefix: "GOLMEDALBILL", label: "Goldmedal Electrical" },
};
let billNumberMigrationPromise = null;

function getStoredProject() {
  try {
    const storedProject = window.localStorage.getItem(PROJECT_STORAGE_KEY);
    return Object.hasOwn(PROJECTS, storedProject) ? storedProject : "99mall";
  } catch (error) {
    console.error("Could not restore the selected project:", error);
    return "99mall";
  }
}

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
let pageHistoryIndex = 0;
let activeProject = getStoredProject();
let account = null;
let sales = [];
let expenses = [];
let goldmedalSales = [];
let billPendingSave = true;
const dataLoadErrors = new Map();
const dataLoadLabels = {
  sales: "sales",
  expenses: "expenses",
  goldmedal_sales: "Goldmedal sales",
  bill_counters: "sequential bill numbering",
};

function updateDataLoadWarning() {
  const warning = $("#data-load-warning");
  const failures = [...dataLoadErrors.entries()].filter(([name]) =>
    PROJECTS[activeProject].collections.includes(name)
  );
  warning.classList.toggle("hidden", failures.length === 0);
  if (!failures.length) {
    warning.textContent = "";
    return;
  }

  const collections = failures.map(([name]) => dataLoadLabels[name] || name).join(", ");
  warning.textContent = failures.some(([, error]) => error.code === "permission-denied")
    ? `Could not load ${collections}: Firestore denied access. Confirm the signed-in email is allowed and the latest firestore.rules are published.`
    : `Could not load ${collections}. Check your internet connection and try again.`;
}

function setDataLoadError(collection, error) {
  dataLoadErrors.set(collection, error);
  updateDataLoadWarning();
}

function clearDataLoadError(collection) {
  dataLoadErrors.delete(collection);
  updateDataLoadWarning();
}

function clearAllDataLoadErrors() {
  dataLoadErrors.clear();
  updateDataLoadWarning();
}

function updateProjectUI() {
  const project = PROJECTS[activeProject];
  appScreen.dataset.project = activeProject;
  $("#project-switcher").value = activeProject;
  $("#workspace-link").textContent = project.label;
  $("#store-name").textContent = project.label;
  $("#store-avatar").textContent = project.avatar;
  document.querySelectorAll("[data-project]").forEach((element) => {
    element.classList.toggle("hidden", element.dataset.project !== activeProject);
  });
  updateDataLoadWarning();
}

function persistProject(project) {
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, project);
  } catch (error) {
    console.error("Could not remember the selected project:", error);
  }
}

function firestoreActionError(action, error) {
  return error.code === "permission-denied"
    ? `${action} was denied by Firestore. Confirm the signed-in email is allowed and the latest firestore.rules are published.`
    : `${action} failed: ${error.message}`;
}

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
    "permission-denied": "Firestore denied access. Confirm the signed-in email is allowed and the latest firestore.rules are published.",
    "unavailable": "Could not reach Firestore. Check your internet connection and try again.",
  };
  return messages[error.code] || "Could not complete the request. Please try again.";
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

function billNumber(type, sequence) {
  const { prefix } = BILL_TYPES[type];
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

async function saveNumberedRecord(type, data) {
  await ensureBillNumberMigration();
  const billType = BILL_TYPES[type];
  const counterRef = doc(db, "bill_counters", type);
  const recordRef = doc(collection(db, billType.collection));
  return runTransaction(db, async (transaction) => {
    const counterSnapshot = await transaction.get(counterRef);
    const sequence = (counterSnapshot.data()?.current || 0) + 1;
    const number = billNumber(type, sequence);
    const record = {
      ownerId: SHARED_STORE_ID,
      ...data,
      id: number,
      billNumber: number,
      billType: billType.label,
      billTypeKey: type,
      createdAt: serverTimestamp(),
    };
    transaction.set(counterRef, { current: sequence, updatedAt: serverTimestamp() });
    transaction.set(recordRef, record);
    return { ...record, firestoreId: recordRef.id };
  });
}

function recordOrder(left, right) {
  const leftCreated = createdAtMillis(left.data.createdAt);
  const rightCreated = createdAtMillis(right.data.createdAt);
  if (leftCreated && rightCreated && leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }
  const leftDate = `${left.data.date || ""} ${left.data.time || ""}`;
  const rightDate = `${right.data.date || ""} ${right.data.time || ""}`;
  return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id);
}

async function migrateBillTypeNumbers(type) {
  const billType = BILL_TYPES[type];
  const counterRef = doc(db, "bill_counters", type);
  if ((await getDoc(counterRef)).exists()) return;

  const snapshot = await getDocs(collection(db, billType.collection));
  const records = snapshot.docs
    .map((recordDoc) => ({ id: recordDoc.id, ref: recordDoc.ref, data: recordDoc.data() }))
    .filter(({ data }) => {
      if (type === "manual") return data.manualAmount === true || data.billTypeKey === "manual";
      if (type === "standard") return data.manualAmount !== true && data.billTypeKey !== "manual";
      return true;
    })
    .sort(recordOrder);

  for (let start = 0; start < records.length; start += 400) {
    const batch = writeBatch(db);
    const chunk = records.slice(start, start + 400);
    chunk.forEach((record, index) => {
      const number = billNumber(type, start + index + 1);
      batch.set(record.ref, {
        id: number,
        billNumber: number,
        billType: billType.label,
        billTypeKey: type,
      }, { merge: true });
    });
    await batch.commit();
  }
  await setDoc(counterRef, { current: records.length, updatedAt: serverTimestamp() });
}

function ensureBillNumberMigration() {
  if (!billNumberMigrationPromise) {
    billNumberMigrationPromise = (async () => {
      for (const type of Object.keys(BILL_TYPES)) {
        await migrateBillTypeNumbers(type);
      }
    })().catch((error) => {
      billNumberMigrationPromise = null;
      throw error;
    });
  }
  return billNumberMigrationPromise;
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
      <div><div class="sale-id">${escapeHTML(sale.id)}</div><div class="sale-meta">${escapeHTML(sale.billType || (sale.manualAmount ? "Manual" : "99 Mall"))} · ${formatDate(sale.date)} · ${formatTime(sale.time)}</div></div>
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

function salesByCategory(sales) {
  const category = $("#sales-category-filter")?.value || "all";
  if (category === "expense") {
    return expenses.map((expense) => ({
      id: expense.billNumber || `MISEXPBILL-${expense.firestoreId?.slice(-8).toUpperCase() || ""}`,
      billNumber: expense.billNumber,
      firestoreId: expense.firestoreId,
      date: expense.date,
      time: "00:00",
      quantity: 0,
      total: expense.amount,
      remarks: expense.description || expense.category || "",
      manualAmount: false,
      category: "expense",
      categoryName: expense.category,
    })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  if (category === "goldmedal") {
    return goldmedalSales.map((sale) => ({
      ...sale,
      quantity: sale.quantity || 1,
      manualAmount: false,
      category: "goldmedal",
    })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  if (category === "standard") return sales.filter((sale) => sale.manualAmount !== true);
  if (category === "manual") return sales.filter((sale) => sale.manualAmount === true);
  return sales;
}

function updateDashboard() {
  if (dataLoadErrors.has("sales")) {
    [
      "#report-today", "#report-yesterday", "#report-week", "#report-month",
      "#billing-report-today", "#billing-report-yesterday", "#billing-report-week", "#billing-report-month",
    ].forEach((selector) => { $(selector).textContent = "—"; });
    [
      "#report-today-count", "#report-yesterday-count", "#report-week-items", "#report-month-count",
      "#billing-report-today-count", "#billing-report-yesterday-count", "#billing-report-week-items", "#billing-report-month-count",
    ].forEach((selector) => { $(selector).textContent = "Unavailable"; });
    $("#billing-recent-sales").innerHTML = '<div class="empty-state">Sales data could not be loaded.</div>';
    renderSalesTable([]);
    renderDailyReport([]);
    renderDailySalesChart([]);
    return;
  }

  const sortedSales = [...sales].sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
  const reportSales = salesByCategory(sortedSales);
  const summary = salesSummary(reportSales);
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
  if (dataLoadErrors.has("sales")) {
    $("#sales-subtitle").textContent = "Sales data is unavailable.";
    $("#sales-table-wrap").innerHTML = '<div class="sales-empty">Sales data could not be loaded.</div>';
    return;
  }

  const filter = $("#sales-date-filter").value;
  const rawSearch = $("#bill-search-input").value.trim();
  const search = rawSearch.toLowerCase().replace(/[₹,\s]/g, "");
  let filtered = salesByCategory(sales);
  if (filter) filtered = filtered.filter((sale) => sale.date === filter);
  if (search) {
    filtered = filtered.filter((sale) => {
      const searchableValues = [
        sale.id,
        sale.billNumber,
        sale.quantity,
        sale.total,
        sale.remarks,
        sale.manualAmount ? "manual" : "standard",
      ];
      return searchableValues.some((value) =>
        String(value || "").toLowerCase().replace(/[₹,\s]/g, "").includes(search),
      );
    });
  }
  const filterParts = [];
  const category = $("#sales-category-filter").value;
  if (category === "standard") filterParts.push("for 99 Mall bills");
  if (category === "manual") filterParts.push("for manual bills");
  if (category === "expense") filterParts.push("for Misc. expenses");
  if (category === "goldmedal") filterParts.push("for Goldmedal Electrical bills");
  if (filter) filterParts.push(`for ${formatDate(filter)}`);
  if (rawSearch) filterParts.push(`matching "${rawSearch}"`);
  $("#sales-subtitle").textContent = filterParts.length
    ? `Showing ${filtered.length} ${filtered.length === 1 ? "bill" : "bills"} ${filterParts.join(" ")}`
    : `${sales.length} ${sales.length === 1 ? "bill" : "bills"} recorded`;
  const container = $("#sales-table-wrap");
  if (!filtered.length) {
    container.innerHTML = search || filter
      ? '<div class="sales-empty">No bills found for this search or date.</div>'
      : '<div class="sales-empty">No bills found.</div>';
    return;
  }
  const selectedCategory = $("#sales-category-filter").value;
  if (selectedCategory === "expense") {
    container.innerHTML = `
      <table class="sales-table expense-table">
        <thead><tr><th>Bill number</th><th>Date</th><th>Category</th><th>Remarks</th><th>Amount</th></tr></thead>
        <tbody>${filtered.map((expense) => `
          <tr>
            <td>${escapeHTML(expense.billNumber || expense.id)}</td>
            <td>${formatDate(expense.date)}</td>
            <td>${escapeHTML(expense.categoryName || expense.remarks || "Expense")}</td>
            <td>${escapeHTML(expense.remarks || "—")}</td>
            <td class="table-amount">${formatCurrency(expense.total)}</td>
          </tr>
        `).join("")}</tbody>
      </table>`;
    return;
  }
  if (selectedCategory === "goldmedal") {
    container.innerHTML = `
      <table class="sales-table expense-table">
        <thead><tr><th>Bill</th><th>Date</th><th>Time</th><th>Remarks</th><th>Amount</th></tr></thead>
        <tbody>${filtered.map((sale) => `
          <tr>
            <td>${escapeHTML(sale.id)}</td>
            <td>${formatDate(sale.date)}</td>
            <td>${formatTime(sale.time)}</td>
            <td>${escapeHTML(sale.remarks || "—")}</td>
            <td class="table-amount">${formatCurrency(sale.total)}</td>
          </tr>
        `).join("")}</tbody>
      </table>`;
    return;
  }
  container.innerHTML = `
    <table class="sales-table">
      <thead><tr><th>Bill</th><th>Type</th><th>Date</th><th>Time</th><th>Items</th><th>Remarks</th><th>Amount</th><th>Action</th></tr></thead>
      <tbody>${filtered.map((sale) => `
        <tr><td>${escapeHTML(sale.id)}</td><td>${escapeHTML(sale.billType || (sale.manualAmount ? "Manual" : "99 Mall"))}</td><td>${formatDate(sale.date)}</td><td>${formatTime(sale.time)}</td>
        <td>${sale.quantity}</td><td>${sale.manualAmount ? escapeHTML(sale.remarks || "—") : "—"}</td>
        <td class="table-amount">${formatCurrency(sale.total)}</td>
        <td><button class="button button-danger delete-sale-button" type="button" data-delete-sale="${escapeHTML(sale.firestoreId)}" aria-label="Delete bill ${escapeHTML(sale.id)}">Delete</button></td></tr>
      `).join("")}</tbody>
    </table>`;
}

function renderDailyReport(sales) {
    if (dataLoadErrors.has("sales")) {
      $("#daily-report-date").textContent = "Sales data is unavailable.";
      $("#daily-report-total").textContent = "—";
      $("#daily-report-bills").textContent = "—";
      $("#daily-report-items").textContent = "—";
      return;
    }

    const selectedDate = $("#sales-date-filter").value;
    const date = selectedDate || localDateKey();
    const reportSales = salesByCategory(sales);
    const label = $("#daily-report-date");
    const daySelect = $("#daily-report-day-select");
    const dates = [...new Set([...reportSales.map((sale) => sale.date), date].filter(Boolean))].sort().reverse();
    daySelect.replaceChildren(new Option("Choose a day with sales", ""));
    dates.forEach((day) => {
      const daySales = reportSales.filter((sale) => sale.date === day);
      const total = daySales.reduce((sum, sale) => sum + sale.total, 0);
      daySelect.add(new Option(
        `${formatDate(day)} — ${formatCurrency(total)}, ${daySales.length} bills`,
        day,
      ));
    });
    daySelect.value = date;

    const daySales = reportSales.filter((sale) => sale.date === date);
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
    const reportSales = salesByCategory(sales);
    const endDate = selectedDate
      ? new Date(`${selectedDate}T00:00:00`)
      : new Date();
    const days = [];

    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(endDate);
      date.setDate(date.getDate() - offset);
      const key = localDateKey(date);
      const daySales = reportSales.filter((sale) => sale.date === key);
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
    if (dataLoadErrors.has("sales")) {
      window.echarts?.getInstanceByDom(chart)?.dispose();
      chart.innerHTML = '<div class="sales-empty">Sales chart is unavailable until the data can be loaded.</div>';
      return;
    }
    const labels = days.map((day) =>
      new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(day.date),
    );
    const fullLabels = days.map((day) =>
      new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(day.date),
    );
    chart.setAttribute("aria-label", days.map((day) =>
      `${formatDate(day.key)}: ${formatCurrency(day.total)}, ${day.bills} bills`
    ).join(". "));

    if (!window.echarts) {
      chart.innerHTML = '<div class="sales-empty">Sales chart could not be loaded. Please refresh the page.</div>';
      return;
    }

    chart.querySelector(".sales-empty")?.remove();
    const instance = echarts.getInstanceByDom(chart) || echarts.init(chart, null, { renderer: "canvas" });
    instance.setOption({
      animationDuration: 650,
      animationEasing: "cubicOut",
      textStyle: { fontFamily: "DM Sans, sans-serif", color: "#798392" },
      grid: { top: 46, right: 12, bottom: 48, left: 48 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(82, 116, 168, 0.08)" } },
        backgroundColor: "rgba(255, 255, 255, 0.96)",
        borderColor: "#dfe6f0",
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: "#353b45", fontSize: 12 },
        extraCssText: "border-radius:10px;box-shadow:0 12px 30px rgba(38,54,80,.12)",
        formatter(params) {
          const point = params[0];
          const index = point.dataIndex;
          const day = days[index];
          return `<div style="font-weight:700;margin-bottom:5px">${formatDate(day.key)}</div>
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#5274a8;margin-right:7px"></span>
            Sales <b style="margin-left:8px">${formatCurrency(day.total)}</b>
            <div style="color:#8b94a0;margin-top:4px">${day.bills} ${day.bills === 1 ? "bill" : "bills"}</div>`;
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "#e7ebf2" } },
        axisTick: { show: false },
        axisLabel: {
          margin: 12,
          color: "#687080",
          fontSize: 11,
          fontWeight: 600,
          formatter(value, index) {
            return `${value}\n${fullLabels[index]}`;
          },
          rich: {},
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: maxTotal,
        splitNumber: 4,
        axisLabel: {
          margin: 10,
          color: "#98a0aa",
          fontSize: 10,
          formatter(value) {
            if (value === 0) return "₹0";
            return `₹${shortCurrency.format(value)}`;
          },
        },
        splitLine: { lineStyle: { color: "#edf0f4", type: "dashed" } },
      },
      series: [{
        name: "Sales",
        type: "bar",
        barMaxWidth: 42,
        data: days.map((day, index) => ({
          value: day.total,
          itemStyle: {
            borderRadius: [8, 8, 3, 3],
            color: index === days.length - 1
              ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: "#7ea4cd" },
                  { offset: 1, color: "#5274a8" },
                ])
              : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: "#b0c3df" },
                  { offset: 1, color: "#6688b3" },
                ]),
          },
        })),
        emphasis: {
          itemStyle: { borderRadius: [8, 8, 3, 3], shadowBlur: 12, shadowColor: "rgba(82,116,168,.20)" },
        },
      }],
    }, true);
}

function setGoldmedalReportDate(date) {
  $("#goldmedal-daily-date").value = date;
  $("#goldmedal-date-filter").value = date;
  renderGoldmedalReports();
  renderGoldmedalSales();
}

function renderExpenses() {
  if (dataLoadErrors.has("expenses")) {
    ["#expense-today", "#expense-month", "#expense-total"].forEach((selector) => {
      $(selector).textContent = "—";
    });
    ["#expense-today-count", "#expense-month-count", "#expense-total-count"].forEach((selector) => {
      $(selector).textContent = "Unavailable";
    });
    $("#expense-list-subtitle").textContent = "Expense data is unavailable.";
    $("#expenses-table-wrap").innerHTML = '<div class="sales-empty">Expense data could not be loaded.</div>';
    return;
  }

  const today = localDateKey();
  const monthPrefix = today.slice(0, 7);
  const todayExpenses = expenses.filter((expense) => expense.date === today);
  const monthExpenses = expenses.filter((expense) => expense.date?.startsWith(monthPrefix));
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const todayTotal = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const monthTotal = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  $("#expense-today").textContent = formatCurrency(todayTotal);
  $("#expense-today-count").textContent = `${todayExpenses.length} ${todayExpenses.length === 1 ? "expense" : "expenses"}`;
  $("#expense-month").textContent = formatCurrency(monthTotal);
  $("#expense-month-count").textContent = `${monthExpenses.length} ${monthExpenses.length === 1 ? "expense" : "expenses"}`;
  $("#expense-total").textContent = formatCurrency(total);
  $("#expense-total-count").textContent = `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"}`;

  const dateFilter = $("#expense-date-filter").value;
  const search = $("#expense-search-input").value.trim().toLowerCase();
  let filtered = dateFilter ? expenses.filter((expense) => expense.date === dateFilter) : expenses;
  if (search) {
    filtered = filtered.filter((expense) =>
      `${expense.category} ${expense.description} ${expense.amount}`
        .toLowerCase()
        .includes(search),
    );
  }

  const filterParts = [];
  if (dateFilter) filterParts.push(`for ${formatDate(dateFilter)}`);
  if (search) filterParts.push(`matching "${$("#expense-search-input").value.trim()}"`);
  $("#expense-list-subtitle").textContent = filterParts.length
    ? `Showing ${filtered.length} ${filtered.length === 1 ? "expense" : "expenses"} ${filterParts.join(" ")}`
    : `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"} recorded`;

  const container = $("#expenses-table-wrap");
  if (!filtered.length) {
    container.innerHTML = '<div class="sales-empty">No miscellaneous expenses found.</div>';
    return;
  }
  container.innerHTML = `
    <table class="sales-table expense-table">
      <thead><tr><th>Bill number</th><th>Date</th><th>Category</th><th>Remarks</th><th>Amount</th><th>Action</th></tr></thead>
      <tbody>${filtered.map((expense) => `
        <tr>
          <td>${escapeHTML(expense.billNumber || expense.id)}</td>
          <td>${formatDate(expense.date)}</td>
          <td>${escapeHTML(expense.category)}</td>
          <td>${expense.description ? escapeHTML(expense.description) : "—"}</td>
          <td class="table-amount">${formatCurrency(expense.amount)}</td>
          <td><button class="button button-danger delete-expense-button" type="button" data-delete-expense="${escapeHTML(expense.firestoreId)}" aria-label="Delete ${escapeHTML(expense.category)} expense">Delete</button></td>
        </tr>
      `).join("")}</tbody>
    </table>`;
}

function renderGoldmedalSales() {
  if (dataLoadErrors.has("goldmedal_sales")) {
    ["#goldmedal-today", "#goldmedal-month", "#goldmedal-total"].forEach((selector) => {
      $(selector).textContent = "—";
    });
    ["#goldmedal-today-count", "#goldmedal-month-count", "#goldmedal-total-count"].forEach((selector) => {
      $(selector).textContent = "Unavailable";
    });
    $("#goldmedal-list-subtitle").textContent = "Goldmedal data is unavailable.";
    $("#goldmedal-table-wrap").innerHTML = '<div class="sales-empty">Goldmedal data could not be loaded.</div>';
    return;
  }

  const today = localDateKey();
  const monthPrefix = today.slice(0, 7);
  const todaySales = goldmedalSales.filter((sale) => sale.date === today);
  const monthSales = goldmedalSales.filter((sale) => sale.date?.startsWith(monthPrefix));
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const monthTotal = monthSales.reduce((sum, sale) => sum + sale.total, 0);
  const total = goldmedalSales.reduce((sum, sale) => sum + sale.total, 0);

  $("#goldmedal-today").textContent = formatCurrency(todayTotal);
  $("#goldmedal-today-count").textContent = `${todaySales.length} ${todaySales.length === 1 ? "bill" : "bills"}`;
  $("#goldmedal-month").textContent = formatCurrency(monthTotal);
  $("#goldmedal-month-count").textContent = `${monthSales.length} ${monthSales.length === 1 ? "bill" : "bills"}`;
  $("#goldmedal-total").textContent = formatCurrency(total);
  $("#goldmedal-total-count").textContent = `${goldmedalSales.length} ${goldmedalSales.length === 1 ? "bill" : "bills"}`;

  const dateFilter = $("#goldmedal-date-filter").value;
  const search = $("#goldmedal-search-input").value.trim().toLowerCase();
  let filtered = dateFilter
    ? goldmedalSales.filter((sale) => sale.date === dateFilter)
    : goldmedalSales;
  if (search) {
    filtered = filtered.filter((sale) =>
      `${sale.id} ${sale.remarks} ${sale.total}`.toLowerCase().includes(search),
    );
  }

  const filterParts = [];
  if (dateFilter) filterParts.push(`for ${formatDate(dateFilter)}`);
  if (search) filterParts.push(`matching "${$("#goldmedal-search-input").value.trim()}"`);
  $("#goldmedal-list-subtitle").textContent = filterParts.length
    ? `Showing ${filtered.length} ${filtered.length === 1 ? "bill" : "bills"} ${filterParts.join(" ")}`
    : `${goldmedalSales.length} ${goldmedalSales.length === 1 ? "bill" : "bills"} recorded`;

  const container = $("#goldmedal-table-wrap");
  if (!filtered.length) {
    container.innerHTML = '<div class="sales-empty">No Goldmedal bills found.</div>';
    return;
  }
  container.innerHTML = `
    <table class="sales-table expense-table">
      <thead><tr><th>Bill</th><th>Date</th><th>Time</th><th>Remarks</th><th>Amount</th><th>Action</th></tr></thead>
      <tbody>${filtered.map((sale) => `
        <tr>
          <td>${escapeHTML(sale.id)}</td>
          <td>${formatDate(sale.date)}</td>
          <td>${formatTime(sale.time)}</td>
          <td>${escapeHTML(sale.remarks || "—")}</td>
          <td class="table-amount">${formatCurrency(sale.total)}</td>
          <td><button class="button button-danger delete-goldmedal-button" type="button" data-delete-goldmedal="${escapeHTML(sale.firestoreId)}" aria-label="Delete Goldmedal bill ${escapeHTML(sale.id)}">Delete</button></td>
        </tr>
      `).join("")}</tbody>
    </table>`;
}

function renderGoldmedalReports() {
  if (dataLoadErrors.has("goldmedal_sales")) {
    $("#goldmedal-daily-report-date").textContent = "Goldmedal data is unavailable.";
    $("#goldmedal-daily-total").textContent = "—";
    $("#goldmedal-daily-bills").textContent = "—";
    const chart = $("#goldmedal-sales-chart");
    window.echarts?.getInstanceByDom(chart)?.dispose();
    chart.innerHTML = '<div class="sales-empty">Goldmedal chart is unavailable until the data can be loaded.</div>';
    return;
  }

  const selectedDate = $("#goldmedal-daily-date").value;
  const endDate = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date();
  const daySales = goldmedalSales.filter((sale) => sale.date === selectedDate);
  const dailyTotal = daySales.reduce((sum, sale) => sum + sale.total, 0);

  if (!selectedDate) {
    $("#goldmedal-daily-report-date").textContent = "Choose a date to view its report.";
    $("#goldmedal-daily-total").textContent = "—";
    $("#goldmedal-daily-bills").textContent = "—";
  } else {
    $("#goldmedal-daily-report-date").textContent = `Daily report for ${formatDate(selectedDate)}`;
    $("#goldmedal-daily-total").textContent = formatCurrency(dailyTotal);
    $("#goldmedal-daily-bills").textContent = String(daySales.length);
  }

  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - offset);
    const key = localDateKey(date);
    const records = goldmedalSales.filter((sale) => sale.date === key);
    days.push({
      key,
      date,
      total: records.reduce((sum, sale) => sum + sale.total, 0),
      bills: records.length,
    });
  }

  $("#goldmedal-chart-period").textContent =
    `Daily totals from ${formatDate(days[0].key)} to ${formatDate(days[days.length - 1].key)}`;
  const chart = $("#goldmedal-sales-chart");
  chart.setAttribute("aria-label", days.map((day) =>
    `${formatDate(day.key)}: ${formatCurrency(day.total)}, ${day.bills} bills`,
  ).join(". "));

  if (!window.echarts) {
    chart.innerHTML = '<div class="sales-empty">Sales chart could not be loaded. Please refresh the page.</div>';
    return;
  }

  chart.querySelector(".sales-empty")?.remove();
  const shortCurrency = new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const instance = echarts.getInstanceByDom(chart) || echarts.init(chart, null, { renderer: "canvas" });
  instance.setOption({
    animationDuration: 650,
    animationEasing: "cubicOut",
    textStyle: { fontFamily: "DM Sans, sans-serif", color: "#798392" },
    grid: { top: 46, right: 12, bottom: 48, left: 48 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter(params) {
        const day = days[params[0].dataIndex];
        return `<b>${formatDate(day.key)}</b><br/>Goldmedal sales: ${formatCurrency(day.total)}<br/>${day.bills} ${day.bills === 1 ? "bill" : "bills"}`;
      },
    },
    xAxis: {
      type: "category",
      data: days.map((day) => new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(day.date)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#e7ebf2" } },
      axisLabel: {
        margin: 12,
        color: "#687080",
        fontSize: 11,
        formatter(value, index) {
          const dateLabel = new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            month: "short",
          }).format(days[index].date);
          return `${value}\n${dateLabel}`;
        },
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: Math.max(1, ...days.map((day) => day.total)),
      splitNumber: 4,
      axisLabel: {
        formatter(value) {
          return value === 0 ? "₹0" : `₹${shortCurrency.format(value)}`;
        },
      },
      splitLine: { lineStyle: { color: "#edf0f4", type: "dashed" } },
    },
    series: [{
      name: "Goldmedal sales",
      type: "bar",
      barMaxWidth: 42,
      data: days.map((day, index) => ({
        value: day.total,
        itemStyle: {
          borderRadius: [8, 8, 3, 3],
          color: index === days.length - 1 ? "#5274a8" : "#6688b3",
        },
      })),
    }],
  }, true);
}

function confirmExpenseDeletion(expense) {
  const dialog = $("#delete-expense-dialog");
  $("#delete-expense-dialog-message").textContent =
    `Permanently delete the ${escapeHTML(expense.category)} expense for ${formatCurrency(expense.amount)}?`;
  dialog.returnValue = "";

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
}

function confirmBillDeletion(sale, projectLabel) {
  const dialog = $("#delete-bill-dialog");
  $("#delete-bill-dialog-message").textContent =
    `Do you want to delete ${sale.id} for ${formatCurrency(sale.total)} from ${projectLabel}?`;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
}

function confirmGoldmedalDeletion(sale) {
  const dialog = $("#delete-goldmedal-dialog");
  $("#delete-goldmedal-dialog-message").textContent =
    `Do you want to delete ${sale.id} for ${formatCurrency(sale.total)}?`;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
}

function confirmDeletePassword() {
  const dialog = $("#delete-password-dialog");
  const form = $("#delete-password-form");
  const input = $("#delete-password-input");
  const error = $("#delete-password-error");
  form.reset();
  error.textContent = "";
  dialog.returnValue = "";
  return new Promise((resolve) => {
    const handleSubmit = (event) => {
      event.preventDefault();
      if (input.value !== DELETE_PASSWORD) {
        error.textContent = "Incorrect password. Please try again.";
        input.focus();
        return;
      }
      dialog.close("verified");
    };
    form.addEventListener("submit", handleSubmit);
    dialog.addEventListener("close", () => {
      form.removeEventListener("submit", handleSubmit);
      resolve(dialog.returnValue === "verified");
    }, { once: true });
    dialog.showModal();
  });
}

async function deleteSale(sale, button) {
  if (!await confirmBillDeletion(sale, "99 Mall")) return;
  if (!await confirmDeletePassword()) return;
  const status = $("#delete-bill-message");
  button.disabled = true;
  status.textContent = "";
  status.classList.remove("success");
  try {
    await deleteDoc(doc(db, "sales", sale.firestoreId));
    sales = sales.filter((item) => item.firestoreId !== sale.firestoreId);
    updateDashboard();
    status.textContent = `${sale.id} deleted.`;
    status.classList.add("success");
  } catch (error) {
    console.error("Could not delete bill:", error);
    status.textContent = firestoreActionError(`Could not delete ${sale.id}`, error);
  } finally {
    button.disabled = false;
  }
}

async function deleteGoldmedalSale(sale, button) {
  if (!await confirmGoldmedalDeletion(sale)) return;
  if (!await confirmDeletePassword()) return;
  button.disabled = true;
  try {
    await deleteDoc(doc(db, "goldmedal_sales", sale.firestoreId));
    goldmedalSales = goldmedalSales.filter((item) => item.firestoreId !== sale.firestoreId);
    renderGoldmedalSales();
    renderGoldmedalReports();
    $("#goldmedal-message").textContent = `${sale.id} deleted.`;
  } catch (error) {
    console.error("Could not delete Goldmedal bill:", error);
    $("#goldmedal-message").textContent = firestoreActionError("Could not delete bill", error);
    $("#goldmedal-message").classList.add("error");
  } finally {
    button.disabled = false;
  }
}

async function deleteExpense(expense, button) {
  const confirmed = await confirmExpenseDeletion(expense);
  if (!confirmed) return;
  button.disabled = true;
  try {
    await deleteDoc(doc(db, "expenses", expense.firestoreId));
    expenses = expenses.filter((item) => item.firestoreId !== expense.firestoreId);
    renderExpenses();
  } catch (error) {
    console.error("Could not delete expense:", error);
    $("#expense-message").textContent = firestoreActionError("Could not delete expense", error);
    $("#expense-message").classList.add("error");
  } finally {
    button.disabled = false;
  }
}

function showPrintReceipt(sale) {
    $("#receipt-bill-number").textContent = sale.id;
    $("#receipt-date-time").textContent = `${formatDate(sale.date)} · ${formatTime(sale.time)}`;
    $("#receipt-description").textContent = sale.manualAmount
      ? "Manual amount"
      : `99 Mall item × ${sale.quantity}`;
    $("#receipt-remarks").textContent = sale.remarks || "";
    $("#receipt-remarks-row").classList.toggle("hidden", !sale.remarks);
    $("#receipt-total").textContent = formatCurrency(sale.total);
    $("#receipt-grand-total").textContent = formatCurrency(sale.total);
    $("#print-receipt").classList.remove("hidden");
    $("#print-bill-button").classList.remove("hidden");
}

function showProfileDialog() {
  $("#profile-name").textContent = account?.name || "My store";
  $("#profile-email").textContent = account?.email || "No email address";
  $("#store-name-input").value = account?.name || "My store";
  $("#store-name-form").classList.add("hidden");
  $("#profile-edit-name-button").classList.remove("hidden");
  const message = $("#profile-message");
  message.textContent = "";
  message.classList.remove("error", "success");
  $("#profile-reset-button").disabled = !account?.email;
  $("#profile-dialog").showModal();
}

async function saveStoreName(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#store-name-input").value.trim();
  const button = $("#save-store-name-button");
  const message = $("#profile-message");
  message.textContent = "";
  message.classList.remove("error", "success");

  if (!name || name.length > 60) {
    message.textContent = "Enter a store name between 1 and 60 characters.";
    message.classList.add("error");
    return;
  }
  if (!auth.currentUser) {
    message.textContent = "Sign in again before changing your store name.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  try {
    await updateProfile(auth.currentUser, { displayName: name });
    account.name = name;
    $("#store-name").textContent = name;
    $("#profile-name").textContent = name;
    $("#profile-avatar").textContent = name.slice(0, 1).toUpperCase();
    $("#dashboard-greeting").textContent = `Welcome back, ${name}.`;
    form.classList.add("hidden");
    $("#profile-edit-name-button").classList.remove("hidden");
    message.textContent = "Store name updated.";
    message.classList.add("success");
  } catch (error) {
    console.error("Could not update store name:", error);
    message.textContent = "Could not update the store name. Please try again.";
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
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

function setPage(page, { updateHistory = true } = {}) {
  if (!PROJECTS[activeProject].pages.includes(page)) {
    page = PROJECTS[activeProject].defaultPage;
  }
  if (updateHistory && page !== currentPage) {
    pageHistoryIndex += 1;
    window.history.pushState(
      {
        ...(window.history.state || {}),
        appPage: page,
        appProject: activeProject,
        appHistoryIndex: pageHistoryIndex,
      },
      "",
      window.location.href,
    );
  }
  currentPage = page;
  if (page === "billing") {
    $("#item-quantity").value = "1";
    document.querySelector('input[name="billing-mode"][value="standard"]').checked = true;
    $("#manual-amount").value = "";
    $("#manual-remarks").value = "";
    $("#billing-expense-amount").value = "";
    $("#billing-expense-category").value = "";
    $("#billing-expense-description").value = "";
    $("#billing-goldmedal-amount").value = "";
    $("#billing-goldmedal-remarks").value = "";
    updateBillingModeUI();
    $("#bill-message").textContent = "";
    $("#bill-message").classList.remove("error");
    $("#print-receipt").classList.add("hidden");
    billPendingSave = true;
    $("#print-bill-button").textContent = "Save & Print";
    const bill = updateBillTotal();
    $("#print-bill-button").disabled = bill === null;
  }
  if (page === "goldmedal") {
    const selectedDate = $("#goldmedal-daily-date").value || localDateKey();
    $("#goldmedal-daily-date").value = selectedDate;
    $("#goldmedal-date-filter").value = selectedDate;
  }
  document.querySelectorAll(".page-section").forEach((section) => section.classList.add("hidden"));
  $(`#${page}-page`).classList.remove("hidden");
  if (page === "goldmedal") renderGoldmedalReports();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  $("#page-breadcrumb").textContent =
    page === "sales" ? "Sales & reports"
      : page === "expenses" ? "Misc. expenses"
        : page === "goldmedal" ? "Goldmedal"
          : page === "billing" ? "New bill" : "Overview";
  $("#back-button").disabled = false;
  updateDashboard();
  renderExpenses();
  renderGoldmedalSales();
  queueChartResize();
  if (page === "billing" && window.matchMedia("(max-width: 680px)").matches) {
    $("#bill-builder").scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    return;
  }
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

function setProject(project, page) {
  if (!Object.hasOwn(PROJECTS, project)) return;
  if (project === activeProject) {
    if (page) setPage(page);
    return;
  }
  if (
    activeProject === "99mall"
    && currentPage === "billing"
    && billPendingSave
    && (
      Number($("#item-quantity").value) !== 1
      || $("#manual-amount").value.trim()
      || $("#manual-remarks").value.trim()
    )
    && !window.confirm("Switch projects and discard the unsaved 99 Mall bill?")
  ) {
    $("#project-switcher").value = activeProject;
    return;
  }

  activeProject = project;
  persistProject(project);
  updateProjectUI();
  pageHistoryIndex += 1;
  window.history.pushState(
    {
      ...(window.history.state || {}),
      appPage: page || PROJECTS[project].defaultPage,
      appProject: project,
      appHistoryIndex: pageHistoryIndex,
    },
    "",
    window.location.href,
  );
  setPage(page || PROJECTS[project].defaultPage, { updateHistory: false });
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
  updateProjectUI();
  $("#profile-avatar").textContent = (account.name || "S").slice(0, 1).toUpperCase();
  $("#dashboard-greeting").textContent = `Welcome back, ${account.name}.`;
  $("#header-date").textContent = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short", day: "numeric", month: "short",
  });
  currentPage = PROJECTS[activeProject].defaultPage;
  pageHistoryIndex = 0;
  window.history.replaceState(
    {
      ...(window.history.state || {}),
      appPage: currentPage,
      appProject: activeProject,
      appHistoryIndex: pageHistoryIndex,
    },
    "",
    window.location.href,
  );

  // Render the checkout immediately; Firestore requests must not block login.
  setPage(currentPage, { updateHistory: false });

  const loadData = activeProject === "aimur-goldmedal"
    ? [loadGoldmedalSales()]
    : [loadSales(), loadExpenses()];

  ensureBillNumberMigration()
    .then(() => clearDataLoadError("bill_counters"))
    .catch((error) => {
      console.error("Could not migrate bills to sequential numbering:", error);
      setDataLoadError("bill_counters", error);
    });

  await Promise.allSettled(loadData);
  updateDashboard();
  renderExpenses();
  renderGoldmedalSales();
  queueChartResize();
}

window.addEventListener("popstate", (event) => {
  const { appPage, appHistoryIndex } = event.state || {};
  if (!["billing", "sales", "expenses", "goldmedal"].includes(appPage)) return;
  if (Object.hasOwn(PROJECTS, event.state?.appProject)) {
    activeProject = event.state.appProject;
    persistProject(activeProject);
    updateProjectUI();
  }
  pageHistoryIndex = Number.isInteger(appHistoryIndex) ? appHistoryIndex : 0;
  if (!appScreen.classList.contains("hidden")) {
    setPage(appPage, { updateHistory: false });
  }
});

$("#project-switcher").addEventListener("change", (event) => {
  setProject(event.currentTarget.value);
});

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
  const name = String(data.get("name")).trim();
  const email = String(data.get("email")).trim();
  if (!name || name.length > 60) {
    showFormError(form, "Enter a store name between 1 and 60 characters.");
    return;
  }
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
    await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, "accounts", credential.user.uid), {
      name,
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
  const mode = $('input[name="billing-mode"]:checked').value;
  const manualMode = mode === "manual";
  const expenseMode = mode === "expense";
  const goldmedalMode = mode === "goldmedal";
  if (goldmedalMode) {
    const parsedAmount = Number($("#billing-goldmedal-amount").value);
    const remarks = $("#billing-goldmedal-remarks").value.trim();
    const validAmount = $("#billing-goldmedal-amount").value.trim() !== ""
      && Number.isSafeInteger(parsedAmount)
      && parsedAmount > 0;
    $("#save-bill").disabled = !(validAmount && remarks.length > 0 && remarks.length <= 300);
    $("#print-bill-button").disabled = true;
    $("#bill-total").textContent = validAmount ? formatCurrency(parsedAmount) : "—";
    return null;
  }
  if (expenseMode) {
    const parsedAmount = Number($("#billing-expense-amount").value);
    const validAmount = $("#billing-expense-amount").value.trim() !== ""
      && Number.isSafeInteger(parsedAmount)
      && parsedAmount > 0;
    const validCategory = Boolean($("#billing-expense-category").value);
    $("#save-bill").disabled = !(validAmount && validCategory);
    $("#print-bill-button").disabled = true;
    $("#bill-total").textContent = validAmount ? formatCurrency(parsedAmount) : "—";
    return null;
  }
  const field = manualMode ? $("#manual-amount") : $("#item-quantity");
  const parsed = Number(field.value);
  const quantity = manualMode ? 1 : parsed;
  const total = manualMode ? parsed : parsed * PRICE_PER_ITEM;
  const remarks = manualMode ? $("#manual-remarks").value.trim() : "";
  const isValid = field.value.trim() !== ""
    && Number.isSafeInteger(parsed)
    && parsed > 0
    && Number.isSafeInteger(total)
    && (!manualMode || (remarks.length > 0 && remarks.length <= 300));
  $("#save-bill").disabled = !isValid;
  $("#print-bill-button").disabled = !isValid;
  $("#bill-total").textContent = isValid ? formatCurrency(total) : "—";
  return isValid ? { quantity, total, manualAmount: manualMode, remarks } : null;
}

function getManualBillingMode() {
  return $('input[name="billing-mode"]:checked').value === "manual";
}

function updateBillingModeUI() {
  const mode = $('input[name="billing-mode"]:checked').value;
  const manualMode = mode === "manual";
  const expenseMode = mode === "expense";
  const goldmedalMode = mode === "goldmedal";
  $("#quantity-entry").classList.toggle("hidden", manualMode);
  $("#manual-amount-entry").classList.toggle("hidden", !manualMode);
  $("#quantity-entry").classList.toggle("hidden", manualMode || expenseMode || goldmedalMode);
  $("#billing-expense-entry").classList.toggle("hidden", !expenseMode);
  $("#billing-goldmedal-entry").classList.toggle("hidden", !goldmedalMode);
  $("#fixed-price").innerHTML = goldmedalMode
    ? "Goldmedal"
    : expenseMode
    ? "Outgoing"
    : manualMode ? "Custom <small>amount</small>" : "₹99 <small>/ item</small>";
  $("#product-thumbnail").textContent = goldmedalMode || expenseMode || manualMode ? "₹" : "99";
  $("#product-name").textContent = goldmedalMode
    ? "Goldmedal Electrical"
    : expenseMode ? "Miscellaneous expense" : manualMode ? "Manual bill" : "99 Mall item";
  $("#product-description").textContent = goldmedalMode
    ? "Goldmedal bill · remarks required"
    : expenseMode
    ? "Expense total · category required"
    : manualMode ? "Custom total · remarks required" : "Standard price · ₹99 each";
  $("#product-price").textContent = goldmedalMode ? "Goldmedal" : expenseMode ? "Expense" : manualMode ? "Custom" : "₹99";
  $("#save-bill").innerHTML = goldmedalMode
    ? 'Save bill <span>→</span>'
    : expenseMode ? 'Save expense <span>→</span>' : 'Save bill <span>→</span>';
  $("#print-bill-button").classList.toggle("hidden", expenseMode || goldmedalMode);
}

async function loadSales() {
  try {
    const snapshot = await getDocs(collection(db, "sales"));
    sales = snapshot.docs.map((saleDoc) => {
      const data = saleDoc.data();
      const millis = createdAtMillis(data.createdAt);
      const createdDate = millis ? new Date(millis) : null;
      const timeParts = createdDate
        ? Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).formatToParts(createdDate).map((part) => [part.type, part.value]))
        : null;
      return {
        ...data,
        firestoreId: saleDoc.id,
        id: data.id || saleDoc.id,
        date: createdDate ? localDateKey(createdDate) : data.date,
        time: timeParts ? `${timeParts.hour}:${timeParts.minute}` : data.time,
      };
    }).sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
    clearDataLoadError("sales");
  } catch (error) {
    console.error("Could not load sales:", error);
    sales = [];
    setDataLoadError("sales", error);
  }
}

async function loadExpenses() {
  try {
    const snapshot = await getDocs(collection(db, "expenses"));
    expenses = snapshot.docs.map((expenseDoc) => {
      const data = expenseDoc.data();
      const millis = createdAtMillis(data.createdAt);
      const createdDate = millis ? new Date(millis) : null;
      return {
        ...data,
        firestoreId: expenseDoc.id,
        date: createdDate ? localDateKey(createdDate) : data.date,
      };
    }).sort((a, b) => {
      if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
      return createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt);
    });
    clearDataLoadError("expenses");
  } catch (error) {
    console.error("Could not load expenses:", error);
    expenses = [];
    setDataLoadError("expenses", error);
  }
}

async function loadGoldmedalSales() {
  try {
    const snapshot = await getDocs(collection(db, "goldmedal_sales"));
    goldmedalSales = snapshot.docs.map((saleDoc) => {
      const data = saleDoc.data();
      const millis = createdAtMillis(data.createdAt);
      const createdDate = millis ? new Date(millis) : null;
      return {
        ...data,
        firestoreId: saleDoc.id,
        id: data.id || saleDoc.id,
        date: createdDate ? localDateKey(createdDate) : data.date,
      };
    }).sort((a, b) => {
      if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
      return createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt);
    });
    clearDataLoadError("goldmedal_sales");
  } catch (error) {
    console.error("Could not load Goldmedal sales:", error);
    goldmedalSales = [];
    setDataLoadError("goldmedal_sales", error);
  }
}

async function saveGoldmedalBill(event) {
  event.preventDefault();
  const amount = Number($("#goldmedal-amount").value);
  const remarks = $("#goldmedal-remarks").value.trim();
  const button = $("#save-goldmedal-button");
  const message = $("#goldmedal-message");
  message.textContent = "";
  message.classList.remove("error");

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    message.textContent = "Enter a whole bill amount greater than zero.";
    message.classList.add("error");
    return;
  }
  if (!remarks) {
    message.textContent = "Enter remarks for this bill.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  try {
    const now = new Date();
    const date = localDateKey(now);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    await saveNumberedRecord("goldmedal", {
      total: amount,
      date,
      time,
      remarks,
    });
    $("#goldmedal-form").reset();
    await loadGoldmedalSales();
    renderGoldmedalSales();
    renderGoldmedalReports();
    message.textContent = `Goldmedal bill saved for ${formatCurrency(amount)}.`;
  } catch (error) {
    console.error("Could not save Goldmedal bill:", error);
    message.textContent = firestoreActionError("Could not save Goldmedal bill", error);
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
}

async function saveBillingGoldmedal() {
  const amount = Number($("#billing-goldmedal-amount").value);
  const remarks = $("#billing-goldmedal-remarks").value.trim();
  const button = $("#save-bill");
  const message = $("#bill-message");
  message.textContent = "";
  message.classList.remove("error");

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    message.textContent = "Enter a whole Goldmedal bill amount greater than zero.";
    message.classList.add("error");
    return;
  }
  if (!remarks) {
    message.textContent = "Enter remarks for this Goldmedal bill.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  try {
    const now = new Date();
    await saveNumberedRecord("goldmedal", {
      quantity: 1,
      unitPrice: amount,
      remarks,
      total: amount,
      date: localDateKey(now),
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    });
    $("#billing-goldmedal-amount").value = "";
    $("#billing-goldmedal-remarks").value = "";
    await loadGoldmedalSales();
    renderGoldmedalSales();
    renderGoldmedalReports();
    updateBillTotal();
    message.textContent = `Goldmedal bill saved for ${formatCurrency(amount)}.`;
  } catch (error) {
    console.error("Could not save inline Goldmedal bill:", error);
    message.textContent = firestoreActionError("Could not save Goldmedal bill", error);
    message.classList.add("error");
  } finally {
    updateBillTotal();
  }
}

async function saveBillingExpense() {
  const amount = Number($("#billing-expense-amount").value);
  const category = $("#billing-expense-category").value;
  const description = $("#billing-expense-description").value.trim();
  const button = $("#save-bill");
  const message = $("#bill-message");
  message.textContent = "";
  message.classList.remove("error");

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    message.textContent = "Enter a whole expense amount greater than zero.";
    message.classList.add("error");
    return;
  }
  if (!category) {
    message.textContent = "Choose an expense category.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  try {
    await saveNumberedRecord("expense", {
      amount,
      category,
      date: localDateKey(),
      description,
    });
    $("#billing-expense-amount").value = "";
    $("#billing-expense-category").value = "";
    $("#billing-expense-description").value = "";
    await loadExpenses();
    renderExpenses();
    updateBillTotal();
    message.textContent = `Expense saved for ${formatCurrency(amount)}.`;
  } catch (error) {
    console.error("Could not save inline expense:", error);
    message.textContent = firestoreActionError("Could not save expense", error);
    message.classList.add("error");
  } finally {
    updateBillTotal();
  }
}

async function saveExpense(event) {
  event.preventDefault();
  const amount = Number($("#expense-amount").value);
  const category = $("#expense-category").value;
  const date = localDateKey();
  const description = $("#expense-description").value.trim();
  const button = $("#save-expense-button");
  const message = $("#expense-message");
  message.textContent = "";
  message.classList.remove("error");

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    message.textContent = "Enter a whole expense amount greater than zero.";
    message.classList.add("error");
    return;
  }
  if (!category) {
    message.textContent = "Choose a category.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  try {
    await saveNumberedRecord("expense", {
      amount,
      category,
      date,
      description,
    });
    $("#expense-form").reset();
    await loadExpenses();
    renderExpenses();
    message.textContent = `Expense saved for ${formatCurrency(amount)}.`;
  } catch (error) {
    console.error("Could not save expense:", error);
    message.textContent = firestoreActionError("Could not save expense", error);
    message.classList.add("error");
  } finally {
    button.disabled = false;
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
    const manualMode = document.querySelector('input[name="billing-mode"]:checked').value === "manual";
    const parsedAmount = Number($("#manual-amount").value);
    const validAmount = $("#manual-amount").value.trim() !== ""
      && Number.isSafeInteger(parsedAmount)
      && parsedAmount > 0;
    message.textContent = manualMode
      ? validAmount ? "Add a reason in Remarks for this manual bill." : "Enter a whole amount greater than zero."
      : "Enter a whole number of items greater than zero.";
    message.classList.add("error");
    return;
  }
  const { quantity, total, manualAmount, remarks } = bill;
  button.disabled = true;
  printButton.disabled = true;
  try {
    const now = new Date();
    const date = localDateKey(now);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const type = manualAmount ? "manual" : "standard";
    const sale = await saveNumberedRecord(type, {
      quantity,
      unitPrice: manualAmount ? total : PRICE_PER_ITEM,
      manualAmount,
      ...(manualAmount ? { remarks } : {}),
      total,
      date,
      time,
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
    message.textContent = firestoreActionError("Could not save bill", error);
    message.classList.add("error");
  } finally {
    if (billPendingSave) updateBillTotal();
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-auth-view], [data-go], [data-page], [data-sales-date], [data-delete-sale], [data-delete-expense], [data-delete-goldmedal]");
  if (!target) return;
  if (target.dataset.deleteGoldmedal) {
    const sale = goldmedalSales.find((item) => item.firestoreId === target.dataset.deleteGoldmedal);
    if (sale) deleteGoldmedalSale(sale, target);
  } else if (target.dataset.deleteExpense) {
    const expense = expenses.find((item) => item.firestoreId === target.dataset.deleteExpense);
    if (expense) deleteExpense(expense, target);
  } else if (target.dataset.deleteSale) {
    const sale = sales.find((item) => item.firestoreId === target.dataset.deleteSale);
    if (sale) deleteSale(sale, target);
  } else if (target.dataset.authView) {
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
      $("#bill-search-input").value = "";
    }
    refreshDateReport();
  } else if (target.dataset.go) {
    setPage(target.dataset.go);
  } else if (target.dataset.page) {
    event.preventDefault();
    if (target.dataset.project) {
      setProject(target.dataset.project, target.dataset.page);
    } else {
      setPage(target.dataset.page);
    }
  }
});

$("#back-button").addEventListener("click", () => {
  if (pageHistoryIndex > 0) {
    window.history.back();
    return;
  }
  if (currentPage === "billing") {
    setPage("sales");
  } else if (currentPage === "sales") {
    setPage("billing");
  } else if (activeProject === "aimur-goldmedal" || currentPage === "goldmedal") {
    setProject("99mall", "billing");
  } else {
    setPage("billing");
  }
});

forms.setup.addEventListener("submit", handleSetup);
forms.login.addEventListener("submit", handleLogin);
forms.reset.addEventListener("submit", handlePasswordReset);
$("#profile-avatar").addEventListener("click", showProfileDialog);
$("#profile-reset-button").addEventListener("click", sendAccountPasswordReset);
$("#profile-edit-name-button").addEventListener("click", () => {
  $("#profile-message").textContent = "";
  $("#profile-message").classList.remove("error", "success");
  $("#profile-edit-name-button").classList.add("hidden");
  $("#store-name-form").classList.remove("hidden");
  $("#store-name-input").focus();
});
$("#cancel-store-name-button").addEventListener("click", () => {
  $("#store-name-input").value = account?.name || "My store";
  $("#store-name-form").classList.add("hidden");
  $("#profile-edit-name-button").classList.remove("hidden");
});
$("#store-name-form").addEventListener("submit", saveStoreName);
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
    expenses = [];
    goldmedalSales = [];
    clearAllDataLoadErrors();
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
$("#manual-remarks").addEventListener("input", () => {
  billPendingSave = true;
  $("#print-bill-button").textContent = "Save & Print";
  updateBillTotal();
});
["#billing-expense-amount", "#billing-expense-category", "#billing-expense-description"].forEach((selector) => {
  $(selector).addEventListener("input", updateBillTotal);
  $(selector).addEventListener("change", updateBillTotal);
});
["#billing-goldmedal-amount", "#billing-goldmedal-remarks"].forEach((selector) => {
  $(selector).addEventListener("input", updateBillTotal);
  $(selector).addEventListener("change", updateBillTotal);
});
document.querySelectorAll('input[name="billing-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    updateBillingModeUI();
    billPendingSave = true;
    $("#print-bill-button").textContent = "Save & Print";
    updateBillTotal();
  });
});
$("#quantity-minus").addEventListener("click", () => adjustQuantity("item-quantity", -1));
$("#quantity-plus").addEventListener("click", () => adjustQuantity("item-quantity", 1));

$("#save-bill").addEventListener("click", () => {
  const mode = $('input[name="billing-mode"]:checked').value;
  if (mode === "goldmedal") {
    saveBillingGoldmedal();
    return;
  }
  if (mode === "expense") {
    saveBillingExpense();
    return;
  }
  createBill({
    inputId: "item-quantity",
    totalId: "bill-total",
    buttonId: "save-bill",
    messageId: "bill-message",
    showSavedDialog: true,
  });
});
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
$("#bill-search-input").addEventListener("input", refreshDateReport);
$("#sales-category-filter").addEventListener("change", updateDashboard);
async function refreshLiveSalesReport() {
  if (appScreen.classList.contains("hidden")) return;
  await loadSales();
  await loadExpenses();
  await loadGoldmedalSales();
  updateDashboard();
  renderExpenses();
  renderGoldmedalSales();
}
window.addEventListener("focus", refreshLiveSalesReport);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshLiveSalesReport();
});
window.setInterval(refreshLiveSalesReport, 60000);
$("#delete-password-cancel").addEventListener("click", () => {
  $("#delete-password-dialog").close("cancel");
});
$("#daily-report-day-select").addEventListener("change", (event) => {
  $("#sales-date-filter").value = event.currentTarget.value;
  refreshDateReport();
});
$("#expense-form").addEventListener("submit", saveExpense);
$("#expense-search-input").addEventListener("input", renderExpenses);
$("#expense-date-filter").addEventListener("input", renderExpenses);
$("#goldmedal-form").addEventListener("submit", saveGoldmedalBill);
$("#goldmedal-search-input").addEventListener("input", renderGoldmedalSales);
$("#goldmedal-date-filter").addEventListener("input", (event) => {
  setGoldmedalReportDate(event.currentTarget.value);
});
$("#goldmedal-daily-date").addEventListener("input", (event) => {
  setGoldmedalReportDate(event.currentTarget.value);
});
$("#clear-goldmedal-filter").addEventListener("click", () => {
  $("#goldmedal-search-input").value = "";
  setGoldmedalReportDate("");
});
document.querySelectorAll("[data-goldmedal-date]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.goldmedalDate === "today") {
      setGoldmedalReportDate(localDateKey());
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      setGoldmedalReportDate(localDateKey(yesterday));
    }
  });
});
$("#clear-expense-filter").addEventListener("click", () => {
  $("#expense-date-filter").value = "";
  $("#expense-search-input").value = "";
  renderExpenses();
});
let chartResizeFrame = 0;
function resizeCharts() {
  const charts = [$("#daily-sales-chart"), $("#goldmedal-sales-chart")];
  charts.forEach((chart) => {
    window.echarts?.getInstanceByDom(chart)?.resize();
  });
}

function queueChartResize() {
  window.cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = window.requestAnimationFrame(resizeCharts);
}

window.addEventListener("resize", queueChartResize, { passive: true });
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
      expenses = [];
      goldmedalSales = [];
      clearAllDataLoadErrors();
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
    expenses = [];
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    clearAllDataLoadErrors();
    showAuth("login");
  }
});
