<div align="center">

<a href="https://github.com/shaongitbd/doory"><img src=".github/readme/banner.webp" alt="Doory, the open-source Canva alternative" width="100%" /></a>

<br />

[![License: Attribution Assurance](https://img.shields.io/badge/license-Attribution%20Assurance-c9bcff?style=for-the-badge)](LICENSE)
[![Self-host with Docker](https://img.shields.io/badge/self--host-Docker-2b1c17?style=for-the-badge&logo=docker&logoColor=white)](#-self-host-it-in-3-commands)
[![React 19](https://img.shields.io/badge/React-19-2b1c17?style=for-the-badge&logo=react&logoColor=61dafb)](frontend/package.json)
[![Django 5](https://img.shields.io/badge/Django-5-2b1c17?style=for-the-badge&logo=django&logoColor=white)](backend/requirements.txt)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-ffa9b9?style=for-the-badge)](#-contributing)

**[See it in action](#-see-it-in-action)** &nbsp;·&nbsp;
**[Features](#-everything-you-need-to-design)** &nbsp;·&nbsp;
**[Templates](#-templates-that-look-good-from-the-start)** &nbsp;·&nbsp;
**[Doory vs Canva](#-doory-vs-canva)** &nbsp;·&nbsp;
**[Self-host](#-self-host-it-in-3-commands)** &nbsp;·&nbsp;
**[FAQ](#-faq)**

</div>

<br />

Doory is a full design editor that runs in your browser. Make posters, social posts, stories, slides,
invitations, resumes, thumbnails and business cards: start from a template or a blank page, edit everything,
and export to PNG, JPG, SVG, PDF, MP4 or GIF. **Every feature is free, nobody needs an account to start, and you
can run the whole thing on your own server.**

<br />

## 🎬 See it in action

<p align="center">
  <img src=".github/readme/demo.gif" alt="A real recording of Doory: picking the gig poster template, renaming the band, recolouring the dates, adding a star and opening the export menu" width="100%" />
</p>

<p align="center"><sub>A real, unedited recording: pick a template, rename the band, recolour the dates, add a star, export.</sub></p>

<br />

## 💜 Why people pick Doory

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🆓 Free, for real</h3>
      No Pro plan, no locked templates, no watermarks, no ads. Every tool in the editor is there for everyone,
      from background removal to video export.
    </td>
    <td width="50%" valign="top">
      <h3>⚡ Start in one click</h3>
      Open the editor and design. Guests' work is saved in the browser; create an account only when you want
      your designs in the cloud, and they move over in one step.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏠 Yours to host</h3>
      One <code>docker compose up</code> runs the app, the API, the database and live collaboration on your own
      server. Every design and upload stays under your control.
    </td>
    <td width="50%" valign="top">
      <h3>🛠️ A real editor</h3>
      Layers, groups, masks, filters, curved text, snapping, rulers, multi-page designs, animation, audio,
      presenting, comments and real-time co-editing.
    </td>
  </tr>
</table>

<br />

## 🎨 Everything you need to design

<table>
  <tr>
    <td width="50%" valign="top">
      <img src=".github/readme/editor.webp" alt="The Doory editor with the gig poster template open" />
      <h3>Edit anything</h3>
      Click any text, shape or photo to change it. Fonts, colours, sizes, alignment and effects are one click
      away in the toolbar above the page.
    </td>
    <td width="50%" valign="top">
      <img src=".github/readme/feature-animate.webp" alt="The Animate panel with enter, exit and emphasis animations" />
      <h3>Bring it to life</h3>
      27 enter and exit animations, 12 emphasis effects and 16 page transitions, with music and sound effects
      from a built-in library. Present it, or export it as a video.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src=".github/readme/feature-layers.webp" alt="The Layers panel with its right-click menu" />
      <h3>Stay organised</h3>
      Every object is a layer you can rename, lock, hide, reorder by dragging, group, or right-click to copy,
      duplicate, delete and arrange.
    </td>
    <td width="50%" valign="top">
      <img src=".github/readme/feature-export.webp" alt="The export menu: PNG, JPG, PDF, SVG, video and GIF" />
      <h3>Export anywhere</h3>
      PNG with transparency, JPG, SVG and PDF, plus MP4, WebM and animated GIF, all made in your browser. Need
      print? Get a print-ready PDF with bleed and crop marks.
    </td>
  </tr>
</table>

<details>
<summary><b>See the full feature list</b></summary>

<br />

| | |
|---|---|
| **Text** | Headings, curved text, text effects, font pairings, bulleted and numbered lists, an open-licensed font catalogue and your own uploaded fonts |
| **Elements** | Shapes, lines and arrows, about 25,000 icons, emoji and illustrations, stickers, QR codes |
| **Photos** | Upload, crop, masks and filters, one-click background removal (the model runs in your browser), stock photo search with an Unsplash or Pexels key |
| **Layout** | Layers with lock and hide, groups, alignment guides, snapping, rulers, multi-page designs with pages of different sizes, magic resize |
| **Motion** | 27 enter and exit animations, 12 emphasis animations and 16 page transitions on a timeline |
| **Sound** | A built-in library of 24 music loops and 88 sound effects (CC0), uploads, voiceover recording, trims and fades |
| **Present** | Present mode with speaker notes, timing, auto-advance, a laser pointer and a second presenter window |
| **Together** | Share links that can view, comment or edit (optionally password protected), pinned comments, version history and real-time co-editing with live cursors |
| **Brand** | Brand kits with your colours, fonts and logos, one click away in every design |
| **AI designer** | Prompt to editable graphics, model/provider connections, draft previews, spacing/style checks and motion tools; CLI providers only on explicitly enabled self-hosted installations. See [setup](docs/ai-assistant.md) |
| **Export** | PNG, JPG, SVG and PDF, MP4, WebM and animated GIF, all made in the browser, plus print-ready PDF with bleed and crop marks |

</details>

<br />

## 🖼️ Templates that look good from the start

<p align="center">
  <img src=".github/readme/template-collage.webp" alt="Ten starter templates: a gig poster, a wedding invitation, an event story, a sale post, a café flyer, a quote card, a resume, a YouTube thumbnail, a pitch deck and a business card" width="100%" />
</p>

Ten starter templates ship with Doory, each with its own palette, set in open-licensed fonts and fully editable:
a gig poster, a wedding invitation, an event story, a sale post, a café flyer, a quote card, a resume, a YouTube
thumbnail, a pitch deck and a business card. Add your own in the admin, and browse them all by category,
size and orientation.

<p align="center">
  <img src=".github/readme/templates.webp" alt="The template gallery" width="100%" />
</p>

<br />

## ⚖️ Doory vs Canva

Canva is a great product. Doory is for people who want the same kind of tool, but free, open and in their own hands.

| | **Doory** | Canva |
|---|:---:|:---:|
| Price | **Free, every feature** | Free plan, paid Pro and Teams plans |
| Open source | ✅ | ❌ |
| Run it on your own server | ✅ | ❌ |
| Design without an account | ✅ | ❌ |
| Your files stay on infrastructure you control | ✅ | ❌ |
| Real-time co-editing and comments | ✅ | ✅ |
| Animation, video and GIF export | ✅ | ✅ |
| Background removal | ✅ in your browser | ✅ |
| Template library | 10 starter templates, plus any you add | A very large library |

<br />

## 🚀 Self-host it in 3 commands

```bash
cp .env.example .env     # set DJANGO_SECRET_KEY (openssl rand -base64 48) and POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec api python manage.py createsuperuser
```

Open <http://localhost:8080> and start designing. The `web` container serves the app and forwards `/api` and
`/ws` to the backend, so the browser only ever talks to one address.

<details>
<summary><b>Add the starter content</b> (templates, icons, fonts, audio)</summary>

<br />

A new site starts empty. Add whatever you want once it is running:

```bash
docker compose exec api python manage.py seed_gallery         # template categories
docker compose exec api python manage.py sync_fonts --popular 100
docker compose exec api python manage.py seed_templates       # the starter templates (add --update to refresh them)
docker compose exec api python manage.py seed_elements        # shapes and graphics
docker compose exec api python manage.py sync_element_packs   # icons, emoji and illustrations (download)
docker compose exec api python manage.py sync_models          # background removal model
docker compose exec api python manage.py sync_audio           # music and sound effects
```

</details>

<details>
<summary><b>Settings worth knowing</b> (<code>.env</code>)</summary>

<br />

| Setting | What it does |
|---------|--------------|
| `SITE_URL` | The public address of the site, e.g. `https://doory.example.com` (no trailing slash) |
| `DJANGO_ALLOWED_HOSTS` | The host names the site answers to, comma separated |
| `SECURE_SSL_REDIRECT`, `SECURE_COOKIES` | `true` behind HTTPS, `false` for plain `http://` |
| `EMAIL_URL`, `DEFAULT_FROM_EMAIL` | SMTP, e.g. `smtp+tls://user:password@smtp.example.com:587` (without it, emails are printed to the API log) |
| `WEB_PORT`, `WEB_BIND` | Where the site is published (default `0.0.0.0:8080`) |
| `INSTALL_CHROMIUM` | `false` skips the headless browser that server-side PDF export needs |
| `GOOGLE_CLIENT_ID` | Turns on "Sign in with Google" |
| `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY` | Turn on stock photo search |
| `USE_S3` and `AWS_*` | Store uploads in S3-compatible storage instead of a local volume |

</details>

<details>
<summary><b>Develop locally</b></summary>

<br />

```bash
make setup     # virtualenv, dependencies, local database
make dev-api   # API on http://localhost:8000
make dev-web   # app on http://localhost:5173 (second terminal)
```

`make help` lists the other targets (tests, lint, content).

</details>

<br />

## ❓ FAQ

<details>
<summary><b>Is it really free?</b></summary>
<br />
Yes. There are no plans, no paywalls and no ads in Doory. Every feature is available to everyone.
</details>

<details>
<summary><b>Do I need an account?</b></summary>
<br />
No. Guests design straight away and their work is saved in the browser. An account keeps designs in the cloud,
lets you share them and use brand kits; signing up moves your guest designs over in one step.
</details>

<details>
<summary><b>Can I use it for my business or host it for my users?</b></summary>
<br />
Yes, as long as you credit the author as the licence asks: keep the licence and NOTICE with it and show the
credit in the running app. See <a href="#-license-and-credit">License and credit</a>.
</details>

<details>
<summary><b>Where are my designs stored?</b></summary>
<br />
Guest designs and their images live in the browser on that device. Signed-in designs are stored on the server
that runs Doory: yours, if you self-host. Uploads can go to a local volume or to S3-compatible storage.
</details>

<br />

## 🧱 Built with

<p>
  <img src="https://img.shields.io/badge/React-2b1c17?style=flat-square&logo=react&logoColor=61dafb" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-2b1c17?style=flat-square&logo=typescript&logoColor=3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-2b1c17?style=flat-square&logo=vite&logoColor=bd34fe" alt="Vite" />
  <img src="https://img.shields.io/badge/Fabric.js-2b1c17?style=flat-square" alt="Fabric.js" />
  <img src="https://img.shields.io/badge/Yjs-2b1c17?style=flat-square" alt="Yjs" />
  <img src="https://img.shields.io/badge/Django-2b1c17?style=flat-square&logo=django&logoColor=white" alt="Django" />
  <img src="https://img.shields.io/badge/PostgreSQL-2b1c17?style=flat-square&logo=postgresql&logoColor=4169e1" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Docker-2b1c17?style=flat-square&logo=docker&logoColor=2496ed" alt="Docker" />
</p>

React 19, TypeScript, Vite, Fabric.js, Yjs and Zustand in the browser; Django 5, Django REST Framework,
Channels and PostgreSQL on the server; Docker Compose with nginx, optional Redis and S3-compatible storage.

<br />

## 🤝 Contributing

Bug reports, ideas and pull requests are welcome. Open an [issue](https://github.com/shaongitbd/doory/issues) to
report a bug or suggest a feature. For a security problem, please report it privately through the repository's
**Security** tab instead.

**If Doory is useful to you, a ⭐ helps other people find it.**

<br />

## 📜 License and credit

Doory is released under the [Attribution Assurance License](LICENSE). You may use, change and redistribute it,
including commercially, but **you must credit the author**: keep the licence and [NOTICE](NOTICE) with it, and
display this credit prominently in the running app:

> Doory by Siam, creator and maintainer of Doory — https://github.com/shaongitbd/doory

Third-party software, fonts and content keep their own licences; see [THIRD_PARTY.md](THIRD_PARTY.md).

<div align="center">
<br />
<img src="frontend/src/assets/bunny-mark.webp" alt="" width="44" />
<br />
<sub>Made with care by Siam and the Doory bunny.</sub>
</div>
