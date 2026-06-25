# SaveSlate — Personal Finance Calculators

A fast, private, multi-tool personal-finance portal. Nine calculators, one audited
math engine, zero build step, zero dependencies. Every number is computed in the
visitor's browser — no accounts, no tracking, no server.

## The tools

| Tool | Path | Type |
|------|------|------|
| Mortgage Calculator | `/mortgage-calculator` | popular |
| Compound Interest Calculator | `/compound-interest-calculator` | popular |
| Loan / EMI Calculator | `/loan-calculator` | popular |
| Retirement Calculator | `/retirement-calculator` | popular |
| Investment (SIP / lump sum) Calculator | `/investment-calculator` | popular |
| Budget Calculator (50/30/20) | `/budget-calculator` | popular |
| Debt Payoff Calculator (snowball vs avalanche) | `/debt-payoff-calculator` | popular |
| FIRE Calculator | `/fire-calculator` | niche |
| Coast FIRE Calculator | `/coast-fire-calculator` | niche |

## Deploy to Vercel (via GitHub)

1. Create a new GitHub repository and push these files to the root.
2. In Vercel, **Add New → Project → Import** your repo.
3. Framework Preset: **Other**. Build Command: *(leave empty)*. Output Directory: *(leave empty / `./`)*.
4. **Deploy.** That's it — it's static, so there's nothing to build.

`vercel.json` enables clean URLs (so `/mortgage-calculator` serves the page without
the `.html`) and long-cache headers on `/assets`.

After deploying, replace `https://saveslate.com` in `sitemap.xml`,
`robots.txt`, and the `<link rel="canonical">` / Open Graph / Twitter tags (set in
the generator) with your real domain. This also points the social share card
(`og:image`) at the right host.

## Structure

```
/                         site root (served by Vercel)
├── index.html            homepage / tool directory
├── *-calculator.html     one page per tool (each its own SEO URL)
├── assets/
│   ├── finance.js        the math engine — pure, framework-free, unit-tested
│   ├── ui.js             currency, formatting, slider binding, SVG charts
│   ├── styles.css        the full design system
│   ├── og-image.png      1200×630 social share card (Open Graph + Twitter)
│   └── favicon.svg
├── vercel.json           clean URLs + asset caching
├── robots.txt
└── sitemap.xml
```

## Editing or adding tools

The HTML pages are generated from a small Python toolchain (kept outside this
deploy folder) so that every page shares identical header/footer/markup. The
generator files are `build.py`, `chrome.py`, `icons.py`, and the test suites
`test.js` / harness checks. To regenerate after editing: `python3 build.py`,
then copy `assets/` into the output. You can also edit the generated `.html`
directly — they are plain, readable static files.

## Notes on accuracy & compliance

- All financial math is computed by period-by-period simulation in `finance.js`
  and covered by a test suite (`test.js`) checked against known values
  (e.g. a $300k / 6% / 30-yr mortgage → $1,798.65 monthly).
- Each page includes visible methodology, an FAQ, and a disclaimer. Finance is a
  "Your Money or Your Life" (YMYL) topic under Google's quality guidelines, so the
  copy is written to be genuinely useful, sourced from first principles, and clear
  that results are educational estimates, not advice.
- FAQ and WebApplication structured data (JSON-LD) is embedded on every tool page
  for rich-result eligibility.

## License

Your project — use it however you like.
