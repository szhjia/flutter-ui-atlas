import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'pages.dart';
import 'products.dart';
import 'store.dart';

const ink = Color(0xFF253C36);
const paper = Color(0xFFF6F5F0);
const accent = Color(0xFF416B58);

class ShopApp extends StatefulWidget {
  const ShopApp({super.key, required this.store, this.initialLocation});
  final ShopStore store;
  final String? initialLocation;
  @override
  State<ShopApp> createState() => _ShopAppState();
}

class _ShopAppState extends State<ShopApp> {
  late final router = GoRouter(
    initialLocation: widget.initialLocation,
    refreshListenable: widget.store,
    redirect: (_, state) {
      final path = state.uri.path;
      if (widget.store.account == null && path != '/login') return '/login';
      if (widget.store.account != null && (path == '/' || path == '/login'))
        return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/', redirect: (_, _) => '/home'),
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (_, _) => LoginPage(store: widget.store),
      ),
      GoRoute(
        path: '/home',
        name: 'home',
        builder: (_, _) => HomePage(store: widget.store),
      ),
      GoRoute(
        path: '/shop',
        name: 'shop',
        builder: (_, _) => CatalogPage(store: widget.store),
      ),
      GoRoute(
        path: '/me',
        name: 'me',
        builder: (_, _) => ProfilePage(store: widget.store),
      ),
      GoRoute(
        path: '/cart',
        name: 'cart',
        builder: (_, _) => CartPage(store: widget.store),
      ),
      GoRoute(
        path: '/products/:id',
        name: 'product',
        builder: (_, state) => ProductPage(
          store: widget.store,
          product: findProduct(state.pathParameters['id']!),
        ),
      ),
    ],
    errorBuilder: (_, _) => MissingPage(store: widget.store),
  );

  @override
  void dispose() {
    router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: 'Shiwu · Shop Demo',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      fontFamily: 'NotoSansSC',
      colorScheme: ColorScheme.fromSeed(
        seedColor: accent,
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: paper,
      appBarTheme: const AppBarTheme(
        backgroundColor: paper,
        foregroundColor: ink,
        surfaceTintColor: Colors.transparent,
      ),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: Colors.white,
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    ),
    routerConfig: router,
  );
}

class ShopScaffold extends StatelessWidget {
  const ShopScaffold({
    super.key,
    required this.store,
    required this.title,
    required this.child,
    this.section = 1,
    this.back = false,
  });
  final ShopStore store;
  final String title;
  final Widget child;
  final int section;
  final bool back;

  void navigate(BuildContext context, int index) =>
      context.go(['/home', '/shop', '/me'][index]);

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) => LayoutBuilder(
      builder: (context, bounds) {
        final pad = bounds.maxWidth >= 720;
        return Scaffold(
          appBar: AppBar(
            automaticallyImplyLeading: false,
            leading: back
                ? IconButton(
                    tooltip: 'Back to shop',
                    icon: const Icon(Icons.arrow_back),
                    onPressed: () => context.go('/shop'),
                  )
                : null,
            title: Semantics(header: true, child: Text(title)),
            actions: [
              Semantics(
                label: 'Account: ${store.account}',
                excludeSemantics: true,
                child: Text(
                  store.account ?? '',
                  style: const TextStyle(fontSize: 13, color: accent),
                ),
              ),
              const SizedBox(width: 8),
              Semantics(
                label: 'Cart items: ${store.quantity}',
                container: true,
                explicitChildNodes: true,
                child: IconButton(
                  tooltip: 'Open cart',
                  onPressed: () => context.go('/cart'),
                  icon: ExcludeSemantics(
                    child: Badge(
                      label: Text('${store.quantity}'),
                      child: const Icon(Icons.shopping_bag_outlined),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
            ],
          ),
          body: Row(
            children: [
              if (pad)
                NavigationRail(
                  selectedIndex: section,
                  onDestinationSelected: (index) => navigate(context, index),
                  labelType: NavigationRailLabelType.all,
                  backgroundColor: paper,
                  leading: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 20),
                    child: Icon(Icons.spa_outlined, color: accent, size: 30),
                  ),
                  destinations: const [
                    NavigationRailDestination(
                      icon: Icon(Icons.home_outlined),
                      label: Text('Home'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.storefront_outlined),
                      label: Text('Shop'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.person_outline),
                      label: Text('Profile'),
                    ),
                  ],
                ),
              if (pad)
                const VerticalDivider(width: 1, color: Color(0xFFE4E5DD)),
              Expanded(
                child: Column(
                  children: [
                    StorageNotice(store: store),
                    Expanded(child: child),
                  ],
                ),
              ),
            ],
          ),
          bottomNavigationBar: pad
              ? null
              : NavigationBar(
                  selectedIndex: section,
                  onDestinationSelected: (index) => navigate(context, index),
                  destinations: const [
                    NavigationDestination(
                      icon: Icon(Icons.home_outlined),
                      label: 'Home',
                    ),
                    NavigationDestination(
                      icon: Icon(Icons.storefront_outlined),
                      label: 'Shop',
                    ),
                    NavigationDestination(
                      icon: Icon(Icons.person_outline),
                      label: 'Profile',
                    ),
                  ],
                ),
        );
      },
    ),
  );
}

class StorageNotice extends StatelessWidget {
  const StorageNotice({super.key, required this.store});
  final ShopStore store;
  @override
  Widget build(BuildContext context) => store.warning == null
      ? const SizedBox.shrink()
      : Material(
          color: const Color(0xFFFFE7BD),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              children: [
                Text(store.warning!),
                TextButton(
                  onPressed: store.retrySave,
                  child: const Text('Retry save'),
                ),
              ],
            ),
          ),
        );
}

class ResetButton extends StatelessWidget {
  const ResetButton({super.key, required this.store});
  final ShopStore store;
  @override
  Widget build(BuildContext context) => TextButton.icon(
    icon: const Icon(Icons.restart_alt),
    label: const Text('Reset demo data'),
    onPressed: () async {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Reset demo data?'),
          content: const Text(
            'This clears both carts and signs you out. Products and demo accounts stay available.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Reset'),
            ),
          ],
        ),
      );
      if (confirmed == true) await store.reset();
    },
  );
}

class ProductArt extends StatelessWidget {
  const ProductArt({super.key, required this.product, this.height = 180});
  final Product product;
  final double height;
  @override
  Widget build(BuildContext context) => Container(
    height: height,
    width: double.infinity,
    decoration: BoxDecoration(
      color: product.color,
      borderRadius: BorderRadius.circular(16),
    ),
    child: ExcludeSemantics(
      child: Center(
        child: Icon(
          product.icon,
          size: height * .46,
          color: ink.withValues(alpha: .75),
        ),
      ),
    ),
  );
}

class ProductTile extends StatelessWidget {
  const ProductTile({super.key, required this.product});
  final Product product;
  @override
  Widget build(BuildContext context) => Semantics(
    key: Key('product-${product.id}'),
    button: true,
    label: 'View ${product.name}',
    excludeSemantics: true,
    child: InkWell(
      onTap: () => context.go('/products/${product.id}'),
      borderRadius: BorderRadius.circular(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (_, size) =>
                  ProductArt(product: product, height: size.maxHeight),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            product.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 16,
              color: ink,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            product.subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, color: Color(0xFF6B746F)),
          ),
          const SizedBox(height: 6),
          Text(
            money(product.priceCents),
            style: const TextStyle(fontWeight: FontWeight.w700, color: accent),
          ),
        ],
      ),
    ),
  );
}
