# Flutter UI Atlas

[中文说明](README.zh-CN.md)

A desktop canvas for exploring a Flutter app's screens, states, and navigation. Atlas captures your running Flutter Web app in Chrome and places the results on a map you can pan, arrange, and inspect.

Compare accounts and viewports, follow verified transitions, or open a screen in a separate Chrome session to try it yourself. Saved maps remain available after the app stops.

## Philosophy

Keep the app ordinary. Atlas connects to an existing Web URL; it needs no SDK, custom entry point, or changes to your widgets. You run the app with your usual tools.

Describe what matters. YAML defines pages, states, readiness checks, and actions. Accounts live in a local configuration page. App-specific behavior belongs in a trusted adapter when the standard steps are not enough.

Show what was checked. A screenshot records a screen. A transition is marked `observed` only after a real action reaches the expected route and content. Failed captures keep the last successful map.

## Install

The CLI is built from source for now; there is no published npm release. Use Node.js 26.12.1 (pinned in `.nvmrc`, or another version allowed by `package.json`), pnpm 10.33.0, and an installed Google Chrome. Atlas itself does not need the Flutter SDK.

```sh
git clone https://github.com/szhjia/flutter-ui-atlas.git
cd flutter-ui-atlas
pnpm install --frozen-lockfile
pnpm pack:cli
npm install --global .runtime/packages/flutter-ui-atlas-0.1.0.tgz
atlas --version
```

## Use with your app

Start your Flutter Web app as usual, then run these commands from its project directory:

```sh
atlas init --url http://127.0.0.1:8080/ --ready-text "Welcome"
atlas config   # Set the app URL, authentication, and accounts
atlas build    # Capture the running app
atlas view     # Open the desktop canvas
```

Replace the URL and `Welcome` with your app's address and exact visible text. This is enough to capture its entry screen. For more pages, add a catalog to `.atlas/atlas.yaml` while keeping the settings saved by `atlas config`:

```yaml
routeMode: hash
profiles:
  phone: {width: 393, height: 852}
  tablet: {width: 1024, height: 768}
screens:
  - id: home
    title: Home
    route: /home
    ready:
      all:
        - role: heading
          name: Home
        - role: button
          name: Open settings
  - id: settings
    title: Settings
    route: /settings
    ready: {role: heading, name: Settings}
edges:
  - id: open-settings
    source: home
    target: settings
    action: Open settings
    steps:
      - action: click
        target: {role: button, name: Open settings}
```

Use your app's actual routes and accessible labels. `prepare` steps can reproduce a state before capture; `roles` can restrict a page to selected accounts. Build all profiles with `atlas build`, or select one with `atlas build --profile phone` and `atlas view --profile phone`.

On the canvas, drag and lock screens, filter the map, inspect screenshots, and undo layout changes. With a page catalog in place, select a screen to open a live session: Atlas signs in and prepares it in an independent Chrome context, then cleans up the session when it closes.

Everything under `.atlas/` is local: configuration, credentials, snapshots, and generated maps. `atlas init` adds the directory to the app's root `.gitignore`. Enter passwords through `atlas config`; they are stored locally as permission-restricted plaintext, never in YAML. Local URLs are the default; remote development URLs require `allowRemoteUrls: true`.

## Try the demo

The [demo](demo/README.md) is a standalone Flutter shop. Copy it anywhere and run it with standard Flutter commands:

```sh
cd demo
flutter pub get
flutter run -d web-server --web-hostname 127.0.0.1 --web-port 60210
```

Sign in as `user1` or `user2`, both with password `1234.com`. Browse six products, edit a cart, switch accounts, and reload to see local persistence. It has no backend or checkout.

To map it, run `atlas init --url http://127.0.0.1:60210/ --ready-text "Sign in to Shiwu"` in `demo/`, then `atlas config`. The demo README lists the login settings; [the sample catalog](tests/helpers/shop-catalog.yaml) shows pages, preparation, and transitions for phone and tablet. Keep the app URL and account settings from your own configuration.

## Agent skill

The English [flutter-ui-atlas skill](.agents/skills/flutter-ui-atlas/SKILL.md) helps coding agents connect an app, describe its states, and verify captures. For use in another project, copy its folder into that project's `.agents/skills/` or your agent's skill directory.

## Development

```sh
pnpm dev          # React canvas at http://127.0.0.1:60200; no Flutter SDK needed
pnpm type-check
pnpm test
pnpm test:browser
```

`pnpm dev` starts only the canvas. To test the standalone demo, run `flutter analyze`, `flutter test`, and `flutter build web --no-web-resources-cdn --no-wasm-dry-run` inside `demo/`, then `pnpm test:demo` from the repository root.

`packages/viewer` contains the canvas; `packages/capture` the browser capture and adapter interfaces; `packages/cli` the local workflow. The Flutter package in `packages/flutter_ui_atlas` is an optional compatibility SDK.

Detailed [protocol](docs/协议与适配接口.md) and [architecture](docs/架构与接入指南.md) notes are currently in Chinese.

## Built with

- [React Flow](https://reactflow.dev/) (`@xyflow/react`) provides the node-and-edge canvas: screen nodes, navigation edges, pan, zoom, and selection. It is the foundation of the Viewer.
- [React](https://react.dev/) powers the Viewer and configuration page.
- [Playwright](https://playwright.dev/) drives Chrome for captures, login checks, and live sessions.
- [Tabler Icons](https://tabler.io/icons) supplies the canvas and configuration icons.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=szhjia/flutter-ui-atlas&type=Date)](https://www.star-history.com/#szhjia/flutter-ui-atlas&Date)
