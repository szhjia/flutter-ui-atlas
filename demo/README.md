# Shiwu Shop Demo

A standalone Flutter shop with six products, phone and tablet layouts, sign-in, product details, and a cart. It has no backend, orders, payments, or checkout.

The entry point is `lib/main.dart`. You can copy this directory elsewhere and run it with Flutter; it has no dependency on Atlas or a sibling project.

## Run

With the Flutter SDK installed, run from this directory:

```sh
flutter pub get
flutter run -d web-server --web-hostname 127.0.0.1 --web-port 60210
```

Open `http://127.0.0.1:60210/`. Sign in as `user1` or `user2`, both with password `1234.com`. Both accounts have the same permissions and separate carts.

Your session and carts are saved in the current browser and restored on reload. Signing out keeps your cart. **Reset demo data** clears both carts and signs you out after confirmation.

Below 720 logical pixels the app uses bottom navigation; at wider sizes it uses a navigation rail. All product names, prices, descriptions, and actions are available in both layouts.

## Capture with Atlas

Keep the app running. In another terminal, from this directory:

```sh
atlas init --url http://127.0.0.1:60210/ --ready-text "Sign in to Shiwu"
atlas config
```

In the configuration page, set the app URL above and choose form authentication:

| Setting                | Value                            |
| ---------------------- | -------------------------------- |
| Login URL              | `http://127.0.0.1:60210/`        |
| Username field (label) | `Username`                       |
| Password field (label) | `Password`                       |
| Submit button          | `Sign in`                        |
| Success check          | role `heading`, name `Home`      |
| Failure text           | `Incorrect username or password` |

Add the two demo accounts, test each login, and save. Then add the page catalog below to capture the signed-in routes.

For the full map, merge `routeMode`, `profiles`, `timeoutMs`, `requireObservedEdges`, `sourceFiles`, `screens`, and `edges` from [the sample catalog](../tests/helpers/shop-catalog.yaml) into `.atlas/atlas.yaml`. Keep the app URL, authentication, and account UUIDs saved by the configuration page. If you copied this demo out of the repository, get the catalog from the [source repository](https://github.com/szhjia/flutter-ui-atlas/blob/main/tests/helpers/shop-catalog.yaml).

```sh
atlas build                  # Capture phone and pad profiles
atlas view --profile phone
atlas view --profile pad
```

The catalog covers 11 account/route pages and 16 navigation transitions per viewport: one shared sign-in route and five routes per account. Wrong-password messages, adding products, and changing cart contents stay within their existing route; they do not add nodes. Atlas uses independent Chrome contexts, leaving your ordinary browsing session alone. Everything in `.atlas/` stays local and is ignored by Git.

## Check and build

```sh
flutter analyze
flutter test
flutter build web --no-web-resources-cdn --no-wasm-dry-run
```

Web output is written to `build/web/`. The Atlas repository's browser harness is for verification only; it is not needed to run this app.

Atlas can display declared Dart page names (for example `LoginPage` and `ProfilePage`) through the external acceptance catalog. The demo itself does not import Atlas. In the viewer, each signed-in account has six routes including the shared sign-in page and eight verified transitions. Use `atlas build --force` when refreshing runtime evidence; an ordinary unchanged build preserves the original capture time.
