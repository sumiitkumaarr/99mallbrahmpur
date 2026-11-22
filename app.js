const PRICE_PER_ITEM = 99;
const SHARED_STORE_ID = "99mallbrahmpur";
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
  serverTimestamp,
  setDoc,
  deleteDoc,
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
let pageHistoryIndex = 0;
let account = null;
let sales = [];
let expenses = [];
let goldmedalSales = [];
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

function salesByCategory(sales) {
  const category = $("#sales-category-filter")?.value || "all";
  if (category === "standard") return sales.filter((sale) => sale.manualAmount !== true);
  if (category === "manual") return sales.filter((sale) => sale.manualAmount === true);
  return sales;
}

function updateDashboard() {
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
  container.innerHTML = `
    <table class="sales-table">
      <thead><tr><th>Bill</th><th>Date</th><th>Time</th><th>Items</th><th>Remarks</th><th>Amount</th><th>Action</th></tr></thead>
      <tbody>${filtered.map((sale) => `
        <tr><td>${escapeHTML(sale.id)}</td><td>${formatDate(sale.date)}</td><td>${formatTime(sale.time)}</td>
        <td>${sale.quantity}</td><td>${sale.manualAmount ? escapeHTML(sale.remarks || "—") : "—"}</td>
        <td class="table-amount">${formatCurrency(sale.total)}</td>
        <td><button class="button button-danger delete-sale-button" type="button" data-delete-sale="${escapeHTML(sale.firestoreId)}" aria-label="Delete bill ${escapeHTML(sale.id)}">Delete</button></td></tr>
      `).join("")}</tbody>
    </table>`;
}

function renderDailyReport(sales) {
    const date = $("#sales-date-filter").value;
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

    if (!date) {
      label.textContent = "Choose a date to view its daily report.";
      $("#daily-report-total").textContent = "—";
      $("#daily-report-bills").textContent = "—";
      $("#daily-report-items").textContent = "—";
      return;
    }

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

function renderExpenses() {
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
      <thead><tr><th>Date</th><th>Category</th><th>Remarks</th><th>Amount</th><th>Action</th></tr></thead>
      <tbody>${filtered.map((expense) => `
        <tr>
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

function confirmBillDeletion(sale) {
  const dialog = $("#delete-bill-dialog");
  $("#delete-bill-dialog-message").textContent =
    `Permanently delete ${sale.id} for ${formatCurrency(sale.total)}? This will also update your sales reports.`;
  dialog.returnValue = "";

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    dialog.showModal();
  });
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

async function deleteSale(sale, button) {
  const status = $("#delete-bill-message");
  button.disabled = true;
  status.textContent = "";
  status.classList.remove("success");

  try {
    const confirmed = await confirmBillDeletion(sale);
    if (!confirmed) return;

    await deleteDoc(doc(db, "sales", sale.firestoreId));
    sales = sales.filter((item) => item.firestoreId !== sale.firestoreId);
    updateDashboard();
    status.textContent = `${sale.id} deleted.`;
    status.classList.add("success");
  } catch (error) {
    console.error("Could not delete bill:", error);
    status.textContent = `Could not delete ${sale.id}: ${error.message}`;
  } finally {
    button.disabled = false;
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
      $("#expense-message").textContent = `Could not delete expense: ${error.message}`;
      $("#expense-message").classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  function confirmGoldmedalDeletion(sale) {
    const dialog = $("#delete-goldmedal-dialog");
    $("#delete-goldmedal-dialog-message").textContent =
      `Permanently delete ${sale.id} for ${formatCurrency(sale.total)}?`;
    dialog.returnValue = "";
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        resolve(dialog.returnValue === "confirm");
      }, { once: true });
      dialog.showModal();
    });
  }

  async function deleteGoldmedalSale(sale, button) {
    const confirmed = await confirmGoldmedalDeletion(sale);
    if (!confirmed) return;
    button.disabled = true;
    try {
      await deleteDoc(doc(db, "goldmedal_sales", sale.firestoreId));
      goldmedalSales = goldmedalSales.filter((item) => item.firestoreId !== sale.firestoreId);
      renderGoldmedalSales();
      renderGoldmedalReports();
    } catch (error) {
      console.error("Could not delete Goldmedal bill:", error);
      $("#goldmedal-message").textContent = `Could not delete bill: ${error.message}`;
      $("#goldmedal-message").classList.add("error");
    } finally {
      button.disabled = false;
    }
  }
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

      const snapshot = await getDocs(collection(db, "sales"));
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
      $("#bill-search-input").value = "";
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
  if (updateHistory && page !== currentPage) {
    pageHistoryIndex += 1;
    window.history.pushState(
      { ...(window.history.state || {}), appPage: page, appHistoryIndex: pageHistoryIndex },
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
    $("#goldmedal-date").value ||= localDateKey();
    $("#goldmedal-daily-date").value ||= localDateKey();
    renderGoldmedalReports();
  }
  document.querySelectorAll(".page-section").forEach((section) => section.classList.add("hidden"));
  $(`#${page}-page`).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  $("#page-breadcrumb").textContent =
    page === "sales" ? "Sales & reports"
      : page === "expenses" ? "Misc. expenses"
        : page === "goldmedal" ? "Goldmedal"
          : page === "billing" ? "New bill" : "Overview";
  $("#back-button").disabled = pageHistoryIndex === 0;
  updateDashboard();
  renderExpenses();
  renderGoldmedalSales();
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
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
  $("#dashboard-greeting").textContent = `Welcome back, ${account.name}.`;
  $("#header-date").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });
  pageHistoryIndex = 0;
  window.history.replaceState(
    { ...(window.history.state || {}), appPage: currentPage, appHistoryIndex: pageHistoryIndex },
    "",
    window.location.href,
  );
  await loadSales();
  await loadExpenses();
  await loadGoldmedalSales();
  setPage(currentPage, { updateHistory: false });
}

window.addEventListener("popstate", (event) => {
  const { appPage, appHistoryIndex } = event.state || {};
  if (!["billing", "sales", "expenses", "goldmedal"].includes(appPage)) return;
  pageHistoryIndex = Number.isInteger(appHistoryIndex) ? appHistoryIndex : 0;
  if (!appScreen.classList.contains("hidden")) {
    setPage(appPage, { updateHistory: false });
  }
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
  const manualMode = getManualBillingMode();
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
  const manualMode = getManualBillingMode();
  $("#quantity-entry").classList.toggle("hidden", manualMode);
  $("#manual-amount-entry").classList.toggle("hidden", !manualMode);
  $("#fixed-price").innerHTML = manualMode ? "Custom <small>amount</small>" : "₹99 <small>/ item</small>";
  $("#product-thumbnail").textContent = manualMode ? "₹" : "99";
  $("#product-name").textContent = manualMode ? "Manual bill" : "99 Mall item";
  $("#product-description").textContent = manualMode
    ? "Custom total · remarks required"
    : "Standard price · ₹99 each";
  $("#product-price").textContent = manualMode ? "Custom" : "₹99";
}

async function loadSales() {
  try {
    const snapshot = await getDocs(collection(db, "sales"));
    const legacySales = snapshot.docs.filter(
      (saleDoc) => saleDoc.data().ownerId !== SHARED_STORE_ID,
    );
    for (let start = 0; start < legacySales.length; start += 500) {
      const batch = writeBatch(db);
      legacySales.slice(start, start + 500).forEach((saleDoc) => {
        batch.update(saleDoc.ref, { ownerId: SHARED_STORE_ID });
      });
      await batch.commit();
    }
    sales = snapshot.docs.map((saleDoc) => ({
      ...saleDoc.data(),
      firestoreId: saleDoc.id,
      id: saleDoc.data().id || saleDoc.id,
    })).sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
  } catch (error) {
    console.error("Could not load sales:", error);
    sales = [];
  }
}

async function loadExpenses() {
  try {
    const snapshot = await getDocs(collection(db, "expenses"));
    const legacyExpenses = snapshot.docs.filter(
      (expenseDoc) => expenseDoc.data().ownerId !== SHARED_STORE_ID,
    );
    for (let start = 0; start < legacyExpenses.length; start += 500) {
      const batch = writeBatch(db);
      legacyExpenses.slice(start, start + 500).forEach((expenseDoc) => {
        batch.update(expenseDoc.ref, { ownerId: SHARED_STORE_ID });
      });
      await batch.commit();
    }
    expenses = snapshot.docs.map((expenseDoc) => ({
      ...expenseDoc.data(),
      firestoreId: expenseDoc.id,
    })).sort((a, b) => {
      if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
      return createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt);
    });
  } catch (error) {
    console.error("Could not load expenses:", error);
    expenses = [];
  }
}

async function loadGoldmedalSales() {
  try {
    const snapshot = await getDocs(collection(db, "goldmedal_sales"));
    goldmedalSales = snapshot.docs.map((saleDoc) => ({
      ...saleDoc.data(),
      firestoreId: saleDoc.id,
      id: saleDoc.data().id || saleDoc.id,
    })).sort((a, b) => {
      if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
      return createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt);
    });
  } catch (error) {
    console.error("Could not load Goldmedal sales:", error);
    goldmedalSales = [];
  }
}

async function saveGoldmedalBill(event) {
  event.preventDefault();
  const amount = Number($("#goldmedal-amount").value);
  const date = $("#goldmedal-date").value;
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
  if (!date || !remarks) {
    message.textContent = "Enter a date and remarks.";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  try {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const billNumber = `GM-${now.getTime().toString().slice(-8)}`;
    await addDoc(collection(db, "goldmedal_sales"), {
      ownerId: SHARED_STORE_ID,
      id: billNumber,
      billNumber,
      total: amount,
      date,
      time,
      remarks,
      createdAt: serverTimestamp(),
    });
    $("#goldmedal-form").reset();
    $("#goldmedal-date").value = localDateKey();
    await loadGoldmedalSales();
    renderGoldmedalSales();
    renderGoldmedalReports();
    message.textContent = `Goldmedal bill saved for ${formatCurrency(amount)}.`;
  } catch (error) {
    console.error("Could not save Goldmedal bill:", error);
    message.textContent = `Could not save bill: ${error.message}`;
    message.classList.add("error");
  } finally {
    button.disabled = false;
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
    await addDoc(collection(db, "expenses"), {
      ownerId: SHARED_STORE_ID,
      amount,
      category,
      date,
      description,
      createdAt: serverTimestamp(),
    });
    $("#expense-form").reset();
    await loadExpenses();
    renderExpenses();
    message.textContent = `Expense saved for ${formatCurrency(amount)}.`;
  } catch (error) {
    console.error("Could not save expense:", error);
    message.textContent = `Could not save expense: ${error.message}`;
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
    const billNumber = `BILL-${now.getTime().toString().slice(-8)}`;
    const sale = {
      id: billNumber,
      billNumber,
      quantity,
      unitPrice: manualAmount ? total : PRICE_PER_ITEM,
      manualAmount,
      ...(manualAmount ? { remarks } : {}),
      total,
      date,
      time,
    };
    await addDoc(collection(db, "sales"), {
      ownerId: SHARED_STORE_ID,
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
    setPage(target.dataset.page);
  }
});

$("#back-button").addEventListener("click", () => {
  if (pageHistoryIndex > 0) window.history.back();
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
$("#bill-search-input").addEventListener("input", refreshDateReport);
$("#sales-category-filter").addEventListener("change", refreshDateReport);
$("#clear-sales-button").addEventListener("click", clearSalesData);
$("#daily-report-day-select").addEventListener("change", (event) => {
  $("#sales-date-filter").value = event.currentTarget.value;
  refreshDateReport();
});
$("#expense-form").addEventListener("submit", saveExpense);
$("#expense-search-input").addEventListener("input", renderExpenses);
$("#expense-date-filter").addEventListener("input", renderExpenses);
$("#goldmedal-form").addEventListener("submit", saveGoldmedalBill);
$("#goldmedal-search-input").addEventListener("input", renderGoldmedalSales);
$("#goldmedal-date-filter").addEventListener("input", renderGoldmedalSales);
$("#goldmedal-daily-date").addEventListener("input", renderGoldmedalReports);
$("#clear-goldmedal-filter").addEventListener("click", () => {
  $("#goldmedal-date-filter").value = "";
  $("#goldmedal-search-input").value = "";
  renderGoldmedalSales();
});
document.querySelectorAll("[data-goldmedal-date]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.goldmedalDate === "today") {
      $("#goldmedal-daily-date").value = localDateKey();
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      $("#goldmedal-daily-date").value = localDateKey(yesterday);
    }
    renderGoldmedalReports();
  });
});
$("#clear-expense-filter").addEventListener("click", () => {
  $("#expense-date-filter").value = "";
  $("#expense-search-input").value = "";
  renderExpenses();
});
let chartResizeFrame = 0;
window.addEventListener("resize", () => {
  window.cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = window.requestAnimationFrame(() => {
    const chart = $("#daily-sales-chart");
    const instance = window.echarts?.getInstanceByDom(chart);
    instance?.resize();
    const goldmedalChart = $("#goldmedal-sales-chart");
    window.echarts?.getInstanceByDom(goldmedalChart)?.resize();
  });
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
      expenses = [];
      goldmedalSales = [];
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
    showAuth("login");
  }
});
