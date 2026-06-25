/* =========================================================================
   finance.js — Finance engine for Ledger tools.
   Pure functions, no DOM, no dependencies. Works in browser + Node.
   Every horizon is computed by period-by-period simulation where it
   matters, so results are auditable and free of frequency-mismatch bugs.
   ========================================================================= */
(function (root) {
  "use strict";

  // ---- helpers -----------------------------------------------------------
  function toNum(x) {
    var n = typeof x === "number" ? x : parseFloat(x);
    return isFinite(n) ? n : 0;
  }
  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }
  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // ---- amortizing loan payment (mortgage / loan / EMI) -------------------
  // P principal, annualRatePct e.g. 6.5, years term. Monthly compounding.
  function loanPayment(P, annualRatePct, years) {
    P = toNum(P);
    var n = Math.round(toNum(years) * 12);
    var r = toNum(annualRatePct) / 100 / 12;
    if (n <= 0) return 0;
    if (r === 0) return P / n;
    var f = Math.pow(1 + r, n);
    return (P * r * f) / (f - 1);
  }

  // Full amortization schedule. extra = additional principal per month.
  // Returns { payment, totalInterest, totalPaid, months, schedule[] }.
  function amortize(P, annualRatePct, years, extra) {
    P = toNum(P);
    extra = toNum(extra);
    var r = toNum(annualRatePct) / 100 / 12;
    var basePayment = loanPayment(P, annualRatePct, years);
    var balance = P;
    var totalInterest = 0;
    var schedule = [];
    var months = 0;
    var guard = Math.round(toNum(years) * 12) + 1200; // hard safety cap
    while (balance > 0.005 && months < guard) {
      var interest = balance * r;
      var principalPart = basePayment - interest + extra;
      if (principalPart <= 0) {
        // payment can't cover interest — non-amortizing, bail out cleanly
        return {
          payment: round2(basePayment),
          totalInterest: Infinity,
          totalPaid: Infinity,
          months: Infinity,
          neverPaysOff: true,
          schedule: []
        };
      }
      if (principalPart > balance) principalPart = balance;
      var actualPay = interest + principalPart;
      balance -= principalPart;
      totalInterest += interest;
      months++;
      schedule.push({
        month: months,
        payment: round2(actualPay),
        interest: round2(interest),
        principal: round2(principalPart),
        balance: round2(Math.max(0, balance))
      });
    }
    return {
      payment: round2(basePayment),
      totalInterest: round2(totalInterest),
      totalPaid: round2(P + totalInterest),
      months: months,
      neverPaysOff: false,
      schedule: schedule
    };
  }

  // ---- generic compound-growth simulation --------------------------------
  // Month-by-month. contribution applied at end of each month.
  // annualRatePct nominal, compounded monthly.
  // Returns { futureValue, totalContributed, totalInterest, series[] }
  // series is yearly snapshots {year, balance, contributed, growth}.
  function grow(opts) {
    var principal = toNum(opts.principal);
    var monthly = toNum(opts.monthlyContribution);
    var years = toNum(opts.years);
    var r = toNum(opts.annualRatePct) / 100 / 12;
    var annualIncreasePct = toNum(opts.contributionIncreasePct) / 100; // raise contributions yearly
    var months = Math.round(years * 12);

    var balance = principal;
    var contributed = principal;
    var series = [{ year: 0, balance: round2(balance), contributed: round2(contributed), growth: 0 }];
    var thisMonthly = monthly;

    for (var m = 1; m <= months; m++) {
      balance += balance * r;          // growth on existing balance
      balance += thisMonthly;          // deposit at month end
      contributed += thisMonthly;
      if (m % 12 === 0) {
        thisMonthly *= (1 + annualIncreasePct);
        series.push({
          year: m / 12,
          balance: round2(balance),
          contributed: round2(contributed),
          growth: round2(balance - contributed)
        });
      }
    }
    // capture final partial year if any
    if (months % 12 !== 0) {
      series.push({
        year: round2(months / 12),
        balance: round2(balance),
        contributed: round2(contributed),
        growth: round2(balance - contributed)
      });
    }
    return {
      futureValue: round2(balance),
      totalContributed: round2(contributed),
      totalInterest: round2(balance - contributed),
      series: series
    };
  }

  // ---- retirement --------------------------------------------------------
  // Accumulate to retirement, then estimate sustainable income.
  function retirement(opts) {
    var currentAge = toNum(opts.currentAge);
    var retireAge = toNum(opts.retireAge);
    var years = Math.max(0, retireAge - currentAge);
    var acc = grow({
      principal: opts.currentSavings,
      monthlyContribution: opts.monthlyContribution,
      years: years,
      annualRatePct: opts.preReturnPct,
      contributionIncreasePct: opts.contributionIncreasePct
    });
    var nest = acc.futureValue;
    var withdrawalRate = toNum(opts.withdrawalRate) || 4; // % per year
    var annualIncome = nest * (withdrawalRate / 100);
    return {
      nestEgg: nest,
      totalContributed: acc.totalContributed,
      totalGrowth: acc.totalInterest,
      annualIncome: round2(annualIncome),
      monthlyIncome: round2(annualIncome / 12),
      years: years,
      series: acc.series
    };
  }

  // ---- budget 50/30/20 ---------------------------------------------------
  function budget5030(monthlyIncome) {
    var inc = toNum(monthlyIncome);
    return {
      income: round2(inc),
      needs: round2(inc * 0.5),
      wants: round2(inc * 0.3),
      savings: round2(inc * 0.2)
    };
  }

  // ---- debt payoff: snowball vs avalanche --------------------------------
  // debts: [{name, balance, ratePct, minPayment}]
  // strategy: "snowball" (lowest balance first) | "avalanche" (highest rate first)
  // extra: additional $ on top of all minimums each month.
  function debtPayoff(debts, strategy, extra) {
    extra = toNum(extra);
    // deep copy + sanitize
    var list = debts.map(function (d, i) {
      return {
        name: d.name || ("Debt " + (i + 1)),
        balance: toNum(d.balance),
        r: toNum(d.ratePct) / 100 / 12,
        min: toNum(d.minPayment),
        paidMonth: null,
        interestPaid: 0
      };
    }).filter(function (d) { return d.balance > 0; });

    function order() {
      var active = list.filter(function (d) { return d.balance > 0.005; });
      active.sort(function (a, b) {
        if (strategy === "avalanche") return b.r - a.r;
        return a.balance - b.balance; // snowball
      });
      return active;
    }

    var month = 0;
    var totalInterest = 0;
    var guard = 1200; // 100 years cap
    var series = []; // total balance per month for charting

    // feasibility: total minimums must beat total monthly interest
    function totalBalance() {
      return list.reduce(function (s, d) { return s + Math.max(0, d.balance); }, 0);
    }

    while (totalBalance() > 0.005 && month < guard) {
      month++;
      // 1. accrue interest
      for (var i = 0; i < list.length; i++) {
        if (list[i].balance > 0.005) {
          var interest = list[i].balance * list[i].r;
          list[i].balance += interest;
          list[i].interestPaid += interest;
          totalInterest += interest;
        }
      }
      // 2. budget for this month = sum of every active minimum + extra.
      //    (Freed-up minimums from cleared debts roll into the pool too,
      //     which is the whole point of snowball/avalanche acceleration.)
      var active = order();
      if (active.length === 0) break;
      var pool = extra;
      for (var k = 0; k < active.length; k++) {
        pool += active[k].min;
      }
      // 3. pay minimums first (capped to balance), then throw remainder at focus
      // Pay each active debt its minimum (capped).
      for (var a = 0; a < active.length; a++) {
        var pay = Math.min(active[a].min, active[a].balance);
        active[a].balance -= pay;
        pool -= pay;
      }
      // 4. remaining pool -> focus debts in priority order
      for (var b = 0; b < active.length && pool > 0.005; b++) {
        if (active[b].balance > 0.005) {
          var hit = Math.min(pool, active[b].balance);
          active[b].balance -= hit;
          pool -= hit;
        }
      }
      // 5. mark payoff month
      for (var c = 0; c < list.length; c++) {
        if (list[c].paidMonth === null && list[c].balance <= 0.005) {
          list[c].paidMonth = month;
          list[c].balance = 0;
        }
      }
      series.push(round2(totalBalance()));

      // feasibility check: if balance not shrinking, bail
      if (month > 1 && series[month - 1] >= series[month - 2] - 0.005) {
        // not making progress
        return {
          neverPaysOff: true,
          months: Infinity,
          totalInterest: Infinity,
          debts: list.map(function (d) { return { name: d.name, paidMonth: null }; }),
          series: series
        };
      }
    }

    return {
      neverPaysOff: false,
      months: month,
      totalInterest: round2(totalInterest),
      debts: list.map(function (d) {
        return { name: d.name, paidMonth: d.paidMonth, interestPaid: round2(d.interestPaid) };
      }),
      series: series
    };
  }

  // Compare both strategies at once.
  function debtCompare(debts, extra) {
    return {
      snowball: debtPayoff(debts, "snowball", extra),
      avalanche: debtPayoff(debts, "avalanche", extra)
    };
  }

  // ---- FIRE --------------------------------------------------------------
  // FIRE number = annualExpenses / (withdrawalRate/100).
  // Simulate years to reach it given current NW, annual savings, return.
  function fire(opts) {
    var annualExpenses = toNum(opts.annualExpenses);
    var wr = toNum(opts.withdrawalRate) || 4;
    var fireNumber = annualExpenses / (wr / 100);

    var nw = toNum(opts.currentNetWorth);
    var annualSavings = toNum(opts.annualSavings);
    var r = toNum(opts.annualReturnPct) / 100;
    var savingsGrowth = toNum(opts.savingsIncreasePct) / 100;

    var years = 0;
    var guard = 100;
    var series = [{ year: 0, balance: round2(nw) }];
    var s = annualSavings;
    while (nw < fireNumber && years < guard) {
      nw = nw * (1 + r) + s;
      s = s * (1 + savingsGrowth);
      years++;
      series.push({ year: years, balance: round2(nw) });
    }
    return {
      fireNumber: round2(fireNumber),
      reached: nw >= fireNumber,
      years: nw >= fireNumber ? years : Infinity,
      finalNetWorth: round2(nw),
      series: series
    };
  }

  // ---- Coast FIRE --------------------------------------------------------
  // Amount needed today so that, with NO further contributions, it grows
  // to the FIRE number by the target retirement age.
  function coastFire(opts) {
    var annualExpenses = toNum(opts.annualExpenses);
    var wr = toNum(opts.withdrawalRate) || 4;
    var fireNumber = annualExpenses / (wr / 100);

    var currentAge = toNum(opts.currentAge);
    var retireAge = toNum(opts.retireAge);
    var yrs = Math.max(0, retireAge - currentAge);
    // real return preferred for coast; user supplies return already net of inflation if they wish
    var r = toNum(opts.annualReturnPct) / 100;

    var coastNumber = fireNumber / Math.pow(1 + r, yrs);
    var current = toNum(opts.currentInvested);
    var alreadyCoasting = current >= coastNumber;

    // projected value of current savings if left untouched
    var projected = current * Math.pow(1 + r, yrs);

    // build a series of coast targets by age, plus projection of current savings
    var series = [];
    for (var age = currentAge; age <= retireAge; age++) {
      var yLeft = retireAge - age;
      series.push({
        age: age,
        coastTarget: round2(fireNumber / Math.pow(1 + r, yLeft)),
        projected: round2(current * Math.pow(1 + r, age - currentAge))
      });
    }

    return {
      fireNumber: round2(fireNumber),
      coastNumber: round2(coastNumber),
      alreadyCoasting: alreadyCoasting,
      shortfall: round2(Math.max(0, coastNumber - current)),
      projectedAtRetirement: round2(projected),
      years: yrs,
      series: series
    };
  }

  var api = {
    round2: round2,
    clamp: clamp,
    loanPayment: loanPayment,
    amortize: amortize,
    grow: grow,
    retirement: retirement,
    budget5030: budget5030,
    debtPayoff: debtPayoff,
    debtCompare: debtCompare,
    fire: fire,
    coastFire: coastFire
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.Finance = api;
  }
})(typeof window !== "undefined" ? window : this);
