# 147th Ward Private Directory

Password-gated apartment directory for **Provo YSA 147th Ward**.

Built for ward leaders (Relief Society / Elders Quorum / bishopric). Member phones, emails, and addresses are confidential — keep hosting private.

## Features

- Roster parsed from the Church Directory PDF (`10-05-26`)
- Apartment / roommate pods with search and filters
- Editable nicknames, callings, languages, status symbols, ministering assignments, and leader notes (autosave)
- Profile photo upload on each member (no social-media scraping)
- Leader PDF re-import that refreshes contact fields while preserving notes / symbols / photos / ministering
- “Last updated by … · date/time” stamp after every edit or import

## Symbol legend

| Symbol | Meaning |
|--------|---------|
| RM | Returned Missionary |
| 文 | Speaks listed language(s) |
| ★ | Has a calling |
| ● | Super-Solid (active) |
| ○ | Inactive |
| ⊘ | Do Not Contact |

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000 and sign in with the ward leader password.

## Refresh from a new Church Directory PDF

1. Sign in as a leader
2. Open **Leader tools**
3. Upload the latest PDF export

Or regenerate the baseline JSON:

```bash
pip install -r requirements.txt
python3 scripts/parse_directory_pdf.py /path/to/directory.pdf
```

## Privacy

- Do **not** publish this site publicly with live roster data
- Do **not** scrape social networks for member photos — upload consented photos only
- Edits autosave in the browser (`localStorage`); clear site data resets to `data/members.json`
