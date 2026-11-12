import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'app.dart';
import 'products.dart';
import 'store.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.store});
  final ShopStore store;
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final username = TextEditingController();
  final password = TextEditingController();
  final form = GlobalKey<FormState>();
  bool failed = false;
  bool busy = false;
  @override
  void dispose() {
    username.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (busy || !form.currentState!.validate()) return;
    setState(() {
      busy = true;
      failed = false;
    });
    final success = await widget.store.login(
      username.text.trim(),
      password.text,
    );
    if (!mounted) return;
    if (success) {
      context.go('/home');
    } else {
      setState(() {
        busy = false;
        failed = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: ListenableBuilder(
        listenable: widget.store,
        builder: (context, _) => Column(
          children: [
            StorageNotice(store: widget.store),
            Expanded(
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 400),
                    child: Form(
                      key: form,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Icon(
                            Icons.spa_outlined,
                            size: 46,
                            color: accent,
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            '拾物',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 34,
                              fontWeight: FontWeight.w700,
                              color: ink,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Semantics(
                            header: true,
                            child: const Text(
                              '登录拾物',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 20, color: ink),
                            ),
                          ),
                          const SizedBox(height: 8),
                          const Text(
                            '发现日常里的好东西',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Color(0xFF758079)),
                          ),
                          const SizedBox(height: 32),
                          TextFormField(
                            key: const Key('username'),
                            controller: username,
                            decoration: const InputDecoration(
                              labelText: '登录账号',
                            ),
                            textInputAction: TextInputAction.next,
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? '请输入账号'
                                : null,
                          ),
                          const SizedBox(height: 16),
                          TextFormField(
                            key: const Key('password'),
                            controller: password,
                            obscureText: true,
                            decoration: const InputDecoration(
                              labelText: '登录密码',
                            ),
                            onFieldSubmitted: (_) => submit(),
                            validator: (value) =>
                                value == null || value.isEmpty ? '请输入密码' : null,
                          ),
                          if (failed)
                            Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Semantics(
                                liveRegion: true,
                                child: const Text(
                                  '账号或密码错误',
                                  style: TextStyle(color: Colors.red),
                                ),
                              ),
                            ),
                          const SizedBox(height: 24),
                          FilledButton(
                            onPressed: busy ? null : submit,
                            child: Text(busy ? '正在登录…' : '登录'),
                          ),
                          const SizedBox(height: 24),
                          const Text(
                            '演示账户 user1 / user2\n默认密码 1234.com',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.8,
                              color: Color(0xFF758079),
                            ),
                          ),
                          const SizedBox(height: 12),
                          ResetButton(store: widget.store),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class HomePage extends StatelessWidget {
  const HomePage({super.key, required this.store});
  final ShopStore store;
  @override
  Widget build(BuildContext context) => ShopScaffold(
    store: store,
    title: '首页',
    section: 0,
    child: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text(
          'SHIWU / EVERYDAY FINDS',
          style: TextStyle(fontSize: 11, letterSpacing: 2, color: accent),
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            color: const Color(0xFFE3E9DF),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '你好，${store.account}',
                style: const TextStyle(color: accent),
              ),
              const SizedBox(height: 14),
              const Text(
                '让日常，\n多一点喜欢。',
                style: TextStyle(
                  fontSize: 34,
                  height: 1.4,
                  fontWeight: FontWeight.w700,
                  color: ink,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                '从一只杯子到一盏小灯，\n找到陪伴你的生活好物。',
                style: TextStyle(height: 1.8, color: ink),
              ),
              const SizedBox(height: 22),
              FilledButton.icon(
                onPressed: () => context.go('/shop'),
                icon: const Icon(Icons.arrow_forward, size: 18),
                label: const Text('逛逛商城'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        const Text(
          '今日好物',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w600,
            color: ink,
          ),
        ),
        const SizedBox(height: 8),
        const Text('简单实用，刚刚好。', style: TextStyle(color: Color(0xFF758079))),
        const SizedBox(height: 18),
        ProductGrid(items: products.take(2).toList()),
      ],
    ),
  );
}

class ProductGrid extends StatelessWidget {
  const ProductGrid({super.key, required this.items});
  final List<Product> items;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (_, bounds) {
      final columns = bounds.maxWidth >= 1100
          ? 4
          : bounds.maxWidth >= 650
          ? 3
          : 2;
      return GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: items.length,
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: columns,
          mainAxisExtent: 244,
          crossAxisSpacing: 16,
          mainAxisSpacing: 24,
        ),
        itemBuilder: (_, index) => ProductTile(product: items[index]),
      );
    },
  );
}

class CatalogPage extends StatelessWidget {
  const CatalogPage({super.key, required this.store});
  final ShopStore store;
  @override
  Widget build(BuildContext context) => ShopScaffold(
    store: store,
    title: '商城',
    child: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text(
          '为生活挑选',
          style: TextStyle(
            fontSize: 28,
            fontWeight: FontWeight.w700,
            color: ink,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          '6 件日常好物 · 慢慢选，慢慢喜欢',
          style: TextStyle(color: Color(0xFF758079)),
        ),
        const SizedBox(height: 24),
        const ProductGrid(items: products),
      ],
    ),
  );
}

class ProductPage extends StatelessWidget {
  const ProductPage({super.key, required this.store, required this.product});
  final ShopStore store;
  final Product? product;
  @override
  Widget build(BuildContext context) {
    final item = product;
    if (item == null) return MissingPage(store: store);
    final details = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'SHIWU SELECTED',
          style: TextStyle(letterSpacing: 2, fontSize: 11, color: accent),
        ),
        const SizedBox(height: 16),
        Semantics(
          header: true,
          child: Text(
            item.name,
            style: const TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w700,
              color: ink,
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(item.subtitle, style: const TextStyle(color: Color(0xFF758079))),
        const SizedBox(height: 20),
        Text(
          money(item.priceCents),
          style: const TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w700,
            color: accent,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          item.description,
          style: const TextStyle(fontSize: 15, height: 1.9, color: ink),
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: () => store.add(item.id),
          icon: const Icon(Icons.add_shopping_cart_outlined),
          label: const Text('加入购物车'),
        ),
        const SizedBox(height: 10),
        OutlinedButton(
          onPressed: () => context.go('/cart'),
          child: const Text('查看购物车'),
        ),
        const SizedBox(height: 16),
        const Text(
          '演示商品 · 不产生真实交易',
          style: TextStyle(fontSize: 12, color: Color(0xFF758079)),
        ),
      ],
    );
    return ShopScaffold(
      store: store,
      title: '商品详情',
      back: true,
      child: LayoutBuilder(
        builder: (_, bounds) => SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: MediaQuery.sizeOf(context).width >= 720
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: ProductArt(product: item, height: 380)),
                    const SizedBox(width: 32),
                    Expanded(child: details),
                  ],
                )
              : Column(
                  children: [
                    ProductArt(product: item, height: 235),
                    const SizedBox(height: 24),
                    details,
                  ],
                ),
        ),
      ),
    );
  }
}

class CartPage extends StatelessWidget {
  const CartPage({super.key, required this.store});
  final ShopStore store;
  @override
  Widget build(BuildContext context) => ShopScaffold(
    store: store,
    title: '购物车',
    back: true,
    child: ListenableBuilder(
      listenable: store,
      builder: (context, _) => store.cart.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.shopping_bag_outlined,
                      size: 64,
                      color: accent,
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      '购物车还是空的',
                      style: TextStyle(fontSize: 22, color: ink),
                    ),
                    const SizedBox(height: 12),
                    const Text('把喜欢的好物带回来吧。'),
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: () => context.go('/shop'),
                      child: const Text('去逛逛'),
                    ),
                  ],
                ),
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      for (final entry in store.cart.entries)
                        CartRow(
                          store: store,
                          product: findProduct(entry.key)!,
                          count: entry.value,
                        ),
                    ],
                  ),
                ),
                SafeArea(
                  top: false,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    color: Colors.white,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '共 ${store.quantity} 件商品',
                          style: const TextStyle(color: Color(0xFF758079)),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '合计 ${money(store.totalCents)}',
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                            color: accent,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          '仅演示购物车，不提供结算。',
                          style: TextStyle(
                            fontSize: 12,
                            color: Color(0xFF758079),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    ),
  );
}

class CartRow extends StatelessWidget {
  const CartRow({
    super.key,
    required this.store,
    required this.product,
    required this.count,
  });
  final ShopStore store;
  final Product product;
  final int count;
  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            SizedBox(
              width: 64,
              child: ProductArt(product: product, height: 64),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: ink,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(money(product.priceCents)),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            IconButton(
              tooltip: '减少${product.name}数量',
              onPressed: () => store.change(product.id, -1),
              icon: const Icon(Icons.remove_circle_outline),
            ),
            Semantics(
              label: '${product.name}数量：$count',
              excludeSemantics: true,
              child: Text('$count'),
            ),
            IconButton(
              tooltip: '增加${product.name}数量',
              onPressed: count >= 99 ? null : () => store.add(product.id),
              icon: const Icon(Icons.add_circle_outline),
            ),
            const Spacer(),
            TextButton(
              onPressed: () => store.remove(product.id),
              child: Text('删除${product.name}'),
            ),
          ],
        ),
      ],
    ),
  );
}

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key, required this.store});
  final ShopStore store;
  @override
  Widget build(BuildContext context) => ShopScaffold(
    store: store,
    title: '我的',
    section: 2,
    child: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Container(
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            color: const Color(0xFFE3E9DF),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CircleAvatar(
                radius: 28,
                backgroundColor: Colors.white,
                child: Icon(Icons.person_outline, color: accent, size: 30),
              ),
              const SizedBox(height: 20),
              Text(
                store.account == 'user1' ? '小拾' : '小物',
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: ink,
                ),
              ),
              const SizedBox(height: 8),
              Text('演示账户 ${store.account}'),
              const SizedBox(height: 12),
              const Text('喜欢的东西，慢慢收集。'),
            ],
          ),
        ),
        const SizedBox(height: 24),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.shopping_bag_outlined),
          title: const Text('我的购物车'),
          subtitle: const Text('每个账户独立保存'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.go('/cart'),
        ),
        const Divider(),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Text(
            '这是一个没有后端的本地演示应用。\n登录和购物车保存在当前浏览器，退出后购物车仍保留。',
            style: TextStyle(height: 1.8, color: Color(0xFF758079)),
          ),
        ),
        OutlinedButton(onPressed: store.logout, child: const Text('退出登录')),
        const SizedBox(height: 12),
        ResetButton(store: store),
      ],
    ),
  );
}

class MissingPage extends StatelessWidget {
  const MissingPage({super.key, required this.store});
  final ShopStore store;
  @override
  Widget build(BuildContext context) => ShopScaffold(
    store: store,
    title: '页面不存在',
    back: true,
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('没有找到这个页面或商品'),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () => context.go('/shop'),
            child: const Text('返回商城'),
          ),
        ],
      ),
    ),
  );
}
