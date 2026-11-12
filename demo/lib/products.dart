import 'package:flutter/material.dart';

class Product {
  const Product(
    this.id,
    this.name,
    this.subtitle,
    this.priceCents,
    this.icon,
    this.color,
    this.description,
  );
  final String id, name, subtitle, description;
  final int priceCents;
  final IconData icon;
  final Color color;
}

const products = [
  Product(
    'cup',
    '轻量随行杯',
    '把温度带在身边',
    6900,
    Icons.coffee_outlined,
    Color(0xFFE6EADD),
    '380ml 轻量杯身，食品接触级不锈钢内胆。无论通勤还是散步，都给自己留一杯热茶的时间。',
  ),
  Product(
    'bag',
    '日常帆布包',
    '轻装出门，自在随行',
    12900,
    Icons.shopping_bag_outlined,
    Color(0xFFECE2D5),
    '厚实棉帆布，内置收纳袋，能装下书本与日常小物。柔软肩带让每一次出门都更轻松。',
  ),
  Product(
    'lamp',
    '暖光小台灯',
    '留一盏灯给自己',
    19900,
    Icons.light_outlined,
    Color(0xFFF2E5D2),
    '三档暖光，触控调节。小巧的灯身适合书桌与床头，让阅读的片刻安静下来。',
  ),
  Product(
    'notebook',
    '方格记录本',
    '记下生活的细节',
    3900,
    Icons.menu_book_outlined,
    Color(0xFFDDE7E8),
    'A5 方格内页，平摊装订。记录灵感、安排计划，也留一点空白给明天。',
  ),
  Product(
    'speaker',
    '桌面小音箱',
    '让好音乐住进日常',
    25900,
    Icons.speaker_outlined,
    Color(0xFFE3DFE9),
    '简洁外形与温润音色，适合放在书架或工作台。无线连接，享受属于自己的声音。',
  ),
  Product(
    'blanket',
    '柔软针织毯',
    '把惬意披在身上',
    15900,
    Icons.checkroom_outlined,
    Color(0xFFE8DED8),
    '亲肤针织面料，细密柔软。午后小憩或夜晚阅读时，给自己恰到好处的温暖。',
  ),
];

Product? findProduct(String id) {
  for (final product in products) {
    if (product.id == id) return product;
  }
  return null;
}

String money(int cents) => '¥${(cents / 100).toStringAsFixed(2)}';
