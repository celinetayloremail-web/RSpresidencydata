# 147th Orem YSA Ward Directory

A private apartment-pod directory for the **147th Orem YSA Ward** (unit 266485), maintained for Relief Society use.

Members are grouped by complex and unit so roommate pods, addresses, and profile photos stay together.

## Run locally

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000).

## Add real ward members

The Church Directory at [directory.churchofjesuschrist.org/266485](https://directory.churchofjesuschrist.org/266485) requires a signed-in Church account. This site does **not** scrape that page.

1. Copy the sample file:
   ```bash
   cp data/members.sample.json data/members.json
   ```
2. While signed in to the Church Directory, fill each apartment pod with real names, addresses, and photo URLs.
3. Reload the site. It prefers `data/members.json` when present; otherwise it shows sample placeholders.

`data/members.json` is gitignored so member PII is not committed by default. Keep this directory private — do not host it publicly with real addresses or photos.

## Data shape

```json
{
  "ward": { "name": "147th Orem YSA Ward", "unitNumber": "266485" },
  "apartments": [
    {
      "id": "campus-view-204",
      "complex": "Campus View",
      "unit": "204",
      "address": "1230 N 900 E",
      "city": "Orem, UT 84097",
      "members": [
        {
          "id": "m-001",
          "preferredName": "Celine",
          "fullName": "Celine Taylor",
          "photoUrl": "https://…",
          "phone": "",
          "email": "",
          "callings": ["Relief Society Secretary"]
        }
      ]
    }
  ]
}
```

## Features

- Hero for **147th Orem YSA** with mountain-valley atmosphere
- Search by name, calling, complex, or unit
- Filter by apartment complex
- Roommate pods with initials (or photos when `photoUrl` is set)
- Member detail dialog with address and calling
